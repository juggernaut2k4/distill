# Feature Brief: B2B-38 — Session Traceability IDs

From: CEO (Arun)
To: Business Analyst Agent
Priority: P1 — data-foundation only, no user-facing surface change, but blocks future dashboard/
billing/auditing work Arun has already flagged as coming next
Date: 2026-07-27

## What Arun Said

Relayed via the Orchestrator from Arun's own direct conversation tonight, surfaced while live-
testing the demo dispatch flow (B2B-31/33). His requirements are final and must be transcribed
precisely, not expanded. Verbatim/near-verbatim quotes below, grouped by the concept each governs:

**Why this exists at all:** "we need to track this request and response in a table with this ids
and duration so its easier to create dashboard, insight and billing or auditing. just with api key
its difficult to do that."

**The mandatory/optional matrix, in Arun's own words:** "reseller id is mandatory, we generate a
session id right that is mandatory, configure id is mandatory when sending the response to clio.
other ids are optional."

**On `reseller_unique_id`'s dual purpose:** "its only for tracking and also to avoid duplication
session."

**On scope of the new logging table — no dashboard yet:** "at this point new dashboard not needed.
but these ids need to be created, we need a table to save this information as logs."

**On the internal glitch tracker staying internal-only:** "no option a. its only for internal but we
should know from whose session we got the glitch so only for tracking."

**On the documentation-only save recommendation:** "we also ask reseller or reseller's client also
to save our information, but it is also ok if he decides not to save but we recommend to save the
info he gets from the api."

## The Problem Being Solved

Today, `POST /api/partner/v1/sessions` resolves exactly one `partner_account_id` server-side from
the `Authorization: Bearer <api_key>` header (`requirePartnerApiKey()`,
`lib/partner/auth.ts:64-179`) — that opaque, server-side-only resolution is the sole traceability
anchor for a session today. I independently verified the current state before writing this brief:

- `CreateSessionSchema` (`lib/partner/session-schema.ts:29-95`) has no `reseller_id` or
  `reseller_unique_id` field today. It does have `client_id` (line 51, optional UUID) — B2B-34's
  reseller-downstream-client field, validated in the route
  (`app/api/partner/v1/sessions/route.ts:64-88`) against `owning_channel_partner_id` and only
  enforced/required for `auth.accountKind === 'channel_partner'` callers. This brief does not touch
  that logic.
- The session-creation response today is `{ clio_session_ref, status, render_url, error? }`
  (`app/api/partner/v1/sessions/route.ts:266-273` test-mode path, `356-363` live-mode path). There is
  no field a reseller could send in and get echoed back.
- `GET /api/partner/v1/sessions/:clio_session_ref` returns `{ clio_session_ref, status, created_at,
  ended_at }` (`app/api/partner/v1/sessions/[clio_session_ref]/route.ts:41-46`) — same gap.
- Outbound webhooks (`WebhookPayload`, `lib/partner/webhooks.ts:35-45`) already carry
  `clio_session_ref` and `partner_reference` (the existing free-text opaque field a partner can set
  on session creation) but nothing named for reseller correlation specifically.
- Hume's own config id already exists in the schema as `hume_native_config_id` on the session record
  (referenced at `lib/voice/hume-native/session-details.ts:233,247,262,269`) — this brief does not
  invent a new field for it, only ensures it is carried into the new internal log record.
- The internal glitch tracker (B2B-17) stores glitches in a durable table, `glitch_instances`
  (migration `082_b2b17_glitch_issue_tracker.sql:47-73`), populated by a Postgres trigger fanning out
  `partner_session_insights.glitches` (never by application code directly) and already FK'd to
  `partner_session_id` and `partner_account_id`. It has no reseller/client/reseller-unique-id/
  hume-config columns today. It is confirmed internal-only — no partner-facing table, no partner API
  surface, no partner webhook event references it (migration file's own header comment, line 12), and
  the partner-facing "known bugs" surface (`app/api/partner/known-bugs/*`, B2B-22) reads from a
  separate, deliberately sanitized summary path, not `glitch_instances` directly.
- Precedent for a scheduled retention-purge job already exists twice, same shape both times: a daily
  `0 3 * * *` Inngest cron, `retries: 3`, calling a Postgres RPC with a cutoff timestamp —
  `partnerSessionInsightsPurge` (`inngest/partner-session-insights-extractor.ts:494-513`, 30-day
  window) and its sibling `glitchInstancesPurge` (`inngest/glitch-instances-purge.ts`, currently
  paused per a separate, unrelated 2026-07-17 instruction from Arun not to delete glitch detail yet —
  irrelevant to this brief, noted only so the BA doesn't confuse the two). Both existing jobs **null
  out a text field on the row** rather than delete the row outright. Arun's instruction here says
  "auto-delete" — see Open Item 3 below on whether B2B-38's new table should delete full rows (my
  recommended default) rather than follow the redact-in-place precedent.
- No naming collision found: `grep`ed the full codebase for `reseller_id` / `reseller_unique_id` —
  zero existing hits. `client_id` (this brief leaves untouched) is a distinct, already-resolved
  concept (B2B-34) and is not to be confused with the new `reseller_id`.
- Confirmed zero real (non-test-mode) `partner_sessions` rows exist in production as of the B2B-35/36
  CEO reviews (2026-07-25/26) — this is still a pre-launch, no-live-traffic codebase. That materially
  lowers the risk of any backward-compatibility question below; it does not resolve them, since the
  contract still needs to be right before real partners onboard.

## What Success Looks Like

- `POST /api/partner/v1/sessions` accepts a new mandatory `reseller_id` field, validated for
  consistency against `auth.partnerAccountId` (the account the API key already resolved to).
- `POST /api/partner/v1/sessions` accepts a new optional `reseller_unique_id` field. Sending the same
  `reseller_unique_id` again (scoped to that reseller) does not dispatch a second real session/bot
  join — it returns the original session's response instead.
- `client_id` behavior is completely unchanged — same optionality, same channel-partner-only
  enforcement, same validation.
- Every response concerning a session (the `POST` response, the `GET` response, and outbound
  webhooks) echoes back the `reseller_unique_id` the reseller sent, when they sent one.
- A new internal logging/audit table exists, storing `reseller_id`, `client_id`,
  `reseller_unique_id`, `clio_session_ref`, `hume_config_id`, and session duration, for every
  session — with automatic deletion after 60 days. No dashboard or UI reads it yet.
- The internal glitch tracker (B2B-17's `glitch_instances` / issue-tracker surface) carries the same
  five trace identifiers for root-cause and billing debugging, visible only to Clio's own internal
  staff — never surfaced to any partner-facing endpoint, page, or webhook.
- Partner-facing API documentation gains a written recommendation to save the IDs Clio returns —
  copy only, no enforcement mechanism, no validation that a partner actually persisted anything.

## Known Constraints

- Do not build any new dashboard, reporting UI, or analytics screen. This is a data-foundation brief
  only — Arun was explicit ("at this point new dashboard not needed").
- Do not modify `client_id`'s existing behavior, validation, optionality, or storage in any way.
- Never send glitch/error information to a partner externally, under any circumstance, in this or any
  future brief, unless Arun explicitly reopens that decision. This is a hard requirement repeated
  directly by Arun tonight, not a default that quietly loosens over time.
- Do not silently resolve the open items below. They need explicit BA design with acceptance
  criteria, and must come back through CEO re-review before development starts.
- Documentation guidance to save returned IDs is copy-only — no partner-side enforcement, no
  required-field validation on any partner system Clio doesn't control.

## Open Items for the BA to Design (not resolved by this brief — flagged per governance, each with a recommended default)

**1. `reseller_id` mismatch handling.** Arun did not specify what happens when the `reseller_id` sent
in the body disagrees with `auth.partnerAccountId` (the account the API key already resolved to).
**My recommended default: reject with HTTP 422** (`invalid_reseller_id` or similar error code,
matching this route's existing error-envelope convention — see `client_id_required`/
`invalid_client_id` at `app/api/partner/v1/sessions/route.ts:70-88` for the exact pattern to mirror).
Rejecting is safer than silently ignoring a mismatched value in a field whose entire purpose is
billing/audit correlation — a silently-ignored mismatch defeats the feature. BA: confirm this default
or propose an alternative with reasoning, and specify the exact error code/message/status.

**2. `reseller_unique_id` idempotency/replay mechanics.** Arun confirmed the two purposes (tracking +
duplicate-session avoidance) but not the mechanics. **My recommended default:**
- Uniqueness enforced **per-reseller** (i.e., scoped to `partner_account_id`), not globally — two
  different resellers may reuse the same `reseller_unique_id` value independently.
- On a repeat `reseller_unique_id` from the same reseller: **do not dispatch a second real
  session/bot-join.** Return the original session's already-created response (same `clio_session_ref`,
  same `render_url`, same status) rather than an error — this is a true idempotent-replay pattern, not
  a duplicate-rejection pattern.
- BA must design: the exact DB uniqueness constraint (likely a partial/composite unique index on
  `(partner_account_id, reseller_unique_id)` where non-null, mirroring how this codebase already
  scopes other reseller-relative uniqueness — see `client_id`'s own `owning_channel_partner_id`-scoped
  validation as the nearest precedent), the exact request-body validation shape, and what "the same
  request" means if a caller resends `reseller_unique_id` with genuinely different other fields
  (e.g. a different `meeting_url`) — full acceptance criteria required, this is not a small detail.

**3. `reseller_id`'s account-kind scope.** Not one of Arun's own two flagged items, but a real gap I
found while verifying the code: Arun's mandatory/optional matrix says "reseller id is mandatory"
without qualifying it to `channel_partner`-kind accounts the way `client_id` is explicitly scoped
(point 2 in the original ask: `client_id` "stays exactly as B2B-34 built it (optional, channel_partner
account_kind only)"). Read literally, "mandatory" with no qualifier means every session-creation call,
from a direct `partner`-kind account too, not only reseller/`channel_partner`-kind accounts. **My
recommended default: mandatory for every account, regardless of `account_kind`** — a direct partner's
`reseller_id` is simply their own `partner_account_id`, which they already know (it's how they
authenticate), so this imposes no real new burden on them, and it keeps the traceability/logging table
uniform across both account kinds rather than having a column that's sometimes populated and
sometimes not depending on caller type. Zero real production traffic exists today (verified above),
so there's no live-partner breakage risk either way. BA: confirm this default or propose scoping it to
`channel_partner` only, with reasoning — this is a real product decision, not a detail to guess past.

**4. New table's delete semantics.** Arun said "auto-delete" for the 60-day retention, but this
codebase's two existing retention-purge jobs (`partnerSessionInsightsPurge`, `glitchInstancesPurge`)
both **null out a text field, keeping the row**, not full-row `DELETE`. **My recommended default: full
row deletion** for B2B-38's new table — "auto-delete" reads most naturally as deleting the log entry
itself, and unlike the two existing jobs (which purge sensitive free-text transcript/glitch detail
while preserving structured metadata like duration/type for historical aggregate reporting), this new
table's entire purpose is to be Clio's own tracking log, which Arun explicitly said doesn't feed any
report yet. Model the job itself on the exact shape of `partnerSessionInsightsPurge`
(`inngest/partner-session-insights-extractor.ts:494-513`) — daily `0 3 * * *` cron, `retries: 3`, a
Postgres RPC doing the deletion with a cutoff timestamp — but confirm full-row delete vs. field-null
explicitly rather than copying the precedent's redact-in-place behavior by default.

## Questions for BA

In addition to fully designing Open Items 1-4 above with concrete acceptance criteria:

1. Design the new logging table's schema (columns: `reseller_id`, `client_id` [nullable,
   `end_client_id` internally per B2B-34's naming resolution — confirm whether this new table follows
   that same wire-vs-DB naming split], `reseller_unique_id` [nullable], `clio_session_ref`,
   `hume_config_id`, session duration, timestamps) and its relationship to `partner_sessions` — new
   standalone table populated at session-creation and updated/finalized at session-end (to capture
   duration), or a view/materialization over existing tables. State and justify the choice.
2. Design exactly how `hume_config_id` gets into this new table — `hume_native_config_id` is set on
   the session record at config-provisioning time (`lib/voice/hume-native/session-details.ts`), which
   may be after initial session-row creation. Confirm the write happens at the correct point in the
   session lifecycle so the mandatory-in-the-glitch-record requirement (point 5/7 of the original ask)
   is actually satisfiable, not aspirational.
3. Design exactly how the five trace IDs reach `glitch_instances` given it is populated by a Postgres
   trigger fanning out `partner_session_insights.glitches` (not application code) — likely either (a)
   new nullable columns on `glitch_instances` itself, backfilled by the trigger via a join through
   `partner_session_id` → `partner_sessions`, or (b) some other mechanism. State and justify the
   choice; do not touch the trigger's existing fan-out behavior for `glitch_issues`/notes.
4. Specify the exact new-table migration number (098 is confirmed the highest existing migration as
   of this writing — next is 099, but confirm against the repo state at build time) and confirm RLS
   policy (service-role-only, matching every other internal-only table in this codebase, e.g.
   `glitch_issues`/`glitch_instances` migration `082`'s policy pattern).
5. Specify the exact validation/error response shape for `reseller_id` (missing entirely → what error
   code/status; present but mismatched → Open Item 1's resolution).
6. Draft the specific partner-facing API documentation copy for the "we recommend saving the IDs we
   return" guidance (point 9 of the original ask) — where it lives (Developer Portal docs page,
   inline in the API reference, or both) and its exact wording, non-enforced.
7. Confirm test coverage plan: `reseller_id` required/mismatch cases, `reseller_unique_id` replay
   (same value twice → single dispatch, original response returned) and per-reseller scoping (same
   value from two different resellers → two independent sessions), `client_id` behavior fully
   unchanged (regression test), the new table populated correctly on session creation and updated on
   session end, the new purge job's deletion behavior, and the `glitch_instances` trace-ID
   backfill/write path.
