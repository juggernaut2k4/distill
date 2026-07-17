# B2B-19 — Partner-Supplied Inline Content, Transition Markers & Minute Enforcement — Requirement Document

Version: 1.1
Status: CEO APPROVED 2026-07-17 (Q-A/Q-B/Q-C settled by Arun; O-1/O-2 confirmed by CEO; one build-time condition on Req 3.2 — see Section 11 "CEO sign-off")
Author: Business Analyst Agent
Date: 2026-07-17
Source brief: `.claude/agents/clio/feature-briefs/B2B-19-inline-content-delivery-transition-and-minute-enforcement.md`
Related: `CORE_OBJECTIVES.md` v3 Objective 2 (steps 2–3) + Objective 3 (per-minute billing); `docs/scope-gap-analysis-2026-07-17.md` §2a

> **Note on the three escalated questions.** The brief deliberately left Q-A, Q-B, Q-C open for Arun. Arun has now answered all three directly (2026-07-17). Their resolutions are treated as **settled requirements** throughout this document, and are recorded verbatim in Section 11. Section 11 therefore carries only two genuinely-new, minor technical sub-questions surfaced during design (a duration-field default and a nudge-timing buffer), each with a recommended default.

---

## 1. Purpose

Clio's core product spine (`CORE_OBJECTIVES.md` v3 Objective 2) is: a partner hands Clio *their own* pages/images with per-page transition points; Clio's voice bot narrates them and advances the shared render as it goes; then returns insights. Today's `POST /api/partner/v1/sessions` accepts **only** a content reference into Clio's own 27-type template schema (`content_ref` / `partner_topic_ref` → `extractSections()` → `TemplateSection[]`). A partner **cannot** hand Clio a raw HTML page or image URL, and **no code path reads a partner-supplied transition point.** Separately, the per-minute billing that Objective 3 makes the entire commercial basis is **not enforced at true balance exhaustion** for live sessions (live-mode init checks only for a payment method, never `balance_usd`), and billed minutes come from a **client-reported number or a wall-clock estimate**, not from Attendee's real session data.

This feature closes all three gaps: (1) an **inline-content delivery mode** (partner URLs + configurable fetch auth + per-page transition triggers), (2) a **dual-signal transition mechanism** on a system-generated unique marker, and (3) **real minute enforcement** — a hard block at initiation, a graceful mid-session force-end, and Attendee-sourced billing accuracy.

**Failure without it:** the product's stated primary flow does not exist (partners are forced into Clio's Designer/template system, which the pivot has made a disabled/unadvertised fallback), and the commercial model leaks — a partner with a card on file but a depleted wallet can run unlimited paid sessions, and every session is billed on an unverifiable client number.

---

## 2. User Stories

**US-1 — Partner engineer (inline content):**
As a partner platform's backend engineer,
I want to POST a Clio session carrying an ordered list of my own HTML/image page URLs, each with a transition point, plus narration material,
So that Clio's bot narrates my existing content and advances my pages live — without me re-authoring anything into Clio's template system.

**US-2 — Partner engineer (fetch auth, API-only):**
As a partner platform's backend engineer,
I want to register a content source once (public, Bearer, or OAuth2-against-my-own-server) through a plain API call and thereafter reference it by an opaque id,
So that Clio can fetch my protected pages without me ever entering credentials into a Clio portal screen, and without my secret crossing the wire on every session.

**US-3 — End participant (transition reliability):**
As the executive in the live meeting,
I want the shared screen to advance to exactly the right page as the bot finishes each section — never mid-sentence on a common word, never double-jumping,
So that the visual always matches what I'm hearing.

**US-4 — Partner account owner (billing integrity):**
As a partner account owner,
I want Clio to stop starting new sessions once my paid minutes are truly gone, and to wrap up a running session gracefully rather than either overshooting my balance or cutting the bot off mid-sentence,
So that I am billed only for minutes actually used (as measured by Attendee), with a proactive heads-up before I run out.

**US-5 — Existing Option 2 partner (backward compatibility):**
As a partner already integrated via `content_ref`/`partner_topic_ref` (the Designer/template path),
I want my existing integration to keep working byte-for-byte unchanged after this ships,
So that this new capability never becomes a forced migration.

---

## 3. Trigger / Entry Point

This feature adds **one new API route** and **extends two existing ones**; it also adds **two background/enforcement paths**. No new user-facing UI (per Arun's explicit "no portal" instruction). Trigger surface:

> **Auth note (traced — not an authorization-scope system):** `requirePartnerApiKey(request, X)`'s second argument is a **rate-limit class** (`RateLimitClass = 'sessions_create' | 'reads' | 'oauth_token'`, `lib/partner/rate-limit.ts`), **not** an authorization scope — Clio has no per-endpoint permission/scoping layer today, only rate-limit buckets + active-account validation. The content-sources endpoint (T-1) is a low-frequency write; **BA decision: reuse the `'reads'` rate-limit class** (or add a dedicated `'content_sources_write'` class in `rate-limit.ts` if the developer prefers stricter isolation — either is acceptable, do not invent an authorization scope). Every partner-authenticated endpoint is already tenant-isolated by `auth.partnerAccountId`; that is the access control for content sources (a source is only ever readable/usable by its owning account).

| # | Trigger | Route / mechanism | Auth | State required |
|---|---|---|---|---|
| T-1 | Partner registers a content source | `POST /api/partner/v1/content-sources` (**new**) | Partner API key or OAuth2 access token via `requirePartnerApiKey(request, <rate-limit class>)` — see note below | Active partner account |
| T-2 | Partner starts an inline-content session | `POST /api/partner/v1/sessions` (**extended**) with `content_pages[]` + `content_source_id` | `requirePartnerApiKey(request, 'sessions_create')` (unchanged) | Active partner account; live mode also needs sufficient `balance_usd` (Req 3) |
| T-3 | Bot narrates & render advances | Headless render browser at `/partner-render/[clio_session_ref]` (**extended** `PartnerRenderClient`) — dual-signal transition | Opaque `clio_session_ref` (existing render trust boundary) | Session dispatched, Hume config provisioned |
| T-4 | Mid-session minute enforcement | Inngest job `partner-live-cutoff` (**new**, generalized from `partner-trial-cutoff`) triggered by `clio/partner-live.started` | Internal | Live session dispatched with a finite affordable-minutes budget |
| T-5 | Session end billing | `handleSessionEnd()` (**extended**) + Attendee webhook fallback (**extended**) | Internal / Attendee signature | Session ending |

Nothing in this feature is reachable by an unauthenticated consumer. There is no consumer sign-up (pivot: Clerk is partner-admin-only).

---

## 4. Screen / Flow Description

There are **no new visual screens.** The user-facing surface is API request/response bodies plus the (unchanged-in-appearance) headless render page, whose *behavior* changes (marker-driven advance). This section describes each flow state precisely; wireframes for the API contracts are in Section 5.

### 4.A — Content-source registration flow (`POST /api/partner/v1/content-sources`)

- **State A1 — request received.** Body is Zod-validated against a discriminated union keyed on `auth_type` (`none | static_bearer | oauth2_client_credentials | presigned_url | mtls`). Each `auth_type` has its own required-field set (Section 5.1).
- **State A2 — rejected auth type.** If `auth_type` is `presigned_url` or `mtls`, return **422** with error code `content_source_auth_type_not_supported` and a message naming the type and that it is documented-but-not-yet-built. **No row is written.**
- **State A3 — validation failure.** Missing/malformed field for the given `auth_type` → **422** `Validation failed` with `zod.flatten()` details. No row written.
- **State A4 — stored.** For `none`, `static_bearer`, `oauth2_client_credentials`: insert one `partner_content_sources` row. Secret fields (`static_bearer` token; OAuth2 `client_secret`) are AES-256-GCM encrypted via the crypto pattern in Section 6 **before** insert — plaintext never touches the DB. Return **201** with `{ content_source_id }` (opaque UUID, non-secret). The plaintext secret is **never** returned or echoed.
- **State A5 — duplicate/idempotency.** Registration is not idempotent by content; each call mints a new `content_source_id`. (A partner that re-registers gets a new id; old ids keep working until the partner stops referencing them. No delete endpoint in this brief — see Section 10.)

### 4.B — Inline-content session initiation (`POST /api/partner/v1/sessions`)

- **State B1 — mode detection.** The refine rule becomes: **exactly one of** {Option 1 inline content, Option 2 content reference} is present.
  - *Option 2 (unchanged):* `partner_topic_ref` XOR/OR `content_ref` present, no `content_pages`. Behaves byte-for-byte as today.
  - *Option 1 (new):* `content_pages[]` present (non-empty) **and** `content_source_id` present; `partner_topic_ref`/`content_ref` **absent**.
  - Both present, or neither → **422** validation error.
- **State B2 — content-source resolution (Option 1 only).** `content_source_id` must resolve to a `partner_content_sources` row **owned by the authenticated partner account** (tenant check). Not found / wrong owner → **422** `content_source_not_found`. If the resolved row's `auth_type` is `presigned_url`/`mtls` (should not happen since registration rejects them, but defensive), reject with `content_source_auth_type_not_supported`.
- **State B3 — URL validation (Option 1 only, SSRF gate).** Every `content_pages[].url` is validated at initiation (scheme allowlist, host safety — Section 6 SSRF spec). Any URL failing → **422** `content_source_url_rejected` with the offending index. No dispatch.
- **State B4 — minute gate (live mode only).** After the existing `funding_required` payment-method check, the **new** balance check runs (Req 3.1). Insufficient balance → **402** `balance_exhausted`, session marked `failed` with `end_reason: 'balance_exhausted'`, **`dispatchMeetingBot()` never called.** Test mode keeps its existing `trial_exhausted` gate unchanged.
- **State B5 — persisted & dispatched.** The `partner_sessions` row is inserted carrying the new inline-content columns (Section 6). For live mode, after a successful dispatch, emit `clio/partner-live.started` with the computed affordable-minutes budget (T-4). Return **201** `{ clio_session_ref, status, render_url }`.

### 4.C — Live render + transition (headless browser, `PartnerRenderClient`)

- **State C1 — render mode branch.** The render page resolves the session. If it carries inline content (`content_pages`), it takes the **new inline render path** (fetch each URL with resolved credentials, display HTML/image as-is) — **bypassing `extractSections()` / `TemplateSection` entirely.** If it carries a content reference, it takes the existing Option 2 path unchanged.
- **State C2 — marker injection.** The script-assembly step (`assembleHumeNativePrompt()` via `resolveLiveSessionRender()`) weaves one **system-generated unique marker sentence per page** into what the bot is told to say at each page's transition point (Req 2).
- **State C3 — dual-signal advance.** As the bot speaks, **two independent signals** can fire the page advance, both landing in `PartnerRenderClient`:
  1. **Transcript-watch (primary):** `onMessage(text, 'ai')` runs the marker matcher; a hit fires the advance.
  2. **Hume tool-call (backup):** the bot calls the transition tool (`advance_tab`/`show_visual`), whose existing handler fires the advance.
  Both route through **one shared idempotent `advanceOnTransition(transitionMarkerId)`**. Whichever arrives first advances; the second is a **no-op** (idempotency set keyed on `transition_marker_id`). See Req 2 for the exact dedup.
- **State C4 — mid-session wrap-up (live minute exhaustion).** If the affordable-minutes boundary is reached before the meeting ends, the enforcement job sets a `wrap_up_pending` flag; the client poll (reusing the B2B-11 join-greeting poll mechanism) delivers a **wrap-up nudge** via `sendWrapUpNudge()`, the bot closes out naturally, then the call ends (Req 3.1). This is **not** a hard cut.
- **State C5 — end.** Session ends via `end_session` tool (bot-driven), client teardown, or the enforcement job's clean bot-leave. Billing is computed from Attendee's real duration (Req 3.2).

---

## 5. Visual Examples (API contract wireframes)

### 5.1 — `POST /api/partner/v1/content-sources` (new)

**Request — `auth_type: none`:**
```
POST /api/partner/v1/content-sources
Authorization: Bearer clio_live_sk_...
Content-Type: application/json

{
  "auth_type": "none",
  "label": "public-marketing-pages"      // optional, partner-facing display label only
}
```

**Request — `auth_type: static_bearer`:**
```
{
  "auth_type": "static_bearer",
  "label": "cms-bearer",
  "token": "<the partner's bearer token / API key>",   // secret — AES-256-GCM at rest
  "header_name": "Authorization",                        // optional, default "Authorization"
  "header_scheme": "Bearer"                               // optional, default "Bearer"; "" for raw header value
}
```

**Request — `auth_type: oauth2_client_credentials`:**
```
{
  "auth_type": "oauth2_client_credentials",
  "label": "partner-oauth",
  "token_url": "https://auth.partner.example.com/oauth/token",
  "client_id": "abc123",
  "client_secret": "<secret>",              // secret — AES-256-GCM at rest
  "scope": "content.read",                  // optional
  "audience": "https://content.partner.example.com"  // optional
}
```

**Success response (201) — every functional type:**
```
201 Created
{ "content_source_id": "b3f1c2a4-... (opaque uuid)" }
```

**Rejected-type response (422) — `presigned_url` or `mtls`:**
```
422 Unprocessable Entity
{
  "error": {
    "code": "content_source_auth_type_not_supported",
    "message": "auth_type 'presigned_url' is documented but not yet supported. Supported types: none, static_bearer, oauth2_client_credentials."
  }
}
```

**Validation-failure response (422):**
```
422 Unprocessable Entity
{ "error": "Validation failed", "details": { "fieldErrors": { "token": ["Required"] }, "formErrors": [] } }
```

### 5.2 — `POST /api/partner/v1/sessions` — Option 1 (inline content, new)

**Request:**
```
POST /api/partner/v1/sessions
Authorization: Bearer clio_live_sk_...
Content-Type: application/json

{
  "meeting_url": "https://meet.google.com/abc-defg-hij",
  "content_source_id": "b3f1c2a4-...",
  "title": "Q3 AI Strategy Briefing",
  "subtitle": "For the exec team",
  "content_to_explain": "Walk the exec through our three AI adoption bets and the risk posture for each.",
  "content_pages": [
    { "url": "https://content.partner.example.com/deck/1.html", "media_type": "html",
      "title": "Where we are today", "transition_trigger": "move on after the current-state overview" },
    { "url": "https://content.partner.example.com/deck/2.png", "media_type": "image",
      "title": "The three bets", "transition_trigger": "advance once the three bets are introduced" },
    { "url": "https://content.partner.example.com/deck/3.html", "media_type": "html",
      "title": "Risk posture", "transition_trigger": "wrap after risk posture" }
  ],
  "expected_duration_minutes": 20,          // see Section 11 open item O-1 (default if omitted)
  "partner_end_user_ref": "user-8842",      // optional (unchanged)
  "partner_reference": "briefing-3391"       // optional (unchanged)
}
```

**Success response (201):**
```
201 Created
{
  "clio_session_ref": "9e2a...",
  "status": "bot_active",
  "render_url": "https://distill-peach.vercel.app/partner-render/9e2a..."
}
```

**Insufficient-balance response (live mode, 402):**
```
402 Payment Required
{
  "error": {
    "code": "balance_exhausted",
    "message": "Your Clio balance cannot cover this session's expected duration. Add funds or reduce expected_duration_minutes. Test-mode sessions are unaffected."
  }
}
```

**SSRF-rejected URL response (422):**
```
422 Unprocessable Entity
{
  "error": {
    "code": "content_source_url_rejected",
    "message": "content_pages[1].url is not an allowed URL (must be https to a public host).",
    "rejected_index": 1
  }
}
```

### 5.3 — `POST /api/partner/v1/sessions` — Option 2 (content reference, UNCHANGED)

```
{ "meeting_url": "https://meet.google.com/...", "content_ref": "3f2504e0-4f89-11d3-9a0c-0305e82c3301" }
   → 201 { "clio_session_ref": "...", "status": "bot_active", "render_url": "..." }
```
This request and response are **byte-for-byte identical to current production behavior.** No new required field applies to Option 2.

### 5.4 — Marker injection (illustrative, inside the assembled prompt's SESSION CONTENT)

```
[PAGE 2 — "The three bets"]
<narration material for page 2>
[STAGE DIRECTION — DO NOT SAY THE BRACKETED LABEL] When you have finished
introducing the three bets and are about to move to the risk posture, say this
exact phrase naturally as part of your sentence: "kestrel-vellum-9471".
Then call the advance_tab tool.
```
`kestrel-vellum-9471` is the system-generated unique `transition_marker` for that page (Req 2). The partner's raw `transition_trigger` string ("advance once the three bets are introduced") is used only as the *intent* label to position the marker — it is **never** matched literally.

---

## 6. Data Requirements

### 6.1 New table — `partner_content_sources`

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK, default `gen_random_uuid()` | the opaque `content_source_id` returned to the partner |
| `partner_account_id` | uuid FK → `partner_accounts.id`, NOT NULL | tenant isolation; every read is filtered by the authenticated account |
| `auth_type` | text NOT NULL, CHECK IN (`none`,`static_bearer`,`oauth2_client_credentials`) | `presigned_url`/`mtls` are **never stored** — rejected at registration, so they are deliberately excluded from the CHECK |
| `label` | text NULL | partner-supplied display label, non-secret |
| `credential_ciphertext` | text NULL | AES-256-GCM ciphertext (format `v1:<iv>:<tag>:<data>`). Holds the bearer token (`static_bearer`) or a JSON blob of `{client_id, client_secret}` (`oauth2_client_credentials`). NULL for `none`. |
| `oauth_token_url` | text NULL | oauth2 only; non-secret |
| `oauth_scope` | text NULL | oauth2 only; optional |
| `oauth_audience` | text NULL | oauth2 only; optional |
| `header_name` | text NULL, default `'Authorization'` | static_bearer only |
| `header_scheme` | text NULL, default `'Bearer'` | static_bearer only |
| `created_at` | timestamptz NOT NULL default now() | |

- **Encryption:** reuse the **AES-256-GCM `encryptOutboundToken` / `decryptOutboundToken` pattern** (`lib/partner/crypto.ts`). Add a parallel pair (e.g. `encryptContentSourceCredential` / `decryptContentSourceCredential`) OR reuse the existing functions directly — BA decision: **reuse the existing `encryptOutboundToken`/`decryptOutboundToken` functions**, since the format and threat model are identical (a credential Clio replays *outward*). **Do NOT hash** (do not follow `hashApiKey`/`hashClientSecret` — those are for verifying *incoming* secrets Clio never replays; these are replayed outward and must be decryptable). Encryption key: reuse `PARTNER_OUTBOUND_TOKEN_ENCRYPTION_KEY` (already `PLACEHOLDER_`-conventioned). No new env var required. RLS: service-role-only writes/reads (same pattern as other partner tables).

### 6.2 Extended table — `partner_sessions` (new columns, all nullable/additive)

| Column | Type | Notes |
|---|---|---|
| `content_source_id` | uuid NULL FK → `partner_content_sources.id` | Option 1 only |
| `content_pages` | jsonb NULL | ordered array of `{ url, media_type, title, subtitle, transition_trigger, transition_marker }` — the injected `transition_marker` per page is generated at initiation/render and stored here |
| `content_to_explain` | text NULL | narration material; **transient-use only** — see Data Boundary below |
| `content_title` | text NULL | |
| `content_subtitle` | text NULL | |
| `expected_duration_minutes` | integer NULL | carried for the minute gate (Req 3.1) |
| `wrap_up_pending` | boolean NOT NULL default false | mid-session enforcement flag (mirrors `join_greeting_pending`) |
| `wrap_up_nudge_text` | text NULL | resolved wrap-up directive the client poll delivers |
| `billed_duration_source` | text NULL, CHECK IN (`attendee`,`client_reported`,`wall_clock_fallback`) | provenance of the minutes billed (Req 3.2) — makes fallback-billed sessions queryable |
| `attendee_joined_at` | timestamptz NULL | authoritative bot-join timestamp from Attendee `bot.state_change: joined_recording` |
| `attendee_ended_at` | timestamptz NULL | authoritative bot-leave timestamp from Attendee `bot.state_change: ended`/`fatal_error` |

- **Backward compatibility:** every new column is nullable / defaulted. An Option 2 session leaves them all null and is completely unaffected. The existing `partner_sessions_auth_credential_check` (migration 079) and all other constraints are untouched.

### 6.3 Reads / writes / external calls

- **Reads:** `partner_content_sources` (by id + owner) at initiation and render; `partner_wallets.balance_usd` at initiation; `billing_rate_versions` (via `resolveEffectiveRate` for `event_type = 'voice_minute'`) at initiation and mid-session budgeting; Attendee webhook payload timestamps at end.
- **Writes:** `partner_content_sources` (registration); `partner_sessions` new columns (initiation/render/end); `usage_events` + `wallet_ledger` + `partner_wallets` decrement via the existing `applyWalletDecrement()` at end (unchanged mechanism, Attendee-sourced quantity).
- **External calls (new, outbound):** fetch each `content_pages[].url` from the render path with resolved credentials; for `oauth2_client_credentials`, an RFC 6749 §4.4 client-credentials POST to the partner's `token_url`. **These are the deliberate, guarded SSRF exception** (below).
- **localStorage/sessionStorage:** none.

### 6.4 SSRF / untrusted-fetch discipline (MANDATORY — Requirement 1.3)

Partner page URLs are partner-controlled inputs Clio's server fetches. This is the one place this brief touches CLAUDE.md's "never fetch from dynamically constructed endpoints" rule; it must be a **deliberate, guarded exception**, not waved through. Spec:

1. **Scheme allowlist:** `https` only. Reject `http`, `file`, `ftp`, `data`, `gopher`, `blob`, etc.
2. **Host safety (block SSRF targets):** resolve the host and reject if it is a private/internal/link-local/loopback/metadata address — `127.0.0.0/8`, `10/8`, `172.16/12`, `192.168/16`, `169.254/16` (incl. `169.254.169.254` cloud metadata), `::1`, `fc00::/7`, `fe80::/10`, `0.0.0.0`, and any hostname that resolves to one of these. Reject non-public/`.internal`/`.local`-style hosts.
3. **No redirects to unsafe hosts:** follow redirects with `redirect: 'manual'` (or re-validate each hop) so a public URL cannot 302 into an internal address. Cap redirect depth (≤ 3).
4. **Size + time limits:** `AbortController` timeout (≤ 15s, mirroring `attemptDispatch`); max response body size (e.g. ≤ 5 MB HTML, ≤ 10 MB image) — abort past the cap.
5. **Content-type enforcement:** `media_type: 'html'` responses must be `text/html`; `image` must be an `image/*` type. Mismatch → treat page as unavailable.
6. **Safe rendering:** fetched HTML is displayed in Clio's headless render browser as partner content. It is **sandboxed** — rendered inside a sandboxed `<iframe>` (`sandbox` without `allow-same-origin` unless strictly required) or an equivalent isolation boundary so a hostile/compromised partner page cannot script against Clio's render-page origin, read the Hume token, or exfiltrate session data. No partner HTML is executed in Clio's own page context. **Do NOT use `dangerouslySetInnerHTML` on partner HTML** (CLAUDE.md rule) — render via `srcdoc`/`src` on a sandboxed iframe or an image element.
7. **Failure discipline:** any fetch/validation failure degrades to a defined session status (mirror `pullPartnerContent`'s `unavailable` — never throw, never crash the render). A page that cannot be fetched shows the render page's existing unavailable/degraded state.

### 6.5 Non-Negotiable Data Boundary (`CORE_OBJECTIVES.md`)

Partner page **bodies** and end-user transcript content are **computed-on / narrated, not persisted** as system-of-record. `content_pages` stores URLs + metadata + the injected marker (pointers, not page bodies). `content_to_explain`/`content_title`/`content_subtitle` are the partner-supplied narration inputs the partner chose to send on the session call — they may be stored on `partner_sessions` for the session's own render/assembly lifetime (they are not end-user data), but **no fetched page body and no end-user transcript text is persisted** beyond what the existing de-identified quality-improvement retention already permits. The Attendee `transcript.update` partner branch stays log-only/no-persist (unchanged).

---

## 7. Success Criteria (Acceptance Tests)

Each is verifiable by QA (behavioral) or by `grep`/`tsc`/unit test (code-level). `AT-BC-*` = backward-compat, `AT-SSRF-*` = SSRF, `AT-Q*` = the resolved escalations.

**Content source registration**
- **AT-1** — Given a valid `static_bearer` body, when POSTed to `/api/partner/v1/content-sources`, then a `partner_content_sources` row exists with `credential_ciphertext` in `v1:<iv>:<tag>:<data>` format, **the plaintext token appears nowhere in the row**, and the response is `201 { content_source_id }` with no secret echoed. (Unit + DB assertion.)
- **AT-2** — Given `auth_type: "presigned_url"` (and separately `"mtls"`), when POSTed, then response is `422 content_source_auth_type_not_supported` and **no row is written**. (Unit.)
- **AT-3** — Given `decryptContentSourceCredential(encrypt(x)) === x` for the bearer token and for the oauth `{client_id, client_secret}` blob (round-trip), and `decrypt` returns `null` (never throws) on corrupt input. (Unit — mirrors `crypto.ts` tests.)
- **AT-4** — Grep assertion: `partner_content_sources` credential storage calls the AES-256-GCM path and **never** `hashApiKey`/`hashClientSecret`. (`grep` CI check.)

**Inline session contract**
- **AT-5** — Given a valid Option 1 body (`content_pages[]` + `content_source_id`, no `content_ref`/`partner_topic_ref`), when POSTed, then `201` and the `partner_sessions` row carries `content_pages`, `content_source_id`, and a generated `transition_marker` per page. (Integration.)
- **AT-6** — Given a body with **both** `content_pages` and `content_ref`, then `422` (refine rule "exactly one of Option 1 / Option 2"). Given **neither**, then `422`. (Unit.)
- **AT-BC-1 (hard requirement)** — Given an existing Option 2 body (`{ meeting_url, content_ref }` or `{ meeting_url, partner_topic_ref }`), when POSTed, then behavior, DB row, and `201` response are **identical to pre-B2B-19 production** — no new field is required, and the render still runs the `extractSections()`/`TemplateSection` path unchanged. (Integration + snapshot test against the current contract.)
- **AT-BC-2** — Grep/inspection: `lib/templates/*` and the 27-type `TemplateSection` schema are **not modified** by this feature; `extractSections()` is unchanged. (CI grep + diff review.)
- **AT-7** — Given a `content_source_id` owned by a **different** partner account, then `422 content_source_not_found` (tenant isolation). (Integration.)

**SSRF**
- **AT-SSRF-1** — Given `content_pages[].url = "http://169.254.169.254/..."` (or `http://localhost`, `http://10.0.0.5`, `file:///etc/passwd`), then `422 content_source_url_rejected` with the offending index, **and `dispatchMeetingBot()` is never called.** (Unit for validator + integration.)
- **AT-SSRF-2** — Given a public URL that 302-redirects to `http://169.254.169.254`, then the fetch is blocked at the redirect hop (manual redirect re-validation). (Unit against the fetch helper.)
- **AT-SSRF-3** — Given partner HTML containing `<script>` that reads `window.location`/tokens, when rendered, then it executes only inside the sandboxed iframe and **cannot** read the render-page origin's data. (Manual/DOM test.)

**Transition (Q-B resolved: dual-signal + dedup)**
- **AT-Q-B-1** — Given a page's injected unique `transition_marker`, when the transcript-watch detects it in Clio's `assistant_message` stream, then the page advances exactly once. (Unit against the matcher + integration.)
- **AT-Q-B-2** — Given the same page, when the Hume transition tool-call fires, then the page advances exactly once. (Unit against the tool handler.)
- **AT-Q-B-3 (the race test)** — Given the transcript-detection signal and the tool-call signal for the **same `transition_marker_id` within N ms of each other**, when both are processed, then the page advances **exactly once** (the second is a no-op). Verifiable by firing both handlers back-to-back against the shared `advanceOnTransition(markerId)` and asserting `goToSection` ran once. (Unit — deterministic, no timing flake.)
- **AT-Q-B-4** — Given a common English word that happens to appear in the bot's unrelated speech, when transcript-watch runs, then **no** advance fires (only the system-unique marker triggers). (Unit — marker uniqueness.)
- **AT-8** — Setup-time collision validation: given a `transition_marker` that collides with a token in the page narration/content, then generation re-rolls until unique (or the session is flagged not-ready), so the marker cannot occur incidentally. (Unit.)
- **AT-9** — `PROMPT_TEMPLATE_VERSION` is bumped on the template edit, and the tone/style anchor still lands within the 7,000-char window in the assembled inline-content prompt. (Unit — reuse the existing guardrail assertion.)

**Minute enforcement (Q-C resolved: two enforcement points)**
- **AT-Q-C-1 (initiation hard block)** — Given a **live** partner with a payment method on file but `balance_usd` below the cost of `expected_duration_minutes` at the effective `voice_minute` rate, when a session is POSTed, then `402 balance_exhausted`, the row is `failed`/`end_reason: 'balance_exhausted'`, and **`dispatchMeetingBot()` is never called** (zero vendor cost). (Integration.)
- **AT-Q-C-2** — Given the same partner with **sufficient** balance, the session dispatches normally and emits `clio/partner-live.started` with the computed affordable-minutes budget. (Integration.)
- **AT-Q-C-3 (mid-session graceful end, NOT a hard cut)** — Given a live session that reaches its affordable-minutes-minus-buffer boundary while still running, then a **wrap-up nudge** is delivered (via `sendWrapUpNudge`, reusing the join-greeting poll path) **before** the call ends — the bot gets runway to close out; the call is not force-disconnected mid-sentence. Verify the nudge send precedes the bot-leave. (Integration + inspection.) Contrast: the existing test-mode `partner-trial-cutoff` force-ends with **no** nudge — this new path **must not** copy that verbatim.
- **AT-Q-C-4** — Test-mode `trial_exhausted` gate is unchanged; the two wallets (`trial_minutes_used`/`test_minutes_balance` vs paid `balance_usd`) are never conflated. (Integration + grep.)
- **AT-10 (heads-up de-dup)** — The proactive low-balance heads-up does not double-fire with the existing `checkLowBalanceAndAlert` `low_balance_alert_fired_at` one-shot. (Unit.)

**Attendee-sourced accuracy**
- **AT-11** — Given Attendee `bot.state_change` `joined_recording` and `ended` timestamps for a session, when it ends, then billed `duration_minutes = (ended − joined)` and `billed_duration_source = 'attendee'`. (Integration.)
- **AT-12** — Given Attendee timing is genuinely unavailable, then billing falls back to the client-reported/`updated_at` value with `billed_duration_source` set to `client_reported`/`wall_clock_fallback` accordingly (queryable). (Integration.)
- **AT-13 (idempotency)** — Given both the client end-path and the Attendee-webhook fallback fire for one session, then the wallet is decremented **once** (existing `recordBillableEvent` idempotency index + `status in (completed,failed)` guard hold). (Integration.)

**Build hygiene**
- **AT-14** — `npx tsc --noEmit` clean; `npm run build` passes; all new API inputs Zod-validated; no unapproved packages; new secret env documented in `.env.local.example` (none required if reusing `PARTNER_OUTBOUND_TOKEN_ENCRYPTION_KEY`). (CI.)

---

## 8. Error States

| Surface | Failure | User-visible behavior |
|---|---|---|
| `content-sources` POST | Rejected auth type (`presigned_url`/`mtls`) | `422 content_source_auth_type_not_supported`, message names the type + supported list |
| `content-sources` POST | Missing field for the `auth_type` | `422 Validation failed` + Zod field errors |
| `sessions` POST | Both/neither content mode | `422` refine error |
| `sessions` POST | `content_source_id` not found / wrong owner | `422 content_source_not_found` |
| `sessions` POST | URL fails SSRF gate | `422 content_source_url_rejected` + `rejected_index`; no dispatch |
| `sessions` POST | Live balance insufficient | `402 balance_exhausted`; row `failed`; no dispatch |
| Render | Page fetch fails / times out / wrong content-type | Degrade to the render page's existing `unavailable` state (never throw) — mirror `pullPartnerContent` |
| Render | OAuth2 token endpoint (partner's) fails | Degrade to `unavailable`; log; never crash the render (mirror `pullPartnerContent` discipline) |
| Render | Hume config provisioning fails | Existing behavior: session proceeds without voice, template/pages still render |
| Transition | Marker never spoken (bot skipped it) | Backup tool-call still advances; if neither fires, the page simply doesn't auto-advance (no crash) — same graceful degradation as today's self-advance |
| Mid-session | `sendWrapUpNudge` fails (socket not open) | One retry then give up (existing join-greeting policy); the enforcement job's clean bot-leave at the true-zero boundary is the backstop so billing never overshoots |
| End | Attendee timing missing | Fallback billing with `billed_duration_source` flagged; no double-count |

Slow/loading: page fetches have an `AbortController` timeout; the render page keeps its existing connecting/listening states. OAuth2 tokens are cached to their expiry so a slow token endpoint is hit at most once per source per token lifetime.

---

## 9. Edge Cases

1. **`auth_type: none` inline vs registered (Q-A resolved → universal registration).** Per Arun, **every** content source — including public/no-auth — goes through `POST /api/partner/v1/content-sources` first and gets a `content_source_id`. A `none` source simply stores no credential fields. There is **no** inline-`none` shortcut on the session call. (This overrides the brief's §1.2 recommendation — see Section 11 Q-A.)
2. **First-ever partner, no wallet row (live).** Existing `funding_required` fail-closed still fires first; if a wallet row exists with a payment method but zero balance, the new `balance_exhausted` gate fires. Both fail closed (no dispatch).
3. **`expected_duration_minutes` omitted.** Applies the documented default (Section 11 O-1). The minute gate uses the default; mid-session enforcement still governs true exhaustion regardless.
4. **Session shorter than affordable budget.** Mid-session job's `cancelOn` (mirroring `partner-trial-cutoff`'s `clio/partner-trial.ended`) cancels the cutoff on a normal end — no wrap-up nudge fires, no overshoot.
5. **Single page (`content_pages` length 1).** No transition needed; marker still injected for the "wrap after this" cue; advance is effectively the end-of-content signal.
6. **Marker collides with page content.** Setup-time collision validation re-rolls (AT-8).
7. **Both transition signals fire (race).** Dedup no-op (AT-Q-B-3).
8. **Bot says the marker early/incidentally.** Prevented by system-uniqueness (near-zero natural occurrence) + setup-time collision check + forward-only single-hit-decisive detection (RTV-03 semantics) — advance is monotonic, never backward.
9. **Attendee webhook arrives before client end-path (or vice-versa).** Idempotency holds (AT-13); `billed_duration_source` records which won.
10. **Partner HTML page is hostile.** Sandboxed iframe isolation (AT-SSRF-3); no execution in Clio's origin.
11. **OAuth2 token endpoint returns a token that expires mid-session.** Token is cached to its stated expiry; a re-fetch on the next page fetch after expiry; failure degrades to `unavailable` for that page only.
12. **Mixed HTML + image pages in one session.** Each page rendered per its `media_type`; images via `<img>`, HTML via sandboxed iframe.
13. **Test-mode inline session.** Test-mode's existing `trial_exhausted` gate governs; the new paid-wallet `balance_exhausted` gate and paid mid-session cutoff do **not** apply to test mode (wallets kept separate).

---

## 10. Out of Scope

- **The Designer/template system (Option 2).** Not touched, not redesigned. `content_ref`/`partner_topic_ref` → `extractSections()` → `TemplateSection[]` stays byte-for-byte. `lib/templates/*` and the 27-type schema are **not** modified.
- **Any portal / Configurator UI for content-source auth.** API-only. (The Developer Portal **Docs** page documenting the API contract + the 5 `auth_type` enum values **is** in scope to update — documentation, not configuration UI.)
- **Building the `presigned_url` and `mtls` fetch mechanisms.** Documented enum values, rejected at runtime. Nothing more.
- **A content-source **delete/rotate** endpoint.** Not in this brief (registration + reference only). Flag as a follow-up.
- **Persisting fetched partner page bodies or end-user transcripts** beyond existing de-identified retention.
- **A partner-facing live minute counter UI.** The real-time counter is an internal safety/heads-up mechanism only (Arun confirmed).
- **RTV-05 (making transcript-watching authoritative over Clio's *own* 27-template B2C/Designer screens).** This brief scopes transcript-watching authority **only** to the new inline-content render path (Q-B resolution), not to the deferred RTV-05 template gate.

---

## 11. Open Questions

**Q-A / Q-B / Q-C — RESOLVED by Arun (2026-07-17). Recorded here as settled requirements, not open questions.**

- **Q-A — RESOLVED: universal registration, no exceptions.** Every content source, including public/no-auth (`auth_type: none`), must go through the one-time `POST /api/partner/v1/content-sources` step and receive an opaque `content_source_id` before use — for consistency, not just auth. `none` gets a `content_source_id` with no credential fields stored. *(This overrides the brief's §1.2 recommendation to allow inline `none`.)* Reflected in Sections 4.A, 5.1, 6.1, 9.1.

- **Q-B — RESOLVED: dual-signal transition, not a single mechanism.** Build **both** triggers on the same system-generated unique marker: (1) **transcript-watching (primary)** — the proven RTV-02/03 golden-word + forward-only single-hit-decisive machinery, watching Clio's live `assistant_message` (`source:'ai'`) stream; (2) **a redundant Hume tool-call (backup)** — the bot is instructed, via the same marker-injection step, to call the transition tool at that point, reusing the exact `show_visual`/`advance_tab` mechanism already proven in production. Whichever signal arrives first fires the transition; the second is a **no-op** via an idempotency check keyed on `(session_id, transition_marker_id)` before the page-advance executes, so a race cannot advance twice. This is a deliberate redundancy design ("what will work for sure"), **not** to be simplified to a single mechanism. Reflected in Sections 4.C, 5.4, and the Req 2 detail below.
  - *Implementation note (traced, load-bearing):* RTV-03's `checkRtv03Transition` is a **pure client-side state machine** invoked from the render browser's `onMessage` handler — both the transcript-watch signal and the Hume tool-call land in the **same** `PartnerRenderClient` instance (single `clio_session_ref`). The dedup is therefore a **local idempotency set** (`useRef<Set<string>>` keyed on `transition_marker_id`) inside `advanceOnTransition()`, which is race-free by construction (single-threaded JS event loop) — no distributed lock needed. `session_id` is implicit in the client instance and used for any server-side audit write.

- **Q-C — RESOLVED: two distinct enforcement points, different behavior at each.** (1) **At initiation:** block a new live session if the partner's remaining wallet-derived minutes (`balance_usd ÷ effective voice_minute rate`) are less than the requested `expected_duration_minutes` → `402 balance_exhausted`, no dispatch. (2) **Mid-session, if balance exhausts before the meeting ends:** do **not** hard-cut. Send the bot a **wrap-up nudge** (reuse `sendWrapUpNudge()`, proven in B2B-08 trial-cutoff-adjacent and B2B-11 join-greeting work) so it closes out naturally, **then** end the call — explicitly **not** the abrupt `partner-trial-cutoff` verbatim (that one force-ends with no nudge). Threshold: cannot afford one more billable minute. Reflected in Req 3 below and Sections 4.C-C4, 7 (AT-Q-C-*).

**Genuinely-new minor technical sub-questions surfaced during design (each with a recommended default — confirm at CEO review; neither blocks build if the default stands):**

- **O-1 — `expected_duration_minutes` field: required vs defaulted, and the default value.** For the initiation minute gate to be computable, the session contract needs an expected/max duration. Making it **required** would break Option 1 ergonomics and risks confusing partners; making it required on Option 2 would break backward compatibility (must not). **BA recommendation:** field is **optional on the request, defaulted server-side to 30 minutes** when omitted (a round, conservative session length; mid-session enforcement governs true exhaustion regardless, so the default is a soft budgeting input, not a hard cap). Applies to Option 1 only; Option 2 ignores it (backward-compat preserved). **Confirm the default value (30) and optional-with-default posture.**

- **O-2 — Mid-session wrap-up nudge buffer.** How many seconds before true zero-balance should the nudge fire, to give a natural close without dead air? **BA recommendation:** fire the wrap-up nudge at **affordable-minutes − 45 seconds**, and schedule the clean bot-leave backstop at **affordable-minutes + a small grace (e.g. +15s)** so the bot has ~60s of runway to wrap. This mirrors `session-timer.ts`'s two-phase warning spirit (which `partner-trial-cutoff` deliberately skipped) without copying the trial-cutoff's abrupt end. **Confirm the 45s buffer / 60s runway.**

All other questions (1–7 to the BA) are resolved by code tracing and documented in Sections 5–7 and Requirements 1–3 below.

---

### CEO sign-off (2026-07-17) — spec approved, decisions recorded

I independently spot-checked the load-bearing claims at source before approving. All held:
- **Q-B dedup simplicity — VERIFIED.** `checkRtv03Transition` (`lib/content/rtv03-tracker.ts`) is a pure, side-effect-free state machine (all state passed as args, returns `Rtv03Hit | null`). In `PartnerRenderClient.tsx` the tool-call handlers (`show_visual`/`advance_tab`) live in the client-side `tools:{}` map and `onMessage` is currently a **no-op** (line 201) — the exact injection point for the transcript matcher. Both signals therefore execute in the **same** client component's single-threaded runtime, so the `useRef<Set<string>>` dedup is race-free by construction, no distributed lock. Confirmed. *(Minor note: existing RTV-03 wiring lives in `WalkthroughClient.tsx`, not `PartnerRenderClient` — the dual-signal wiring in this render path is net-new code, correctly scoped by the spec.)*
- **Backward-compat — VERIFIED.** Current refine (`sessions/route.ts` line 28) is `Boolean(partner_topic_ref || content_ref)`; the revised "exactly one of {inline, reference}" preserves every existing Option 2 request unchanged. AT-BC-1/2 are real regression catchers.
- **Credential storage — VERIFIED.** `encryptOutboundToken`/`decryptOutboundToken` (`lib/partner/crypto.ts`) are AES-256-GCM, `v1:<iv>:<tag>:<data>`, decrypt returns `null` (never throws) on corrupt input. Reuse + "retrievable-not-hashed because Clio replays it outward" reasoning is sound and matches the module's own threat-model comment.
- **SSRF/sanitization — VERIFIED (design-level, non-trivial).** Section 6.4 has scheme allowlist, internal/link-local/metadata-IP blocking (incl. `169.254.169.254`), manual redirect re-validation, size/time caps, content-type enforcement, and sandboxed-iframe isolation with an explicit no-`dangerouslySetInnerHTML` rule. Adequate.
- **Billing gap 1 — VERIFIED.** `sessions/route.ts` live branch (lines 141–164) checks only `stripe_default_payment_method_id`, never `balance_usd`. The initiation `balance_exhausted` gate correctly slots in after it.
- **Billing gap 2 & trial-cutoff contrast — VERIFIED.** `partner-trial-cutoff.ts` is test-mode-only and its docstring explicitly states "no graceful pre-cutoff nudge" — grounding the requirement that the new paid-wallet path must add the nudge, not copy it verbatim. Attendee webhook confirms `bot.state_change` `joined_recording`/`ended` states, the `updated_at` wall-clock fallback (line 381), and the `status in (completed,failed)` idempotency guard (line 376).

**O-1 — CONFIRMED: `expected_duration_minutes` optional, server-defaulted to 30, Option-2-ignored.** No more-grounded number exists (B2B-08 establishes a 20-min free trial and 120-min paid blocks at $0.0150/min, but no "typical session length"). 30 min is a reasonable, conservative choice, and conservative in the *safe* direction — a higher default requires more balance to start, so it fails toward blocking a possibly-long session rather than under-reserving. Mid-session enforcement governs true exhaustion regardless, so the default is a soft budgeting input. Adopt 30.

**O-2 — CONFIRMED: wrap-up nudge at (affordable-minutes − 45s), clean bot-leave backstop at ~+15s (≈60s runway).** Sound for a natural voice close: a 2–4 sentence wrap is ~20–40s of speech plus nudge-delivery/sentence-boundary latency; 60s of runway is comfortable without wasting meaningful paid minutes, and it correctly avoids the trial-cutoff's abrupt end. Adopt 45s/60s.

**Build-time CONDITION on Requirement 3.2 (accuracy) — must be resolved during build, does NOT block approval.** The `AttendeeWebhookEvent` interface types `data` as `Record<string, unknown>` and exposes **no confirmed Attendee-provided event-occurrence timestamp** — BA-question 7 ("confirm exactly which field carries authoritative duration, and whether an API read-back is needed") is answered at assertion level, not pinned to a field. Because Arun's requirement is that billed minutes come from *Attendee's own data*, the developer must, during build: (1) inspect the real `bot.state_change` payload (already logged at `webhook/route.ts` line 163) to determine whether Attendee carries an event/occurrence timestamp (or a duration/recording field); (2) prefer that Attendee-carried value for `attendee_joined_at`/`attendee_ended_at`; (3) only if Attendee genuinely carries no timestamp, fall back to webhook-**receipt** time and label it distinctly from a true Attendee-measured value (e.g. `attendee_receipt` vs `attendee`) so provenance stays honest and queryable. This is a technical trace the dev closes at build, not a product decision — hence a condition, not a return.

Approved. Proceed to Dev. Suggested branch: `agent/partner-inline-content` (per CLAUDE.md `agent/<feature-slug>`).

---

## 12. Dependencies

Everything required already exists; this brief wires and extends, it does not depend on unbuilt work.

- **Crypto** — `lib/partner/crypto.ts` `encryptOutboundToken`/`decryptOutboundToken` (AES-256-GCM) + `PARTNER_OUTBOUND_TOKEN_ENCRYPTION_KEY`. (Reused, not new.)
- **Auth** — `lib/partner/auth.ts` `requirePartnerApiKey` + `lib/partner/rate-limit.ts` `RateLimitClass`. T-1 reuses `'reads'` (or adds a `'content_sources_write'` rate-limit class); T-2 keeps `'sessions_create'`. There is **no** authorization-scope layer — tenant isolation via `auth.partnerAccountId` is the access control.
- **Session init** — `dispatchMeetingBot()` (`lib/partner/session-init.ts`), `POST /api/partner/v1/sessions/route.ts`.
- **Render** — `lib/partner/live-render.ts` (`resolveLiveSessionRender`, `handleSessionEnd`), `render-data.ts` (`pullPartnerContent` failure discipline to mirror), `app/partner-render/[clio_session_ref]/PartnerRenderClient.tsx` + page.
- **Prompt assembly** — `lib/voice/hume-native/prompt-template.ts` (`assembleHumeNativePrompt`, `PROMPT_TEMPLATE_VERSION`, 7,000-char guardrail); `lib/voice/hume-native/config-provisioner.ts` (tool set: `advance_tab`, `show_visual`, `end_session`).
- **Marker engine** — `lib/content/session-markers.ts` (RTV-02 unique-marker generation to reuse/adapt), `lib/content/rtv03-tracker.ts` (forward-only single-hit-decisive matcher to reuse), `lib/content/tokenize.ts`.
- **Wallet / billing** — `lib/partner/webhooks.ts` (`recordBillableEvent`, `applyWalletDecrement`, `resolveEffectiveRate` for `event_type='voice_minute'`, `checkLowBalanceAndAlert`), `partner_wallets`, `wallet_ledger`, `billing_rate_versions`, RPC `decrement_wallet_balance`.
- **Enforcement job** — `inngest/partner-trial-cutoff.ts` (generalize to a new `inngest/partner-live-cutoff.ts` for the paid wallet; `inngest/client.ts`; `getMeetingBotProvider().deleteBot`).
- **Nudge delivery** — `lib/voice/hume-adapter.ts` `sendWrapUpNudge`; the B2B-11 join-greeting poll pattern in `PartnerRenderClient.tsx` + `app/api/partner/render/join-greeting/[clio_session_ref]/route.ts` (mirror for a new wrap-up-nudge poll/route).
- **Attendee timing** — `app/api/attendee/webhook/route.ts` (`handlePartnerSessionEvent` `bot.state_change` branch; capture `joined_recording` / `ended` timestamps).
- **DB migrations** — new `partner_content_sources` table; additive columns on `partner_sessions` (Section 6). No changes to `lib/templates/*` or the 27-type schema.
- **Docs** — Developer Portal Docs page: document `POST /api/partner/v1/content-sources`, the extended sessions contract, and all 5 `auth_type` enum values (3 functional, 2 rejected).

---

# Detailed Requirements (build-facing)

## Requirement 1 — Inline Content Delivery + Content-Source Auth (API-driven, no portal)

### 1.1 Session contract (additive, backward-compatible)
- Extend `CreateSessionSchema` (`app/api/partner/v1/sessions/route.ts` lines 20–31). Add an inline-content branch: `content_pages: z.array(z.object({ url: z.string().url(), media_type: z.enum(['html','image']), title: z.string().max(200).optional(), subtitle: z.string().max(300).optional(), transition_trigger: z.string().min(1).max(500) })).min(1)`, `content_source_id: z.string().uuid()`, `content_to_explain`/`title`/`subtitle` optional strings, `expected_duration_minutes: z.number().int().positive().max(600).optional()`.
- **Revise the refine** to: exactly one of {inline content (`content_pages` present), content reference (`content_ref` || `partner_topic_ref` present)} — reject both/neither. Existing `content_ref`/`partner_topic_ref` requests must satisfy the refine with no change (AT-BC-1).
- URL SSRF validation (6.4) runs at initiation for every `content_pages[].url` before insert/dispatch.

### 1.2 Content-source registration — `POST /api/partner/v1/content-sources`
- Zod discriminated union on `auth_type`. Per-type fields per Section 5.1. `presigned_url`/`mtls` → `422 content_source_auth_type_not_supported` (no row). Store secrets AES-256-GCM (Section 6.1), return `{ content_source_id }`.
- OAuth2 blob stored as encrypted `JSON.stringify({ client_id, client_secret })`; `token_url`/`scope`/`audience` stored plaintext (non-secret).

### 1.3 Inline render path
- In `resolveLiveSessionRender()` (or a sibling), branch on `session.content_pages != null`. Resolve credentials from `partner_content_sources`, fetch each URL (SSRF-guarded, 6.4), render HTML in a **sandboxed iframe** and images in `<img>`, **bypassing `extractSections()`/`TemplateSection`.** Failures degrade to `unavailable` (mirror `pullPartnerContent`).
- **OAuth2 outbound flow (BA question 3):** RFC 6749 §4.4 client-credentials POST to the partner's `token_url` with `grant_type=client_credentials` (+ optional `scope`/`audience`), `Authorization: Basic base64(client_id:client_secret)` or form body per the token endpoint; cache the returned `access_token` to `expires_in`; present as `Authorization: Bearer <token>` when fetching pages. **Clio is the client here, not the issuer** — read `lib/partner/oauth.ts` for shape only; do **not** reuse its Clio-as-issuer/JWT-signing logic. Token-endpoint failure → degrade to `unavailable`, never crash.

## Requirement 2 — Transition Marker (dual-signal, per Q-B)

### 2.1 Generation
- Reuse/adapt `generateSessionMarkers()` (RTV-02) to produce **one system-unique marker per `content_pages` entry** (a guaranteed-unique, near-zero-natural-occurrence phrase). Store each on `content_pages[i].transition_marker`. Bookend/edge pages may use the literal-marker convention; interior pages use the uniqueness pipeline.
- **Setup-time collision validation:** verify each `transition_marker` does not appear in the page narration/`content_to_explain` before the session is accepted as ready (AT-8); re-roll on collision.

### 2.2 Injection
- Inject the marker sentence at each page's transition point inside the assembled prompt's SESSION CONTENT, via `assembleHumeNativePrompt()` / `resolveLiveSessionRender()` (`live-render.ts` lines 130–147). The bot is instructed to (a) say the unique marker naturally at that point **and** (b) call the transition tool — the dual signal. **Bump `PROMPT_TEMPLATE_VERSION`**; re-verify the 7,000-char tone-anchor guardrail in the assembled inline prompt (AT-9).

### 2.3 Detection + dedup (dual-signal, race-free)
- **Primary (transcript-watch):** wire `PartnerRenderClient`'s currently-no-op `onMessage(text, 'ai')` to run the RTV-03 forward-only, single-hit-decisive matcher against the current page's `transition_marker`. A hit calls `advanceOnTransition(markerId)`.
- **Backup (tool-call):** the existing `advance_tab`/`show_visual` handlers call the same `advanceOnTransition(markerId)`.
- **Dedup:** `advanceOnTransition` holds a `useRef<Set<string>>` of already-fired `transition_marker_id`s; first call advances (`goToSection` + optional server audit write), subsequent calls for the same id are no-ops. Race-free (single-threaded client). Forward-only: never advances to a page ≤ current (RTV-03 semantics). AT-Q-B-1..4.

## Requirement 3 — Minute Enforcement + Attendee Accuracy (per Q-C)

### 3.1 Enforcement (two points)
- **Initiation (live branch, `sessions/route.ts` after `funding_required`):** compute `effectiveRate = resolveEffectiveRate(partnerAccountId, 'voice_minute', now)`; if no rate, treat as the existing behavior (do not over-block — document). If `balance_usd < expected_duration_minutes * rate.rate_usd` (i.e. cannot afford the expected session, floor = cannot afford one billable minute), return `402 balance_exhausted`, mark `failed`/`end_reason:'balance_exhausted'`, **do not** dispatch. On success, emit `clio/partner-live.started` with `affordableMinutes = floor(balance_usd / rate.rate_usd)`.
- **Mid-session (`inngest/partner-live-cutoff.ts`, new — generalize `partner-trial-cutoff.ts` to the paid wallet):** `step.sleep` until `affordableMinutes − 45s` (O-2), then set `wrap_up_pending=true` + `wrap_up_nudge_text` on the session; the client poll (new mirror of the join-greeting poll) delivers it via `sendWrapUpNudge()`. After a short runway (`+~60s`), if still not ended, clean bot-leave (`deleteBot` + mark completed + `recordBillableEvent`). `cancelOn` `clio/partner-live.ended` (emitted from `handleSessionEnd` for live sessions, mirroring the test-mode `clio/partner-trial.ended`) so a normal end cancels the cutoff. **Must include the nudge step B2B-08 skipped — do not copy `partner-trial-cutoff` verbatim.**
- **Proactive heads-up:** extend the paid-wallet check to fire the recharge/upgrade heads-up ahead of exhaustion, reconciled with `checkLowBalanceAndAlert`'s `low_balance_alert_fired_at` one-shot so it does not double-send (AT-10).
- **Wallets kept separate:** test-mode `trial_exhausted` (`trial_minutes_used`/`test_minutes_balance`) is untouched; paid `balance_exhausted` governs live only (AT-Q-C-4).

### 3.2 Accuracy (Attendee-sourced)
- Capture Attendee `bot.state_change` `joined_recording` → `attendee_joined_at` and `ended`/`fatal_error` → `attendee_ended_at` on the `partner_sessions` row (webhook `handlePartnerSessionEvent`).
- Make `handleSessionEnd` bill `duration_minutes = (attendee_ended_at − attendee_joined_at)` when both are present, setting `billed_duration_source='attendee'`. Demote the client-reported `duration_minutes` and the `updated_at` wall-clock delta to fallbacks (`client_reported` / `wall_clock_fallback`), used only when Attendee timing is unavailable — and mark such sessions so the discrepancy is queryable (AT-11, AT-12).
- **Idempotency:** the existing `recordBillableEvent` idempotency index + `status in (completed,failed)` guard in `handlePartnerSessionEvent` ensure the wallet decrements once even if both end-paths fire (AT-13). No new double-count path introduced.

---

*End of Requirement Document. Q-A/Q-B/Q-C resolved by Arun; O-1/O-2 carry BA-recommended defaults for CEO confirmation. Ready for CEO review; on approval, no developer starts until CEO confirms O-1/O-2 (or accepts the recommended defaults).*
