# 2026-08-03 — advance_tab A/B test + rate-limit/dead-air findings

Paused mid-investigation per Arun's direct instruction ("hold off on this one... document this... we'll come back to this once we complete the brainstorming of the other thing"). This file is the resume point.

## Background

Arun reported the OpenAI Realtime voice sessions (Clio, "Marin" voice) freeze mid-call — sometimes for 60-95+ seconds — and separately suspected the shared page might be visually advancing before a topic's summary has actually finished playing. He asked whether something outside the model (Attendee, OpenAI, or elsewhere in the code) is triggering `advance_tab`.

## What's confirmed so far

**1. `advance_tab` itself is clean.** Verified twice, independently (by me and by the CEO agent reading the code directly): it is only ever invoked from a real, model-generated `function_call` item in `lib/voice/openai-realtime-adapter.ts`'s `handleMessage()`. No reconnect/replay path, no external trigger.

**2. A second, independent page-advance mechanism exists and has no playback-completion gate.** `PartnerRenderClient.tsx` runs a transcript-phrase-match watcher (B2B-60: `STAGE_1_WRAP_UP_PHRASE` + next page's title match) that calls the same `advanceOnTransition()` the `advance_tab` tool uses — but unlike the tool-call path (which awaits `waitForPlaybackCaughtUp()` before moving the page), this "secondary" path fires the instant matching TEXT arrives, which for OpenAI happens as soon as generation finishes server-side, well before the corresponding audio has finished streaming/playing locally. A prior fix for exactly this (`NEXT_PUBLIC_OPENAI_TRANSCRIPT_GATE_MODE=playback_complete`) was found to be silently reverted to an empty string in production despite changelog claims it was live — **not yet re-applied** (a one-line env var change, not code — never actioned per "no code changes yet").

**3. Real, reproducible OpenAI rate-limiting is the dominant cause of the long freezes — confirmed, not the secondary mechanism.**
- Round 1 A/B test (commit `b3677ff`, live in production): disabled ONLY the secondary transcript-match mechanism (`SECONDARY_TRANSCRIPT_MATCH_ENABLED = false` in `PartnerRenderClient.tsx`), left `advance_tab` completely untouched.
- Test session `81d20143-63dd-4dc5-8103-5a2bd9cfd43b` (2026-08-03 13:29-13:36 UTC) still showed the same long-freeze pattern (biggest: 95.3s) — **disabling secondary did not fix it.**
- Both this session and the pre-round-1 baseline (`445fab61-442d-4261-8e40-88ffb04b692e`) show **6 identical `response.done: status:'failed', code:'rate_limit_exceeded'` events each**, at nearly identical usage levels: ~26k-31k of a 40,000 TPM cap, each turn requesting ~13-15k tokens. A single turn is roughly a third of the entire budget — this will recur on any session with a few back-to-back turns, not as a rare edge case.
- Confirmed (twice, independently): **zero retry/backoff logic exists anywhere in `lib/voice/openai-realtime-adapter.ts`** for a failed `response.done`. Nothing automatically retries; the only thing that can ever prompt a next attempt is the model's own next natural turn (which can also fail again) or the one-shot recovery nudge (which can also get rate-limited, as observed).

**4. A second, distinct, NOT-YET-EXPLAINED failure mode was found inside round 1's 95.3s freeze.** The rate-limited request actually retried and *succeeded* (`response.done: completed`) at the 24-second mark inside that window — but the connection then went **completely silent** (zero events of any kind, not even routine `rate_limits.updated` pings) for another **~71.5 seconds** before anything was actually spoken. `transcriptGateMode` is `'immediate'` in this build (the `playback_complete` config isn't set), so this isn't a local-playback artifact — it's dead air on the wire itself, after OpenAI had already confirmed the response was done. This is separate from the rate-limit story and has not been investigated yet.

## Current live state (as of this pause)

- Production is running commit `b3677ff`: `SECONDARY_TRANSCRIPT_MATCH_ENABLED = false` in `PartnerRenderClient.tsx` — the transcript-phrase-match transition watcher is OFF; `advance_tab` (the tool-call path) is the only thing that can move the page right now.
- `NEXT_PUBLIC_OPENAI_TRANSCRIPT_GATE_MODE` env var is still an empty string in production (the playback-completion-gate fix for the secondary mechanism is NOT live, regardless of round 1's flag).
- No retry/backoff for rate-limit failures has been added.
- The temporary debug route `app/api/debug/transcript-read/[clio_session_ref]/route.ts` is still live (used for tonight's investigations) — not yet removed.

## Planned next steps (when we resume)

1. **Round 2 of the A/B test** (re-enable secondary, disable `advance_tab` entirely) — CEO agent's assessment: this will NOT explain or fix the freeze/dead-air symptoms (both are upstream of which transition mechanism is active), but is still the right way to isolate the narrower "page advances before summary is fully heard" complaint specifically. Should be framed to Arun as testing *that* symptom only, not the freeze, so a repeat freeze during round 2 isn't misread as a failed experiment. Real risk to flag before running it: any page the secondary mechanism considers ineligible (generic/colliding title) has no fallback if `advance_tab` is also disabled — could hang indefinitely on such a page.
2. **Rate-limit fix** (deferred by Arun, but the CEO agent pushed back on continued deferral given it fired 6/6 times in two separate ~7-9 minute test calls): most likely fix is parsing the "please try again in X.XXXs" the error already provides and auto-retrying `response.create` after that delay, and/or requesting a higher TPM tier from OpenAI, and/or reducing the ~36K-character system prompt's token footprint.
3. **The new dead-air mystery** (71.5s of total silence after a successfully-completed response) — not yet investigated at all. Needs its own dedicated look before assuming the rate-limit story is complete.
4. **Env var fix** (`NEXT_PUBLIC_OPENAI_TRANSCRIPT_GATE_MODE=playback_complete`) — flagged, not yet applied.

No code changes were made beyond round 1's single flag flip, per Arun's explicit "no code changes yet" instruction throughout this investigation.
