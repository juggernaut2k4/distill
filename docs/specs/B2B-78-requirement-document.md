# B2B-78 — Production Session Pipeline: `bot-dispatch` + `bot-sessions`
# Requirement Document
Version: 1.1
Status: APPROVED (CEO, 2026-08-11) — cleared for Dev, per the CEO→BA→Dev gate; Section 11 is empty
Author: Business Analyst Agent
Date: 2026-08-11

Changelog: v1.1 — fixed a literal `REFERENCES ???` placeholder in §6.3's `bot_catalog_agents` schema
block (a CEO-review-flagged mechanical defect: `ELEVENLABS_VOICE_OPTIONS` is a TypeScript array, not a
table, so no FK can point at it) — `elevenlabs_voice_key` is now plain `TEXT NOT NULL`, matched at the
application layer, with the reasoning stated inline. Also recorded the CEO's explicit sign-off on §4.A's
proposed `bot-dispatch` response shape, which v1.0 had correctly flagged as a pending proposal — it is no
longer pending. No other content changed from v1.0.

Source Feature Brief: `.claude/agents/clio/feature-briefs/B2B-78-bot-dispatch-bot-sessions-production-pipeline.md`
Source brainstorm: `docs/2026-08-10-voice-language-brainstorm.md`, D6–D9, D14, D19–D23.
Depends on: `docs/specs/B2B-77-requirement-document.md` (terminology table §6.1, PII rule §6.4 — every
`end_user_*` field in this document inherits that rule unchanged).
Prior art read in full: `app/api/partner/v1/widget-sessions/route.ts`,
`lib/partner/widget-session-schema.ts`, `lib/partner/session-schema.ts`, `lib/partner/auth.ts`,
`lib/partner/api-keys.ts`, `supabase/migrations/100_b2b39_demo_passcodes_and_billing.sql` (the
`demo_passcodes` table this document's new passcode table mirrors), `lib/voice/elevenlabs-agents.ts`,
`inngest/partner-session-trace-log.ts` (purge-job structural precedent),
`docs/specs/B2B-34-requirement-document.md` Part B (`client_id` architecture),
`app/(with-clerk)/dashboard/channel-partner/clients/[id]/configure/api/page.tsx`.

---

## 0. Headline finding — the live API already answers several of this brief's "still open" questions

The brainstorm this brief is based on treated `reseller_id`, `reseller_unique_id`, `client_id`, and
`language` as unresolved design questions for a *future* endpoint. They are not future — **they are the
exact, already-shipped request fields on `POST /api/partner/v1/widget-sessions` today**, confirmed by
reading `lib/partner/widget-session-schema.ts` and the route handler directly:

- `reseller_id` — required UUID, cross-checked against `auth.partnerAccountId` (422 `invalid_reseller_id`
  on mismatch) — live, not proposed.
- `client_id` — optional UUID, required only when the authenticated account's `account_kind` is
  `channel_partner`, validated against `owning_channel_partner_id` — live, not proposed.
- `reseller_unique_id` — the real idempotency key, enforced via a unique-constraint-triggered replay
  branch that returns the original session's `render_url` — live, not proposed.
- `language` — already sales-partner-facing today (B2B-62), flows into the assembled Hume prompt.

This closes Brief §6 Q4/Q5/Q6 outright: this document's job is not to decide these fields' shape for a
hypothetical future endpoint, but to **carry the already-proven, already-live shape forward unchanged**
into `bot-sessions`, and to design the genuinely new piece — `bot-dispatch` as a real first stage with its
own reservation row, expiry, and cleanup — on top of it. This also means the wire-naming question (§6 Q4,
whether to rename `reseller_id`/`reseller_unique_id`) is not a hypothetical style choice on a new field —
it is a real-or-no decision to rename an **already-integrated production field name**, which sharpens the
answer considerably (see §6.1).

---

## 1. Purpose

Today's real production entry point, `POST /api/partner/v1/widget-sessions`, is a single call: content,
identity, and delivery all resolve atomically, with no way to reserve a session slot before the content
is known. This doesn't match how a real integration wants to work — a client's own "learn with AI" button
click needs to reserve *something* the instant it's clicked, before the calling code has necessarily
assembled what content to teach. `bot-dispatch` is that reservation stage. Without it, every sales-partner
integration is forced into a single, monolithic call that couples "a learner clicked" to "we know exactly
what to teach them" — a coupling real integrations (an LMS button, a live meeting-join flow) don't
naturally have.

**What failure looks like without this document:** B2B-78 ships as a copy of `widget-sessions` renamed to
`bot-sessions`, with no reservation stage, and every sales-partner integration keeps needing to solve the
"reserve now, fill in content later" problem themselves — the exact gap Arun described wanting to close.

## 2. User Story

**Story 1 — Sales-partner's own backend, at the moment an end_user clicks "learn with AI"**
As the reseller's server handling that click,
I want to immediately reserve a session and get back a stable reference, before I've necessarily resolved
what content to teach,
So that the click has an instant, correct response even if content resolution takes another round-trip.

**Story 2 — The same backend, moments later, once content is known**
As the reseller's server,
I want to call a second endpoint with that reservation's reference plus the actual content, and get back
a working `render_url`,
So that the two concerns — "reserve" and "deliver" — are cleanly separated.

**Story 3 — A sales-partner who names their own agent alias**
As a sales-partner configuring their own voice options,
I want to give my own name to a voice Clio has made available to me, and use that name in my own API
calls,
So that nothing in my integration ever needs to know or reveal that Clio runs on ElevenLabs.

**Story 4 — A sales-partner who reserves a session and never follows through**
As Clio's own infrastructure,
I want an unclaimed reservation to expire and clean itself up automatically,
So that abandoned integrations or bugs on a sales-partner's side don't accumulate unbounded rows.

## 3. Trigger / Entry Point

- **`POST /api/partner/v1/bot-dispatch`** — sent by a sales-partner's own backend the moment an end_user
  initiates a session (e.g. a button click on the client's page). Auth: **not** the full
  `Authorization: Bearer` API-key mechanism (see §6.1's resolution of Brief §6 Q7) — a lighter-weight
  passcode, scoped to exactly one sales-partner↔client pairing, sent as a body field.
- **`POST /api/partner/v1/bot-sessions`** — sent moments later by the same backend, once content is
  known. Auth: the existing full API-key mechanism (`requirePartnerApiKey`), unchanged — **`session_id`
  alone is never a credential** (C2, restated and enforced per §6.2).
- **State required:** a valid, unrevoked, unexpired dispatch passcode (stage 1); a valid, unrevoked
  per-client API key plus an unexpired, unclaimed `session_id` from stage 1 (stage 2).

## 4. Screen / Flow Description

### 4.A The API flow itself (not a UI screen, but specified to the same rigor)

**Step 1 — `POST /api/partner/v1/bot-dispatch`**
Request body: `{ "end_user_name": "Priya Shah", "passcode": "a1b2-XXXXXXXXXX" }` (exact passcode format
mirrors `demo_passcodes`' proven shape — see §6.4).
Response, 201:
```json
{
  "session_id": "5b1e2b8e-...-uuid",
  "status": "reserved",
  "expires_at": "2026-08-11T20:35:00.000Z"
}
```
This exact shape was submitted as a **proposal** (Brief §6 Q1 explicitly has no prior decision to carry
forward), not silently presented as settled — the BA's reasoning for this specific shape:
`status: "reserved"` gives `bot-sessions` and any future status-polling caller one consistent vocabulary
for the whole session lifecycle (`reserved` → `widget_active` → terminal states, mirroring
`partner_sessions.status`'s existing enum style); `expires_at` lets a well-behaved integration show its
own end_user "this reservation is about to expire" UI without needing to separately know the expiry
policy's duration. **CEO sign-off received** during review of this document's v1.0 draft — Dev builds
against this shape as specified, no longer a pending proposal.

**Step 2 — `POST /api/partner/v1/bot-sessions`**
Request body: everything `widget-sessions` already accepts today (§0), plus `session_id` (new, required)
and `bot_id` (new, replaces `elevenlabs_agent_id` — see §6.3). `end_user_name` is **not** re-sent — see
§6.1's resolution of Brief §6 Q3.
Response, 201 (unchanged from D22, already matches the live `widget-sessions` shape almost exactly):
```json
{
  "session_id": "5b1e2b8e-...-uuid",
  "status": "widget_active",
  "render_url": "https://widget.ailearn.com/widget-render/5b1e2b8e-...-uuid"
}
```
Error responses mirror `widget-sessions`' existing typed `{ error: { code, message } }` shape exactly,
plus two new codes this document adds: `session_expired` (the `session_id` was valid but its reservation
window lapsed) and `session_already_claimed` (a second `bot-sessions` call reused a `session_id` already
consumed by a prior successful call — see §9 edge cases).

### 4.B Sales-partner dashboard — Developer settings (new; coordinated with B2B-79)

Per this project's "ambiguous UX = STOP" rule and the brief's explicit instruction to coordinate
information architecture with B2B-79 (which separately needs a domain-management screen), this document
proposes **one new top-level nav item in the sales-partner's own dashboard**,
`/dashboard/channel-partner/developer`, sitting alongside the existing `Clients`/`Team`/`Settings`/
`Showcase` items in `app/(with-clerk)/dashboard/channel-partner/_shared.tsx`'s nav. It has **four tabs**:
**Passcodes**, **API Keys**, **Bot Voices**, and **Domain** (B2B-79 owns the Domain tab's own spec in
full — this document only reserves its place in the shared nav so the two briefs don't each independently
invent a different home for it).

**Why one page with tabs, not four separate nav items:** all four surfaces are "developer/integration
configuration for this sales-partner account," a single coherent mental model for the person setting up
an integration — splitting them into four separate top-level nav entries would fragment a task a real
sales-partner engineer does once, in one sitting, at integration time. This mirrors the existing
`/dashboard/configurator/api` + `/playground` + `/docs` grouping pattern already established for direct
partners, just widened to cover the additional sales-partner-only concepts (passcodes, per-client keys,
bot aliases) that a direct partner (single-client, one API key) never needs.

**Screen state 1 — Passcodes tab, sales-partner has no clients yet**
```
┌──────────────────────────────────────────────────────────────┐
│  Clio                    Clients  Team  Developer  Settings  │
│  ─────────────────────────────────────────────────────────── │
│  Developer                                                    │
│  [ Passcodes ] API Keys   Bot Voices   Domain                │
│                                                                 │
│  You don't have any clients registered yet.                  │
│  Passcodes are issued per client — add a client first.        │
│                                                                 │
│  [ Go to Clients ]                                            │
└──────────────────────────────────────────────────────────────┘
```

**Screen state 2 — Passcodes tab, with clients**
```
┌──────────────────────────────────────────────────────────────┐
│  Developer                                                    │
│  [ Passcodes ] API Keys   Bot Voices   Domain                │
│                                                                 │
│  Client               Passcode           Status    Actions    │
│  ───────────────────────────────────────────────────────────  │
│  Pluralsight          a1b2-••••••••    Active     [Regenerate]│
│  Capgemini            No passcode yet  —          [Generate]  │
│                                                                 │
│  A passcode identifies which client a bot-dispatch call is    │
│  for. Send it in the "passcode" field of every bot-dispatch   │
│  request for that client.                                     │
└──────────────────────────────────────────────────────────────┘
```
Clicking "Generate" or "Regenerate" opens a one-time reveal, mirroring the existing
`demo_passcodes`/API-key "shown once" convention already used throughout this codebase:
```
┌──────────────────────────────────────────────────────────────┐
│  Passcode generated for Pluralsight                           │
│                                                                 │
│  a1b2-K9dQ7xM2pR                                               │
│                                                                 │
│  This is shown once. Store it securely — Clio cannot show it  │
│  again. Regenerating replaces it immediately.                  │
│                                                                 │
│  [ Copy ]                                    [ Done ]         │
└──────────────────────────────────────────────────────────────┘
```
Regenerating a passcode for a client with an active one shows a plain confirm-free replace (matching this
codebase's existing no-confirm-dialog convention, B2B-21/B2B-26) — the old passcode is immediately
revoked (`revoked_at` set), not deleted, same as every other soft-invalidation pattern here.

**Screen state 3 — API Keys tab**
```
┌──────────────────────────────────────────────────────────────┐
│  Developer                                                    │
│  Passcodes   [ API Keys ]   Bot Voices   Domain               │
│                                                                 │
│  Client               Key                  Mode   Status  ...  │
│  ───────────────────────────────────────────────────────────  │
│  Pluralsight          clio_live_sk_...a1b2 Live   Active [Revoke] │
│  Pluralsight          clio_test_sk_...9f3c Test   Active [Revoke] │
│  Capgemini            —                    —      —      [Create]│
│                                                                 │
│  [ + Create key ]                                              │
└──────────────────────────────────────────────────────────────┘
```
"Create key" opens a small form: Client (select, from the sales-partner's own client roster), Mode
(test/live toggle), Label (optional text) — "Create" button. On success, the full plaintext key is shown
exactly once, in the same reveal pattern as the passcode above, with explicit copy: *"This key will only
work for [Client name]. It authenticates as your own sales-partner account, scoped to this one client —
sessions created with it must include this client's id."* Revoke has no confirm dialog (existing
convention), sets `status = 'revoked'` immediately, effective on the next request.

**Screen state 4 — Bot Voices tab**
```
┌──────────────────────────────────────────────────────────────┐
│  Developer                                                    │
│  Passcodes   API Keys   [ Bot Voices ]   Domain               │
│                                                                 │
│  Enabled languages:  [ English ▾ ]  [ + Add language ]         │
│                                                                 │
│  English                                                       │
│    clio_english          →  your alias: [ english_bot     ]   │
│    clio_english_fast     →  your alias: [ (not set)       ]   │
│                                                                 │
│  Send your alias in the "bot_id" field of bot-sessions to use │
│  that voice for a session.                                     │
└──────────────────────────────────────────────────────────────┘
```
"+ Add language" opens a picker listing every language in Clio's own catalog (layer 2, §6.3) the
sales-partner hasn't yet enabled; enabling one reveals its catalog agents with an empty, editable alias
input per agent. An alias is optional per catalog agent — an agent with no alias set simply cannot be
referenced by `bot_id` yet, with no error state, since nothing has attempted to use it.

## 5. Visual Examples

Wireframes for all four states are given inline in §4.B above, per this project's standard. No additional
wireframes are needed for the API-only flow (§4.A) — its "screen" is the JSON contract itself, specified
in full there and in §6.4's schema.

## 6. Data Requirements

### 6.1 Resolving Brief §6's naming and field-shape questions

**Q4 — rename `reseller_id`/`reseller_unique_id` to `sales_partner_*`?** **Recommendation: keep both
field names exactly as-is.** Reasoning, stronger than the brief anticipated because these are not
greenfield names — they are the live, integrated field names on `POST /api/partner/v1/sessions` and
`POST /api/partner/v1/widget-sessions` today. Renaming them for `bot-sessions` alone would mean the same
logical field has two different names depending on which of three production endpoints a sales-partner
calls — a strictly worse outcome than the mild code-level inelegance of keeping "reseller" as a wire
token while "sales-partner" is the UI word, which is already B2B-26/28's own established, working
convention for exactly this kind of split (code/wire says one thing, product copy says another). The
original reason to avoid the bare `sales_partner` token — collision with `internal_admin_users`'s old
role value — is now moot (B2B-77 §0 confirms that value is renamed to `internal_staff`), but mootness of
the original reason doesn't create a new reason to pay real API-versioning cost for a cosmetic rename with
zero functional benefit to any sales-partner integration.

**Q5 — do `reseller_id`/`client_id` stay, shrink, or drop?** **Stay, unchanged, exactly as already
implemented** (§0). Both fields provide real value beyond what the API key alone resolves:
`reseller_id`'s cross-check catches a caller who has the *right* key but sent the *wrong* expected account
id (a client-side bug, caught early with a clear error rather than silently succeeding against a
different account than the caller believed); `client_id` is the only way `bot-sessions` learns which
client a channel-partner-authenticated call is for at all, since (per the new per-client key design in
§6.4) a single sales-partner key does not, on its own, encode which client's traffic it's being used for.

**Q3 — does `end_user_name` need to be re-sent to `bot-sessions`?** **Recommendation: no — stays tied to
`session_id` server-side.** Reasoning: `bot-dispatch`'s entire purpose (D14) is to make `session_id` the
umbrella key for the reservation's identity; requiring the same value to be repeated on the next call
reintroduces exactly the kind of "two sources of truth for one fact" bug class idempotency keys exist to
prevent (what happens if the two calls disagree?). The server already has `end_user_name` from stage 1,
keyed by `session_id` — `bot-sessions` reads it from there. This is a small, reversible technical
completion within BA authority, not a product-shape call — flagged here for visibility, not escalated.

**Q6 — is `language` sales-partner-facing in production?** **Yes, unchanged — already live** (§0, B2B-62).
No new decision required; carried forward into `bot-sessions` identically to how `widget-sessions` already
accepts it.

**Q7 — passcode delivery: header or body?** **Recommendation: body field (`passcode`), not a header.**
Reasoning: every other `/api/partner/v1/*` endpoint uses `Authorization: Bearer <key>` to mean exactly one
thing — a full, hashed, database-verified partner credential. `bot-dispatch`'s passcode is deliberately a
*lower-trust*, narrower-scoped credential (identity + reservation only, per D14 — it cannot itself create
or act on a session). Overloading the same `Authorization` header for two different trust levels across
sibling endpoints is a real footgun (a caller could plausibly send their real API key where a passcode was
expected, or vice versa, and get a confusing error). A body field keeps the header's meaning constant
across the whole API surface and mirrors `demo_passcodes`' own precedent (submitted as a body/query value
in its own dispatch flow, not a header).

### 6.2 `session_id` — naming vs. the existing `clio_session_ref` convention

D22 decided the wire field name is `session_id`. This document notes, for schema-design purposes, that
this creates a **deliberate second name for the same underlying concept** `partner_sessions.id` already
has under the name `clio_session_ref` (the field returned by every existing session-creation endpoint,
and the column name used on `partner_session_trace_logs`). This is not a conflict to resolve — `bot-
dispatch`/`bot-sessions` is confirmed (D14, D22) as the API-contract name going forward for this specific
production pipeline, while `widget-sessions`'s existing `clio_session_ref` naming stays unchanged on that
endpoint (out of scope to rename per this document's own out-of-scope list, §10). The schema itself does
not need two columns: `bot-dispatch`'s reservation row's primary key **is** the value returned as
`session_id` — Dev should not introduce a second, different UUID that then maps to `partner_sessions.id`
later; the reservation row's own `id` becomes `partner_sessions.id` at the moment `bot-sessions`
successfully converts the reservation into a real session (§6.4's `bot_dispatch_reservations.id` migrates
forward as `partner_sessions.id` on claim, not regenerated).

### 6.3 `bot_id` — three-layer catalog (D20)

**Layer 1 (hidden):** the existing `ELEVENLABS_VOICE_OPTIONS` array (`lib/voice/elevenlabs-agents.ts`) —
unchanged, never exposed.

**Layer 2 (Clio's own catalog, new table `bot_catalog_agents`):**
```sql
CREATE TABLE bot_catalog_agents (
  id                    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  catalog_name          TEXT NOT NULL UNIQUE,   -- e.g. 'clio_english', 'clio_english_fast'
  language              TEXT NOT NULL,          -- e.g. 'English', 'Hindi', 'Tamil' — display grouping
  -- No DB-level FK here: ELEVENLABS_VOICE_OPTIONS (lib/voice/elevenlabs-agents.ts) is a TypeScript
  -- array, not a table, so there is nothing a REFERENCES clause can point at. elevenlabs_voice_key
  -- is matched at the application layer against that array's own `voice` field (e.g.
  -- 'catherine_us_english') by getElevenLabsAgentIdForVoice() — the exact function §6.3's resolution
  -- step below already calls. Deliberately plain TEXT, not a CHECK enumerating the known keys
  -- either: a CHECK would need its own migration every time a new voice is added to that array,
  -- which is exactly the kind of avoidable friction this table's own seed/admin-managed rows
  -- (below) are meant to absorb instead. Row-level correctness (every elevenlabs_voice_key value
  -- actually resolves) is guaranteed by construction, since only an admin-managed seed/migration
  -- ever writes this column — never a sales-partner.
  elevenlabs_voice_key  TEXT NOT NULL,
  status                TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'retired')),
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```
Seeded with the 3 existing voices (`clio_english` → `catherine_us_english`, plus Hindi/Tamil equivalents)
at migration time — this is Clio-curated, admin-managed data, not sales-partner-writable.

**Layer 3 (per-sales-partner alias, new table `bot_alias_mappings`):**
```sql
CREATE TABLE bot_alias_mappings (
  id                      UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  partner_account_id      UUID NOT NULL REFERENCES partner_accounts(id) ON DELETE CASCADE, -- the sales-partner
  bot_catalog_agent_id    UUID NOT NULL REFERENCES bot_catalog_agents(id),
  alias                   TEXT NOT NULL,   -- e.g. 'english_bot' — the sales-partner's own chosen name
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (partner_account_id, alias)  -- one alias means one thing per sales-partner
);
```
**Resolution at `bot-sessions` request time:** look up `bot_alias_mappings` scoped to
`auth.partnerAccountId` (the authenticated sales-partner) by `alias = bot_id`; join to
`bot_catalog_agents` for the `elevenlabs_voice_key`; resolve that to the real hidden agent ID via the
existing `getElevenLabsAgentIdForVoice()`. **Direct partners (`account_kind = 'partner'`) are unaffected**
— they continue using the existing `elevenlabs_agent_id` enum field unchanged (per widget-session-schema's
current shape); `bot_id` resolution is scoped to `channel_partner`-authenticated calls only, since
direct partners have no alias-management dashboard and no reason to need vendor-hiding indirection at the
API level (they already don't see "ElevenLabs" anywhere in their own UI copy either).
**Unrecognized alias → 422, `{ error: { code: "bot_id_not_configured", message: "bot_id '<value>' is not
configured for your account. Configure it in Developer settings > Bot Voices." } }`.**

### 6.4 New tables — dispatch passcodes, dispatch reservations, per-client API keys

**`dispatch_passcodes`** (mirrors `demo_passcodes`' proven shape exactly, per B2B-39 precedent):
```sql
CREATE TABLE dispatch_passcodes (
  id                     UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  partner_account_id     UUID NOT NULL REFERENCES partner_accounts(id) ON DELETE CASCADE, -- sales-partner
  client_id              UUID NOT NULL REFERENCES partner_accounts(id) ON DELETE CASCADE, -- the client
  passcode_hash          TEXT NOT NULL,
  passcode_prefix        TEXT NOT NULL,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  revoked_at             TIMESTAMPTZ,
  created_by_clerk_user_id TEXT
);
CREATE UNIQUE INDEX idx_dispatch_passcodes_active_per_pairing
  ON dispatch_passcodes(partner_account_id, client_id) WHERE revoked_at IS NULL;
CREATE UNIQUE INDEX idx_dispatch_passcodes_hash ON dispatch_passcodes(passcode_hash);
```

**`bot_dispatch_reservations`** (the new reservation row; becomes `partner_sessions` on claim):
```sql
CREATE TABLE bot_dispatch_reservations (
  id                     UUID PRIMARY KEY DEFAULT uuid_generate_v4(), -- == session_id returned to caller
  partner_account_id     UUID NOT NULL REFERENCES partner_accounts(id), -- sales-partner
  client_id              UUID NOT NULL REFERENCES partner_accounts(id), -- resolved from the passcode
  end_user_name          TEXT NOT NULL,
  status                 TEXT NOT NULL DEFAULT 'reserved'
                           CHECK (status IN ('reserved', 'claimed', 'expired')),
  expires_at             TIMESTAMPTZ NOT NULL,  -- created_at + 15 minutes, see §6.5
  created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  claimed_at             TIMESTAMPTZ
);
CREATE INDEX idx_bot_dispatch_reservations_expiry ON bot_dispatch_reservations(status, expires_at)
  WHERE status = 'reserved';
```
Per B2B-77's PII rule (C4), `end_user_name` here is the one approved exception — identical treatment to
its handling on `partner_sessions`. No other end_user-identifying field is ever written to this table (no
`end_user_role`/`end_user_industry` at dispatch time — those are collected on `bot-sessions`, per the
existing field list, unchanged).

**`partner_api_keys` — one new nullable column** (reuses the existing table/hashing/format unchanged, per
the brief's explicit instruction to reuse `hashApiKey()`'s pattern rather than invent a new one):
```sql
ALTER TABLE partner_api_keys ADD COLUMN scoped_client_id UUID REFERENCES partner_accounts(id);
```
A key with `scoped_client_id IS NULL` behaves exactly as it does today (whole-account key — this is what
every existing direct-partner key already is, unaffected). A key with `scoped_client_id` set is the new
sales-partner-self-service per-client key (§4.B, API Keys tab): `partner_account_id` on the row is the
**sales-partner's own account** (so billing/wallet resolution — keyed on `partner_account_id` throughout
`lib/partner/wallet-gate.ts` — correctly rolls up to the sales-partner, per B2B-34's reseller-level-only
billing rule), while `scoped_client_id` narrows which `client_id` body value that key may be used with.
`requirePartnerApiKey` gains one additional check: if the resolved key has `scoped_client_id` set, the
request's `client_id` body field must equal it exactly, else 403
`{ error: { code: "client_scope_mismatch", message: "This API key is scoped to a different client." } }`.
**This is the first sales-partner-self-service key-issuance path this codebase has ever had** — the
existing `/api/admin/partner-keys` is Clerk-admin-only and was explicitly built with no partner-facing UI
("no UI is built for these in this brief; they exist as API endpoints only," B2B-02). This document adds a
new, sales-partner-facing pair: `POST /api/channel-partner/api-keys` (issuance, `requireChannelPartnerAdmin`
gated, body `{ client_id, mode, label? }`) and `GET`/`DELETE` siblings for listing/revoking, structurally
parallel to but independent from the internal-only `/api/admin/partner-keys`.

### 6.5 Expiry and cleanup (Brief §6 Q2)

**Expiry duration: 15 minutes from `created_at`.** Reasoning: D14's own framing — "reserve the moment a
learner clicks, fill in content a moment later" — describes a gap measured in the same request/response
cycle or, at most, a user completing one more step in the sales-partner's own UI, not minutes of
deliberation. 15 minutes is generous enough to absorb real network/processing delay on the sales-partner's
side while still bounding an abandoned reservation's lifetime to something an operator would recognize as
"clearly abandoned," not "still plausibly in progress." This is a technical parameter, easily changed
later without any API-contract impact — flagged as a recommendation, not re-derived from an explicit Arun
number (none was given).

**What `bot-sessions` sees for an expired `session_id`:** a distinct error code, `session_expired` (422),
distinguishing it from `session_id`-not-found-at-all (`session_not_found`, 422) and
already-claimed (`session_already_claimed`, 422) — three different, diagnosable failure reasons instead of
one generic "invalid session."

**Cleanup job — new Inngest function, `bot-dispatch-reservation-cleanup`,** following this codebase's
existing cron-purge pattern (`inngest/partner-session-trace-log.ts`'s own structure is the direct
template): runs every 5 minutes (`cron: '*/5 * * * *'` — tighter than a daily job, matching the reservation
window's own short (15-minute) timescale, so an expired-and-abandoned reservation is marked `expired`
promptly rather than sitting in a stale `reserved` state for up to a day), calls a new RPC
`expire_bot_dispatch_reservations(p_cutoff TIMESTAMPTZ)` that does
`UPDATE bot_dispatch_reservations SET status = 'expired' WHERE status = 'reserved' AND expires_at <
p_cutoff` and returns the count updated (same `RETURNING`-into-CTE-count pattern as every other purge RPC
in this codebase). Rows are **never deleted** — kept as `expired` for diagnostic visibility (mirroring
this codebase's general soft-invalidation convention), with a separate, much slower full-row purge
(60-day retention, mirroring `partner_session_trace_logs`' own precedent) for pure storage hygiene, not
security.

## 7. Success Criteria (Acceptance Tests)

✓ Given a sales-partner with an active passcode for a specific client, when they call `bot-dispatch` with
that passcode and an `end_user_name`, then they receive a `session_id`, `status: "reserved"`, and an
`expires_at` roughly 15 minutes out.

✓ Given a valid, unexpired `session_id` from `bot-dispatch`, when the sales-partner calls `bot-sessions`
with that `session_id`, their per-client API key, and valid content, then they receive `status:
"widget_active"` and a `render_url` — and the resulting `partner_sessions` row's `end_user_name` matches
what was sent to `bot-dispatch`, without it being resent.

✓ Given a `session_id` whose `expires_at` has passed, when `bot-sessions` is called with it, then the
response is 422 with `code: "session_expired"`, not a generic validation error.

✓ Given a `session_id` that was already successfully claimed by a prior `bot-sessions` call, when a second
call reuses it, then the response is 422 with `code: "session_already_claimed"`.

✓ Given a sales-partner API key with `scoped_client_id` set to Client A's id, when it is used in a
`bot-sessions` call whose body `client_id` is Client B's id, then the response is 403
`client_scope_mismatch`.

✓ Given a sales-partner who has mapped their own alias `"english_bot"` to Clio's `clio_english` catalog
entry, when they send `bot_id: "english_bot"` on `bot-sessions`, then the resulting session uses the real
hidden ElevenLabs agent ID that `clio_english` resolves to, and no field anywhere in the request/response
ever names ElevenLabs.

✓ Given a reservation whose `expires_at` has passed and no `bot-sessions` call ever claimed it, when the
cleanup job's next 5-minute run executes, then that row's `status` becomes `'expired'`.

## 8. Error States

| Failure | Response |
|---|---|
| Invalid/expired/revoked passcode on `bot-dispatch` | 401 `{ error: { code: "invalid_passcode", message: "..." } }` |
| Missing `end_user_name` on `bot-dispatch` | 422, standard Zod validation-failed shape (matches existing convention) |
| `session_id` not found on `bot-sessions` | 422 `session_not_found` |
| `session_id` expired | 422 `session_expired` |
| `session_id` already claimed | 422 `session_already_claimed` |
| API key / `client_id` scope mismatch | 403 `client_scope_mismatch` |
| Unrecognized `bot_id` for this account | 422 `bot_id_not_configured` |
| Every existing `widget-sessions` failure mode (content-source, URL safety, wallet gate) | Unchanged, carried forward verbatim per §0 |

## 9. Edge Cases

- **A sales-partner calls `bot-sessions` twice with the same valid `session_id`, both within the expiry
  window.** The first call claims it (`status → 'claimed'`, and the reservation's identity becomes a real
  `partner_sessions` row); the second gets `session_already_claimed`. This is deliberate — a `session_id`
  is single-use for claiming, exactly like `reseller_unique_id`'s own idempotent-replay semantics, but
  distinct from it: `reseller_unique_id` *returns the original result* on replay (idempotent), whereas a
  second `bot-sessions` call on an already-claimed `session_id` is treated as an error, not silently
  idempotent — because unlike a pure network retry, a second distinct `bot-sessions` call could plausibly
  carry *different* content, and silently accepting it would either double-charge or overwrite a live
  session. If a sales-partner needs true retry-safety on `bot-sessions` itself, `reseller_unique_id` (on
  that call) already provides it, unchanged.
- **A sales-partner never calls `bot-dispatch` at all and calls `bot-sessions` directly with a
  freshly-minted UUID as `session_id`.** Rejected with `session_not_found` — `bot-dispatch` is not
  optional for this pipeline; direct partners and any sales-partner not using this two-stage flow continue
  using the existing single-call `widget-sessions`/`sessions` endpoints unchanged (§10).
- **Two different clients of the same sales-partner both attempt to use aliases with the same name
  (`english_bot`).** No collision — `bot_alias_mappings.alias` is unique per `partner_account_id` (the
  sales-partner), not per client, and `bot_id` resolution is always scoped to the authenticated
  sales-partner's own account regardless of which client the call is for.
- **A sales-partner regenerates a passcode while a `bot-dispatch` reservation made with the old passcode
  is still within its 15-minute window.** The reservation is unaffected — the passcode is only checked at
  dispatch time, not re-validated at claim time; revoking/regenerating a passcode only prevents *new*
  dispatches, never invalidates reservations already made.

## 10. Out of Scope

- Renaming `clio_session_ref`/`widget-sessions`'s own field names — those stay exactly as they are; only
  `bot-dispatch`/`bot-sessions` use the new `session_id`/`bot_id` vocabulary (§6.2).
- Any sales-partner-to-client sub-billing (per B2B-77 C3).
- Any pre-registered/cached content model — content stays inline on every `bot-sessions` call (D6,
  confirmed unchanged, §0).
- Domain/DNS/iframe delivery mechanics — entirely B2B-79's scope; this document only specifies the
  `render_url` field's presence, not how its domain gets registered.
- Tooling to help sales-partners auto-format their own content (D6's low-priority backlog item, unchanged).
- Any change to direct-partner (`account_kind = 'partner'`) session-creation behavior — `elevenlabs_agent_id`
  stays exactly as-is for that account kind; `bot_id`/three-layer resolution is `channel_partner`-only.

## 11. Open Questions

None. Every question the Feature Brief's §6 raised is resolved above with reasoning: Q1 (proposed response
shape, §4.A — CEO-signed-off during review, no longer pending), Q2 (§6.5), Q3 (§6.1), Q4 (§6.1), Q5
(§6.1/§0), Q6 (§6.1/§0), Q7 (§6.1), Q8 (§6.3/§6.4 — full schema for passcodes, per-client keys, and the
bot_id catalog), Q9 (§4.B — full wireframe-level dashboard spec, coordinated with B2B-79 into one shared
`/dashboard/channel-partner/developer` IA), Q10 (§12, documentation requirements below).

## 12. Dependencies

- B2B-77 (this brief's terminology and PII rules — inherited unchanged).
- B2B-34 Piece 2 (`client_id`/`end_client_id` architecture) — this document's `client_id` handling is
  identical to what B2B-34 already shipped on `sessions`/`widget-sessions`.
- B2B-39 (`demo_passcodes`) — direct structural precedent for `dispatch_passcodes` (§6.4).
- B2B-79 — this document's `render_url` field depends on a sales-partner having a verified custom domain;
  this document specifies the field, B2B-79 owns how the domain gets there (per the Feature Brief's own
  sequencing note). The Developer-settings dashboard IA (§4.B) reserves a `Domain` tab for B2B-79 to fill.
- **Documentation deliverable (Brief §6 Q10, D21):** the sales-partner-facing API docs page
  (`/dashboard/channel-partner/clients/[id]/configure/docs`, the existing docs surface) must be extended,
  once this brief is built, to cover: the two-stage `bot-dispatch`/`bot-sessions` flow end to end; the
  passcode vs. per-client-API-key distinction and where each is used; `partner_end_user_ref`/
  `partner_reference`'s purpose, optionality, and the explicit non-duplicate-guard callout for
  `partner_reference` (D9); the `content_to_explain`-vs-`content_pages` chunking pattern (D23); and a
  worked example for every ID-shaped field, including explicit guidance that `client_id`/`session_id` are
  Clio-issued (not sales-partner-constructed) while `partner_reference`/`partner_end_user_ref` are free-form
  (D21). This is a real, required deliverable of this brief's build phase, not a documentation
  nice-to-have — the BA specifies its required contents here; writing the actual docs copy is a Dev-phase
  task against this list.
