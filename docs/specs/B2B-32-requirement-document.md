# B2B-32 — Internal Content Test Harness (`test.hello-clio.com`) — Requirement Document
Version: 1.1
Status: DRAFT — pending CEO review
Author: Business Analyst Agent
Date: 2026-07-21
Source brief: `.claude/agents/clio/feature-briefs/B2B-32-internal-content-test-harness-subdomain.md`

> **Revision note (v1.1, 2026-07-21).** v1.0 left Section 11 with two open questions (data retention,
> dispatch UX). Arun answered both directly the same day. This revision closes Section 11 (now empty)
> and revises every section that depended on those answers — see §0 points 9/10 for the resolutions
> verbatim, and §4 Screen C / §6 / §7-10 for what changed as a result. No other section's decisions
> changed.

> Scope in one line: a new, Arun-only surface at **`test.hello-clio.com`** — three authoring screens
> (Topics list, Screen authoring per topic, Payload review/dispatch) gated by **HTTP Basic Auth** at
> the middleware layer — where Arun hand-authors a "test topic" (title/subtitle/body) plus an ordered
> list of **screens**, each either raw pasted **HTML** or an uploaded **image**, explicitly **Save**-button
> persisted (no autosave, indefinite retention, editing overwrites the latest entry — Arun's own
> confirmed instruction, §0 points 9/11), and assembles a real, schema-valid
> `POST /api/partner/v1/sessions` inline-content payload against the **actual, unmodified B2B-19
> pipeline** — no mock, no parallel API. From the payload screen Arun can **both** fire a real session
> in-tool (a "Dispatch now" button collecting `meeting_url` and calling the real endpoint server-side,
> with live status/error surfacing) **and** download a ready-to-import Postman collection for firing it
> manually instead — both ship together, per Arun's explicit confirmation (§0 point 10). Screens are
> served from a new **public, unauthenticated** route (`/test-harness-render/[screenId]`, mirroring
> `/partner-render/*` and `/showcase-render/*` exactly) so the real
> `safeFetchPartnerPage`/`resolveInlineSessionRender` code the bot actually uses can fetch them — the
> render route is deliberately outside the Basic-Auth boundary; only the three authoring screens and
> their APIs are gated. Two new tables (`test_harness_topics`/`test_harness_screens`), fully isolated
> from every partner-facing content table. One new dedicated `partner_accounts` row (a real, direct
> `partner`-kind account, not `channel_partner`) owns the `partner_content_sources` row and the real
> partner API key the harness dispatches with — this is a one-time infra/provisioning step, not new
> product code, and is what makes "real API, real pipeline" actually possible (a `channel_partner`-kind
> account, which is what B2B-31's Showcase runs under, cannot generate a Configurator API key at all —
> traced and confirmed against `lib/partner/auth.ts`/B2B-26, see §0 point 7). All eight of the CEO
> brief's questions are now resolved as concrete decisions (§0) — the two that were genuinely
> product-ambiguous (retention, dispatch UX) were answered directly by Arun on 2026-07-21 and are
> recorded in §0 points 9/10; Section 11 is empty.

---

## 0. Naming & Technical Decisions (read first — governs every section below)

The CEO brief asked 8 questions. Six are resolved here as technical decisions (none touch product
shape — what the tool does, who can reach it, what it produces — so none are escalated). Two
(retention, dispatch UX) were genuine product-ambiguity the BA could not safely infer from Arun's own
words in the original CEO brief — both were escalated and Arun answered directly on 2026-07-21; his
answers are recorded verbatim as points 9 and 10 below, as **settled requirements**, not
recommendations. Section 11 is therefore empty.

| # | CEO brief question | Resolution |
|---|---|---|
| 1 | Minimal data model — new tables or reuse B2B-19 infra in "test mode"? | **Two new tables**, `test_harness_topics` and `test_harness_screens` (§6.0) — not a reuse of `partner_content_sources`/`content_pages` in a "test mode" flag, because those tables are partner-account-scoped production infrastructure and Known Constraint 2/3 both push toward total isolation from any partner-facing table (the same reasoning B2B-31 §0 point 3 used for its own three new tables). The harness's own tables hold the **authoring** state (title/subtitle/body, per-screen HTML or image); at **dispatch time**, the harness reads this state and calls the **real, unmodified** `POST /api/partner/v1/content-sources` and assembles a `POST /api/partner/v1/sessions` body against the real `CreateSessionSchema` — so the actual B2B-19 tables (`partner_content_sources`, `partner_sessions`) still end up holding exactly what a real partner integration's rows would hold. Reuse is at the **API-contract boundary**, not the **authoring-storage boundary**. Supports **multiple** topics (a list, not a single fixed row) — Arun's message describes one topic but nothing forbids more, and a test harness that can only ever hold one fixture at a time is a worse regression tool for no benefit; this is a low-cost, strictly-more-useful technical choice, not a product-shape change. |
| 2 | How are hand-pasted HTML screens served so the bot's real headless fetch (`safeFetchPartnerPage`) can load them as a URL? | A new **public, unauthenticated** route `GET /test-harness-render/[screenId]` (§6.5) — directly parallel to `/partner-render/[clio_session_ref]` and B2B-31's own `/showcase-render/[id]`, both already public/no-Clerk-session precedent in this codebase. It returns the screen's raw HTML bytes with `Content-Type: text/html; charset=utf-8` (or the image bytes with the correct `image/*` type). This is the **only** way the real pipeline can reach it: `resolveInlineSessionRender()` → `safeFetchPartnerPage()` (`lib/partner/ssrf.ts`) performs a genuine server-side HTTPS fetch against whatever URL is stored in `content_pages[].url` — it has no awareness of this brief and cannot be taught to bypass an auth wall, so the URL must be truly public. This route is **not** on the `test.hello-clio.com` host and is **not** behind the Basic-Auth gate (§0 point 5) — it lives on the main app origin exactly like `/partner-render/*` and `/showcase-render/*` already do, added to `middleware.ts`'s `isPublicRoute` list (§6.6). Confirmed against real code: `lib/partner/live-render.ts`'s `resolveInlineSessionRender()` already fetches each `content_pages[].url` via `safeFetchPartnerPage()` and expects raw HTML/image bytes back — this route satisfies that contract exactly, unmodified. |
| 3 | Where do uploaded images get stored; what constraints? | **Supabase Storage**, a new private bucket `test-harness-screens` (service-role access only, no public bucket policy) — not a `bytea`/base64 Postgres column. Traced: no existing code in this repo uses Supabase Storage today (`grep` for `.storage.from` returns nothing), but it is the correct tool here regardless of precedent — images up to the size cap below, held in a Postgres `bytea`/text column, would double in size over PostgREST's JSON/hex encoding on every read, and `@supabase/supabase-js` (already approved, already the SDK used everywhere else in this codebase) includes Storage as a first-class client, not a new vendor. The render route (§0 point 2) downloads the bytes server-side via the admin client and streams them back with the correct `Content-Type` — the bucket itself is never exposed as a public/signed URL, keeping "one URL format, one auth boundary" for every screen type. **Constraints:** max 10 MB per image (matches B2B-19's own `safeFetchPartnerPage` image-size ceiling, `lib/partner/ssrf.ts` `MAX_IMAGE_BYTES` — no point accepting an upload the real fetch pipeline would reject anyway), allowed types `image/png`, `image/jpeg`, `image/gif`, `image/webp`, validated by sniffing the actual file's magic bytes server-side (not trusting the client-supplied `Content-Type` header alone). Pasted HTML is capped at 500 KB (generous for hand-authored fixtures, far under B2B-19's 5 MB HTML fetch ceiling). |
| 4 | Exact routing/middleware mechanism for `test.hello-clio.com` — static Host-header check, or B2B-05's dynamic machinery? | **Static Host-header check, confirmed against real code — B2B-05's dynamic machinery is not needed and must not be reused.** Traced `middleware.ts` + `lib/partner/domain-resolution.ts`: B2B-05's `isTenantHost`/`resolveTenantFromHost()` logic matches any host ending in `.${CLIO_ROOT_DOMAIN}` and looks it up as a `partner_accounts.subdomain_slug` — **`test` is not a partner's slug**, so without a fix this host would incorrectly fall into B2B-05's tenant-resolution branch, find no matching account, and hit `neutralNotFoundResponse()` (a 404) before ever reaching this brief's own routes. The fix is a **new, earlier special-case branch** in `middleware.ts` (§6.6): if `host === TEST_HARNESS_HOST` (a new plain, non-secret env var, real default `test.hello-clio.com` — not a `PLACEHOLDER_`, mirroring `CLIO_ROOT_DOMAIN`'s own convention), handle it entirely separately, **before** the `isTenantHost` check, and `return` early so B2B-05's branch never runs for this host. No `subdomain_slug` row, no Vercel Domains API call, no `custom_domain` column — none of B2B-05's per-partner provisioning applies, because this is one fixed internal host, not a dynamic per-tenant one. **Dependency, not a blocker:** `test.hello-clio.com` only resolves in production once `*.{CLIO_ROOT_DOMAIN}` wildcard domain provisioning has actually happened against Clio's Vercel project — confirmed via `docs/specs/B2B-05-requirement-document.md` §12, which documents this as a "one-time infra action... tracked... not a code deliverable," not guaranteed done. If it's already live (any working `*.hello-clio.com` subdomain today confirms this), `test.hello-clio.com` needs zero additional DNS/Vercel work — it already routes to the same Next.js deployment; only the code below is needed. |
| 5 | Simplest appropriate access-control mechanism (single-user, internal)? | **HTTP Basic Auth**, checked inside the new middleware branch (§0 point 4) against two new env vars, `TEST_HARNESS_BASIC_AUTH_USER` / `TEST_HARNESS_BASIC_AUTH_PASSWORD` (`PLACEHOLDER_`-conventioned, real secret set only in Vercel's env config, never committed) — constant-time compared. **Trade-off explicitly noted (per Known Constraint 6):** this is deliberately lighter than B2B-31's Clerk-allowlist pattern (`showcase_access_enabled` column + `requireShowcaseAccess()`), because that pattern exists to gate one tab *inside* an already-Clerk-authenticated, already-multi-admin-capable partner dashboard — machinery this brief has no use for, since `test.hello-clio.com` has no partner account, no admin-invite concept, and exactly one intended user. Basic Auth is proportionate: zero new DB rows, zero new Clerk session, native browser-prompt UX, trivially rotated by changing one env var, and — unlike a shared-secret query param — the credential never lands in browser history, server access logs, or a `Referer` header. It gates only `/test-harness*` page routes and `/api/test-harness/*` routes (§6.6) — never the public render route (§0 point 2), which must stay reachable by the bot's own unauthenticated server-side fetch. |
| 6 | Exact HTML-rendering-safety mechanism for pasted screens? | **Structural isolation, two independent layers — not a sanitization library.** Sanitization (stripping "dangerous" tags/attributes) is the wrong tool here: Arun's own stated purpose is pasting *working* HTML/JS visualization screens and confirming they render correctly — stripping `<script>` would break the very thing being tested. Isolation is correct instead, and this codebase already has a proven precedent for exactly this shape of problem (B2B-19 Known Constraint/Section 6.4: partner-supplied HTML is untrusted-but-must-execute, isolated not stripped). Two layers, both new code for this brief, neither touching CLAUDE.md's `dangerouslySetInnerHTML` rule: **(a) Authoring-side live preview** (Screen B, §4) renders the pasted HTML inside a sandboxed `<iframe srcDoc={html} sandbox="allow-scripts">` — no `allow-same-origin`, no `allow-top-navigation`, no `allow-forms` — never injected via `dangerouslySetInnerHTML` into the authoring page's own DOM. **(b) The public render route** (§0 point 2) additionally sets a `Content-Security-Policy: sandbox allow-scripts` response header on every HTML response — this makes the browser treat that top-level document load as running in a unique opaque origin (no cookies, no storage, no reading the parent app's session), a second, independent layer beyond the authoring-preview iframe, active regardless of how the URL is loaded (by Arun's own browser, or by the bot's render client, which per B2B-19's own code already wraps fetched inline-content HTML in a sandboxed iframe on its side too — this brief changes nothing about that, already-built, Known Constraint 3). |
| 7 | Confirm the dispatch path actually works end-to-end given real account/API-key infrastructure. | **Not one of the CEO brief's 8 questions verbatim, but a gap the brief's own approach silently assumed away — resolved here rather than left to surface at build time.** `POST /api/partner/v1/sessions` requires `requirePartnerApiKey()` (a real, hashed partner API key tied to one `partner_accounts.id`), and `content_source_id` must resolve to a `partner_content_sources` row **owned by that same account** (B2B-19 §4.B State B2, tenant check). Traced `app/api/admin/partner-keys/route.ts`: key issuance requires `requirePartnerAdmin(partner_account_id)` — a **Clerk-authenticated**, account-kind-agnostic check (unlike `requireChannelPartnerAdmin`, which is `channel_partner`-only and explicitly has **no** Configurator/API-key access per B2B-26 §6.14 — meaning Arun's existing B2B-31 demo `channel_partner` account **cannot** be reused here). **Resolution:** the Orchestrator creates **one new, dedicated `partner_accounts` row** (`account_kind = 'partner'`, direct partner, label `"Clio Internal — Test Harness"`) as a one-time infra step (direct SQL insert, mirroring B2B-31 §0 point 1's own "Orchestrator SQL, not a UI action" precedent), adds Arun's existing Clerk user id to `partner_admin_users` for that account (same mechanism as any partner admin), and Arun (or the Orchestrator, once) calls the existing `POST /api/admin/partner-keys` endpoint to mint a real API key for it. The resulting `partner_account_id` is recorded in a new env var, `TEST_HARNESS_PARTNER_ACCOUNT_ID` (`PLACEHOLDER_` until the Orchestrator completes this step), which every `test_harness_topics` row and the content-source-registration call (§6.4) is scoped to. This is infrastructure provisioning, not a code deliverable of this brief (§12 Dependencies) — but it is the fact that makes "assemble a payload against the real API, then really fire it" possible at all, so it is resolved here rather than discovered as a blocker mid-build. **Key mode — revised in v1.1:** v1.0 minted this key with `mode: 'live'`; now that §0 point 10 wires up a real **in-tool** dispatch button Arun will click repeatedly while iterating on fixtures (not a rare, deliberate manual Postman fire), `mode: 'test'` is the correct choice instead — it bills against the harness account's trial/test-minutes balance (B2B-08's `trial_minutes_used`/`test_minutes_balance`, never a real paid `balance_usd`), so repeated iteration during development never touches real wallet funds, while still exercising the identical dispatch/render/transition code paths a live session would (test mode does not change `resolveInlineSessionRender`, `safeFetchPartnerPage`, or the transition-marker mechanism — only the billing/enforcement wallet it's checked against, B2B-19 Req 3.1/Edge Case 13). §6.1's provisioning SQL/API call is updated accordingly. |
| 8 | Default per-screen `transition_trigger` / marker semantics | Not delegated by the CEO brief, included here for completeness against B2B-19's real contract: `test_harness_screens.transition_trigger` stores exactly the **intent-text** field `ContentPageSchema.transition_trigger` expects (a free-text string describing *when* to move on, e.g. `"move on once the chart has been introduced"`) — never a literal marker. The actual unique `transition_marker` (e.g. `"kestrel-vellum-9471"`) is generated by the real pipeline itself, server-side, at session-dispatch time (B2B-19 Req 2.1, `generateSessionMarkers()`) — this brief never generates, stores, or displays one; it is entirely internal to the real dispatch call and correctly opaque to this tool, exactly as it is to any real partner integration. |
| 9 | **Data retention (CEO brief Q7) — RESOLVED by Arun, 2026-07-21.** | Arun's own words: *"we can persist with the last entry. have a save button."* **Settled as a requirement, not a default:** every topic and screen persists **indefinitely** — no auto-expiry, no cleanup cron, exactly the "assume no auto-expiry by default" behavior v1.0 already built pending confirmation (§4 Screen A's manual-delete-only design was already correct and needs no functional change). "The last entry" + "a save button" together settle a second, previously-underspecified point: every save action in this tool is an **explicit, button-triggered** save — never autosave-on-keystroke — and a save **overwrites** the row in place (the latest entry is what persists; this is not a versioned-history feature, consistent with §10's existing "no version history" scoping). This resolves not just *whether* things persist, but *how* edits are committed. Concretely: the topic form (§4 Screen B top block) already used an explicit "Save" button in v1.0 — confirmed as final, and now explicitly specified to use the same **dirty-state gating** as `ShowcaseContentClient.tsx` (Save disabled while the current values match the last-saved values, or while a save is in flight; re-enabled the instant any field changes; inline `"Saved."` flash for ~1.5s on success). v1.1 additionally makes existing screens (not just newly-added ones) **editable in place** via the same explicit-Save + dirty-state pattern, so "persist with the last entry" applies uniformly to every piece of authored content, not only first-creation (§4 Screen B, revised). |
| 10 | **Dispatch UX (CEO brief Q8) — RESOLVED by Arun, 2026-07-21, and it is BOTH options, not either/or.** | Arun's own words: *"we can fire real api session. also enable a option to download the collection to trigger through postman."* **Settled as a requirement:** Screen C ships **two** independent actions, both required, neither optional: **(a) In-tool "Dispatch now"** — collects `meeting_url` inline, calls the real `POST /api/partner/v1/sessions` **server-side** (a new route, `POST /api/test-harness/dispatch/[topicId]`, using the harness's own real partner API key held server-side — the browser never sees or handles the raw key), and surfaces the real response (success: `clio_session_ref`/`render_url`; failure: the real error code/message verbatim) live in the UI. **(b) "Download Postman collection"** — generates a Postman v2.1 collection JSON file (pre-populated with the real endpoint URL and the currently-assembled payload as the request body) and triggers a browser download, so Arun can fire the identical real session manually outside the tool whenever he prefers that path. Full detail, wireframes, and the exact collection JSON shape: §4 Screen C (revised), §6.8-6.9, §10. |

---

## 1. Purpose

Verifying that the real partner content-delivery pipeline (B2B-19: partner supplies title/subtitle/
content + an ordered set of visualization "screens" with transition triggers → Clio's API assembles a
session payload → the bot renders and narrates through the screens live, advancing on a dual-signal
transition marker) works correctly today requires either screen-sharing raw JSON in
`PlaygroundClient.tsx`, or hand-assembling a `content_pages` payload from scratch with no way to author
or preview a screen before dispatching a real meeting bot against it — and every test today is
contaminated by AI-content variability, since there is no deterministic, hand-authored fixture path.
This tool gives Arun a private, subdomain-isolated place to type a title/subtitle/body, author several
screens as raw HTML or an uploaded image, and get back the exact real payload shape the real endpoint
accepts — with a working, fetchable URL per screen — so he can fire a real session and watch the bot
render and transition through fixtures he wrote himself, independent of any LLM output.

**Failure without this:** there is no repeatable, deterministic way to regression-test the B2B-19
content-delivery contract (URL fetching, transition-marker triggering, HTML-vs-image rendering)
independent of AI-content variability — every check today is either ad hoc or confounded by generation
quality, and a real pipeline regression could ship undetected until a real partner integration breaks.

---

## 2. User Story

As Arun,
I want to type a title, subtitle, and body of narration material for a "test topic," and author several
screens for it — some as raw HTML I write or paste myself, at least one as an uploaded image,
So that I have deterministic, hand-authored fixtures with no AI generation step anywhere in the chain.

As Arun,
I want the tool to assemble those screens into the exact, real `POST /api/partner/v1/sessions` payload
shape (the same `content_pages` contract any real partner integration uses),
So that firing it is a genuine end-to-end test of the real pipeline, not a parallel/mock one.

As Arun,
I want to either fire the real session right from the tool with one click, or download a ready-to-use
Postman collection for the same payload,
So that I can test quickly in-tool while iterating, or drop into Postman when I want more manual
control — without ever hand-assembling the request either way.

As Arun,
I want this entire surface to live on its own subdomain, reachable only by me, never linked from or
reachable through the partner-facing dashboard or `hello-clio.com`'s own marketing/product surfaces,
So that no real partner or unauthenticated visitor can ever stumble onto or be confused by my own
internal testing tool.

---

## 3. Trigger / Entry Point

| # | Trigger | Route / mechanism | Auth | State required |
|---|---|---|---|---|
| E-1 | Arun visits the harness | `GET https://test.hello-clio.com/` | Host-match (§0 pt 4) + HTTP Basic Auth (§0 pt 5) | Correct Basic Auth credentials |
| E-2 | Middleware rewrites root | `/` → `/test-harness` (internal rewrite, §6.6) | same | — |
| E-3 | Arun creates or opens a topic | `GET /test-harness` (Screen A) → click a topic or "New topic" | Basic Auth (already passed at E-1) | — |
| E-4 | Arun saves topic title/subtitle/body | `POST /api/test-harness/topics` (create) or `PATCH /api/test-harness/topics/[topicId]` (edit) | Basic Auth | On Screen A |
| E-5 | Arun opens a topic's screens | `GET /test-harness/topics/[topicId]` (Screen B) | Basic Auth | Topic exists |
| E-6 | Arun adds an HTML screen | `POST /api/test-harness/screens` (`screen_type: 'html'`, `html_content`) | Basic Auth | On Screen B |
| E-7 | Arun adds an image screen | `POST /api/test-harness/screens` (`screen_type: 'image'`, multipart file) | Basic Auth | On Screen B |
| E-8 | Arun opens the payload screen | `GET /test-harness/topics/[topicId]/payload` (Screen C) | Basic Auth | Topic has ≥1 screen |
| E-9 | Payload screen assembles + registers | `GET /api/test-harness/payload/[topicId]` — lazily calls the real `POST /api/partner/v1/content-sources` once per topic (§6.4) | Basic Auth (this call); the inner content-source call uses the harness's own real partner API key server-side, not Arun's browser session | — |
| E-10a | Arun dispatches a real session in-tool | Arun types a `meeting_url` on Screen C and clicks `"Dispatch now"` → `POST /api/test-harness/dispatch/[topicId]` (new, §6.4/§6.8) → the route itself calls the real `POST /api/partner/v1/sessions` server-side, using the harness's own real partner API key held server-side | Basic Auth (the browser→harness call); the inner real-session call uses the harness's own API key resolved server-side, never exposed to the browser | Payload fully assembled; `meeting_url` filled in and valid |
| E-10b | Arun downloads a Postman collection instead | Arun clicks `"Download Postman collection"` on Screen C — generated **client-side** (§0 point 10, §6.9) from the already-loaded payload state, no new route, triggers a browser file download | Basic Auth (page load only — generation itself is client-side JS, no additional call) | Payload fully assembled |
| E-11 | The bot's headless render fetches a screen | `GET /test-harness-render/[screenId]` — the real `safeFetchPartnerPage()` inside `resolveInlineSessionRender()` | **None — public** (§0 pt 2) | Screen exists |
| E-12 | Anyone hits `/test-harness*` on a host that is not `test.hello-clio.com` | Any host | — | Always 404 (`neutralNotFoundResponse`, §6.6) — Known Constraint 2 |

---

## 4. Screen / Flow Description

### Screen A — `/test-harness` — Topics list

On load, `GET /api/test-harness/topics` fetches every existing topic (id, title, screen count,
`updated_at`).

- Page heading: `"Test Content Harness"` (large, bold, white text on a dark background — no design
  system exists yet for this internal tool per CLAUDE.md's current state, so this brief uses simple,
  legible defaults: `#0a0a0a` background, white text, system-ui font stack, matching the plain
  utilitarian style already used for `/showcase-render`'s own `NotFoundMessage` — not the partner-facing
  Configurator's visual language, since this is explicitly not a partner-facing surface).
- Sub-line: `"Hand-authored fixtures for testing the real B2B-19 content pipeline. Nothing here is
  AI-generated."`
- A list of existing topics, each row showing: title (or `"(untitled topic)"` if blank), a count —
  `"3 screens"` / `"0 screens"` — and `updated_at` formatted as a relative time (`"2 hours ago"`). Each
  row is a link to `/test-harness/topics/[topicId]`.
- If no topics exist yet: `"No test topics yet."` in place of the list.
- A single button, top-right: `"+ New topic"` — clicking it calls `POST /api/test-harness/topics` with
  empty fields, then navigates to the new topic's `/test-harness/topics/[topicId]` (Screen B) — the
  title/subtitle/body form lives on Screen B itself (not a separate creation modal), pre-filled empty.
- Each row also has a small `"Delete"` text link (confirms via a native `window.confirm` — no custom
  modal needed for a single-user tool) that calls `DELETE /api/test-harness/topics/[topicId]`, removing
  the topic and cascading its screens — the **only** way a topic is ever removed (§0 point 9: retention
  is indefinite with no auto-expiry/cleanup cron, confirmed by Arun; this manual delete is the sole
  removal path, unchanged from v1.0).

### Screen B — `/test-harness/topics/[topicId]` — Topic + Screen authoring

`GET /api/test-harness/topics/[topicId]` on mount, returning the topic's fields plus its ordered list of
screens.

**Top block — Topic fields:**
- Label `"Title"`, text input, `maxLength={200}`, e.g. `"Q3 AI Strategy Briefing"`.
- Label `"Subtitle"`, text input, `maxLength={300}`, e.g. `"A test of HTML + image screen rendering"`.
- Label `"Content to explain"` (narration material — maps directly to the real API's
  `content_to_explain`), multi-line textarea (`rows={6}`), `maxLength={5000}` (matches
  `CreateSessionSchema.content_to_explain`'s own cap, so nothing typed here can fail that schema
  downstream).
- `"Save"` button — **explicit, dirty-state gated** (§0 point 9, Arun's confirmed "save button, persist
  the last entry" instruction): `disabled = (title === saved.title && subtitle === saved.subtitle &&
  content_to_explain === saved.content_to_explain) || saving` — identical shape to
  `ShowcaseContentClient.tsx`'s own Company-info Save. Calls `PATCH /api/test-harness/topics/[topicId]`
  on click; while in flight, shows an inline `Loader2` spinner; on success, an inline `"Saved."` flash
  for ~1.5s and `saved` is updated to the new values (re-arming the disabled state against the new
  baseline); on failure, `"Couldn't save. Try again."` — no autosave anywhere on this form; nothing is
  persisted until this button is explicitly clicked, and clicking it again overwrites the row with
  whatever is currently in the fields (the latest entry is what persists — no version history, §10).

**Bottom block — Screens list**, heading `"Screens"`, sub-line `"Each screen becomes one page in the
real content_pages payload, in this order."`:

For each existing screen, a row showing: position number, a small type badge (`HTML` or `IMAGE`), the
screen's own `title` (optional label, e.g. `"Where we are today"`), and its `transition_trigger` text
(e.g. `"move on after the current-state overview"`). Two small `↑`/`↓` buttons re-order it (calling
`PATCH /api/test-harness/screens/[screenId]` with a swapped `position`); a `"Preview"` link opens
`/test-harness-render/[screenId]` in a new tab; an `"Edit"` link expands the row in place; a `"Delete"`
link removes it.

**Editing an existing screen (v1.1, new — same "persist the last entry, explicit Save" pattern, §0
point 9):** clicking `"Edit"` expands the row into the same sub-form shape used for adding a screen
(§4 below), pre-filled with the screen's current `title`/`transition_trigger`/`html_content` (HTML
screens) — image screens expose `title`/`transition_trigger` as editable text plus a `"Replace image"`
file picker (re-uploading replaces the stored file; leaving it untouched keeps the existing image). A
`"Save"` button at the bottom of the expanded row, disabled while every field matches the last-saved
values or while in flight (identical dirty-state expression to the topic form above, scoped to that
screen's own fields), calls `PATCH /api/test-harness/screens/[screenId]`. On success: inline `"Saved."`
flash, the row collapses back to its summary view with the updated values reflected immediately. On
failure: `"Couldn't save. Try again."`, row stays expanded with the attempted edits intact so nothing
typed is lost. Editing an HTML screen's live preview (sandboxed iframe, §0 point 6) behaves identically
to the add-screen preview — re-renders live as the textarea changes, before Save is even clicked.

Below the list, an **"Add a screen"** control — a two-option toggle, `HTML` / `Image` (styled as a
simple segmented control), which reveals the matching sub-form:

**HTML sub-form:**
```
┌─────────────────────────────────────────────────────────┐
│  Add a screen — HTML                                       │
│                                                             │
│  Title (optional)                                           │
│  ┌─────────────────────────────────────────────────────┐ │
│  │ Where we are today                                       │ │
│  └─────────────────────────────────────────────────────┘ │
│                                                             │
│  Transition trigger — when should the bot move on?          │
│  ┌─────────────────────────────────────────────────────┐ │
│  │ move on after the current-state overview                  │ │
│  └─────────────────────────────────────────────────────┘ │
│                                                             │
│  Paste your HTML                                            │
│  ┌─────────────────────────────────────────────────────┐ │
│  │ <div style="...">...</div>                                │ │
│  │                                                            │ │
│  └─────────────────────────────────────────────────────┘ │
│                                                             │
│  Preview (sandboxed):                                       │
│  ┌─────────────────────────────────────────────────────┐ │
│  │  [ live sandboxed-iframe render of the pasted HTML ]      │ │
│  └─────────────────────────────────────────────────────┘ │
│                                                    [ Add ]  │
└─────────────────────────────────────────────────────────┘
```
- `"Paste your HTML"`: a plain `<textarea rows={12}>`, `maxLength={500000}` (500 KB, §0 point 3), no
  syntax highlighting required (out of scope, §10).
- The preview pane below it re-renders live on every keystroke (debounced ~300 ms) as a sandboxed
  `<iframe srcDoc={html} sandbox="allow-scripts">` (§0 point 6) — this is the **only** place pasted HTML
  is ever rendered inside the authoring UI, and it is never injected via `dangerouslySetInnerHTML`.
- If the textarea is empty, the preview pane shows `"Paste HTML above to preview it here."` instead of
  an empty iframe.
- `"Add"` button (disabled while the HTML textarea is empty or the transition-trigger field is empty) —
  `POST /api/test-harness/screens` with `{ topic_id, screen_type: 'html', title, transition_trigger,
  html_content }`; on success, the new row appears in the Screens list above and the sub-form clears.

**Image sub-form:**
```
┌─────────────────────────────────────────────────────────┐
│  Add a screen — Image                                       │
│                                                             │
│  Title (optional)                                           │
│  ┌─────────────────────────────────────────────────────┐ │
│  │ The three bets                                            │ │
│  └─────────────────────────────────────────────────────┘ │
│                                                             │
│  Transition trigger — when should the bot move on?          │
│  ┌─────────────────────────────────────────────────────┐ │
│  │ advance once the three bets are introduced                │ │
│  └─────────────────────────────────────────────────────┘ │
│                                                             │
│  Image file                                                  │
│  ┌─────────────────────────────────────────────────────┐ │
│  │  [ Choose file ]   deck-2.png (1.2 MB)                    │ │
│  └─────────────────────────────────────────────────────┘ │
│                                                             │
│  Preview:                                                     │
│  ┌─────────────────────────────────────────────────────┐ │
│  │  [ <img> preview of the selected file, client-side ]      │ │
│  └─────────────────────────────────────────────────────┘ │
│                                                    [ Add ]  │
└─────────────────────────────────────────────────────────┘
```
- A native `<input type="file" accept="image/png,image/jpeg,image/gif,image/webp">`. Client-side preview
  via `URL.createObjectURL` before upload (no server round-trip needed just to preview the user's own
  local file).
- `"Add"` button (disabled until a file is chosen and the transition-trigger field is non-empty) —
  `POST /api/test-harness/screens` as `multipart/form-data` (`topic_id`, `screen_type: 'image'`, `title`,
  `transition_trigger`, `file`); on success, new row appears above, sub-form clears.
- Client-side rejects (before upload) any file over 10 MB or not matching the accepted types, showing
  `"File must be PNG, JPEG, GIF, or WebP, under 10 MB."` inline — server-side validation (§0 point 3)
  is the actual enforcement; this is just a fast fail.

A `"Review payload →"` link/button at the bottom of Screen B navigates to Screen C. It is always
reachable (not gated on screen count) but Screen C itself shows an empty/blocking state if there are
zero screens (§4 Screen C below).

### Screen C — `/test-harness/topics/[topicId]/payload` — Payload review / dispatch

`GET /api/test-harness/payload/[topicId]` on mount.

**Zero-screens state:**
```
┌───────────────────────────────────────┐
│  Add at least one screen before        │
│  reviewing a payload.  [ ← Back ]      │
└───────────────────────────────────────┘
```

**Screens exist — payload assembled (v1.1 — both dispatch options, per §0 point 10):**
```
┌─────────────────────────────────────────────────────────┐
│  Session payload — ready to test                            │
│  This is the exact real payload for POST                     │
│  /api/partner/v1/sessions. Fire it below, or download it as   │
│  a Postman collection to run it yourself.                      │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ {                                                        │   │
│  │   "meeting_url": "REPLACE_WITH_MEETING_URL",              │   │
│  │   "title": "Q3 AI Strategy Briefing",                       │   │
│  │   "subtitle": "A test of HTML + image screen rendering",    │   │
│  │   "content_to_explain": "...",                                │   │
│  │   "content_source_id": "b3f1c2a4-...",                          │   │
│  │   "content_pages": [                                            │   │
│  │     { "url": "https://hello-clio.com/test-harness-render/8f2a...",│   │
│  │       "media_type": "html",                                       │   │
│  │       "title": "Where we are today",                                │   │
│  │       "transition_trigger": "move on after the current-state         │   │
│  │       overview" },                                                    │   │
│  │     { "url": "https://hello-clio.com/test-harness-render/91cd...", │   │
│  │       "media_type": "image",                                         │   │
│  │       "title": "The three bets",                                      │   │
│  │       "transition_trigger": "advance once the three bets are           │   │
│  │       introduced" }                                                     │   │
│  │   ]                                                                       │   │
│  │ }                                                                          │   │
│  └─────────────────────────────────────────────────────┘   │
│                                              [ Copy JSON ]     │
│                                                                     │
│  Meeting URL                                                        │
│  ┌─────────────────────────────────────────────────────┐         │
│  │ https://meet.google.com/abc-defg-hij                       │         │
│  └─────────────────────────────────────────────────────┘         │
│                                                                         │
│  [ Dispatch now ]        [ Download Postman collection ]                │
└─────────────────────────────────────────────────────────┘
```
- The JSON panel is read-only `<pre>` + a `"Copy JSON"` button (`navigator.clipboard.writeText`) — same
  interaction pattern as B2B-31 Showcase's own final panel. It shows the exact payload that will be sent
  by **either** action below — the JSON panel's own `meeting_url` field live-updates to whatever is
  currently typed in the "Meeting URL" input beneath it (both actions read from the same in-memory
  payload state, so what's displayed is always what would actually be sent).
- `content_source_id` is resolved lazily and idempotently: the first time this screen is opened for a
  harness that has never registered a content source, the server calls the real
  `POST /api/partner/v1/content-sources` once (`auth_type: 'none'`, `label: 'Test harness — internal'`)
  using the harness's own real partner API key, and persists the returned id for reuse on every future
  payload assembly (mirrors B2B-31 §6.7's `ensureContentSource` pattern exactly). Every topic in the
  harness shares this single content source, since every screen is served publicly with no fetch auth
  (§0 point 2) — there is nothing per-topic to differentiate.
- **Meeting URL** — a labeled text input, `type="url"`, placeholder `"https://meet.google.com/abc-defg-hij"`,
  initially empty (not pre-filled with the old `"REPLACE_WITH_MEETING_URL"` placeholder string — that
  convention existed specifically for the copy/paste-into-Postman flow; now that this screen has a real
  input for it, an actual URL is what's expected here). Both `"Dispatch now"` and the JSON panel's live
  preview read this field's current value in place of `meeting_url`; `"Download Postman collection"`
  also uses it if filled, or falls back to the `"REPLACE_WITH_MEETING_URL"` placeholder in the generated
  collection if left empty (so the collection is still useful even when downloaded before a meeting URL
  is known — §6.9).
- **`"Dispatch now"` button** (§0 point 10a, full detail below) — disabled while the Meeting URL field is
  empty or does not look like a URL (`new URL(...)` parse check, client-side fast-fail only; the real
  validation is server-side via the real `CreateSessionSchema`), or while a dispatch is already in
  flight.
- **`"Download Postman collection"` button** (§0 point 10b, full detail below) — always enabled once the
  payload has assembled (does not require Meeting URL to be filled — see above).

**Dispatch — in-flight state:**
```
┌─────────────────────────────────────────────────────────┐
│  [ Dispatching… ⟳ ]      [ Download Postman collection ]   │
└─────────────────────────────────────────────────────────┘
```
Both buttons stay visible; `"Dispatch now"` becomes `"Dispatching… ⟳"` (disabled, spinner) while the
server-side call to the real `POST /api/partner/v1/sessions` is in flight — this is a real network call
to a real vendor-backed endpoint (Attendee bot dispatch) and can take a few seconds, same expectation-
setting the codebase already uses for other real-pipeline calls (e.g. `KBSessionPreview`'s generation
UX, B2B-31 §4).

**Dispatch — success state:**
```
┌─────────────────────────────────────────────────────────┐
│  ✓ Session dispatched.                                       │
│  clio_session_ref: 9e2a4f11-...                                │
│  status: bot_active                                              │
│  Render URL: https://hello-clio.com/partner-render/9e2a...        │
│  (open in a new tab to watch the render)                           │
│                                              [ Dispatch again ]      │
└─────────────────────────────────────────────────────────┘
```
Rendered in place of the "Meeting URL" + buttons block, using the real endpoint's own `201` response
body verbatim (`clio_session_ref`, `status`, `render_url` — §5.2 of the B2B-19 spec, unmodified). The
`render_url` is a clickable link (opens in a new tab). A `"Dispatch again"` link/button collapses this
success panel back to the Meeting URL input + both action buttons, so Arun can immediately fire another
test session (e.g. after editing a screen) without navigating away and back.

**Dispatch — error state:**
```
┌─────────────────────────────────────────────────────────┐
│  ✗ Dispatch failed: balance_exhausted                         │
│  Your Clio balance cannot cover this session's expected         │
│  duration. Add funds or reduce expected_duration_minutes.        │
│  Test-mode sessions are unaffected.                                │
│                                              [ Try again ]           │
└─────────────────────────────────────────────────────────┘
```
Shows the **real** error `code` and `message` from the real endpoint's error response verbatim (e.g.
`balance_exhausted`, `content_source_url_rejected`, or a generic `"Something went wrong. Try again."`
for a non-JSON/network-level failure) — never a generic harness-authored message that would obscure
what the real pipeline actually rejected; the entire point of this tool is seeing the real pipeline's
real behavior. `"Try again"` re-enables the Meeting URL input + both buttons unchanged (nothing about
the topic/screens is touched by a failed dispatch).

---

## 5. Visual Examples

### Screen A — empty state (no topics yet)

```
┌───────────────────────────────────────────────────────────┐
│  Test Content Harness                        [ + New topic ]│
│  Hand-authored fixtures for testing the real B2B-19          │
│  content pipeline. Nothing here is AI-generated.               │
│                                                                 │
│  No test topics yet.                                           │
└───────────────────────────────────────────────────────────┘
```

### Screen A — with topics

```
┌───────────────────────────────────────────────────────────┐
│  Test Content Harness                        [ + New topic ]│
│                                                                 │
│  Q3 AI Strategy Briefing            3 screens   2 hours ago     │
│                                                        [Delete]  │
│  Transition test — single HTML page  1 screen   1 day ago       │
│                                                        [Delete]  │
└───────────────────────────────────────────────────────────┘
```

### Screen B — Topic form, no screens yet

```
┌───────────────────────────────────────────────────────────┐
│  Title                                                          │
│  ┌─────────────────────────────────────────────────────┐     │
│  │ Q3 AI Strategy Briefing                                  │     │
│  └─────────────────────────────────────────────────────┘     │
│  Subtitle                                                        │
│  ┌─────────────────────────────────────────────────────┐     │
│  │ A test of HTML + image screen rendering                    │     │
│  └─────────────────────────────────────────────────────┘     │
│  Content to explain                                                │
│  ┌─────────────────────────────────────────────────────┐     │
│  │ Walk through the current-state overview, the three         │     │
│  │ strategic bets, and risk posture.                            │     │
│  └─────────────────────────────────────────────────────┘     │
│                                                    [ Save ]     │
│                                                                     │
│  Screens                                                            │
│  Each screen becomes one page in the real content_pages payload,     │
│  in this order.                                                       │
│  No screens yet — add one below.                                       │
│                                                                           │
│  Add a screen —  [ HTML ] [ Image ]                                      │
└───────────────────────────────────────────────────────────┘
```

### Screen B — with screens listed

```
┌───────────────────────────────────────────────────────────┐
│  Screens                                                        │
│  1. [HTML]  Where we are today          ↑ ↓  Preview  Delete    │
│     "move on after the current-state overview"                   │
│  2. [IMAGE] The three bets              ↑ ↓  Preview  Delete    │
│     "advance once the three bets are introduced"                  │
│                                                                       │
│  Add a screen —  [ HTML ] [ Image ]                                   │
│                                                                           │
│                                                    [ Review payload → ] │
└───────────────────────────────────────────────────────────┘
```

### Screen C — zero screens

```
┌───────────────────────────────────┐
│  Add at least one screen before    │
│  reviewing a payload.  [ ← Back ]  │
└───────────────────────────────────┘
```

### Screen B — editing an existing HTML screen in place (v1.1)

```
┌───────────────────────────────────────────────────────────┐
│  1. [HTML]  Where we are today          ↑ ↓  Preview  Edit  Delete│
│  ┌─────────────────────────────────────────────────────┐ │
│  │  Title (optional)                                        │ │
│  │  ┌───────────────────────────────────────────────┐    │ │
│  │  │ Where we are today                                │    │ │
│  │  └───────────────────────────────────────────────┘    │ │
│  │  Transition trigger                                       │ │
│  │  ┌───────────────────────────────────────────────┐    │ │
│  │  │ move on after the current-state overview          │    │ │
│  │  └───────────────────────────────────────────────┘    │ │
│  │  Your HTML                                                 │ │
│  │  ┌───────────────────────────────────────────────┐    │ │
│  │  │ <div style="...">...</div>                        │    │ │
│  │  └───────────────────────────────────────────────┘    │ │
│  │  Preview (sandboxed):                                       │ │
│  │  ┌───────────────────────────────────────────────┐    │ │
│  │  │  [ live sandboxed-iframe render ]                  │    │ │
│  │  └───────────────────────────────────────────────┘    │ │
│  │                                     [ Save (disabled) ]│ │
│  └─────────────────────────────────────────────────────┘ │
└───────────────────────────────────────────────────────────┘
```
`[ Save (disabled) ]` shown here because nothing has been changed from the last-saved values yet —
editing any field re-enables it immediately (§4 Screen B, "Editing an existing screen").

### Screen C — dispatch in flight

```
┌─────────────────────────────────────────────────────────┐
│  [ Dispatching… ⟳ ]      [ Download Postman collection ]   │
└─────────────────────────────────────────────────────────┘
```

### Screen C — dispatch success

```
┌─────────────────────────────────────────────────────────┐
│  ✓ Session dispatched.                                       │
│  clio_session_ref: 9e2a4f11-8b3c-4d21-9a77-1c8f2e5b6a90        │
│  status: bot_active                                              │
│  Render URL: https://hello-clio.com/partner-render/9e2a4f11...    │
│  (open in a new tab to watch the render)                           │
│                                              [ Dispatch again ]      │
└─────────────────────────────────────────────────────────┘
```

### Screen C — dispatch error (real endpoint's own error, e.g. insufficient test-minute balance)

```
┌─────────────────────────────────────────────────────────┐
│  ✗ Dispatch failed: balance_exhausted                         │
│  Your Clio balance cannot cover this session's expected         │
│  duration. Add funds or reduce expected_duration_minutes.        │
│  Test-mode sessions are unaffected.                                │
│                                              [ Try again ]           │
└─────────────────────────────────────────────────────────┘
```

### Downloaded Postman collection — concrete example

Clicking `"Download Postman collection"` for the same topic used throughout this document (title `"Q3
AI Strategy Briefing"`, Meeting URL field left as `https://meet.google.com/abc-defg-hij`) downloads
`clio-test-harness-q3-ai-strategy-briefing.postman_collection.json`:
```json
{
  "info": {
    "name": "Clio Test Harness — Q3 AI Strategy Briefing",
    "description": "Generated by test.hello-clio.com. Set the TEST_HARNESS_API_KEY collection variable to the harness's real partner API key before sending — the key is never embedded in this file.",
    "schema": "https://schema.getpostman.com/json/collection/v2.1.0/collection.json"
  },
  "item": [
    {
      "name": "Dispatch test session",
      "request": {
        "method": "POST",
        "header": [
          { "key": "Authorization", "value": "Bearer {{TEST_HARNESS_API_KEY}}" },
          { "key": "Content-Type", "value": "application/json" }
        ],
        "url": {
          "raw": "https://hello-clio.com/api/partner/v1/sessions",
          "protocol": "https",
          "host": ["hello-clio", "com"],
          "path": ["api", "partner", "v1", "sessions"]
        },
        "body": {
          "mode": "raw",
          "raw": "{\n  \"meeting_url\": \"https://meet.google.com/abc-defg-hij\",\n  \"title\": \"Q3 AI Strategy Briefing\",\n  \"subtitle\": \"A test of HTML + image screen rendering\",\n  \"content_to_explain\": \"...\",\n  \"content_source_id\": \"b3f1c2a4-...\",\n  \"content_pages\": [ { \"url\": \"https://hello-clio.com/test-harness-render/8f2a...\", \"media_type\": \"html\", \"title\": \"Where we are today\", \"transition_trigger\": \"move on after the current-state overview\" } ]\n}"
        }
      }
    }
  ],
  "variable": [
    { "key": "TEST_HARNESS_API_KEY", "value": "", "type": "string" }
  ]
}
```
Note the `Authorization` header references the Postman **variable** `{{TEST_HARNESS_API_KEY}}`, left
blank in the `variable` array — the real key is deliberately **never** written into the downloaded file
(§6.9 explains why). Arun pastes the key he already has (from the one-time provisioning step, §6.1)
into that one Postman collection-variable field once, and every future collection downloaded from this
tool reuses the same variable name.

### Public render — HTML screen, viewed directly

Whatever Arun pasted, rendered as a standalone page at
`https://hello-clio.com/test-harness-render/8f2a...` — e.g., if he pasted
`<div style="padding:40px;font-size:32px">Where we are today</div>`, that div renders full-page, wrapped
in a minimal `<!doctype html><html><body>…</body></html>` shell only if his paste lacked one (§6.5).

### Public render — screen not found

```
┌─────────────────────────────────────┐
│  This screen could not be found.      │
└─────────────────────────────────────┘
```
(Same minimal dark-background centered-message pattern as `/showcase-render/[id]`'s `NotFoundMessage`.)

---

## 6. Data Requirements

### 6.0 New migration `092_b2b32_internal_content_test_harness.sql`

```sql
-- B2B-32 — Internal Content Test Harness. See docs/specs/B2B-32-requirement-document.md §0/§6.
-- Fully isolated from every partner-facing content table (test_harness_topics/_screens are never
-- read by any real partner-content code path) — mirrors B2B-31's own isolation precedent (§0 pt 1/3).

CREATE TABLE IF NOT EXISTS test_harness_topics (
  id                 UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  title              TEXT,
  subtitle           TEXT,
  content_to_explain TEXT,
  content_source_id  UUID REFERENCES partner_content_sources(id),
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TRIGGER set_test_harness_topics_updated_at
  BEFORE UPDATE ON test_harness_topics
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TABLE IF NOT EXISTS test_harness_screens (
  id                 UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  topic_id           UUID NOT NULL REFERENCES test_harness_topics(id) ON DELETE CASCADE,
  screen_type        TEXT NOT NULL CHECK (screen_type IN ('html', 'image')),
  position           SMALLINT NOT NULL,
  title              TEXT,
  transition_trigger TEXT NOT NULL,
  html_content       TEXT,               -- populated only when screen_type = 'html'; capped 500,000 chars at the API layer
  storage_path       TEXT,               -- populated only when screen_type = 'image'; path within the 'test-harness-screens' Supabase Storage bucket
  image_mime_type    TEXT,               -- populated only when screen_type = 'image'
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT test_harness_screens_content_check CHECK (
    (screen_type = 'html' AND html_content IS NOT NULL AND storage_path IS NULL)
    OR (screen_type = 'image' AND storage_path IS NOT NULL AND html_content IS NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_test_harness_screens_topic ON test_harness_screens(topic_id);

CREATE TRIGGER set_test_harness_screens_updated_at
  BEFORE UPDATE ON test_harness_screens
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE test_harness_topics ENABLE ROW LEVEL SECURITY;
ALTER TABLE test_harness_screens ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access on test_harness_topics"
  ON test_harness_topics FOR ALL USING (auth.role() = 'service_role');
CREATE POLICY "Service role full access on test_harness_screens"
  ON test_harness_screens FOR ALL USING (auth.role() = 'service_role');

COMMENT ON TABLE test_harness_topics IS
  'B2B-32: internal, Arun-only test fixtures for the real B2B-19 inline-content pipeline. No AI
  generation anywhere in this table''s write path. Not read by any partner-facing code.';
COMMENT ON TABLE test_harness_screens IS
  'B2B-32: one row per hand-authored HTML or image screen. Served publicly, unauthenticated, at
  /test-harness-render/[id] so the real safeFetchPartnerPage() pipeline can fetch it exactly as it
  would fetch any real partner page. See requirement doc §0 point 2/6.';
```

No changes to `partner_content_sources`, `partner_sessions`, `partner_accounts`, or any migration file
before 092, other than the one-time data-only insert in §6.1 below (not part of this migration file —
an operational step, run once by the Orchestrator).

### 6.1 One-time account provisioning (Orchestrator, not a code deliverable — §0 point 7)

```sql
-- Run once. Creates the dedicated internal partner account this harness dispatches under.
-- account_kind defaults to 'partner' already (migration 086) — set explicitly here for clarity.
-- Column is `name`, not `company_name` — confirmed against migration 071's actual partner_accounts schema.
INSERT INTO partner_accounts (account_kind, name, status)
VALUES ('partner', 'Clio Internal — Test Harness', 'active')
RETURNING id;
-- Record the returned id as TEST_HARNESS_PARTNER_ACCOUNT_ID in env config.

-- Grant Arun's existing Clerk user admin access to it (same shape as any partner_admin_users row):
INSERT INTO partner_admin_users (partner_account_id, clerk_user_id)
VALUES ('<returned id above>', '<Arun''s Clerk user id>');
```

Then call `POST /api/admin/partner-keys` (existing route, unmodified — `requirePartnerAdmin`-gated,
Clerk-authenticated) with `{ "partner_account_id": "<returned id>", "mode": "test", "label": "test
harness" }` — **`mode: "test"`, not `"live"`** (revised in v1.1, §0 point 7's mode note): now that
in-tool dispatch (§0 point 10a) makes repeated, iterative firing the expected usage pattern rather than
a rare deliberate act, test mode bills against the harness account's trial/test-minutes balance
(B2B-08), never real paid `balance_usd` — so iterating on fixtures never burns real wallet funds, while
exercising the identical dispatch/render/transition code a live session would. The full key is returned
exactly once by that existing endpoint, as it already is for every other partner account — record it in
**two** places: (1) hand it to Arun directly (for the Postman-collection path, §6.9, where he pastes it
into his own Postman environment once) and (2) set it as `TEST_HARNESS_PARTNER_API_KEY` in Vercel env
config (for the in-tool dispatch route, §6.8, to use server-side) — both paths need the same real key,
stored in two different places because Postman and this app's server are two different runtimes.

### 6.2 New env vars (`.env.local.example`)

```
# B2B-32 — internal test harness (test.hello-clio.com)
TEST_HARNESS_HOST=test.hello-clio.com
TEST_HARNESS_BASIC_AUTH_USER=PLACEHOLDER_TEST_HARNESS_USER
TEST_HARNESS_BASIC_AUTH_PASSWORD=PLACEHOLDER_TEST_HARNESS_PASSWORD
TEST_HARNESS_PARTNER_ACCOUNT_ID=PLACEHOLDER_TEST_HARNESS_PARTNER_ACCOUNT_ID
TEST_HARNESS_PARTNER_API_KEY=PLACEHOLDER_TEST_HARNESS_PARTNER_API_KEY
```
`TEST_HARNESS_HOST` is a plain config value (not a secret, mirrors `CLIO_ROOT_DOMAIN`'s own real-value
convention). The other four are genuinely sensitive/environment-specific and stay `PLACEHOLDER_` until
the Orchestrator completes §6.1. **`TEST_HARNESS_PARTNER_API_KEY` is new in v1.1** — the real, plaintext
partner API key minted in §6.1, held server-side only, used exclusively by the new in-tool dispatch
route (§6.8) to call the real `POST /api/partner/v1/sessions` on Arun's behalf. It is never sent to the
browser, never written into a downloaded Postman collection (§6.9), and — like every other credential in
this codebase — never logged. Note this is a genuine exception to "partner API keys are hashed,
never stored retrievably" (`hashApiKey`, B2B-19 §0's own crypto note): that rule protects **incoming**
keys Clio verifies; this is the harness's **own outgoing** credential, analogous to any other outbound
secret this codebase already stores as ciphertext-or-plaintext-in-env (e.g.
`PARTNER_OUTBOUND_TOKEN_ENCRYPTION_KEY`'s underlying secrets) — an env var is the simplest adequate
storage for a single, internal, easily-rotated (revoke + remint) credential; it does not need its own
encrypted-at-rest DB column for one server-side-only use.

### 6.3 New Supabase Storage bucket

`test-harness-screens` — private (no public read policy), accessed only via
`createSupabaseAdminClient().storage` (service-role key, same client already used everywhere in this
codebase — no new credential). One object per image screen, path `${screenId}.${extension}`.

### 6.4 API routes (all NEW)

| Route | Method | Behavior |
|---|---|---|
| `app/api/test-harness/topics/route.ts` | `GET` | Basic-Auth-gated (via middleware, not per-route — §6.6); returns all topics with a computed screen count |
| same file | `POST` | Creates an empty topic row (`title/subtitle/content_to_explain` all null); returns `{ id }` |
| `app/api/test-harness/topics/[topicId]/route.ts` | `GET` | Returns the topic + its ordered screens (screens without `html_content`/image bytes inlined — just metadata; the actual HTML/image is fetched via the render route when needed for preview) |
| same file | `PATCH` | Zod: `{ title: z.string().max(200).optional().nullable(), subtitle: z.string().max(300).optional().nullable(), content_to_explain: z.string().max(5000).optional().nullable() }` |
| same file | `DELETE` | Deletes the topic row (cascades `test_harness_screens`; for image screens, also deletes the corresponding Storage objects) |
| `app/api/test-harness/screens/route.ts` | `POST` | `screen_type: 'html'` → Zod `{ topic_id: z.string().uuid(), screen_type: z.literal('html'), title: z.string().max(200).optional(), transition_trigger: z.string().min(1).max(500), html_content: z.string().min(1).max(500000) }`. `screen_type: 'image'` → `multipart/form-data`, same shared fields + `file` (sniffed server-side against the allowed magic bytes, ≤10 MB, uploaded to Storage, `storage_path`/`image_mime_type` stored). `position` is set to `max(existing positions for this topic) + 1`. |
| `app/api/test-harness/screens/[screenId]/route.ts` | `PATCH` | Edits `title`/`transition_trigger`/`html_content` (html screens) — or, for image screens, `title`/`transition_trigger` plus an optional replacement `file` (`multipart/form-data`, same validation as create) — or `position` alone (either type, used by the ↑/↓ reorder controls). v1.1: this is now also the route the Screen B "Edit" in-place flow (§4) calls, not only the reorder controls. |
| same file | `DELETE` | Removes the screen row; for image screens, also deletes the Storage object |
| `app/api/test-harness/payload/[topicId]/route.ts` | `GET` | Lazily registers the shared `content_source_id` (§4 Screen C) if `TEST_HARNESS_PARTNER_ACCOUNT_ID`'s harness content source doesn't exist yet, by calling the real `POST /api/partner/v1/content-sources` internally (server-to-server, using the harness's own real API key resolved server-side — never exposed to the browser); assembles and returns `{ payload }` shaped exactly as `CreateSessionSchema` expects, via the shared `assembleTestHarnessPayload()` helper (§6.5) |
| `app/api/test-harness/dispatch/[topicId]/route.ts` | `POST` | **New in v1.1** (§0 point 10a). Zod: `{ meeting_url: z.string().url() }`. Calls the same `assembleTestHarnessPayload()` helper (§6.5) as the `GET payload` route, substitutes the request's `meeting_url` in place of the placeholder, then calls the real `POST /api/partner/v1/sessions` server-to-server using `TEST_HARNESS_PARTNER_API_KEY` (§6.2, §6.8) — and relays that real endpoint's own response (status code and body) back to the browser verbatim. |

### 6.5 Payload assembly — shared helper (`lib/test-harness/payload.ts`, NEW)

Both the `GET payload` route and the new `POST dispatch` route (§6.8) need the identical assembly logic
— factored into one function so they can never drift:

```ts
export async function assembleTestHarnessPayload(topicId: string, meetingUrl: string) {
  const topic = await getTopic(topicId) // test_harness_topics row
  const screens = await getScreensForTopic(topicId) // test_harness_screens rows
  const contentSourceId = await ensureTestHarnessContentSource() // lazy, idempotent — §4 Screen C

  return {
    meeting_url: meetingUrl,
    title: topic.title ?? undefined,
    subtitle: topic.subtitle ?? undefined,
    content_to_explain: topic.content_to_explain ?? undefined,
    content_source_id: contentSourceId,
    content_pages: screens
      .sort((a, b) => a.position - b.position)
      .map((s) => ({
        url: `${process.env.NEXT_PUBLIC_APP_URL}/test-harness-render/${s.id}`,
        media_type: s.screen_type, // 'html' | 'image' — matches ContentPageSchema.media_type exactly
        title: s.title ?? undefined,
        transition_trigger: s.transition_trigger,
      })),
  }
}
```
`GET /api/test-harness/payload/[topicId]` calls this with `meetingUrl = 'REPLACE_WITH_MEETING_URL'`
(display-only, for the JSON preview panel before Arun has typed a real URL — §4 Screen C) or with the
Meeting URL field's current value once one exists. `POST /api/test-harness/dispatch/[topicId]` calls it
with the real, Zod-validated `meeting_url` from the request body, then forwards the exact result as the
body of its own outbound call to the real endpoint — no divergent code path between what Arun previews
and what actually gets sent.

This shape is verified against the real `CreateSessionSchema`/`ContentPageSchema`
(`lib/partner/session-schema.ts`) field-for-field — same `.url()`/`.enum(['html','image'])`/
`transition_trigger` (1–500 chars) constraints a real partner integration must satisfy, and the same
`content_source_id`-required-when-`content_pages`-present refine (AT-6 verifies this via
`CreateSessionSchema.safeParse()`).

### 6.6 `middleware.ts` changes

Two additions, both additive — nothing existing is modified beyond insertion points:

**(a) `isPublicRoute` gains one new pattern**, alongside `/partner-render/(.*)` and (once B2B-31 ships)
`/showcase-render/(.*)`:
```ts
'/test-harness-render/(.*)', // B2B-32: public, unauthenticated — fetched by the real safeFetchPartnerPage() pipeline, mirrors /partner-render and /showcase-render
```

**(b) A new host branch, inserted immediately before the existing `isTenantHost` check** (so B2B-05's
tenant-resolution logic never runs for this host, §0 point 4):
```ts
const testHarnessHost = process.env.TEST_HARNESS_HOST ?? ''
if (testHarnessHost.length > 0 && host === testHarnessHost) {
  // B2B-32 — static, single-host routing. No subdomain_slug lookup, no Vercel Domains API,
  // no custom_domain machinery — this is one fixed internal host, not a per-partner dynamic one.
  // See docs/specs/B2B-32-requirement-document.md §0 point 4.
  if (pathname.startsWith('/test-harness') || pathname.startsWith('/api/test-harness')) {
    const authResult = checkTestHarnessBasicAuth(request) // constant-time compare, §0 point 5
    if (!authResult.ok) return authResult.challengeResponse // 401 + WWW-Authenticate header
    if (pathname === '/') {
      const rewritten = request.nextUrl.clone()
      rewritten.pathname = '/test-harness'
      return NextResponse.rewrite(rewritten)
    }
    return NextResponse.next()
  }
  return neutralNotFoundResponse() // any other path on this host — never leaks the rest of the app
}
```
`checkTestHarnessBasicAuth()` (new, small, colocated in `middleware.ts` or a new `lib/test-harness/
basic-auth.ts`) reads the `Authorization: Basic <base64>` header, decodes it, and compares both the
username and password against `TEST_HARNESS_BASIC_AUTH_USER`/`_PASSWORD` using a constant-time string
comparison (Node's `crypto.timingSafeEqual`, length-padded to avoid a timing side-channel on length
itself) — never a plain `===`. A missing/incorrect header returns `401` with a `WWW-Authenticate: Basic
realm="Clio Test Harness"` header, which makes every browser show its native credential prompt.

**Also — defense in depth:** `/test-harness*` and `/api/test-harness/*` paths are blocked
(`neutralNotFoundResponse()`) on **every other host**, including the main `hello-clio.com`/
`distill-peach.vercel.app` origin — added as an explicit early check before the existing
`isPublicRoute`/Clerk-protect logic, so even a direct guess at
`hello-clio.com/test-harness` never resolves, satisfying Known Constraint 2 literally, not just by
omission of a nav link.

### 6.7 Reads / writes / external calls

- **Reads:** `test_harness_topics`, `test_harness_screens` (all screens); Supabase Storage (image bytes,
  server-side only, via the render route).
- **Writes:** `test_harness_topics`/`test_harness_screens` (authoring); one real
  `partner_content_sources` row (lazy, idempotent, §6.4) via the real, unmodified content-source
  registration endpoint.
- **External calls:** the real, already-approved Supabase client; and, **v1.1** — the dispatch route
  (§6.8) makes one real, first-party, server-to-server call to `POST /api/partner/v1/sessions` (Clio's
  own endpoint, not a third-party vendor — the approved-vendor-list restriction on external calls is
  about third-party APIs, and this is Clio calling itself, exactly as any real partner integration
  would call it, just from Clio's own server instead of a partner's).
- **localStorage/sessionStorage:** none.

### 6.8 In-tool dispatch route (`app/api/test-harness/dispatch/[topicId]/route.ts`, NEW — §0 point 10a)

```ts
export async function POST(request: NextRequest, { params }: { params: { topicId: string } }) {
  const body = await request.json().catch(() => null)
  const parsed = z.object({ meeting_url: z.string().url() }).safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Validation failed', details: parsed.error.flatten() }, { status: 400 })
  }

  const payload = await assembleTestHarnessPayload(params.topicId, parsed.data.meeting_url)

  const upstream = await fetch(`${process.env.NEXT_PUBLIC_APP_URL}/api/partner/v1/sessions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.TEST_HARNESS_PARTNER_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  })

  const upstreamBody = await upstream.json().catch(() => ({ error: { code: 'unknown', message: 'Non-JSON response from the real endpoint.' } }))
  // Relay verbatim — status code AND body — so the harness's UI shows exactly what the real pipeline said.
  return NextResponse.json(upstreamBody, { status: upstream.status })
}
```
This route is **not** a new dispatch mechanism — it is a thin, same-process server-to-server proxy that
calls the real, unmodified `POST /api/partner/v1/sessions` exactly as any external partner caller would
(same headers, same body shape, same Bearer-token auth), and hands back exactly what that real endpoint
returned. It exists only so the browser never has to hold `TEST_HARNESS_PARTNER_API_KEY` (which stays a
server-side-only env var, §6.2) — Screen C's `"Dispatch now"` button calls this route, not the real
endpoint directly, purely for that credential-custody reason. Basic Auth (via `middleware.ts`, §6.6)
already gates this route since it lives under `/api/test-harness/*`; no separate auth check is added
inside the route handler itself.

### 6.9 "Download Postman collection" — client-side generation (§0 point 10b)

**Generated client-side, not via a new API route** — deliberate, for two reasons: (1) the full payload
is already loaded in the browser's own state (Screen C already fetched it via `GET
/api/test-harness/payload/[topicId]` to render the JSON preview panel) — there is nothing left for a
server round-trip to compute; and (2) generating it server-side would create a natural temptation to
also embed the real `TEST_HARNESS_PARTNER_API_KEY` server-side-known value directly into the response —
exactly what §6.2's rationale explicitly avoids. Client-side generation, by construction, only ever has
access to what the browser already has (the assembled payload, never the real key), which structurally
enforces "the key never leaves its env var" rather than relying on a developer remembering not to
include it.

```ts
function buildPostmanCollection(topicTitle: string, payload: TestHarnessPayload): PostmanCollectionV21 {
  return {
    info: {
      name: `Clio Test Harness — ${topicTitle || 'Untitled topic'}`,
      description:
        'Generated by test.hello-clio.com. Set the TEST_HARNESS_API_KEY collection variable to the ' +
        "harness's real partner API key before sending — the key is never embedded in this file.",
      schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json',
    },
    item: [
      {
        name: 'Dispatch test session',
        request: {
          method: 'POST',
          header: [
            { key: 'Authorization', value: 'Bearer {{TEST_HARNESS_API_KEY}}' },
            { key: 'Content-Type', value: 'application/json' },
          ],
          url: {
            raw: `${process.env.NEXT_PUBLIC_APP_URL}/api/partner/v1/sessions`,
            protocol: 'https',
            host: new URL(process.env.NEXT_PUBLIC_APP_URL!).hostname.split('.'),
            path: ['api', 'partner', 'v1', 'sessions'],
          },
          body: { mode: 'raw', raw: JSON.stringify(payload, null, 2) },
        },
      },
    ],
    variable: [{ key: 'TEST_HARNESS_API_KEY', value: '', type: 'string' }],
  }
}

function downloadPostmanCollection(topicTitle: string, payload: TestHarnessPayload) {
  const collection = buildPostmanCollection(topicTitle, payload)
  const blob = new Blob([JSON.stringify(collection, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `clio-test-harness-${slugify(topicTitle || 'untitled')}.postman_collection.json`
  a.click()
  URL.revokeObjectURL(url)
}
```
`payload` here is the exact same object the JSON preview panel already renders (built from the same
in-memory state, `meeting_url` taken from the Meeting URL input if filled, else the
`"REPLACE_WITH_MEETING_URL"` placeholder) — so the downloaded collection's request body is always
byte-identical to what's currently on screen. The full example output is in §5.

---

## 7. Success Criteria (Acceptance Tests)

✓ **AT-1 (host isolation).** Given the main app origin (`hello-clio.com` or
`distill-peach.vercel.app`), when `/test-harness` or `/api/test-harness/topics` is requested, then the
response is the same neutral 404 the rest of `middleware.ts`'s tenant-host discipline already uses —
never the harness UI, regardless of Basic Auth headers supplied.

✓ **AT-2 (access control).** Given `test.hello-clio.com`, when `/test-harness` is requested with no
`Authorization` header (or an incorrect one), then the response is `401` with a `WWW-Authenticate:
Basic` header; when requested with the correct `TEST_HARNESS_BASIC_AUTH_USER`/`_PASSWORD` credentials,
then the page loads normally.

✓ **AT-3 (public render, no auth).** Given a saved `test_harness_screens` row (either type), when
`/test-harness-render/[id]` is requested with **no** `Authorization` header and from a request that also
does not carry the `test.hello-clio.com` host, then it still returns `200` with the correct
`Content-Type` — proving the real `safeFetchPartnerPage()` pipeline (which never sends Basic Auth
credentials and calls the main app origin) can actually fetch it.

✓ **AT-4 (HTML screens render exactly as pasted).** Given an HTML screen whose pasted content is a full
document, when `/test-harness-render/[id]` is requested, then the response body is byte-identical to
what was pasted; given a pasted HTML **fragment** (no `<html>` tag), then the response is that fragment
wrapped in a minimal valid document shell (§4 Screen C render note) — either way, `Content-Type:
text/html; charset=utf-8` and a `Content-Security-Policy: sandbox allow-scripts` header are present.

✓ **AT-5 (image screens).** Given an uploaded PNG, when `/test-harness-render/[id]` is requested, then
the response is the raw image bytes with `Content-Type: image/png` — matching what B2B-19's own
`safeFetchPartnerPage` content-type enforcement (`media_type: 'image'` → must be `image/*`) requires.

✓ **AT-6 (payload validity end-to-end).** Given a topic with 2 screens (one HTML, one image), when the
payload assembly route's output (with `meeting_url` manually replaced by a real URL string) is run
through `CreateSessionSchema.safeParse()` in a test, then `success === true` with zero validation errors
— proving the assembled payload is byte-for-byte acceptable to the real, unmodified endpoint.

✓ **AT-7 (content-source reuse, not re-registration).** Given a payload has already been assembled once
for any topic (so a `partner_content_sources` row already exists under
`TEST_HARNESS_PARTNER_ACCOUNT_ID`), when the payload route is called again for a different topic, then
no second `POST /api/partner/v1/content-sources` call is made — the same `content_source_id` is reused.

✓ **AT-8 (upload validation).** Given a file over 10 MB, or a file whose magic bytes don't match any of
`image/png`/`image/jpeg`/`image/gif`/`image/webp` regardless of its claimed `Content-Type` header, when
`POST /api/test-harness/screens` is called with `screen_type: 'image'`, then it returns `422` and no
Storage object or `test_harness_screens` row is written.

✓ **AT-9 (empty state).** Given a topic with zero screens, when `/test-harness/topics/[topicId]/payload`
is opened, then it shows the "Add at least one screen" blocking message and does **not** attempt content-
source registration (no wasted real API call against an incomplete payload).

✓ **AT-10 (HTML preview isolation).** Given HTML pasted into the Screen B textarea that includes
`<script>window.parent.postMessage(document.cookie, '*')</script>`, when the live preview renders it,
then the script executes only inside the sandboxed iframe's opaque origin and cannot read the parent
authoring page's cookies or DOM — no `allow-same-origin` is ever granted.

✓ **AT-11 (Save is explicit, never autosave — §0 point 9).** Given the topic form or an in-place screen
edit with unsaved changes, when time passes or the field loses focus without the Save button being
clicked, then no `PATCH` request fires and no `updated_at` changes — persistence happens **only** on an
explicit Save click; given the Save button is clicked, then exactly one `PATCH` fires and the row's
values become the new baseline (Save disables again until the next edit).

✓ **AT-12 (edits overwrite the latest entry, no version history — §0 point 9).** Given a screen is
saved, then edited and saved again with different `html_content`, when `/test-harness-render/[id]` is
requested afterward, then it serves the **second** save's content — there is no way to retrieve the
first save's content through this tool (confirms "persist with the last entry," not a versioned
history, matching §10's scoping).

✓ **AT-13 (in-tool dispatch relays the real response verbatim).** Given a topic whose assembled payload
is valid, when `"Dispatch now"` is clicked with a well-formed `meeting_url`, then
`POST /api/test-harness/dispatch/[topicId]` returns the **exact** status code and body the real
`POST /api/partner/v1/sessions` returned (verified by mocking the upstream call in a test and asserting
byte-identical pass-through, both for a `201` success and a `402`/`422` real error) — never a
harness-authored substitute message.

✓ **AT-14 (dispatch failure never touches authored data).** Given a dispatch call returns a real error
(e.g. `balance_exhausted`), when the error is shown, then no `test_harness_topics`/`test_harness_screens`
row is modified or deleted — the topic/screens remain exactly as they were, and `"Try again"` re-fires
with the same assembled payload unchanged.

✓ **AT-15 (downloaded Postman collection never contains the real API key).** Given any assembled
payload, when `"Download Postman collection"` is clicked and the resulting file is inspected, then the
string value of `TEST_HARNESS_PARTNER_API_KEY` (the real key) does not appear anywhere in the file —
the `Authorization` header is the literal template string `"Bearer {{TEST_HARNESS_API_KEY}}"` and the
`variable` array's `value` is an empty string (unit test: assert the serialized collection JSON, as a
string, does not contain the real key's known test-fixture value).

✓ **AT-16 (downloaded collection body matches the on-screen payload exactly).** Given the JSON preview
panel currently shows a specific assembled payload (with a specific `meeting_url`), when the Postman
collection is downloaded and its single request item's `body.raw` is JSON-parsed, then it deep-equals
the same payload object byte-for-byte — proving no drift between preview and download.

---

## 8. Error States

| Input / call | Failure | Behavior |
|---|---|---|
| `test.hello-clio.com/*` | Missing/wrong Basic Auth | `401` + `WWW-Authenticate` header, browser shows native credential prompt |
| Any host, `/test-harness*` or `/api/test-harness/*` | Wrong host | Neutral `404` (`neutralNotFoundResponse`), no distinguishing detail (AT-1) |
| `POST /api/test-harness/screens` (image) | File too large / wrong type | `422`, inline `"File must be PNG, JPEG, GIF, or WebP, under 10 MB."` |
| `POST /api/test-harness/screens` (html) | `html_content` over 500 KB | `422`, inline `"HTML is too large (max 500 KB)."` |
| `PATCH /api/test-harness/topics/[topicId]` | Server error | Inline `"Couldn't save. Try again."` |
| `GET /api/test-harness/payload/[topicId]` | Real content-source registration call fails | `500`, inline `"Couldn't prepare the payload. Try again."`; no partial/broken JSON ever shown |
| `/test-harness-render/[screenId]` | Malformed UUID or no matching row | `404`, same `"This screen could not be found."` message regardless of cause (no info leak, mirrors `/showcase-render`'s own convention) |
| `/test-harness-render/[screenId]` (image) | Storage object missing/unreadable | Same 404 message — degrades identically to a not-found screen, never a 500 |
| Screen B HTML textarea | Pasted content exceeds `maxLength` | Native browser truncation at 500,000 chars, no separate error state needed |
| `POST /api/test-harness/dispatch/[topicId]` | `meeting_url` missing/malformed | `400` before any upstream call is made; inline `"Enter a valid meeting URL."` — the real endpoint is never called with obviously-invalid input |
| `POST /api/test-harness/dispatch/[topicId]` | Real `POST /api/partner/v1/sessions` call itself times out or the network fails (not a real endpoint error response) | `502`-equivalent relay, inline `"Couldn't reach the session endpoint. Try again."` — distinguished from a real endpoint error (§4 Screen C error state, which always shows the real `code`/`message` instead) |
| `POST /api/test-harness/dispatch/[topicId]` | Real endpoint returns a real error (`402`/`422`/etc.) | Relayed verbatim (§6.8); Screen C shows the real `code` + `message` (§4 Screen C error state) |
| `"Download Postman collection"` | Payload not yet loaded (button clicked before the `GET payload` fetch resolves) | Button is disabled until the payload state exists — no click is possible in an undefined state |

---

## 9. Edge Cases

- **Multiple topics never collide.** Every `test_harness_screens` row is scoped by `topic_id`; deleting
  one topic cascades only its own screens (§6.0 `ON DELETE CASCADE`), never touching another topic's
  rows or Storage objects.
- **A screen's render URL stays stable across edits.** Editing an HTML screen's `html_content` via
  `PATCH` updates the same row (`id` unchanged) — a URL already pasted into a previous payload/Postman
  call keeps working and simply serves the newest content on next fetch, same "stable URL, mutable
  content" behavior B2B-31's own visualization render URLs rely on.
- **Reordering screens never changes their URLs** — `position` is purely display/payload-array order,
  not part of the `/test-harness-render/[id]` path.
- **The harness's shared `content_source_id` is process-wide, not per-topic** — deleting a topic never
  deletes or invalidates the shared content source; a stale `content_source_id` reference on a deleted
  topic is simply never read again.
- **Pasted HTML referencing external resources** (e.g., `<img src="https://example.com/x.png">`) is
  fetched by whatever ultimately renders the sandboxed iframe/document (Arun's own browser during
  preview, or the bot's render client during a real session) — this brief does not proxy or rewrite such
  URLs; they behave exactly as any real partner's HTML page's external references would, out of scope to
  change (mirrors real-pipeline behavior, not a gap specific to this tool).
- **Wildcard domain not yet provisioned.** If `*.{CLIO_ROOT_DOMAIN}` hasn't actually been added to the
  Vercel project yet (§0 point 4 dependency), `test.hello-clio.com` simply won't resolve at the DNS/
  Vercel layer — the code in this brief is inert but harmless until that one-time infra step lands; nothing
  in this brief's own code path can detect or route around that (out of scope, it's Vercel-level, not
  app-level).
- **Basic Auth credential rotation.** Changing `TEST_HARNESS_BASIC_AUTH_PASSWORD` in Vercel env config
  takes effect on next deploy/env-refresh with zero code change and zero DB migration — by design, the
  cheapest possible rotation path for a single-user credential.
- **Mobile/responsive.** All three authoring screens use the same fluid `clamp()`/Tailwind pattern as the
  rest of the codebase's post-2026-07-18 work (standing responsive policy, `CLAUDE.md`) — no hardcoded
  pixel-width caps. Given this is a desktop-authoring tool for one user who will overwhelmingly use it
  from a laptop, mobile layout still must not break (per the standing policy, which applies to "any
  screen touched," and this is 100% new UI), but is not the primary design target — text wraps, inputs
  stack full-width below ~768px, no horizontal scroll.
- **`"Dispatch now"` is not idempotent — clicking it twice fires two real (test-mode) sessions and two
  real bot joins.** The button disables itself while a dispatch is in flight (§4 Screen C, "in-flight
  state") specifically to prevent an accidental double-click from firing twice; once a dispatch succeeds,
  the button is replaced entirely by the success panel (requiring an explicit "Dispatch again" click to
  re-arm it) — there is no state where the button is clickable twice in quick succession under normal
  use. This is a real limitation to be aware of, not a bug: the harness intentionally does not attempt
  any client-side request deduplication/idempotency-key mechanism beyond this UI-level guard, since the
  real endpoint itself has no idempotency-key concept either (confirmed against `CreateSessionSchema` —
  every valid `POST` mints a new session).
- **Test-mode dispatch still consumes the harness account's trial/test-minutes balance** (§0 point 7's
  mode note) — repeated dispatching is cheap but not literally free/unlimited; B2B-08's existing
  trial-exhaustion gate (`trial_exhausted`) applies to the harness account exactly as it would to any
  other test-mode partner account, and would surface as a real dispatch error (§8) if ever exhausted —
  out of scope for this brief to special-case or top up automatically.
- **Editing a screen after a successful dispatch does not retroactively change that already-dispatched
  session** — the real session already has its own `content_pages` snapshot (B2B-19 `partner_sessions`
  row), fixed at dispatch time; a subsequent screen edit only affects what a **future** dispatch (or the
  bot's headless fetch, if that exact session happens to still be actively re-fetching, which it does
  not — content is fetched once at render time) would send. No special handling needed; this is simply
  how the real pipeline already works, unmodified.
- **Downloading a Postman collection before a Meeting URL is typed** produces a collection whose body
  contains the `"REPLACE_WITH_MEETING_URL"` placeholder (§4 Screen C) — Arun edits it in Postman before
  sending, same intended-not-a-bug convention v1.0 already established for the copy-JSON path.

---

## 10. Out of Scope

- **Testing `static_bearer`/`oauth2_client_credentials` fetch-auth types.** Every harness-authored screen
  is served publicly with no fetch credential required (`auth_type: 'none'`) — this brief tests
  rendering/transition behavior, not the B2B-19 fetch-auth mechanisms themselves (those already have
  their own unit tests per `docs/specs/B2B-19-requirement-document.md` AT-1 through AT-4). A future
  extension could add a mock-credentialed fetch target if that specific mechanism ever needs its own
  regression fixture — not requested here.
- **Live, in-tool session status/transcript after a successful dispatch.** `"Dispatch now"` shows the
  real endpoint's immediate `201` response (`clio_session_ref`/`status`/`render_url`) and stops there —
  Screen C does not poll for status changes, does not embed a live view of `/partner-render/[ref]`, and
  does not surface billing/wallet-balance state. Arun opens the `render_url` link himself to watch the
  session if he wants to (§4 Screen C success state).
- **A "cancel this session" / stop-the-bot button.** Not built — if Arun wants to end a dispatched test
  session early, that's an out-of-tool action (however a real partner would end one today), not part of
  this brief.
- **Syncing the downloaded Postman collection to a Postman workspace/cloud account**, or any Postman API
  integration — this is a static file download only (§6.9), imported manually by Arun if/when he wants
  it in Postman.
- **Embedding the real partner API key directly into the downloaded Postman collection.** Deliberately
  excluded (§6.9, AT-15) — the collection references it via a Postman variable Arun fills in himself.
- **Automatic top-up or balance management for the harness's test-mode wallet.** If test-minutes are
  ever exhausted (§9 edge case), that surfaces as a real dispatch error like any other — no auto-refill
  mechanism is built.
- **Syntax highlighting, HTML linting, or any code-editor affordance** in the HTML textarea — a plain
  `<textarea>` is sufficient for hand-authored test fixtures.
- **Any version history / undo for topics or screens.** Editing overwrites in place; there is no
  "restore a previous version" feature.
- **Any nav link, cross-link, or shared component with the partner-facing dashboard, `ChannelPartnerShell`,
  or B2B-31 Showcase.** Zero code or route overlap by design (Known Constraint 2).
- **Testing the dual-signal transition-marker mechanism's internals** (marker uniqueness, collision
  re-roll, transcript-watch vs. tool-call race) — those are already covered by B2B-19's own AT-Q-B-1
  through AT-Q-B-4 unit tests; this tool exercises that machinery end-to-end via a real dispatch, but
  does not add new automated coverage of the marker engine itself.
- **Any change to `CreateSessionSchema`, `ContentPageSchema`, `safeFetchPartnerPage`,
  `resolveInlineSessionRender`, or any other B2B-19 file.** 100% reuse, unmodified (Known Constraint 3).

---

## 11. Open Questions

None. Both questions carried open in v1.0 were answered directly by Arun on 2026-07-21 and are recorded
as settled requirements in §0 points 9 and 10, with every dependent section (§2, §4 Screen B/C, §5, §6,
§7, §8, §9, §10) revised accordingly:

- **Q1 — Data retention:** *"we can persist with the last entry. have a save button."* → indefinite
  persistence, no auto-expiry, explicit Save-button-gated (never autosave), edits overwrite the latest
  entry (no version history).
- **Q2 — Dispatch UX:** *"we can fire real api session. also enable a option to download the collection
  to trigger through postman."* → both an in-tool "Dispatch now" button (§0 point 10a, §4 Screen C,
  §6.8) and a "Download Postman collection" action (§0 point 10b, §4 Screen C, §6.9) ship together.

---

## 12. Dependencies

- **B2B-19** (`CreateSessionSchema`, `ContentPageSchema`, `POST /api/partner/v1/content-sources`,
  `resolveInlineSessionRender`, `safeFetchPartnerPage`, the sandboxed-iframe bot-side render) — must
  exist; it does, shipped, migration 083, confirmed by direct code read (`lib/partner/live-render.ts`,
  `lib/partner/content-sources.ts`, `lib/partner/ssrf.ts`).
- **B2B-05** (`middleware.ts`'s host-resolution scaffold, `CLIO_ROOT_DOMAIN`,
  `lib/partner/domain-resolution.ts`) — must exist; it does, shipped. The `*.{CLIO_ROOT_DOMAIN}` wildcard
  domain being **actually provisioned** against the Vercel project is a separate one-time infra action
  this brief depends on but does not perform (§0 point 4, §9 edge case) — confirm it is live before
  expecting `test.hello-clio.com` to resolve in production.
- **`app/api/admin/partner-keys/route.ts`** (existing, unmodified) — the mechanism the one-time account
  provisioning step (§6.1) uses to mint the harness's real partner API key.
- **One-time account provisioning** (§0 point 7, §6.1) — a new `partner_accounts` row + `partner_admin_users`
  grant + a minted **test-mode** API key, performed once by the Orchestrator before Screen C's payload
  assembly can ever succeed end-to-end (the lazy content-source registration call will otherwise fail
  with no owning account to attach to). Not a code deliverable of this brief, but a hard precondition for
  it to work. **v1.1 raises the bar on this step:** the minted key must now be recorded in **two**
  places, not one — handed to Arun directly (Postman path, §6.9) **and** set as
  `TEST_HARNESS_PARTNER_API_KEY` in Vercel env config (in-tool dispatch path, §6.8) — both dispatch
  paths are now real code deliverables of this brief and both are inert until that env var is a real
  value, not a `PLACEHOLDER_`.
- No new external vendor. Supabase Storage (§0 point 3) is part of the already-approved
  `@supabase/supabase-js` SDK, not a new package or credential. The in-tool dispatch route (§6.8) calls
  Clio's own first-party `POST /api/partner/v1/sessions` endpoint, not a third-party API — no new vendor
  approval needed for it either.

---

*End of Requirement Document (v1.1). All 8 of the CEO brief's questions are resolved as concrete
decisions in Section 0 — six as BA technical decisions, two (retention, dispatch UX) as Arun's own
direct answers recorded verbatim in §0 points 9/10. Section 11 is empty. Ready for CEO review; on
approval, proceed to Dev.*
