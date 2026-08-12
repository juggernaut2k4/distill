# 2026-08-10 — Multi-Voice Widget Agent: Decisions & Discussion Log

Standalone log for the multi-voice/language ElevenLabs work and whatever we brainstorm next in
this thread. Kept separate from `docs/b2b-pivot-status.md` (the B2B pivot backlog) since this is
its own thread of work. Updated live as decisions land — not batched.

> **Terminology note, added 2026-08-11 after the CEO Agent flagged it:** every use of "reseller"
> below (starting at "Production `bot-dispatch` API" and continuing through D10 onward) refers to
> the same entity as the already-shipped **sales-partner** model (B2B-26/28,
> `account_kind = 'channel_partner'`) — not a new, parallel concept. Arun's explicit decision:
> keep the name **sales-partner**, not reseller. The word "reseller" is left in place below only
> because it's a historical record of how the discussion actually happened — read it as
> sales-partner throughout.

---

## Context

Arun configured three separate ElevenLabs agents (not multiple voices on one agent), each with its
own voice:

| Voice | Language | Agent ID |
|---|---|---|
| Catherine (default) | US English | `agent_0701krp1ta48fswrff17ctb0520m` |
| Anjura | Hindi | `agent_4701kzq913nrep3s92229bwhkbdr` |
| Vani | Tamil | `agent_2201kzq90jdkeww9z4n1rn1vex2d` |

Goal: let the same English source content be explained live in any of the three voices/languages,
selectable per session on the demo (`/demo/claude-ai`, `/demo/oop-fundamentals`).

---

## Decisions

### D1 — Per-session agent selection, not a system-wide toggle
**Decision:** Add an optional `elevenlabs_agent_id` on `partner_sessions` (migration 113), resolved
per session at token-mint time, falling back to the existing system-wide default in
`system_voice_config` when unset.
**Why:** The client widget never references `agent_id` directly — it only uses a
`conversationToken` minted server-side and permanently bound to whichever `agent_id` minted it. So
the entire selection mechanism could live in one file (`app/api/elevenlabs-token/route.ts`) with
zero changes to the adapter, prompt assembly, or connection logic.
**Status:** Built and deployed (commit `a52346f`).

### D2 — Voice selector lives in the single shared demo client component
**Decision:** The 3-option selector was added to `DemoTopicClient.tsx`'s Widget Demo tab.
**Why:** That component is the single shared client behind both `/demo/claude-ai` and
`/demo/oop-fundamentals` (same `[slug]` dynamic route), so building it there satisfies "needed for
both demo topics" by construction — confirmed by the build output listing both static routes.
**Status:** Built and deployed (commit `a52346f`).

### D3 — Voice choice does NOT automatically translate content
**Discussion:** Arun asked whether giving English content and picking a Hindi/Tamil voice would
make Clio explain in that language, or whether the content itself needs to already be in that
language.
**Finding:** No, not automatically. Two separate concerns:
- **Voice** — which ElevenLabs agent/TTS voice connects (what D1 controls).
- **Language** — whether the model is instructed to translate and explain in that language. This
  requires an explicit instruction inside the session's system prompt.
Since Clio's own code replaces the agent's entire dashboard-configured system prompt on every
session call (`overrides.agent.prompt.prompt`), a language setting made only in the ElevenLabs
dashboard would never reach the model — Clio's own generated prompt overwrites it every time.

### D4 — Language instruction reuses the existing `conversationLanguage` mechanism
**Decision:** Wire voice selection to also set the existing `conversation_language` field
(already used by real resellers via the generic `language` param on `POST /widget-sessions`),
which already flows end-to-end into `assembleWidgetElevenLabsPrompt`'s `buildLanguageInstruction()`
— no new mechanism needed, just connect the demo's voice picker to it.
**Mapping:** Catherine → no language field sent (prompt byte-identical to before this feature
existed) · Anjura → `"Hindi"` · Vani → `"Tamil"`.
**Instruction text actually injected into the prompt:** *"Conduct this entire live session in
{Language}. All spoken content — your explanations, questions, and responses — must be in
{Language}, even though the reference material provided below in SESSION CONTENT is written in
English. Translate and explain that material naturally and fluently in {Language}; never read it
verbatim in English, and never switch languages mid-session unless the participant does so first."*
**Status:** Built and deployed (commit `5f29ed1`).

### D5 — Verified live
Confirmed working via a real Tamil (Vani) test call
(`clio_session_ref b167d651-580f-4920-82e3-4dd05f702524`, ElevenLabs
`conv_9901kzqc7m0eea7v3z3x7za9r871`) — Arun checked the actual recorded prompt/behavior and
confirmed it's working well.

---

## Production `bot-dispatch` API (new thread, started after the voice/language work above)

**Context:** Arun wants a real production equivalent of the demo's `/api/demo/[slug]/widget-dispatch`
route — today there is no such thing; a real reseller calls `POST /api/partner/v1/widget-sessions`
directly. This new endpoint would be the reseller-facing "start a bot call" entry point.

Proposed shape: `POST hello-clio.com/api/prod/[content_id]/bot-dispatch`, sent by the reseller with
`end_user_name` + their `passcode`.

### D6 — Reseller owns passcodes and content IDs; content stays inline, not pre-registered
**Decision:**
- The **reseller maintains their own passcodes**, one per reseller↔client combination — they mint
  as many as they want, so they can tell which client's activity is which just by which passcode
  was used to dispatch.
- The **reseller maintains their own `content_id` per content/topic** they have — `content_id` in
  the path is a routing/tracking label (which topic this is), not a lookup key into content we
  already have stored.
- **Content stays inline, sent by the reseller on every call** — same model `widget-sessions` uses
  today (confirmed: no reversion to the old pre-registered-container model that was retired). The
  reseller sends their content in the format our prompt assembly expects, and we parameterize it
  into the session prompt directly.
**Action item:** This content-format requirement needs to be written into the reseller-facing API
documentation (the `/dashboard/configurator/api` docs page) once `bot-dispatch` is built — resellers
need to know exactly what shape their content has to be in.
**Backlog (low priority, keep last):** Build tooling to help resellers format their own content into
the shape our prompt expects, rather than requiring them to hand-craft it to spec.

### D7 — `bot-dispatch` eliminated; resellers call `bot-sessions` directly (supersedes D6's passcode-as-auth framing)
**How we got here:** Working through the auth-model question above, we hit a real constraint —
reseller API keys are stored as a one-way hash (`hashApiKey()` → `key_hash`, same as every partner
API key today), so a "passcode validates → we fetch the stored API key" design isn't possible; a
hash can never be reversed back into the raw key, regardless of which table it lives in.

**Decision:** Instead of a passcode-based relay layer, **each API key a reseller creates is scoped
to exactly one reseller↔client pairing** — same granularity passcodes were meant to have in D6, but
carried by the key itself instead of a separate passcode. The reseller generates these keys
themselves (from their dashboard), holds the raw value, and sends it directly —
`Authorization: Bearer <their own per-client key>` — on every call, exactly like `widget-sessions`
authenticates today. Once the key hashes and matches, we already know both the reseller and the
specific client — no separate passcode, no internal credential-fetching step, nothing new to
invent on the auth side.

**Consequence — `bot-dispatch` is not built at all.** Walking through everything it was going to
do, every piece is either redundant now or already handled inside `widget-sessions`:
- Identity resolution (reseller + client) — now the API key's job, not a passcode's.
- Fetching a credential on the reseller's behalf — gone; the reseller uses their own real key.
- Duplicate-dispatch protection — already covered by `widget-sessions`' existing
  `reseller_unique_id` idempotent-replay behavior.
- Content shape validation — already done inside `widget-sessions`' own schema + processing steps
  (see below), not something a relay layer needs to redo.
- A tracking row linking the dispatch to an account — was specifically needed because the demo
  routes many passcodes through *one* shared internal demo account; in production the session row
  already carries `partner_account_id`/`client_id` straight from the resolved key, so there's
  nothing extra to link.

**So production is:** the reseller frames the complete request themselves — endpoint, their own
per-client key as auth, full body — and sends it straight to `bot-sessions` (the production-named
`widget-sessions`), the exact same proven shape documented in D5/earlier in this thread.
`content_id` becomes a body field the reseller includes (for their own topic tracking), not a
resolution step Clio performs.

**What `bot-sessions` actually does with the reseller's content before returning `render_url`**
(unchanged from how `widget-sessions` already works today — nothing new to build here either):
1. Structural validation of `content_pages` (required shape per page).
2. Content-source check — `content_source_id` resolved and confirmed to belong to the account.
3. Per-page URL safety check (SSRF guard — must be `https`, must be a genuinely public host).
4. Transition-marker generation — computed server-side from each page's title/subtitle/
   `transition_trigger` text, not sent by the reseller.
5. `expected_duration_minutes` resolved (from the request or defaulted).
Only after all of that succeeds does the wallet/balance gate run and `render_url` get generated.

### Still open
- **`reseller_id`/`client_id` body-field redundancy** — today `widget-sessions` cross-checks a
  separately-supplied `reseller_id` field against the account resolved from the key (since one key
  currently maps to a whole account). With keys now scoped 1:1 to reseller-client, the key alone
  already carries both — so those two body fields either become redundant or shrink to an optional
  double-check. Not yet decided.
- Everything under D6's "Action item" and "Backlog" still applies (content-format docs,
  low-priority formatting tooling) — those weren't specific to the passcode design, they carry
  forward unchanged.

---

## Field-by-field review of the `bot-sessions` request body (started 2026-08-11)

Going through the full field list (content fields all confirmed fine as-is) one at a time,
starting with the still-open/discussion-worthy ones.

### D8 — `partner_end_user_ref`: keep, optional, no Clio-side use
**What it is:** the reseller's own internal ID for the *specific individual person* on the call —
distinct from `client_id`, which identifies the *company/client* they belong to. E.g. their LMS
user ID, employee ID, or CRM contact ID for that person.
**Decision:** kept as optional. Clio's own logic never reads or acts on it — it's purely stored and
handed back later (reporting/usage APIs) so the reseller can correlate a session back to a specific
person in their own system. Without it, a reseller only gets client-level tracking, not
person-level — that's the entire tradeoff of omitting it.

### D9 — `partner_reference`: free-text session tag; NOT a production duplicate-guard
**What it is:** a free-text label the reseller attaches to the *session* (not a person) — e.g.
`"onboarding-week1-day3"` — for their own tagging/context, not enforced to any format by Clio
beyond the schema's own `1–256 chars, printable ASCII` constraint.
**Important clarification surfaced during this discussion:** in the demo, this same field is
*also* reused internally for a duplicate-active-session guard — the demo's dispatch route looks up
`partner_reference == slug AND delivery_channel == 'widget' AND partner_account_id == <demo account>`
to block a second concurrent dispatch for the same topic. **This is demo-specific relay logic,
not part of `widget-sessions`/`bot-sessions`' own contract** — the real endpoint just stores
`partner_reference` and never uses it to block or dedupe anything. If a reseller wants duplicate
protection, `reseller_unique_id` is the mechanism that actually does that (real idempotent replay).
**Action item — documentation:** the reseller-facing docs need to explicitly teach both of these
fields, including:
- `partner_end_user_ref` and `partner_reference` are both optional, freeform, purely for the
  reseller's own bookkeeping/correlation.
- Suggested (not enforced) pattern for `partner_reference` for readability: a short kebab-case
  label like `{campaign-or-topic}-{cohort-or-batch}`, since it's meant to be a human-scannable tag,
  not a random ID.
- Explicit callout that `partner_reference` does **not** provide duplicate-session protection in
  production — that's what `reseller_unique_id` is for — so resellers don't wrongly assume reusing
  a `partner_reference` value blocks a second concurrent session.

---

## Application-wide role model (new thread, 2026-08-11 — this is bigger than the pipeline)

Arun: the rebuild isn't scoped to the pipeline alone — the application changes significantly to
align with this. Forward-design mode from here — see the standing memory note on not anchoring to
current code/production behavior unless it's a hard constraint.

### D10 — The five roles
- **`end_user`** — the people who belong to a client (e.g. employees of Capgemini, subscribers of
  Pluralsight) and actually take Clio sessions.
- **`client`** — the organization that owns the content (e.g. Capgemini, Pluralsight).
- **`reseller`** — a team/org using hello-clio as a white-label product; converts a client's
  existing training material into something Clio can teach from. Resellers pay Clio (purchase
  usage minutes) and sub-allocate/sub-charge those minutes to their own clients at rates the
  reseller sets themselves.
- **`internal_staff`** — lowest access; supports clients/resellers/admin. Tagged with
  `parent_type` + `parent_id`, and can support **only** whoever they're allocated to (e.g.
  `parent_type: reseller, parent_id: <reseller_id>` → can support only that one reseller).
  `parent_type` is polymorphic — reseller, client, or admin are all valid.
- **`admin`** — full access; invites resellers; monitors all activity/logs; ensures resellers have
  enough minutes; proactively (automated) notifies resellers to recharge/top up; fixes glitches;
  gives resellers usage/business insights. Admins can invite/create more admins with equal
  capabilities (flat, no admin tiers).

### D11 — Clients never log in; role identity is admin-only-visible
**Decision:** A client never gets their own login. If a client ever needs to log in, they get
invited as a **reseller** instead — there's no separate client-facing account type.
**Also decided:** at no point should any user (reseller or otherwise) see that their own role is
"reseller" anywhere in their own UI — role labeling is visible **only to admin**. Everyone else
just sees their own product experience, unlabeled by role.

### D12 — No reseller-to-client billing tracked by Clio
**Decision:** Clio does not track or facilitate the reseller's sub-billing of their clients at all
— that's entirely the reseller's own external business. We only ever see reseller-level minutes/
usage on our side.

### D13 — end_user is stateless; NO PII may ever be persisted (hard rule, saved to core memory)
**Decision:** `end_user` is not a persistent account — just a per-session identifier. Session-time
inputs (name, domain, industry, language) are used live to personalize the session and produce the
after-session insight sent back to the reseller, but **none of it may be saved anywhere
persistent** — no database column, no transcript store, no log line. Arun's explicit instruction:
proactively flag it, in the moment, any time code does or would violate this — don't wait to be
asked.
**`end_user_name` — explicit exception, resolved.** Arun confirmed `end_user_name` is
intentionally allowed to be persisted — not a violation, no change needed there.
**Still open:** session transcripts remain a harder problem — an end_user could say identifying
information out loud during a live conversation (email, employer details, etc. beyond their name),
and freeform speech isn't easily scrubbed for PII automatically. Not yet solved.
**Saved to core memory** as a standing rule (`feedback_no_end_user_pii_persistence.md`, updated
with the `end_user_name` exception) — this governs all future code, not just this thread.

---

## Checkpoints (revert points)

- `20af1e2` — before the multi-voice-agent feature started (main, confirmed clean).
- `a52346f` — voice/agent selection only, no language instruction.
- `5f29ed1` — current: voice selection + language instruction, live and confirmed working.

---

## Open items

- Whether the `reseller_id`/`client_id` body fields stay, shrink to optional, or get dropped now
  that the per-client API key already resolves both (see "Still open" under D7).
- Reseller-facing dashboard UI to let a reseller generate/manage their own per-client API keys —
  not yet designed.
- `bot-sessions` (the production-named entry point) needs to be documented in the reseller-facing
  API docs, including the content-format requirement (per D6) and the per-client key model (per D7).
- Documentation must explain `partner_end_user_ref` and `partner_reference` in detail — what
  they're for, optional status, suggested (non-enforced) format for `partner_reference`, and the
  explicit callout that `partner_reference` is NOT a duplicate-session guard in production (per D9).
- Remaining request-body fields still to review one by one: `reseller_unique_id`, `language`,
  `elevenlabs_agent_id`, `reseller_id`, `client_id`.
- **PII conflict (D13, still open):** how, if at all, do we handle an end_user volunteering
  identifying info out loud mid-conversation, given transcripts get stored today? (`end_user_name`
  itself is resolved — explicit exception, no longer open.)
- Backlog, low priority: reseller-facing tooling to help format content into our prompt's expected
  shape.

---

## Multi-step production flow: `bot-dispatch` reintroduced (2026-08-11 continued)

Revisiting D7 — `bot-dispatch` comes back, but not as a relay/credential layer (that part of D7
still stands). This time it's a genuine **first stage of a multi-step session lifecycle**, not a
monolith. Same overall work `widget-sessions` does today, just decomposed into stages instead of
one call.

### D14 — `bot-dispatch` is stage 1: identity + reservation only
**Decision:** `bot-dispatch` takes `end_user_name` + the reseller's passcode (still per D6/D7 —
uniquely generated per reseller↔client pairing, alongside their separately-generated per-client API
key), resolves passcode → billing account (which reseller, which client), and returns a
`session_id`. That `session_id` becomes the umbrella key referenced by every subsequent call in
the session's lifecycle (content submission, status, ending, insights) — not just one.
**Everything else** — content, voice/language, wallet gate, `render_url` generation — moves to
stage 2, `bot-sessions` (production name for `widget-sessions`), referencing that `session_id`.
**Auth on stage 2+ calls:** confirmed — the existing key-based auth mechanism still applies in
full; `session_id` alone is never sufficient credential on its own.

### Still open
- Exact response shape of `bot-dispatch` beyond `session_id` — not yet defined.
- **Expiry/cleanup for unclaimed dispatches** — confirmed needed (Arun: "yes we need expiry and
  cleanup for sure"), mechanism not yet designed. A reseller could call `bot-dispatch`, get a
  `session_id`, and never follow up with content — what happens to that reserved session?

---

## Delivery mode & white-label domains (2026-08-11 continued)

### D15 — Delivery is a genuine inline iframe, not a redirect/new tab
**Decision:** clicking "learn along with AI" on the client's own page (e.g.
`pluralsight.com/learnClaude`) reveals an **iframe embedded directly on that same page**, pushing
the existing page content down to make room, and the session runs right there. **Not** a new
tab/window — the end_user never leaves the client's own page or sees a separate address bar.

### D16 — Every reseller gets their own custom domain for the iframe `src`; no shared `hello-clio.com` fallback
**How we got here:** even though a true inline iframe is invisible to the end_user, the *client's*
own security/IT team still has to explicitly whitelist whatever domain the iframe loads from (CSP
`frame-src`, firewall policy, etc.) — that decision happens at the client level regardless of
end_user visibility. Asking a client to whitelist an unfamiliar shared vendor domain
(`hello-clio.com`) they have no direct relationship with is a much harder sell than whitelisting a
domain tied to the reseller they already have a contract with.
**Decision:** every reseller gets their own custom domain/subdomain (e.g. `widget.ailearn.com`) for
their iframe embeds. No exceptions, no shared `hello-clio.com` fallback offered.
**How it actually works (confirmed mechanism, nothing changes hands):**
1. Reseller picks a subdomain of a domain they already own (e.g. `widget.ailearn.com`).
2. Reseller adds one DNS record (a CNAME) on their own DNS provider, pointing that subdomain at a
   target our hosting platform (Vercel) gives us. We never touch or access their domain account.
3. We register that domain against our Vercel project via the Vercel Domains API (already an
   approved integration in this codebase for exactly this purpose); Vercel checks the DNS actually
   points to us, and once confirmed, auto-issues a TLS certificate — no domain purchase or
   ownership transfer of any kind, purely a DNS-pointing + verification step.
4. Our own database records which domain belongs to which reseller; host-based routing (already a
   pattern that exists in `middleware.ts` for a different purpose) recognizes the incoming `Host`
   header and serves the exact same underlying session logic regardless of which registered domain
   the request arrived on.

### D17 — Onboarding automation: reseller does one manual DNS step, everything else is automated
**Decision:**
- **Step 2 (DNS record)** — cannot be automated on our side (we don't control the reseller's DNS
  account), but the reseller-facing dashboard should generate the exact record to add and offer a
  **"Verify" button** giving real-time pass/fail feedback, rather than leaving them to guess.
- **Step 3 (registering + verifying the domain with our platform, issuing the cert)** — fully
  automatable via the existing Vercel Domains API integration: reseller types their desired domain
  into a dashboard form, we call the API to register it, the same "Verify" button polls status
  through that API, and the domain goes fully live the moment DNS confirms — zero manual admin
  work on our side.
**Action item — documentation:** the reseller-facing docs need a detailed, step-by-step guide for
domain setup (D16's 4 steps), written for a non-technical reseller audience, alongside whatever
dashboard UI gets built for it (per D17's automation split).

### D18 — Pre-domain test approach: verify the iframe mechanism itself before any real custom domain exists
**Decision:** the custom-domain work (D16/D17) and "does embedding this in an iframe actually
work" are two separable questions — the second can be fully verified without any real domain,
before a single reseller signs up.
**Checked already:** no `X-Frame-Options` or CSP `frame-ancestors` restriction exists anywhere in
this app's config today, so there's no known code-level blocker to being framed by another origin.
**Test approach (to run when ready, against a real live call):**
1. Take a real, already-working `render_url` from a live dispatch.
2. Create one throwaway HTML file containing just `<iframe src="<that render_url>">`, and open it
   from **any different origin** — a different local port, a free static host, a quick sandbox
   link. It doesn't need to be a real business domain; the only requirement is that it's a
   genuinely different origin from `hello-clio.com`, to prove cross-origin embedding works at all.
3. **Two things to specifically verify** while doing this (real risks unique to running a live
   voice session inside an iframe, not just loading a static page in one):
   - **Microphone permission** — the `<iframe>` tag needs an explicit `allow="microphone"`
     attribute (and the embedding page's own permissions policy must not block it), or the browser
     silently denies mic access inside the frame even though the same page would work fine
     standalone.
   - **The actual live voice connection** (WebRTC/audio to ElevenLabs) working correctly from
     inside a nested iframe context, not just confirming the page visually renders.

---

## `bot-sessions` field review, continued (2026-08-11 continued)

### D19 — Full `bot-sessions` field list, including the `session_id` link from `bot-dispatch`
Consolidated list (superset of the earlier `widget-sessions` review, D6/D8/D9, plus what carries
over from `bot-dispatch`):

| Field | Notes |
|---|---|
| `session_id` | **New** — links this call to the `bot-dispatch` (stage 1) reservation |
| `content_pages` | Content pages to teach |
| `content_source_id` | Which registered content source these URLs belong to |
| `content_to_explain` / `content_title` / `content_subtitle` | Session overview/title/subtitle |
| `expected_duration_minutes` | For the wallet/balance check |
| `content_id` | Reseller's own topic/content label (D6) |
| `end_user_role` / `end_user_industry` | Personalization inputs |
| `partner_end_user_ref` | Reseller's own person-level correlation ID (D8, optional) |
| `partner_reference` | Reseller's own session tag (D9, optional, NOT a duplicate-guard) |
| `reseller_unique_id` | Idempotency key |
| `language` | Language to teach in — still open whether reseller-facing |
| `bot_id` | See D20 below — was `elevenlabs_agent_id`, renamed |
| `reseller_id` / `client_id` | Still open — possibly redundant now the key resolves both |

**Still open:** whether `end_user_name` (captured at `bot-dispatch`, stage 1) needs to be re-sent
here too, or stays tied to `session_id` server-side without repeating.

### D20 — `elevenlabs_agent_id` renamed to `bot_id`; three-layer indirection, never reveals our vendor stack
**Decision:** the field is renamed `bot_id` — explicitly to avoid revealing our underlying tool
stack (ElevenLabs) to resellers or anyone inspecting the API, consistent with the white-label
positioning (D10/D11).
**The actual design (three layers of indirection):**
1. **Real ElevenLabs agent ID** (e.g. `agent_0701...`) — fully hidden, Clio-internal only, never
   exposed anywhere.
2. **Our own catalog name** (e.g. `clio_english`, `clio_english_fast`) — agents Clio has
   configured, organized by language. A reseller only sees these after enabling that language in
   their dashboard (via a `+` button that adds a language from our available list).
3. **The reseller's own custom alias** (e.g. `english_bot`) — a name the reseller picks themselves,
   mapped in their own dashboard to one of our catalog agents from layer 2.
**Resolution at request time:** the reseller sends `bot_id: "english_bot"` — we look up, *scoped to
that specific reseller's account*, what `english_bot` maps to → `clio_english` → the real hidden
agent ID → used for the session. Two different resellers can each independently name their own
alias `english_bot` pointing to entirely different (or the same) underlying agents — no collision,
since resolution is always reseller-scoped.
**Consequence for validation:** `bot_id` can no longer be checked against one small global list of
known values (how the demo version works today) — it requires a per-reseller lookup instead.
**Standing naming principle (generalizes beyond this one field):** reseller-facing field/API names
should never reveal which third-party vendors power Clio internally — consistent with D11's
"role identity is admin-only-visible" philosophy, just extended to vendor/tool-stack identity too.

### D21 — Documentation must give worked examples + ID-format guidance for every field
**Decision:** the reseller-facing docs need to go beyond just naming/describing each field — for
every ID-shaped field specifically, either (a) give explicit guidance on how to construct a sensible
value, or (b) explicitly tell resellers they're free to use their own pattern, with a worked example
either way. This applies across the whole `bot-dispatch`/`bot-sessions` field set, not just one
field — folds together with the earlier D6/D9 documentation action items into one broader
documentation requirement.

### D22 — `bot-sessions` response shape
**Decision:**
```json
{
  "session_id": "<same session_id issued by bot-dispatch>",
  "status": "widget_active",
  "render_url": "https://<reseller's own domain>/widget-render/<session_id>"
}
```
`session_id` is not reissued — it's the exact same one `bot-dispatch` handed back in stage 1 (the
whole point of it being the umbrella key, per D14). Error responses mirror `widget-sessions`' own
typed `{ error: { code, message } }` shape today — validation failures, content-source/URL
rejection, and the wallet-gate codes (`card_required`, `trial_exhausted`, `funding_required`,
`balance_exhausted`).

### D23 — Long content: `content_to_explain` is a short overview, bulk content goes in `content_pages`
**Context:** `content_to_explain` is capped at 5000 chars — real reseller content can be much
longer than that.
**Checked:** each individual `content_pages[i].content_text` is capped at 6000 chars, but
`content_pages` is an **array** — a reseller can send as many pages as they need.
**Decision:** don't raise `content_to_explain`'s limit. `content_to_explain` is meant to be a
short overview/summary (5000 chars is already generous for that purpose) — it is **not** where
bulk content belongs. The actual long-form content goes into `content_pages`, split across as many
pages as needed (one page per logical topic/section/chapter — the exact same pattern the demo
topics themselves already use), each page capped individually at 6000 chars. This gives
effectively unlimited total content length through chunking, without raising any limit, and plays
naturally with the transition-marker system, which already expects content organized page-by-page
rather than as one giant blob.
**Action item — documentation:** must explicitly tell resellers this pattern — short overview in
`content_to_explain`, real content split across multiple `content_pages` — since it isn't
obvious from the field names/limits alone. Folds into D21's broader documentation requirement.

---

## Session log

- **2026-08-10, paused/resumed:** landed on the clean pipeline design — no `bot-dispatch` relay
  layer needed at the time, resellers call `bot-sessions` directly with per-client keys.
- **2026-08-11, continued:** broadened into a full application role model (D10–D13, including the
  end_user PII rule saved to core memory), a multi-step production flow (D14, reintroducing
  `bot-dispatch` as stage 1 of a session lifecycle rather than a relay layer), the delivery/domain
  design (D15–D18, inline iframe + mandatory per-reseller custom domains + a pre-domain test plan),
  and a full `bot-sessions` field review (D19–D23: the `bot_id` vendor-hiding rename/design,
  documentation requirements, response shape, and the content-length chunking pattern).
- **Next:** settle remaining open items above, then move toward an actual BA spec once the shape is
  fully locked (per the CEO→BA→Dev gate).
