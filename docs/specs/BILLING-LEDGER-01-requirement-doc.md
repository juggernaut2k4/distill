# Requirement Document: BILLING-LEDGER-01 — Minutes Ledger & Usage Visibility

**From:** Business Analyst Agent · **To:** CEO Agent (for approval) · **Priority:** P1 · **Date:** 2026-07-05
**Source:** `docs/specs/BILLING-LEDGER-01-feature-brief.md`
**Status:** DRAFT — pending CEO review. Section 11 (Open Questions) is empty per gate requirement.

---

## 1. Purpose

Today, `users.minutes_balance` is a single mutable number. Every recharge (Stripe topup) and every
session deduction changes it, but nothing durable records the *event* that caused the change — only
the end result. This is exactly what produced Arun's confusion: a real recharge landed, the balance
briefly rendered wrong (a separate, already-fixed display bug), and there was no data-only way to
confirm "did the recharge actually apply, for how much, when, and what was the balance immediately
before and after" — the team had to reason it out rather than look it up.

Without this feature: every future "why does my balance look wrong" question requires manually
cross-referencing Stripe dashboard timestamps against Vercel logs (which expire) and guessing at
ordering. Users also have zero visibility into what any individual coaching call cost them, or how
many minutes they've consumed in total — they only ever see the current remaining balance.

This feature adds a durable, queryable, append-only ledger of every balance-changing event
(recharges and session deductions), plus two small pieces of user-facing display: per-call minutes
consumed, and an all-time total consumed. It does not change how minutes are calculated or deducted
— it is purely additive observability layered alongside the existing, confirmed-correct
`add_minutes`/`deduct_minutes` RPCs.

## 2. User Story

As a **paying Clio user**,
I want to see how many minutes my last coaching call consumed, and my all-time total minutes
consumed,
So that I understand what I'm being charged for and never have to guess whether a recharge or a
deduction "actually happened."

As **the Clio team (internal)**,
I want every balance-changing event (recharge, session deduction) recorded as a durable, queryable
database row,
So that a future billing dispute or "balance looks wrong" investigation can be answered by querying
data, not by reconstructing events from memory or expiring logs.

## 3. Trigger / Entry Point

This is not a single screen/flow the user navigates to start — it is:

- **Ledger writes** are triggered automatically, server-side, at two existing code points:
  1. Inside `app/api/webhooks/stripe/route.ts`, in the `checkout.session.completed` handler's
     `metadata.type === 'topup'` branch, immediately after the existing `add_minutes` RPC call
     succeeds (~line 199, right after the `if (rpcError)` early-return).
  2. Inside `lib/session-billing.ts` (`forceEndSession()`) and `app/api/sessions/[id]/end/route.ts`
     — both existing `deduct_minutes` call sites — immediately after that RPC call succeeds.
  No new user action triggers these; they piggyback on flows that already exist and already fire
  today (Stripe webhook delivery; user clicking "End Session" or the session timer/gap-watchdog
  force-ending a call).
- **Per-call display**: user must be logged in (Clerk session) and viewing
  `app/dashboard/sessions/[id]` for a session with `status === 'completed'`. No new route — this is
  an addition to the existing session detail page.
- **All-time total display**: user must be logged in and viewing `app/dashboard/billing/page.tsx`
  (existing route, existing auth pattern: `auth()` from `@clerk/nextjs/server`, redirect to
  `/sign-in` if absent).

## 4. Screen / Flow Description

### 4.1 Per-call minutes consumed — `app/dashboard/sessions/[id]/SessionDetailClient.tsx`

This page already renders session status (`Scheduled` / `In Progress` / `Completed` / `Cancelled`,
via `STATUS_CONFIG`) and already receives the full `sessions` row (server component does
`select('*')`, so `duration_mins` — which both deduction call sites already write as the billed
minutes for that session — is already available to the client with **no new data fetch required**.

Add a new small stat row, visible only when `session.status === 'completed'`, placed directly below
the existing status badge/header area (before the topics/meta row). Exact text:

- Label: `"Minutes used"` — 12px, uppercase, tracking-wide, color `#475569` (matches existing
  meta-label styling elsewhere on this page, e.g. section headers in `DashboardClient.tsx`).
- Value: `{session.duration_mins} min` — 20px, font-semibold, color `#FFFFFF`, with a small
  `Timer` icon (already imported in this file's lucide-react import list, unused elsewhere on this
  page — confirms it's already available) in `#06B6D4` immediately to its left.
- If `session.duration_mins === 0`: value renders as `"0 min (session ended before connecting)"` in
  `#475569` instead of white — this is the AC-D3 zero-minutes-billed case, not an error state, and
  must read as informational, not broken.

No new component file needed — this is a ~10-line JSX addition to the existing status/header block
in `SessionDetailClient.tsx`.

### 4.2 All-time total minutes consumed — `app/dashboard/billing/page.tsx`

This page already has a "Coaching Minutes" `Card` (lines 77–96) showing current `minutesBalance` as
a large cyan number with a `TopUpButton`. Add a second, smaller stat directly beneath the existing
`minutesBalance` display, inside the same card (not a new card — this keeps both numbers visually
grouped as "your minutes" in one place, consistent with the existing card's own scope).

Exact layout addition (inside the existing `<Card className="p-6 mb-5">` block, after the existing
`<div className="text-xs text-[#475569]">Minutes are deducted...</div>` line):

```
┌─────────────────────────────────────────┐
│  Coaching Minutes                       │
│  🕐  47                    [Top up]     │
│      min remaining                      │
│                                          │
│  Minutes are deducted at the end of     │
│  each coaching session. They never      │
│  expire.                                │
│  ───────────────────────────────────    │
│  Total consumed to date: 183 min        │
└─────────────────────────────────────────┘
```

- Text: `"Total consumed to date: {N} min"` — 13px, color `#94A3B8`, separated from the note above it
  by a thin `1px solid #222222` top border and `12px` top padding/margin (matches the existing
  `border-subtle` token from the design system).
- If the user has zero completed sessions ever (`N === 0`): text reads `"Total consumed to date: 0
  min — you haven't started a coaching session yet."` in `#475569`.
- This value requires one new data fetch — see Section 6 (Data Requirements).

### 4.3 No new page, no new route for the ledger itself

The ledger table is a backend/data construct only. There is no "ledger browser" screen in this
spec's scope (see Section 10 — Out of Scope). Internal diagnosis happens via direct Supabase query
access, per the CEO's stated assumption in the feature brief (confirmed sufficient — see Section 11
resolution below).

## 5. Visual Examples

**State A — Session detail page, completed session with billed minutes:**
```
┌─────────────────────────────────────────┐
│  ← Back to Sessions                     │
│                                         │
│  ✓ Completed          Session 3         │
│  🕐 Minutes used: 12 min                │
│                                         │
│  Building Your First AI Workflow        │
│  Tuesday, July 8 at 2:00 PM  · ~15 min  │
└─────────────────────────────────────────┘
```

**State B — Session detail page, completed session that never connected (0 minutes billed):**
```
┌─────────────────────────────────────────┐
│  ✓ Completed          Session 4         │
│  🕐 Minutes used: 0 min (session ended  │
│     before connecting)                  │
└─────────────────────────────────────────┘
```

**State C — Billing page, coaching minutes card with all-time total:**
```
┌─────────────────────────────────────────┐
│  🕐 Coaching Minutes                    │
│  47                          [Top up]   │
│  min remaining                          │
│                                         │
│  Minutes are deducted at the end of     │
│  each coaching session. They never      │
│  expire.                                │
│  ─────────────────────────────────────  │
│  Total consumed to date: 183 min        │
└─────────────────────────────────────────┘
```

**State D — Billing page, brand-new user, zero sessions ever:**
```
┌─────────────────────────────────────────┐
│  🕐 Coaching Minutes                    │
│  30                          [Top up]   │
│  min remaining                          │
│  ─────────────────────────────────────  │
│  Total consumed to date: 0 min — you    │
│  haven't started a coaching session yet.│
└─────────────────────────────────────────┘
```

## 6. Data Requirements

### 6.1 Schema decision — new `minutes_ledger` table (not extending `session_billing_audit_log`)

**Decision: build a new, purpose-built `minutes_ledger` table.** This confirms the CEO's
preliminary lean in the feature brief, for the following concrete reasons (not just deferring to the
lean as-is):

- `session_billing_audit_log` rows are `NOT NULL REFERENCES sessions(id)` — every row is
  session-scoped by hard schema constraint. A recharge event has no `session_id`; making that column
  nullable would weaken the FK guarantee for every existing consumer of that table
  (`writeAuditEvent()`, `computeBilledMinutes()`, the `speak_verified`/`disconnected`/`gap_*` event
  lifecycle) for the sake of a conceptually different event class. This is a real structural fight,
  not a cosmetic one.
  - `session_billing_audit_log`'s `event_type` CHECK constraint enumerates six specific
    *within-a-session voice lifecycle* states (`bot_joined` → `disconnected`). A recharge is not a
    point in a session's lifecycle at all — it's a standalone account-level balance event. Folding it
    into this enum conflates two different domains that currently have zero overlap.
  - The existing table's entire purpose (per its own migration comment) is deriving *billed minutes
    for one session* from voice-readiness signals. A unified ledger's purpose is *"every balance
    change, in order, with before/after balance"* — a different question, best answered by a
    dedicated, flatter table.
- A new table lets the ledger carry a **resulting balance after this event** field natively (see
  6.2) without retrofitting that concept onto a table whose rows don't currently need it (a session's
  audit rows don't currently record a balance snapshot per row — only the final deduction does, via
  the `sessions.duration_mins`/`users.minutes_balance` update, outside the audit log itself).
- `session_billing_audit_log` continues to serve its existing, working purpose unchanged — this spec
  does not touch it except to read from it (via the existing `computeBilledMinutes()`) when writing a
  ledger row for a session-deduction event (see 6.3).

### 6.2 New table: `minutes_ledger`

New migration file: `supabase/migrations/0XX_minutes_ledger.sql` (exact number = next available
migration number at build time; confirm via `ls supabase/migrations/` immediately before creating
it, since this repo's migrations are sequential and other work may land first).

```sql
CREATE TABLE IF NOT EXISTS minutes_ledger (
  id                UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id           TEXT        NOT NULL REFERENCES users(id) ON DELETE CASCADE,

  -- 'recharge' = a Stripe topup (add_minutes). 'session_deduction' = minutes billed
  -- for a completed/force-ended coaching session (deduct_minutes). Exactly two
  -- values for this initial ship — any future balance-changing action (e.g. a
  -- manual admin credit) would add a new value here, not a new table.
  event_type        TEXT        NOT NULL
                        CHECK (event_type IN ('recharge', 'session_deduction')),

  -- Positive for a recharge, positive for a deduction too (this column always
  -- records the magnitude of minutes moved; event_type + delta's sign convention
  -- below determines direction — see note). Stored as the signed delta actually
  -- applied to the balance: +N for recharge, -N for deduction. This makes
  -- SUM(delta_minutes) over a user's rows always equal their current balance,
  -- which is the core integrity property.
  delta_minutes     INTEGER     NOT NULL,

  -- The balance immediately after this event was applied — captured at write
  -- time, not recomputed later. This is what makes the ledger a true audit trail
  -- rather than requiring replay/summation to answer "what was the balance after
  -- event X."
  resulting_balance INTEGER     NOT NULL,

  -- Nullable: only present for event_type = 'session_deduction'. NOT a foreign
  -- key with ON DELETE CASCADE to sessions, deliberately — the ledger row must
  -- survive even if the session row is ever deleted (append-only, dispute-
  -- defensible; a deleted session must not silently erase its billing history).
  session_id        UUID        REFERENCES sessions(id) ON DELETE SET NULL,

  -- Nullable: only present for event_type = 'recharge'. The Stripe Checkout
  -- Session ID, giving a direct cross-reference to the Stripe dashboard for
  -- dispute resolution (this is the exact "tie a specific recharge to a specific
  -- balance change" gap named in the feature brief).
  stripe_checkout_session_id TEXT,

  -- Free-form context (e.g. minutes purchased in a topup, plan tier at time of
  -- event) — JSONB for the same forward-compatibility reason as
  -- session_billing_audit_log.metadata. Never store secrets/PII here.
  metadata          JSONB       NOT NULL DEFAULT '{}'::jsonb,

  occurred_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_minutes_ledger_user_time
  ON minutes_ledger(user_id, occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_minutes_ledger_session
  ON minutes_ledger(session_id) WHERE session_id IS NOT NULL;

-- ─── APPEND-ONLY ENFORCEMENT (mirrors session_billing_audit_log's pattern) ───
ALTER TABLE minutes_ledger ENABLE ROW LEVEL SECURITY;

-- Users may read their own ledger rows (powers the all-time-total query and any
-- future user-facing breakdown beyond this spec's two display points).
CREATE POLICY "Users can view own minutes ledger"
  ON minutes_ledger FOR SELECT
  USING (auth.uid()::text = user_id);

-- Service role (admin client) is the only writer. No UPDATE or DELETE policy is
-- defined for any role — matches session_billing_audit_log's dispute-defensible,
-- immutable pattern exactly.
CREATE POLICY "Service role can insert minutes ledger events"
  ON minutes_ledger FOR INSERT
  WITH CHECK (auth.role() = 'service_role');

CREATE POLICY "Service role can read all minutes ledger events"
  ON minutes_ledger FOR SELECT
  USING (auth.role() = 'service_role');
```

### 6.3 New function: `lib/session-billing.ts` → `writeMinutesLedgerEvent()`

A new exported function, alongside the existing `writeAuditEvent()`, following the exact same
shape/error-handling convention (non-fatal on failure, logs loudly, never throws — matching
`writeAuditEvent()`'s own comment: "must never take down the live session or the billing routes that
call it"):

```ts
export async function writeMinutesLedgerEvent(params: {
  userId: string
  eventType: 'recharge' | 'session_deduction'
  deltaMinutes: number          // signed: +N recharge, -N deduction
  resultingBalance: number
  sessionId?: string | null
  stripeCheckoutSessionId?: string | null
  metadata?: Record<string, unknown>
}): Promise<void>
```

This is the **only** function in the codebase that may write to `minutes_ledger` — same pattern as
`writeAuditEvent()`'s comment for `session_billing_audit_log`.

### 6.4 Write site 1 — Recharge (Stripe topup webhook)

In `app/api/webhooks/stripe/route.ts`, inside the `checkout.session.completed` /
`metadata.type === 'topup'` branch, immediately after the existing success path (after line 206's
`console.log`, i.e. once `add_minutes` has already succeeded and `newBalance` is known) — add:

```ts
await writeMinutesLedgerEvent({
  userId,
  eventType: 'recharge',
  deltaMinutes: minutes,
  resultingBalance: newBalance as number,
  stripeCheckoutSessionId: session.id,
  metadata: { source: 'stripe_topup_webhook' },
})
```

This is purely additive — the existing `add_minutes` RPC call, the existing `console.log` line, the
existing welcome/confirmation email, and the existing SMS send are all untouched and continue to run
exactly as today. No existing line is removed or reordered; this is one new `await` inserted after
the RPC succeeds and before the function returns from that branch.

### 6.5 Write site 2 — Session deduction (two call sites)

**Site A — `app/api/sessions/[id]/end/route.ts`:** immediately after
`supabase.rpc('deduct_minutes', ...)` resolves (after line 83's `Promise.all`, once `newBalance` is
computed at line 85):

```ts
await writeMinutesLedgerEvent({
  userId: userId!,
  eventType: 'session_deduction',
  deltaMinutes: -minutesUsed,
  resultingBalance: newBalance,
  sessionId: params.id,
  metadata: { reached_speak_verified: reachedSpeakVerified },
})
```

**Site B — `lib/session-billing.ts` → `forceEndSession()`:** immediately after the existing
`Promise.all` that calls `deduct_minutes` and updates the `sessions` row (after line 269, before the
existing `console.log` at line 271 — or alongside it, order does not matter since both are
non-blocking observability, but the ledger write should not be dropped if the console.log line is
ever removed later, so it must not be conditioned on it):

```ts
await writeMinutesLedgerEvent({
  userId,
  eventType: 'session_deduction',
  deltaMinutes: -cappedMinutes,
  resultingBalance: (deductResult... as number) ?? (userRow?.minutes_balance ?? 0) - cappedMinutes,
  sessionId,
  metadata: { reached_speak_verified: minutesUsed > 0 || cappedMinutes > 0 },
})
```
(Exact resulting-balance extraction from the existing `Promise.all([deduct_minutes RPC, sessions
update])` tuple is a build-time wiring detail — the RPC call already returns the new balance as its
data payload, matching the pattern already used in `end/route.ts`'s `deductResult.data`; the
engineer must capture that same return value here rather than recomputing it, per Section 12's
non-negotiable "reuse the RPC's own return value, don't recompute" rule.)

Both deduction call sites confirmed as the **only** two `deduct_minutes` call sites in the codebase
(verified via full-codebase search) — no other minutes-consuming action exists today.

### 6.6 Data read for all-time total (Section 4.2)

New helper, `lib/session-billing.ts` → `getTotalMinutesConsumed(userId: string): Promise<number>`:

```ts
export async function getTotalMinutesConsumed(userId: string): Promise<number> {
  const supabase = createSupabaseAdminClient()
  const { data } = await supabase
    .from('minutes_ledger')
    .select('delta_minutes')
    .eq('user_id', userId)
    .eq('event_type', 'session_deduction')

  const total = (data ?? []).reduce((sum, row) => sum + Math.abs(row.delta_minutes as number), 0)
  return total
}
```

Called from `app/dashboard/billing/page.tsx` (server component) alongside the existing `users`
query, in parallel via `Promise.all` (matching this file's existing single-query pattern — extend it
to two parallel queries), and passed to the page's render as a plain number. No new client component
needed — the existing page is already a server component rendering static Card content.

### 6.7 What is read from `session_billing_audit_log`

No schema change needed to `session_billing_audit_log` for this spec's user-facing displays — it
already has everything needed:

- Per-call minutes: already computed by `computeBilledMinutes()` and already persisted to
  `sessions.duration_mins` at end-of-call — the display in 4.1 reads `sessions.duration_mins`
  directly, not the audit log itself. No new read path required.
- The "resulting balance after this event" field the brief asked about for a clean unified view is
  satisfied by `minutes_ledger.resulting_balance` (6.2) — a new column on the new table, not an
  addition to `session_billing_audit_log`. `session_billing_audit_log` continues to answer
  "what happened inside this session's voice lifecycle," while `minutes_ledger` answers "what
  happened to this user's balance, in order" — the two tables are complementary, not overlapping.

## 7. Success Criteria (Acceptance Tests)

1. ✓ Given a Stripe topup webhook fires successfully for a user with 20 min balance topping up 30
   min, when the handler completes, then a `minutes_ledger` row exists with
   `event_type='recharge'`, `delta_minutes=30`, `resulting_balance=50`,
   `stripe_checkout_session_id` matching that checkout session's ID.
2. ✓ Given a user ends a coaching session that billed 12 minutes from a 50-min balance, when
   `/api/sessions/[id]/end` completes, then a `minutes_ledger` row exists with
   `event_type='session_deduction'`, `delta_minutes=-12`, `resulting_balance=38`,
   `session_id` matching that session.
3. ✓ Given a session that never reached `speak_verified` (force-ended with 0 billed minutes), when
   `forceEndSession()` completes, then a `minutes_ledger` row exists with `delta_minutes=0`,
   `event_type='session_deduction'`, `resulting_balance` unchanged from before the call — this is
   an explicit logged event, not a skipped write (a $0 event still proves "we saw this session end
   and correctly billed nothing," which is itself diagnostically valuable).
4. ✓ Given a user with zero prior sessions ever, when they view `/dashboard/billing`, then "Total
   consumed to date: 0 min — you haven't started a coaching session yet." renders (State D).
5. ✓ Given a user has three completed sessions billing 12, 8, and 15 minutes respectively, when
   they view `/dashboard/billing`, then "Total consumed to date: 35 min" renders (sum of absolute
   deduction deltas).
6. ✓ Given a completed session with `duration_mins = 0` (never connected), when the user views that
   session's detail page, then "0 min (session ended before connecting)" renders in muted color,
   not as an error.
7. ✓ Given the Stripe topup webhook fires twice for the same Stripe checkout session (Stripe's
   documented at-least-once delivery), when both deliveries are processed, then **two** separate
   `minutes_ledger` rows are written (idempotency of the underlying `add_minutes` RPC/balance
   mutation is explicitly out of scope for this spec per the brief's non-negotiable constraints —
   this spec logs whatever `add_minutes` actually did, faithfully, and does not add new dedup logic
   that the RPC itself doesn't already have; if the RPC is not idempotent today, that is a
   pre-existing condition unrelated to this ledger and is not this spec's fix to make).
8. ✓ Given `add_minutes` succeeds but the subsequent `writeMinutesLedgerEvent()` call fails (e.g.
   transient DB error), when the webhook handler completes, then the user's balance is still
   correctly updated (unaffected — the RPC already committed), the webhook still returns 200, and
   the failure is logged via `console.error` matching `writeAuditEvent()`'s existing non-fatal
   convention — a missing ledger row degrades diagnosability for that one event but never blocks or
   reverses the actual balance change.
9. ✓ Given a user queries their own `minutes_ledger` rows via Supabase (internal diagnosis), when
   RLS is evaluated, then only rows where `user_id = auth.uid()` are visible — no cross-user leakage.
10. ✓ Given the existing `session_billing_audit_log` writes, Stripe checkout flow, and dashboard
    balance display (all pre-existing, working flows), when this feature ships, then all three
    continue to function identically — verified by confirming no existing line in
    `app/api/webhooks/stripe/route.ts`, `lib/session-billing.ts`, or `app/api/sessions/[id]/end/
    route.ts` is modified or removed, only new lines added.

## 8. Error States

- **Ledger insert fails after `add_minutes` succeeds:** balance change stands (already committed by
  the RPC); error logged via `console.error('[minutes-ledger] Failed to write ledger event:', ...)`
  matching `writeAuditEvent()`'s exact convention; webhook still returns 200 (Stripe's existing
  "always 200" rule in this handler is unchanged).
- **Ledger insert fails after `deduct_minutes` succeeds (session end):** identical pattern — session
  still marked completed, balance still deducted, `/api/sessions/[id]/end` still returns its existing
  `{ minutesUsed, newBalance }` response unchanged; ledger write failure is logged only, never
  surfaced to the user (this is an internal diagnosability feature, not a user-facing guarantee that
  can fail their session-end flow).
- **All-time total query fails (`getTotalMinutesConsumed` throws or Supabase errors):** billing page
  falls back to rendering the card exactly as it does today, without the new "Total consumed to
  date" line at all (fail silent, not fail loud) — this is a secondary stat, not a load-bearing part
  of the page; a `try/catch` around the new query with a `null`/omitted-render fallback, consistent
  with how `HomeRecommendationSection` in `DashboardClient.tsx` already silently no-ops on fetch
  failure.
- **Session detail page's `duration_mins` is null/undefined** (should not happen for a truly
  `completed` session per the existing deduction code always writing a number, but defensively):
  render nothing for the "Minutes used" row rather than "NaN min" or a blank crash.

## 9. Edge Cases

- **First-ever recharge for a brand-new user:** ledger row's `resulting_balance` correctly reflects
  the post-trial-credit + topup total (no special-casing needed — the write happens after
  `add_minutes` regardless of prior balance).
- **User who has only ever had trial minutes credited (via `customer.subscription.created`), never a
  topup, never a completed session:** `minutes_ledger` has zero rows for that user; all-time total
  correctly renders "0 min" (State D) — trial-minute grants themselves are a
  `customer.subscription.created`/`.updated` event, not a `topup`, and are explicitly out of this
  spec's two write sites (see Section 10 — this spec only instruments the topup and
  session-deduction paths named in the brief, not subscription-lifecycle minute grants).
- **Session force-ended by the gap watchdog (not by user clicking "End Session"):** goes through
  `forceEndSession()` in `lib/session-billing.ts`, which is Write Site 2's second call site — same
  ledger behavior as a manual end, no special-casing needed.
- **User views the billing page while a session is actively in progress (not yet ended):** the
  all-time total simply doesn't yet include that in-progress session's eventual deduction — correct
  and expected, since the deduction (and its ledger row) only happens at session-end.
- **Very large all-time total (a long-tenured heavy user):** `SUM`/reduce over potentially hundreds
  of rows — acceptable at this scale; no pagination or aggregation-table optimization is in scope for
  this ship (flagged as a future consideration only if row counts become a real performance concern,
  not a blocking requirement now).

## 10. Out of Scope

- **Retroactive backfill of ledger history for events before this ships.** Recharges and deductions
  that already happened cannot be reconstructed after the fact — the ledger starts recording from
  ship date forward only, per the feature brief's explicit constraint.
- **Any change to how minutes are calculated, deducted, or credited** — `add_minutes`,
  `deduct_minutes`, and `computeBilledMinutes()` are untouched; this spec only adds observability
  alongside their existing, confirmed-correct call sites.
- **Any change to the already-fixed dashboard display bug** (commit `354a6be`) — closed, unrelated.
- **A full internal admin/support UI for browsing the ledger.** Internal diagnosis is via direct
  Supabase query access to `minutes_ledger` (service-role read policy already grants this) — this is
  confirmed sufficient for this ship; no internal-only page or endpoint is built.
- **Instrumenting `customer.subscription.created`/`.updated` trial-minute or plan-minute grants as
  ledger events.** The feature brief and this spec are scoped specifically to "every call to
  `add_minutes`... currently only triggered from the Stripe topup webhook" — subscription-lifecycle
  minute grants are a separate code path (direct `users` table update, not `add_minutes`/
  `deduct_minutes` RPCs) and are not wired into this ledger in this ship. If Arun wants those
  instrumented too, that is a follow-up spec, not silently added here.
- **Idempotency/dedup logic for duplicate Stripe webhook deliveries.** This spec logs whatever the
  existing `add_minutes` RPC actually does; it does not add new dedup logic on top of a pre-existing
  RPC behavior that is out of this spec's stated non-negotiable boundary (do not touch RPC logic).
- **A "resulting balance" backfill/reconciliation job** to detect drift between
  `SUM(minutes_ledger.delta_minutes)` and the live `users.minutes_balance` — not built in this ship;
  flagged as a natural future enhancement once the ledger has real production data, not a blocker now.

## 11. Open Questions

None. All six questions raised in the feature brief are resolved above:

1. **New table vs. extending `session_billing_audit_log`** → resolved: new `minutes_ledger` table
   (Section 6.1), full schema in Section 6.2.
2. **Exact trigger point for recharge logging** → resolved: Section 6.4, immediately after the
   existing `add_minutes` RPC succeeds in the Stripe topup webhook branch, purely additive.
3. **Exact screens/placement for per-call and all-time display** → resolved: Section 4.1 (session
   detail page) and Section 4.2 (billing page, inside the existing Coaching Minutes card), with full
   copy/layout/empty states in Sections 4–5.
4. **Whether "per call" needs to cover anything beyond session calls** → resolved: confirmed via
   full-codebase search that `deduct_minutes` has exactly two call sites, both session-related; no
   other minutes-consuming action exists today (Section 6.5).
5. **Whether internal diagnosability needs more than direct DB query access** → resolved: confirmed
   sufficient; no internal UI built (Section 10).
6. **Acceptance tests and edge cases** → resolved: Sections 7–9 (10 acceptance tests, 5 edge cases).

## 12. Dependencies

- `session_billing_audit_log` (migration 051) and `lib/session-billing.ts`'s existing
  `writeAuditEvent()`/`computeBilledMinutes()` must continue to exist unchanged — this spec reads
  from and sits alongside them, does not replace them.
- The existing `add_minutes` and `deduct_minutes` Postgres RPC functions must exist and continue to
  return the new balance as their call's data payload (already true today, per `end/route.ts`'s
  `deductResult.data` usage) — `writeMinutesLedgerEvent()` calls must reuse that returned value for
  `resulting_balance`, never recompute it independently, to avoid any drift between the ledger's
  recorded balance and the RPC's actual mutation.
- `supabase/migrations/0XX_minutes_ledger.sql` must be applied before any code path calls
  `writeMinutesLedgerEvent()` — sequencing note for the Scheduler/deployment step, not a product
  dependency.
- No dependency on HUME-NATIVE-01 or any other in-flight spec — fully independent.

---

## CEO Approval

**Status: APPROVED**
**Date:** 2026-07-05
**Reviewed by:** CEO Agent (on behalf of Arun)

Confirmed against the feature brief (`docs/specs/BILLING-LEDGER-01-feature-brief.md`):

- Scope matches exactly — new `minutes_ledger` table, per-call + all-time user-facing display, and
  direct-query internal diagnosability. Nothing invented, nothing dropped.
- Section 11 (Open Questions) is genuinely empty — all six brief questions resolved with concrete,
  specific answers, not hand-waved.
- All non-negotiable constraints respected: `add_minutes`/`deduct_minutes` RPC logic is untouched
  (purely additive `await` calls after each RPC succeeds); no existing table/column deleted or
  modified; RLS specified and consistent with the `session_billing_audit_log` (migration 051)
  pattern; no regression risk to checkout/session-end/dashboard flows (AC-10 requires verifying no
  existing line is changed); no retroactive backfill promised.
- Schema (Section 6.2) is fully specified — columns, types, nullability rationale, CHECK
  constraint, indexes, and RLS policies — with no ambiguity left for a developer to guess at.
- User-facing display (Sections 4.1, 4.2, Section 5) is concretely specified — exact copy, exact
  colors/sizes tied to the existing design system, exact file/component locations, and all four
  states (normal, zero-minutes-billed, has-total, zero-total-ever) mocked out in full.

**No code has been written yet.** This spec is cleared to proceed to development. Development must
build only to this approved spec — any deviation discovered during implementation must be escalated
back through the BA, not resolved by the developer's own judgment.
