# Feature Brief: B2B-19 — Partner-Supplied Inline Content, Transition Markers & Minute Enforcement

From: CEO (Arun)
To: Business Analyst Agent
Priority: P0 (this is the product spine — `CORE_OBJECTIVES.md` v3 Objective 2, steps 2–3 and the
per-minute billing enforcement of Objective 3; the single biggest divergence between stated scope and
the codebase per `docs/scope-gap-analysis-2026-07-17.md` §2a)
Date: 2026-07-17

> This brief resolves an architectural fork Arun walked through directly on 2026-07-17. It is large and
> deliberately names genuine open questions rather than guessing (Section 11 is NOT empty — see the note
> to the BA at the end). Three of those questions must go to Arun before build; the rest the BA resolves.

---

## What Arun Said

Arun resolved the §2a content-model fork from the gap analysis in direct conversation. Verbatim intent,
relayed through the Orchestrator:

1. **Two content-delivery options, both real; build Option 1 now, keep Option 2 dormant.**
   - **Option 1 (build now):** the partner supplies **URLs to their own HTML pages and/or images**
     (with configurable auth so Clio can fetch them), plus **a transition trigger per page**. Clio
     renders these live in its headless browser and advances through them as the bot progresses.
   - **Option 2 (already exists, keep, do NOT remove, no active development):** the partner supplies
     raw content and Clio's existing Designer/template system (B2B-03) generates the render. This stays
     exactly as-is, offered as a **disabled/unadvertised** choice. A later brainstorm defines its exact
     selectable scope. **Do not touch or redesign the Designer/template system in this brief.**

2. **Content-source auth — 5 types, 3 functional now:** (1) no auth / public URL, (2) static Bearer
   token / API key, (3) OAuth2 Client Credentials against the *partner's own* content server —
   **build these three**; (4) pre-signed/short-lived URL fetched just-in-time, (5) client certificate
   (mTLS) — **documented as enum values but rejected with a clear "not yet supported" error; do not
   build the fetch logic.**

3. **Explicit, non-negotiable instruction on where auth is configured:** *"i dont want them to select in
   our application. let it come in realtime through api. they can fill the api fields which are all
   applicable."* → **No portal / Configurator UI screen for choosing or entering content-source auth.**
   It is entirely API-driven. Arun explicitly invited a security recommendation: *"let me know if there
   are more secure ways to do it."*

4. **Transition mechanism:** driven by **server-side transcript-watching of the bot's own live speech**
   (the precedent already set when visualization-triggering was deliberately moved off Hume tool-calling
   to server-side transcript-watching — RTV series). Arun flagged the real risk himself and asked for it
   to be *"nailed down"*: if the partner's transition keyword is a common word/phrase, Hume may say it
   naturally during unrelated speech and false-trigger.

5. **Minute exhaustion + accuracy (verbatim):** *"internal counter is for the partner giving them a
   headsup to recharge or upgrade the plan or minutes. when their minutes are exhausted then they should
   not be able to trigger the voice bot anymore."* And: *"ensure that based on the session from attendee,
   we can fetch the meeting minutes used. we can also have a realtime counter just to ensure we are not
   exhausting the overall time available."* Arun confirmed the "real-time counter" is an **internal
   safety/heads-up mechanism, not a partner-facing live UI.**

---

## The Problem Being Solved

`CORE_OBJECTIVES.md` v3 Objective 2 describes the product spine: a partner passes their own pages/images
with per-page transition points, Clio's bot narrates them and advances the render as it goes, then
returns insights. The gap analysis (`docs/scope-gap-analysis-2026-07-17.md` §2a) found — and this brief's
own code audit **confirmed at the source** — that today's `POST /api/partner/v1/sessions` accepts only a
**content reference** into Clio's own 27-type template schema. A partner **cannot** hand Clio a raw HTML
page or image and have it rendered, and there is **no code path that reads a partner-supplied transition
point**. Separately, the per-minute billing that Objective 3 makes the entire commercial basis is **not
actually enforced** at true balance exhaustion for live sessions, and minute usage is **not derived from
Attendee's real session data**. This brief closes all three gaps.

---

## Current-State Findings (audited at source this session — the BA must build on these, not re-derive)

**A. Content contract (`app/api/partner/v1/sessions/route.ts` lines 20–31; `lib/partner/render-data.ts`
lines 74–99; `lib/partner/live-render.ts` lines 90–203):**
- The create-session body is `{ meeting_url, partner_topic_ref?, content_ref?, partner_end_user_ref?,
  partner_reference? }` with a refine requiring one of `partner_topic_ref`/`content_ref`. **No inline
  content, no page/image URLs, no transition markers.**
- At render time, `pullPartnerContent()` does `GET {outbound_base_url}/content?content_ref=…` (or
  `?partner_topic_ref=…`) with a single account-level `Authorization: Bearer <decrypted outbound
  token>` header. `extractSections()` then requires the payload to resolve to a **`TemplateSection[]`**
  (Clio's 27-type discriminated union). Anything else renders zero sections → `status: 'unavailable'`.
- **Note for the BA:** account-level auth type #2 (static Bearer) already exists in embryo here
  (`outbound_auth_token_ciphertext` + `Bearer` header). Option 1's content-source auth is a
  *generalization* of this to a per-content-source, multi-type mechanism — not a greenfield build.

**B. Transition mechanism today (`lib/voice/hume-native/prompt-template.ts` rules 3/5; RTV-02/03
briefs):**
- In the partner-render path, the bot **self-invokes `show_visual`/`advance_tab`** when it judges a
  section complete (prompt rules 3 and 5). These tool responses also carry the next teaching script, so
  they are load-bearing for content delivery, not just screen timing (see the HUME-NATIVE-02 note in
  `docs/b2b-pivot-status.md` — removing them silently breaks delivery).
- A **separate, more precise mechanism already exists in pattern**: RTV-02 (`lib/content/
  session-markers.ts`, `generateSessionMarkers()`) generates a per-topic **system-unique "golden word"
  marker set** (deterministic grouped-by-topic uniqueness + LLM noun/cannot-miss checks; bookends get
  literal `"overview"`/`"summary"` markers) stored on `sessions.session_markers`. RTV-03 runs a
  **forward-only, single-hit-decisive state machine** watching Clio's live `source:'ai'` speech stream to
  conclude which topic she is on. **RTV-03 is OBSERVE-ONLY and RTV-05 (the phase that makes it actually
  drive the display) is spec'd-but-unbuilt, gated 0/27 templates.** So transcript-watching exists and is
  proven in pattern, but **is not yet authoritative over any live screen in production.**
- The script-assembly injection point is `assembleHumeNativePrompt()` (`prompt-template.ts` line 306),
  called from `resolveLiveSessionRender()` (`live-render.ts` lines 130–147) — `sessionContent` is built
  by `sections.map(JSON.stringify).join('\n\n')`. This is the exact place a system-generated marker
  sentence would be woven into what the bot says.

**C. Secret-storage patterns (`lib/partner/api-keys.ts`, `lib/partner/oauth.ts`, `lib/partner/crypto.ts`):**
- **Verifiable** secrets Clio only needs to *check* incoming (its own API keys, its own OAuth client
  secrets) → **SHA-256 hash, one-way, never retrievable** (`hashApiKey`, `hashClientSecret`).
- **Retrievable** credentials Clio must *replay outward* to authenticate to someone else's server (the
  existing `outbound_auth_token_ciphertext`) → **AES-256-GCM, decryptable** (`encryptOutboundToken` /
  `decryptOutboundToken`, key from `PARTNER_OUTBOUND_TOKEN_ENCRYPTION_KEY`).
- **Decisive consequence:** content-source credentials (Bearer tokens, OAuth2 client secrets for the
  partner's server) are the *retrievable* kind — Clio must present them when fetching the partner's
  pages. They **must be encrypted with the AES-256-GCM pattern (mirror `encryptOutboundToken`), NOT
  hashed.** The BA must not accidentally follow the hashing precedent here.

**D. Minute enforcement (`app/api/partner/v1/sessions/route.ts` lines 82–164):**
- **Test mode** hard-blocks at `availableMinutes <= 0` (trial 20 + `test_minutes_balance`) → 402
  `trial_exhausted`. ✅ A hard block exists for test.
- **Live mode** checks **only** `partner_wallets.stripe_default_payment_method_id` is non-null → 402
  `funding_required`. It **does NOT check `balance_usd`.** A partner with a card on file but a **fully
  depleted wallet can still start unlimited live sessions.** ❌ This is the gap Arun named. Only the
  low-balance **email alert** (`checkLowBalanceAndAlert`, fired *after* a decrement) exists — an alert,
  not an enforcement.
- There is **no mid-session cutoff for the paid wallet.** `inngest/partner-trial-cutoff.ts` force-ends
  only **test-mode** sessions (triggered by `clio/partner-trial.started`). Live sessions have no
  equivalent burn-down/force-end.

**E. Minute accuracy (`app/api/partner/render/end-session/route.ts`; `lib/partner/live-render.ts`
`handleSessionEnd`; `app/api/attendee/webhook/route.ts` lines 372–393):**
- The authoritative end path takes `duration_minutes` **from the render page's client component** (the
  headless browser), validated only `0..600`. It is a **client-reported number.**
- The Attendee-webhook fallback computes `durationMinutes = (Date.now() - partner_sessions.updated_at) /
  60000` — a **server wall-clock delta off `updated_at`**, not Attendee's data.
- **Neither path derives minutes from Attendee's real bot join/leave timestamps or call duration**,
  even though the Attendee webhook already receives `bot.state_change` events (`joined_recording`,
  `ended`) that carry the authoritative timing. This is the accuracy gap Arun named: *"based on the
  session from attendee, we can fetch the meeting minutes used."*

---

## What Success Looks Like

1. A partner can `POST` a session that carries **their own HTML page and/or image URLs, multiple of
   them, in order, each with a transition trigger**, plus title/sub-title/content-to-explain, and have
   Clio's bot narrate them and **advance the render page/image at each transition point** driven by
   server-side detection of a **system-generated unique marker** in the bot's own speech — with **no
   false transitions** from common words.
2. Content-source auth is **entirely API-driven** (no portal screen), supports the **3 functional types**
   (none / static Bearer / OAuth2 client-credentials), and **cleanly rejects** the 2 documented-but-unbuilt
   types (pre-signed URL, mTLS) with an actionable error. Secrets are stored encrypted-and-retrievable,
   never resent in the clear on every call (see the two-step recommendation below).
3. **Option 2 (Designer/template content-reference sessions) keeps working byte-for-byte unchanged** —
   existing `content_ref`/`partner_topic_ref` sessions are fully backward compatible.
4. A live session **cannot start, and cannot continue, once the partner's paid minutes are truly
   exhausted** — a hard block at initiation and a mid-session force-end, both derived from a real balance,
   plus the existing proactive low-balance heads-up.
5. **Minutes billed equal minutes actually used, sourced from Attendee's own session data**, not a
   client-reported number or a wall-clock estimate.

---

## Requirement 1 — Inline Content Delivery + Content-Source Auth (API-driven, no portal)

### 1.1 New session content contract (additive, backward-compatible)
Introduce an **inline-content mode** on session initiation. The BA must trace the full current schema
(`app/api/partner/v1/sessions/route.ts` lines 20–31) and design the additions so that **every existing
`content_ref`/`partner_topic_ref` (Option 2) request keeps working unmodified** — the refine rule must
become "exactly one of {Option 1 inline content, Option 2 content reference} is present." Proposed shape
(BA to finalize field names/validation):
- `content_pages: [{ url, media_type: 'html' | 'image', title?, subtitle?, transition_trigger }]` — an
  **ordered** array; `transition_trigger` is the partner's intent marker for "advance to the next page
  after this one" (see Requirement 2 for how it is *interpreted*, not matched literally).
- `content_to_explain` / `title` / `subtitle` — the narration material Objective 2 step 2 names.
- `content_source_id` — reference to a pre-registered content source (see 1.2) supplying the auth Clio
  uses to fetch the page URLs.

### 1.2 Content-source registration — API-driven two-step (Orchestrator recommendation: EVALUATED and
ADOPTED, with one sub-decision flagged to Arun)

The Orchestrator recommended splitting auth into (a) a one-time registration call storing encrypted
credentials and returning an opaque `content_source_id`, and (b) session calls that reference that id
instead of resending secrets. **I have evaluated this as a genuine design option and adopt it as the
default, because:**
- It **honors Arun's explicit constraint** — a `POST /api/partner/v1/content-sources` call is still
  *"realtime through api, they fill the api fields which are all applicable,"* with **no portal screen**.
  Registration is an API endpoint, not a UI.
- It **reduces secret exposure** — the partner's Bearer token / OAuth2 client secret crosses the wire
  **once**, not on every session call, and is stored AES-256-GCM-encrypted (mirroring
  `encryptOutboundToken`, per Finding C). This directly answers Arun's *"more secure ways to do it."*
- It **mirrors three existing precedents** (`partner_api_keys`, `partner_oauth_clients`,
  `partner_accounts.outbound_auth_token_ciphertext`) so it is low-novelty, consistent code.

Proposed contract (BA to finalize): `POST /api/partner/v1/content-sources` with
`{ auth_type, ...fields applicable to that type }` → stores an encrypted credential row → returns
`{ content_source_id }` (opaque, non-secret). `auth_type` enum: `none | static_bearer |
oauth2_client_credentials | presigned_url | mtls`.

**Per-type field requirements (BA to specify validation for each):**
- `none` — no credential. **Sub-decision flagged to Arun (Q-A below):** for a purely public URL there is
  no secret to protect, so a `none` source could reasonably be passed **inline on the session call**
  without pre-registration. My recommendation: allow inline `none`, require registration for every
  secret-bearing type. This is a small UX-vs-uniformity call; I lean to the recommendation but surface it.
- `static_bearer` — a token/API key Clio sends as `Authorization: Bearer <token>` (or a
  configurable header name/scheme). Stored AES-256-GCM.
- `oauth2_client_credentials` — client_id + client_secret + token_url (+ optional scope/audience). Clio
  performs an RFC 6749 §4.4 client-credentials grant **against the partner's own token endpoint** to get
  a short-lived access token, caches it to its expiry, and presents it when fetching pages. **This is
  authenticating TO the partner (outbound), the mirror-image of `lib/partner/oauth.ts` which authenticates
  partners INTO Clio — the BA should read `oauth.ts` for the shape but must not reuse its
  Clio-as-issuer/JWT-signing logic; here Clio is a client, not the authorization server.** Client secret
  stored AES-256-GCM.
- `presigned_url` — **accepted as a valid enum value, documented in the API schema and Developer Portal
  Docs page, and REJECTED at runtime** with a clear, specific error (proposed code:
  `content_source_auth_type_not_supported`, message naming the type and that it is planned-not-built). Do
  **not** build the just-in-time fetch logic.
- `mtls` — **same treatment as `presigned_url`.** Documented enum, rejected with the same clear error. Do
  **not** build the client-certificate fetch logic.

### 1.3 Rendering inline content in the headless browser
The BA must trace `lib/partner/live-render.ts` + `app/partner-render/[clio_session_ref]` and design an
inline-content render path that fetches each page URL **using the resolved content-source credentials**
and displays HTML pages / images **as-is** in Clio's headless browser — **bypassing `extractSections()`
/ the 27-type `TemplateSection` schema entirely** (that schema is Option 2's path and must remain
untouched). This is a real new render branch, not a tweak. Security constraints in Section "Constraints"
below (SSRF, sanitization) are mandatory here.

---

## Requirement 2 — Transition Marker (system-generated unique marker, not the partner's literal keyword)

### 2.1 The mechanism (Orchestrator recommendation: EVALUATED and ADOPTED in principle; grounded in the
RTV precedent; one authority question flagged to Arun)

Arun's stated model and the Orchestrator's refinement align with a mechanism **that already exists in
pattern** (Finding B): do **not** watch for the partner's supplied `transition_trigger` as a literal
string (common-word false-trigger risk Arun named). Instead:
1. Treat the partner's `transition_trigger` as an **intent marker** — "advance after this page,
   semantically here."
2. Have Clio's **script-assembly process inject a system-generated, guaranteed-unique marker phrase** into
   the spoken script at that exact point (near-zero probability of occurring in natural speech).
3. Have the **server watch Clio's live speech for that system marker** (not the partner's raw input) and
   advance the page/image on a single decisive hit.

This is exactly the RTV-02 (unique-marker generation) + RTV-03 (forward-only, single-hit-decisive
transcript state machine) design, which is **built and proven in pattern** — I adopt it rather than
inventing a new one. The injection point is `assembleHumeNativePrompt()` / `resolveLiveSessionRender()`
(`live-render.ts` lines 130–147); the detection reuses RTV-03's `source:'ai'` live-speech listener shape.

**Secondary safety nets Arun/Orchestrator named — ADOPT, BA to spec exactly:**
- **Setup-time collision validation:** verify the partner's supplied `transition_trigger` label (and the
  system marker) does not collide with words appearing in the page content / narration, before the
  session is accepted as ready.
- **Cooldown/debounce:** ignore a duplicate detection within a short time window of a prior trigger.

### 2.2 The genuine open question this raises — FLAG TO ARUN (Q-B)
RTV-03's transcript-watching tracker is deliberately **OBSERVE-ONLY** in production and **RTV-05 (the
phase that lets it actually drive the screen) is unbuilt and gated 0/27 templates** — a deliberate
de-risking decision. Making the page advance in this new inline-content path **fire off a transcript
match** would make this **the first place server-side transcript-watching is authoritative over a live
screen in production.** That is a real change in posture that Arun de-risked on purpose elsewhere. The
alternative is to keep the existing **bot-self-invoked `show_visual`/`advance_tab`** advance (the bot
calls the tool when it finishes a page) and use the injected marker only as the *cue in the bot's own
instructions* for when to call that tool — no server-side transcript authority required. These are
materially different builds with different risk profiles. **The BA must not choose this unilaterally —
Q-B goes to Arun.** (My recommendation, for Arun to confirm: inject the unique marker AND drive the
advance from server-side detection of it, scoped narrowly to this new inline path, accepting that this
path becomes the first authoritative transcript-watcher — because the partner's pages are not Clio
template sections the bot "knows," so leaning on the bot to self-invoke `show_visual` for foreign content
is weaker than watching for a marker we deliberately planted. But this is Arun's posture call, not mine.)

### 2.3 Grounding the BA must use (do not re-derive)
`docs/brainstorm/ATTENDEE-HUME-ARCHITECTURE-brainstorm.md` and the HUME-NATIVE-02 references in
`docs/b2b-pivot-status.md` for the transcript-watching precedent and the load-bearing role of
`show_visual`/`advance_tab`; `lib/content/session-markers.ts` (RTV-02) for the unique-marker generation
algorithm to reuse/adapt; RTV-03 brief for the forward-only single-hit-decisive detection state machine;
`lib/voice/hume-native/prompt-template.ts` for the `assembleHumeNativePrompt` injection point and the
mandatory ~7,000-char voice-styling guardrail + `PROMPT_TEMPLATE_VERSION` bump discipline.

---

## Requirement 3 — Minute Exhaustion (hard stop) + Accuracy (Attendee-sourced)

### 3.1 Hard stop at true exhaustion — CONFIRMED GAP, must be closed
Per Finding D, live-mode initiation checks only for a payment method, **not** `balance_usd`. This brief
must:
- **At initiation** (`app/api/partner/v1/sessions/route.ts` live-mode branch, after the existing
  `funding_required` check): **hard-block a new live session when the partner's paid balance is exhausted**
  (proposed: `balance_usd <= 0`, or `< the minimum cost of one billable minute` at the effective rate),
  returning a clear 402 (proposed code `balance_exhausted`), and never calling `dispatchMeetingBot()`
  (zero vendor cost on a rejected dispatch — mirror the existing `funding_required` fail-closed pattern).
  Test-mode's `trial_exhausted` block stays exactly as-is (accounting for `trial_minutes_used` /
  `test_minutes_balance` separately per B2B-08 — do not conflate the two wallets).
- **Mid-session** (generalize `inngest/partner-trial-cutoff.ts` from test-only to the paid wallet): a
  background burn-down/force-end so a single long session cannot overshoot the balance. Note the real
  subtlety the BA must handle: **the wallet is only decremented at session END today**
  (`handleSessionEnd` → `recordBillableEvent` → `applyWalletDecrement`), so mid-session there is no
  running decrement — the job must compute **affordable minutes = balance_usd ÷ effective voice-minute
  rate** at dispatch, and force a clean bot-leave at that boundary (reusing the trial-cutoff job's
  `deleteBot` + mark-completed + `recordBillableEvent` shape). This is Arun's *"realtime counter just to
  ensure we are not exhausting the overall time available"* — internal, not partner-facing.
- **Heads-up:** the proactive low-balance alert already exists (`checkLowBalanceAndAlert`,
  `low_balance_alert_fired_at`) but only fires reactively *after* a post-session decrement. Arun wants the
  heads-up to be proactive. Direction: a background check (extend the B2B-08 Inngest cutoff-job pattern to
  the general paid wallet) that fires the recharge/upgrade heads-up ahead of exhaustion, distinct from the
  hard stop. BA to reconcile with the existing alert so it does not double-send.

### 3.2 Accuracy — minutes must come from Attendee, CONFIRMED GAP
Per Finding E, neither end path uses Attendee's real data. This brief must make **Attendee's own session
data (bot join → leave timestamps / call duration) the source of truth for billed minutes.** The BA must:
- Trace the Attendee webhook (`app/api/attendee/webhook/route.ts`) and confirm exactly which
  event/field carries authoritative duration (the `bot.state_change` `joined_recording` → `ended`
  timestamps, and/or any Attendee-provided duration/recording field), and whether an Attendee API
  read-back is needed for a value the webhook doesn't carry.
- Make `handleSessionEnd` bill the **Attendee-derived** duration, demoting the client-reported
  `duration_minutes` and the `updated_at` wall-clock delta to at most a fallback when Attendee data is
  genuinely unavailable (and mark such fallback-billed sessions so the discrepancy is queryable).
- Preserve idempotency: billing must not double-count if both the client end-path and the
  Attendee-webhook fallback fire for the same session (the existing `recordBillableEvent` idempotency
  index + the `status === 'completed'/'failed'` guard in `handlePartnerSessionEvent` are the anchors).

---

## Known Constraints (do not deviate)
- **Do not touch or redesign the Designer/template system (Option 2).** It stays as an existing,
  disabled/unadvertised alternative. Its content-reference session path
  (`content_ref`/`partner_topic_ref` → `extractSections` → `TemplateSection[]`) must keep working
  byte-for-byte. Do not modify `lib/templates/*` or the 27-type schema in this brief.
- **No portal / Configurator UI for content-source auth.** API-only, per Arun's explicit instruction.
  (The Developer Portal **Docs** page documenting the API contract and the 5 `auth_type` values is not a
  configuration UI and is in scope to update.)
- **Do not build the pre-signed-URL or mTLS fetch mechanisms.** Documented enum values, rejected at
  runtime with a clear error. Nothing more.
- **Content-source credentials are stored encrypted-and-retrievable (AES-256-GCM, mirror
  `encryptOutboundToken`), never hashed.** (Finding C — do not follow the `hashApiKey` precedent here.)
- **SSRF / untrusted-fetch discipline (mandatory, Requirement 1.3):** partner page URLs are
  partner-controlled inputs Clio's server fetches. The BA must spec URL validation (scheme allowlist,
  block internal/link-local/metadata addresses), size/time limits, and safe rendering of fetched HTML in
  the headless browser. This is the one place this brief touches CLAUDE.md's "never fetch from
  dynamically constructed endpoints" rule — it must be handled as a deliberate, guarded exception with
  the partner as a semi-trusted, authenticated source, not waved through.
- **Non-Negotiable Data Boundary** (`CORE_OBJECTIVES.md`): partner page content and end-user transcript
  content are computed-on / narrated, **not persisted** as system-of-record. Do not add storage of
  partner page bodies or end-user transcript text beyond what the existing de-identified
  quality-improvement retention already permits.
- **Backward compatibility is a hard acceptance test**, not a nice-to-have: an existing Option 2 partner
  integration must be provably unaffected.
- Approved libraries only; all new API inputs Zod-validated; `PROMPT_TEMPLATE_VERSION` bumped on any
  template edit with the ~7,000-char voice-styling guardrail re-verified; `PLACEHOLDER_` env values for
  any new secrets (e.g. a content-source encryption key if not reusing
  `PARTNER_OUTBOUND_TOKEN_ENCRYPTION_KEY`).

---

## Questions for BA (Section 11 of the Requirement Document)

The BA resolves questions 1–7 through code tracing and documents them. **Questions A, B, C are genuine
product/posture calls the BA must NOT resolve unilaterally — route them to Arun (via the CEO Agent,
noting the known relay limitation) before the spec is considered complete.** This brief deliberately does
not require a zero-open-question spec at hand-off; A/B/C must be closed by Arun first.

**To Arun (escalate):**
- **Q-A — Inline `none` sources:** may a public (`auth_type: none`) content source be passed **inline** on
  the session call without pre-registration, while every secret-bearing type must be pre-registered? (CEO
  recommendation: yes. Low-stakes; included for completeness.)
- **Q-B — Transcript-watching authority (the important one):** does the page advance in this inline path
  fire from **server-side detection of the injected unique marker** (making this the first place
  transcript-watching is authoritative over a live screen in prod, ahead of the deliberately-deferred
  RTV-05), or does it stay on **bot-self-invoked `show_visual`/`advance_tab`** with the marker only cueing
  the bot's own tool call? (CEO recommendation in §2.2: server-side detection, scoped to this path —
  but this is Arun's de-risking posture call.)
- **Q-C — Exhaustion threshold & mid-session behavior:** confirm the hard-stop threshold (`balance_usd
  <= 0` vs. "< cost of one more minute") and that a mid-session force-end (clean bot-leave at the
  affordable-minutes boundary) is desired, versus initiation-only blocking. (CEO recommendation: both
  initiation block and mid-session force-end, threshold = cannot afford one more billable minute.)

**To BA (resolve via tracing, document fully):**
1. **Session content contract** — exact additive schema, the revised refine rule, and the
   provable-backward-compatibility acceptance test for existing Option 2 sessions.
2. **Content-source registration** — `POST /api/partner/v1/content-sources` full contract, per-`auth_type`
   field validation, the AES-256-GCM storage row (new table vs. column; encryption-key source), the
   `content_source_id` opacity, and the exact rejection error for `presigned_url`/`mtls`.
3. **OAuth2 client-credentials outbound flow** — token acquisition against the partner's token_url, token
   caching/expiry, and error handling when the partner's token endpoint fails (must degrade to a defined
   session status, never crash the render — mirror `pullPartnerContent`'s `unavailable` discipline).
4. **Inline render path** — how HTML/image URLs are fetched with resolved credentials and rendered in the
   headless browser bypassing `TemplateSection`, plus the full SSRF/sanitization spec.
5. **Marker generation + injection + detection** — reuse/adapt `session-markers.ts`; exact injection into
   `assembleHumeNativePrompt`; the detection state machine (forward-only, single-hit-decisive, cooldown);
   the setup-time collision validation; `PROMPT_TEMPLATE_VERSION` bump + guardrail proof.
6. **Minute enforcement** — the initiation hard-block (both wallets kept separate), the generalized
   paid-wallet mid-session force-end job, and reconciliation with the existing low-balance alert so the
   proactive heads-up doesn't double-fire.
7. **Attendee-sourced accuracy** — the exact Attendee field/event that is authoritative for duration,
   the demotion of client/`updated_at` values to guarded fallback, and idempotency across the
   client-end and webhook-fallback paths.

---

## Process
Write the full 12-section Requirement Document with wireframes/examples for the API contracts (request
and response bodies for `POST /api/partner/v1/content-sources` and the extended
`POST /api/partner/v1/sessions`, including the rejection responses), acceptance tests (with the
backward-compatibility test and the SSRF-rejection tests explicit), and edge cases. **Section 11 must
carry Q-A/Q-B/Q-C until Arun answers them; every other question must be resolved and closed in the doc.**
Return to CEO for review; CEO carries Q-A/Q-B/Q-C to Arun. No developer starts until Arun has answered
A/B/C and the CEO has approved the completed spec. Suggested id:
`B2B-19-inline-content-delivery-transition-and-minute-enforcement`.

---

## ID-assignment note (2026-07-17)
Originally drafted as B2B-17. A three-way ID collision occurred with two parallel briefs. Per this
project's established tie-break rule ("whichever claims an ID second renumbers"), ordered by file
birth time: `B2B-17-glitch-log-to-issue-tracker` claimed first (keeps B2B-17),
`B2B-17-retire-b2c-signup-chain-and-deadlink-cleanup` claimed second (→ B2B-18), and this brief claimed
third/last (→ B2B-19). This brief renumbered itself because it was the last claimant, not the first.
