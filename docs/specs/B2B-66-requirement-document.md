# Marin Adaptive-Teaching Persona (Understanding Checks, Natural Delivery, Richer Signal) — Requirement Document
Version: 1.0
Status: DRAFT
Author: Business Analyst Agent
Date: 2026-08-02

---

## 0. Re-verification of the CEO Brief's Claims (done before writing anything below)

Per this project's standing rule that specs must be grounded in real code (see `docs/specs/B2B-63-requirement-document.md`
§0 and `docs/specs/B2B-64-requirement-document.md` §0 for the pattern), every load-bearing claim in
`.claude/agents/clio/feature-briefs/B2B-66-marin-adaptive-teaching-persona.md` was re-checked directly
against source, not taken on faith:

- **`lib/voice/hume-native/prompt-template.ts` read in full, confirmed `PROMPT_TEMPLATE_VERSION = 'v13'`**
  (line 15). Confirmed exact current text of every rule this document touches:
  - **Rule 3** (lines 203–205): *"For every section in SESSION CONTENT, call the show_visual tool at the
    moment you begin covering that section, before you start speaking about it substantively. Pass the
    section's index as instructed in the content."* — purely a tool-timing instruction; contains no
    instruction at all about *how* to explain the content once show_visual has fired. Confirmed: this is
    where a delivery-style instruction has to live, since no other rule governs initial-teaching delivery.
  - **Rule 4** (lines 206–209): *"After teaching a section's core content, ask a verification question to
    confirm understanding before moving on. Listen to the answer and respond naturally — affirm what's
    correct, gently correct what's off, and adapt your depth to their response."* — confirmed this is the
    exact gap the CEO brief identifies: it tells Marin to have good judgment, with no procedure for what
    "correct" means, no re-explanation step, no re-check, and no instruction to distinguish a real
    misunderstanding from garbled speech-to-text. Confirmed as the rule to extend additively.
  - **Rule 5** (lines 210–215): confirmed unchanged/untouched — the "call advance_tab when you judge a
    section is complete... a few seconds either way is completely fine" language is compatible with a
    bounded re-teach loop happening *before* that judgment is made; nothing here needs to change.
  - **Rule 6** (lines 216–223): confirmed unchanged/untouched — this governs the participant raising an
    unprompted off-topic/complex question mid-session and deferring it. Confirmed distinct in subject and
    trigger from this brief's new elaboration-inviting follow-up (which fires as part of Marin's own
    verification-question exchange, not in response to the participant raising something off-topic) — no
    wording overlap risk if phrased carefully (§5 below states this explicitly).
  - **Rule 7 and `PACING_GUIDANCE_PLACEHOLDER`/`buildPacingGuidance()`** (lines 224, 475–483): confirmed
    exact mechanism — `process.env.HUME_NATIVE_PACING_GUIDANCE_ENABLED === 'true'` gate, defaults to
    disabled (any other value, including unset, resolves to `''`), appended as extra sentences at the end
    of Rule 7's existing fixed text via string concatenation inside the template literal, referenced via
    `.split(PLACEHOLDER).join(builtText)` inside `assembleHumeNativePrompt()`. **Confirmed: this is the
    exact reusable pattern this document's new instructions must follow** — append-only, additive,
    byte-identical when the flag is off.
  - **Rule 8/Rule 12** (lines 228, 262, plus `RULE_1_TEMPLATE_TEXT`/`RULE_1_INLINE_TEXT`,
    `RULE_8_TEMPLATE_TEXT`/`RULE_8_INLINE_TEXT`, `RULE_12_TEMPLATE_TEXT`/`RULE_12_INLINE_TEXT`, lines
    436–456): confirmed mode-conditional per `sessionContentMode`, resolved by
    `resolveSessionContentMode()`. Confirmed unchanged and untouched by this document — the CEO brief's
    "do not touch the opening/icebreaker structure" instruction covers Rule 1; Rule 8/12's closing
    mechanics are separately out of scope per the brief and confirmed here not to need any change for this
    document's purposes.
  - **Rule 9, 10** (lines 250–254): confirmed unchanged/untouched, no interaction with this document's
    changes.
  - **Rule 11** (lines 255–261): confirmed exact current text: *"Before moving from one topic to the
    next, give a quick, natural spoken summary of what you just covered in this topic — one or two
    sentences, in your own words — before beginning your bridge to the next topic... This is a distinct
    transition checkpoint from the final two-sentence closing summary described in rule 8..."* — confirmed
    this is a **transition-out** recap, a distinct moment from the **initial teaching** of a section's
    content this document's Rule 3 addition targets. Confirmed no rewording of Rule 11 itself is needed or
    proposed — the two "own words" instructions (Rule 11's existing transition recap, this document's new
    Rule 3 addition) are complementary and non-overlapping in *when* they apply, not duplicative.
  - **Rule 13** (lines 263–279): confirmed unchanged/untouched, no interaction with this document's
    changes — governs participant-initiated call-ending only.
  - **`PromptBehaviorConfig`/`buildPartnerGuidanceBlock()`** (lines 113–120, 415–427): confirmed
    `verificationQuestionStyle` is rendered as *"The style and frequency of verification questions (rule 4
    above): ..."* and `interSectionRecapStyle` as *"The style and length of inter-section recaps (rule 11
    above): ..."*. Both reference rule 4 and rule 11 **by topic**, not by exact wording — confirmed both
    references remain fully valid after this document's changes, since rule 4 is still fundamentally "ask
    a verification question, listen, respond" and rule 11 is untouched entirely. No partner-guidance code
    needs to change.
  - **Module header comment** (lines 10–13): confirmed the file's own stated convention — *"Bump
    PROMPT_TEMPLATE_VERSION on any structural edit to the fixed portion."* This document's two new
    placeholders are a structural edit (new placeholder constants + new template text), so
    `PROMPT_TEMPLATE_VERSION` bumps `v13 -> v14` regardless of the new flag's default-off state — matching
    the precedent already set by, e.g., B2B-36 F5's `PACING_GUIDANCE_PLACEHOLDER` addition, which itself
    bumped the version despite defaulting off.
- **`inngest/partner-session-insights-extractor.ts` — `learner_insight` extraction fields, confirmed by
  direct read (lines ~60–90, matching the CEO brief's own citation).** The Claude Sonnet extraction call
  already produces `summary`, `topics_of_interest`, `engagement_style`, `suggested_next_topics`, with an
  explicit non-fabrication instruction ("base every field only on what the transcript actually contains").
  Confirmed: no schema, prompt, or code change needed here — this document changes only what happens
  *live*, upstream of this extraction, so the extractor has richer transcript material to work with. This
  file is not touched anywhere in this build.
- **`lib/partner/webhooks.ts` — `session.insights_ready` dispatch, confirmed present and untouched by this
  document** (grep-confirmed export exists; not modified by anything specified below).
- **Env var naming convention, confirmed by direct grep across the repo** (matching the pattern
  `docs/specs/B2B-64-requirement-document.md` §0 already established for a different flag): server-only
  boolean gates in this codebase use `<FEATURE>_ENABLED` checked via strict `=== 'true'` (default
  disabled) — `HUME_NATIVE_PACING_GUIDANCE_ENABLED` (`lib/voice/hume-native/prompt-template.ts` line 476)
  and `HUME_NATIVE_SUMMARY_MODE` (`app/api/hume-native/provision-config/route.ts` line 71) both confirmed
  present and both using this exact `=== 'true'`/default-disabled shape. This document's new flag,
  `HUME_NATIVE_ADAPTIVE_TEACHING_ENABLED`, follows the same convention exactly (§6).
- **No existing mechanism anywhere in `prompt-template.ts` evaluates STT-plausibility before treating an
  answer as wrong, confirmed by full-file read.** Nothing in Rule 4 or elsewhere references speech-to-text
  noise, transcription artifacts, or "benefit of the doubt." Confirmed: this is a genuinely new instruction
  this document must write in full, not an existing behavior being merely surfaced (§4, §6).
- **No transcript excerpt is quoted verbatim anywhere in the CEO brief.** The brief describes, in prose,
  that on a real reviewed call Marin let a plausibly-wrong answer pass with no follow-up, and that her
  delivery sounded like she was reading SESSION CONTENT aloud. It does not include the literal transcript
  text. The worked examples in §5/§7 below are therefore explicitly labeled as **constructed illustrative
  examples matching the described failure mode**, not verbatim quotes from the reviewed call — flagged
  here so a developer or QA reader does not mistake them for an actual transcript excerpt.

Nothing in the CEO brief was found to be inaccurate. This document resolves every item the brief asks the
BA to define, with Section 11 empty.

---

## 1. Purpose

On a real test call, Marin (Clio's Hume-native voice persona) exhibited three related pedagogy gaps,
confirmed against the actual transcript by Arun directly: she let a plausibly-wrong understanding-check
answer pass with no correction or re-teaching; her delivery of SESSION CONTENT sounded like she was
reading a script rather than teaching a person; and the live conversation surfaced too little of what the
participant actually thinks or wants, starving the already-correct `learner_insight` extraction pipeline
of material to work with.

The root cause, confirmed in `lib/voice/hume-native/prompt-template.ts`, is that Rule 4 — the only rule
governing what happens after Marin asks a verification question — instructs good judgment ("gently
correct what's off") without any actual procedure: no instruction to re-explain, no instruction to
re-check, no bound on how many times to try, and no instruction to distinguish a real misunderstanding
from a speech-to-text artifact. Separately, no rule anywhere instructs Marin to explain content in her own
words rather than close to verbatim — Rule 11 already does this narrowly for the recap *between* topics,
but nothing does it for the *initial* teaching of a section.

What failure looks like without this: Marin continues to behave as a content-reciting checkbox-ticker
rather than a teacher — participants with real gaps in understanding are never caught or corrected,
delivery continues to read as scripted rather than taught, and every reseller's `learner_insight` payload
stays thinner than it should be, understating what Clio's coaching sessions could actually reveal about a
participant's understanding and interests.

## 2. User Story

As **a session participant** being taught a section by Marin,
I want Marin to notice when my answer to her verification question shows I didn't really understand, and
to explain it again — differently, not just repeated — before moving on,
So that I actually understand the material by the end of the section, not just that Marin asked and I
answered something.

As **a session participant** whose spoken answer comes through mangled by speech-to-text but is actually a
fine answer,
I want Marin to give me the benefit of the doubt rather than "correcting" me for a transcription artifact,
So that I'm not repeatedly re-taught material I already understood, which would waste my time and feel
patronizing.

As **a session participant** listening to Marin teach,
I want her explanations to sound like a person teaching me — in her own words, with an example — rather
than a script being read aloud,
So that the session feels like real coaching, not a recitation.

As **the reseller** receiving `partner_session_insights` webhook payloads,
I want the live conversation to surface more of what the participant actually thinks, asks, and wants,
So that `topics_of_interest`, `engagement_style`, and `suggested_next_topics` reflect real signal, not a
thin transcript with too little material to draw from.

As **Arun (product owner)**, evaluating whether this change is safe to enable,
I want the entire behavior set gated behind a single, off-by-default environment variable,
So that it can be toggled off instantly if a live test shows a problem, without a prompt-wording rollback
or redeploy.

(No end-user-facing screen exists or is created by this feature — see §4.)

## 3. Trigger / Entry Point

- **No new route, page, or user action.** This is a system-prompt-only change to
  `lib/voice/hume-native/prompt-template.ts`, specifically to the fixed BEHAVIORAL RULES text assembled by
  `assembleHumeNativePrompt()` and delivered once, upfront, at the start of every Hume-native live session
  (`NEXT_PUBLIC_HUME_NATIVE_ENABLED` gate, unchanged, unaffected by this document).
- **Runtime trigger for the new behavior itself:** entirely inside the live voice conversation, the moment
  Marin (per existing Rule 4) asks a verification question after teaching a section's core content, and
  the participant responds (or doesn't). No external system call, no tool call, no database read triggers
  this — it is pure in-context LLM behavior driven by the assembled prompt text.
- **Required state for the new instructions to have any effect at all:**
  `HUME_NATIVE_ADAPTIVE_TEACHING_ENABLED === 'true'` (server-side env var, read inside
  `buildAdaptiveDeliveryGuidance()`/`buildAdaptiveUnderstandingGuidance()`, §6). Any other value (unset,
  `'false'`, any other string) means both new placeholders resolve to `''` — byte-identical output to
  today's v13 template for every existing caller, exactly as `HUME_NATIVE_PACING_GUIDANCE_ENABLED` already
  behaves for Rule 7.
- **Composes independently of `HUME_NATIVE_PACING_GUIDANCE_ENABLED` and `HUME_NATIVE_SUMMARY_MODE`** — all
  three are independent boolean env vars read separately, with no shared state and no ordering dependency;
  any combination of on/off across all three produces a well-defined, independently-composable assembled
  prompt.

## 4. Prompt/Behavior Flow Description

No UI screen exists for this feature (it is a system-prompt change), so this section documents the exact
sequence of model-facing instructions and the conversational flow they produce, in place of a UI flow.

**4.1 — Exact current wording (v13) of the two rules being extended**

> **Rule 3 (today, verbatim):** "For every section in SESSION CONTENT, call the show_visual tool at the
> moment you begin covering that section, before you start speaking about it substantively. Pass the
> section's index as instructed in the content."

> **Rule 4 (today, verbatim):** "After teaching a section's core content, ask a verification question to
> confirm understanding before moving on. Listen to the answer and respond naturally — affirm what's
> correct, gently correct what's off, and adapt your depth to their response."

**4.2 — Exact proposed new wording (additive, appended to the end of each rule's existing text, only when
`HUME_NATIVE_ADAPTIVE_TEACHING_ENABLED === 'true'`)**

Appended to the end of Rule 3 (delivery-style — "own words" for initial teaching, non-fabrication
guardrail):

> "When you begin covering a section's content, do not read it verbatim as written — explain it in your
> own words, the way a person teaching the material would: restate the core idea in natural spoken
> language, and add at least one of your own supporting examples, analogies, or illustrations grounded in
> what SESSION CONTENT and PARTICIPANT CONTEXT actually establish. Never introduce a fact, statistic, or
> claim that SESSION CONTENT does not support. This changes how you explain the material, not how much of
> it you cover — a well-explained section is not automatically longer than reading the script, and a
> section the participant already understands does not need extra length just because this instruction is
> active."

Appended to the end of Rule 4 (adaptive re-teach loop, benefit-of-the-doubt, elaboration-inviting
follow-up):

> "When you listen to their answer, first judge whether it plausibly reflects real understanding — keep
> in mind that speech-to-text can turn a perfectly fine answer into something that sounds fragmented,
> incomplete, or oddly worded, so give the participant the benefit of the doubt on phrasing and disfluency,
> and only treat an answer as a genuine gap in understanding when its substance, not just its wording, is
> actually wrong or clearly confused. If the answer plausibly reflects understanding — even if awkward,
> partial, or odd-sounding due to likely transcription noise — affirm it naturally and move on; do not
> re-teach. If the answer indicates a real gap in understanding, or the participant gives no answer, says
> "I don't know," or otherwise indicates they didn't follow — re-explain the concept exactly once, from a
> genuinely different angle than your first explanation (a new example, a new analogy, or a different
> framing — never simply the same sentence rephrased), then ask one new, distinct verification question to
> check understanding again. Whatever their answer to that second question, move on afterward regardless —
> do not re-explain a third time even if understanding still seems shaky; simply let the session continue.
> Separately from this understanding check, look for a natural moment to invite them to elaborate with an
> open-ended question — for example, asking what part is most relevant to their own situation, or what
> they're hoping to get out of this topic — rather than relying only on yes/no questions, so the
> conversation surfaces more of what they actually think and want."

**4.3 — Conversational flow this produces (feature enabled)**

1. Marin begins a section (Rule 3): calls `show_visual`, then explains the content in her own words with
   an added example, grounded in SESSION CONTENT/PARTICIPANT CONTEXT — never inventing facts.
2. She asks a verification question (Rule 4, unchanged trigger condition).
3. She listens to the answer and judges plausibility, giving benefit of the doubt for likely STT noise.
4. **Branch A — plausible/correct:** she affirms naturally and proceeds toward Rule 5's advance_tab
   judgment. No extra exchange.
5. **Branch B — genuine gap (including no answer / "I don't know"):** she re-explains once, from a
   different angle, asks one new verification question, and — regardless of that second answer — proceeds
   toward Rule 5's advance_tab judgment. No third attempt, ever.
6. At a natural point in this exchange, she may ask one open, elaboration-inviting follow-up question
   (not a yes/no question) to learn more about the participant's own situation or interest.
7. Rule 5 (unchanged) governs when she actually calls `advance_tab` — her own judgment on timing, "a few
   seconds either way is completely fine," same as today.

**4.4 — Conversational flow when the feature flag is off (default)**

Byte-identical to today's v13 behavior: Marin asks a verification question, responds naturally, uses her
own unguided judgment on what "gently correct" means, with no re-teach procedure, no benefit-of-the-doubt
instruction, and no explicit "own words" instruction for initial teaching (Rule 11's existing transition
recap is the only "own words" instruction that applies, exactly as today).

## 5. Visual Examples

No UI screens exist for this feature. In their place, per this project's established convention for
prompt-only specs (`docs/specs/B2B-63-requirement-document.md` §5), this section shows the exact
before/after prompt text and worked conversational examples a developer can use to verify correct behavior.

**5.1 — Rule 3, prompt text before/after (flag ON; byte-identical to "before" when flag OFF)**

```
BEFORE (v13, always):
  3. For every section in SESSION CONTENT, call the show_visual tool at the
     moment you begin covering that section, before you start speaking about
     it substantively. Pass the section's index as instructed in the content.

AFTER (v14, flag ON only — appended, nothing removed):
  3. For every section in SESSION CONTENT, call the show_visual tool at the
     moment you begin covering that section, before you start speaking about
     it substantively. Pass the section's index as instructed in the content.
     When you begin covering a section's content, do not read it verbatim as
     written — explain it in your own words, the way a person teaching the
     material would: restate the core idea in natural spoken language, and
     add at least one of your own supporting examples, analogies, or
     illustrations grounded in what SESSION CONTENT and PARTICIPANT CONTEXT
     actually establish. Never introduce a fact, statistic, or claim that
     SESSION CONTENT does not support. This changes how you explain the
     material, not how much of it you cover — a well-explained section is
     not automatically longer than reading the script, and a section the
     participant already understands does not need extra length just
     because this instruction is active.
```

**5.2 — Rule 4, prompt text before/after (flag ON; byte-identical to "before" when flag OFF)**

```
BEFORE (v13, always):
  4. After teaching a section's core content, ask a verification question to
     confirm understanding before moving on. Listen to the answer and respond
     naturally — affirm what's correct, gently correct what's off, and adapt
     your depth to their response.

AFTER (v14, flag ON only — appended, nothing removed):
  4. After teaching a section's core content, ask a verification question to
     confirm understanding before moving on. Listen to the answer and respond
     naturally — affirm what's correct, gently correct what's off, and adapt
     your depth to their response. When you listen to their answer, first
     judge whether it plausibly reflects real understanding — keep in mind
     that speech-to-text can turn a perfectly fine answer into something
     that sounds fragmented, incomplete, or oddly worded, so give the
     participant the benefit of the doubt on phrasing and disfluency, and
     only treat an answer as a genuine gap in understanding when its
     substance, not just its wording, is actually wrong or clearly confused.
     If the answer plausibly reflects understanding — even if awkward,
     partial, or odd-sounding due to likely transcription noise — affirm it
     naturally and move on; do not re-teach. If the answer indicates a real
     gap in understanding, or the participant gives no answer, says "I don't
     know," or otherwise indicates they didn't follow — re-explain the
     concept exactly once, from a genuinely different angle than your first
     explanation (a new example, a new analogy, or a different framing —
     never simply the same sentence rephrased), then ask one new, distinct
     verification question to check understanding again. Whatever their
     answer to that second question, move on afterward regardless — do not
     re-explain a third time even if understanding still seems shaky; simply
     let the session continue. Separately from this understanding check,
     look for a natural moment to invite them to elaborate with an
     open-ended question — for example, asking what part is most relevant to
     their own situation, or what they're hoping to get out of this topic —
     rather than relying only on yes/no questions, so the conversation
     surfaces more of what they actually think and want.
```

**5.3 — Worked conversational examples**

*(All four examples below are constructed to match the failure modes and success criteria described in
the CEO brief — they are illustrative, not verbatim quotes from the actual reviewed call, which was
described in prose only; see §0.)*

**(a) Genuinely wrong answer — re-teach fires once, then moves on regardless of the retry:**

```
Marin:  [Rule 3] "So the idea here is that an AI model doesn't 'understand' the
        way a person does — it's predicting the most likely next word based on
        patterns in huge amounts of text. Think of it like an extremely
        well-read assistant who's read every book in the world but has never
        actually lived through any of it — it can talk convincingly about grief
        or leadership without ever having felt or done either."
Marin:  [Rule 4] "Does that distinction make sense — prediction versus real
        understanding?"
Participant: "Yeah, so it's basically like... it has its own opinions on stuff
        because it read so much, right?"
Marin:  [judged: genuine gap — this restates the opposite of the point] "Not
        quite — let me put it a different way. Imagine a translator who's
        memorized millions of sentence pairs between two languages, but has
        never learned either language's grammar or meaning — they can produce
        fluent-sounding translations without any actual comprehension. The
        model doesn't have opinions of its own; it's surfacing the most
        statistically likely response based on patterns, not a personal
        viewpoint. Does that version land better?"
Participant: "Oh — so it's more like really good pattern-matching, not actual
        beliefs."
Marin:  [second verification answered better, but re-teach bound is already
        used — move on regardless per the instruction] "Exactly the right
        instinct. Let's move on to how that shapes where it's reliable versus
        where it isn't."
```

**(b) Garbled-but-plausible answer (STT noise) — no re-teach triggers:**

```
Marin:  [Rule 4] "Does that make sense — why we'd want a human to review any
        AI-drafted client communication before it goes out?"
Participant: "yeah cause like — it doesn't — it doesn't know if it's actually
        right for like — for the client, the actual person"
Marin:  [judged: fragmented but substantively correct — benefit of the doubt,
        no re-teach] "Exactly — it can't judge whether the tone or facts
        actually fit this specific client's situation. Good instinct. Let's
        move on to when a quick human check is enough versus a full review."
```

**(c) "Just read the script" delivery, before/after, same SESSION CONTENT:**

```
SESSION CONTENT excerpt: "AI hallucination refers to a model generating
confident, fluent output that is factually incorrect or fabricated, without
any signal to the user that it might be wrong."

BEFORE (flag OFF — reads close to verbatim):
Marin: "AI hallucination refers to a model generating confident, fluent
        output that is factually incorrect or fabricated, without any signal
        to the user that it might be wrong."

AFTER (flag ON — own words, added example, same underlying fact, no
invented claims):
Marin: "Here's something that catches a lot of leaders off guard: these
        models can sound completely confident while being completely wrong —
        and there's no little warning light that comes on to tell you that.
        I've seen this called 'hallucination' — it's basically the model
        fabricating a fact and delivering it with the same fluent, assured
        tone it uses for something true. So confidence in the delivery
        is never itself a signal of accuracy."
```

**(d) Feature flag OFF — byte-identical to today's v13 behavior:**

```
Given HUME_NATIVE_ADAPTIVE_TEACHING_ENABLED is unset (or any value other than
the exact string 'true'):
  assembleHumeNativePrompt(...) output for Rules 3 and 4 is byte-for-byte
  identical to v13's assembled output — confirmed by construction, since both
  new placeholders resolve to '' (§6), exactly mirroring how
  HUME_NATIVE_PACING_GUIDANCE_ENABLED already guarantees byte-identical output
  for Rule 7 when off.
```

## 6. Data Requirements

This is a prompt-template-only change. No database table is read or written, no new API is called, no
`localStorage`/`sessionStorage` is used, and no new schema is introduced — consistent with the CEO brief's
explicit constraint (§0, §10).

**New env var** (add to `.env.local.example` with a `PLACEHOLDER_`-convention comment, matching
`RTV_MARKER_GENERATION_ENABLED`'s and `HUME_NATIVE_PACING_GUIDANCE_ENABLED`'s existing documentation
style):

```
# B2B-66 — Marin adaptive-teaching persona: real understanding-check/re-teach loop (benefit-of-the-doubt
# on garbled STT, one bounded re-explain-and-recheck attempt), "own words" delivery for initial teaching
# (not just Rule 11's existing transition recap), and elaboration-inviting follow-up questions. Unset or
# any value other than the exact string 'true' = disabled (current default) — byte-identical to
# pre-B2B-66 (v13) output for Rules 3 and 4. Set to 'true' to enable.
HUME_NATIVE_ADAPTIVE_TEACHING_ENABLED=false
```

**`PROMPT_TEMPLATE_VERSION`:** bump `'v13' -> 'v14'` (structural edit to the fixed template per the file's
own module-header convention, §0).

**New placeholder constants** (in `lib/voice/hume-native/prompt-template.ts`, alongside
`PACING_GUIDANCE_PLACEHOLDER` and the other existing placeholder exports):

```ts
/**
 * B2B-66 — additive, own-words delivery instruction for a section's initial teaching (distinct from
 * Rule 11's existing transition-recap "own words" instruction). Resolves to '' unless
 * HUME_NATIVE_ADAPTIVE_TEACHING_ENABLED is the literal string 'true' (default OFF, byte-identical to
 * pre-B2B-66 output).
 */
export const ADAPTIVE_DELIVERY_PLACEHOLDER = '[ADAPTIVE DELIVERY GUIDANCE]'

/**
 * B2B-66 — additive, bounded adaptive re-teach loop + benefit-of-the-doubt + elaboration-inviting
 * follow-up instruction, appended to Rule 4. Resolves to '' unless
 * HUME_NATIVE_ADAPTIVE_TEACHING_ENABLED is the literal string 'true' (default OFF, byte-identical to
 * pre-B2B-66 output).
 */
export const ADAPTIVE_UNDERSTANDING_PLACEHOLDER = '[ADAPTIVE UNDERSTANDING GUIDANCE]'
```

**Template edits** (Rules 3 and 4 inside `HUME_NATIVE_PROMPT_TEMPLATE`):

```ts
3. For every section in SESSION CONTENT, call the show_visual tool at the
   moment you begin covering that section, before you start speaking about
   it substantively. Pass the section's index as instructed in the content.${ADAPTIVE_DELIVERY_PLACEHOLDER}
4. After teaching a section's core content, ask a verification question to
   confirm understanding before moving on. Listen to the answer and respond
   naturally — affirm what's correct, gently correct what's off, and adapt
   your depth to their response.${ADAPTIVE_UNDERSTANDING_PLACEHOLDER}
```

**New builder functions** (co-located with `buildPacingGuidance()`, same file, following its exact
self-contained pattern — each reads the flag independently, mirroring the existing convention rather than
threading a shared boolean through the call chain):

```ts
/**
 * B2B-66 — additive, toggleable "explain in your own words, with an example" instruction for a
 * section's initial teaching. Read exactly once inside assembleHumeNativePrompt() below, so every
 * caller picks it up with zero additional wiring — mirrors buildPacingGuidance()'s exact toggle
 * mechanism. Default OFF: any value other than the literal string 'true' resolves to '', byte-identical
 * to pre-B2B-66 output.
 */
function buildAdaptiveDeliveryGuidance(): string {
  const enabled = process.env.HUME_NATIVE_ADAPTIVE_TEACHING_ENABLED === 'true'
  if (!enabled) return ''
  return ' When you begin covering a section\'s content, do not read it verbatim as written — explain ' +
    'it in your own words, the way a person teaching the material would: restate the core idea in ' +
    'natural spoken language, and add at least one of your own supporting examples, analogies, or ' +
    'illustrations grounded in what SESSION CONTENT and PARTICIPANT CONTEXT actually establish. Never ' +
    'introduce a fact, statistic, or claim that SESSION CONTENT does not support. This changes how you ' +
    'explain the material, not how much of it you cover — a well-explained section is not automatically ' +
    'longer than reading the script, and a section the participant already understands does not need ' +
    'extra length just because this instruction is active.'
}

/**
 * B2B-66 — additive, toggleable bounded adaptive re-teach loop (benefit-of-the-doubt on garbled STT,
 * exactly one re-explanation-from-a-different-angle attempt, then move on regardless) plus an
 * elaboration-inviting follow-up instruction, appended to Rule 4. Same toggle mechanism as
 * buildAdaptiveDeliveryGuidance() and buildPacingGuidance() — both new functions are gated on the same
 * single flag, read independently in each, so there is no risk of the two resolving inconsistently
 * within a single assembled prompt (the env var does not change mid-request). Default OFF: byte-identical
 * to pre-B2B-66 output.
 */
function buildAdaptiveUnderstandingGuidance(): string {
  const enabled = process.env.HUME_NATIVE_ADAPTIVE_TEACHING_ENABLED === 'true'
  if (!enabled) return ''
  return ' When you listen to their answer, first judge whether it plausibly reflects real ' +
    'understanding — keep in mind that speech-to-text can turn a perfectly fine answer into something ' +
    'that sounds fragmented, incomplete, or oddly worded, so give the participant the benefit of the ' +
    'doubt on phrasing and disfluency, and only treat an answer as a genuine gap in understanding when ' +
    'its substance, not just its wording, is actually wrong or clearly confused. If the answer plausibly ' +
    'reflects understanding — even if awkward, partial, or odd-sounding due to likely transcription ' +
    'noise — affirm it naturally and move on; do not re-teach. If the answer indicates a real gap in ' +
    'understanding, or the participant gives no answer, says "I don\'t know," or otherwise indicates ' +
    'they didn\'t follow — re-explain the concept exactly once, from a genuinely different angle than ' +
    'your first explanation (a new example, a new analogy, or a different framing — never simply the ' +
    'same sentence rephrased), then ask one new, distinct verification question to check understanding ' +
    'again. Whatever their answer to that second question, move on afterward regardless — do not ' +
    're-explain a third time even if understanding still seems shaky; simply let the session continue. ' +
    'Separately from this understanding check, look for a natural moment to invite them to elaborate ' +
    'with an open-ended question — for example, asking what part is most relevant to their own ' +
    'situation, or what they\'re hoping to get out of this topic — rather than relying only on yes/no ' +
    'questions, so the conversation surfaces more of what they actually think and want.'
}
```

**`assembleHumeNativePrompt()` wiring** (two additional `.split().join()` calls, alongside the existing
`PACING_GUIDANCE_PLACEHOLDER` line):

```ts
    .split(ADAPTIVE_DELIVERY_PLACEHOLDER).join(buildAdaptiveDeliveryGuidance())
    .split(ADAPTIVE_UNDERSTANDING_PLACEHOLDER).join(buildAdaptiveUnderstandingGuidance())
```

Order relative to the other `.split()` calls is immaterial (each placeholder is unique and
non-overlapping, exactly as the file's own existing comment about `toneGuidance`/`partnerGuidance`
ordering already notes for the pre-existing placeholders).

## 7. Success Criteria (Acceptance Tests)

✓ Given `HUME_NATIVE_ADAPTIVE_TEACHING_ENABLED` is unset (or any value other than the exact string
`'true'`), when `assembleHumeNativePrompt()` is called with any input, then the assembled output for
Rules 3 and 4 is byte-for-byte identical to the pre-B2B-66 (v13) template's output — verified by a direct
string-equality test against a fixed snapshot of v13's Rule 3/Rule 4 text.

✓ Given `HUME_NATIVE_ADAPTIVE_TEACHING_ENABLED=true`, when `assembleHumeNativePrompt()` is called, then
the assembled output contains the exact appended text from §6 at the end of Rule 3 and the end of Rule 4,
with no other rule's text changed.

✓ Given the feature is enabled and a live-call worked example matching §5.3(a) (a genuinely wrong answer),
when Marin evaluates the participant's first verification answer as substantively wrong, then she
re-explains once from a different angle, asks one new verification question, and — regardless of whether
the second answer is correct — proceeds toward Rule 5's advance_tab judgment without a third re-explanation
attempt.

✓ Given the feature is enabled and a live-call worked example matching §5.3(b) (a garbled-but-plausible
answer), when Marin evaluates a fragmented but substantively correct answer, then she affirms and moves on
without triggering the re-teach loop at all.

✓ Given the feature is enabled, when Marin begins teaching a section's content (Rule 3), then her spoken
delivery restates the material in her own words with at least one added example/analogy grounded in
SESSION CONTENT/PARTICIPANT CONTEXT, and introduces no fact not supported by that content — verified
against §5.3(c)'s before/after worked example for the same underlying SESSION CONTENT fact.

✓ Given the feature is disabled (default), when Marin teaches a section and runs a verification exchange,
then her behavior is indistinguishable from today's v13 behavior — no re-teach procedure, no
benefit-of-the-doubt instruction, no explicit own-words instruction for initial teaching (§5.3(d)).

✓ Given the feature is enabled and the participant gives no answer, or says "I don't know" (or a close
equivalent), when Marin evaluates this non-answer, then she treats it as a genuine gap and follows the
same one-time re-explain-and-recheck procedure as a substantively wrong answer — not a special case, and
not an infinite wait.

✓ Given the feature is enabled and the participant's second (post-re-explain) answer is still unclear or
still wrong, when Marin evaluates that second answer, then she still moves on afterward regardless — no
third re-explanation attempt under any circumstance.

✓ Given the feature is enabled and a section's content is very short, when a re-teach loop triggers within
that section, then the bound is still exactly one re-explanation-and-recheck — the instruction does not
special-case section length, so the worst-case addition to any section (long or short) is bounded to one
extra explain-and-verify exchange, consistent with the CEO brief's explicit length/cost bound.

✓ Given the feature is enabled, when Rule 7's pacing guidance is also enabled
(`HUME_NATIVE_PACING_GUIDANCE_ENABLED=true`), then both sets of additive guidance appear in the assembled
prompt with no textual collision or contradiction — each occupies its own rule's appended text, verified
by a combined-flags snapshot test.

✓ Given the feature is enabled, when Rule 1 (opening/icebreaker), Rule 8/12 (closing sequence), and Rule
13 (participant-initiated end) are inspected in the assembled output, then their text is unchanged from
today (mode-conditional resolution unaffected) — verified by snapshot comparison against pre-B2B-66
output for both `sessionContentMode` values.

## 8. Error States

This is a prompt-instruction change with no new runtime code path that can fail in the conventional
sense (no API call, no DB write, no user input to validate). The relevant "error states" are behavioral
failure modes of the LLM itself, addressed as follows:

- **Model over-corrects a plausible-but-oddly-phrased answer despite the benefit-of-the-doubt
  instruction:** mitigated by the explicit, worked framing in §6's `buildAdaptiveUnderstandingGuidance()`
  text ("only treat an answer as a genuine gap... when its substance, not just its wording, is actually
  wrong or clearly confused") — this is exactly why the instruction is written as a substance-vs-wording
  distinction rather than a vague "be lenient" directive. If a live-call verification pass (§13) shows
  over-correction still occurring, the fix is a wording adjustment to this same instruction, and the flag
  allows disabling the behavior instantly while that adjustment is made — no rollback of an unrelated rule
  is needed.
- **Model loops a third re-explanation despite the explicit one-attempt bound:** mitigated by the
  instruction's repeated, explicit framing ("do not re-explain a third time even if understanding still
  seems shaky"). If a live-call pass shows this bound being violated, this is a live-call regression to
  flag back through the CEO → BA → Dev chain for a wording fix, not a silent tolerance.
- **Model treats the elaboration-inviting instruction as license to ask "anything else on your mind"
  style closing-loop language mid-session, blurring with Rule 8b's closing confirmation question:**
  mitigated by construction — the proposed wording deliberately avoids Rule 8b's specific phrasing ("Is
  there anything else on your mind before we wrap up?") and instead asks about relevance/interest in the
  current topic, a different question shape entirely. Flagged explicitly in §5 (Interaction with existing
  rules is folded into §0/§4 above per this rewritten document's structure) as a risk to specifically watch
  for during the live-call verification pass.
- **Feature flag misconfigured to an unexpected truthy-like value (e.g. `'TRUE'`, `'1'`, `'yes'`):**
  treated as disabled — matches this repo's existing strict-equality convention for this flag family
  (`HUME_NATIVE_PACING_GUIDANCE_ENABLED` behaves identically). No separate error surfaced; this is
  indistinguishable from "unset" by design.
- **`assembleHumeNativePrompt()` runtime guardrail (tone-anchor character-offset check, lines 566–579 of
  the existing file):** unaffected by this document's changes — the new appended text lands in Rules 3
  and 4, both of which are already well past the tone/style anchor sentence at the very top of the
  template; this document does not change the anchor's position or risk pushing it later, since nothing is
  added before it.

## 9. Edge Cases

- **Participant gives no answer at all to a verification question (silence, or the call moves on before
  they respond):** treated identically to an "I don't know" response per §6/§7 — a genuine gap, triggering
  the one-time re-explain-and-recheck, then moving on regardless of the second exchange's outcome.
- **Participant's second (post-re-explain) answer is also unclear:** confirmed explicitly in §6's proposed
  wording and §7's acceptance tests — still move on, no third loop, under any circumstance.
- **Very short sections where a full re-teach cycle would dominate the section's own length:** no special
  casing is added for section length (§7) — the bound is already fixed at exactly one extra
  explain-and-verify exchange regardless of how short or long the section is, which is itself the
  CEO-approved mitigation for this concern (a short section's worst case is still bounded, just
  proportionally more noticeable) rather than a reason to skip re-teaching on short sections, since
  correctness of understanding matters regardless of section length.
- **Participant answers well but very briefly (e.g. a single confirming word like "yes" or "makes
  sense"):** not itself a "genuine gap" — the instruction's substance-vs-wording framing means a short but
  substantively-confirming answer is affirmed, not re-taught; brevity alone is not evidence of confusion.
- **Feature enabled together with `HUME_NATIVE_PACING_GUIDANCE_ENABLED`:** both compose independently and
  additively (§6, §7) — Rule 7's pacing guidance and this document's Rule 3/4 additions occupy different
  rules' appended text with no shared state, so enabling both simultaneously is fully supported and
  expected to be the common production configuration once both are individually verified.
- **Feature enabled together with `sessionContentMode: 'inline'` vs `'template'`:** no interaction — Rules
  3 and 4 are mode-invariant (never forked by `sessionContentMode`, confirmed §0), so this document's
  changes apply identically regardless of which content-delivery mode a session uses.
- **Feature enabled on a session using `PromptBehaviorConfig.verificationQuestionStyle`:** the
  partner-configured guidance block (rendered after all 12 fixed rules, §0) still references "rule 4
  above" by topic, and rule 4's fundamental topic (ask a verification question, listen, respond) is
  unchanged — a partner's configured verification-question style guidance and this document's new
  re-teach/benefit-of-the-doubt instruction are complementary (one shapes *what kind* of question to ask,
  the other shapes *what to do with the answer*), not conflicting.
- **Mobile/responsive:** not applicable — this feature has no UI surface at all, so the standing
  responsive-by-default policy in `CLAUDE.md` does not apply to anything this document specifies.
- **First-time vs. returning participant:** no special-casing — the new instructions apply identically to
  every section of every session regardless of the participant's history, exactly as Rules 3 and 4
  already do today.

## 10. Out of Scope

- **The missing-goodbye/early-exit bug (Arun's separately-tracked point 2).** Already routed as its own
  technical investigation — not touched, referenced, or affected by this document in any way.
- **Any new database table, column, migration, webhook event, or reseller-facing UI.** Per §0's
  verification, the existing `learner_insight`/`session.insights_ready` pipeline is sufficient for what
  this document's live-conversation changes feed into. No change to
  `inngest/partner-session-insights-extractor.ts` or `lib/partner/webhooks.ts` anywhere in this build.
- **Rewriting or rewording Rule 7's pacing guidance, `buildPacingGuidance()`, or the 30% Hume speed
  setting.** Untouched; this document's changes compose additively alongside it (§6, §9).
- **Rewriting or rewording the B2B-59/60 two-stage transition-marker mechanics, or Rule 11's existing
  transition-recap text.** Untouched — confirmed in §0 that Rule 11 needs no change; this document's Rule
  3 addition is a distinct, complementary instruction for a different moment (initial teaching, not
  transition-out).
- **Rule 1's mode-conditional opening/icebreaker structure, or Rule 8/12's closing sequences.** Confirmed
  working, out of scope, untouched.
- **Any change to tool-calling mechanics** (`show_visual`, `advance_tab`, `end_session` semantics) —
  Rule 3's addition changes only delivery-style instruction text, not the show_visual call timing/contract
  itself; Rule 5's advance_tab judgment is unaffected.
- **Mid-turn/sub-turn understanding tracking, or any mechanism beyond the model's own in-context judgment
  of the participant's spoken answer.** This document is pure prompt-instruction text — no code inspects
  or scores transcript content to decide when to trigger the re-teach loop; the model itself makes that
  judgment based on the instructions in §6, exactly as it already makes the "gently correct what's off"
  judgment today, just with a defined procedure now.
- **Any change to the `PromptBehaviorConfig`/`buildPartnerGuidanceBlock()` partner-configuration
  mechanism itself** — confirmed in §0/§9 that existing `verificationQuestionStyle`/`interSectionRecapStyle`
  references remain valid without any code change.
- **A/B testing, gradual rollout percentage, or per-partner override of
  `HUME_NATIVE_ADAPTIVE_TEACHING_ENABLED`.** This is a single, global, server-side boolean exactly like its
  precedent (`HUME_NATIVE_PACING_GUIDANCE_ENABLED`) — no per-session or per-partner variant is built or
  requested.

## 11. Open Questions

None. Every item the CEO brief asked the BA to define has been resolved above with direct-code-backed
reasoning:

1. **Rewritten Rule 4 text** — resolved: additive text appended to Rule 4's existing wording, covering
   benefit-of-the-doubt, the one-re-explanation-then-move-on bound, "genuinely different angle" defined
   explicitly (new example/analogy/framing, never a rephrase), and the new verification question after
   re-explaining (§4.2, §5.2, §6).
2. **Delivery-style instruction** — resolved: lives in Rule 3 (not a new rule, to avoid renumbering every
   subsequent rule and breaking the `PromptBehaviorConfig` rule-number references), exact wording specified
   with an explicit non-fabrication guardrail tied to SESSION CONTENT/PARTICIPANT CONTEXT (§4.2, §5.1, §6).
3. **Empathy/elaboration-encouraging instruction** — resolved: folded into the same Rule 4 addition (since
   it fires at the same conversational moment as the verification exchange), exact wording specified,
   open-ended rather than yes/no, explicitly framed as feeding the existing `learner_insight` extraction
   with richer material without changing that extraction itself (§4.2, §6).
4. **Feature-gating mechanism** — resolved: single new env var `HUME_NATIVE_ADAPTIVE_TEACHING_ENABLED`,
   `=== 'true'` check, default disabled, following the exact `HUME_NATIVE_PACING_GUIDANCE_ENABLED`/
   `buildPacingGuidance()` precedent (confirmed real by direct grep, §0); `PROMPT_TEMPLATE_VERSION` bumps
   `v13 -> v14` (§6).
5. **Interaction with existing rules** — resolved rule-by-rule in §0 and reinforced in §9: Rule 1
   (unchanged), Rule 2 (unchanged), Rule 5 (unchanged, compatible), Rule 6 (unchanged, no wording overlap
   by construction), Rule 7/pacing (unchanged, composes independently), Rule 8/11/12/13 (unchanged, no
   wording collision — Rule 8b's specific closing phrasing is deliberately not echoed by this document's
   new elaboration-inviting instruction).
6. **Acceptance criteria/worked examples** — resolved: §5.3 provides all three requested worked examples
   (benefit-of-the-doubt case, genuine-gap case, before/after delivery comparison), explicitly labeled as
   constructed illustrations since the CEO brief did not quote the actual reviewed transcript verbatim
   (§0); §7 provides the full acceptance-test list.
7. **Edge cases** — resolved in §9: no-answer/"I don't know," unclear second answer, very short sections,
   brief-but-correct answers, flag composition with other flags/modes.
8. **Test plan** — resolved in §13 below: unit/snapshot tests for byte-identical-when-off behavior, plus
   an explicit requirement for a live-call verification pass before this is considered done, consistent
   with this codebase's own standing pattern for voice/prompt changes (LIVE-01, B2B-48, B2B-52, B2B-58/59/60,
   B2B-61 Part A).

## 12. Dependencies

- **`lib/voice/hume-native/prompt-template.ts`** — existing file, requires: two new placeholder constant
  exports, two new builder functions, two edits to `HUME_NATIVE_PROMPT_TEMPLATE` (Rules 3 and 4 gain a
  trailing placeholder reference), two new `.split().join()` lines inside `assembleHumeNativePrompt()`,
  and a `PROMPT_TEMPLATE_VERSION` bump (`'v13' -> 'v14'`). No other file requires any change — confirmed
  in §0 that `inngest/partner-session-insights-extractor.ts` and `lib/partner/webhooks.ts` need zero edits.
- **`.env.local.example`** — must gain the new `HUME_NATIVE_ADAPTIVE_TEACHING_ENABLED=false` entry with
  its documentation comment (§6), per `CLAUDE.md`'s standing rule that every env var is documented there.
- **No new package, no new migration, no new API route.** This document introduces zero new dependencies
  beyond the one existing file listed above.
- **No dependency on any other in-flight B2B item** (B2B-63's Redis transcript capture, B2B-64's
  template-mode pause) — this document's changes are independent of both; neither reads nor is read by
  anything either of those documents touches.
- **Test file:** following this repo's convention of co-locating prompt-template tests, unit/snapshot
  tests for this change belong alongside any existing `prompt-template` test file (or a new
  `tests/unit/b2b66-adaptive-teaching-prompt.test.ts` if none exists yet), covering the acceptance criteria
  in §7 directly against `assembleHumeNativePrompt()`'s output.

## 13. Test Plan

- **Unit/snapshot:**
  - `assembleHumeNativePrompt()` with `HUME_NATIVE_ADAPTIVE_TEACHING_ENABLED` unset — Rule 3 and Rule 4
    text in the assembled output matches a fixed v13 snapshot byte-for-byte.
  - Same, with the env var set to `'true'`, `'TRUE'`, `'1'`, and `''` — only the exact string `'true'`
    produces the appended text; every other value produces v13-identical output.
  - `buildAdaptiveDeliveryGuidance()` / `buildAdaptiveUnderstandingGuidance()` — each returns `''` when
    disabled, and the exact proposed text (§6) when enabled.
  - Combined-flags snapshot: `HUME_NATIVE_ADAPTIVE_TEACHING_ENABLED=true` +
    `HUME_NATIVE_PACING_GUIDANCE_ENABLED=true` together — both appended blocks present, no textual
    collision, Rule 7 and Rules 3/4 each contain only their own appended text.
  - Mode-invariance: assembled output for both `sessionContentMode: 'inline'` and `'template'` shows
    identical Rule 3/Rule 4 appended text when the flag is on (confirming no unintended mode fork was
    introduced).
- **Manual/live-call verification (required before this is considered done):** per this codebase's own
  standing pattern for voice/prompt changes (LIVE-01, B2B-48, B2B-52, B2B-58/59/60, B2B-61 Part A all
  required a real live-call pass, not just automated tests, before being trusted) — a real or demo
  Hume-native live session with `HUME_NATIVE_ADAPTIVE_TEACHING_ENABLED=true` must be run and listened
  through end-to-end, specifically checking:
  1. A deliberately-wrong verification answer triggers exactly one re-explanation from a genuinely
     different angle, followed by exactly one new verification question, with the session moving on
     afterward regardless of that second answer.
  2. A deliberately garbled-but-correct spoken answer (e.g. speaking with intentional pauses/fragments)
     does not trigger a re-teach.
  3. Marin's initial teaching of at least one section audibly sounds like her own explanation with an
     example, not a verbatim reading of SESSION CONTENT, while remaining factually consistent with it.
  4. At least one elaboration-inviting, open-ended follow-up question occurs somewhere in the session,
     phrased distinctly from Rule 8b's closing "anything else?" question.
  5. Session length increase versus a comparable flag-off session is qualitatively consistent with the
     "at most one extra explain+verify exchange per section with a genuine gap" bound — not an open-ended
     ballooning of call length.
  6. With the flag left at its default (unset), a comparable session shows no behavior change from
     pre-B2B-66 sessions.
  This is expected to follow the same same-day-or-next-day live-verification cadence this codebase's other
  voice/prompt changes have used, per the CEO brief's own explicit test-plan requirement (§0, brief point
  8) — this document does not consider the feature shippable to a live partner session until this pass has
  actually happened, not merely planned.

---

Once approved by the CEO Agent, this spec is ready for Dev with zero open questions.
