# CEO Review — B2B-76: B2B-75 Reliability Follow-ups (post-live-test)

From: CEO Agent (on Arun's direct instruction, verbatim, relayed by the Orchestrator — 2026-08-08)
To: Dev/build agent
Priority: P0 (production data loss risk — real sessions are silently failing right now)
Parent spec: `docs/specs/B2B-75-requirement-document.md` v1.1 (approved, built, **live in production**)
Governance tier: **CEO-review only, no BA Requirement Document.** All four items are backend
reliability/API-integration work with zero product-shape, screen-content, or UX surface — no new
screens, no new copy, no change to what any screen shows or does. This is squarely CLAUDE.md's
"technical decisions: full autonomy" lane, not the "product decisions: BA must document" lane.
Documented here as the record of that call, per Arun's own framing of it as the CEO's call to make.

---

## 0. Ground truth, verified directly — correct the record before building anything

Before writing a single line, I re-verified the premise Arun's instruction and the Orchestrator's
briefing were built on, because two other agents in this session (`build-b2b75-elevenlabs`,
`ceo-elevenlabs-widget-build`) gave me **confidently wrong** status reports — one claimed B2B-75
"is NOT built, no code exists," the other claimed it's built but "NOT pushed, NOT deployed, migration
not applied, no API key entered, no live call attempted." Both are false. Verified directly:

- `git fetch origin main` + `git rev-list --left-right --count origin/main...main` → **`0 0`**.
  `origin/main` and local `main` are identical at `b990d82`. B2B-75 (`d70f8d5`, `15ea2f8`) plus its
  docs commit (`7dc2d8d`) and a temp debug route (`b990d82`) are **all pushed**.
- `system_voice_config` (live Supabase query): `widget_provider = 'elevenlabs'`, `active_provider =
  'openai_realtime'` (meeting-bot channel correctly untouched), `elevenlabs_agent_id` seeded,
  **`elevenlabs_api_key_ciphertext` is set**, `updated_at = 2026-08-08 04:56:13Z`. ElevenLabs is
  **live and selected** for the widget channel right now.
- Two real `partner_sessions` rows exist from tonight, both `test_mode=true`, `delivery_channel=
  'widget'`, `voice_provider='elevenlabs'`:
  - `24e253eb-37d1-4001-add1-2a3ccb2c52a1` — `status='completed'`, `ended_at` set,
    **`hume_chat_id` (repurposed field holding the provider conversation id) is NULL** — the
    connection never reached `onConnect`, matching the 502-auth-failure test call.
  - `20b25451-fa7c-42cf-9c5d-640922e986a6` — `status='widget_active'`, `ended_at=NULL` right now,
    `hume_chat_id='conv_6601kzfxdeemfgjs4hf88apkpn5d'` (a real ElevenLabs conversation id — the
    connection succeeded and Clio spoke), `updated_at=2026-08-08 05:27:01Z`.

**New finding neither the Orchestrator nor either peer agent had: item 2 is not a missing mechanism,
it is an existing mechanism that is silently failing on this exact row, right now.**
`inngest/partner-trial-cutoff.ts`'s `partnerTrialStuckSessionBackstopSweep` (cron `*/15 * * * *`,
`STUCK_SESSION_CEILING_MS = 60 * 60 * 1000`) already queries
`status IN ('requested','bot_active','widget_active') AND test_mode=true AND updated_at < now()-60min`
— B2B-70 added `'widget_active'` to this list specifically for "abandoned widget tab" recovery. Session
`20b25451` is `test_mode=true`, `status='widget_active'`, and its `updated_at` (05:27:01Z) is **~9
hours** before the time of this review (14:22Z) — nine 15-minute sweep cycles past the 60-minute
ceiling. It should have been force-completed hours ago. **It has not been.** This means either the
sweep isn't executing (cron/registration issue), or `runTrialCutoffSequence` is throwing for this row
and the sweep's own `catch` (which only increments a `failed` counter and logs, never alerts) is
swallowing it. Diagnose this as the first step of item 2 — do not assume it's a net-new mechanism to
build; it may be a live bug in an already-shipped one.

Reply from `elevenlabs-docs` on items 3/4 (already live-doc-verified this session, do not redo):

- **Item 3 — no verified ElevenLabs field exists for a settable call-duration cap**, on either the
  `conversation_config_override` surface or the `/v1/convai/conversation/token` query params. A
  `max_conversation_duration_message` override exists but only controls what the agent *says* when a
  duration limit is hit elsewhere — not the limit itself. A dashboard-level duration cap is plausible
  (third-party blog reference only, unconfirmed field name/location, not found on
  `elevenlabs.io/docs/agents-platform/customization/conversation-flow`). **Do not fabricate an
  override for a field that isn't confirmed to exist** — see §1.3 below for the build instruction this
  produces.
- **Item 4 — `GET https://api.elevenlabs.io/v1/convai/conversations/{conversation_id}`** confirmed,
  full response shape captured (see §1.4). Auth header inferred-by-pattern (`xi-api-key`, matching
  every sibling convai endpoint) but not page-verbatim for this specific endpoint. **Post-call
  availability delay could not be verified anywhere** — treat as "not guaranteed instant, poll with
  backoff," never assume a number.

---

## 1. The four items, scoped precisely

### 1.1 Item 1 — Silent extraction failure with zero record (P0)

**File:** `inngest/partner-session-insights-extractor.ts`. Confirmed live trap: the
`if (!session.hume_chat_id) throw ...` guard (around line 240) runs **before**
`runInsightsIdempotencyGuard()` (the call that creates the `partner_session_insights` tracking row).
A session that never reached `onConnect` — like `24e253eb` above, a real row sitting in production
right now with zero insights row and zero trace — throws before any row exists, and the Inngest
fast-path's catch calls `markInsightsExtractionFailed()`, which itself no-ops (`if (!current) return`)
when there's no row to mark. Net: total silence, nothing on any dashboard.

**Fix:** move (or duplicate) the idempotency-guard row-creation to run **before** the
`hume_chat_id` null check, so a session with no provider conversation id gets a real
`partner_session_insights` row in a `failed` state with a clear reason
(e.g. `'no_provider_session_id'`), not zero rows. This makes the failure visible on whatever surface
already reads `partner_session_insights.status` (check `app/(with-clerk)/dashboard/admin/**` and any
partner-facing insights UI before assuming none exists — do not build a new surface, only ensure the
existing one has something to show).

**Not B2B-75 territory.** B2B-75 §6.9 only widened the *routing* condition at (a different) line 265
(`voice_provider === 'openai_realtime'` → `|| 'elevenlabs'`), which is already shipped and correct.
This is a separate ordering bug that predates B2B-75 and affects every provider.

### 1.2 Item 2 — Abandoned widget sessions: fix the existing backstop, don't build a new one

Per §0 above: diagnose why `partnerTrialStuckSessionBackstopSweep` isn't recovering `20b25451`
first. Concretely:
1. Confirm the Inngest cron is actually registered and firing in production (check Inngest dashboard
   / `app/api/inngest/route.ts`'s function list — it must be exported there or the cron is dead on
   arrival, not just present in the file).
2. If it is firing, instrument or locally reproduce `runTrialCutoffSequence` against this session's
   real shape (`provider_bot_id=null`, `hume_chat_id` set to an ElevenLabs conversation id) to find
   what throws. Prime suspect: anything in the sequence that assumes a Hume-shaped `hume_chat_id`
   (e.g. calling Hume's own API with it) would throw immediately for an ElevenLabs session — this
   would be the exact same class of bug as item 1 and the B2B-75 §6.9 trap, just in a third location
   nobody has checked yet.
3. Fix whatever's found. Do not widen scope to live-mode (`test_mode=false`) sessions — that's the
   documented, deliberately-deferred `B2B-43-FF` backlog item, a different piece of work with its own
   `availableMinutes` recomputation requirement. Out of scope here unless you find it's a five-minute
   size-up of the exact same fix — if so, note it, don't silently expand scope.
4. Once the mechanism provably works, it also closes the gap the Orchestrator described (client-only
   `status='completed'` transition on tab close) — that's this same fix, not a second one. Do not
   build a second, parallel safety net.

### 1.3 Item 3 — Max call duration: build the real server-side mechanism, not a fabricated API field

Arun's ask ("pass a max call duration to the session so ElevenLabs ends the session") assumes a
vendor field that **`elevenlabs-docs` could not confirm exists** anywhere in the surfaces this build
can reach (overrides, token-mint params). Do not send an unconfirmed field name to `overrides` — per
B2B-75 §0.B, ElevenLabs throws on an override sent for a field whose Security-tab toggle isn't
enabled, so a guessed field is not a safe no-op, it's a session-killing guess.

**Build the closest real equivalent instead — a genuine server-side backstop, not a second
client-side timer:** an Inngest scheduled sweep (same shape as §1.2's fix) that finds
`partner_sessions` rows with `delivery_channel='widget'`, `status='widget_active'`, and
`updated_at`/`created_at` older than the session's own configured max-duration ceiling, and
force-completes them the same way. This is genuinely server-side (survives a killed tab or a dead
client timer, which the existing `maxDurationTimeoutRef` client-side nudge in `WidgetRenderClient.tsx`
cannot), and it does not depend on any unverified ElevenLabs surface. **State this substitution
explicitly in the commit message and in your report** — do not silently reinterpret Arun's ask; name
the vendor-field gap and the equivalent you built instead, so if he later finds a real dashboard
duration-cap field, that's an easy manual add on his side (§12.1-style manual step), not a rebuild.

Reuse whatever ceiling constant already exists for the widget's own max-duration nudge (check
`WidgetRenderClient.tsx`'s `MAX_CALL_DURATION_MS` / `MAX_CALL_DURATION_NUDGE_TEXT` for the current
value) so the server-side ceiling and the client-side nudge agree — don't introduce a second,
independent duration constant.

### 1.4 Item 4 — Native ElevenLabs post-call transcript fetch — a deliberate, disclosed reversal

B2B-75 §6.9 explicitly considered and rejected `GET /v1/convai/conversations/{conversation_id}` in
favour of the existing Redis live-capture path, for two stated reasons: the post-call availability
delay couldn't be verified, and live capture was already proven. Arun is now asking for it directly —
that's his call to make and it overrides the prior one, but per `ceo-elevenlabs-widget-build`'s
correct advice, build it as a **named reversal that carries the original risk forward**, not a fresh
requirement that loses the context.

**Confirmed shape** (elevenlabs-docs, `https://elevenlabs.io/docs/api-reference/conversations/get`):
`GET https://api.elevenlabs.io/v1/convai/conversations/{conversation_id}`, header `xi-api-key`
(inferred-by-pattern, not page-verbatim for this endpoint — treat as near-certain per every sibling
convai endpoint, but note the distinction in a comment). Response includes `transcript` (array of
`{ role: 'user'|'agent', time_in_call_secs, message, tool_calls?, tool_results?, feedback?,
agent_metadata? }`) plus `status`, `has_audio`, `analysis`, etc.

**Build as an addition to the extractor's ElevenLabs path, not a wholesale replacement of Redis
capture for the widget's live pill/diagnostics** (which still need live, in-call data — that's a
different consumer than the post-session insights extractor):
- In `inngest/partner-session-insights-extractor.ts`, for `voice_provider === 'elevenlabs'`, before
  falling back to (or instead of) the Redis-captured transcript, call the native API using the
  session's `hume_chat_id` (the ElevenLabs conversation id) via a new server-side-only token-style
  call (decrypt the stored key the same way `app/api/elevenlabs-token/route.ts` already does — do not
  add a new decryption path).
- Since the post-call delay is unverified, **do not block extraction on it indefinitely**. Use a
  short bounded retry (a small number of attempts with backoff, inside the Inngest step so its own
  retry semantics don't stack awkwardly on top) and if the native transcript still isn't ready,
  **fall back to the Redis-captured transcript** rather than fail extraction — this makes the change
  additive/safer than the current path, not a strict replacement that can newly fail where it
  previously succeeded.
- Log which source actually got used (`'elevenlabs_native'` vs `'redis_live_capture'`) in the
  diagnostic/insights record so the unverified-delay question gets answered empirically from real
  production runs instead of staying a guess forever.

---

## 2. Do-not-touch boundaries (identical to B2B-75, still binding)

`app/(with-clerk)/partner-render/**` (every file), `lib/voice/widget-prompt-rules.ts`,
`lib/voice/hume-adapter.ts`, `lib/voice/openai-realtime-adapter.ts`,
`lib/voice/openai-realtime-prompt-template.ts`, `lib/voice/openai-realtime-tools.ts`. The meeting-bot
channel must show zero diff. None of these four items have any legitimate reason to touch it — if a
change seems to require touching one of these files, stop and escalate rather than proceeding.

## 3. Build process

- Isolated git worktree off latest `main` (which already has all of B2B-75 — confirmed pushed, §0).
- Verify any further live ElevenLabs doc claims you need beyond what §0/§1.3/§1.4 already give you —
  do not guess API shapes. `elevenlabs-docs`' findings above are current as of this session; re-check
  only if you need something not already covered.
- Write/update tests for all four fixes (extend `tests/unit/`, `tests/integration/` as appropriate —
  follow B2B-75's own test files as the pattern).
- `npx vitest run --no-file-parallelism` — zero new failures (there is one known pre-existing,
  unrelated failure in `voice-gap-watchdog.test.ts` per B2B-75's own build report; do not treat that
  one as caused by this work, but do not introduce any new failures either).
- `npx tsc --noEmit` clean, `npm run build` clean.
- `git diff main --stat` and confirm zero lines touched in §2's do-not-touch list.
- Report back with: exact files changed, the item-2 root-cause diagnosis (this is the most likely
  place for a real surprise), the item-3 substitution stated plainly, and the item-4 source-used
  logging design — so the CEO agent can confirm before this goes back to the Orchestrator for merge/
  deploy verification and push.

No QA Gate 3 live-call verification is possible for items 3/4 without a real ElevenLabs session — the
existing two test-call rows in production (§0) can be used to validate items 1 and 2 directly against
real broken data once the fix lands (re-run extraction against `24e253eb`, confirm the backstop now
recovers `20b25451` or its status is understood). Items 3/4 need one more live test call to fully
confirm; note this plainly in the report rather than claiming a false PASS.
