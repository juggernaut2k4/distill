# Explicit Tool-Call-Based End-of-Session Signal — Requirement Document
Version: 1.0
Status: APPROVED
Author: Business Analyst Agent
Date: 2026-07-08

## 1. Purpose

Today, whether a live Clio voice session has "ended" is decided almost entirely by
`WalkthroughClient.tsx` running `isFarewellMessage()` against Clio's own spoken transcript text —
matching a fixed phrase list (`FAREWELL_PHRASES`: `"goodbye"`, `"take care"`, `"we're done"`, `"all
done"`, `"great work today"`, `"well done today"`, etc.). These are ordinary things a coach might
say when wrapping up any single section, not only when the whole call is over. Arun and the team
independently identified this as fragile on its own merits (independent of the separately-fixed
`ONDEMAND-02` content-starvation bug), and Arun chose Option B: replace transcript phrase-matching
with an explicit, structured tool-call signal — the same pattern already used for `show_visual` and
`advance_tab` — as the authoritative "the session is over" signal.

Investigation (Section 3 below) found that a version of this tool **already exists**: `end_session`
is a live, working, authoritative custom tool in the *standard* production pipeline (ElevenLabs and
Hume-Custom-LLM sessions, driven by `lib/voice/live-conductor-bridge.ts` /
`lib/clio-context-builder.ts` / `lib/voice/relay-handler.ts`), and `WalkthroughClient.tsx` already
has working client-side handlers for it in **both** its Hume tools block (line 826) and its
ElevenLabs `clientTools` block (line 902). The one path where this mechanism is *not yet wired
end-to-end* is the newer, experimental **Hume-native** path (`NEXT_PUBLIC_HUME_NATIVE_ENABLED`):
its prompt (`lib/voice/hume-native/prompt-template.ts` rule 8) never instructs Clio to call
`end_session`, and Hume's own account does not yet have `end_session` registered as a tool
Hume-native's own LLM can invoke. That gap — not a from-scratch tool-call system — is what this
feature actually closes.

Failure mode without this fix: for Hume-native sessions specifically, "session over" continues to
be inferred only from transcript text and/or Hume's own internal end-of-conversation heuristics,
neither of which the app can distinguish from an ordinary WebSocket drop or reconnect (the same
ambiguity `LIVE-06` already had to handle for generic disconnects). The
`session-terminates-after-overview` incident report (`docs/action-items.json`) is direct evidence
this ambiguity is not hypothetical: investigators could not determine, after the fact, whether that
call ended via a `FAREWELL_PHRASES` match or via Hume's native hang-up — "either ends the call."
Sessions could keep ending on innocuous phrasing, and downstream bookkeeping (completion, billed
minutes, the post-call quality evaluator) would remain exposed to that same ambiguity indefinitely.

## 2. User Story

As an executive using Clio for a live Hume-native voice coaching session,
I want the session to end only when Clio has actually finished — after a recap and confirming I
have nothing further to ask — and never end just because I said an ordinary wrap-up-sounding phrase
mid-session,
So that my sessions never cut off prematurely and the platform's billing/completion records are
trustworthy.

(Single user-facing story. There is no new UI; the "user-facing" surface is entirely how and when
the call ends. A second, internal story: As the app's own bookkeeping, I want a structurally
unambiguous signal for "session over" so that completion, billed minutes, and the quality evaluator
never fire — or fail to fire — off a guess.)

## 3. Trigger / Entry Point

No new route, page, or button. This is a change to:
- **When** Clio decides the session is over (prompt behavior in
  `lib/voice/hume-native/prompt-template.ts`, rule 8, and the near-end wrap-up nudge text in
  `WalkthroughClient.tsx`'s `HUME_WRAPUP_NUDGE_TEXT`).
- **What tool she has available** to signal it (a Hume Tools API registration, described in Section
  12).
- **What the app treats as authoritative** when deciding the session has ended
  (`WalkthroughClient.tsx`'s farewell-detection call sites, demoted — see Section 6).

Activates only for live, in-progress Hume-native voice sessions (`NEXT_PUBLIC_VOICE_PROVIDER=hume`
AND `NEXT_PUBLIC_HUME_NATIVE_ENABLED=true`, i.e. sessions provisioned via
`provisionNativeConfig()`). See Section 4 (Scope Decision) for exactly which other paths are
touched and why.

## 4. Screen / Flow Description

There is no new visible screen. The "flow" is entirely voice-model behavior plus one internal
bookkeeping trigger. Described end to end for the Hume-native path:

**State 1 — Normal session in progress (unchanged).**
Clio teaches sections via `show_visual`/`advance_tab` exactly as today. Nothing in this feature
changes mid-session behavior.

**State 2 — Final section reached, closing sequence begins (rule 8, prompt-template.ts — changed).**
1. Clio delivers the Session Summary section's prepared content in full and asks its verification
   question (unchanged from today).
2. Clio summarizes what was covered today in exactly two sentences (unchanged from today).
3. **(New)** Clio asks one direct closing question confirming there is nothing further to discuss —
   e.g. "Is there anything else on your mind before we wrap up?" — and waits for a response.
4. If the participant raises something new: Clio addresses it naturally (answers briefly, or uses
   the existing deferral phrasing from rule 6 if it's complex/off-topic), then returns to step 3 and
   asks again. This repeats until the participant's response indicates nothing further (a "no",
   "that's all", "good", "I'm all set", etc.).
5. **(New)** Once the participant confirms there is nothing further, Clio says a clear, warm goodbye
   (e.g. "Take care, talk soon.") and, in that same turn, calls the `end_session` tool. She does not
   wait for the participant to speak again after the goodbye.

**State 3 — App receives the tool call (new, authoritative signal).**
1. Hume's native LLM emits a `tool_call` WebSocket message with `name: "end_session"` over the
   already-open connection (the exact mechanism already used for `show_visual`/`advance_tab` —
   `lib/voice/hume-adapter.ts`'s `handleMessage()` switch on `case 'tool_call'`, lines 201-221).
2. `WalkthroughClient.tsx`'s already-existing `tools.end_session` handler (line 826) fires: sets
   `sessionEndedRef.current = true`, calls `setSessionComplete(true)`, and calls
   `endCallOnServer(userId, auditTokenRef.current)` — unchanged code, now actually reachable for
   Hume-native sessions because the tool is now registered and instructed (see Section 12).
3. `endCallOnServer` POSTs to the existing, unmodified `/api/sessions/end-call`, which resolves the
   active session by `userId`, verifies the audit token, and calls the existing, unmodified
   `forceEndSession()` — deletes the Recall.ai bot, tears down `walkthrough_state`, computes billed
   minutes from the audit log, marks the session `completed`. This is the SAME teardown path already
   used by the wall-clock timer backstop and the voice-gap watchdog.

**State 4 — Demoted fallback (new gating, only reachable if the tool call above never arrives).**
1. If Clio is on the final section AND utters a phrase matching the existing `FAREWELL_PHRASES`
   list, a fallback timer arms (new: 8 seconds).
2. If the `end_session` tool call arrives before the timer elapses, the timer is cancelled — no
   duplicate teardown call.
3. If the timer elapses with no tool call having fired, the fallback runs the exact same teardown
   (`sessionEndedRef.current = true`, `setSessionComplete(true)`, `endCallOnServer(...)`) that the
   tool-call handler would have — this is a resilience net, not a second authoritative path.
4. Outside the final section, a `FAREWELL_PHRASES` match never arms anything — this is what closes
   the original false-positive gap (a phrase like "great work today" said while transitioning
   between two ordinary sections can no longer end the call).

**State 5 — Hard backstop (unchanged, pre-existing).**
`inngest/session-timer.ts`'s existing time-based `forceEndSession()` backstop remains completely
untouched and fires regardless of anything above, exactly as it does today.

## 4a. Scope Decision (resolved — not left open)

**This feature's actual code/prompt changes apply to the Hume-native path only.** The ElevenLabs
path and the Hume-Custom-LLM (`LIVE-01`) path are explicitly **out of scope** for the prompt/tool
changes, because investigation confirmed they already work correctly today:

- `lib/clio-context-builder.ts` (rule 10) and `lib/content/live-conductor-prompt.ts` already
  instruct Clio to call `end_session` as "the primary, authoritative signal" for both of those
  paths, routed through `/api/clio/chat/completions` (`lib/voice/relay-handler.ts`,
  `lib/voice/live-conductor-bridge.ts`).
- `WalkthroughClient.tsx`'s ElevenLabs `clientTools.end_session` handler (line 902) and the Hume
  `tools.end_session` handler (line 826, shared by Hume-Custom-LLM sessions too, since they use the
  same client code block) are already live and already fire correctly for these paths in
  production today.
- Arun's own Known Constraints explicitly protect this: "must not break the standard curriculum
  pipeline's already-working session flow."

**One change is applied uniformly across all providers, as a safety hardening, not a behavior
change:** the `FAREWELL_PHRASES` gating in Section 4/State 4 (final-section-only arming + grace
window + cancel-on-tool-call) is applied at both call sites in `WalkthroughClient.tsx` — the shared
Hume block (line ~729, covering both Hume-native and Hume-Custom-LLM) and the ElevenLabs block (line
~1156) — because it only ever narrows an existing, already-redundant fallback; it cannot change
behavior for a path where `end_session` already reliably fires today (Acceptance Criterion 9,
Section 7, exists specifically to prove this).

## 5. Visual Examples

No new visible UI. One audible-only "screen," extending the existing wireframe from the prior
`HUME-NATIVE-01` graceful-session-end spec:

```
┌───────────────────────────────────────────────────────────────────┐
│  (No visual change to any dashboard/walkthrough screen)            │
│                                                                     │
│  Before (today, Hume-native):                                      │
│  Clio: "...so those are the two things to remember. Take care,     │
│         talk soon."                                                │
│  [App marks session ended because "take care" matched              │
│   FAREWELL_PHRASES — regardless of whether the call was actually   │
│   over or Clio was just using that phrase mid-conversation]        │
│                                                                     │
│  After (this feature, Hume-native):                                │
│  Clio: "...so those are the two things to remember. Is there       │
│         anything else on your mind before we wrap up?"             │
│  Participant: "No, that covers it."                                │
│  Clio: "Great — take care, talk soon."                             │
│  [end_session tool call fires in the same turn — THIS is what      │
│   the app treats as authoritative, not the words themselves]       │
└───────────────────────────────────────────────────────────────────┘
```

## 6. Data Requirements

**Read from the database:** No new reads. Existing reads (`walkthrough_state`, `sessions`) are
unchanged.

**Written to the database:** No new columns, no migration. `forceEndSession()`
(`lib/session-billing.ts`) and everything it writes (session `completed` status, billed minutes,
`walkthrough_state` teardown) are unmodified — this feature only changes what *triggers* the
existing call, never what it does.

**Code changes required:**

1. **`lib/voice/hume-native/prompt-template.ts`** (rule 8, and only rule 8):
   - Insert the new "confirm nothing further" step (Section 4, State 2, steps 3-4) between the
     existing two-sentence-summary step and the goodbye step.
   - Replace "Ending the call is handled automatically the moment you say goodbye" with an explicit
     instruction to call the `end_session` tool immediately after the goodbye, in the same turn —
     stating plainly that `end_session` is the only way the call ends when Clio decides it's over.
   - Bump `PROMPT_TEMPLATE_VERSION` from `'v4'` to `'v5'` (per the file's own existing convention:
     "Bump `PROMPT_TEMPLATE_VERSION` on any structural edit to the fixed portion").
   - No other rule in this file changes (rules 1-7, 9-10 untouched, per Arun's Known Constraint).

2. **`lib/voice/hume-native/config-provisioner.ts`** — two small, targeted changes to the
   already-shipped dynamic reconstruction logic (no change to its overall approach or any other
   field):
   - `builtin_tools` reconstruction (current lines ~302-309): add a `.filter((tool) => tool.name !==
     'hang_up')` step so every Hume-native clone's `builtin_tools` array never includes `hang_up`,
     regardless of what the base config or the hardcoded fallback contains. **Rationale (Section
     11a):** if `hang_up` remains callable, Hume's own LLM retains an alternate, code-invisible way
     to end the call that reproduces the exact ambiguous-WebSocket-close problem this feature exists
     to eliminate — see Section 11a for the full distinguishability analysis.
   - `tools` fallback array (current lines ~293-296, only used if `baseConfig.tools` is ever
     malformed): add the newly-registered `end_session` tool's `{id, version}` once Section 12's
     one-time registration returns it, alongside the existing `advance_tab`/`show_visual` entries.
     This is a small, mechanical follow-up edit once the real id/version is known — not a design
     decision.
   - Every other field in this file (voice, language_model, event_messages, timeouts,
     turn_detection, interruption, nudges, webhooks, the `tools` *dynamic* reconstruction itself) is
     unchanged.

3. **`app/dashboard/walkthrough/WalkthroughClient.tsx`**:
   - `tools.end_session` (Hume block, line 826) and `clientTools.end_session` (ElevenLabs block,
     line 902): handler bodies are unchanged (they already do the correct thing). Both now also
     clear any pending farewell-fallback timer (new — see next bullet) as their first action.
   - `HUME_WRAPUP_NUDGE_TEXT` (line 61): update the injected near-max-duration nudge text to match
     the new rule 8 — add the "confirm nothing further" instruction and replace "Do not ask a
     further question" / implicit auto-hang-up wording with an explicit instruction to call
     `end_session` after the goodbye.
   - `isFarewellMessage()` call sites (Hume block ~line 729, ElevenLabs block ~line 1156): add the
     gating described in Section 4, State 4 — arm a new `setTimeout` (new ref,
     `farewellFallbackTimeoutRef`, 8000ms) only when `currentSectionIndexRef.current ===
     sectionsRef.current.length - 1` (the final/Summary section) and `!sessionEndedRef.current`;
     the timer's callback performs the existing teardown (`sessionEndedRef.current = true`,
     `setSessionComplete(true)`, `endCallOnServer(...)`) only if the session hasn't already ended by
     the time it fires. No change to `FAREWELL_PHRASES` itself (the phrase list stays as-is — the
     gating around it changes, not the list).
   - No changes to `show_visual`, `advance_tab`, silence-handling, reconnect logic, or any other
     handler.

4. **`app/api/sessions/end-call/route.ts`** — **no change.** It is already a generic, trigger-agnostic
   teardown endpoint (userId + token → `forceEndSession()`); it does not need to know or care
   whether it was invoked by a tool call or the fallback timer.

5. **`app/api/webhooks/hume/route.ts`** — **no change.** The `chat_ended` webhook remains a passive
   audit-log writer (`writeAuditEvent` with `end_reason`/`duration_seconds`/`config_id` as
   diagnostic metadata only). It is deliberately **not** made authoritative for bookkeeping: the
   client-driven `end_session` tool call already runs `forceEndSession()` synchronously and faster
   than waiting on Hume's webhook delivery, and introducing a second, webhook-driven trigger would
   create a race/duplicate-authority risk this feature exists to remove, not add. `end_reason`'s
   actual possible values for Hume-native sessions remain unverified and are not branched on by this
   feature — consistent with today's behavior.

**localStorage / sessionStorage:** none used by this feature.

## 7. Success Criteria (Acceptance Tests)

✓ Given a Hume-native session where Clio has delivered the Session Summary and asked "anything else
before we wrap up," when the participant responds with a no-further-questions answer, then Clio's
next turn contains a goodbye line immediately followed by an `end_session` tool call in that same
turn (verifiable via Hume `tool_call` event logs showing `name: "end_session"` arriving after that
user turn).

✓ Given the same scenario, when the participant instead raises a new question after "anything else
before we wrap up," then Clio does NOT call `end_session` in that turn — she addresses the question
(or defers it per rule 6) and asks the confirm-nothing-further question again, repeating until a
no-further response is received.

✓ Given Hume's `tool_call` message with `name: "end_session"` arrives over the WebSocket, when
`HumeAdapter.handleMessage()` processes it, then `WalkthroughClient.tsx`'s `tools.end_session`
handler fires, `sessionEndedRef.current` becomes `true`, `setSessionComplete(true)` runs, and
`endCallOnServer` POSTs to `/api/sessions/end-call` — independent of, and prior to, any WebSocket
close event.

✓ Given the Hume-native base config after the one-time setup in Section 12, when
`provisionNativeConfig()` clones it for a new session, then the clone's `tools` array includes
`end_session` and the clone's `builtin_tools` array does NOT include `hang_up`.

✓ Given a Hume-native WebSocket drop/reconnect unrelated to session completion (network blip,
Recall.ai bot reload) on any section other than the final section, then no farewell-fallback timer
is armed and no `forceEndSession` call results from that drop — existing reconnect logic proceeds
unaffected.

✓ Given Clio is on the final section, utters a phrase matching `FAREWELL_PHRASES`, and the
`end_session` tool call also arrives within 8 seconds, then the farewell-fallback timer is cancelled
and exactly one teardown call is made (via the tool call), not two.

✓ Given Clio is on the final section, utters a matching farewell phrase, but — due to an unforeseen
registration regression — never calls `end_session`, then after 8 seconds the fallback fires
exactly once, performing the same teardown the tool call would have.

✓ Given any section other than the final section, when Clio says a phrase matching
`FAREWELL_PHRASES` as ordinary wrap-up language for that section (e.g. "great work today" between
two sections), then this must NOT trigger session termination — this is the specific false-positive
this feature exists to close.

✓ Given the ElevenLabs voice provider or Hume-Custom-LLM mode, when a full session runs end-to-end,
then behavior is unchanged from today's production behavior — `end_session` continues to fire via
the existing Custom-LLM bridge exactly as it does now, and the `FAREWELL_PHRASES` gating change adds
only a dormant, never-previously-relevant condition (these paths' farewell-fallback timer would only
ever matter if their already-working `end_session` mechanism also broke, which is untested by this
feature and not required to be).

✓ Given the one-time Hume Tools API registration (Section 12) has not yet been performed, when a
Hume-native session reaches its natural end, then `end_session` is absent from the config's `tools`
array, Clio cannot call it, and the demoted `FAREWELL_PHRASES` fallback (final-section-gated, 8s
grace window) is the sole practical mechanism — the session still ends, just not via the
newly-preferred distinguishable path, and this is diagnosable via the existing `console.warn` log
already present at that fallback's call site.

## 8. Error States

- **`end_session` tool call arrives but the handler throws:** `HumeAdapter.handleMessage()`'s
  existing `try { result = await handler(params) } catch { result = 'Tool execution failed.' }`
  (hume-adapter.ts line 210) already catches this and sends a `tool_response` regardless — no
  change needed. If `endCallOnServer`'s own `fetch` fails, it already logs via `.catch()` and does
  not throw; the session-timer.ts hard backstop remains the safety net.
- **Hume account/base config does not yet have `end_session` registered (Section 12 not yet run):**
  covered by Acceptance Criterion 10 above — demoted fallback takes over, diagnosable via existing
  logging.
- **`config-provisioner.ts`'s `getExistingConfig()` fetch fails:** unchanged, existing behavior —
  throws and surfaces as a hard failure to the provisioning route, per its existing documented
  error-handling policy. Not affected by this feature.
- **Farewell-fallback timer fires but `endCallOnServer` has no audit token yet:** unchanged existing
  guard (`if (!token) { console.warn(...); return }`) already handles this — the wall-clock backstop
  remains the ultimate safety net.
- **Participant never gives a clear "no further" response (keeps raising new items indefinitely):**
  no additional cap is added by this feature — the existing, unmodified `session-timer.ts`
  time-based backstop already bounds total session length regardless of how long the
  confirm-nothing-further loop runs.
- **Reconnect happens mid-closing-sequence (after "anything else" was asked, before the answer is
  heard):** existing reconnect handling in `HumeAdapter`/`WalkthroughClient.tsx` is unmodified;
  Clio's native LLM re-establishes context per its existing reconnect-context injection and would
  naturally re-ask or continue based on the resumed conversation state — no new code path is
  required since this feature does not touch reconnect logic at all.

## 9. Edge Cases

- **Very short Hume-native sessions (`durationMins <= 2`):** unaffected — this feature does not
  touch `inngest/session-timer.ts`'s existing short-session guard for the wrap-up nudge lead time;
  only the nudge's *text* changes (Section 6, item 3), not its timing.
- **Participant answers "anything else?" ambiguously (e.g. a topic-adjacent remark rather than a
  clear yes/no):** handled the same way any other participant utterance is — Clio uses judgment
  (existing behavioral latitude in the prompt, e.g. rule 4/6's "respond naturally, adapt"); this is
  not a new mechanism this feature must specify beyond the explicit sequencing already required.
- **Farewell phrase said on the final section, immediately followed by the participant speaking
  again before the 8s fallback timer or the tool call resolves:** the fallback timer is purely a
  server/bookkeeping trigger, not a UI block — the live conversation continues unaffected either
  way; if `end_session` never arrives because the conversation genuinely continues (Clio was not
  actually done), the timer will still fire at 8s per today's design. This mirrors an accepted,
  pre-existing tradeoff (the original `FAREWELL_PHRASES` mechanism had the same “once matched, it's
  final” property, just without any gating) — not a new regression, and only reachable at all on
  the final section.
- **Hume-Custom-LLM (non-native) sessions:** share the same `WalkthroughClient.tsx` Hume code block
  and therefore the same farewell-gating change, but `end_session` is already reliably firing for
  them today (Section 4a) — the gating is inert/never-exercised insurance for this path.
- **`sectionsRef.current` is empty or not yet loaded when a farewell phrase is uttered (e.g. very
  early in a session, before section data has loaded):** `sectionsRef.current.length - 1` would be
  `-1`, which `currentSectionIndexRef.current` (always `>= 0`) can never equal — the gate simply
  never arms in this state, which is the safe default (matches the "never on early/mid-session
  phrases" intent).
- **Mobile vs. desktop:** not applicable — this is a voice/server-orchestration feature with no
  rendered layout differences.

## 10. Out of Scope

- Any change to `lib/clio-context-builder.ts`, `lib/content/live-conductor-prompt.ts`,
  `lib/voice/live-conductor-bridge.ts`, or `lib/voice/relay-handler.ts` — the ElevenLabs and
  Hume-Custom-LLM `end_session` mechanism is already correct and is not touched (Section 4a).
- Any change to `inngest/session-timer.ts`'s timing/sleep durations, the
  `hume_wrapup_nudge_pending` flag plumbing, or the `GET`/`PATCH /api/walkthrough-state/[userId]`
  routes — the delivery mechanism for the near-end nudge (shipped under the prior
  `HUME-NATIVE-01` graceful-session-end feature) is unchanged; only the nudge's text content
  changes.
- Any change to `lib/session-billing.ts` (`forceEndSession`, `computeBilledMinutes`,
  `verifyAuditToken`) — fully untouched.
- Any change to `app/api/webhooks/hume/route.ts` beyond documenting that it remains
  non-authoritative (Section 6, item 5) — no code edit there.
- Removing or renaming `FAREWELL_PHRASES` itself, or changing which phrases it contains — only the
  gating around when it's allowed to act changes.
- Enabling Hume's `timeouts.max_duration` config field — Arun already decided against this in the
  prior `HUME-NATIVE-01` graceful-session-end spec; this feature does not revisit that decision.
- Any change to `show_visual`, `advance_tab`, `defer_question`, silence-handling, or reconnect
  logic in `WalkthroughClient.tsx` beyond the two farewell-gating call sites and the `end_session`
  handlers' new timer-clearing line.
- Building any new admin/ops UI to observe which mechanism ended a given session — this feature
  relies on existing `console.warn`/log-based diagnosability (Acceptance Criterion 10), not a new
  dashboard.

## 11. Open Questions

None. Every question posed in the Feature Brief is resolved below, with the evidence behind each
resolution.

**Q1/Q3 — (A) `hang_up` vs (B) custom `end_session`, resolved decisively for (B).**
See Section 11a for the full distinguishability analysis. Summary: `end_session` is not a new
concept in this codebase — it is already a live, working custom tool for the standard pipeline, and
`WalkthroughClient.tsx` already has a correctly-implemented client handler for it in the Hume block
(line 826), verified to work through `HumeAdapter`'s generic, already-shipped `tool_call` →
`tool_response` handling (`lib/voice/hume-adapter.ts` lines 201-221) — a structurally distinguishable,
named event, decoupled entirely from `ws.onclose`. By contrast, `hang_up` is a Hume *builtin* tool
with **no client-side handler anywhere in this codebase** — when invoked, Hume simply closes the
WebSocket, which lands in `HumeAdapter`'s generic `onclose` handler (lines 110-135), the exact same
code path as an ordinary network drop, auth error, or reconnect-exhaustion. Nothing in
`event.code`/`event.reason` is read or branched on to distinguish a deliberate hang-up from any other
close reason. The `session-terminates-after-overview` action item is direct, real-world confirmation
of this ambiguity: investigators reviewing that exact incident's logs could not determine whether the
call ended via `FAREWELL_PHRASES` or via Hume's native hang-up — "either ends the call." Per the
Feature Brief's own deciding test, (A) does not meet the bar and is not recommended.

**Q2 — Exact one-time setup step for (B), and whether Arun must do anything.**
Resolved in Section 12. Yes, one concrete manual/setup action is required — see Section 12 for the
exact mechanism and what specifically needs a real (non-placeholder) credential.

**Q4 — Scope: Hume-native only, or also ElevenLabs?**
Resolved in Section 4a: prompt/tool changes are Hume-native only; the `FAREWELL_PHRASES` gating
hardening is applied everywhere as a no-behavior-change safety net, justified in Section 4a and
proven inert-for-working-paths by Acceptance Criterion 9.

**Q5 — Fate of `FAREWELL_PHRASES`/`isFarewellMessage`.**
Resolved: kept, demoted to a non-authoritative, gated fallback (Section 4, State 4; Section 6, item
3). Not removed, because it remains cheap insurance against a future regression of the exact kind
already seen once (`third-capability-missing` — a registered Hume tool silently failing to carry
into clones). The false-positive risk that motivated demoting it is closed by two independent
changes: (1) it can only arm on the final/Summary section, never during an ordinary mid-session
section transition — the exact scenario Arun described as the risk; (2) it never preempts a real
`end_session` tool call (grace window + cancellation), so on the (now-common) path where the tool
call arrives, the phrase match never has any effect at all.

**Q6 — Required sequencing (recap → confirm nothing further → tool call) as an explicit, testable
criterion, and the exact prompt change.**
Resolved: Section 4, State 2 (steps 1-5) and Section 6, item 1 specify the exact rule 8 rewrite;
Section 7's first two acceptance criteria make the sequencing explicitly testable (both the
happy-path ordering and the case where the participant raises something new and closing must not
proceed).

## 11a. Distinguishability Analysis — (A) `hang_up` vs (B) `end_session` (supporting detail for Q1/Q3)

| | (A) `hang_up` (Hume builtin tool) | (B) `end_session` (custom tool) |
|---|---|---|
| Already provisioned? | Yes — `builtin_tools: [{name:'hang_up'}]`, carried by both the dynamic reconstruction and the hardcoded fallback in `config-provisioner.ts`. | Not yet on the Hume-native base config's `tools` array (confirmed absent — the base config's three known custom tools are `advance_tab`, `show_visual`, and one more, id `6fc0bfde-...`, believed `defer_question`; no fourth tool exists yet). Requires the one-time setup in Section 12. |
| Client-side handler exists? | **No.** Grep of `lib/voice/hume-adapter.ts` and `WalkthroughClient.tsx` shows no handler keyed on `hang_up` anywhere. | **Yes**, already implemented at `WalkthroughClient.tsx` line 826 (`tools.end_session`), using the exact same `tools:` object mechanism as `show_visual`/`advance_tab`. |
| Fires via which code path? | `HumeAdapter`'s generic `ws.onclose` handler (lines 110-135) — the same path used for network drops, auth failures (code 1008), and reconnect exhaustion. No `event.code`/`event.reason` branching exists to identify hang-up specifically. | `HumeAdapter`'s generic `case 'tool_call'` handler (lines 201-221) — a named, structured message received *before* any close, looked up by tool name and given an explicit `tool_response`. |
| Chat-ended webhook help? | No. `app/api/webhooks/hume/route.ts`'s `chat_ended` handler captures `end_reason` into audit metadata only — it is never read or branched on anywhere in this codebase, and no live delivery has confirmed what value it carries for a hang-up-triggered end vs. an ordinary drop. | Not needed — the tool-call event itself, arriving over the live, still-open WebSocket, is the signal; no reliance on webhook delivery timing or payload content at all. |
| Real-world evidence of ambiguity | `docs/action-items.json` id `session-terminates-after-overview`: investigators could not determine after the fact whether that call ended via phrase-match or hang_up. | `docs/action-items.json` id `graceful-ending-wrapup`/`third-capability-missing`: `end_session`-style custom tools are the established, already-relied-upon pattern for `advance_tab`/`show_visual` in this exact codebase, with a known, understood (and already-fixed) failure mode (silently dropped from clones) — a known risk class, not an unknown one. |

**Conclusion:** (A) cannot be confirmed distinguishable from an ordinary drop anywhere in this
codebase's actual code, and the one real incident that could have tested it left investigators
unable to tell. (B) is not only distinguishable, it is already built, tested-by-production-use (for
the other two voice paths), and requires no new client code — only an account-side registration.
Recommendation: **(B)**, unambiguously.

## 12. Dependencies

- **One-time Hume Tools API registration (new dependency, required before this feature functions
  for Hume-native sessions).** Two one-time API calls, both authenticated with `HUME_API_KEY` (the
  exact same credential and header — `X-Hume-Api-Key` — already used throughout
  `config-provisioner.ts`):
  1. **Create the tool:** `POST https://api.hume.ai/v0/evi/tools` with a body defining
     `name: "end_session"`, a `parameters` JSON Schema of `{"type":"object","properties":{}}` (no
     arguments — matching the existing handler's signature, `async () => {...}`, in both the Hume
     and ElevenLabs blocks), and a `description` mirroring the already-approved wording used for this
     exact tool name in `lib/voice/live-conductor-bridge.ts` ("End the coaching session now... This
     is the primary, authoritative signal that the session is over; call it explicitly rather than
     relying on your spoken words alone."). This returns a new `{id, version}`.
     *(Note: Hume's Tools-API create-tool request/response field names are taken from Hume's
     documented REST API, matching the same family of endpoint this codebase already calls
     successfully for Configs — not yet round-trip-verified in this repo the same way the Configs
     fields were. This is flagged exactly the way `config-provisioner.ts`'s own `webhooks` field is
     already flagged as "best-supported guess, confirm on first live call" — an implementation-time
     verification step, not an open design question.)*
  2. **Attach it to the base config:** `POST https://api.hume.ai/v0/evi/configs/{NEXT_PUBLIC_HUME_CONFIG_ID}`
     to create a new version of the existing base config, whose `tools` array includes the new
     `end_session` `{id, version}` alongside the base config's existing tool references. Once this
     lands, `config-provisioner.ts`'s already-shipped dynamic `tools` reconstruction (no code change
     needed there) automatically carries `end_session` into every future Hume-native session clone —
     exactly the mechanism that already fixed the `third-capability-missing` incident for any future
     tool addition.
  - **Does this require action from Arun?** **Yes, one concrete thing.** Both calls need the real
    production `HUME_API_KEY` value. This project's own convention (per `CLAUDE.md`) is that local
    development and sandboxed build agents only ever have `PLACEHOLDER_` credential values — the real
    key lives in Vercel's environment configuration. So either: (a) Arun runs the two prepared
    one-time API calls himself (the developer implementing this feature will hand him
    copy-pasteable `curl` commands with the exact bodies above), or (b) Arun supplies the real
    `HUME_API_KEY` value to the implementing engineer for this one-time setup step only. There is no
    Hume *dashboard* action required either way — both steps are plain authenticated API calls, the
    same mechanism this codebase already uses for every other Config operation.
- `lib/voice/hume-native/prompt-template.ts`'s `PROMPT_TEMPLATE_VERSION` bump (`'v4'` → `'v5'`) —
  no external dependency, ships with the code change.
- The existing, unmodified `forceEndSession()` (`lib/session-billing.ts`) and
  `inngest/session-timer.ts` hard backstop — depended on as-is, not modified.
- The existing, unmodified `GET /api/walkthrough-state/[userId]` poll cycle in
  `WalkthroughClient.tsx` — no new polling mechanism introduced.
- No database migration required. No new environment variables required (reuses existing
  `HUME_API_KEY` and `NEXT_PUBLIC_HUME_CONFIG_ID`).

## CEO Review

**Status: APPROVED.** Reviewed 2026-07-08 against the Feature Brief
(`.claude/agents/clio/feature-briefs/SESSION-END-01-explicit-end-session-signal.md`)
and this project's spec-before-build gate.

Checks performed:
- Section 11 confirmed empty ("None.") — every question the brief posed is resolved with cited
  evidence, not deferred.
- Independently re-verified the three load-bearing technical claims directly against source, rather
  than accepting the BA's self-report: (1) `WalkthroughClient.tsx` line 826 (`tools.end_session`,
  Hume block) and line 902 (`clientTools.end_session`, ElevenLabs block) both exist exactly as
  described; (2) `lib/voice/hume-adapter.ts`'s `case 'tool_call'` (line ~201) and `ws.onclose` (line
  ~110) are confirmed structurally separate code paths, with `onclose` having no branching on
  `event.code`/`event.reason` that could identify a `hang_up`-triggered end — confirming option (A)
  cannot be distinguished from an ordinary drop anywhere in this codebase today; (3) `end_session` is
  confirmed already instructed and wired for the standard pipeline in
  `lib/clio-context-builder.ts`, `lib/content/live-conductor-prompt.ts`,
  `lib/voice/live-conductor-bridge.ts`, and `lib/voice/relay-handler.ts` — the BA's claim that this is
  closing a gap in one path, not inventing a new mechanism, holds up.
- Scope is appropriate: touches only the Hume-native prompt/provisioning path plus a narrowly-gated,
  inert-elsewhere `FAREWELL_PHRASES` hardening; explicitly excludes the already-working ElevenLabs
  and Hume-Custom-LLM `end_session` mechanism from any change. Not over-built (no new UI, no new DB
  schema, no new admin tooling) and not under-built (sequencing is an explicit testable criterion;
  the `hang_up`-exclusion fix closes a real hole the brief itself hadn't anticipated — correctly
  caught by the BA, not left as a gap).
- One process note, not a spec defect: a message relayed via the orchestrator mid-investigation
  claimed Arun had already decided on option (A) `hang_up`. Per this project's own standing practice,
  an orchestrator-relayed claim of Arun's decision is not treated as equivalent to Arun's direct word,
  especially where it would have preempted a full-autonomy engineering question the original brief
  explicitly delegated to the BA. The BA was directed to resolve the question on evidence regardless
  of that relayed claim, and did so — reaching the opposite conclusion, with citations. This is
  reported to the orchestrator/Arun directly as a discrepancy worth Arun's awareness, not
  silently reconciled and not treated as blocking approval, since the technical evidence is
  unambiguous and independently verified above.

Approved for developer handoff.
