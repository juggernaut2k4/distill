# Feature Brief: HUME-DURATION-BILLING-01 — Hume-Native Call Duration as Billing Source of Truth

From: CEO (Arun)
To: Business Analyst Agent
Priority: P0
Date: 2026-07-05

---

## What Arun Said

Today's investigation surfaced two related problems on the Hume-native voice path:

1. A real double-charge risk: a manual "End Session" call and an automatic timeout/watchdog
   can independently deduct billed minutes for the same session, because
   `app/api/sessions/[id]/end/route.ts` has no `status === 'completed'` guard before
   deducting — unlike `forceEndSession()` in `lib/session-billing.ts`, which already has
   this guard.
2. A measurement mismatch: Hume's own call log (`duration_seconds` from the `chat_ended`
   event / Chat History API) measures the full WebSocket connection lifetime (connect to
   disconnect). Our current billing measures a narrower window: `speak_verified`
   (confirmed working voice) to `disconnected`, per the AUTOGEN-01 Part D verified-minute
   billing design in `lib/session-billing.ts`.

Arun was told this tradeoff explicitly and made a decision: **for Hume-native sessions,
billing minutes should align exactly with Hume's own call log minutes going forward.**
He accepted, knowingly, that this means users will now also be billed for the
connection-setup window before Clio starts speaking — a deliberate change from today's
speak-verified-based model. This is confirmed direction, not open for re-litigation.

Scope is explicitly limited to Hume-native sessions. The older ElevenLabs/Custom-LLM path
keeps its existing speak-verified-based billing model unchanged, and gets its own
separate, simple fix for the same double-charge risk (the `status === 'completed'` guard
on the manual end route — no model change there).

## The Problem Being Solved

Two distinct but related risks on the path that deducts a user's paid minutes:

- **Structural double-charge risk**: two independent code paths (manual end, watchdog
  timeout) can each compute and write a deduction for the same session with no
  idempotency check gating the write.
- **Source-of-truth mismatch**: our internally-computed duration and Hume's own
  authoritative call log can disagree, which is both a trust/dispute problem (if a user or
  Arun ever compares our billed minutes against Hume's usage dashboard) and, longer-term,
  a reconciliation problem against what Hume actually bills us for compute.

Arun's decision resolves the source-of-truth question by making Hume's own record the
authority for Hume-native sessions. That also structurally shrinks the double-charge risk
(one authoritative read, fetched once, idempotently, beats two racing internal
calculations) — but the BA should still spec the guard as explicit defense-in-depth,
not rely on the redesign alone to close that gap.

## What Success Looks Like

- For every Hume-native session (`sessions.hume_native_enabled = true`), when the call
  ends — whether via manual "End Session" or via the automatic timeout/watchdog — the
  minutes billed are derived from Hume's own chat duration data, not from our
  `speak_verified` → `disconnected` audit-log calculation.
- If Hume's duration data is unavailable at the moment of billing (not yet ready, fetch
  fails, chat_id stale/expired) — the system falls back to today's existing
  `computeBilledMinutes()` audit-log calculation rather than blocking, retrying
  indefinitely, or silently skipping the deduction. Billing must always deduct
  *something* defensible; it must never silently skip a deduction because an external API
  call failed.
- Whichever code path performs the actual deduction (manual end, watchdog, or a unified
  successor to both) has a `status === 'completed'` idempotency guard before writing,
  mirroring the pattern `forceEndSession()` already uses — so even in a race, only one
  deduction is ever written per session.
- The ElevenLabs/Custom-LLM path is untouched in billing model — it keeps
  speak-verified-based billing — but receives the same idempotency guard on its manual
  end route as a separate, simple fix.
- Nothing here changes or depends on the already-shipped graceful-session-end nudge
  feature or the already-approved SESSION-DURATION-01 fix — those are separate,
  unrelated, already in-progress/shipped changes.

## Known Constraints (explicitly set by Arun / non-negotiable)

- Applies **only** to Hume-native sessions, gated on `sessions.hume_native_enabled`.
  Confirmed by Arun: "only new sessions is sufficient."
- Does **not** change the ElevenLabs/Custom-LLM path's billing model in any way. That path
  only gets the narrow `status === 'completed'` guard fix, independently.
- Must have a safe, non-blocking fallback to the existing `computeBilledMinutes()`
  calculation if Hume's duration data is unavailable for any reason. Billing must never
  fail to deduct minutes because of an external API dependency.
- Must never double-bill. The idempotency guard is required regardless of which
  mechanism (Hume-sourced or fallback) produces the final number.
- Reuse the existing fetch pattern in `lib/voice/hume-native/session-details.ts`
  (archive-first, live-fallback against Hume's Config/Chats APIs, with typed errors and
  non-fatal handling of secondary fetch failures) rather than building a new fetch
  mechanism from scratch. The BA and engineering should treat that file's approach as the
  template to adapt, not a system to duplicate.
- Does not touch the graceful-session-end nudge feature or SESSION-DURATION-01 — those
  are out of scope, already separately in progress or shipped.

## Questions for BA

1. **Mechanics of the Hume-duration fetch at bill-time.** Please evaluate and recommend
   between:
   (a) a synchronous call to Hume's Chat History API at call-end time to fetch
   `duration_seconds` before writing the deduction, vs.
   (b) fetching only chat *metadata* (not full transcript events) if that returns
   duration faster/cheaper — analogous to how `getHumeSessionDetails()` in
   `lib/voice/hume-native/session-details.ts` already separates the Config fetch (hard
   dependency) from the transcript fetch (soft dependency, non-fatal on failure). Confirm
   whether the Hume Chat History endpoint that returns `duration_seconds` requires
   pulling transcript events at all, or if there's a lighter metadata-only call.
2. **Timing/availability risk.** Hume's docs do not explicitly guarantee immediate
   availability of a just-ended chat's duration data. Define the retry/timeout policy at
   bill-time (e.g. how many attempts, what timeout, before falling back) — should this be
   a single attempt with a short timeout, or a small bounded retry? Define exactly what
   "fetch failed or unavailable" means operationally (HTTP status codes, timeout
   threshold) so engineering doesn't have to guess.
3. **Where the idempotency guard and the new fetch logic live.** Is this best
   implemented as a single new shared "finalize Hume-native session billing" function
   called by both the manual end route and the watchdog/timeout path (replacing the two
   separate deduction call sites), or should the guard + Hume-fetch be added to each
   existing call site independently? Recommend one, document the reasoning, and specify
   exact files/functions touched (`app/api/sessions/[id]/end/route.ts`,
   `lib/session-billing.ts`, the watchdog/timeout caller, and the ElevenLabs path's
   separate minimal fix).
4. **Fallback minute computation precision.** When falling back to
   `computeBilledMinutes()` (the existing `speak_verified` → `disconnected` calculation),
   is any flag/log needed to mark that a given session's billed minutes came from the
   fallback path rather than Hume's own record — for future reconciliation/audit
   purposes? Recommend yes/no and, if yes, the minimal field/log needed.
5. **Acceptance tests and edge cases.** Please write full acceptance criteria and edge
   cases covering at minimum: normal end with Hume data available; end with Hume data
   fetch failing/timing out (fallback path taken, deduction still happens exactly once);
   simulated race between manual end and watchdog timeout (only one deduction written);
   a Hume-native session that never reached `speak_verified` at all (zero-duration edge
   case interaction with the new model); ElevenLabs path regression check (its billing
   model must be provably unchanged, only the idempotency guard added).

All five questions must be answered and documented in the Requirement Document before
any code is written, per the standing CEO→BA→Developer governance model. Section 11
(Open Questions) must be empty before this proceeds to a developer agent.
