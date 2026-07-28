# Session Traceability IDs — Requirement Document
Version: 1.0
Status: DRAFT — ready for CEO review
Author: Business Analyst Agent
Date: 2026-07-27

---

## 1. Purpose

Today, a session created via `POST /api/partner/v1/sessions` is traceable back to exactly one thing
server-side: the `partner_account_id` resolved from the caller's API key
(`requirePartnerApiKey()`, `lib/partner/auth.ts:64-179`). There is no reseller-supplied identifier
Clio records alongside a session, no mechanism to stop a reseller's retried/duplicated request from
dispatching a second real meeting-bot join, and no single internal log row that ties a session's
identity, duration, and Hume config together for support, billing, or auditing purposes. Arun's own
words: "we need to track this request and response in a table with this ids and duration so its
easier to create dashboard, insight and billing or auditing. just with api key its difficult to do
that."

Without this fix: every dashboard, billing reconciliation, or support investigation Arun builds next
has nothing to query against except raw `partner_sessions`/`usage_events` rows keyed only by Clio's
own opaque UUIDs — no reseller-side correlation, no de-duplication of accidental double-sends, and no
per-session record of which Hume config actually ran. This is a pure data-foundation brief: no new
screen, no new dashboard (explicitly out of scope per Arun — "at this point new dashboard not
needed"), no change to how a session's content or voice behaves.

## 2. User Story

As a **reseller/partner** calling `POST /api/partner/v1/sessions`,
I want to send my own reseller identifier and, optionally, a unique key for this specific session
request,
so that Clio can correlate every session back to me, and so that if my system retries or double-sends
the same request, Clio does not start a second real meeting-bot session.

As **Arun** (product owner, responsible for future dashboard/billing/auditing work),
I want every session logged in one place with its reseller, end-client, Hume config, and duration,
so that building a dashboard, reconciling billing, or auditing a support ticket never again depends on
joining across scattered tables by opaque UUID alone.

As an **internal Clio staff member** investigating a glitch reported inside a session,
I want the glitch record to carry the same trace identifiers as the session it came from,
so that I can tell which reseller/end-client/Hume config produced it — without this ever being
visible to any partner-facing surface.

There is no reseller-admin-UI-facing story — resellers interact with this feature purely through the
existing API contract (request fields, response fields, webhook payload); no new page.

## 3. Trigger / Entry Point

No new route. This brief modifies three existing entry points and adds two new internal-only
background jobs:

1. **`POST /api/partner/v1/sessions`** (`app/api/partner/v1/sessions/route.ts`) — gains two new
   request fields (`reseller_id` mandatory, `reseller_unique_id` optional) and new response behavior.
   Trigger: unchanged — a reseller's server calls this to start a session. Auth: unchanged —
   `requirePartnerApiKey()`, API key or OAuth2 token, never a Clerk session.
2. **`GET /api/partner/v1/sessions/:clio_session_ref`**
   (`app/api/partner/v1/sessions/[clio_session_ref]/route.ts`) — gains one new response field.
   Trigger: unchanged — a reseller polls session status.
3. **Outbound partner webhooks** (`lib/partner/webhooks.ts`) — gains new payload fields. Trigger:
   unchanged — fired by `recordBillableEvent()` and `recordInsightsReadyEvent()` at their existing
   call sites.
4. **NEW: `partnerSessionTraceLogFinalizer`** (new file `inngest/partner-session-trace-log.ts`) —
   Inngest event-triggered function, subscribed to the existing `clio/partner-session.ended` event
   (established by B2B-37, now live in production — emitted from exactly 3 call sites:
   `lib/partner/live-render.ts`'s `handleSessionEnd()`, `inngest/partner-live-cutoff.ts`, and
   `inngest/partner-trial-cutoff.ts`). Trigger: automatic, the instant any session reaches a terminal
   status. No new emission code needed anywhere — this brief adds a second listener to an event that
   already fires reliably.
5. **NEW: `partnerSessionTraceLogPurge`** (same new file) — Inngest cron function, `0 3 * * *` UTC
   (mirrors `partnerSessionInsightsPurge`'s exact schedule). Trigger: daily, automatic.

No user must be in any particular state (no login, no onboarding) — every trigger here is
server-to-server or cron, matching this whole API surface's existing trust model.

## 4. Screen / Flow Description

N/A — no user-facing screen. This is a request/response contract change plus two background jobs, per
the CEO brief's explicit "data-foundation only, no dashboard" scope. The one indirect surface touched
is the existing Developer Portal API reference page (`app/dashboard/configurator/docs/DocsClient.tsx`)
— its own flow (a partner-admin reading static documentation) is unchanged; only its content gains a
new field and a new short section (Section 6.7 below).

## 5. Visual Examples

N/A per the CEO brief ("Wireframes are not needed for this brief — no new UI"). The one content change
to an existing screen (the Developer Portal docs page) is copy-only, specified verbatim in Section 6.7
— not a layout or component change, so no wireframe applies.

## 6. Data Requirements

### 6.1 Design decision — what "reseller_id" resolves to, and why some new columns look redundant

Per Open Item 1 (Section 7 below), a request's `reseller_id` is validated to exactly equal
`auth.partnerAccountId` before anything else happens — a mismatch is rejected outright. That means,
for every row this brief ever writes, `reseller_id` and `partner_account_id` are, by construction,
always the same value. Several of the tables below (Section 6.3, 6.6) still carry an explicit,
separately-named `reseller_id` column even though it duplicates an already-present
`partner_account_id` column on the same row. This is deliberate, not an oversight: the CEO brief names
`reseller_id` as one of "the same five trace identifiers" required on the internal glitch tracker and
the new log table by name, specifically so a future dashboard/support engineer reading those tables
doesn't have to know that `partner_account_id` silently doubles as `reseller_id` — literal fidelity to
the brief's named-column list, at the cost of one redundant-but-DB-enforced-consistent column per
table. Enforced, not just documented: `CHECK (reseller_id = partner_account_id)` on the new table
(Section 6.3).

### 6.2 Zod schema changes — `lib/partner/session-schema.ts`

Two new fields on `CreateSessionSchema` (`lib/partner/session-schema.ts:29-68`), following the exact
style of the existing `partner_reference`/`end_user_name` fields immediately around them:

```ts
// B2B-38 (docs/specs/B2B-38-requirement-document.md §6.2) — mandatory for every account_kind
// (Open Item 3), validated against auth.partnerAccountId imperatively in the route (Zod has no
// access to the resolved auth context at parse time — same reason client_id's channel_partner
// requirement is enforced in the route, not here). UUID because it must be directly comparable to
// auth.partnerAccountId, which is itself a partner_accounts.id UUID.
reseller_id: z.string().uuid('reseller_id must be a valid UUID'),
// B2B-38 §6.2 — optional. Idempotent-replay key (Open Item 2), scoped per-reseller. Same
// printable-ASCII/length convention as partner_reference/partner_end_user_ref immediately above.
reseller_unique_id: z.string().min(1).max(256).regex(PRINTABLE_ASCII).optional(),
```

Placed alongside the other shared/unchanged fields (after `partner_reference`, before the B2B-34
`client_id` block) — additive only, no existing field's validation changes. No new `.refine()` needed;
the mismatch check (`reseller_id` vs. `auth.partnerAccountId`) requires the resolved auth context,
which Zod's `.parse()` does not have — enforced imperatively in the route, exactly like `client_id`'s
own channel-partner requirement.

### 6.3 New table — `partner_session_trace_logs`

**Design decision (CEO brief Question 1): a new standalone table**, not a view/materialization —
populated at session-creation (identity fields) and updated/finalized at session-end (duration +
whatever Hume config was actually provisioned). A view over `partner_sessions` cannot hold
`duration_seconds` as a stable, purge-independent fact once the source row's `ended_at` might
theoretically be touched by future work, and a view offers no independent 60-day retention clock
separate from `partner_sessions` itself (which is never purged) — a real table is required for the
retention requirement alone.

**Wire-vs-DB naming (CEO brief Question 1): no split needed for `reseller_id`.** Migration 095's
`client_id` → `end_client_id` split exists specifically because `client_id` collides with the
unrelated `partner_oauth_clients.client_id` column. A repository-wide grep for `reseller_id` (per the
CEO brief's own verification) found zero existing hits — no collision, no reason to rename on the way
to the DB. `end_client_id` (not `client_id`) is still used for the client-identity column here, for
consistency with the DB-side name already established on `partner_sessions`, `usage_events`, and
`partner_session_insights` — introducing a fourth table that instead uses `client_id` for the
identical concept would be the actual new inconsistency.

```sql
-- 099_b2b38_session_traceability_ids.sql

CREATE TABLE IF NOT EXISTS partner_session_trace_logs (
  id                  UUID        DEFAULT uuid_generate_v4() PRIMARY KEY,
  clio_session_ref    UUID        NOT NULL UNIQUE REFERENCES partner_sessions(id) ON DELETE CASCADE,
  partner_account_id  UUID        NOT NULL REFERENCES partner_accounts(id) ON DELETE CASCADE,
  reseller_id         UUID        NOT NULL REFERENCES partner_accounts(id) ON DELETE CASCADE,
  end_client_id       UUID        REFERENCES partner_accounts(id) ON DELETE SET NULL,
  reseller_unique_id  TEXT,
  hume_config_id      TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ended_at            TIMESTAMPTZ,
  duration_seconds    INTEGER,
  CONSTRAINT chk_trace_log_reseller_matches_account CHECK (reseller_id = partner_account_id)
);

CREATE INDEX IF NOT EXISTS idx_trace_logs_partner_account ON partner_session_trace_logs(partner_account_id);
CREATE INDEX IF NOT EXISTS idx_trace_logs_created_at      ON partner_session_trace_logs(created_at);
CREATE INDEX IF NOT EXISTS idx_trace_logs_reseller_unique
  ON partner_session_trace_logs(partner_account_id, reseller_unique_id)
  WHERE reseller_unique_id IS NOT NULL;

ALTER TABLE partner_session_trace_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access on partner_session_trace_logs"
  ON partner_session_trace_logs FOR ALL
  USING (auth.role() = 'service_role');

COMMENT ON TABLE partner_session_trace_logs IS
  'B2B-38: one row per partner session, for future dashboard/billing/auditing. Populated at session
  creation (identity fields) and finalized at session end (ended_at/duration_seconds/hume_config_id)
  by partnerSessionTraceLogFinalizer, listening on the same clio/partner-session.ended event B2B-37
  established. Purged in full (row deleted, not redacted) 60 days after created_at by
  partnerSessionTraceLogPurge. Internal-only — no partner-facing surface reads this table.';
```

**Idempotent-replay uniqueness (Open Item 2) lives on `partner_sessions`, not this table** — see
Section 6.4. `idx_trace_logs_reseller_unique` above is a plain lookup index, not a uniqueness
constraint; the constraint that actually prevents a double dispatch is on `partner_sessions` because
that is where the atomic insert-and-detect-conflict happens (Section 6.5).

### 6.4 `partner_sessions` schema changes

```sql
-- same migration, 099_b2b38_session_traceability_ids.sql

ALTER TABLE partner_sessions ADD COLUMN IF NOT EXISTS reseller_unique_id TEXT;
ALTER TABLE partner_sessions ADD COLUMN IF NOT EXISTS hume_config_id TEXT;

-- Open Item 2's actual enforcement mechanism: a partial unique index, scoped per-reseller
-- (partner_account_id), matching the CEO brief's recommended default exactly.
CREATE UNIQUE INDEX IF NOT EXISTS idx_partner_sessions_reseller_unique_id
  ON partner_sessions(partner_account_id, reseller_unique_id)
  WHERE reseller_unique_id IS NOT NULL;
```

`hume_config_id` mirrors `hume_chat_id`'s existing shape on this same table exactly (nullable `TEXT`,
best-effort-populated post-creation — see Section 6.6). No index needed on `hume_config_id` itself; it
is only ever read by primary key (`id`).

### 6.5 `app/api/partner/v1/sessions/route.ts` changes — mismatch rejection + idempotent replay

**Open Item 1, resolved as recommended: reject 422.** Checked immediately after Zod parsing succeeds,
before the `client_id` pre-flight block, before any DB write — cheapest possible check, since
`auth.partnerAccountId` is already resolved by `requirePartnerApiKey()` and needs no DB round trip:

```ts
const {
  meeting_url,
  partner_topic_ref,
  content_ref,
  content_pages,
  content_source_id,
  content_to_explain,
  title,
  subtitle,
  expected_duration_minutes,
  partner_end_user_ref,
  partner_reference,
  client_id,
  end_user_role,
  end_user_name,
  end_user_industry,
  reseller_id,          // NEW
  reseller_unique_id,   // NEW
} = parsed.data

// B2B-38 §6.5 — reseller_id mismatch pre-flight (Open Item 1). Runs before client_id's own
// pre-flight and before any row insert — a mismatched reseller_id must never create a session row
// or incur vendor cost, exactly mirroring why client_id's own pre-flight runs first today.
if (reseller_id !== auth.partnerAccountId) {
  return NextResponse.json(
    {
      error: {
        code: 'invalid_reseller_id',
        message: 'reseller_id does not match the account resolved from your API key.',
      },
    },
    { status: 422 }
  )
}
```

A request that omits `reseller_id` entirely never reaches this check — it fails Zod's own required-
field validation first, returning the existing generic `{ error: 'Validation failed', details:
parsed.error.flatten() }` 422 response (`route.ts:35-37`, unchanged). Only a **present but wrong**
`reseller_id` reaches the new `invalid_reseller_id` code — this distinction is the exact answer to the
CEO brief's Question 5 ("missing entirely → what error code/status; present but mismatched → Open Item
1's resolution").

**Open Item 2, resolved as recommended — mechanism: reuse the existing `partner_sessions` insert as
the atomic claim.** No new pre-flight query. The existing
`.insert({...}).select('id').single()` call (`route.ts:164-189`) already is the one place a session
row is atomically created; the new partial unique index (Section 6.4) makes a replay fail that exact
insert with a Postgres unique-violation, which the route now catches and branches on — an idiom
already established in this codebase for exactly this class of "two near-simultaneous calls for the
same idempotency key" problem (`lib/partner/signup.ts:76-90`, code comment: "two near-simultaneous
calls... unique violation (code 23505)... the losing call... returns the winner's [row] instead of
leaving duplicate garbage behind").

```ts
const { data: inserted, error: insertError } = await supabase
  .from('partner_sessions')
  .insert({
    partner_account_id: auth.partnerAccountId,
    partner_api_key_id: auth.apiKeyId,
    partner_oauth_client_id: auth.clientId,
    test_mode: auth.mode === 'test',
    meeting_url,
    partner_topic_ref: partner_topic_ref ?? null,
    content_ref: content_ref ?? null,
    partner_end_user_ref: partner_end_user_ref ?? null,
    partner_reference: partner_reference ?? null,
    end_client_id: endClientId,
    end_user_role: end_user_role ?? null,
    end_user_name: end_user_name ?? null,
    end_user_industry: end_user_industry ?? null,
    reseller_unique_id: reseller_unique_id ?? null,   // NEW
    status: 'requested',
    ...inlineColumns,
  })
  .select('id')
  .single()

// B2B-38 §6.5 — Open Item 2's idempotent-replay branch. A unique-violation on
// idx_partner_sessions_reseller_unique_id means this exact (reseller, reseller_unique_id) pair
// already has a session — return that session's ORIGINAL response, do not create a new row, do not
// call dispatchMeetingBot(). "True idempotent-replay pattern, not a duplicate-rejection pattern"
// per the CEO brief's own framing: any other field differences in this retried request (e.g. a
// different meeting_url) are deliberately ignored — reseller_unique_id alone is the idempotency
// key, mirroring standard idempotency-key semantics. This branch runs BEFORE dispatchMeetingBot()
// is ever reached (dispatch happens later, in the test-mode/live-mode branches below), so no
// concurrent replay can ever cause a second real bot join — the DB unique index is the sole source
// of truth, not an application-level check-then-act.
if (insertError?.code === '23505' && reseller_unique_id) {
  const { data: original } = await supabase
    .from('partner_sessions')
    .select('id, status')
    .eq('partner_account_id', auth.partnerAccountId)
    .eq('reseller_unique_id', reseller_unique_id)
    .maybeSingle()

  if (original) {
    const originalRenderUrl = `${process.env.NEXT_PUBLIC_APP_URL ?? 'https://distill-peach.vercel.app'}/partner-render/${original.id}`
    return NextResponse.json(
      { clio_session_ref: original.id, status: original.status, render_url: originalRenderUrl },
      { status: 201 }
    )
  }
  // Conflict fired but the row vanished between insert and re-select (should not happen — no
  // delete path exists for partner_sessions) — fall through to the existing generic error below
  // rather than silently succeed on an inconsistent state.
}

if (insertError || !inserted) {
  console.error('[partner/sessions] Failed to insert partner_sessions row:', insertError?.message)
  return NextResponse.json({ error: { code: 'internal_error', message: 'Failed to create session.' } }, { status: 500 })
}
```

**Accepted trade-off, disclosed not hidden:** because the replay is only detected at the DB insert
(not at an earlier pre-flight step), a replay request still runs the `client_id` pre-flight and, for
Option 1 (inline content) requests, the full content-source/SSRF/transition-marker pre-flight work
again before reaching the insert — wasted CPU, zero external vendor cost, zero dispatch. This is the
same class of accepted inefficiency this codebase already tolerates elsewhere for idempotency checks
that only bind at the write itself; it does not violate "does not dispatch a second real session/bot
join," since dispatch happens strictly after this point in the function.

**Response addition — `reseller_unique_id` echoed back when sent** (both the test-mode 201 response,
`route.ts:262-270`, and the live-mode 201 response, `route.ts:345-352`):

```ts
return NextResponse.json(
  {
    clio_session_ref: clioSessionRef,
    status: dispatchResult.status,
    render_url: renderUrl,
    ...(reseller_unique_id ? { reseller_unique_id } : {}),   // NEW
    ...(dispatchResult.error ? { error: dispatchResult.error } : {}),
  },
  { status: 201 }
)
```

Same conditional-spread convention this file already uses for `error` — present only when the caller
sent one, matching the CEO brief's exact wording ("echoes back... when they sent one"), not always
present-as-null.

**New trace-log row, inserted immediately after a genuinely new `partner_sessions` row is created**
(right after the `insertError || !inserted` guard, before the `clioSessionRef`/`renderUrl` are used
further down) — best-effort, logged-not-thrown, matching this file's own `assembled_prompt_snapshot`
non-fatal convention:

```ts
const { error: traceLogError } = await supabase.from('partner_session_trace_logs').insert({
  clio_session_ref: clioSessionRef,
  partner_account_id: auth.partnerAccountId,
  reseller_id: auth.partnerAccountId,   // always equal — validated above (§6.1)
  end_client_id: endClientId,
  reseller_unique_id: reseller_unique_id ?? null,
})
if (traceLogError) {
  console.error('[partner/sessions] Failed to insert partner_session_trace_logs row (non-fatal):', traceLogError.message)
}
```

Never blocks or fails the session-creation response — a logging-table failure must never prevent a
real session from being created and dispatched.

### 6.6 `hume_config_id` write point — `lib/partner/live-render.ts`

**CEO brief correction (Question 2): `hume_native_config_id` does NOT already exist on
`partner_sessions`.** The brief's own citation (`lib/voice/hume-native/session-details.ts:233,247,
262,269`) reads from the `sessions` table — the separate, legacy B2C table — not `partner_sessions`.
Verified directly: `partner_sessions` has no config-id column of any name today (full column list
checked across every migration that touches it, `071`/`077`/`078`/`079`/`080`/`083`/`095`/`097`/`098`).
`humeConfigId` is instead computed **in-memory only**, per render, inside
`resolveTemplateSessionRender()` and `resolveInlineSessionRender()` (both in `live-render.ts`), via
`provisionNativeConfig()`, and returned to the caller as part of `LiveRenderResult` — never persisted.
This is a genuine gap the CEO brief's own Question 2 anticipated ("confirm the write happens at the
correct point in the session lifecycle so the mandatory-in-the-glitch-record requirement is actually
satisfiable, not aspirational") — resolved here, not silently assumed away.

**Fix: best-effort persist to the new `partner_sessions.hume_config_id` column (§6.4), immediately
after `provisionNativeConfig()` resolves, at both call sites** — mirrors the existing
`assembled_prompt_snapshot` persist pattern exactly (same function, same non-fatal `if (error)
console.error` convention), added as a second, separate update (cannot be combined into the existing
`assembled_prompt_snapshot` update, since that write happens *before* `provisionNativeConfig()`
returns a config id):

Template-mode call site (`live-render.ts`, right after line 247, inside the existing `try` block):

```ts
    const provisioned = await provisionNativeConfig({ sessionId: session.id, assembledPrompt: prompt })
    humeConfigId = provisioned.configId

    // B2B-38 §6.6 — best-effort persist, mirrors assembled_prompt_snapshot's own convention just
    // above. Non-fatal: a failed write here means partner_session_trace_logs.hume_config_id and
    // glitch_instances.hume_config_id stay null for this session — everything else proceeds
    // unaffected (session already has voice either way, since provisioning itself succeeded).
    const { error: configIdError } = await supabase
      .from('partner_sessions')
      .update({ hume_config_id: humeConfigId })
      .eq('id', session.id)
    if (configIdError) {
      console.error('[partner/live-render] failed to persist hume_config_id (non-fatal):', { sessionId: session.id, error: configIdError })
    }
  } catch (err) {
```

Inline-mode call site — identical addition, right after line 373, same pattern, same log-prefix
convention as that call site's existing `'(inline, non-fatal)'` messages.

**Edge case, explicit, not hidden:** `provisionNativeConfig()` can throw (voice provisioning failure —
"session proceeds without voice," existing behavior, unchanged by this brief). When it does,
`humeConfigId` stays `null` and this new update is never reached — `partner_sessions.hume_config_id`,
`partner_session_trace_logs.hume_config_id`, and `glitch_instances.hume_config_id` are all correctly
`null` for that session. This is the accurate, honest state — not an error condition this brief
introduces, and not something to paper over with a fabricated value.

### 6.7 Finalization + retention — new file `inngest/partner-session-trace-log.ts`

```ts
import { inngest } from './client'
import { createSupabaseAdminClient } from '@/lib/supabase'

/**
 * B2B-38 — finalizes a partner_session_trace_logs row the instant its session ends. Listens on the
 * SAME clio/partner-session.ended event B2B-37 established (3 emit call sites, already reliable,
 * already live) — purely additive, no changes to any of those 3 call sites. Inngest supports
 * multiple functions subscribed to one event natively; this is a second listener, not a
 * modification of partnerSessionInsightsExtractor's own listener.
 */
export const partnerSessionTraceLogFinalizer = inngest.createFunction(
  { id: 'partner-session-trace-log-finalizer', name: 'Finalize Partner Session Trace Log', retries: 3,
    triggers: [{ event: 'clio/partner-session.ended' }] },
  async ({ event, step }) => {
    const { partnerSessionId } = event.data as { partnerSessionId?: string }
    if (!partnerSessionId) return { status: 'skipped', reason: 'missing_partner_session_id' }

    await step.run('finalize-trace-log', async () => {
      const supabase = createSupabaseAdminClient()
      const { data: session, error } = await supabase
        .from('partner_sessions')
        .select('created_at, ended_at, hume_config_id')
        .eq('id', partnerSessionId)
        .maybeSingle()

      if (error || !session) {
        console.error(`[partner-session-trace-log] Could not read partner_sessions ${partnerSessionId}:`, error?.message)
        return
      }

      const endedAt = (session.ended_at as string | null) ?? new Date().toISOString()
      const durationSeconds = Math.max(
        0,
        Math.round((new Date(endedAt).getTime() - new Date(session.created_at as string).getTime()) / 1000)
      )

      const { error: updateError } = await supabase
        .from('partner_session_trace_logs')
        .update({ ended_at: endedAt, duration_seconds: durationSeconds, hume_config_id: session.hume_config_id })
        .eq('clio_session_ref', partnerSessionId)

      if (updateError) {
        console.error(`[partner-session-trace-log] Failed to finalize ${partnerSessionId}:`, updateError.message)
      }
    })

    return { status: 'finalized' }
  }
)

/**
 * B2B-38 — 60-day full-row retention purge. Open Item 4, resolved as recommended: FULL DELETE, not
 * redact-in-place. Mirrors partnerSessionInsightsPurge's exact shape
 * (inngest/partner-session-insights-extractor.ts:494-513) — same cron, same retries, same
 * RPC-with-cutoff pattern — deliberately NOT glitchInstancesPurge/partnerSessionInsightsPurge's own
 * redact-in-place behavior, because (a) this table has no free-text transcript/glitch detail to
 * selectively strip while preserving structured fields for historical reporting — every column here
 * IS the structured metadata those two jobs preserve — and (b) Arun's own word was "auto-delete,"
 * which those two jobs' redact-in-place behavior does not literally do. Cutoff basis: created_at
 * (session-creation time), not ended_at — a session that never reaches a terminal status (dispatch
 * failure, abandoned meeting_url, etc.) has a null ended_at forever and would never be purged if the
 * cutoff were ended_at-based, an unbounded-retention leak the created_at basis avoids entirely.
 */
const TRACE_LOG_RETENTION_DAYS = 60

export const partnerSessionTraceLogPurge = inngest.createFunction(
  { id: 'partner-session-trace-log-purge', name: 'Partner Session Trace Logs — 60-Day Purge', retries: 3,
    triggers: [{ cron: '0 3 * * *' }] },
  async ({ step }) => {
    const purged = await step.run('purge-expired-trace-logs', async () => {
      const supabase = createSupabaseAdminClient()
      const cutoffIso = new Date(Date.now() - TRACE_LOG_RETENTION_DAYS * 24 * 60 * 60 * 1000).toISOString()
      const { data, error } = await supabase.rpc('purge_partner_session_trace_logs', { p_cutoff: cutoffIso })
      if (error) throw new Error(`Trace log purge RPC failed: ${error.message}`)
      return (data as number) ?? 0
    })
    console.log(`[partner-session-trace-log-purge] Deleted ${purged} row(s)`)
    return { purged }
  }
)
```

Companion RPC, same migration (099):

```sql
CREATE OR REPLACE FUNCTION purge_partner_session_trace_logs(p_cutoff TIMESTAMPTZ)
RETURNS INTEGER AS $$
DECLARE
  v_count INTEGER;
BEGIN
  WITH deleted AS (
    DELETE FROM partner_session_trace_logs WHERE created_at < p_cutoff RETURNING id
  )
  SELECT count(*) INTO v_count FROM deleted;
  RETURN v_count;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION purge_partner_session_trace_logs IS
  'B2B-38: called daily by inngest/partner-session-trace-log.ts (partnerSessionTraceLogPurge, cron
  0 3 * * * UTC) with p_cutoff = now() - 60 days. Full row DELETE, not redact — Open Item 4.';
```

**Registration** — `app/api/inngest/route.ts` gains one new import line and two new entries in the
`functions:` array, following the exact pattern of every existing multi-export Inngest file import on
that page (e.g. line 34-38's `partnerSessionInsightsExtractor, partnerSessionInsightsBackstopSweep,
partnerSessionInsightsPurge` grouped import):

```ts
import { partnerSessionTraceLogFinalizer, partnerSessionTraceLogPurge } from '@/inngest/partner-session-trace-log'
```

...and appended to the existing `functions: [...]` array (line 60).

### 6.8 Outbound webhook payload — `lib/partner/webhooks.ts`

`WebhookPayload` interface (`lib/partner/webhooks.ts:35-66`) gains three new fields, matching
`end_client_id`'s own existing declaration style exactly (optional key, nullable value, additive,
excluded from `canonicalHashInput()`):

```ts
// B2B-38 (docs/specs/B2B-38-requirement-document.md §6.8) — additive, mirrors end_client_id's own
// convention immediately above. NOT part of canonicalHashInput()'s idempotency hash. reseller_id is
// declared optional (?) purely for style consistency with end_client_id; at runtime it is always
// populated (non-null) whenever a payload is built at all, since every call site already requires a
// resolved partner_account_id to proceed.
reseller_id?: string | null
reseller_unique_id?: string | null
hume_config_id?: string | null
```

**`recordBillableEvent()`** (`lib/partner/webhooks.ts:107-271`) — extend the existing `end_client_id`
lookup (line 133-140, currently `.select('end_client_id')`) to also fetch the two new fields, and add
`reseller_id` directly from the function's own input parameter (no extra query needed — it is already
`params.partnerAccountId`):

```ts
let endClientId: string | null = null
let resellerUniqueId: string | null = null
let humeConfigId: string | null = null
if (params.clioSessionRef) {
  const { data: sessionRow, error: sessionLookupError } = await supabase
    .from('partner_sessions')
    .select('end_client_id, reseller_unique_id, hume_config_id')
    .eq('id', params.clioSessionRef)
    .maybeSingle()
  if (sessionLookupError) {
    console.error('[partner/webhooks] trace-id lookup failed (non-fatal):', sessionLookupError.message)
  }
  endClientId = (sessionRow?.end_client_id as string | null) ?? null
  resellerUniqueId = (sessionRow?.reseller_unique_id as string | null) ?? null
  humeConfigId = (sessionRow?.hume_config_id as string | null) ?? null
}

const payload: WebhookPayload = {
  // ...existing fields unchanged...
  end_client_id: endClientId,
  reseller_id: params.partnerAccountId,       // NEW
  reseller_unique_id: resellerUniqueId,       // NEW
  hume_config_id: humeConfigId,                // NEW
}
```

**`recordInsightsReadyEvent()`** (`lib/partner/webhooks.ts:568-631`) — gains two new required params,
mirroring `endClientId`'s existing caller-supplied-not-looked-up-internally convention exactly:

```ts
export async function recordInsightsReadyEvent(params: {
  partnerSessionId: string
  partnerAccountId: string
  extractionStatus: 'success' | 'success_empty' | 'failed'
  testMode: boolean
  partnerReference: string | null
  endClientId: string | null
  resellerUniqueId: string | null   // NEW
  humeConfigId: string | null        // NEW
}): Promise<void> {
  // ...
  const referencePayload = {
    // ...existing fields unchanged...
    end_client_id: params.endClientId,
    reseller_id: params.partnerAccountId,          // NEW
    reseller_unique_id: params.resellerUniqueId,   // NEW
    hume_config_id: params.humeConfigId,             // NEW
  }
```

Both callers in `inngest/partner-session-insights-extractor.ts` thread the two new values through,
mirroring exactly how `end_client_id` is already threaded (Section 6.9 below extends the same SELECTs
these callers already run).

### 6.9 `partner_session_insights` + `glitch_instances` — Question 3 (glitch-tracker propagation)

**Mechanism (CEO brief's option (a), confirmed): new nullable columns on the source table
(`partner_session_insights`), backfilled by the fan-out trigger via the columns already present on
`NEW`.** `glitch_instances` is populated exclusively by `fanout_glitch_instances()`
(migration `082`), which reads only `NEW.*` off `partner_session_insights` — it never independently
joins to `partner_sessions`. So the trace IDs must reach `partner_session_insights` first, then the
trigger copies them across, exactly as `end_client_id` already does today (migration `095` added
`partner_session_insights.end_client_id`; the trigger, however, was never updated to copy it into
`glitch_instances` — confirmed by direct read of migration `082`'s `fanout_glitch_instances()` body,
which does not reference `NEW.end_client_id` anywhere. This brief fixes that gap too, since it is
touching the same trigger for the same reason.)

```sql
-- same migration, 099_b2b38_session_traceability_ids.sql

ALTER TABLE partner_session_insights ADD COLUMN IF NOT EXISTS reseller_unique_id TEXT;
ALTER TABLE partner_session_insights ADD COLUMN IF NOT EXISTS hume_config_id TEXT;
-- end_client_id already exists (migration 095) — reused, not re-added.

ALTER TABLE glitch_instances ADD COLUMN IF NOT EXISTS reseller_id UUID;
ALTER TABLE glitch_instances ADD COLUMN IF NOT EXISTS end_client_id UUID;
ALTER TABLE glitch_instances ADD COLUMN IF NOT EXISTS reseller_unique_id TEXT;
ALTER TABLE glitch_instances ADD COLUMN IF NOT EXISTS hume_config_id TEXT;
-- No new column for clio_session_ref — glitch_instances.partner_session_id already IS the session's
-- id (== clio_session_ref, per partner_sessions' own "id UUID PRIMARY KEY -- == clio_session_ref"
-- column comment, migration 071 line 175). Adding a second column with the identical value would be
-- true redundancy with zero new information, unlike reseller_id (§6.1) which the brief explicitly
-- names as a required column even where it duplicates partner_account_id.

CREATE OR REPLACE FUNCTION fanout_glitch_instances()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.glitches IS NULL OR jsonb_array_length(NEW.glitches) = 0 THEN
    RETURN NULL;
  END IF;

  IF TG_OP = 'UPDATE' AND OLD.glitches IS NOT NULL THEN
    RETURN NULL;
  END IF;

  INSERT INTO glitch_instances (
    partner_session_id, partner_account_id, glitch_type, description, ordinal, extracted_at,
    reseller_id, end_client_id, reseller_unique_id, hume_config_id   -- NEW
  )
  SELECT
    NEW.partner_session_id,
    NEW.partner_account_id,
    g.value->>'type',
    g.value->>'description',
    (g.ordinality - 1)::int,
    COALESCE(NEW.extracted_at, now()),
    NEW.partner_account_id,      -- reseller_id — see §6.1, always equal to partner_account_id
    NEW.end_client_id,           -- NEW
    NEW.reseller_unique_id,      -- NEW
    NEW.hume_config_id           -- NEW
  FROM jsonb_array_elements(NEW.glitches) WITH ORDINALITY AS g(value, ordinality)
  ON CONFLICT (partner_session_id, ordinal) DO NOTHING;

  RETURN NULL;
END;
$$ LANGUAGE plpgsql;
```

**One-time backfill for pre-existing rows**, same rigor as migration `082`'s own precedent backfill
(this dev/staging DB may already have test rows from prior work, e.g. B2B-37's orphaned test session —
zero real production rows exist, per the CEO brief's own verification, but backfilling is nearly free
and matches established precedent):

```sql
UPDATE glitch_instances gi
SET reseller_id = psi.partner_account_id,
    end_client_id = psi.end_client_id,
    reseller_unique_id = psi.reseller_unique_id,
    hume_config_id = psi.hume_config_id
FROM partner_session_insights psi
WHERE gi.partner_session_id = psi.partner_session_id;
```

**Source-side population** — `partner_session_insights.reseller_unique_id`/`hume_config_id` are
populated at the exact same point `end_client_id` already is: `runInsightsIdempotencyGuard()`'s
initial-insert upsert (`inngest/partner-session-insights-extractor.ts:168-177`). Both new values are
sourced from `extractInsightsForPartnerSession()`'s own `partner_sessions` SELECT
(currently line 210, `'id, partner_account_id, hume_chat_id, test_mode, partner_reference,
end_client_id'`), extended:

```ts
const { data: session } = await supabase
  .from('partner_sessions')
  .select('id, partner_account_id, hume_chat_id, test_mode, partner_reference, end_client_id, reseller_unique_id, hume_config_id')
  .eq('id', partnerSessionId)
  .maybeSingle()
```

`runInsightsIdempotencyGuard()` gains two new parameters (`resellerUniqueId`, `humeConfigId`), threaded
through to its own upsert call exactly as `endClientId` already is (lines 145-177), and
`extractInsightsForPartnerSession()`'s call to it (lines 217-223) passes the two new values from the
extended SELECT above. `recordInsightsReadyEvent()`'s call inside
`extractInsightsForPartnerSession()` (line 296-303) and inside `markInsightsExtractionFailed()`
(line 371-378, whose own `partner_sessions!inner(...)` FK embed at line 339 is extended to
`partner_sessions!inner(test_mode, partner_reference, end_client_id, reseller_unique_id,
hume_config_id)`) both thread `resellerUniqueId`/`humeConfigId` through to the two new params added in
Section 6.8.

**Internal-only, never partner-facing — unchanged constraint, re-verified.** `glitch_instances` has no
partner-facing route today (confirmed by the CEO brief; re-confirmed here — no route under
`app/api/partner/` selects from `glitch_instances`, and this brief adds no such route). The 4 new
columns are exactly as internal as the table's existing `glitch_type`/`description` columns.

### 6.10 API response changes — `GET /api/partner/v1/sessions/:clio_session_ref`

```ts
const { data: session } = await supabase
  .from('partner_sessions')
  .select('id, status, created_at, ended_at, reseller_unique_id')   // extended
  .eq('id', params.clio_session_ref)
  .eq('partner_account_id', auth.partnerAccountId)
  .maybeSingle()

if (!session) {
  return NextResponse.json({ error: { code: 'not_found', message: 'Session not found.' } }, { status: 404 })
}

return NextResponse.json({
  clio_session_ref: session.id,
  status: session.status,
  created_at: session.created_at,
  ended_at: session.ended_at,
  ...(session.reseller_unique_id ? { reseller_unique_id: session.reseller_unique_id } : {}),   // NEW
})
```

Same conditional-inclusion convention as the POST response (Section 6.5) — present only when the
session was created with one. `reseller_id`/`client_id`/`hume_config_id` are deliberately **not**
added to this response — Section 6's "What Success Looks Like" only specifies `reseller_unique_id` as
echoed on the POST/GET responses; `reseller_id` and `hume_config_id` surface only in the webhook
payload and the internal log/glitch tables, per the brief's own "where specified" qualifier. `client_id`
was already never in this response and stays that way — unrelated to this brief, unchanged.

### 6.11 Developer Portal documentation — Question 6

**Location: `app/dashboard/configurator/docs/DocsClient.tsx`**, the existing partner-facing API
reference page (confirmed live at the "Start a session" quick-start step, lines 142-155). Two changes,
both copy-only, no new component, no enforcement:

**(a) Update the existing quick-start example** (lines 145-153) to include the now-mandatory
`reseller_id`:

```
POST /api/partner/v1/sessions
Authorization: Bearer <token>
Content-Type: application/json

{ "meeting_url": "https://meet.google.com/abc-defg-hij",
  "reseller_id": "<your partner_account_id>",
  "reseller_unique_id": "order-48213",
  "partner_topic_ref": "onboarding-101" }

→ 201 { clio_session_ref, status: "bot_active", render_url, reseller_unique_id: "order-48213" }
```

**(b) New short subsection, immediately after the existing "Quick start" `<Card>` (after line 170,
before the "Content & image auth" `<h2>`)**, verbatim copy:

```tsx
<h2 style={sectionHeadingStyle}>Session traceability IDs</h2>
<Card style={{ marginBottom: 16 }}>
  <p style={bodyStyle}>
    <code style={monoInline}>reseller_id</code> is required on every session — it must exactly match
    your own account (the same identity your API key resolves to). Optionally, send a{' '}
    <code style={monoInline}>reseller_unique_id</code> — a value unique to this request on your side
    (e.g. your own order or booking id). If you resend the same <code style={monoInline}>
    reseller_unique_id</code>, Clio will not start a second session — it returns the original
    session&apos;s response instead, so retries are always safe.
  </p>
  <p style={{ ...bodyStyle, marginBottom: 0 }}>
    <strong style={{ color: COLORS.textPrimary }}>We recommend saving every id Clio returns</strong>{' '}
    (<code style={monoInline}>clio_session_ref</code>, and your own{' '}
    <code style={monoInline}>reseller_unique_id</code> if you sent one) on your side. This makes it
    easier to reconcile billing and support questions later — but it&apos;s entirely optional; Clio
    does not require or verify that you&apos;ve stored anything.
  </p>
</Card>
```

Matches Arun's own wording precisely: "we also ask reseller or reseller's client also to save our
information, but it is also ok if he decides not to save but we recommend to save the info he gets
from the api" — recommendation only, explicitly non-enforced, stated as such in the copy itself.

## 7. Success Criteria (Acceptance Tests)

✓ **AT-1** Given a request with `reseller_id` equal to the authenticated account and no
  `reseller_unique_id`, when `POST /api/partner/v1/sessions` is called, then it returns 201 exactly as
  before, plus a `partner_session_trace_logs` row exists with `reseller_id`/`partner_account_id`
  matching, `end_client_id`/`reseller_unique_id`/`hume_config_id` null, and `duration_seconds` null.

✓ **AT-2** Given a request that omits `reseller_id` entirely, when the same endpoint is called, then it
  returns the existing generic 422 `{ error: 'Validation failed', details: ... }` (Zod's own required-
  field rejection) — not the new `invalid_reseller_id` code.

✓ **AT-3** Given a request with a `reseller_id` that does not equal `auth.partnerAccountId`, when the
  endpoint is called, then it returns 422 `{ error: { code: 'invalid_reseller_id', ... } }` and no
  `partner_sessions` row (and no `partner_session_trace_logs` row) is created.

✓ **AT-4** Given a direct `account_kind='partner'` caller sending `reseller_id` equal to their own
  `partner_account_id`, when the endpoint is called, then it succeeds — `reseller_id` is mandatory
  regardless of `account_kind` (Open Item 3), not scoped to `channel_partner` only.

✓ **AT-5** Given a `channel_partner` caller sending both a valid `reseller_id` (matching their own
  account) and a valid `client_id`, when the endpoint is called, then both validations pass
  independently and the session is created — `reseller_id`'s new mandatory check does not interfere
  with `client_id`'s existing channel-partner-only requirement.

✓ **AT-6** Given a request with `reseller_id` but no `reseller_unique_id`, when called twice with
  otherwise-identical bodies, then two independent `partner_sessions` rows are created (no idempotency
  applies when `reseller_unique_id` is absent).

✓ **AT-7** Given a request with a fresh `reseller_unique_id`, when called once, then it returns 201
  with a new `clio_session_ref`, and the response includes `reseller_unique_id` echoed back.

✓ **AT-8** Given the exact same `reseller_id` + `reseller_unique_id` sent a second time, when called
  again, then the response has the SAME `clio_session_ref`, `render_url`, and current `status` as
  AT-7's session — `dispatchMeetingBot()` is not called a second time (verified via mock call count),
  and no second `partner_sessions` row exists.

✓ **AT-9** Given two DIFFERENT resellers (two different API keys / `partner_account_id`s) both send the
  identical `reseller_unique_id` value, when both call the endpoint, then two independent sessions are
  created successfully — uniqueness is scoped per-reseller, not global.

✓ **AT-10** Given a replay request reuses an existing `reseller_unique_id` but supplies a genuinely
  different `meeting_url`, when called, then the original session's response is returned unchanged —
  the differing `meeting_url` is not applied, not validated, and does not error.

✓ **AT-11** Given an existing B2B-34 `client_id` test scenario (valid client, `channel_partner`
  account), when run against the updated route, then behavior is byte-for-byte unchanged aside from the
  new `reseller_id` requirement — regression coverage for "client_id stays completely unchanged."

✓ **AT-12** Given a session created WITHOUT `reseller_unique_id`, when its POST response is inspected,
  then the key `reseller_unique_id` is entirely absent from the JSON body (not present-as-null).

✓ **AT-13** Given a session created WITH `reseller_unique_id`, when `GET
  /api/partner/v1/sessions/:clio_session_ref` is called, then the response includes
  `reseller_unique_id` matching what was sent; given a session created without one, the key is absent.

✓ **AT-14** Given any billable or lifecycle event that dispatches an outbound webhook, when the payload
  is inspected, then it includes non-null `reseller_id` (equal to the account's own
  `partner_account_id`), plus `end_client_id`/`reseller_unique_id`/`hume_config_id` matching that
  session's stored values (null where not applicable), and none of the three new fields affect
  `payload_hash`'s idempotency computation.

✓ **AT-15** Given a session whose Hume config provisions successfully, when the session later ends and
  `partnerSessionTraceLogFinalizer` runs, then `partner_session_trace_logs.hume_config_id` matches the
  value written to `partner_sessions.hume_config_id` at provisioning time.

✓ **AT-16** Given a session whose Hume config provisioning fails (existing "session proceeds without
  voice" behavior, unchanged), when the session ends, then `hume_config_id` is `null` throughout —
  `partner_sessions`, `partner_session_trace_logs`, and (if any glitches were extracted)
  `glitch_instances` — with no error thrown anywhere in this chain.

✓ **AT-17** Given a session ends (any of the 3 existing `clio/partner-session.ended` emit paths), when
  `partnerSessionTraceLogFinalizer` runs, then `partner_session_trace_logs.duration_seconds` equals
  `ended_at - created_at` in whole seconds, and `ended_at` is populated.

✓ **AT-18** Given a `partner_session_trace_logs` row with `created_at` more than 60 days in the past,
  when `partnerSessionTraceLogPurge` runs, then that row is fully deleted (a subsequent `SELECT`
  returns no row) — not redacted-in-place. Given a row less than 60 days old, it is untouched.

✓ **AT-19** Given a session with extracted glitches, when the extraction pipeline writes
  `partner_session_insights.glitches` for the first time, then the resulting `glitch_instances` rows
  carry `reseller_id`, `end_client_id`, `reseller_unique_id`, and `hume_config_id` matching that
  session's trace data, with `glitch_type`/`description`/`ordinal` unchanged from today's behavior.

✓ **AT-20** Given the existing capture-vs-purge trigger guard (fires only on first population of
  `glitches`, never on the daily JSONB-purge rewrite), when the daily
  `purge_partner_session_insights_full_detail` RPC runs against a row this brief's new columns are
  present on, then the trigger does not re-fire and `glitch_instances`' 4 new columns are untouched —
  regression test for the existing "capture-only, never purge" invariant.

## 8. Error States

- **`reseller_id` missing** → existing generic Zod 422 (`Validation failed`), unchanged shape.
- **`reseller_id` present but mismatched** → new 422 `invalid_reseller_id`, no DB write of any kind.
- **`reseller_unique_id` replay lands a genuine DB conflict from a concurrent request** (two
  near-simultaneous identical requests both attempt the insert): the DB unique index guarantees exactly
  one insert succeeds; the other observes `insertError.code === '23505'` and takes the replay branch —
  no application-level race window, since detection is at the atomic insert itself, not a
  check-then-act pattern.
- **Trace-log row insert fails** (`partner_session_trace_logs` insert in `route.ts`) — logged, never
  blocks or fails the session-creation response (Section 6.5). The session is created and dispatched
  normally; only the audit-log row is missing, discoverable later via a manual join if ever needed.
- **`hume_config_id` persist fails** (`live-render.ts` update) — logged, never blocks the render or the
  live voice connection (Section 6.6). Matches the existing `assembled_prompt_snapshot` non-fatal
  convention at the same call sites.
- **`partnerSessionTraceLogFinalizer` cannot read the `partner_sessions` row** (should not happen in
  practice — same trust as the extraction pipeline's own equivalent lookup) — logged, function returns
  without updating; Inngest's `retries: 3` gives it further chances; the trace-log row is left
  un-finalized (created identity fields intact, duration/hume_config_id/ended_at stay null) rather than
  guessed at.
- **Trace-log purge RPC fails** — throws (matches `partnerSessionInsightsPurge`'s own precedent
  exactly), surfaces as a failed/retried Inngest run, never a silent no-op.
- **Outbound webhook trace-id lookup fails** (`recordBillableEvent()`'s extended SELECT) — logged,
  non-fatal; the three new fields fall back to `null` (except `reseller_id`, which needs no lookup and
  is always populated) — the webhook still dispatches with whatever it has, matching this function's
  existing `end_client_id` failure-handling precedent exactly.

## 9. Edge Cases

- **A session is created, then abandoned before ever reaching a terminal status** (e.g. `meeting_url`
  never connects, `bot_dispatch_failed`) — its `partner_session_trace_logs` row is created with
  identity fields but never finalized (`ended_at`/`duration_seconds`/`hume_config_id` stay null
  forever, since `clio/partner-session.ended` never fires for a non-terminal session). Still purged on
  schedule via the `created_at`-based cutoff (Section 6.7) — this is the exact scenario that basis was
  chosen to cover.
- **`reseller_unique_id` reused by the SAME reseller across two genuinely unrelated sessions, sent
  weeks apart** — still treated as a replay (the unique index has no time-based expiry); the second
  request returns the first session's (long-since-ended) response. This is the literal, intended
  behavior of a per-reseller-scoped idempotency key with no TTL — not a bug, and matches the CEO
  brief's own framing (no expiry was ever specified).
- **A `channel_partner` account's `reseller_id` requirement and `client_id` requirement are both
  mandatory on the same request, for unrelated reasons** — `reseller_id` identifies the reseller
  itself; `client_id` identifies which of the reseller's *own* downstream clients this session is for.
  No conflict; both checks run independently (AT-5).
- **Voice never connects for a session at all** (`hume_chat_id` never set) — `hume_config_id` may still
  be set (provisioning happens before connection, per `live-render.ts`'s existing flow) even if the
  session never actually uses voice. The trace log records whatever was actually provisioned,
  independent of whether it was ever used — an accurate record of Clio-side state, not of the
  reseller's meeting outcome.
- **A session's `partner_session_insights` row never gets created at all** (extraction never
  fires/succeeds) — `glitch_instances` never gets rows for that session either (unchanged, pre-existing
  behavior) — the 4 new trace columns on `glitch_instances` are moot for that session, not an error.
- **Mobile vs. desktop** — not applicable; no UI surface changes anywhere in this brief.

## 10. Out of Scope

- No new dashboard, reporting UI, or analytics screen — explicit CEO brief constraint ("at this point
  new dashboard not needed").
- No change to `client_id`'s existing behavior, validation, optionality, channel-partner scoping, or
  storage — verified unchanged at every touch point (AT-11).
- No partner-facing exposure of `glitch_instances`, its 4 new columns, or any glitch/error content —
  hard constraint carried forward unchanged from B2B-17 and reaffirmed directly by Arun in this brief.
- No enforcement mechanism for the "we recommend saving your IDs" documentation copy — copy-only, no
  validation, no required field on any partner-side system Clio doesn't control.
- No TTL or expiry on `reseller_unique_id`'s uniqueness — a per-reseller value is permanently unique
  once used (see Section 9).
- No change to `dispatchMeetingBot()`, meeting-bot vendor logic, or any billing/wallet-decrement logic
  — this brief only gates WHETHER dispatch happens (via the replay short-circuit), never how it happens.
- No retroactive backfill of `partner_session_trace_logs` for sessions created before this brief ships
  — the table starts populated from the first session created after deploy; historical sessions (there
  are none in real production, per the CEO brief's own verification) are not backfilled.
- No change to the 30-day `partner_session_insights`/`glitch_instances` purge jobs' own cutoff basis or
  redact-in-place behavior — this brief's 60-day full-delete purge is a new, separate job on a new,
  separate table.

## 11. Open Questions

None. Every item the CEO brief flagged (the 4 numbered Open Items plus the 7 numbered Questions for
BA) is resolved above with a concrete decision, exact code/schema, and reasoning:

- Open Item 1 (mismatch handling) → §6.5, reject 422 `invalid_reseller_id`.
- Open Item 2 (idempotent replay mechanics) → §6.4/§6.5, per-reseller partial unique index on
  `partner_sessions`, atomic-insert-conflict detection, original response returned, other fields
  ignored.
- Open Item 3 (account-kind scope) → §6.2, mandatory for every account_kind, confirmed as recommended.
- Open Item 4 (delete semantics) → §6.7, full row `DELETE`, confirmed as recommended.
- Question 1 (schema + relationship to `partner_sessions`) → §6.3, new standalone table, no
  wire-vs-DB split needed for `reseller_id` (no collision found).
- Question 2 (`hume_config_id` write timing) → §6.6 — **corrects a factual error in the CEO brief**:
  `hume_native_config_id` does not exist on `partner_sessions` today (the brief's citation was to the
  unrelated legacy `sessions` table); this spec adds a new column and a new best-effort write point.
- Question 3 (glitch-tracker mechanism) → §6.9, new columns on `partner_session_insights`, trigger
  function updated to copy them (and the pre-existing, never-wired `end_client_id` gap) into
  `glitch_instances`.
- Question 4 (migration number + RLS) → migration `099` (098 confirmed highest as of this writing, per
  §6.3/6.4/6.7/6.9's combined migration file), service-role-only RLS matching `glitch_issues`/
  `glitch_instances`' own policy pattern exactly.
- Question 5 (validation/error shape) → §6.5, full detail — missing vs. mismatched produce different,
  specific error codes.
- Question 6 (documentation copy) → §6.11, exact location and verbatim copy.
- Question 7 (test coverage) → Section 7, AT-1 through AT-20.

## 12. Dependencies

- **B2B-37 must already be live** (it is — confirmed by direct read of the current
  `inngest/partner-session-insights-extractor.ts` and `lib/partner/live-render.ts`, both already
  containing B2B-37's shipped code). `partnerSessionTraceLogFinalizer` (§6.7) depends entirely on the
  `clio/partner-session.ended` event B2B-37 made reliable — without it, this brief's finalization step
  would need to duplicate B2B-37's own emission fix from scratch.
- **B2B-34's `client_id`/`end_client_id` architecture** must remain exactly as-is — this brief reads
  and reuses `end_client_id` in three new places (trace log, webhook payload, glitch_instances) without
  modifying its source of truth (`partner_sessions.end_client_id`, set once at session creation,
  migration `095`).
- **Migration 099 must ship before any application code referencing its new columns/table/RPC** — the
  route, `live-render.ts`, `webhooks.ts`, and the new Inngest file will all error at runtime against
  the new columns/table until the migration is applied, exactly matching this repo's own standing
  caution about unapplied migrations (see B2B-32/B2B-33 Vendor-decision notes in
  `docs/b2b-pivot-status.md` for the general pattern of "code ships, migration must land first or it
  errors at runtime").
- **No dependency on any new vendor/library** — every change uses already-approved tooling (Supabase,
  Zod, Inngest) already in use identically elsewhere in this codebase.
