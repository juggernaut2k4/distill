# Feature Brief: B2B-66 — Marin adaptive-teaching persona (understanding checks, natural delivery, richer signal)

From: CEO (Arun)
To: Business Analyst Agent
Priority: P1
Date: 2026-08-02

**Numbering note:** highest ID in `docs/b2b-pivot-status.md` and `.claude/agents/clio/feature-briefs/`
is B2B-65 (2026-08-01). This brief is **B2B-66**.

---

## What Arun Said (verbatim, from his own message after reviewing a real test call)

> 1. "Marin actually didnt correct my mistakes or explain the concepts if it find my understanding was
>    wrong. Marin is suppose to assess and understand if the audience understand the concept, then if
>    marin finds the audience didnt understand then as a good teacher it should give more information
>    to explain and finally check, if the user understood. if user does not understand then explain
>    more and using different perspective explain to make the audience understand."
>
> 3. "marin was spot on and explained the points directly but it sounded as if it was reading the
>    script. we want marin to explain more so you need to modify the system prompt to explain more
>    detail, it has to assume and act as a teacher. marin cannot just read the content and go, it has
>    to explain the content in her words with little more details including the written content but
>    more examples to align with user's understanding. as questions to assess user knowledge. this
>    info needs to go along to reseller about users maturity on understanding, users next potential
>    intersted topics and sessions. it needs to document what user is interested in knowing and what
>    he is trying to understand in that course based on the questions the user asks."
>
> 4. "you need to modify marin prompt to make it better in explanation, showcase empathy, encourage
>    audience to speak so you can understand users expectations and also users understanding after
>    our course"

Arun then approved: "yes proceed with all the recommended fix" in response to the Orchestrator's
recommendation to route points 1/3/4 through the CEO → BA → Dev chain as a persona/pedagogy rework,
rather than editing the system prompt directly.

**Point 2 of Arun's feedback** ("Marin exited the call before giving a farewell/closing greeting") is
already routed separately as its own technical bug investigation. **Explicitly out of scope for this
brief** — see "What Is NOT Part of This Brief" below.

## Independent verification against live code (done directly, not taken on faith)

I read `lib/voice/hume-native/prompt-template.ts` in full (currently `PROMPT_TEMPLATE_VERSION = 'v13'`)
and cross-checked the Orchestrator's analysis against it and against
`inngest/partner-session-insights-extractor.ts` / `lib/partner/webhooks.ts`. Findings:

1. **Rule 4 today is the exact gap in point 1.** The live text is: *"After teaching a section's core
   content, ask a verification question to confirm understanding before moving on. Listen to the
   answer and respond naturally — affirm what's correct, gently correct what's off, and adapt your
   depth to their response."* This already tells Marin to "gently correct what's off" — but it gives
   her no actual procedure for what "correct" means in practice (re-explain how? from what angle? for
   how long? when to give up and move on?). It reads as an instruction to have good judgment, not a
   teaching loop. **Confirmed: this is the rule to rewrite, not a new rule to bolt on.**
2. **Rule 7 already has exactly the kind of feature-gated, additive hook this brief needs.** Rule 7's
   text ends in a live placeholder, `${PACING_GUIDANCE_PLACEHOLDER}`, resolved by
   `buildPacingGuidance()` — a function gated on `HUME_NATIVE_PACING_GUIDANCE_ENABLED === 'true'`
   that appends an extra sentence of guidance only when the flag is on, otherwise appends nothing
   (byte-identical to today when off). This is the established pattern in this exact file for adding
   new behavioral guidance without a version-forced rewrite of unrelated rules — the "explain more
   before moving on" bound I'm about to set below should be built the same way: additive text behind
   its own named env-gated builder function, not a hand-edited paragraph. **Confirmed real, confirmed
   reusable pattern.**
3. **Rule 11 already asks for a "quick, natural spoken summary... in your own words" per-topic
   transition** — so "don't just read the script" is not a wholly new instruction category; it already
   exists narrowly for transitions. Point 3/4's ask is to extend that "in your own words" instruction
   to the *initial* teaching of a section's content as well, not only the transition out of it.
   **Confirmed: extend an existing instruction pattern, don't invent a new one.**
5. **`learner_insight` extraction already exists and already asks for the right fields.** I read
   `inngest/partner-session-insights-extractor.ts` directly (lines ~60-90): the Claude Sonnet
   extraction call already produces `summary`, `topics_of_interest`, `engagement_style`, and
   `suggested_next_topics`, explicitly instructed not to fabricate and to base every field only on
   "what the transcript actually contains." This is real, already shipped, already dispatched to
   resellers via the `session.insights_ready` webhook (`lib/partner/webhooks.ts`). **Confirmed: point
   3's "document what the user is interested in / their maturity / next topics" ask is a data-quality
   problem (thin transcript → thin extraction), not a missing pipeline.** No new schema, no new
   webhook event, no new reseller-facing UI is required by this brief.
6. **No existing mechanism anywhere in this file evaluates transcribed speech for likely intent behind
   fragmented STT output before treating it as a "wrong answer."** Rule 4's "affirm what's correct,
   gently correct what's off" has no instruction to consider that the participant's actual spoken words
   may have come through the pipeline mangled by speech-to-text. This is a real, currently-unaddressed
   gap, not implied by anything already in the prompt. **Confirmed: needs its own explicit instruction,
   not assumed coverage under an existing rule.**

Verdict: the Orchestrator's framing holds up under direct re-verification of the live prompt file and
the extraction pipeline. Nothing here is rubber-stamped.

---

## The Problem Being Solved

Marin's current behavior, confirmed on a real test call transcript, is closer to "recite the session
script and check a box" than "teach." Concretely, three related gaps:

1. **No real re-teaching loop.** Rule 4 tells Marin to notice when understanding is off and correct it
   "gently," but gives her no actual procedure — no instruction to explain again, from a different
   angle, and re-check. In the reviewed transcript she let a plausibly-wrong answer pass with no
   follow-up at all.
2. **Delivery reads as scripted, not taught.** Marin is accurate but sounds like she is reading
   SESSION CONTENT aloud rather than explaining it as a person would — in her own words, with added
   examples, building on what the participant has already said.
3. **Live conversation doesn't generate rich signal for the downstream insight-extraction pipeline
   that already exists.** The extractor can only surface what's actually in the transcript; a call
   with thin back-and-forth produces thin `topics_of_interest`/`engagement_style`/
   `suggested_next_topics`, even though the extraction logic itself is sound.

The underlying cause is the same in all three: the BEHAVIORAL RULES section optimizes for "cover the
content and keep moving" over "confirm real understanding and adapt." This is a persona/pedagogy
change to the fixed prompt template, not a bug fix — hence the BA gate per `CLAUDE.md`'s governance
model.

## What Success Looks Like

- When a participant's spoken answer to a verification question (Rule 4) indicates a real gap in
  understanding, Marin re-explains the concept once, from a genuinely different angle (a different
  example, a different framing — not the same sentence repeated), then re-checks understanding with a
  new, distinct verification question before moving on.
- When a participant's spoken answer is ambiguous, fragmented, or looks like garbled speech-to-text of
  a reasonable answer, Marin gives the benefit of the doubt rather than "correcting" a probably-fine
  answer — this must be an explicit instruction, not implied.
- Marin's initial teaching of a section (not just her transition language) sounds like a person
  explaining a topic in her own words — using the written content as the factual basis, adding her own
  example or framing, never inventing facts not grounded in that content.
- Marin asks more open, elaboration-inviting follow-ups when a participant engages ("what part of that
  is most relevant to what you're working on?" style, not yes/no), producing richer transcript material
  for the existing `learner_insight` extraction to work with — with no changes to the extraction
  pipeline itself.
- None of this measurably breaks tonight's pacing work (the 30% speed-down, the natural two-stage
  transition markers from B2B-59/60) or the confirmed-working topic-overview/icebreaker opening.
- Session length grows only within a bounded, explicit budget (see below) — it does not silently
  balloon billed voice minutes.

## Known Constraints (from Arun / from standing project rules)

- This is a prompt-template change only (`lib/voice/hume-native/prompt-template.ts`) — no new database
  tables, no new webhook events, no new reseller-facing UI, per the existing `learner_insight`
  pipeline already being sufficient (see verification point 5 above). If the BA's own review surfaces
  a genuine need for one of these, it must be flagged back to me explicitly, not built silently.
- Content accuracy is non-negotiable: Marin may add examples, framing, and her own words, but she may
  never contradict or fabricate facts beyond what SESSION CONTENT and PARTICIPANT CONTEXT actually
  contain — same non-fabrication bar the extractor itself already holds to.
- Tonight's pacing work (Rule 7's `HUME_NATIVE_PACING_GUIDANCE_ENABLED` guidance, the 30% Hume speed
  reduction) and the natural two-stage transition markers (B2B-59/60, Rule 11) are NOT to be rewritten
  or reworded by this brief — this brief's changes must compose additively alongside them, following
  the same feature-gated-additive-text pattern Rule 7 already establishes (see verification point 2).
- The topic-overview/icebreaker opening structure (Rule 1, mode-conditional, already confirmed working)
  is out of scope — do not touch it.
- No changes to tool-calling mechanics (`show_visual`, `advance_tab`, `end_session`) or their existing
  semantics from B2B-58/59/60/41. This brief only changes teaching/delivery/rapport language.

## The Length/Cost Tradeoff — CEO Decision (not left open for the BA)

These are metered, billed voice minutes (`usage.voice_minute` events feed the wallet/billing ledger per
`lib/partner/webhooks.ts` and `docs/b2b-pivot-status.md` B2B-55/57a/57b). "Explain more, check
understanding, re-teach when wrong" directly trades against call-length predictability. I am making
the call rather than leaving it open:

- **At most one re-explanation attempt per section's verification question.** If the participant's
  answer indicates a real gap (giving them the benefit of the doubt per the instruction above), Marin
  re-explains once, from a different angle, asks one new verification question, and then moves on
  regardless of that second answer — she does not loop a third time even if understanding still seems
  shaky. This bounds the worst case to one extra explanation + one extra question per section, not an
  open-ended loop.
- **The added "explain in your own words / add an example" instruction is a delivery-style change, not
  a length mandate** — the BA's spec should frame it as "explain with more depth and Marin's own
  framing," not "always speak longer." A well-explained concept in Marin's own words is not
  automatically longer than reading the script; it should not be assumed to add material time on
  sections where the participant already understands (no verification gap means no re-teach loop
  triggers).
- **This entire behavior set (adaptive re-teach loop + richer-elaboration prompting) should be
  feature-gated the same way Rule 7's pacing guidance already is** — a new env var (name TBD by the
  BA/dev, following the `HUME_NATIVE_*_ENABLED` convention already established), defaulting to
  disabled, so it can be toggled off instantly if a live test shows it running long, without a prompt
  redeploy or rollback of the wording itself.
- The BA should still document expected impact on session length qualitatively in the spec (e.g. "adds
  at most one extra explain+verify exchange per section where understanding was genuinely unclear") so
  this is visible before build, not discovered live.

## What "Richer Signal for the Reseller" Means Here — Explicitly Scoped

Per verification point 5: `inngest/partner-session-insights-extractor.ts`'s `learner_insight` extraction
(summary, topics_of_interest, engagement_style, suggested_next_topics) and its dispatch via
`session.insights_ready` (`lib/partner/webhooks.ts`) already exist, are already correct, and are NOT
being touched by this brief. What this brief changes is upstream of that: Marin asking more elaboration-
inviting questions and engaging more with what the participant says *during the live call*, so the
transcript the extractor reads afterward has more real material to draw from. The BA's spec should
frame this purely as new/adjusted BEHAVIORAL RULES language (encourage-elaboration phrasing, follow-up
question style) — not as any change to the extraction prompt, its schema, or its dispatch mechanism.

If the BA's review finds a genuine reason the extraction pipeline itself also needs a change to benefit
from richer transcripts, that must be flagged back to me as new scope, not folded in silently.

## What the BA's Requirement Document Must Define (no open questions allowed)

1. **Rewritten Rule 4 (or an added sub-rule)** — full text for: benefit-of-the-doubt handling of
   ambiguous/fragmented spoken answers; the one-re-explanation-then-move-on bound; what "a genuinely
   different angle" means as an instruction (e.g. explicitly instruct a new example or analogy, not a
   rephrased repeat of the same sentence); the new verification question after re-explaining.
2. **Delivery-style instruction** — where it lives (Rule 3 and/or a new rule), exact wording for
   "explain in your own words, grounded in the written content, with your own added example — never
   just read it verbatim," with an explicit non-fabrication guardrail tied to SESSION CONTENT/
   PARTICIPANT CONTEXT.
3. **Empathy/elaboration-encouraging instruction** — exact wording for warmer acknowledgment of what
   the participant says and open-ended (not yes/no) follow-up questions that invite them to elaborate
   on their own understanding/expectations, feeding the existing `learner_insight` extraction with
   richer source material.
4. **Feature-gating mechanism** — name and default (disabled) for the new env var(s), following the
   `HUME_NATIVE_PACING_GUIDANCE_ENABLED`/`buildPacingGuidance()` pattern in
   `lib/voice/hume-native/prompt-template.ts`, and confirmation of `PROMPT_TEMPLATE_VERSION`'s next bump
   number.
5. **Interaction with existing rules** — explicit confirmation, rule-by-rule, that Rule 1 (opening),
   Rule 5/Rule 11/B2B-59/60's transition mechanics, Rule 7's pacing guidance, and Rule 8/13's closing
   sequences are unchanged in mechanics (wording collisions checked, e.g. do not let the new "ask more
   elaboration questions" instruction blur into Rule 8's "anything else before we wrap up?" closing
   loop).
6. **Acceptance criteria / examples** — at least one worked example transcript snippet showing: (a) a
   correct-benefit-of-the-doubt case (fragmented STT of a fine answer, not "corrected"), (b) a genuine-
   gap case (one re-explain, new check, then move on regardless), (c) a "just read the script" delivery
   before/after comparison for the same piece of SESSION CONTENT.
7. **Edge cases** — participant gives no answer / says "I don't know" to a verification question;
   participant's second (post-re-explain) answer is also unclear (confirm: still move on, no third
   loop); very short sections where a full re-teach cycle would dominate the section's own length.
8. **Test plan** — how this is verified before shipping wording changes to a live voice prompt (this
   codebase's own history — LIVE-01, B2B-48, B2B-52, B2B-58/59/60 — shows voice/prompt changes reliably
   need a live-call verification pass, not just `tsc`/build/vitest; the spec should say explicitly that
   a real or demo live-call listen-through is required before this is considered done, consistent with
   how B2B-58/59/60 each carried a "live-session voice verification still pending" caveat until an
   actual call happened).

Section 11 (Open Questions) of the BA's Requirement Document must be empty before this proceeds to a
developer. If anything above cannot be resolved by the BA alone, escalate it back to me — do not guess.

## What Is NOT Part of This Brief

- **The missing-goodbye/early-exit bug** (Arun's point 2) — already tracked and handled as its own
  separate technical investigation. Do not fold it into this spec or this build.
- **Any new database schema, new webhook event, or new reseller-facing UI.** Per verification point 5,
  the existing `learner_insight`/`session.insights_ready` pipeline is sufficient for what this brief
  asks. If the BA disagrees after full review, that is a flag back to me, not silent scope expansion.
- **Rewriting or reworking Rule 7's pacing guidance, the 30% Hume speed setting, or the B2B-59/60
  transition-marker mechanics.** This brief adds new behavioral instructions alongside that work, it
  does not touch it.
- **Rule 1's mode-conditional opening/icebreaker structure.** Confirmed working, out of scope.
- **Any change to tool-calling mechanics** (`show_visual`/`advance_tab`/`end_session` semantics).

---

## Dispatch

Routed to the Business Analyst Agent now for a complete Requirement Document (all 12 sections, Section
11 empty) against everything specified above. No prompt-template code is touched until that spec is
written and I have reviewed and approved it, per the standing CEO → BA → Dev gate. I will pay particular
attention, when reviewing the BA's draft, to whether the re-teach bound and the benefit-of-the-doubt
instruction are written as precise, literal prompt language (not left as vague intent for a developer
to interpret) — per the project's "ambiguous UX/behavior = STOP, document fully" rule, the same
standard applies here even though the "screen" in question is a system prompt, not a UI.
