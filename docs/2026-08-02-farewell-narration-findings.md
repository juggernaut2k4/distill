# 2026-08-02 — Farewell/end_session investigation findings

Running notes from live test calls verifying the B2B-68/B2B-69 single-document OpenAI prompt
rebuild's farewell fix. No code changes made from these findings yet — investigation only, per
Arun's explicit instruction.

## Tracking — renumbered 2026-08-02 for closure

Single sequential list, replacing the earlier mixed "item 1/2/3" + "Arun's issue 2-7" numbering.
Update this table's Status the instant any item changes state.

| # | Item | Status | Detail |
|---|------|--------|--------|
| 1 | Farewell/`end_session` fires without a real spoken goodbye | **Open** — the #7 fix below (unblocking advance_tab's tool result) shares its root mechanism; needs a live test call to confirm whether it also resolved this one | §1, §2 below |
| 2 | Meta-narration guard not holding ("let's"/"let me" still leak through) | **Open** — survived two prompt-fix rounds (B2B-67, B2B-68); not touched by tonight's build | §1, §2 below |
| 3 | Connect-time warm-up (voice racing / screen blur) | **Built** 2026-08-02 — tsc/build/tests clean | §3, Issue 3 |
| 4 | Icebreaker too small | **Built** 2026-08-02 — tsc/build/tests clean | §3, Issue 4 |
| 5 | Reseller-configurable bot join-name | **Built** 2026-08-02 — tsc/build/tests clean | §3, Issue 5 |
| 6 | Bounded re-teach loop + code-enforced correctness gate | **Built** 2026-08-02 — needs a live test call to confirm real-world behavior before calling it fully closed | §3, Issue 6; §4; §5; §6; §7 |
| 7 | Transition-detection reliability + dead-air on tool calls | **Built** 2026-08-02 — needs a live test call to confirm real-world behavior before calling it fully closed | §3, Issue 7; §5; §6; §7 |
| 8 | Meeting-bot admission prompt (Google Meet/Teams/Zoom) | **Backlog, not priority** — deferred until #7 closes, moved to `BACKLOG.md` | §3, Issue 2; `BACKLOG.md` |

## 1. claude-ai test call (session `3eae41bf-68a7-400b-b953-36100dd94d42`, 2026-08-02 ~13:15–13:26 UTC)

**Arun's own observation, live:** after Marin summarized the session, the farewell did not happen —
he believes she called `end_session` right after summarizing, without an actual spoken goodbye.

**Corroborating evidence found:**
- The captured transcript ends right at Marin's final "Is there anything else on your mind before
  we wrap up?" question (rule 8b) — no captured response from Arun, no captured farewell turn after
  it.
- `webhook_dispatch_log` shows `session.completed` fired at `13:26:10.557Z` — only **~4.8 seconds**
  after that last captured question (`13:26:05.741` local turn timestamp). That is not enough time
  for a real back-and-forth (participant answering "no, that's all" → Marin delivering the
  two-sentence summary → Marin saying an actual goodbye) to happen as distinct, natural spoken
  turns.
- Conclusion: this is not just a transcript-capture gap (as earlier sessions' endings might have
  been) — the elapsed-time evidence itself supports Arun's direct observation that the real closing
  sequence was rushed or skipped, not merely uncaptured.

**Also observed in this same transcript (topic-transition narration, separate from the farewell
issue):** the "never announce, just do it" guard added to rule 11 in B2B-68 blocks the literal
phrases "let me" / "I'll" / "I'm going to" right before an action — but Marin used **"let's"**
instead ("Let's quickly straighten that out and then keep building from there," "Let's build on
that and move to choosing models") — same narrating-the-transition habit, different phrasing that
slips past the specific words currently blocked. One instance of the older "let me" pattern also
still appeared ("Let me pull together the last piece.").

**Separately, a possible opening-timing issue:** Marin's icebreaker line cut off mid-sentence
("Quick icebreaker: this session"), the participant said "Oh," and Marin restarted the entire
greeting from scratch. Not something touched by tonight's changes — flagged for awareness, not
diagnosed.

## 2. OOP-fundamentals test call (session `eb613ede-aa59-48e7-9db8-9a5986d66aca`, 2026-08-02 ~13:29–13:39 UTC)

**Farewell/end_session — same bug, and the timing evidence is even more damning here:**
- The transcript's actual final AI line is: *"That's a solid summary. Let me close this out and make sure
  there's nothing else you want to cover."* — captured at `13:38:41.088Z`.
- That line is not a real spoken farewell, and it is not even a direct question — it's Marin narrating
  her own next move ("let me close this out") instead of just asking "is there anything else?" outright.
  No captured user response follows it, no captured goodbye follows it. The transcript simply ends there.
- `webhook_dispatch_log` shows `session.completed` fired at `13:38:42.263Z` — only **~1.2 seconds** after
  that line. That is not enough time for the participant to even answer the implied question, let alone
  for a real close (participant answers → Marin delivers a goodbye → end_session). 1.2 seconds is
  consistent with `end_session` being called immediately after that narrated line, with no farewell
  actually spoken.
- This is a stronger version of the same finding from item 1 (there it was ~4.8s with a real question
  asked; here it's ~1.2s and the "question" itself was narrated rather than asked directly).

**Meta-narration — confirmed still broken, including the literal blocked phrase "let me":**
Every one of the 6 topic transitions in this call follows the same rigid template — an affirmation,
then a narrated transition, then the verbatim line **"That covers what I wanted to walk through here."**
before the next topic's content. The narrated transitions:
- "Let's build from that and move into the next core idea."
- "Let's keep going and connect it to how we protect that state."
- "let's build on that and talk about what we choose to show versus what we hide"
- "Let's take that forward into the next concept."
- **"Let me bring that forward into the next idea."** — this is the literal "let me" phrasing rule 8c/11
  is supposed to block, appearing plainly mid-session, not just at the farewell.
- "Let's tie everything together with the bigger picture."
- And the closing line itself: **"Let me close this out..."**

So both evasions are present: "let's" (the rephrasing that slipped past the specific-word block in item 1)
and the originally-blocked "let me" itself (meaning the block isn't reliably firing at all, not just being
routed around). The identical verbatim scripted-sounding line before every section ("That covers what I
wanted to walk through here") also corroborates Arun's original observation #3 — "it sounded as if it was
reading the script."

**New issue, not previously documented — mid-session silence gaps:** the participant had to prompt Marin
back to life three separate times mid-call:
- "OK, I think you are in inheritance, but you're not speaking. What happened?"
- "Cleo, are you there?"
- "See you. You went silent again. Can you continue?"

Each followed a topic-transition line, suggesting a multi-second dead-air gap between the transition
narration and the next section's content (possibly a tool-call/latency gap with no filler speech to
bridge it). Not something tonight's changes touched — flagged as a distinct, separate issue for
awareness, not diagnosed. **See item 7 below — the CEO agent traced this to the same root cause as
Arun's issue #7.**

## 3. Six additional issues Arun identified directly (2026-08-02), CEO agent analysis — no code changes yet

Arun's own numbering preserved (his "1" was a separate item handled elsewhere). Each entry:
what's going on, proposed fix, confidence, build path.

### Issue 2 — bot admission in Google Meet ("unverified" knock prompt)
**What:** Both meeting-bot providers (Attendee.dev, the current default in `lib/meeting-bot/attendee.ts`,
and Recall.ai, kept as rollback in `lib/recall.ts`) join a meeting as an anonymous guest via the raw
meeting URL. Neither authenticates as a trusted Google identity, so Meet's "Quick access"/knock gate
treats the bot like any unknown participant.
**Fix:** not a code fix — the lever is the Google Meet host/Workspace setting ("Quick access" /
disabling host management removes the knock prompt for everyone, bot included). No vendor API flag on
either platform pre-authorizes a bot identity into Meet.
**Confidence:** medium — grounded in how both integrations actually join, but no live vendor-doc deep
dive done yet to confirm neither has an allowlist feature.
**Build path:** not a code problem — host-side Google Workspace config; worth a line in partner
onboarding docs.

### Issue 3 — initial voice racing / screen blur, needs a warm-up
**What:** `PartnerRenderClient.tsx` renders real content the instant it mounts — connection `status`
is tracked but never gates visibility. Voice starts playing the moment the first audio chunk arrives,
no pre-buffer.
**Fix:** add a full-screen loading state gated on `status === 'connecting'` (hide content until
"listening"/connected), plus a short gain fade-in (~300ms) on first audio chunk in both voice adapters.
**Confidence:** high on root cause (no gating exists today); medium on whether this fully resolves the
"blur" feeling, since meeting-bot screen capture may have its own contributing factors.
**Build path:** ready to build directly — pure technical/UX polish, no BA gate needed.

### Issue 4 — icebreaker too small
**What:** The production-default ("template" mode) prompt variant has no icebreaker instruction beyond
"open warmly" — it jumps straight to the scripted overview. The fuller icebreaker Arun describes only
exists in the unused-by-default "inline" variant, and even there it's optional, not mandated.
**Fix:** rewrite the template-mode opening rule in both `lib/voice/openai-realtime-prompt-template.ts`
and `lib/voice/hume-native/prompt-template.ts` to require: greet → ask how they're doing, tied to the
topic → brief encouragement/confidence note → wait for response → then the existing scripted overview.
**Confidence:** high — clean, verifiable gap.
**Build path:** ready to build directly — narrow prompt-copy fix, does not touch transitions/advancement.

### Issue 5 — reseller-configurable bot name
**What:** `assistantDisplayName` (partner theme field) is already fully wired for the *spoken* persona
in both prompt templates. The only gap is the bot's *join name* in the meeting — hardcoded to `'Clio'`
(`lib/meeting-bot/attendee.ts:65`) and `'Clio AI Coach'` (`lib/recall.ts:56`), neither reads the
partner's theme.
**Fix:** thread `assistantDisplayName` through the dispatch call chain (`lib/partner/session-init.ts`
has the session ref but not the theme lookup today) into `createBot`'s `bot_name` param for both
providers, falling back to "Clio." Also confirmed: "responds when called by name" already works
implicitly — the model is told "You are {assistantName}," which is sufficient for it to respond when
addressed.
**Confidence:** high — clean, fully-traced wiring gap.
**Build path:** ready to build directly — pure wiring; the reseller-facing field already exists and is
approved.

### Issue 6 — bounded re-teach loop on wrong answers
**What:** Already built. `buildAdaptiveUnderstandingGuidance()` (both templates, gated on
`HUME_NATIVE_ADAPTIVE_TEACHING_ENABLED`, confirmed on in production) does most of this: benefit of the
doubt on garbled STT → if genuinely wrong, re-explain once from a different angle → ask a new
verification question → then moves on regardless of the second answer.
**Gap vs. Arun's ask:** he wants it to keep going until the participant gets it right, not cap at one
re-explanation and move on anyway. Real, specific difference — not a bug.
**Confidence:** high that the feature exists and is live; medium on the exact fix, since a truly
unbounded loop risks getting stuck if a participant never gets it.
**Build path:** narrow prompt-copy tweak, ready to build directly — but the exact cap (CEO agent's
proposal: two re-explanations max, three attempts total, then move on) is a small product call worth
Arun confirming rather than guessing silently.

### Issue 7 — silence after a transition whose phrasing misses the marker format
**What:** Traced to a real mechanism, not a phrasing/prompt gap alone. `advance_tab`'s handler in
`PartnerRenderClient.tsx` awaits `adapterRef.current?.waitForPlaybackCaughtUp?.()` *before* returning
its result — and in `openai-realtime-adapter.ts`, that result gates sending `function_call_output` +
the follow-up `response.create` back to OpenAI. Every transition forces the model to wait (bounded by
an 8-second timeout) before it's allowed to keep talking. If the local audio queue doesn't drain
cleanly, that's up to 8s of dead air by design — matching exactly where the OOP transcript went silent
(right after transition lines, at the inheritance transition and the topic's last page — see item 2
above).
**Fix:** split the two responsibilities — return the tool result (unblocking `response.create`)
immediately, let the visual page-advance + its playback-catch-up wait run separately, fire-and-forget.
Touches only `inlineTools.advance_tab` in `PartnerRenderClient.tsx` and the OpenAI adapter's tool-dispatch
path. Does **not** touch `firedMarkers` dedup or `ADVANCE_DEBOUNCE_MS` in `lib/partner/advance-transition.ts`
— the protected B2B-59/60 logic from the confirmed-good milestone (commit `dcda410`) stays untouched.
**Confidence:** medium-high — the code path is real and explains the symptom, but not yet reproduced
live, so a second contributing factor isn't ruled out.
**Build path:** ready to build directly as a narrow, isolated adapter fix — but given it sits right next
to the B2B-58/59/60 milestone, do a live test-call verification pass immediately after building, before
calling it closed. Same discipline as the other narrow fixes, not a full BA spec.

## 4. Decisions and refinements (2026-08-02, after reviewing the analysis)

**Issue 2 — answered, not a build.** Host/Workspace-side Meet config, confirmed similar (but not
identical) levers exist for Teams and Zoom too — Teams explicitly still gates *detected bots* even when
lobby-bypass is open to invitees; Zoom's Waiting Room has no bot exception at all, only a blanket
disable. Meet is the most workable of the three via calendar-invite "confirmed user" status. No code
change associated with this item.

**Issues 3, 4, 5 — approved to build.** Holding all three (and the rest) until every item 1–7 has a
final go-ahead — do not start dev work yet.

**Issue 6 — redesigned per Arun's follow-up, not yet finalized:**
- Replace the flat "re-explain once, then move on" cap with: re-explain from a different angle, then if
  still wrong, restate the concept in simpler/more basic terms, repeating with progressively simpler
  phrasing — up to 5 total attempts.
- After 5 failed attempts: gracefully defer ("we can cover this in a separate session next time") and
  advance to the next page — do not get stuck.
- New distinct case: if the participant is silent (no answer at all, not a wrong answer), treat it as a
  likely audio/connection issue rather than a wrong answer — say something like "I can't hear you, let's
  reconnect once that's sorted," then end the session.
- Open dependency to verify before spec/build: does the current voice pipeline (OpenAI Realtime / Hume
  adapters) have any existing "no speech received within N seconds" signal distinct from "speech
  received but wrong/garbled"? Not confirmed yet — needs a check before this can be built as described.
- Also: the graceful "end session" branch depends on the same `end_session`/farewell mechanism that
  items 1 and 2 above show is currently unreliable — this branch inherits that risk until the farewell
  fix lands.
- Not yet confirmed: exact attempt count (5), exact copy for the defer/silence messages. Recommend a
  short BA note before build, given this introduces new numeric thresholds and new spoken copy (same
  weight as B2B-66's original adaptive-teaching spec).
- **Third branch added (2026-08-02):** garbled/unintelligible speech (present but not understandable),
  distinct from total silence. If this repeats, gracefully say something like "I'm having trouble
  understanding you clearly" and end the session — same graceful-exit treatment as the silence case,
  different trigger (speech detected but not parseable, vs. no speech at all).
- **Code-level correctness gate, not just a prompt instruction (2026-08-02):** confirmed by reading the
  actual code — there is currently NO code-side flag or state anywhere tracking "topic complete" or
  "verification passed." `advance_tab` takes zero parameters and its only instruction is "call this
  when — and only when — you judge the current section is fully covered." The reason follow-up
  questions are handled correctly today is not a real gate — it's just that the model naturally keeps
  answering them instead of reaching for the tool. Given tonight's repeated evidence that prompt-only
  behavioral rules get violated (the narration guard, twice, and the skipped transition phrase in item
  7), trusting free-form model judgment alone for "did they answer correctly" carries the same risk.
  **Recommended fix:** make `advance_tab` require an explicit signal of the verification outcome (e.g.
  a `verification_passed: boolean` parameter, or a small separate reporting tool), and have the code
  refuse the transition unless that's true — or the attempt-cap graceful-defer condition has been
  reached. This is a small, narrow code change (widening a currently-empty tool schema + one
  precondition check) and does not touch the protected B2B-59/60 debounce/dedup logic.

**Issue 7 — deferred.** Arun wants items 1–6 finalized first before revisiting this one; no further
explanation attempted yet.

## 5. Issue 7 deep-dive (2026-08-02) — root cause refined, fix plan agreed

**How the page-advance signal actually works (B2B-60):** each page's prompt carries its own stage
direction: say the fixed phrase *"That covers what I wanted to walk through here"* → naturally say the
next page's title → only then call the `advance_tab` tool. The client arms on the fixed phrase (Stage
1), then watches for the next title (Stage 2) before trusting the transcript signal — this is a
"natural cue" system, not literal marker words (correcting an earlier draft of this doc that assumed
made-up marker words were meant to be spoken — they are not, since B2B-60 replaced that design; they
now exist only as an internal dedup key).

**What happened at the Inheritance transition, confirmed against the actual code and transcript:**
Marin never said the required fixed phrase for this transition — she said "Let's take that forward
into the next concept" instead (the same family of narration-substitution seen in items 1/2) and went
straight into Inheritance content without it. Since Stage 1 never armed, the transcript-watch signal
could never fire for this transition, confirmed by reading the exact client logic (`stage1ArmedRef`
gates Stage 2 entirely). The page still visually advanced (per Arun's own observation), meaning
`advance_tab` was called directly.

**Why the silence lasted ~60s, not just ~8s:** the `waitForPlaybackCaughtUp` wait has a hard-coded
8-second cap (confirmed by reading `waitForPlaybackToFinish` in `openai-realtime-adapter.ts` — polls
every 100ms, cuts off at exactly `timeoutMs`), so a single call to it cannot explain a 60+ second gap
on its own. The 8s-wait bug (already scoped for a fix above) is real and worth fixing regardless, but
it is not the full explanation for this specific incident — skipping the scripted phrase most likely
left Marin without a clear next line to say, and she only recovered once Arun spoke to her directly.
No server-side logs exist for this (the whole mechanism runs client-side in the browser/bot, not a
Vercel function), so this is the best-evidenced explanation available, not a certainty.

**Fix plan (3 parts) — pending Arun's go-ahead to build:**
1. **Unblock the tool result** (already scoped above): return `advance_tab`'s result immediately
   instead of waiting on playback catch-up; run that wait separately, fire-and-forget. Removes the
   artificial 8s-cap dead air regardless of cause. High confidence, narrow, doesn't touch B2B-59/60's
   protected debounce/dedup logic.
2. **Reinforce the per-page script instruction** so skipping the fixed phrase is less likely — same
   category of fix as the narration guard, and that guard has now failed twice, so treat this as
   raising the odds, not a guarantee.
3. ~~An automatic self-recovery nudge (blind silence-timer watchdog)~~ — **rejected by Arun**: "i
   dont incline on this timer approach." Superseded by §6's tool-call + correctness-flag design below,
   which detects readiness-to-advance directly instead of guessing from elapsed silence.

See §6 for the finalized design that replaces point 3 above and also folds in item 6.

## 6. FINALIZED plan — items 6 and 7, unified (2026-08-02)

Arun's own proposal, refined through discussion, replaces both the fixed-phrase transcript-watch
detection (item 7) and the standalone correctness-gate idea (item 6) with one mechanism. Confirmed
ready to build, pending only the final go-ahead across all approved items (3, 4, 5, 6, 7).

### The core idea — FINALIZED as a two-step design (option 2, 2026-08-02)
Stop trying to detect "is she ready to move on" by listening for exact wording. Treat it the same way
`end_session` already works in this codebase — a dedicated, explicit tool call is the only thing that
counts, never inferred from her spoken words. Refined from the original single-combined-call idea to a
**two-step** version after Arun asked how correctness actually gets validated (there's no built-in
"OpenAI grades this" feature — it's always the same conversational model's judgment; the real design
question is when/how it commits to that judgment):

- **New tool, `record_verification_result`** — called immediately after the participant answers a
  page's verification question, in its own dedicated reasoning moment, *before* any thought of
  advancing. Parameter: `result: 'correct' | 'incorrect' | 'garbled'`. This call never moves the page —
  it only records the outcome.
- **`advance_tab` stays gated on that record**, not on her wording. It only succeeds if the current
  page's most recent recorded result is `correct`, or the attempt cap has been reached (see below —
  functionally a `capped` state). The fixed phrase ("That covers what I wanted to walk through here")
  can stay as natural-sounding flavor text but is no longer what the system depends on for detection —
  eliminating the "trigger text mismatch" failure mode entirely.
- **Why two steps instead of one:** deciding correctness and deciding to advance in the same breath (the
  original plan) risks her rationalizing "correct" just because she's already leaning toward moving on.
  Forcing the correctness judgment into its own call, right when she hears the answer, decouples it from
  that impulse. Same underlying model, no added network round-trip or live-call latency — just a
  cleaner separation of the two decisions. A fully independent second-model grading call was also
  considered and rejected — it would add a real pause in the live conversation to fix a dead-air
  problem, working against the goal.

### Handling a premature or invalid `advance_tab` call
If she calls `advance_tab` without a `correct`/capped record for the current page (shouldn't happen per
instructions, but this is exactly the category of instruction-slip seen twice already tonight): the code
does **not** advance the page, and — per Arun's explicit decision — does **not** stay silent about it
either. The tool result explicitly tells her the transition didn't happen and to continue on the *same*
topic (option 2 from the earlier silent-vs-explicit discussion, confirmed over silently ignoring it).
Reasoning: whatever the code returns from a tool call is her only window into what actually happened —
if it says nothing, she has no way to know the page didn't move, and could start talking about the
*next* topic's content while the screen is still on the current one (a real display/speech desync risk,
worse than the original bug). Telling her explicitly avoids that.

### Tradeoff, disclosed to Arun directly
Splitting this into two calls does not make her judgment itself more reliable — she could still record
`correct` when the user actually got it wrong, the same way she's bent other instructions tonight. What
it does do: (1) moves the signal from freeform prose (proven fragile — skipped entirely at the
Inheritance transition) into a small structured field, which models are simply more consistent at
filling in correctly than matching exact wording, and (2) separates the correctness judgment from the
"should I move on" impulse by giving it its own dedicated moment, reducing (not eliminating) the
rationalization risk. The downside is still bounded regardless: worst case, she over-reports `correct`,
the participant struggles on a later question, and it plays out downstream from there — never a silent,
invisible failure like tonight's transcript showed.

### Silence and garbled-speech handling (item 6, finalized)
Both attempt counters below are tracked by the code, keyed off `record_verification_result` calls for
the current page (reset per page):
- **Wrong-but-understandable answer** (`result: 'incorrect'`): re-explain from a different angle, then
  progressively simpler phrasing, up to **5 total attempts**. On the 5th `incorrect`, the code treats
  the page as capped — `advance_tab` is allowed to succeed even without a `correct` record — and she
  wraps up gracefully (draft copy below).
- **Total silence** (no response at all after a direct question): the platform already fires an
  `input_audio_buffer.speech_started` event whenever real speech is detected (confirmed in
  `openai-realtime-adapter.ts`), so "she asked, nobody said anything at all" is measurable off an
  existing signal — no new capability needed, and no `record_verification_result` call happens at all
  in this case (there's nothing to grade). Threshold: **~12 seconds** of nothing after a direct question
  (within Arun's "10–15s, even ok to go longer to really confirm" guidance) before treating it as a
  likely audio/connection issue and ending the session gracefully (draft copy below). This is a
  narrowly-scoped timer for one specific, meaningful moment — not the general blind watchdog Arun
  rejected in §5.
- **Garbled/unintelligible speech** (`result: 'garbled'`, present but not parseable): tracked as its own
  counter, separate from the wrong-answer counter, since it's a different underlying signal (possible
  audio/connection problem, not just a hard question). Threshold: **2 attempts**, then end the session
  gracefully (draft copy below) rather than continuing to guess.

### Draft copy (Arun: "no need to get my approval specifically for each sentence" — drafted directly, in Marin's established natural/warm voice, no self-narrating "let me/I'll" language per the existing farewell rule)

**Graceful topic defer (after 5 wrong attempts, session continues):**
> "No worries — this one's dense. Let's park it here and make sure we come back to it properly in a
> future session. For now, let's keep moving."

**Silence / likely audio issue (ends the session):**
> "I haven't been able to hear anything for a little while, so I don't want to keep talking to an
> empty room. If something's off with your mic or connection, no worries at all — reconnect whenever
> it's sorted and we'll pick this back up properly. Talk soon."

**Garbled speech (ends the session):**
> "I'm having a hard time understanding you clearly right now — might be a connection or audio quality
> thing. Rather than keep guessing, let's reconnect once that's sorted so we can actually have this
> conversation properly. Talk soon."

### Still separate and still needed (unrelated to the above, already agreed)
Unblocking `advance_tab`'s tool result from the playback-catch-up wait (returning immediately instead
of waiting up to 8s) — this is independent plumbing that reduces dead air regardless of cause, and
stays in the build plan alongside the above.

### What this does not touch
The B2B-59/60 debounce/dedup logic (`firedMarkers`, `ADVANCE_DEBOUNCE_MS` in
`lib/partner/advance-transition.ts`) stays completely untouched — this design changes what triggers a
transition, not the protection against a transition firing twice.

Awaiting Arun's final go-ahead to build (items 3, 4, 5, 6, 7 together).

## 7. Build complete (2026-08-02) — items 3, 4, 5, 6, 7

Built directly per the finalized designs above, after Arun's go-ahead ("yes go ahead and build all
of it"). `npx tsc --noEmit`, `npm run build`, and the full `vitest` suite are all clean (one
pre-existing, unrelated failure confirmed via `git stash` — `tests/unit/voice-gap-watchdog.test.ts`,
a `minutes_ledger` mock gap in `lib/session-billing.ts`, untouched by any of tonight's work).

**Item 3 — connect-time warm-up:** `PartnerRenderClient.tsx` now shows a loading overlay
(`showConnectWarmup`) until voice actually connects (or a 6s safety-net timeout, so a stuck
connection never traps the participant behind a blank screen), plus a ~300ms gain fade-in on the
first audio chunk in both `openai-realtime-adapter.ts` and `hume-adapter.ts`.

**Item 4 — icebreaker:** rewrote the opening rule in both `openai-realtime-prompt-template.ts` and
`hume-native/prompt-template.ts` (both template and inline variants) to require asking how the
participant is doing, tied to the topic, plus a short encouragement note, before the existing
overview/agenda flow.

**Item 5 — reseller bot name:** `assistantDisplayName` (already wired into the spoken persona) now
also threads through to the meeting-bot's own join name — `MeetingBotProvider.createBot()` gained an
optional `botDisplayName` param, used by both Attendee.dev and Recall.ai, looked up via
`getThemeConfig()` at both dispatch call sites in `app/api/partner/v1/sessions/route.ts`.

**Items 6/7 — verification gate + dead-air fix (OpenAI Realtime only):**
- New `record_verification_result` tool (`correct` / `incorrect` / `garbled`), called the moment
  Marin hears an answer, tracked per-page by the client (`PartnerRenderClient.tsx`) with the agreed
  caps (5 wrong-answer attempts, 2 garbled attempts).
- `advance_tab` now only succeeds against a `correct` or capped record for the current page;
  a premature call is told explicitly to continue the same topic, per the display/speech-desync
  reasoning from the design discussion.
- `advance_tab`'s tool result is no longer blocked on the playback-catch-up wait — it returns
  immediately; the wait and the actual page move now run fire-and-forget.
- New silence-after-a-turn safety net: a ~12s timer (armed on `onModeChange('listening')`, cleared on
  real speech via the new `onUserSpeechStarted` adapter callback) triggers
  `triggerRecoveryNudge()` — a new adapter method that injects a system instruction and forces an
  immediate response — so Marin proactively delivers the graceful audio-issue closing instead of
  waiting indefinitely.
- `lib/voice/openai-realtime-prompt-template.ts`'s rule 4/5 and adaptive-teaching guidance rewritten
  to describe this new flow; Hume's template is deliberately left untouched (its tools are
  Hume-hosted-dashboard-configured, out of reach for this build) — rules 4/5 now intentionally
  diverge between the two files, documented inline and in the updated tests.
- Does **not** touch the protected B2B-59/60 debounce/dedup logic
  (`lib/partner/advance-transition.ts`) — confirmed unchanged.

**Files touched:** `app/(with-clerk)/partner-render/[clio_session_ref]/PartnerRenderClient.tsx`,
`app/api/partner/v1/sessions/route.ts`, `lib/voice/adapter.ts`, `lib/voice/openai-realtime-adapter.ts`,
`lib/voice/hume-adapter.ts`, `lib/voice/openai-realtime-tools.ts`,
`lib/voice/openai-realtime-prompt-template.ts`, `lib/voice/hume-native/prompt-template.ts`,
`lib/meeting-bot/types.ts`, `lib/meeting-bot/attendee.ts`, `lib/meeting-bot/recall.ts`, `lib/recall.ts`,
`lib/partner/session-init.ts`, plus test updates across `tests/integration/partner-sessions-api.test.ts`
and 8 unit test files (mock/assertion updates to match the intentional changes above, no test
coverage removed).

**Not yet done:** a live test call to confirm items 6/7 actually eliminate the dead air and correctness
gate correctly in practice — code-level verification only so far. Recommend one before calling those
two items fully closed.

