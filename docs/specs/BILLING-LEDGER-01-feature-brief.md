# Feature Brief: BILLING-LEDGER-01 — Minutes Ledger & Usage Visibility

**From:** CEO (Arun) · **To:** Business Analyst Agent · **Priority:** P1 · **Date:** 2026-07-05

## What Arun said

Arun recharged his minutes balance and briefly saw it display as much lower/zero than expected.
Investigation found two separate things: a display bug (already fixed and deployed, commit
`354a6be` — not part of this work) and a real structural gap — there is no ledger or history of
balance changes anywhere. Only a single running number (`users.minutes_balance`) exists, so nobody
can reconstruct "how much was recharged when" or "how much was consumed by which call" after the
fact.

Arun then asked for two things explicitly, and confirmed he wants them combined into one spec:

1. "The user needs to see at anytime after each call how many minutes he has consumed for each
   call and how much overall."
2. "If you need any logs internally for you to analyze and fix it in future then enable that also
   for the billing and usage functionality."

## The problem being solved

Right now, `users.minutes_balance` is a single mutable number. Every recharge and every session
deduction changes it, but nothing durable records the *event* that caused the change — only the
result. This produced exactly the confusion Arun hit: a real recharge landed, the balance briefly
rendered wrong (due to the separate display bug), and there was no way to independently confirm
from data alone "did the recharge actually apply, for how much, when, and what was the balance
immediately before and after" — the team had to reason it out rather than look it up.

Two distinct audiences are underserved by the current single-number model:

- **The user** has no way to see what a specific call cost them in minutes, or a running total of
  everything they've consumed, anywhere in the product.
- **The team** has no durable, queryable trail of balance-changing events (recharges in particular)
  to diagnose a future "why does my balance look wrong" question without guesswork.

## What success looks like

- After any call ends, the user can see, in the product, how many minutes that specific call
  consumed.
- The user can see, at any time, their all-time total minutes consumed across all calls.
- Every event that changes `users.minutes_balance` — every recharge and every session deduction —
  is recorded in a durable, queryable, append-only trail showing: what happened, when, and the
  resulting balance. A future balance question can be answered by querying this data, not by
  reconstructing it from memory or logs scattered across Stripe/Vercel.
- This is achieved without touching the actual balance-mutation math (`add_minutes` /
  `deduct_minutes` RPCs) — it is purely additive observability layered alongside those calls.

## Known constraints (non-negotiable)

1. **Do not modify or risk `add_minutes` / `deduct_minutes` RPC logic.** These are confirmed
   correct. This spec is additive logging alongside those calls, not a rewrite of billing math.
2. **No deletion of existing code or tables without explicit approval** — per standing project
   rule. In particular, `session_billing_audit_log` (migration 051, built under AUTOGEN-01 Part D)
   already exists and already logs per-session billing lifecycle events
   (`bot_joined` / `voice_connect_attempt` / `speak_verified` / `gap_start` / `gap_end` /
   `disconnected`) via `writeAuditEvent()` in `lib/session-billing.ts`. That table's own inline
   comment already anticipates this exact requirement: *"Users may read their own audit trail
   (needed for the future user-facing minute breakdown view — Section 8/AC-D9 — once its BA
   follow-up spec exists)."* **This spec is that follow-up.** The BA must confirm whether
   per-call consumed-minutes can be derived entirely from existing `session_billing_audit_log` rows
   (via `computeBilledMinutes()`'s existing `speak_verified` → `disconnected` logic) or whether a
   companion table is needed — see Scope below.
3. **RLS required on any new table**, consistent with the existing pattern in migration 051 (users
   read their own rows; service role is the only writer; no UPDATE/DELETE policy for anyone —
   append-only).
4. **Must not impact currently-working flows** — checkout, the Stripe topup webhook handler
   (`app/api/webhooks/stripe/route.ts`, `checkout.session.completed` / `metadata.type === 'topup'`
   branch, lines ~187–206), session-end billing, or the dashboard balance display (already fixed).
5. **Internal diagnosability means a queryable DB ledger, not verbose application logs.** The
   existing `console.log`/`console.error` lines in the topup webhook handler (e.g.
   `console.log(\`[stripe-webhook] Top-up: +${minutes} min...\`)`) are not durable or queryable
   enough for billing disputes — Vercel log retention is time-limited and not structured for this.
   The fix is a proper DB row per event, not more console output.

## Scope

### 1. Recharge event logging (the actual gap)

Every call to `add_minutes` — currently only triggered from the Stripe topup webhook — must write
a durable row recording: which user, how many minutes, the resulting balance, the Stripe reference
(checkout session ID), and a timestamp. Today this event is only visible as a console log line and
the mutated `users.minutes_balance` value; nothing survives that ties a specific recharge to a
specific balance change.

BA to decide (see Questions below) whether this is:
- (a) a new, purpose-built `minutes_ledger` table capturing both recharges and deductions in one
  unified before/after-balance trail (a true ledger), with `session_billing_audit_log` continuing
  to serve its existing detailed per-session lifecycle purpose underneath it, or
- (b) an extension of `session_billing_audit_log`'s `event_type` enum to add a `recharge` type
  (noting this table's rows are currently scoped to a `session_id`, which a recharge event does not
  have — recharges aren't tied to a session, so this would require making `session_id` nullable and
  is likely the weaker option, but BA to confirm).

The CEO's preliminary read: option (a) is architecturally cleaner — a recharge is a
balance-level event, not a session-level event, and forcing it into a session-scoped table shape
is likely to fight the existing schema. But this is a technical/schema decision within the BA and
engineering's autonomy per `CLAUDE.md`; the BA should confirm and document the final choice and
rationale, not just take the CEO's read at face value.

### 2. User-facing consumption display

- **Per-call minutes consumed**, visible after each call ends. `computeBilledMinutes()` in
  `lib/session-billing.ts` already computes this exact figure per session from
  `session_billing_audit_log` (speak_verified → disconnected, minus gaps) for the purpose of
  deduction — this spec surfaces that same figure to the user, it does not recompute it
  differently.
- **All-time total minutes consumed**, visible at any time (not just right after a call) —
  BA to define where this lives (dashboard, billing page, or both — likely
  `app/dashboard/billing/page.tsx` alongside existing balance display, but BA to confirm against
  the existing dashboard IA rather than the CEO assuming placement).
- Per the project's UX rule, any new screen or screen section must be documented in full (copy,
  layout, states — empty/loading/error) before any code is written; no AI-generated filler content
  on this screen.

### 3. Internal diagnosability

- The ledger from Scope Item 1, plus the existing `session_billing_audit_log`, together must be
  sufficient to answer "what happened to this user's balance and when" purely from data. No new
  console/application logging is in scope — the DB ledger itself is the deliverable.
- BA to confirm read access pattern for internal diagnosis (e.g. can be queried directly via
  Supabase; no new internal-only UI is assumed unless BA determines one is needed).

## Explicitly out of scope

- **Retroactively reconstructing history for past events.** Recharges and deductions that happened
  before this ships cannot be logged after the fact — we cannot invent data that was never
  captured. The ledger starts recording from ship date forward only.
- **Any change to how minutes are calculated or deducted.** `add_minutes` / `deduct_minutes` RPC
  logic and `computeBilledMinutes()`'s billing-window math are confirmed correct and are not part
  of this work — this spec only adds a durable record alongside those calls.
- **Any change to the already-fixed dashboard display bug** (commit `354a6be`) — that is closed and
  unrelated to this spec.
- A full internal admin/support UI for browsing the ledger — unless the BA determines the CEO's
  "query directly via Supabase" assumption above is insufficient for real diagnosis needs, in which
  case that should come back as an explicit open question, not be built speculatively.

## Files likely involved (for BA/engineering reference — not exhaustive, BA to confirm)

- `lib/session-billing.ts` — `writeAuditEvent()`, `computeBilledMinutes()`, `deduct_minutes` RPC
  call site
- `app/api/webhooks/stripe/route.ts` — `checkout.session.completed` / topup branch, `add_minutes`
  RPC call site (~lines 187–250)
- `supabase/migrations/051_session_billing_audit_log.sql` — existing table/RLS pattern to extend or
  sit alongside
- New: `supabase/migrations/0XX_minutes_ledger.sql` (or equivalent, pending BA's Scope Item 1
  decision)
- `app/dashboard/billing/page.tsx` — likely location for all-time total display (BA to confirm)
- Likely new/updated component for post-call per-session minute display (BA to identify exact
  screen — session summary, session list row, or a dedicated post-call view)

## Questions for BA

1. New unified `minutes_ledger` table vs. extending `session_billing_audit_log` — confirm which,
   with schema (columns, event types, nullability) and RLS policies fully specified.
2. Exact trigger point and code change for logging a recharge event (inside the existing Stripe
   webhook handler, immediately after the `add_minutes` RPC call succeeds) — confirm this does not
   require any change to the RPC itself, only an additional insert alongside it.
3. Exact screen(s) and placement for per-call and all-time consumption display — dashboard home,
   billing page, session detail/summary, or a combination — with full copy, layout, and
   empty/loading/error states documented (per the project's 3-line UX rule).
4. Whether "per call" should be scoped to sessions only (voice coaching calls, per
   `session_billing_audit_log`'s existing scope) or must also account for any other
   minutes-consuming action in the product — confirm no other consumption path exists today besides
   session calls.
5. Confirm internal diagnosability requirement is fully met by direct DB/Supabase query access to
   the ledger, or whether a lightweight internal view/endpoint is actually needed.
6. Acceptance tests and edge cases per the standard 12-section format (e.g. topup webhook fires
   twice for the same Stripe session — idempotency; `add_minutes` succeeds but ledger insert fails;
   a session with zero billed minutes; a user with zero historical consumption viewing the all-time
   total for the first time).
