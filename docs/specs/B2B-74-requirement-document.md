# B2B-74 — Live Voice Session Two-Clock Desync — Requirement Document

Version: 1.0
Status: **CEO-APPROVED 2026-08-06** — Section 11 empty, all 12 sections complete, every load-bearing
claim independently re-verified against live code by the CEO agent (see "CEO Review Record" below).
**Approval of this spec is NOT authorization to build.** Per Arun's explicit instruction, the approach
must be explained to him directly in plain language and his go-ahead received before any code is
written. Two binding corrections apply before implementation — see the CEO Review Record.
Author: Business Analyst Agent
Date: 2026-08-06
Feature Brief: `.claude/agents/clio/feature-briefs/B2B-74-widget-voice-two-clock-desync-and-idle-timeout-hallucination.md`
Channel: widget voice channel (`/widget-render`), OpenAI Realtime provider only
Priority: P0 — live, currently broken

---

## CEO Review Record — 2026-08-06

**Verdict: APPROVED to proceed to Arun's plain-language gate, with two binding corrections.**

I independently re-read `openai-realtime-adapter.ts`, `WidgetRenderClient.tsx` and
`widget-prompt-rules.ts` rather than trusting Section 0. Every load-bearing claim confirmed:
the 8000 ms cap on `waitForPlaybackCaughtUp()` (adapter L944-962 → L949), the missing
`onDiagnostic` on `speech_started` (L480-491), the hardcoded `idle_timeout_ms: 12000` (L320), the
`idle_timeout_triggered → handleIdleTimeoutFired()` wiring (WidgetRenderClient L482-486), and the
`A then B` shape in `IDLE_TIMEOUT_CHECKIN_TEXT` (L172-178) and G3. §0.4 and §0.5 are genuinely new
findings not present in my brief, and §0.4 in particular means the v16-deferred mechanism would have
closed roughly a tenth of the gap if shipped as written. That finding alone justified the full gate.

**Correction 1 (binding, factual).** AC-4 and AC-5 name the diagnostic label `idle_checkin_fired`.
The label actually emitted is **`idle_timeout_checkin_fired`** (`WidgetRenderClient.tsx`, inside
`handleIdleTimeoutFired`). Either use the real label in the acceptance criteria, or rename the
emission and the criteria together — but the two must match, or AC-4/AC-5 are unevaluable against a
real capture.

**Correction 2 (binding, expectation-setting — not a spec defect).** §6.3 (barge-in) is Stage 2. That
means **Stage 1's live test can still reproduce Arun's original "you skipped the entire subtopic"
complaint**, because a single incidental "yeah" still discards the unheard remainder of a ~100 s
topic until Stage 2 ships. The BA states this correctly in Q3 and Q6; I am elevating it to a
condition of approval because it is the single most likely way Stage 1 gets misread as a failed fix.
Whoever runs the Stage 1 test must be told in advance: judge Stage 1 on AC-1 through AC-10 only, and
a mid-topic content-loss report during that test is expected, not a regression.

**Reviewed and explicitly accepted, not waived:**
- Q3's rejection of "rely on Q1 making today's barge-in correct again" — the BA is right and my brief
  was wrong to list it as a live option. One turn in this product is one whole topic.
- Q2's removal decision, including the finding that the observed fire timing is inconsistent with
  OpenAI's documented formula under every reading. Designing against an unverifiable anchor was the
  thing I most wanted avoided; removal is the only option that avoids it.
- Q6's correction of my own "shipping Q3 without Q1 is actively harmful" reasoning to "meaningless
  without it, not dangerous." The ordering conclusion is unchanged and better-founded.
- No revert of v18, independently re-confirmed by the BA against all three findings.

**Not approved as part of this spec, flagged onward:** the meeting-bot channel still runs
`idle_timeout_ms: 12000` with no client handler at all, so Finding 1 is live and unmitigated there.
Correctly kept out of scope per my own constraint. Allocate a follow-on brief once Stage 1 is
validated.

**Tracking gap for the Orchestrator:** `docs/b2b-pivot-status.md` has no Live Status row for B2B-74
(nor for B2B-73). One must be added before Stage 1 work begins, per the brief and CLAUDE.md.

---

## Section 0 — Verification Pass (what I confirmed directly against live code before specifying)

Everything load-bearing below was read in the actual files, not inferred from the brief. Findings
that changed the shape of this spec are marked **NEW**.

| # | Claim | Verified where | Result |
|---|---|---|---|
| 0.1 | `speech_started` clears the whole playback queue and reports nothing to diagnostics | `openai-realtime-adapter.ts:480-491` | Confirmed. `clearAudioQueue()` + `onModeChange` + `onUserSpeechStarted`. No `onDiagnostic` call. |
| 0.2 | `timeout_triggered` is diagnostic-only client-side | `openai-realtime-adapter.ts:499-501` | Confirmed. The *server* still auto-generates a response regardless — that is not a client-side behaviour we can suppress. |
| 0.3 | `idle_timeout_ms: 12000` lives in the shared adapter's hardcoded `session.update` | `openai-realtime-adapter.ts:315-321` | Confirmed. **Not** per-channel today. |
| 0.4 | `waitForPlaybackCaughtUp()` is capped at 8000 ms | `openai-realtime-adapter.ts:944-962` — delegates to `waitForPlaybackToFinish(timeoutMs = 8000)` | Confirmed. **NEW, and load-bearing:** with an ~80 s backlog this wait *expires after 8 s and proceeds anyway*. Reusing it unchanged as the clock-reconvergence gate (the v16-identified mechanism, and the brief's Q1 starting point) **would not work** — it would close ~8 s of a ~80 s gap. See §Q1. |
| 0.5 | The widget's `advance_tab` already awaits `waitForPlaybackCaughtUp()` | `WidgetRenderClient.tsx:394-405` | Confirmed, fire-and-forget. **NEW:** because of 0.4, the *visual* page advance is also capped at 8 s, so under backlog the screen advances ~8 s after the tool call rather than when the participant hears it. This is an independent, previously-untracked contributor to Arun's "went to topic 3 without going through topic 2" report — the screen moved on the server clock too. |
| 0.6 | The meeting-bot channel shares this adapter | `PartnerRenderClient.tsx:7, 552-600` | Confirmed. It constructs `OpenAIRealtimeAdapter` and passes `onDiagnostic`. |
| 0.7 | The meeting-bot has no `idle_timeout_triggered` handler | `PartnerRenderClient.tsx:564-571` | Confirmed — its `onDiagnostic` only forwards to the capture beacon. **NEW:** so on the meeting-bot channel an idle timeout produces the server's fabricated-answer response with *no* client counterpart at all. Finding 1 is live there too, unmitigated. Out of scope to fix here (see §10), flagged in §12. |
| 0.8 | There is an existing precedent for config-gating an adapter behaviour change so only one channel opts in | `OpenAIRealtimeAdapterConfig.transcriptGateMode`, `openai-realtime-adapter.ts:92`; consumed at `PartnerRenderClient.tsx:592` | Confirmed. Every adapter change in this spec follows that exact shape. |
| 0.9 | Diagnostic `at` is stamped server-side at the capture route | `openai-realtime-diagnostic-store.ts:48` (`at: Date.now()` inside `appendDiagnosticEvent`) | Confirmed. Each event is an independent `fetch(..., keepalive: true)` from the browser — ordering and latency are not guaranteed. **Sub-10-second timing claims cannot be made from today's data.** This blocks the acceptance criteria in §7 and is therefore fixed as a prerequisite, not an optional extra. |
| 0.10 | Diagnostics can be read back per session | `app/api/debug/transcript-read/[clio_session_ref]/route.ts` | Confirmed — returns `{ turns, diagnostics, assembledOpenAIPrompt }`. This is the read path every §7 acceptance criterion is measured from. |
| 0.11 | OpenAI's documented `idle_timeout_ms` anchor and fire behaviour | WebFetch + WebSearch against `developers.openai.com/blog/realtime-api`, fetched 2026-08-06 | Confirmed verbatim: anchored to "the `response.done` time plus audio playback duration plus timeout time"; on fire the server "commits the empty audio segment to the conversation history and triggers a model response." **NEW:** also confirmed "Idle timeout is currently only supported for `server_vad` mode… This applies to WebSocket connections where the client manages audio playback." The documentation states the feature is supported on WebSocket *while acknowledging the client owns playback* — i.e. the server has no playback clock to read. It does **not** explain how the "audio playback duration" term is obtained on that transport, and does not address re-fire cadence. |
| 0.12 | The observed fire timing is consistent with the documented formula | Brief's evidence: fire 3.19 s after `response_done`, on a turn carrying ~100 s of audio | **Not consistent under any reading.** Formula predicts ~112 s; even the degenerate reading (`response_done + 12 s`) predicts 12 s. Combined with 0.9, the 3.19 s figure is also not trustworthy to that precision. **Conclusion carried into the design: we do not know when this timer fires and cannot currently measure it. No part of this spec depends on knowing.** |

**The single most important consequence of 0.4 + 0.12:** the mechanism v16 identified and deferred
is the right *idea* but is not usable as written, and the mechanism v14 adopted is not merely
harmful (Finding 1) but *unanalysable* on our transport. Both facts push the design toward
client-owned, client-measurable timing.

---

## Section 1 — Purpose

A live widget voice session runs on two clocks. OpenAI generates speech 3–5× faster than it can be
spoken, and this product deliberately teaches in long turns (v18 made a whole topic one unbroken
turn — 245 words / ~100 s of audio in the tested session). Every safety, recovery and pacing
mechanism in this channel is anchored to the moment the *server* finished generating. The
participant lives on the moment they finished *hearing*. In session
`444b3ae9-cace-43e3-b5b0-205775e75acc` that gap reached roughly one full topic (~90–100 s).

This feature reconverges those two clocks and re-anchors every silence and pacing decision to the
participant's clock.

Failure without it — all three already observed live in one session:

1. Clio grades an answer the participant never gave. The server's `idle_timeout_ms` fires on its own
   clock, commits an empty audio segment, and invites the model to guess that someone spoke. It did:
   it confirmed and graded a non-existent answer.
2. Clio interrupts herself into silence. Every incidental "yeah" deletes the entire unheard
   remainder of the lesson. The participant reported a skipped subtopic; it was taught and thrown
   away locally before reaching them.
3. Two recovery mechanisms race on the same trigger, so identical silence produces either a warm
   check-in or a fabricated answer, at random.

The measured end state of all three together: the participant answered topic 1's question while
topic 2's question was pending, was marked wrong, and ended the call themselves.

---

## Section 2 — User Stories

**Participant (the person in the widget session) — primary**

> As a participant in a live Clio session,
> I want what Clio says and what I hear to stay in step,
> So that when I answer a question I am answering the question I actually just heard, and I am
> judged on that answer rather than on one I never gave.

> As a participant,
> I want to be able to say "mm-hmm" or "yeah" while Clio is explaining something,
> So that I can react like a normal person without deleting the rest of the lesson.

> As a participant,
> I want to be able to genuinely interrupt Clio with a question and have her stop immediately,
> So that the session feels like a conversation rather than a recording I cannot pause.

> As a participant,
> I want silence to produce one predictable, warm reaction,
> So that pausing to think never results in Clio answering for me or winding the session down.

**Reseller partner (whose learners are in these sessions) — secondary**

> As a reseller partner embedding Clio,
> I want the session's own captured data to show that content was actually delivered and questions
> were actually answered by a human,
> So that a learner's reported "it skipped a section" can be confirmed or refuted from data rather
> than argued about.

**Arun / internal — secondary**

> As the owner reviewing a live test,
> I want to read the desync directly off the session's diagnostics as a number,
> So that "did this round work" is answered by measurement rather than by how the call felt.

---

## Section 3 — Trigger / Entry Point

Not a new user-facing surface. This changes behaviour inside an existing, already-live flow.

- **Route:** `/widget-render/[clio_session_ref]` (widget channel). Rendered inside the reseller's
  iframe.
- **Provider:** `voiceProvider === 'openai_realtime'` only. Hume-provider widget sessions are
  untouched (see §10).
- **Trigger:** automatic, for the whole duration of every OpenAI-Realtime widget voice session, from
  `session.updated` to `endSession()`. There is no button, no setting, and no participant-visible
  entry point.
- **Required state:** a live widget session with a valid `clio_session_ref`, microphone permission
  granted, and an open Realtime WebSocket. Identical to today's preconditions — none added.
- **Not triggered by:** the meeting-bot channel (`/partner-render`), which keeps today's behaviour
  byte-for-byte via config defaults (§6.6).

---

## Section 4 — Behaviour Description (state by state)

There is no screen to describe; the observable artefact is the participant's audio timeline. Each
state below is written as: what the participant experiences → what the system does → what is
recorded.

### 4.1 State A — Clio teaching a topic (the normal case)

**Participant experiences:** Clio speaks a whole topic at an unhurried pace, ~100 s, then asks a
verification question and stops.

**System:** the server finishes generating in ~21 s; ~80 s of audio sits in the local queue and
plays out. `response.done` fires at ~21 s. **Nothing is allowed to start a new turn until that queue
has actually drained** (§6.1). The `advance_tab` visual move likewise waits for real drain, not for
an 8-second cap (§6.2).

**Recorded:** `response_created`, `response_done`, `playback_drained` (new), each carrying a
client-side timestamp (§6.5).

### 4.2 State B — Clio finishes a topic and moves to the next

**Participant experiences:** the last sentence of topic 1 finishes → a short natural beat (well
under ~1.5 s in the expected case) → the screen moves → topic 2 begins as a fresh, unhurried start.

**System:** the model calls `advance_tab`. Today the adapter does `await waitForResponseDone()` then
`response.create` immediately — this is the single largest per-session drift source, firing once per
topic. Under this spec the tool-dispatch `response.create` additionally waits for the local playback
queue to drain (§6.1). The screen move uses the same, now-uncapped, wait (§6.2).

**Recorded:** `tool_call`, `playback_drained`, `turn_gap` (new, carrying `gapMs` — the measured beat
between drain and the next turn's first audio byte).

### 4.3 State C — participant makes an incidental sound while listening ("mm-hmm", "yeah")

**Participant experiences:** Clio goes quiet immediately, for roughly half a second to a second,
then **picks up exactly where she was** and finishes the topic. Nothing is lost.

**System:** `speech_started` → playback is **suspended, and the queue is retained, not discarded**
(§6.3). `speech_stopped` arrives with a measured speech duration under the incidental threshold and
no model response follows → playback resumes from the retained queue.

**Recorded:** `speech_started` (new, carrying `queuedAudioMs`), `speech_stopped` (new),
`barge_in_resolved` (new, `{ outcome: 'resumed', retainedMs, discardedMs: 0 }`).

> **This is the case that produced the "skipped subtopic" report.** Today it deletes the rest of the
> topic. Under this spec it costs a sub-second pause.

### 4.4 State D — participant deliberately interrupts with a question

**Participant experiences:** Clio stops immediately — the same responsiveness as today, no delay
added. She answers the question. The remainder of the interrupted explanation is not resumed.

**System:** `speech_started` → suspend + retain (identical first step to State C — the two cases are
*not* distinguished at this instant, and cannot be). The server commits the utterance and generates
a response; on `response.created` the retained queue is **discarded**, because Clio is now speaking
to that interruption and the superseded material would be incoherent played after it.

**Recorded:** `speech_started`, `speech_stopped`, `barge_in_resolved`
(`{ outcome: 'discarded', discardedMs }`).

> `discardedMs` is the honest measure of content loss and is a first-class acceptance metric (§7).

### 4.5 State E — genuine silence after Clio asks a question

**Participant experiences:** Clio asks a question and waits. If they say nothing for a real,
participant-clock interval, Clio says **one short warm sentence** inviting them to answer whenever
they are ready — and then waits again. She never re-asks the question in that same breath, never
grades a non-answer, and never winds the session down.

**System:** exactly one mechanism can produce this. The server-side `idle_timeout_ms` is removed for
this channel (§6.4), eliminating both the fabricated-answer path and the race. The client arms a
silence timer **when local playback actually drains** — the first time in this channel's history that
the client has had a reliable, model-compliance-free, participant-clock arming signal (§6.4).

**Recorded:** `silence_timer_armed` (new), `idle_checkin_fired` (existing label, now carrying
`sincePlaybackDrainMs`).

### 4.6 State F — session reaches the 60-minute cap

Unchanged. `MAX_CALL_DURATION_MS` and rule G4 are untouched. This remains the only mechanism that
ever closes a session automatically.

### 4.7 State G — the playback gate fails to clear

**Participant experiences:** a session that behaves as it does today (no worse) rather than hanging.

**System:** every wait introduced by this spec is bounded (§6.1). If a bound is reached, the system
proceeds exactly as today and records the failure — a silent hang is never an acceptable outcome of
a pacing fix.

**Recorded:** `playback_gate_timeout` (new). Any occurrence of this event is an automatic
investigation trigger, not a tolerated condition.

---

## Section 5 — Visual Examples

No screen layout changes. The deliverable is a timeline, so the wireframes are timelines.

### 5.1 Today — State A/B, one topic (the bug)

```
SERVER CLOCK   ├─ generate topic 1 (21s) ─┤├─ generate topic 2 ─┤├─ generate topic 3 ─┤
                                          ↑                     ↑
                                     response.done         advance_tab fires
                                          ↓
                                  idle_timeout fires on THIS clock
                                          ↓
                              server invents + grades an answer

PARTICIPANT    ├──────── still hearing topic 1 (100s) ────────────────────────┤
CLOCK                                                          ↑
                                            participant answers TOPIC 1's question here,
                                            while TOPIC 2's question is pending → marked wrong

                 └────────────── desync grows to ~90-100s ──────────────┘
```

### 5.2 Under this spec — State A/B, one topic

```
SERVER CLOCK   ├─ generate topic 1 (21s) ─┤        [gate]        ├─ generate topic 2 ─┤
                                          ↑                      ↑
                                    response.done        response.create released
                                                         only after real drain

PARTICIPANT    ├──────── hearing topic 1 (100s) ────────────────┤ beat ├─ topic 2 ─────┤
CLOCK                                                           ↑  <1.5s
                                                          playback_drained
                                                    (silence timer arms HERE, not above)

                 └─── desync ≈ 0 ───┘
```

### 5.3 State C — incidental "mm-hmm" (today vs. under this spec)

```
TODAY
  Clio:   ─── teaching ───"…and the way that works is—"  [ 90s of queued audio DELETED ]
  Person:                            "mm-hmm"
  Result: rest of the topic never heard. Reported as "it skipped a subtopic."

UNDER THIS SPEC
  Clio:   ─── teaching ───"…and the way that works is"  [pause]  "—by comparing each answer…"
  Person:                            "mm-hmm"
  Result: ~0.5-1s pause, then resumes. Nothing lost.  barge_in_resolved: outcome=resumed
```

### 5.4 State D — deliberate interrupt

```
  Clio:   ─── teaching ───"…and the way that works is"  [stops immediately]  "Good question — …"
  Person:                            "Wait, can you explain that differently?"
  Result: remainder discarded BY DESIGN (that is what interrupting means).
          barge_in_resolved: outcome=discarded, discardedMs=<measured>
```

### 5.5 State E — genuine silence

```
TODAY (coin flip — same trigger, two outcomes observed minutes apart in one session)
  outcome 1 → "Yes, that's right. It uses a written set of principles…"   ← nobody spoke
  outcome 2 → "Take your time — whenever you're ready" + [verbatim re-ask]  ← two utterances, 13ms apart

UNDER THIS SPEC (one mechanism, one utterance, every time)
  Clio:   "…so which of those two would you reach for?"
          [participant hears the full question, then playback drains]
          [silence timer arms HERE — 15s of real, participant-clock silence]
  Clio:   "No rush — whenever you're ready."
          [waits again; re-arms; identical reaction every subsequent time]
```

---

## Section 6 — Functional Requirements & Data Requirements

Each requirement states its channel scope explicitly, per the CEO's constraint. Data requirements
are in §6.8.

### 6.1 — Gate turn creation on real playback (the clock reconvergence)

**Scope: shared adapter file, behaviour WIDGET-ONLY via a config field defaulting to today's
behaviour.**

- New config field on `OpenAIRealtimeAdapterConfig`:
  `turnPacingMode?: 'immediate' | 'playback_gated'`, default `'immediate'`.
  `'immediate'` reproduces today's behaviour byte-for-byte. This mirrors the existing
  `transcriptGateMode` precedent exactly (§0.8).
- Under `'playback_gated'`, the tool-dispatch `response.create` (`response.output_item.done`,
  ~line 658) waits for **both** `waitForResponseDone()` (today) **and** local playback drain, before
  sending `response.create`.
- The playback wait used here **must not use the existing 8000 ms cap** (§0.4). It takes an explicit
  bound of **180000 ms**, chosen as: comfortably longer than any legitimate single teaching turn
  (~100–150 s of audio), while still bounded so a stuck queue cannot hang a session indefinitely.
- If that bound is reached, proceed exactly as today **and** emit `playback_gate_timeout` (§4.7).
- `waitForPlaybackCaughtUp()` gains an optional `timeoutMs` parameter. Existing no-argument callers
  (meeting-bot's two `advance_tab` sites) are byte-for-byte unchanged.
- The initial `response.create` at `session.updated`, and the `end_session` no-speech retry path,
  are **not** gated — neither can have a backlog (§Q1 table rows 1 and 2).

**Widget call site:** `turnPacingMode: 'playback_gated'`, hardcoded at the widget's
`OpenAIRealtimeAdapter.create(...)` call. Deliberately **not** env-var gated, unlike
`transcriptGateMode`: an env var adds a silent-misconfiguration failure mode, and the widget's call
site is already a widget-only file, so reverting is a one-line change. This also honours the
standing "prefer new toggles on" rule.

**Meeting-bot:** omits the field → `'immediate'` → unchanged.

### 6.2 — Uncap the visual advance wait

**Scope: WIDGET-ONLY** (`WidgetRenderClient.tsx`).

- The `advance_tab` handler's fire-and-forget `waitForPlaybackCaughtUp()` passes the same
  180000 ms bound, so the screen moves when the participant actually hears the transition rather
  than 8 s after the tool call (§0.5).
- Stays fire-and-forget — the handler must still return immediately, preserving the B2B item 7a fix.
- The meeting-bot's two identical call sites are **not** changed (no argument passed → 8000 ms
  default preserved).

### 6.3 — Barge-in: suspend and retain, then resolve

**Scope: shared adapter file, behaviour WIDGET-ONLY via a config field defaulting to today's
behaviour.**

- New config field: `bargeInMode?: 'clear_all' | 'suspend_and_resume'`, default `'clear_all'`
  (today's behaviour, byte-for-byte).
- Under `'suspend_and_resume'`, the state machine is:

| # | Trigger | Action | Recorded |
|---|---|---|---|
| B1 | `input_audio_buffer.speech_started` | **Suspend** playback scheduling. **Retain** the queue — never discard it here. `onModeChange('listening')` and `onUserSpeechStarted?.()` fire exactly as today, so Clio goes quiet with no added latency. | `speech_started` + `queuedAudioMs` |
| B2 | `response.created` arrives while suspended | **Discard** the retained queue and clear suspension. Hard override — the model is now speaking to the interruption; the superseded material must not play after it. | `barge_in_resolved` `{outcome:'discarded', discardedMs}` |
| B3 | `speech_stopped` while suspended, measured `speech_started`→`speech_stopped` duration **< 700 ms** | **Resume** the retained queue after a 250 ms settle delay. | `speech_stopped`, `barge_in_resolved` `{outcome:'resumed', retainedMs}` |
| B4 | `speech_stopped` while suspended, duration **≥ 700 ms** | Stay suspended, awaiting B2. | `speech_stopped` |
| B5 | Still suspended 3000 ms after B4 with no `response.created` | **Resume.** Safety net — the queue is never left permanently suspended. | `barge_in_resolved` `{outcome:'resumed_timeout', retainedMs}` |

- **Why the 700 ms duration heuristic is safe despite being a heuristic:** both misclassification
  directions have bounded, non-regressive cost. Misclassifying a deliberate interrupt as incidental
  → we resume briefly, then B2 fires and discards anyway (a ~250 ms audio blip, self-correcting).
  Misclassifying an incidental sound as deliberate → we behave exactly as today (discard on the
  server's response) — no regression. There is no branch where this is worse than current behaviour.
- **`pendingAiTranscript` handling:** `clearAudioQueue()`'s existing discard of `pendingAiTranscript`
  must apply on the **discard** branches (B2/today) and **must not** apply on suspend (B1) — the
  transcript is still valid for audio that will resume. On resume, the existing
  `flushPendingAiTranscriptIfDrained()` fires at real drain, unchanged.
- **`waitForPlaybackToFinish` interaction:** while suspended with a retained queue,
  `audioQueue.length > 0`, so it correctly reports "not caught up." No change needed there.
- **VAD settings are NOT changed.** `noise_reduction: far_field` and `threshold: 0.5` stay as-is.
  Considered and rejected: raising the threshold to stop incidental trips. Rejected because (a) it
  trades a fixed bug for a variable one — a higher threshold risks missing genuinely quiet speech,
  which is a *worse* failure than a sub-second pause, and (b) under B1–B5 an incidental trip already
  costs ~0.5–1 s rather than a topic, so the motivation for touching it disappears.

**Meeting-bot:** omits the field → `'clear_all'` → unchanged.

### 6.4 — Remove the server idle timeout; re-anchor silence to the participant clock

**Scope: `idle_timeout_ms` removal is WIDGET-ONLY via a config field; the replacement timer is
WIDGET-ONLY by construction.**

- New config field: `idleTimeoutMs?: number | null`, default `12000` (today's value). `null` omits
  `idle_timeout_ms` from the `turn_detection` block entirely.
- **Widget passes `null`.** This eliminates, at source: the fabricated-answer path (Finding 1), one
  ungateable turn-creation source (§Q1 row 5), and one of the two racing mechanisms (Finding 3).
- **Meeting-bot omits the field** → keeps `12000` → unchanged. (See §12 for the recommendation that
  it should not keep it, raised as a separate brief rather than silently expanding this scope.)
- The adapter's `input_audio_buffer.timeout_triggered` case is **kept** (the meeting-bot still needs
  it) and remains diagnostic-only.
- **The widget's `onDiagnostic` handler drops its `idle_timeout_triggered → handleIdleTimeoutFired()`
  wiring entirely** and merely logs the label. This is what makes Finding 3's race *impossible by
  construction* rather than merely rare: after this change exactly one code path in the widget can
  ever produce a check-in.
- **New client-side silence timer** (`WidgetRenderClient.tsx`):
  - **Arms** when local playback actually drains — i.e. on the new `playback_drained` signal — and
    only when the drain followed Clio speaking. This is the reliable, participant-clock,
    model-compliance-free arming signal that v10 (mode transitions = server clock) and v11–v13
    (`awaiting_answer` = model compliance) both lacked, and that v14 moved to the server precisely
    *because* the client had no such signal. §6.1 creates it.
  - **Disarms** on `input_audio_buffer.speech_started`, and on any new `response.created`.
  - **Duration: 15000 ms.** Reasoning: prior client-side values (v9's 20 s) were measured from the
    wrong clock and so were effectively far longer in felt terms; v14's 12 s was a server value
    subject to §0.12's unknown anchor. 15 s of *real, heard* silence after Clio stops is a long
    conversational pause without being abandonment. Specified as a single named constant so it is
    tunable from one place.
  - **On fire:** exactly one action — `triggerRecoveryNudge()` with the single-speech-act text from
    §6.7. Non-terminal, always. Re-arms on the next drain. Every fire is identical, no matter how
    many times in a row (v16's rule, preserved).
  - This does **not** reintroduce a client-side clock of the kind v14 rejected. v14's objection was
    to timers armed on unreliable signals, not to client timing per se; the signal is what changed.

### 6.5 — Instrumentation (required regardless of fix shape; also a prerequisite for §7)

**Scope: adapter changes are SHARED and additive (both channels benefit, neither changes behaviour);
the client-timestamp wrapper is WIDGET-ONLY.**

New `onDiagnostic` emissions in the adapter:

| Label | Fires on | Payload |
|---|---|---|
| `speech_started` | `input_audio_buffer.speech_started` | `{ queuedAudioMs, queuedChunks }` |
| `speech_stopped` | `input_audio_buffer.speech_stopped` | `{ speechDurationMs }` |
| `input_committed` | `input_audio_buffer.committed` | `{}` |
| `playback_drained` | the real drain point (`drainQueue()`'s base case) | `{ drainedAfterMs }` |
| `barge_in_resolved` | B2/B3/B5 (§6.3) | `{ outcome, retainedMs, discardedMs }` |
| `turn_gap` | first audio byte of a turn that followed a drain | `{ gapMs }` |
| `playback_gate_timeout` | §6.1 / §6.2 bound reached | `{ waitedMs, queuedAudioMs }` |
| `silence_timer_armed` | §6.4 arm | `{ armedAfterDrain: true }` |

These three (`speech_started`, `speech_stopped`, `input_committed`) are mandated by the brief
regardless of fix shape. They are emitted unconditionally — **not** gated behind any config field —
because they are pure observation. `speech_stopped` and `committed` currently reach `onDiagnostic`
only via the generic `default: unhandled_event` branch with no payload; they become named cases with
real payloads.

**Client-side timestamps (blocking prerequisite, §0.9):** the widget's `onDiagnostic` handler stamps
every forwarded event with `clientAt` (`Date.now()`) and `clientMonoMs` (`performance.now()`) before
POSTing. `clientMonoMs` is the field every §7 measurement uses — it is stamped in the browser at
emit time, in the same synchronous tick as the adapter's own emit, so it is immune to both network
jitter and wall-clock adjustment. Done in **one** place in `WidgetRenderClient.tsx`, so no adapter
churn. The store's existing server-side `at` is left untouched.

### 6.6 — Channel scope summary (the CEO's explicit requirement, in one table)

| Change | File | Widget | Meeting-bot | How the boundary is enforced |
|---|---|---|---|---|
| 6.1 Playback-gated turn creation | `openai-realtime-adapter.ts` | ✅ on | ❌ unchanged | `turnPacingMode` defaults to `'immediate'`; meeting-bot omits it |
| 6.2 Uncapped visual advance wait | `WidgetRenderClient.tsx` | ✅ on | ❌ unchanged | Widget-only file; meeting-bot's call sites pass no argument |
| 6.3 Suspend-and-retain barge-in | `openai-realtime-adapter.ts` | ✅ on | ❌ unchanged | `bargeInMode` defaults to `'clear_all'`; meeting-bot omits it |
| 6.4a Remove `idle_timeout_ms` | `openai-realtime-adapter.ts` | ✅ removed | ❌ keeps 12000 | `idleTimeoutMs` defaults to `12000`; widget passes `null` |
| 6.4b Client silence timer | `WidgetRenderClient.tsx` | ✅ new | ❌ n/a | Widget-only file |
| 6.4c Drop idle→nudge wiring | `WidgetRenderClient.tsx` | ✅ removed | ❌ never had it | Widget-only file (§0.7) |
| 6.5 New diagnostics | `openai-realtime-adapter.ts` | ✅ | ✅ (additive, observation only) | Unconditional; `onDiagnostic` is optional and both channels pass it |
| 6.5 Client timestamps | `WidgetRenderClient.tsx` | ✅ | ❌ | Widget-only file |
| 6.7 Check-in text + G3 | `WidgetRenderClient.tsx`, `widget-prompt-rules.ts` | ✅ | ❌ | Both are widget-only files by construction |

`lib/voice/hume-adapter.ts`: **not touched.** `lib/voice/openai-realtime-prompt-template.ts` (the
meeting-bot's prompt): **not touched.** `lib/voice/openai-realtime-tools.ts`: **not touched** — the
tool descriptions are shared and carry no pacing semantics after v18.

### 6.7 — Single-utterance check-in (supporting prompt change only)

**Scope: WIDGET-ONLY.** This is explicitly a *supporting* change, never the primary fix. Roughly
fifteen prior rounds of wording changes failed against mechanical causes (v1–v18); this one is
included only because Q4's two-utterance defect is genuinely a wording-shape defect and is fixed by
an already-proven in-file pattern.

- `IDLE_TIMEOUT_CHECKIN_TEXT` (`WidgetRenderClient.tsx`) and rule **G3** (`widget-prompt-rules.ts`)
  currently both carry the `A then B` structure the v12 history identified as reliably collapsing or
  doubling: *"Check in warmly… **then** continue naturally: if you had just asked a question, wait
  for their real answer again; if you were partway through explaining something, simply continue…"*
  The live failure was exactly the doubling direction — check-in plus a verbatim question repeat, two
  output items 13 ms apart.
- Both are rewritten to describe **exactly one speech act, with no second obligation of any kind**,
  applying v12's fusion pattern. The rewritten instruction must:
  - name one short sentence as the entire thing to say;
  - explicitly forbid re-asking or restating the pending question in that same turn;
  - explicitly forbid resuming the explanation in that same turn;
  - end with "then stop and wait";
  - preserve v16's absolute rule that this note never ends the session, no matter how many arrive.
- **Both must change in lockstep.** If only one changes they contradict each other, and the GLOBAL
  RULES bracket declares itself as overriding — the exact false-conflict class that caused v18's own
  primary bug.
- The file's header history is extended with a **v19** entry and
  `WIDGET_OPENAI_PROMPT_VERSION` bumped to `'widget-v19'`, per this file's own convention.
- **v18 is not reverted**, in full agreement with the CEO's ruling. I independently checked v18's
  three changes (G1 rewording, rule 1's opening boundary, the HOW YOU SOUND bullets) against all
  three findings and found no causal path from any of them to the clock drift, the idle-timeout
  behaviour, or the barge-in discard. All three are mechanical and pre-date v18. No escalation.

### 6.8 — Data Requirements

**Read from the database (Supabase): nothing new.** No new table, column, index, migration, or RLS
policy. This change is entirely runtime session behaviour.

**Written to the database (Supabase): nothing new.** `partner_sessions`, the billing/duration write
in `endSession()`, the transcript-capture path and the insights extractor are all untouched. Session
duration is still computed from `connectStartRef` exactly as today.

**Written to Redis (Upstash):** additional entries appended to the **existing** per-session
diagnostic list via the **existing** `POST /api/partner/render/voice-diagnostic-capture` route and
`appendDiagnosticEvent()`. No new key, no new store, no schema change, no TTL change (stays at the
existing 30 minutes).

- New `label` values written: `speech_started`, `speech_stopped`, `input_committed`,
  `playback_drained`, `turn_gap`, `barge_in_resolved`, `playback_gate_timeout`,
  `silence_timer_armed`.
- New fields inside `detail` (the route's Zod schema already accepts `z.record(z.unknown())`, so
  **no schema change is required**): `clientAt`, `clientMonoMs`, `queuedAudioMs`, `queuedChunks`,
  `speechDurationMs`, `drainedAfterMs`, `gapMs`, `outcome`, `retainedMs`, `discardedMs`, `waitedMs`,
  `armedAfterDrain`.
- **Volume impact, checked:** the highest-frequency new label is `playback_drained` (once per turn,
  ~15–25 per session), not per audio chunk. `speech_started`/`speech_stopped` fire per participant
  utterance. Total added writes are on the order of tens per session against the existing hundreds —
  the store already handled 620 events in one captured session. No batching or sampling needed.
- **Never written:** no audio bytes, no transcript text, no participant PII. Every new field is a
  duration, a count, or an enum. The diagnostic store stays strictly separate from the real
  transcript store, as its own doc comment requires.

**External APIs called:** no new endpoint. The only change to an existing call is the content of the
`turn_detection` block inside the existing `session.update` client event — `idle_timeout_ms` omitted
when `idleTimeoutMs` is `null`. No new vendor, no new credential, no new env var.

**localStorage / sessionStorage:** nothing written or read, before or after this change.

**Client-side in-memory state added** (all per-adapter-instance, all discarded on teardown):
suspension flag, retained-queue accounting, last-drain timestamp, speech-start timestamp, and the
silence timer handle in `WidgetRenderClient.tsx`.

---

## Section 7 — Success Criteria (Acceptance Tests)

**Every criterion is measured from one live widget session's own captured diagnostics**, read via
`GET /api/debug/transcript-read/[clio_session_ref]`, using the `clientMonoMs` field from §6.5.
"It felt better" is explicitly not acceptance. Several prior rounds shipped on a clean build plus a
good-feeling test and regressed.

**Baseline for comparison:** session `444b3ae9-cace-43e3-b5b0-205775e75acc`'s already-captured
diagnostics, for the metrics derivable retroactively from its existing `response_created` /
`response_done` / `tool_call` events. This avoids spending a whole extra live-test cycle purely to
collect a baseline.

### Stage 1 acceptance (§6.1, §6.2, §6.4, §6.5, §6.7)

✓ **AC-1 (desync = 0).** Given a completed live widget session on OpenAI Realtime, when the captured
diagnostics are read, then the count of turns whose first audio byte was queued while playback of the
previous turn was still active — excluding turns triggered by a barge-in — is **exactly 0**.
*Derivation:* for each `response_created`, no preceding `playback_drained` missing before it.

✓ **AC-2 (no dead air).** Given the same session, when every consecutive `turn_gap` is read, then
`max(gapMs) ≤ 3000 ms` and `min(gapMs) ≥ 0`. A negative value would mean the gate did not hold; a
value above 3000 ms would mean the fix traded desync for dead air.

✓ **AC-3 (zero fabricated answers).** Given the same session, then `count(idle_timeout_triggered) == 0`
— proving §6.4a landed — **and** the count of `response_created` events with no `input_committed`
and no client `triggerRecoveryNudge` since the previous `response_done` is **exactly 0**.
*This is the direct, measurable form of "Clio never grades an answer that wasn't given."*

✓ **AC-4 (one utterance per check-in).** Given a session in which `idle_checkin_fired` occurred at
least once, then for every occurrence exactly **one** `response.output_audio_transcript.done` follows
it before the next `speech_started`. Two transcript events for one check-in is a fail.

✓ **AC-5 (silence timer anchored correctly).** Given the same session, then every
`silence_timer_armed` event is preceded by a `playback_drained` event, and the delta between
`playback_drained` and the resulting `idle_checkin_fired` is `15000 ms ± 1500 ms`. This proves the
timer is on the participant clock, not the server clock.

✓ **AC-6 (no gate failures).** Given the same session, then `count(playback_gate_timeout) == 0`.
Any occurrence is an automatic investigation trigger, not a pass with a caveat.

✓ **AC-7 (session length acceptable).** Given a 5-topic session, then total wall-clock duration is
**under 30 minutes** — comfortably inside the existing 60-minute cap, with no change to
`MAX_CALL_DURATION_MS` required. See §Q1 for the derivation.

✓ **AC-8 (meeting-bot provably untouched).** Given the shipped branch, then `git diff` on
`PartnerRenderClient.tsx` is empty, and a meeting-bot session's captured diagnostics still contain
`idle_timeout_triggered` events and show the pre-change turn-creation timing. Regression, not
inspection.

✓ **AC-9 (empty state — participant never speaks at all).** Given a session where the participant
never speaks after the opening, when diagnostics are read, then the session produces repeated
`idle_checkin_fired` events, **zero** `end_session` calls attributable to silence, and terminates
only via the 60-minute cap or a manual end. Silence never closes a session.

✓ **AC-10 (error state — WebSocket drops mid-topic).** Given a `ws_close` with `willReconnect: true`
during playback, when the session resumes, then no `playback_gate_timeout` is emitted for the
interrupted turn and the session continues or fails visibly — it never hangs silently waiting on a
queue that will never drain.

### Stage 2 acceptance (§6.3)

✓ **AC-11 (incidental sounds cost nothing).** Given a live session in which the participant makes
only incidental acknowledgements ("mm-hmm", "yeah") and never deliberately interrupts, when
diagnostics are read, then **every** `barge_in_resolved` has `outcome: 'resumed'` (or
`'resumed_timeout'`), and `sum(discardedMs) == 0`.
*This is the direct, measurable form of criterion 3 — "interrupting Clio doesn't delete the lesson."*

✓ **AC-12 (deliberate interrupts still stop her immediately).** Given a live session with at least
one deliberate spoken interruption, then for each, the delta between `speech_started` and the last
scheduled audio chunk is **under 400 ms** — i.e. no responsiveness was traded away — and
`barge_in_resolved` records `outcome: 'discarded'` with a measured `discardedMs`.

✓ **AC-13 (content loss is bounded and visible).** Given any session, then `sum(discardedMs)` is
recorded and is **strictly less than** the same session's total generated audio for any single
topic. Discarding more than one topic-remainder means the retain logic failed.

✓ **AC-14 (edge — barge-in during the gate).** Given a `speech_started` while §6.1's gate is waiting,
then the gate resolves (drain or discard) rather than waiting the full 180 s, and no
`playback_gate_timeout` is emitted.

### Non-acceptance (stated explicitly)

✗ A clean `npm run build` and `npx tsc --noEmit`. Necessary, never sufficient — three prior rounds
passed both and regressed.
✗ A good-feeling live test with no diagnostic pull.
✗ Absence of a complaint from the tester.

---

## Section 8 — Error States

| Condition | Behaviour | Participant sees |
|---|---|---|
| Playback queue never drains (stuck `AudioBufferSourceNode`) | §6.1's 180 s bound expires → proceed as today → `playback_gate_timeout` | A session that behaves as it does today. Never a hang. |
| WebSocket closes mid-playback | Existing `onclose` reconnect path unchanged. Suspension state and retained queue are cleared on close (a retained queue across a reconnect would play stale audio against new context). | Existing reconnect experience, unchanged. |
| `speech_stopped` never arrives after `speech_started` | B5's 3000 ms safety net resumes the retained queue. | A ~3 s pause, then Clio continues. Never permanent silence. |
| `response.created` never arrives after a long interrupt | B5 resumes. | Clio resumes the explanation rather than going silent. |
| Diagnostic capture POST fails (Redis down, network) | Already best-effort and swallowed (`.catch(() => {})`). Session is unaffected. | Nothing. Acceptance testing for that session is invalidated, not the session itself. |
| `onDiagnostic` not provided by a caller | Optional chaining throughout, as today. All new emissions are no-ops. | Nothing. |
| Silence timer fires while Clio is still generating | Cannot occur — the timer arms only on drain and disarms on `response.created`. If it somehow does, `triggerRecoveryNudge` is non-terminal, so worst case is one extra warm sentence. | At worst, a redundant "no rush." |
| Config field misconfigured / absent | Every new field defaults to today's exact behaviour. A missing field can only produce today's bugs, never a new failure mode. | Today's behaviour. |
| `MAX_CALL_DURATION_MS` fires during a suspended barge-in | Existing path unchanged; the terminal nudge produces a response, which triggers B2 (discard) and proceeds to the goodbye. | A normal goodbye. |

---

## Section 9 — Edge Cases

1. **Very short teaching turn** (a one-sentence topic). Generation may finish *after* playback drains.
   The gate resolves immediately, `gapMs ≈ 0`. No behaviour change. AC-2's lower bound covers this.
2. **Participant speaks the instant Clio finishes.** Playback drains, timer arms, `speech_started`
   disarms it within milliseconds. No check-in. Correct.
3. **Participant speaks during the inter-turn gate.** §6.3's B1 fires and the barge-in machine takes
   over; the gate resolves rather than blocking. Covered by AC-14.
4. **Rapid repeated incidental sounds** ("mm-hmm… yeah… right"). Each triggers B1→B3 independently.
   Cumulative cost is a few short pauses; the queue is never discarded. Worth watching in the Stage 2
   test for a stuttering feel — recorded via consecutive `barge_in_resolved` events so it is
   measurable rather than anecdotal.
5. **First-time vs returning participant.** No difference — this is per-session runtime behaviour with
   no persisted state.
6. **Session with one topic vs. many.** Drift is per-turn-creation, so a one-topic session barely
   drifts today and changes little. Multi-topic sessions are where the fix matters. Both must pass
   AC-1.
7. **B2B-62 multi-language sessions.** All mechanisms here are audio/timing-level with zero text
   parsing — no punctuation or question-terminator assumptions (explicitly the trap v12 flagged for
   Greek `;`, Arabic `؟`, Armenian `՞`). Language-agnostic by construction.
8. **Mobile vs desktop.** No layout difference. `far_field` noise reduction plus a phone speaker in a
   room raises incidental-trip frequency — which §6.3 makes cheap rather than catastrophic. This is
   an argument *for* Stage 2, not a separate case.
9. **Participant mutes their mic mid-session.** `setMicMuted` disables tracks, so no
   `speech_started` fires. The silence timer arms on drain and fires check-ins indefinitely,
   non-terminally. Correct and intended (AC-9).
10. **Slow network / high jitter.** Audio deltas arrive late, so playback drains later, so the gate
    and the timer both shift with them. Anchoring to the participant clock makes the system *more*
    robust to jitter, not less — this is a property of the design, and `clientMonoMs` keeps the
    measurement honest regardless.
11. **Two `speech_started` events with no intervening `speech_stopped`.** Treated as one continuous
    suspension; the duration measurement uses the first `speech_started`. Documented so it is not
    left to implementer judgement.
12. **Model calls `advance_tab` twice in quick succession.** Existing `shouldAdvanceOnTransition` /
    `computeNextProgressIndex` dedup is untouched; each dispatch independently awaits the gate.

---

## Section 10 — Out of Scope

- **`lib/voice/hume-adapter.ts` and every Hume-provider session.** Different provider, different
  playback mechanics, still the default provider. Not touched, not read for behaviour.
- **The meeting-bot channel's behaviour.** Every change is config-gated to default to today's
  behaviour, and AC-8 proves it with a `git diff` assertion. Not in scope to fix or to break.
- **Reverting `widget-prompt-rules.ts` v18.** Ruled out by the CEO; independently re-checked and
  agreed (§6.7). Not specified.
- **Any new npm package.** None is needed; every mechanism uses existing in-file primitives
  (`audioQueue`, `drainQueue`, `waitForPlaybackToFinish`, `triggerRecoveryNudge`, `onDiagnostic`).
- **VAD tuning** (`threshold`, `noise_reduction`, `silence_duration_ms`, `prefix_padding_ms`).
  Considered and rejected with reasoning in §6.3.
- **Resuming the remainder of an interrupted explanation after Clio answers.** Deliberate interrupts
  discard by design (§4.4). Specified as a bounded, measured tradeoff, not an oversight.
- **Sentence-boundary-aware queue trimming.** Rejected as unimplementable — see Q3.
- **Prompt wording changes beyond §6.7's single-utterance check-in.** In particular G5 (the
  filler/tool-preamble rule) stays untouched, per v18's own held Priority-2 sequencing.
- **Changing `MAX_CALL_DURATION_MS`.** §Q1's length analysis shows no change is needed.
- **Removing the temporary diagnostic store/route.** They are load-bearing for this spec's
  acceptance and must outlive it.
- **Folding `WidgetRenderClient.tsx` back into `PartnerRenderClient.tsx`.** Still a separate, later
  decision (B2B-71's own standing note).
- **Responsive/mobile-friendly work.** The standing rule applies to *screens touched*. This change
  alters no rendered output, no layout, no copy visible on screen — the only `WidgetRenderClient.tsx`
  edits are to timers, callbacks and a non-rendered string constant. Rule checked and found not
  triggered; stated explicitly rather than silently skipped.

---

## Section 11 — Open Questions

**None.**

All six of the brief's Questions for BA are answered in the appendix below with reasoning and
rejected alternatives. Two items were candidates for escalation and were resolved instead:

- *Q2's escalation trigger* ("if we cannot still deliver v14's intent, escalate before specifying").
  I confirmed we can. v16 had already removed the "end gracefully" half of v14's intent by Arun's own
  direct instruction — silence never ends a session, only the 60-minute cap does. The surviving
  intent is "wait, then check in," which §6.4's client timer delivers on a *better* signal than v14
  had. No escalation required.
- *Success criterion 7* ("the BA must confirm the resulting session length is acceptable, and flag it
  to the CEO if it is not"). Confirmed acceptable: ~16 min for a 5-topic session, ~25 min at 8 topics,
  against a 60-minute cap. Derivation in Q1. No flag required.

---

## Section 12 — Dependencies

**Must be true before this can be built:**

1. **CEO approval of this document**, then — per the brief's own hard gate — **the approach explained
   to Arun directly, in plain language, before any code is written.** Spec approval is explicitly not
   authorization to build.
2. `openai-realtime-diagnostic-store.ts` and `/api/partner/render/voice-diagnostic-capture` remain
   live. Both are marked TEMPORARY; they must not be removed while this work is in flight.
3. A real Upstash Redis connection in the target environment (`UPSTASH_REDIS_REST_URL` /
   `_TOKEN` non-placeholder). Without it the store mocks to `console.log` and **every §7 acceptance
   criterion becomes unmeasurable.** This is a hard precondition for the QA gate, not for the build.
4. `/api/debug/transcript-read/[clio_session_ref]` remains available (§0.10).
5. A live widget session on `voiceProvider: 'openai_realtime'` with real multi-topic content —
   AC-1/AC-2 cannot be evaluated on a single-topic session (§9.6).
6. Stage 1 shipped, live-tested and measured **before** Stage 2 is built (see Q6).

**Nothing this depends on is unbuilt.** Every primitive already exists in the two files being changed.

**Raised, not silently absorbed (for a separate brief, per §0.7):** the meeting-bot channel runs with
`idle_timeout_ms: 12000` and *no* client handler at all, so Finding 1's fabricated-answer path is
live there with no mitigation whatsoever. This spec deliberately leaves it alone to honour the "not
in scope to fix or to break" constraint. **Recommendation: allocate a follow-on brief.** Once Stage 1
is validated on the widget, the meeting-bot fix is a one-line config change (`idleTimeoutMs: null`)
plus its own live test.

---

# Appendix — The Six Questions

## Q1 — Reconverging the clocks: mechanism and cost

### Does the v16 mechanism close the gap at every turn-creation point?

**No.** I enumerated every point where a new turn can begin:

| # | Turn-creation point | Location | Can a backlog exist? | Gateable client-side? | Disposition |
|---|---|---|---|---|---|
| 1 | Initial `response.create` | adapter `session.updated`, line 460 | No — connect time | n/a | Leave alone |
| 2 | `end_session` no-speech retry | adapter line 611 | Terminal path only | Yes, but pointless | Leave alone |
| 3 | **Tool-dispatch `response.create`** | adapter lines 658–661 | **Yes — the main compounding source, once per topic** | **Yes** | **§6.1 gates it** |
| 4 | `triggerRecoveryNudge()` | adapter line 879 | Yes, today | Yes — by re-anchoring its *trigger* | **§6.4 re-anchors it to playback drain** |
| 5 | **Server auto-response on idle timeout** | server-side, not our code | Yes | **No — ungateable** | **§6.4a removes it at source** |
| 6 | Server auto-response to a committed utterance | server-side | Yes, today | No | **Self-corrects** once 3/4/5 are fixed — the participant can only speak after hearing, so the backlog is already ~0 |

So the v16 mechanism (gating tool dispatch) is **necessary but not sufficient**. Alone it would leave
the server's own idle-timeout responses compounding drift with no client control. This is exactly why
Q1 and Q2 cannot be answered independently, and why §6.1 and §6.4 ship together in Stage 1.

**Alternatives considered and rejected:**
- *Slow generation down (`speed` config, or shorter turns).* Rejected: `speed` is a flat multiplier
  that makes every word uniformly robotic — already tried and reverted 2026-08-01. Shorter turns is a
  product-shape change to teaching delivery, not a timing fix, and v18 deliberately went the other way.
- *Buffer/throttle audio deltas.* Rejected: does not change *when a new turn is created*, only when
  bytes arrive. The drift is a turn-creation problem.
- *Track a client-side "audio debt" counter and inject it into the prompt.* Rejected: reintroduces
  model compliance as the load-bearing mechanism, which is precisely what v10–v14 proved unreliable.

### The v16 mechanism cannot be used as written

**§0.4:** `waitForPlaybackCaughtUp()` delegates to `waitForPlaybackToFinish(timeoutMs = 8000)`. With
an ~80 s backlog it expires after 8 s and proceeds. Using it unmodified would close ~10% of the gap
and read as a failed fix. **§6.1 raises the bound to 180 s at the gated call sites only**, leaving
the meeting-bot's no-argument calls byte-identical. This is a genuinely new finding, not in the brief.

The same defect makes the *visual* advance race ahead by up to 8 s (§0.5, §6.2) — an independent,
previously-untracked contributor to the reported "went to topic 3 without going through topic 2."

### Cost: does it introduce dead air?

**A short natural beat, not dead air.** After the gate releases, the sequence is: `response.create` →
server round trip → first audio byte. Time-to-first-audio on Realtime is sub-second; the whole
response does not need to generate first. Expected gap: **well under ~1.5 s.** AC-2 enforces
≤ 3000 ms, which converts "I believe it will be short" into a measured pass/fail.

This beat is *desirable*: v18 explicitly wanted topic 1 to begin "as its own fresh start, never in
the same breath as the overview." Today that boundary is inaudible because the next turn's audio is
already queued behind the previous one.

**If it does exceed 3000 ms**, the specified handling is: it fails AC-2 and goes back to the CEO — it
is **not** patched by shortening the wait, which would reintroduce the bug.

### Cost: total session length

| Phase | Per unit | 5 topics |
|---|---|---|
| Opening (greeting, icebreaker, wait, overview) | ~75 s | 75 s |
| Teaching a topic (~245 words) | ~100 s | 500 s |
| Verification question + real wait + answer | ~35 s | 175 s |
| Clio's reply to the answer | ~25 s | 125 s |
| Inter-turn beat (§6.1) | ~1.5 s | ~8 s |
| Closing (recap, confirmation, goodbye) | ~90 s | 90 s |
| **Total** | | **~16 minutes** |

At 8 topics: ~25 minutes. Both are comfortably inside the existing 60-minute cap; **no change to
`MAX_CALL_DURATION_MS` is required**, and criterion 7 needs no CEO flag.

**One honest caveat, stated plainly:** sessions will run **longer than today's broken sessions**,
because content currently being discarded by barge-in will actually be delivered. The tested session
lost ≥80 s of topic-1 audio to a single "yeah." That is the fix working, not a regression — but it
should not surprise anyone comparing wall-clock times before and after. Against this, removing the
fabricated idle-timeout turns and duplicate re-asks *removes* real audio. Net effect is roughly
neutral, and AC-7 bounds it at 30 minutes regardless.

---

## Q2 — `idle_timeout_ms`: remove it, or keep it and stand down our own nudge?

**Decision: REMOVE it for the widget channel** (§6.4a). This agrees with the CEO's lean, and I
verified the escalation condition does not apply.

### Why removal, not "keep it and stand down our nudge"

The smaller change was seriously considered and is **rejected on three independent grounds**, any one
of which is sufficient:

1. **It does not fix Finding 1.** The documented behaviour on fire is that the server "commits the
   empty audio segment to the conversation history and triggers a model response," explicitly to let
   the model guess whether VAD missed an utterance. Standing down our nudge removes the *race* but
   leaves the model free to invent an answer — the actual bug. In the tested session it produced a
   confident grading of an answer that does not exist. No prompt wording can reach a turn the server
   generated without consulting our rules. Keeping it means keeping the fabricated-answer path.
2. **We cannot reason about when it fires.** §0.11/§0.12: the documented anchor is
   `response.done + audio playback duration + timeout`, yet the observed fire came 3.19 s after
   `response_done` on a turn carrying ~100 s of audio. That is inconsistent with the formula under any
   reading, including the degenerate one. The documentation itself notes the feature applies to
   "WebSocket connections where the client manages audio playback" — i.e. the transport where the
   server has no playback clock to read — without explaining how the playback term is obtained there.
   **Per the CEO's explicit constraint, I will not design a fix that depends on an unverified reading
   of that formula. Removal is the only option that does not.**
3. **It is an ungateable turn-creation source** (Q1 row 5). Every other source can be gated on the
   participant clock; this one cannot, because it does not pass through our code.

### Can we still deliver what Arun originally wanted from v14?

Yes — and this is the point I checked before committing to removal.

v14's stated intent was *"wait, check again, then end gracefully."* **v16 already removed the "end
gracefully" half, by Arun's own direct instruction** ("silence alone is never a reason to close, no
matter how many times you receive this note"), leaving the 60-minute cap as the only automatic close.
So the surviving intent is **"wait, then check in"** — which §6.4's client timer delivers in full,
identically, and non-terminally.

The deeper concern behind v14 was not "client vs. server" as a preference. It was that **the client
had no reliable signal for when to start waiting**:
- v10 armed on any speaking→listening transition — the server clock, and it caught mid-teaching
  stalls, which ended sessions mid-lesson.
- v11–v13 armed on an `awaiting_answer` tool call — model compliance, confirmed unreliable across
  three consecutive sessions.
- v14 moved to the server precisely to escape both.

**§6.1 creates the signal that never existed: real local playback drain.** It is mechanical, needs no
model cooperation, and is on the participant's clock by definition. Arming on it is strictly better
than any of v10/v11–13/v14. This is not a regression to v14's rejected foundation; it is the option
that was unavailable when v14 was decided.

**No escalation required.**

### Consequences carried into the spec

Removal also, as a free side effect, **makes Finding 3's race impossible rather than rare**: with the
server's auto-response gone and the widget's `idle_timeout_triggered → nudge` wiring dropped (§6.4c),
exactly one code path in the widget can produce a check-in. A coin flip with one side is not a coin
flip. This is why Finding 3 gets no fix of its own — it has no remaining mechanism.

---

## Q3 — Barge-in: what should actually happen? *(genuine product decision)*

**Decision: suspend and retain, then resolve** (§6.3). The two cases the CEO named are handled
**differently**, and I am not collapsing them.

### Why the two cases must be handled differently

At the instant `speech_started` fires, **it is genuinely impossible to know which case this is** —
that information does not exist yet. Any design that must decide at that instant is guessing. So the
design decides *later*, once the evidence exists, and makes the instant-zero action non-destructive
(suspend) rather than destructive (discard). That is the whole idea.

- **Deliberate interrupt** — the participant wants Clio to stop and deal with them. Losing the
  remainder is the correct, expected semantics of interrupting. Nobody expects a lecturer to rewind
  and finish the paragraph after you asked a question.
- **Incidental "mm-hmm"** — the participant is signalling *"I'm with you, keep going."* Losing the
  remainder is precisely the opposite of what they asked for. This is the case the participant
  reported as a skipped subtopic. Note the current input config (`noise_reduction: far_field`,
  `threshold: 0.5`) does trip on these, so this is the common case, not the rare one.

Collapsing them means picking one to get wrong. Today's code collapses them onto "discard" and gets
the common case catastrophically wrong.

### What the participant experiences

**Deliberate interrupt (State D, §5.4):** Clio stops immediately — measurably no slower than today
(AC-12, < 400 ms). She answers. The remainder is discarded once the server begins responding, and the
discarded amount is recorded as `discardedMs`.

**Incidental "mm-hmm" (State C, §5.3):** Clio pauses for roughly half a second to a second, then
picks up exactly where she was. **Nothing is lost.** This is also close to what a human speaker does
on hearing a noise — the pause reads as natural rather than as a glitch.

### Alternatives considered and rejected

| Option | Why rejected |
|---|---|
| **Clear everything** (today) | Deletes the unheard remainder. Note carefully: **Q1 does not rescue this.** Q1 bounds the backlog to *one turn* — but in this product one turn is an entire ~100 s topic, by v18's own deliberate design. A "yeah" 10 s into a 100 s turn still destroys 90 s. **The brief's option "rely on Q1 making today's behaviour correct again" is false for this product and must be rejected explicitly.** |
| **Clear nothing** | Clio talks over the participant and ignores real interruptions. Violates success criterion 6 outright. Trades a real bug for a worse one. |
| **Clear only past the current sentence/utterance boundary** | **Unimplementable without new machinery.** The queue holds raw headerless PCM16 chunks with no text alignment; `response.output_audio_transcript.done` delivers the whole transcript at the end, with no per-chunk timing. There is no mechanical way to locate a sentence boundary in `audioQueue`. Rejected on feasibility, not preference. |
| **Raise the VAD threshold so incidental sounds stop tripping** | Trades a fixed bug for a variable one: a higher threshold risks missing genuinely quiet speech, which is a worse failure than a sub-second pause. And under §6.3 the motivation evaporates — an incidental trip already costs ~0.5–1 s. |
| **Resume the remainder after answering a deliberate interrupt** | Rejected as over-engineering for this round: sequencing retained audio behind a fresh answer risks incoherence, and the model does not know it will happen so it may repeat. `discardedMs` makes the residual loss visible; if measurement shows it matters, it becomes its own brief. |

### The accepted residual, stated plainly

On a deliberate interrupt the remainder is lost, and the model's context believes it taught material
the participant did not hear — the two-clock problem in miniature. This is bounded to at most one
topic-remainder, is the normal semantics of interrupting, and is **measured** (`discardedMs`, AC-13)
rather than assumed away.

---

## Q4 — The one predictable thing on genuine silence

**Decision:** exactly one mechanism, producing exactly one utterance.

> **After 15 seconds of real, participant-clock silence following Clio finishing speaking, Clio says
> one short warm sentence inviting the participant to answer whenever they're ready — and then waits
> again. Non-terminal, always. Identical every time, however many times it happens.**

### Why this survives Q2's answer

It is *because of* Q2's answer that it survives. With `idle_timeout_ms` removed and the
`idle_timeout_triggered → nudge` wiring dropped (§6.4a/c), **only one code path in the widget can
produce a check-in.** There is no second mechanism to race. Had Q2 landed on "keep it and stand down
our nudge," the single behaviour would have been *the server's* — an invitation to the model to guess
that someone spoke, which is not a predictable behaviour at all. The two answers are load-bearing on
each other.

### Fixing the two-utterance problem

Observed failure: the check-in fired correctly and produced **two** output items 13 ms apart —
"Take your time — whenever you're ready" followed by a verbatim repeat of the question.

The cause is structural, not emphasis. Both `IDLE_TIMEOUT_CHECKIN_TEXT` and rule G3 name two speech
acts joined by a conjunction:

> "Check in warmly and briefly… **then continue naturally**: if you had just asked a question, wait
> for their real answer again; if you were partway through explaining something, simply continue from
> where you left off."

This is exactly the `A then B` shape the v12 history identified as reliably **collapsing to A or
doubling into A+B** — and doubling is what happened. Four earlier rounds strengthened the conjunction
and merely traded one direction for the other.

Fix (§6.7): rewrite both to describe **one speech act with no second obligation**, applying v12's
already-proven fusion pattern — one short sentence, explicitly no re-asking, explicitly no resuming,
"then stop and wait," plus v16's never-terminal rule preserved. **Both must change in lockstep**, or
they contradict each other and the GLOBAL RULES bracket's declared precedence resolves the conflict
the wrong way — the exact false-conflict class that caused v18's own primary bug.

**This is explicitly a supporting change, never the primary fix.** Roughly fifteen rounds of wording
changes (v1–v18) failed against mechanical causes. It is in scope only because this specific defect
is genuinely a wording-shape defect with an in-file proven remedy, and because the mechanical half
(one mechanism instead of two) is what actually makes the behaviour predictable.

**On the 15-second value:** v9 used 20 s and v14 used 12 s, but neither was measured from the
participant's clock — v9's fired off mode transitions and v14's off the server's unknown anchor. 15 s
of genuinely *heard* silence is a long conversational pause without reading as abandonment. It is a
single named constant, tunable from one place, and AC-5 verifies it is actually anchored to drain
rather than to anything upstream.

---

## Q5 — How do we know it worked?

Fully specified in **Section 7** as 14 acceptance criteria, every one read off a live session's own
captured diagnostics. The three metrics the CEO named map directly:

| CEO's metric | Measured as | Criterion |
|---|---|---|
| Measured gap between what Clio has said and what the participant has heard | Count of turns beginning while previous playback was still active; plus `turn_gap.gapMs` per turn | **AC-1, AC-2** |
| Count of fabricated-answer events | `count(idle_timeout_triggered)` plus responses created with no `input_committed` and no client nudge since the last `response_done` | **AC-3** |
| Count of discarded-audio events | `barge_in_resolved` outcomes and `sum(discardedMs)` | **AC-11, AC-13** |

### The prerequisite that makes any of this trustworthy

**None of these are measurable with today's instrumentation**, and this is not a detail:

1. `speech_started` / `speech_stopped` / `committed` are not reported at all (or only as bare
   type-name fallthroughs). **The entire input side of every timeline ever pulled from this channel
   has been invisible.** §6.5 fixes this — mandated by the brief regardless of fix shape.
2. Diagnostic `at` is stamped **server-side at the capture route** (§0.9), on independent
   `keepalive` fetches, so ordering and sub-10-second deltas are unreliable. Several criteria above
   depend on sub-second measurements. **§6.5's `clientMonoMs` is therefore a blocking prerequisite,
   not an enhancement** — without it AC-2, AC-5 and AC-12 cannot be evaluated at all.

### Baseline

Session `444b3ae9-cace-43e3-b5b0-205775e75acc`'s existing capture supplies a before-picture for the
retroactively-derivable metrics (`response_created` / `response_done` / `tool_call`), so no extra
live-test cycle is spent collecting one.

### Explicitly not acceptance

A clean build; a clean `tsc`; a live test that felt better; no complaint from the tester. Stated in
Section 7 as non-acceptance because prior rounds shipped on exactly that basis and regressed.

---

## Q6 — Sequencing

**Recommendation: two shipped stages, with a live test and a diagnostic pull between them.**

### Stage 1 — the clock fix (§6.1, §6.2, §6.4, §6.5, §6.7)

Playback-gated turn creation, uncapped visual advance, `idle_timeout_ms` removal, the client
silence timer, the full diagnostics set with client timestamps, and the single-utterance check-in.

**Why these are one stage and cannot be split further:** they are causally one intervention, not a
bundle. You cannot remove `idle_timeout_ms` without replacing the silence signal, and you cannot
anchor the replacement correctly without the playback gate that creates the drain signal. Splitting
them ships a session with no silence handling at all. The diagnostics must land here because they are
how Stage 1 is judged — and how Stage 2 will be judged.

Gate: **AC-1 through AC-10 must pass on a real multi-topic live session** before Stage 2 begins.

### Stage 2 — barge-in (§6.3)

Suspend-and-retain with the B1–B5 resolution machine.

**Why it is separate:** it changes what the participant *experiences* when they speak — a distinct,
independently-observable product behaviour, and the one most likely to need tuning (the 700 ms
threshold, the 250 ms settle, the 3000 ms safety net). It deserves its own clean signal. Bundling it
would mean judging Stage 2 with instrumentation whose own correctness was validated in the same
round. This honours the standing practice in this file's history of not bundling independent
interventions.

Gate: **AC-11 through AC-14**, on a session deliberately exercising both an incidental "mm-hmm" and a
real interruption.

### On the brief's premise that "shipping Q3 without Q1 is actively harmful"

I agree with the **conclusion** and want to correct the **reasoning**, because it affects the split.

The brief's concern was that fixing barge-in without the clock fix would make Clio "ignore
interruptions while an enormous backlog plays out." **That is a hazard of the *clear-nothing* option,
which §6.3 rejects.** Under suspend-and-retain, Clio still stops instantly on every barge-in (B1), so
Stage 2 alone would not be *harmful* — it would simply be **useless**, because the participant would
remain ~90 s behind and every retained-then-resumed chunk would be stale content answering a moment
that has passed.

Same ordering conclusion, better-founded: **Stage 1 first because Stage 2 is meaningless without it**,
not because Stage 2 is dangerous without it. Which also means the split is safe — Stage 1 can ship
and be judged on its own, leaving criterion 3 live for one more round, with the backlog already
bounded to a single turn.

### What ships where

Both stages are widget-channel-only in effect (§6.6), on branch `agent/b2b-74-two-clock-desync`, with
`docs/b2b-pivot-status.md`'s Live Status row updated the instant either stage changes state.

---

## Files Changed

*(The QA gate depends on this section. Every entry states its channel effect.)*

### Stage 1

| File | Change | Channel effect |
|---|---|---|
| `lib/voice/openai-realtime-adapter.ts` | Add `turnPacingMode` config field (default `'immediate'`); gate the tool-dispatch `response.create` on playback drain under `'playback_gated'`; add optional `timeoutMs` to `waitForPlaybackCaughtUp()` / `waitForPlaybackToFinish()`; add `idleTimeoutMs` config field (default `12000`, `null` omits `idle_timeout_ms`); add named cases + `onDiagnostic` emissions for `input_audio_buffer.speech_started` / `.speech_stopped` / `.committed`; add `playback_drained`, `turn_gap`, `playback_gate_timeout` emissions | **Shared file. Widget-only behaviour** — every field defaults to today's behaviour; meeting-bot omits all of them. Diagnostics are additive for both. |
| `app/(with-clerk)/widget-render/[clio_session_ref]/WidgetRenderClient.tsx` | Pass `turnPacingMode: 'playback_gated'` and `idleTimeoutMs: null`; pass the 180 s bound to `advance_tab`'s `waitForPlaybackCaughtUp()`; **remove** the `idle_timeout_triggered → handleIdleTimeoutFired()` wiring; add the drain-armed silence timer + its constant; stamp `clientAt`/`clientMonoMs` on every forwarded diagnostic; rewrite `IDLE_TIMEOUT_CHECKIN_TEXT` to a single speech act | **Widget-only file.** No rendered output changes — see §10 on the responsive standing rule. |
| `lib/voice/widget-prompt-rules.ts` | Rewrite **G3** to a single speech act, in lockstep with `IDLE_TIMEOUT_CHECKIN_TEXT`; add the v19 header history entry; bump `WIDGET_OPENAI_PROMPT_VERSION` to `'widget-v19'` | **Widget-only file.** |
| `tests/unit/openai-realtime-adapter.test.ts` | Extend: gate holds under `'playback_gated'` and is a no-op under `'immediate'`; `idleTimeoutMs: null` omits the key from `session.update` while the default emits `12000`; the three new input diagnostics fire with correct payloads | — |
| `tests/unit/b2b74-turn-pacing-gate.test.ts` *(new)* | The gate's own state machine, including the 180 s bound and the `playback_gate_timeout` path | — |
| `docs/b2b-pivot-status.md` | New Live Status row for B2B-74 | — |

### Stage 2

| File | Change | Channel effect |
|---|---|---|
| `lib/voice/openai-realtime-adapter.ts` | Add `bargeInMode` config field (default `'clear_all'`); implement B1–B5 suspend/retain/resolve; add `barge_in_resolved` emission; scope `pendingAiTranscript` discard to the discard branches only | **Shared file. Widget-only behaviour** — default is today's exact behaviour. |
| `app/(with-clerk)/widget-render/[clio_session_ref]/WidgetRenderClient.tsx` | Pass `bargeInMode: 'suspend_and_resume'` | **Widget-only file.** |
| `tests/unit/b2b74-barge-in-resolution.test.ts` *(new)* | All five B1–B5 transitions, both misclassification directions, and the `discardedMs`/`retainedMs` accounting | — |

### Explicitly NOT changed (assert with `git diff --stat`, per AC-8)

`lib/voice/hume-adapter.ts` · `app/(with-clerk)/partner-render/[clio_session_ref]/PartnerRenderClient.tsx` ·
`lib/voice/openai-realtime-prompt-template.ts` · `lib/voice/openai-realtime-tools.ts` ·
`lib/voice/openai-realtime-persona.ts` · `lib/voice/adapter.ts` (interface unchanged — the new
`timeoutMs` parameter is optional on an already-optional method) · `middleware.ts` ·
any existing test file.

**No npm package is added.** Every mechanism uses primitives already present in the two files changed.
