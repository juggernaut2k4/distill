# Live Transcript Capture for OpenAI Realtime Sessions (Redis) — Requirement Document
Version: 1.0
Status: DRAFT
Author: Business Analyst Agent
Date: 2026-08-01

---

## 0. Re-verification of the CEO Brief's Claims (done before writing anything below)

Per this project's standing rule that specs must be grounded in real code (see
`docs/specs/B2B-61-requirement-document.md` §0 for the pattern), every load-bearing claim in
`.claude/agents/clio/feature-briefs/B2B-63-openai-realtime-live-transcript-capture-redis.md` was
re-checked directly against source, not taken on faith:

- **`extractInsightsForPartnerSession()`'s honest-failure gate, confirmed by direct read**
  (`inngest/partner-session-insights-extractor.ts` lines 259–264): the `voice_provider ===
  'openai_realtime'` throw fires immediately after `runInsightsIdempotencyGuard()` resolves
  (`shortCircuit: false`) and *before* the `HUME_API_KEY` guard / `fetchAllTranscriptEvents()` call —
  confirmed, and confirmed the guard really does run first (so a real `partner_session_insights` row
  exists for the failure to record against). Matches the brief exactly.
- **`voice_provider` is captured once, at render time, not re-derived later — confirmed at both ends.**
  `supabase/migrations/106_voice_provider_per_session.sql` adds the nullable, checked column with the
  exact doc comment the brief quotes. `app/(with-clerk)/partner-render/[clio_session_ref]/page.tsx`
  lines 76–91 confirm the write: `getActiveVoiceProvider()` is called once, the result is written to
  `partner_sessions.voice_provider` via a best-effort update (`voiceProviderWriteError` is logged, not
  thrown — render proceeds regardless), *before* `resolveLiveSessionRender()` runs. Confirmed.
- **`clio_session_ref` really is `partner_sessions.id`, confirmed by direct read**, not assumed:
  `page.tsx` line 68 (`getPartnerSession(ref)`) resolves `session`, and every `<PartnerRenderClient>`
  call site (lines 104, 116) passes `clioSessionRef={session.id}`. The Redis key design below keys
  directly on this value with no second ID introduced, per the brief's explicit instruction.
- **`onMessage`'s real wiring, confirmed by direct read of `PartnerRenderClient.tsx`** — this is the
  one place the brief itself flagged as a corrected premise, so it was checked most carefully:
  - Lines 296–315: a local `const onMessage = isInline ? (text, source) => {...B2B-60 stage logic...}
    : () => {}` — confirmed template mode's `onMessage` really is a literal no-op today, exactly as
    the brief states.
  - Lines 317–337: `const sharedCallbacks = { onConnect, onDisconnect, onError, onModeChange, onMessage
    }` — confirmed this `onMessage` (the per-mode closure above) is assigned into `sharedCallbacks`
    **once**, and `sharedCallbacks` is spread into **both** the `OpenAIRealtimeAdapter.create(...)` call
    (line 382, via `...sharedCallbacks`) and the `HumeAdapter.create(...)` call (line 402, via
    `...sharedCallbacks`) — confirming the brief's finding #4: one shared callback object feeds both
    providers' adapters, so a hook added carelessly here would fire for Hume too.
  - Confirmed `PartnerRenderClientProps.voiceProvider: 'hume' | 'openai_realtime'` (lines 85–93, added
    by B2B-61 Part B) is **already available inside `connect()`** at the exact point `sharedCallbacks`
    is assembled (it's a component prop, in scope throughout the whole file) — meaning the provider gate
    the brief asks for (Open Question 4) requires **no new prop, no new server-side plumbing, no change
    to `page.tsx`** — it can be expressed as a single local `if (voiceProvider === 'openai_realtime')`
    check at the exact point `sharedCallbacks.onMessage` is assembled. This is a materially smaller
    change than the brief's own framing implied was needed, and is the core design decision below (§4).
  - Confirmed `lib/voice/adapter.ts`'s `VoiceSessionAdapter` interface (the shared contract both
    adapters implement) does **not** declare `onMessage` as an interface method at all — it's a
    per-adapter **config callback** (`OpenAIRealtimeAdapterConfig.onMessage`, mirrored in Hume's own
    config type), not part of the shared interface. This confirms the capture hook can be wired
    entirely inside `PartnerRenderClient.tsx`'s `connect()` function, touching neither adapter file nor
    the shared interface — the smallest possible blast radius.
- **`formatTranscriptLines()`'s exact shape, confirmed by direct read** (`inngest/hume-action-item-extractor.ts`
  lines 156–174): filters to `USER_MESSAGE` / `AGENT_MESSAGE` event types only, skips empty/whitespace
  text, and maps to lines of the literal form `"User: <text>"` / `"Clio: <text>"` — the exact string
  labels "User" and "Clio", not "AI" or "Assistant". The new OpenAI-side formatter below reproduces this
  exact labeling so the two providers' output is textually indistinguishable to the downstream Claude
  call.
- **No Redis/Upstash package exists anywhere in this codebase today, confirmed.** `package.json`
  `dependencies` (read in full) contains no `redis`, `ioredis`, or `@upstash/*` entry. `lib/partner/rate-limit.ts`
  lines 9–17 contain the exact standing comment the brief quotes, confirming this gap was already
  anticipated, not a surprise.
- **The session-chat-id route is the closest existing structural precedent for the new capture route,
  confirmed by direct read** (`app/api/partner/render/session-chat-id/route.ts`): public (no Clerk
  session, no partner API key — same trust boundary, per its own doc comment, as the meeting-bot's
  headless browser), Zod-validated body keyed on `clio_session_ref: z.string().uuid()`, always resolves
  successfully to the caller (`{ ok: true }` / `{ ok: false }`, `200` either way — this route "ALWAYS
  returns 200, never blocks or delays the connect flow"), failures logged via `console.warn` only. The
  new transcript-capture route mirrors this shape exactly (§6).
- **`lib/partner/report-client-error.ts`'s fire-and-forget pattern, confirmed by direct read**: the
  client-side call site uses `fetch(..., { keepalive: true }).catch(() => {})` — `keepalive: true` lets
  the browser complete the request even if the page is being torn down (tab close / navigation), which
  is directly relevant to this feature's crash-tolerance goal for the *last* captured turn before an
  abrupt end. The new capture call mirrors this exact `keepalive` usage (§6).
- **Migration numbering, confirmed:** `106_voice_provider_per_session.sql` is current highest
  (`supabase/migrations/`, sorted). **Not relevant to this document** — no Postgres schema change is
  needed anywhere in this build (§6, §12); flagged only so a developer doesn't go looking for one.
- **The 30-minute backstop sweep's real cadence and retry budget, confirmed** (`inngest/partner-session-insights-extractor.ts`
  lines 465, 511–516): `BACKSTOP_ELIGIBILITY_DELAY_MS = 30 * 60 * 1000`, cron `*/30 * * * *`, and a
  session stays eligible for retry while `extraction_status` is `'pending'` or `'failed'` with
  `attempt_count < 3`. This directly informs the Redis TTL backstop reasoning in §6/§11 Q3.
- **The brief's own cost math (`~40–80 small writes per call`) is internally consistent with a
  per-turn (not fixed-interval) write design, and inconsistent with a literal fixed 10–15s timer** — a
  20–45 minute call at a strict 10–15s cadence would produce roughly 100–270 writes, well above the
  brief's own stated 40–80 estimate. A per-turn design (one write per completed spoken turn — user or
  Clio) lines up with 40–80 far better, since a natural back-and-forth coaching conversation of that
  length realistically produces on that order of distinct turns. This is direct evidence supporting the
  per-turn resolution in §11 Q2, not just this document's own preference.

Nothing in the CEO brief was found to be inaccurate. One thing worth surfacing: the brief frames Open
Question 4 as requiring the BA to design "where exactly does the new capture tap get wired" as if it
might require new prop plumbing — re-verification found `voiceProvider` is already in scope at the
exact point needed, so the actual fix is smaller (a local conditional at one existing call site) than
the brief's framing implied. Noted as a simplification found during verification, not a correction of
anything wrong in the brief.

**Scope update received mid-spec, from Arun directly (relayed by the Orchestrator), not yet reflected
in the CEO brief above:** template-mode (Option 2, the `sections` prop path) sessions are being
paused/hidden as a product decision — "we are pausing our client building contents with templates so
you need to turn off and hide it. This feature is not needed until further informed." This is separate
from, and broader than, B2B-23's earlier decision to hide only the Configurator's authoring screens —
this pauses running template-mode sessions at all going forward. The actual pausing mechanism (reject
at session-creation? how in-flight/existing template-mode sessions behave? what a partner sees) is being
scoped as its own separate CEO brief, not this one, and is explicitly not this document's job to design.
This directly changes this document's own Open Question 4, though: with template-mode sessions being
paused as a product decision, this document scopes transcript capture to **inline mode only**, for now
— not because template mode is technically incapable of being captured (§0's own re-verification shows
the shared `sharedCallbacks.onMessage` tap point would work identically for either mode), but because
building and shipping capture wiring for a mode Arun has just said is being turned off would be dead
code the moment the pausing work lands, and this document should not silently reach further than the
product surface it's actually needed for right now. If/when template mode is reactivated, capture
wiring for it is a small, well-understood follow-up (widen one boolean condition, per §6/§11 Q4 below),
not a redesign — but it is deliberately not built in this pass. See §11 Q4 for the full resolution.

---

## 1. Purpose

Every OpenAI Realtime voice session run today produces zero transcript, zero action items, and zero
learner insight — permanently — because OpenAI's Realtime API has no endpoint to retrieve a past
session's conversation after the call ends. This is not a transient failure: `extractInsightsForPartnerSession()`
already detects this correctly (via `partner_sessions.voice_provider`, migration 106) and throws an
honest, explicit error instead of calling the wrong vendor's API — but "fails honestly" still means
every reseller who receives an OpenAI-provider session gets nothing where a Hume-provider session would
have delivered real action items and a real learner-insight summary via webhook.

This feature exists to close that gap by capturing the conversation *live*, client-side, during the
call — since there is no vendor-side alternative — and persisting it incrementally to Redis (not the
main Postgres database, not browser storage) so that a crash, dropped connection, or abrupt call end
loses at most the single conversational turn that was in flight at that moment, never the whole call.

What failure looks like without this: exactly today's status quo — every OpenAI-provider session's
reseller-facing insights pipeline silently produces nothing (well, honestly-failed nothing, which from
a reseller's point of view still means "nothing arrived"), for as long as OpenAI remains a
live, admin-selectable provider alongside Hume.

**Scope note (added mid-spec, §0):** this document captures transcripts for **inline-mode** OpenAI
sessions only. Template-mode sessions are being paused as a separate, in-progress product decision, so
building capture for a mode that's being turned off is not this document's job right now — see §0, §4,
and §11 Q4 for the full reasoning and the accepted consequence for any template-mode OpenAI session that
runs before that pause lands.

## 2. User Story

This is a backend/infrastructure feature with no direct human user interacting with it in the moment —
its "users" are the systems and people downstream of its output:

As the **insights-extraction pipeline** (`inngest/partner-session-insights-extractor.ts`),
I want a complete, ordered transcript of an OpenAI-provider session's conversation, even though OpenAI
itself cannot supply one after the fact,
So that I can run the exact same Claude extraction call I already run for Hume-provider sessions and
produce real action items and a real learner insight.

As a **reseller** receiving `partner_session_insights` webhook payloads,
I want OpenAI-provider sessions to deliver real action items and learner insights exactly as
Hume-provider sessions already do,
So that switching Clio's underlying voice provider (an internal, admin-only decision) never silently
degrades what I receive.

As **Arun (super-admin)**, in the event something looks off in a delivered insight,
I want the raw captured transcript to still be inspectable for a bounded window after the call,
So that I can manually verify what was actually said without needing OpenAI to expose one.

(No end-user-facing screen exists or is created by this feature — see §4.)

## 3. Trigger / Entry Point

- **Capture (write path).** Triggered automatically, with no user action, the moment
  `OpenAIRealtimeAdapter`'s `onMessage(text, source)` callback fires inside an active live session —
  i.e., every time OpenAI's Realtime API reports a completed spoken turn (`response.output_audio_transcript.done`
  for Clio's turns, `conversation.item.input_audio_transcription.completed` for the participant's
  turns). Required state: a live `/partner-render/[clio_session_ref]` session is connected, that
  session's resolved `voiceProvider` prop equals `'openai_realtime'` (never for `'hume'` sessions), **and**
  the session is running in **inline mode** (`inlinePages` prop / `isInline === true`) — template mode
  (`sections` prop) is explicitly excluded from capture in this build, per the scope note in §0 and the
  full reasoning in §11 Q4. No new route, no new page; this fires inside the existing `connect()`
  function in `PartnerRenderClient.tsx`.
- **Extraction (read path).** Triggered exactly as today: the fast-path `clio/partner-session.ended`
  event (emitted when a session ends), or the existing 30-minute backstop cron sweep
  (`partnerSessionInsightsBackstopSweep`) for anything the fast path missed or that failed and is still
  within its 3-attempt retry budget. No new trigger is introduced — only what
  `extractInsightsForPartnerSession()` does differently for `voice_provider === 'openai_realtime'`
  sessions changes (§6).

## 4. Screen / Flow Description

**No user-facing screen exists, and none is created by this feature** (explicitly out of scope — see
§10, and the CEO brief's own "Explicitly NOT this brief's job to invent" list). What follows is this
feature's equivalent of a screen/flow description: the exact sequence of system operations, since that
is what needs to be unambiguous for a feature with no UI.

**4.1 — Write path (during a live call, OpenAI-provider sessions only)**

1. A participant or Clio finishes speaking. OpenAI's Realtime API sends the corresponding "turn
   complete" event over the already-open WebSocket.
2. `OpenAIRealtimeAdapter.handleMessage()` (unchanged — no edits to this file) calls
   `this.config.onMessage(text, source)` exactly as it does today (`lib/voice/openai-realtime-adapter.ts`
   lines 388, 394).
3. Inside `PartnerRenderClient.tsx`'s `connect()`, at the point `sharedCallbacks` is assembled (today:
   lines 317–337), `onMessage` is changed from a direct reference to the per-mode closure into a small
   wrapper that does two things every time it's called:
   a. Calls the existing per-mode `onMessage` closure unchanged (the B2B-60 stage-transition logic for
      inline sessions, or the literal no-op for template sessions) — **byte-for-byte the same behavior
      as today, first, for both modes**.
   b. Then, **only if `isInline && voiceProvider === 'openai_realtime'`**, and only if `text` is
      non-empty after trimming, fires a new fire-and-forget capture call (mirroring `reportClientError`'s
      exact `fetch(..., { keepalive: true }).catch(() => {})` pattern — never awaited, never throws,
      never blocks anything):
      `POST /api/partner/render/transcript-capture` with body
      `{ clio_session_ref: clioSessionRef, source, text }`.
   This wrapper is the **single, provider-and-mode-gated tap point** that resolves Open Question 4: it
   wraps `sharedCallbacks.onMessage` (the one callback object spread into *both* adapters' `create(...)`
   calls), but the added `isInline` condition deliberately scopes capture to inline-mode sessions only
   for this build (§0's scope update, §11 Q4 has the full reasoning — this is a product-decision scope
   cut, not a technical limitation of the tap point itself, which would work identically for template
   mode). The existing `isInline ? ... : () => {}` branch inside the per-mode closure (step 3a) is
   completely untouched either way and keeps controlling only the B2B-60 page-transition behavior, not
   whether capture happens. Hume sessions, and any template-mode session regardless of provider, never
   reach step (b) at all — both conditions are evaluated fresh on every call (not cached), so neither can
   leak across sessions (a session's `voiceProvider` and `isInline` are both fixed for its lifetime
   anyway).
4. `POST /api/partner/render/transcript-capture` (new route, §6) Zod-validates the body, and — if valid
   — appends the turn to that session's Redis list and refreshes its TTL, then always returns `200`
   (mirrors the session-chat-id route's "always 200, never blocks" contract exactly). A Redis-layer
   failure here is logged server-side and swallowed; it never surfaces to the caller (§8, resolves Open
   Question 5).
5. This repeats for every completed turn until the call ends. No client-side buffering, no fixed-time
   flush timer, no batching window — **every completed turn is its own immediate write** (§11 Q2 has
   the full reasoning for why this, not a fixed-interval design, is the correct resolution).

**4.2 — Read path (extraction, after the call ends)**

1. `extractInsightsForPartnerSession(partnerSessionId)` runs exactly as it does today, through the
   existing idempotency guard (unchanged).
2. Where today's code throws unconditionally for `voice_provider === 'openai_realtime'`
   (`inngest/partner-session-insights-extractor.ts` lines 259–264), the new code branches instead:
   - `voice_provider === 'openai_realtime'` → read the session's Redis-held turns back in order, format
     them into the exact same `string[]` shape `formatTranscriptLines()` already produces for Hume
     (`"User: ..."` / `"Clio: ..."` lines) via a new sibling formatter, `formatOpenAITranscriptLines()`.
   - anything else (`null` or `'hume'`) → **completely unchanged**: `HUME_API_KEY` guard,
     `fetchAllTranscriptEvents()`, `formatTranscriptLines()`, exactly as today.
3. From this point on — the `messageLines.length === 0` empty-transcript branch, the Claude extraction
   call, the `partner_session_insights` write, `recordInsightsReadyEvent()` — **nothing changes for
   either provider**. This is the "minimal blast radius" design Open Question 6 asked for: the only new
   code is *how `messageLines` gets built* for OpenAI sessions, never what happens with it afterward.
4. After the terminal DB write succeeds (`extraction_status` becomes `'success'` or `'success_empty'`),
   and only for `voice_provider === 'openai_realtime'` sessions, the Redis key is deleted (best-effort —
   a delete failure is logged and ignored; the TTL backstop cleans it up regardless, §6/§11 Q3).
5. If extraction fails and is retried (by Inngest's own step retry, or later by the 30-minute backstop
   sweep), the Redis key is **not** deleted — a retry re-reads the identical data (Redis `LRANGE` is a
   non-destructive read), producing the same input to Claude on every attempt until one succeeds or the
   3-attempt budget is exhausted. On permanent failure (`attempt_count` reaches 3,
   `markInsightsExtractionFailed()` fires), the Redis key is deliberately **left in place**, relying
   solely on its TTL, so a human can still inspect the raw transcript while troubleshooting (§11 Q3).

**4.3 — What never changes**

- Hume-provider sessions: zero code path differences anywhere in this feature. The provider (and, for
  the write path, mode) gate in §4.1 step 3(b) and the `voice_provider` branch in §4.2 step 2 are the
  *only* two places this feature touches shared code, and both are conditional branches around net-new
  logic — the Hume branch of each is either untouched (§4.2) or simply never entered (§4.1).
- No dashboard, admin page, or any other UI shows a live or historical transcript. Nothing in this
  feature is visible to any human in real time.
- **Template-mode OpenAI-provider sessions get no transcript capture in this build (explicit, accepted
  consequence of the inline-only scope, §0/§11 Q4).** If any template-mode session still runs on the
  OpenAI provider before the separate template-mode-pausing work lands, its extraction will read back an
  empty Redis list (nothing was ever written for it) and resolve to `extraction_status: 'success_empty'`
  — identical in outward behavior to today's pre-B2B-63 state for that combination (no action items, no
  learner insight), not a regression, not a crash, and not the honest-throw error this feature otherwise
  eliminates for inline-mode OpenAI sessions. This is a known, accepted gap for a session type that is
  actively being paused as a product decision, not a silent one — see §9 and §11 Q4.

## 5. Visual Examples

Not applicable in the traditional wireframe sense — no screen exists (§4). In its place, the sequence
diagram below is this document's equivalent artifact, showing the full write-path → read-path lifecycle
for a single OpenAI-provider session:

```
LIVE CALL (OpenAI Realtime session, voiceProvider === 'openai_realtime', INLINE MODE)
──────────────────────────────────────────────────────────────────────
Clio speaks turn 1 ──▶ response.output_audio_transcript.done
                          │
                          ▼
              adapter.onMessage(text, 'ai')
                          │
                          ▼
     PartnerRenderClient wrapped onMessage:
       (a) existing per-mode onMessage(text, 'ai')        [unchanged, both modes]
       (b) if isInline && openai_realtime: fetch POST     [new, INLINE MODE ONLY —
             /api/partner/render/transcript-capture         see §0/§11 Q4 scope note;
             { clio_session_ref, source: 'ai', text }        template mode never reaches here]
                          │
                          ▼
        Zod validate ──▶ RPUSH voice-transcript:{ref}  ──▶ EXPIRE 86400s
             │ (fail: logged, swallowed — 200 either way)

  ... repeats once per completed turn, participant and Clio, for the
      whole call — no batching window, no timer ...

Call ends (normal end_session, crash, or dropped connection)
──────────────────────────────────────────────────────────────────────
  At most the ONE turn that was still being generated/transcribed at
  the moment of an abrupt end is lost. Every prior turn is already
  durably in Redis.

EXTRACTION (clio/partner-session.ended event, or 30-min backstop sweep)
──────────────────────────────────────────────────────────────────────
extractInsightsForPartnerSession(partnerSessionId)
   │
   ▼
idempotency guard (unchanged)
   │
   ▼
voice_provider === 'openai_realtime'?
   │                                   │
  YES                                  NO (null / 'hume')
   │                                   │
   ▼                                   ▼
LRANGE voice-transcript:{ref}     fetchAllTranscriptEvents(Hume API)
   │                                   │
   ▼                                   ▼
formatOpenAITranscriptLines()    formatTranscriptLines()
   │                                   │
   └──────────────┬────────────────────┘
                  ▼
       messageLines: string[]   (identical shape either way)
                  │
                  ▼
   [UNCHANGED FROM HERE for both providers]
   empty? → success_empty  :  Claude extraction call → success/success_empty
                  │
                  ▼
       partner_session_insights row updated, webhook fired
                  │
                  ▼
   openai_realtime AND terminal success?
       → DEL voice-transcript:{ref}   (best-effort)
   openai_realtime AND terminal failure (3rd attempt)?
       → key left in place, relies on 24h TTL
```

## 6. Data Requirements

### New vendor: Upstash Redis via the Vercel Marketplace integration

**Package:** `@upstash/redis` (official Upstash SDK; confirmed correct name — this is a genuine new
addition, no prior Redis/Upstash package exists in `package.json`, §0). Unlike `hume-adapter.ts` /
`openai-realtime-adapter.ts` (deliberately SDK-free, raw `WebSocket`, because a persistent low-level
realtime wire protocol has no meaningful typed-SDK abstraction this codebase needs), Redis here is
accessed purely over Upstash's REST API — ordinary request/response HTTPS calls, exactly the shape
CLAUDE.md's general "typed SDK client, never raw fetch to third-party endpoints" rule is written for.
There is no structural reason to break that rule here the way the voice adapters' own header comments
explain they deliberately do for WebSocket protocols — so `@upstash/redis` is used normally, not raw
`fetch`.

**Env vars** (add to `.env.local.example` with `PLACEHOLDER_` values, per CLAUDE.md's standing
convention):
```
UPSTASH_REDIS_REST_URL=PLACEHOLDER_UPSTASH_REDIS_REST_URL
UPSTASH_REDIS_REST_TOKEN=PLACEHOLDER_UPSTASH_REDIS_REST_TOKEN
```
These are the exact variable names `@upstash/redis`'s own `Redis.fromEnv()` helper expects, and the
names the Vercel Marketplace integration auto-populates into the linked project's environment once
provisioned.

**Mock-mode guard (missing/placeholder credentials):** mirrors this codebase's own existing convention
(e.g. `partner-session-insights-extractor.ts`'s `isPlaceholder` check around `ANTHROPIC_API_KEY`). If
`UPSTASH_REDIS_REST_URL`/`UPSTASH_REDIS_REST_TOKEN` are missing or start with `PLACEHOLDER_`:
appending a turn logs `[MOCK] would append transcript turn for session <ref>` and no-ops; reading turns
back returns `[]` (empty array) rather than throwing. This keeps local dev/CI green without real Upstash
credentials, consistent with every other mocked integration in this codebase, and means an
`openai_realtime` session extracted in a placeholder-credentialed environment degrades to
`success_empty` (the same well-defined branch already used for a genuinely empty Hume transcript) rather
than crashing.

### New file: `lib/voice/openai-realtime-transcript-store.ts`

```ts
import { Redis } from '@upstash/redis'

const TRANSCRIPT_TTL_SECONDS = 60 * 60 * 24 // 24 hours — see Requirement Doc §11 Q3 for reasoning

export interface StoredTranscriptTurn {
  source: 'user' | 'ai'
  text: string
  at: number // server-side Date.now() at capture time, ms epoch — diagnostic only, not used for ordering
}

function transcriptKey(clioSessionRef: string): string {
  return `voice-transcript:${clioSessionRef}`
}

const isPlaceholder =
  !process.env.UPSTASH_REDIS_REST_URL ||
  !process.env.UPSTASH_REDIS_REST_TOKEN ||
  process.env.UPSTASH_REDIS_REST_URL.startsWith('PLACEHOLDER') ||
  process.env.UPSTASH_REDIS_REST_TOKEN.startsWith('PLACEHOLDER')

const redis = isPlaceholder ? null : Redis.fromEnv()

/** Best-effort append — NEVER throws (Requirement Doc §11 Q5). Called from the
 *  transcript-capture API route, once per completed spoken turn. */
export async function appendTranscriptTurn(
  clioSessionRef: string,
  source: 'user' | 'ai',
  text: string
): Promise<void> {
  if (isPlaceholder || !redis) {
    console.log(`[MOCK openai-realtime-transcript-store] would append ${source} turn for session ${clioSessionRef}`)
    return
  }
  const turn: StoredTranscriptTurn = { source, text, at: Date.now() }
  try {
    const key = transcriptKey(clioSessionRef)
    await redis.pipeline().rpush(key, turn).expire(key, TRANSCRIPT_TTL_SECONDS).exec()
  } catch (err) {
    console.error(
      `[openai-realtime-transcript-store] Failed to append transcript turn for session ${clioSessionRef} (non-fatal):`,
      err instanceof Error ? err.message : err
    )
  }
}

/** Non-destructive read-back, in chronological order (list append order = spoken order).
 *  Returns [] if the key doesn't exist, credentials are placeholders, or the read fails —
 *  extraction's own empty-transcript branch (already exists for Hume) handles all three
 *  identically, so this function deliberately never throws for a missing/empty key. A genuine
 *  Redis-layer failure DOES throw, so Inngest's existing step-retry semantics apply exactly as
 *  they already do for a Hume API fetch failure — see Requirement Doc §8. */
export async function getStoredTranscriptTurns(clioSessionRef: string): Promise<StoredTranscriptTurn[]> {
  if (isPlaceholder || !redis) return []
  const raw = await redis.lrange<StoredTranscriptTurn>(transcriptKey(clioSessionRef), 0, -1)
  return raw ?? []
}

/** Best-effort delete after successful extraction — NEVER throws (Requirement Doc §11 Q3). */
export async function deleteStoredTranscript(clioSessionRef: string): Promise<void> {
  if (isPlaceholder || !redis) return
  try {
    await redis.del(transcriptKey(clioSessionRef))
  } catch (err) {
    console.error(
      `[openai-realtime-transcript-store] Failed to delete transcript for session ${clioSessionRef} (non-fatal, TTL will clean it up):`,
      err instanceof Error ? err.message : err
    )
  }
}

/** Mirrors formatTranscriptLines()'s exact speaker labels and blank-skip behavior
 *  (inngest/hume-action-item-extractor.ts lines 156-174), so downstream Claude-calling code
 *  (inngest/partner-session-insights-extractor.ts) sees byte-identical input shape regardless
 *  of which voice provider a session used. */
export function formatOpenAITranscriptLines(turns: StoredTranscriptTurn[]): string[] {
  const lines: string[] = []
  for (const turn of turns) {
    const text = turn.text?.trim()
    if (!text) continue
    const speaker = turn.source === 'user' ? 'User' : 'Clio'
    lines.push(`${speaker}: ${text}`)
  }
  return lines
}
```

**Why a single ordered list per session, not one key per turn** (resolves Open Question 1): a Redis
list (`RPUSH`/`LRANGE`) gives chronological ordering for free from append order — no secondary index or
sort step needed at read time. A single key per session also means a single `EXPIRE` covers the whole
session's data and a single `DEL` cleans it all up in one command. The alternative (one key per
turn/timestamp under a session prefix) would require either a sorted-set to reconstruct order, or a
`SCAN`/`KEYS` pattern match at read time — slower, and each command against Upstash's REST API is
individually billed, so N-keys-per-session is also the more expensive shape at scale. `@upstash/redis`
auto-serializes/deserializes JS objects passed to `rpush`/returned from `lrange` — the store above never
manually `JSON.stringify`/`JSON.parse`s a turn.

### Reads

- `getStoredTranscriptTurns(clioSessionRef)` — called only from
  `extractInsightsForPartnerSession()` (§6 changes below), never from anywhere in the live-call path.

### Writes

- `POST /api/partner/render/transcript-capture` (new route) — mirrors
  `app/api/partner/render/session-chat-id/route.ts`'s exact shape and trust boundary (§0): no Clerk
  session, no partner API key (same headless-meeting-bot-browser trust boundary), Zod-validated body,
  always returns `200`.

  ```ts
  import { NextRequest, NextResponse } from 'next/server'
  import { z } from 'zod'
  import { appendTranscriptTurn } from '@/lib/voice/openai-realtime-transcript-store'

  const CaptureSchema = z.object({
    clio_session_ref: z.string().uuid(),
    source: z.enum(['user', 'ai']),
    text: z.string().min(1).max(5000),
  })

  export async function POST(request: NextRequest) {
    const body = await request.json().catch(() => null)
    const parsed = CaptureSchema.safeParse(body)
    if (!parsed.success) {
      // Best-effort — never blocks the live call, mirrors session-chat-id's own contract exactly.
      return NextResponse.json({ ok: false }, { status: 200 })
    }

    await appendTranscriptTurn(parsed.data.clio_session_ref, parsed.data.source, parsed.data.text)
    return NextResponse.json({ ok: true })
  }
  ```
  `.max(5000)` on `text` is a defensive cap (a single spoken turn realistically runs a few hundred
  words/~2000 characters; 5000 is a generous ceiling against a malformed payload), mirroring this
  codebase's existing defensive-truncation convention (`markInsightsExtractionFailed()`'s
  `errorMessage.slice(0, 2000)`). No Postgres read or write happens anywhere in this route — deliberately,
  since constraint #1 (no added Postgres load) applies to the entire write path, not just a literal
  "no new table."

- **`PartnerRenderClient.tsx` change** (the only touch to this file): inside `connect()`, where
  `sharedCallbacks` is assembled (today's lines 317–337), `onMessage: onMessage` becomes:
  ```ts
  onMessage: (text: string, source: 'user' | 'ai') => {
    onMessage(text, source) // existing per-mode closure — byte-for-byte unchanged behavior, first, both modes
    // Inline-mode-only for this build (Requirement Doc §0/§11 Q4) — template mode is being paused as a
    // separate product decision; `isInline` is already computed above (`const isInline =
    // Array.isArray(inlinePages)`). Widening this to cover template mode later, if/when it's reactivated,
    // is a one-word change here (drop `isInline &&`) — no other part of this design needs to change.
    if (isInline && voiceProvider === 'openai_realtime' && text.trim()) {
      fetch('/api/partner/render/transcript-capture', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clio_session_ref: clioSessionRef, source, text }),
        keepalive: true,
      }).catch(() => {}) // best-effort — mirrors reportClientError's exact fire-and-forget pattern
    }
  },
  ```
  No new prop is added to `PartnerRenderClientProps` — `voiceProvider`, `isInline`, and `clioSessionRef`
  are all already in scope at this exact call site (§0). No change to either adapter file, no change to
  `lib/voice/adapter.ts`'s shared interface, no change to `page.tsx`.

### `inngest/partner-session-insights-extractor.ts` changes

Replace the unconditional throw (today's lines 259–264) with a provider branch that produces
`messageLines` either way, then leaves every line after that (today's lines 266–347) unchanged for both
providers:

```ts
import { getStoredTranscriptTurns, formatOpenAITranscriptLines, deleteStoredTranscript }
  from '@/lib/voice/openai-realtime-transcript-store'

// ... inside extractInsightsForPartnerSession(), replacing the current throw:

let messageLines: string[]
if (session.voice_provider === 'openai_realtime') {
  const turns = await getStoredTranscriptTurns(partnerSessionId) // partnerSessionId === clio_session_ref
  messageLines = formatOpenAITranscriptLines(turns)
} else {
  const apiKey = process.env.HUME_API_KEY
  if (!apiKey || apiKey.startsWith('PLACEHOLDER_')) throw new Error('HUME_API_KEY not configured')
  const transcriptEvents = await fetchAllTranscriptEvents(apiKey, session.hume_chat_id as string)
  messageLines = formatTranscriptLines(transcriptEvents)
}

// [UNCHANGED FROM HERE — the existing `if (messageLines.length === 0) {...} else {...}` branch,
//  the partner_session_insights update, and the recordInsightsReadyEvent() call are byte-identical
//  to today's code, for both providers.]
```

Then, immediately after the existing terminal-write success path (after today's `if (writeError) throw`
block, before the function returns), add:
```ts
if (session.voice_provider === 'openai_realtime') {
  await deleteStoredTranscript(partnerSessionId) // best-effort — never throws, see the store's own doc comment
}
```

`markInsightsExtractionFailed()` (the permanent-failure path) receives **no changes** — the Redis key
is deliberately left in place on permanent failure, relying only on its TTL (§11 Q3).

The existing `if (!session.hume_chat_id) throw` guard (today's line 228) is left **unchanged** and
applies to both providers exactly as it does today — a session whose `hume_chat_id` was never set
likely never actually connected (regardless of provider; the field is populated by the same
`onConnect`-triggered POST to `/api/partner/render/session-chat-id` for both adapters, an existing,
out-of-scope naming quirk), so there is nothing to extract from either.

## 7. Success Criteria (Acceptance Tests)

✓ Given an OpenAI-provider live session, when Clio or the participant completes a spoken turn, then a
`POST /api/partner/render/transcript-capture` request fires with that turn's `source` and `text`, and
the turn is appended to that session's Redis list (`voice-transcript:{clio_session_ref}`), preserving
chronological order across the whole call.

✓ Given a Hume-provider live session (either mode), when Clio or the participant completes a spoken
turn, then **no** `POST /api/partner/render/transcript-capture` request is ever made — the provider gate
at `sharedCallbacks.onMessage` prevents it entirely.

✓ Given a **template-mode** (`sections` prop) OpenAI-provider session, when Clio or the participant
completes a spoken turn, then **no** `POST /api/partner/render/transcript-capture` request is ever
made — the `isInline` condition in the same gate prevents it, per this build's explicit inline-only
scope (§0, §11 Q4). This is a deliberate scope cut, not a bug.

✓ Given an **inline-mode** (`inlinePages` prop) OpenAI-provider session, when Clio or the participant
completes a spoken turn, then a capture request **is** made, and the existing per-mode `onMessage`
behavior (B2B-60 stage transitions) fires unaffected, in the same call, before the capture check runs.

✓ Given an OpenAI-provider session ends abruptly (simulated: WebSocket closed mid-response, before
`response.output_audio_transcript.done` fires for the in-progress turn), when the session's Redis list
is read back, then every turn that had already completed before the abrupt end is present and in order,
and at most the one still-in-flight turn is missing.

✓ Given an OpenAI-provider session whose call produced zero completed turns (e.g. connected then
immediately disconnected), when `extractInsightsForPartnerSession()` runs, then `getStoredTranscriptTurns()`
returns `[]`, `messageLines.length === 0`, and the session resolves to `extraction_status: 'success_empty'`
— the same well-defined branch already used for a genuinely empty Hume transcript, not a thrown error.

✓ Given an OpenAI-provider session with a real captured transcript, when `extractInsightsForPartnerSession()`
runs, then it calls the same `callClaudeForPartnerInsightsExtraction()` function Hume-provider sessions
use, with `messageLines.join('\n')` built from the Redis-held turns, and produces a real
`partner_session_insights` row (action items, glitches, learner insight) and a `recordInsightsReadyEvent()`
call — end to end, indistinguishable in shape from a Hume-provider result.

✓ Given an OpenAI-provider session's extraction completes successfully (`'success'` or `'success_empty'`),
when the terminal DB write resolves, then the session's Redis transcript key is deleted.

✓ Given an OpenAI-provider session's extraction fails permanently (3rd attempt, `markInsightsExtractionFailed()`
fires), when that happens, then the session's Redis transcript key is **not** deleted and remains
readable until its 24-hour TTL expires.

✓ Given the `POST /api/partner/render/transcript-capture` route receives a Redis-layer failure while
attempting to append a turn, when that happens, then the route still returns `200`, the live call is
completely unaffected (no error surfaced to the browser, no retry attempted from the client), and the
failure is logged server-side.

✓ Given `UPSTASH_REDIS_REST_URL`/`UPSTASH_REDIS_REST_TOKEN` are placeholder values (a local/dev/CI
environment with no real Upstash credentials), when an OpenAI-provider session runs and is later
extracted, then capture no-ops with a `[MOCK]` log line, extraction reads back `[]`, and the session
resolves to `extraction_status: 'success_empty'` — no crash anywhere in either path.

✓ Given a Hume-provider session runs through this same build, when it is extracted, then its behavior
(API calls made, DB writes, webhook payload) is byte-for-byte identical to before this feature existed —
verified by the fact that the `voice_provider !== 'openai_realtime'` branch in
`extractInsightsForPartnerSession()` is unmodified code, not merely "should behave the same."

## 8. Error States

- **Redis write fails during a live call** (network blip, rate limit, transient Upstash outage): §11 Q5
  — silent drop-and-continue. `appendTranscriptTurn()` catches, logs via `console.error` (session ref
  and error message only — never full transcript text, consistent with this codebase's
  never-log-sensitive-content-in-errors posture, though transcript text isn't a "secret" in the
  `process.env` sense, keeping error logs terse is still the established convention here), and returns.
  The live call is completely unaffected — no retry, no user-visible indicator, no state change. This
  is consistent with the feature's own crash-tolerance framing: losing one turn to a transient write
  failure is the same class of acceptable loss as losing the last few seconds to an actual crash.
- **`POST /api/partner/render/transcript-capture` receives a malformed body** (missing/invalid field, or
  `text` exceeding 5000 chars): Zod validation fails, route returns `{ ok: false }` with **`200`**
  (mirrors `session-chat-id`'s exact contract — this route must never surface a failure state that could
  make a caller think it needs to retry or handle an error, since the caller's own `.catch(() => {})`
  ignores the response body entirely anyway).
- **Redis read fails during extraction** (genuine Upstash outage/error, not a missing key): `getStoredTranscriptTurns()`
  is deliberately allowed to throw here (unlike the write path) — this is a background Inngest job
  context, not a live call, so the existing step-retry semantics (`retries: 3` on
  `partnerSessionInsightsExtractor`, plus the 30-minute backstop sweep's own retry eligibility) are the
  correct handling, exactly mirroring how a `fetchAllTranscriptEvents()` failure already propagates as a
  throw for Hume sessions today. This is an intentional asymmetry from the write path's silent-drop
  behavior, not an inconsistency — write-time failures happen during an irreplaceable live moment (the
  turn is gone either way, whether we throw or not), while read-time failures happen in a retryable
  batch context where throwing is strictly better than silently producing an empty/wrong result.
- **`UPSTASH_REDIS_REST_URL`/`UPSTASH_REDIS_REST_TOKEN` missing or placeholder in production** (a
  misconfiguration, not a runtime failure): degrades to mock mode exactly as described in §6/§7 — every
  OpenAI-provider session in that environment would produce `success_empty` extractions, the same
  observable symptom as "the feature isn't capturing anything." This is a real operational risk if
  credentials are accidentally left unset in production, but it is the same risk class every other
  placeholder-guarded integration in this codebase already carries (e.g. `ANTHROPIC_API_KEY`) — not a
  new failure mode introduced by this feature, and not something this document invents new handling for.
- **Redis delete-after-success fails**: logged, ignored (§6). The 24-hour TTL is the actual cleanup
  mechanism in this case — the explicit delete is an optimization (frees the key immediately rather than
  waiting up to 24h), not a requirement for correctness.

## 9. Edge Cases

- **A single unusually long, uninterrupted turn (known, accepted limitation).** Per-turn capture (§11
  Q2) means the finest granularity available is "one completed spoken turn," not a fixed time slice —
  because `onMessage` (the only data tap this feature is scoped to use, §0) only fires once a turn is
  fully transcribed, not incrementally mid-turn. If a single turn (most likely Clio delivering an
  unusually long uninterrupted explanation) runs well past ~15 seconds without the participant
  interrupting, and the call crashes mid-turn, more than the "~10-15 seconds" figure in the CEO brief
  could be lost — bounded by that one turn's length, not by a fixed timer. This is called out
  explicitly, not silently accepted: adding true mid-turn granularity would require listening to
  OpenAI's `response.output_audio_transcript.delta` events inside `openai-realtime-adapter.ts` itself
  (a materially bigger change, touching the adapter's internal event handling rather than only its
  existing `onMessage` output) for a benefit that's marginal given this product's conversational,
  back-and-forth coaching format (evidenced by the existing two-stage wrap-up-phrase transition design,
  which already assumes short, segmented turns rather than long monologues) — not built here, but
  flagged as a known, reasoned trade-off rather than an oversight.
- **Concurrent sessions at scale.** Each session's Redis key is independently namespaced by
  `clio_session_ref` — no shared timer, no cross-session batching, so there is no "synchronized write
  burst" risk to jitter against in the first place (the CEO brief's own concern about jitter assumed a
  shared-cadence timer design, which this document does not adopt — see §11 Q2's full reasoning for why
  per-turn writes are already naturally staggered across sessions and need no jitter).
- **Within one session, are writes ever concurrent?** No — a single `OpenAIRealtimeAdapter` instance
  processes one WebSocket message at a time (JS single-threaded event loop), so `onMessage` calls for a
  given session are always sequential; there is no risk of two `appendTranscriptTurn()` calls for the
  same session racing each other.
- **A retried extraction re-reads the same Redis data.** `LRANGE` is non-destructive — a session whose
  first extraction attempt fails (e.g. Claude API error) and is retried by Inngest's own step retry, or
  later by the 30-minute backstop sweep, reads the identical ordered turn list on every attempt until
  either a terminal success (which deletes the key) or the 3-attempt budget is exhausted (which leaves
  it for the TTL) — no data loss or duplication across retries.
- **`test_mode` sessions.** Captured identically to any other OpenAI-provider session — `test_mode` only
  affects downstream webhook delivery semantics (`recordInsightsReadyEvent`'s `testMode` flag), never
  whether a session's transcript gets captured or extracted. No special-casing needed or added.
- **No Postgres schema change.** This feature introduces no new table, column, or migration — migration
  `106` remains the current highest (§0). A developer should not go looking for a `107_...` migration
  file for this feature.
- **Mobile / narrow viewport, cross-tab sync, etc.** Not applicable — this feature has no UI surface at
  all (§4), so the standing responsive-by-default policy in `CLAUDE.md` does not apply to anything this
  document specifies.
- **A session with `voice_provider === null` (every pre-existing session, or any Hume session run before
  migration 106).** Falls into the unchanged `else` branch in §6's extraction code exactly as `'hume'`
  does — `null` and `'hume'` are treated identically by the new branch condition
  (`session.voice_provider === 'openai_realtime'` is the only special case; everything else takes the
  existing Hume path), matching migration 106's own documented "NULL means hume" convention.
- **A template-mode OpenAI-provider session runs anyway (before the separate template-mode-pausing work
  lands, or if that pause is implemented in a way that still allows some in-flight/edge-case session
  through).** Its transcript is never captured (the `isInline` gate excludes it, §4.1/§6), so its
  extraction reads back an empty Redis list and resolves to `extraction_status: 'success_empty'` —
  exactly this feature's pre-existing behavior for that combination before B2B-63 shipped (previously an
  honest thrown error; now a quiet empty result, since the thrown-error branch this document replaces is
  gone for ALL `openai_realtime` sessions, not just inline ones — see the note directly below). This is
  an explicitly accepted trade-off given template mode is being paused as a product decision, not a gap
  this document tries to hide.
- **Consequence of removing the old unconditional throw:** before this feature, `extractInsightsForPartnerSession()`
  threw an *honest, explicit* error for every `openai_realtime` session, inline or template. After this
  feature, that throw is gone entirely (§6) — replaced by the Redis-read branch for *all*
  `openai_realtime` sessions, regardless of mode, because extraction cannot itself tell whether a
  session was inline or template (that distinction lives in `resolveLiveSessionRender()`'s return
  shape at render time, not in anything `partner_sessions` persists). A template-mode OpenAI session
  therefore silently degrades from "honest failure" to "quiet empty success" as a side effect of this
  build, rather than continuing to fail loudly. Flagged explicitly here as a real, considered
  consequence: acceptable given template mode is being paused anyway (an empty-but-successful result for
  a session type going away is a materially smaller concern than it would be if template mode were
  staying), but worth the Orchestrator/CEO knowing this is a behavior change for that combination, not
  just an absence of a new capability.

## 10. Out of Scope

- Any change to Hume's existing post-hoc transcript-fetch path, `fetchAllTranscriptEvents()`,
  `formatTranscriptLines()`, `hume-action-item-extractor.ts`, or the legacy (non-partner) sessions-table
  extraction pipeline — all untouched.
- Any UI, dashboard, or admin-visible surface showing a live or historical transcript, in progress or
  after the fact — not requested, not built.
- **Template-mode transcript capture.** Explicitly out of scope for this build, per Arun's direct
  instruction (relayed mid-spec) to pause template-mode sessions as a product decision — a separate CEO
  brief, not this one. Capture wiring is scoped to inline mode only (§0, §4, §6, §11 Q4). If/when
  template mode is reactivated, extending capture to it is a small, well-understood follow-up (drop the
  `isInline` condition in the gate, §6) — it is not automatically inherited from this document and must
  be revisited explicitly, including re-checking whether the narrow `success_empty`-vs-`failed`
  signal-quality trade-off noted in §9 still applies once template mode is live again.
- Mid-turn / sub-turn transcript granularity (streaming partial text via `response.output_audio_transcript.delta`)
  — explicitly not built; see §9's reasoned limitation.
- Any change to `lib/voice/adapter.ts`'s shared `VoiceSessionAdapter` interface, or to either adapter
  file's (`hume-adapter.ts`, `openai-realtime-adapter.ts`) internal event handling — the capture hook
  lives entirely inside `PartnerRenderClient.tsx` and a new API route/store module.
- A distributed rate limiter backed by this same Redis instance (mentioned as a possible future use of
  Upstash in `lib/partner/rate-limit.ts`'s own standing comment) — this document adds Upstash Redis to
  the approved vendor list for this feature's use only; using it for rate limiting is a separate,
  future decision, not implied or built here.
- Any retry/backoff logic for an individual failed capture write beyond "log and continue" (§8, §11 Q5)
  — a dropped turn during a live call is not retried.
- Renaming `partner_sessions.hume_chat_id` to a provider-neutral name, or any other cleanup of that
  existing naming quirk — out of scope, pre-existing, not touched.
- The 30-day `partner_session_insights` Postgres purge policy (`partnerSessionInsightsPurge`) — a
  separate, already-working mechanism for already-extracted summary data, not the raw ephemeral
  transcript this document's Redis TTL governs.

## 11. Open Questions

None. All six items the CEO brief flagged as requiring the BA's own concrete decision (not a
restatement of the brief's tentative defaults) have been resolved below, with reasoning:

1. **Redis data shape** — resolved: a single Redis **list** per session, key `voice-transcript:{clio_session_ref}`,
   each element `{ source, text, at }` appended via `RPUSH` (chronological order for free from append
   order), read back via `LRANGE 0 -1`, deleted via a single `DEL`. Rejected the per-turn-key
   alternative because it would need either a secondary sort/index structure or a `SCAN`/`KEYS` pattern
   match at read time, both slower and more expensive against Upstash's per-command REST billing than
   one list per session (§6 has the full reasoning).

2. **Batching trigger and exact numbers** — resolved: **per-turn, no fixed-interval timer, no jitter.**
   The CEO brief's own stated default ("roughly every 10-15 seconds or per turn, whichever comes
   first, with jitter") was explicitly checked against real call-length/turn-frequency assumptions per
   the brief's own instruction, not just restated — and found to not actually fit: a fixed-interval
   design large enough to matter (10-15s) over a realistic 20-45 minute call would produce roughly
   100-270 writes, well above the brief's own cost estimate of "~40-80 small writes per call" (§0). A
   pure per-turn design lines up with that 40-80 estimate far better, since a natural back-and-forth
   coaching conversation of that length realistically produces on that order of distinct spoken turns.
   Jitter becomes moot under this design because there is no shared timer across concurrent sessions to
   desynchronize in the first place — every write is already naturally staggered by real, independent
   speech timing per session (§9). The known trade-off (an unusually long single uninterrupted turn
   could lose more than ~10-15s if the call crashes mid-turn) is stated explicitly, not glossed over —
   §9's edge case.

3. **Retention/TTL** — resolved: **24 hours** (`TRANSCRIPT_TTL_SECONDS = 60 * 60 * 24`), refreshed
   (`EXPIRE`) on every append so it is always "24h from the most recent write," never expiring mid-call
   regardless of call length. Reasoning: the existing backstop sweep runs every 30 minutes with up to 3
   retry attempts, so a session stuck in `'pending'`/`'failed'` could realistically still be retried up
   to roughly 1.5-2 hours after it ended (3 sweep cycles plus Inngest's own step-retry backoff within
   each). 24 hours gives generous margin beyond that worst case, plus real-world time for a human (Arun,
   or whoever notices a `extraction_status: 'failed'` webhook) to actually go inspect the raw data before
   it's gone — directly matching the CEO brief's own "allow a human to manually check a session if
   something looks off" framing. Still deliberately far shorter than the existing 30-day Postgres purge
   window (`PURGE_WINDOW_DAYS`), which governs already-extracted, already-summarized data, not raw
   transcript — this raw data is more sensitive to over-retain, consistent with the brief's own "spirit
   of bounded retention" framing. Deleted proactively on successful extraction (§6); left for the TTL
   alone on permanent failure, by design (§4.2, §9).

4. **Provider gate placement, concretely** — resolved: a single `if (isInline && voiceProvider === 'openai_realtime')`
   check, added inside `PartnerRenderClient.tsx`'s `connect()` function, at the exact point
   `sharedCallbacks.onMessage` is assembled — wrapping (not replacing) the existing per-mode `onMessage`
   closure. Because `sharedCallbacks` is the single object spread into both `OpenAIRealtimeAdapter.create(...)`
   and `HumeAdapter.create(...)` (§0's re-verification confirmed this precisely), this wrapper's tap
   point *would* fire for every completed turn in **both** template and inline mode uniformly if left
   ungated by mode — resolving the technical half of the gap the CEO brief raised. However, a scope
   instruction arrived directly from Arun mid-spec (§0): template-mode sessions are being paused as a
   product decision (separate CEO brief, not this one). Rather than build and ship capture wiring for a
   session mode that is actively being turned off, this document narrows the gate to
   `isInline && voiceProvider === 'openai_realtime'` — capturing only inline-mode OpenAI sessions in this
   pass. This is a **product-scope decision layered on top of an already-solved technical design**, not
   an unresolved question: the shared-tap-point mechanism fully supports both modes (proven by §0's
   re-verification), so widening this later (dropping `isInline`) is a one-condition change, not new
   design work. A Hume session, or any template-mode session regardless of provider, never reaches the
   capture branch at all — all three governing values (`voiceProvider`, `isInline`) are fixed per session
   and checked fresh on every call. No new prop, no change to either adapter file, no change to the
   shared `VoiceSessionAdapter` interface — re-verification (§0) found `voiceProvider` and `isInline` were
   both already in scope at this exact point, making even the originally-anticipated "both modes" version
   of this change smaller than the brief's own framing implied, before the scope narrowed further to
   inline-only. The one accepted, explicitly-flagged consequence of this narrowing is documented in §9
   (template-mode OpenAI sessions degrade from an honest thrown error to a quiet `success_empty` result,
   since the extraction-side throw this document removes is not itself mode-aware) and is judged
   acceptable given the narrow, shrinking window before template mode is fully paused.

5. **Failure handling for capture writes themselves** — resolved: **silent drop-and-continue**, at both
   layers. Client-side, the `fetch(...).catch(() => {})` call never surfaces a failure to the live call
   in any way (mirrors `reportClientError`'s own established fire-and-forget pattern exactly, including
   its `keepalive: true` usage). Server-side, `appendTranscriptTurn()` never throws — a Redis-layer
   failure is caught, logged via `console.error` with the session ref and error message (never full
   transcript text), and the function simply returns. No retry is attempted at any layer. This is
   consistent with the "best-effort, log and continue" discipline this codebase already uses for
   `hume_chat_id` persistence (`app/api/partner/render/session-chat-id/route.ts`'s own doc comment:
   "Best-effort by design: this route ALWAYS returns 200, never blocks or delays the connect flow") and
   is the right call given constraint #3's own crash-tolerance framing: losing one turn to a transient
   write failure is the same class of acceptable loss as losing the last few seconds to an actual crash.

6. **What the extraction step's input looks like structurally** — resolved by reading `formatTranscriptLines()`'s
   actual shape first, per the brief's own instruction (§0 confirms it: filters to two event types,
   skips blank text, produces `"User: ..."` / `"Clio: ..."` lines). A new sibling function,
   `formatOpenAITranscriptLines()` (in the new `lib/voice/openai-realtime-transcript-store.ts`, not
   inside `hume-action-item-extractor.ts` — that file's own header comment scopes it to Hume-legacy
   logic only, and this document does not add unrelated formatting logic there), reproduces the exact
   same speaker labels and blank-skip behavior against the Redis-held turns, producing an identical
   `string[]` shape. `extractInsightsForPartnerSession()` branches only on *which function builds
   `messageLines`*; every line of code after that point (`messageLines.length === 0` check, the Claude
   call, the DB write, the webhook) is untouched, for both providers (§6).

Nothing in this document requires escalation to Arun beyond the CEO's own review/approval of this spec.

## 12. Dependencies

- **New package:** `@upstash/redis` — must be installed and added to `CLAUDE.md`'s approved-library
  list before/at build time. Per the CEO brief's own pre-clearing, this is a technical/infrastructure
  decision inside the Orchestrator's existing autonomy, not a BA/product decision — noted here as a
  build dependency, not left open in §11.
- **New env vars:** `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN` — must be added to
  `.env.local.example` with `PLACEHOLDER_` values (§6); real values require the Vercel Marketplace
  Upstash integration to actually be provisioned against this project (an infrastructure/account step
  the CEO brief already flagged as pre-cleared, escalating to Arun only if it turns out to require an
  action only he can take, e.g. billing consent in the Vercel dashboard).
- **`PartnerRenderClient.tsx`** — existing file, requires exactly one change: wrapping
  `sharedCallbacks.onMessage` as specified in §6. No other line in this file changes as part of this
  document.
- **`inngest/partner-session-insights-extractor.ts`** — existing file, requires the provider-branch
  change specified in §6 (replacing today's unconditional throw) plus the post-success delete call. No
  change to `runInsightsIdempotencyGuard()`, `markInsightsExtractionFailed()`,
  `callClaudeForPartnerInsightsExtraction()`, the Zod schemas, or either Inngest function's trigger
  configuration.
- **New file:** `lib/voice/openai-realtime-transcript-store.ts` (§6) — no existing file depends on this
  yet; it is created fresh by this build.
- **New file:** `app/api/partner/render/transcript-capture/route.ts` (§6) — no existing file depends on
  this yet.
- **Migration 106** (`voice_provider_per_session.sql`) — already applied (confirmed §0); this document's
  entire provider-branch design depends on `partner_sessions.voice_provider` already existing and being
  populated at render time, which it already is (shipped as part of B2B-61/this session's earlier work,
  not part of this document's own scope).
- **Not a dependency of this document, but worth noting:** `lib/partner/rate-limit.ts`'s own standing
  comment anticipates Upstash Redis as a future distributed-rate-limiter backend. This document does not
  wire that up — a future feature could reuse the same Redis instance/credentials this document
  provisions, but that is an explicit non-goal here (§10).
- **Related but explicitly non-blocking:** the separate, in-progress CEO brief pausing template-mode
  sessions entirely (§0's scope update). This document does not depend on that work landing first — it
  ships fully correct and complete on its own with the inline-only scope described throughout (§4, §6,
  §11 Q4). When that other brief lands, it may (or may not, depending on its own design) eliminate the
  narrow §9 edge case (template-mode OpenAI sessions resolving `success_empty` instead of `failed`)
  simply by making template-mode sessions impossible to create — no action from this document is needed
  either way, and this document should not be revised to anticipate that other brief's specifics.

## 13. Test Plan

- **Unit:**
  - `formatOpenAITranscriptLines()` — empty array input → `[]`; blank/whitespace-only `text` entries
    skipped; `source: 'user'` → `"User: ..."` prefix, `source: 'ai'` → `"Clio: ..."` prefix (matching
    `formatTranscriptLines()`'s exact labels); ordering preserved from input array order.
  - `appendTranscriptTurn()` — placeholder-credentials branch logs and no-ops without throwing; a
    thrown Redis-client error is caught and swallowed (function resolves, does not reject).
  - `getStoredTranscriptTurns()` — placeholder-credentials branch returns `[]`; a missing key (real
    credentials, key never written) returns `[]`; a genuine client-level exception is allowed to
    propagate (not caught) — verify this explicitly, since it's the one place this module intentionally
    does NOT swallow an error.
  - `deleteStoredTranscript()` — thrown error is caught and swallowed.
  - The `CaptureSchema` Zod schema — valid `{clio_session_ref, source, text}` accepted; missing field,
    invalid `source` value, non-UUID `clio_session_ref`, and `text` over 5000 chars all rejected.
  - The `PartnerRenderClient.tsx` `onMessage` wrapper — matrix of `{isInline, voiceProvider}`: only
    `isInline: true, voiceProvider: 'openai_realtime'` invokes the capture `fetch`, and only for
    non-blank text; the other three combinations (`isInline: false` + either provider, `isInline: true`
    + `'hume'`) never invoke it. Verify the existing per-mode `onMessage` closure is still called first,
    unconditionally, in all four combinations (this closure's own B2B-60 behavior is unit-tested
    elsewhere and must show zero regression here regardless of the new capture gate).

- **Integration:**
  - `POST /api/partner/render/transcript-capture` — valid body → `200 {ok:true}`, `appendTranscriptTurn`
    called with the exact parsed values; malformed body → `200 {ok:false}`, `appendTranscriptTurn` never
    called; a mocked Redis-layer failure inside `appendTranscriptTurn` → route still returns `200
    {ok:true}` (the route awaits `appendTranscriptTurn`, which itself never rejects — confirms the
    swallow happens at the store layer, not the route layer).
  - `extractInsightsForPartnerSession()` — mocked `voice_provider: 'openai_realtime'` session with mocked
    Redis turns → produces `messageLines` via `formatOpenAITranscriptLines`, never calls
    `fetchAllTranscriptEvents`/`HUME_API_KEY` at all; mocked `voice_provider: 'hume'` (and separately,
    `null`) → produces `messageLines` via the existing Hume path, never calls `getStoredTranscriptTurns`;
    mocked empty Redis turns for an `openai_realtime` session → `extraction_status: 'success_empty'`,
    no Claude call made (this same case covers the §9 template-mode-session consequence — extraction
    itself cannot distinguish "template mode, never captured" from "inline mode, genuinely empty call,"
    and this test documents that both resolve identically, on purpose); successful terminal write for an
    `openai_realtime` session → `deleteStoredTranscript` called exactly once; a failure path reaching
    `attempt_count >= 3` for an `openai_realtime` session → `deleteStoredTranscript` is **not** called.

- **E2E / live-call verification:** per this codebase's own standing pattern for voice features (LIVE-01,
  B2B-48, B2B-52, and this session's own B2B-61 Part A spike all required real live-call passes, not
  just mocked tests, before being trusted) — a genuine end-to-end Playwright/browser test of a live
  OpenAI Realtime WebSocket + real Upstash writes is not a practical automated test for this feature the
  way it wasn't for the adapter itself. Verification here means: a real OpenAI-provider partner session
  run end to end (real call, real Upstash instance), followed by manually inspecting the Upstash
  dashboard for the session's key mid-call (confirming incremental appends, not a single end-of-call
  write) and confirming a real `partner_session_insights` row with real (non-mock) action items/learner
  insight appears after the call ends — matching this document's own §7 acceptance criteria against a
  real system, not mocks. This is expected to be a same-or-next-day pass after code lands, consistent
  with the CEO brief's own timeline framing ("spec and build start tonight, live-verified test likely
  tomorrow").
