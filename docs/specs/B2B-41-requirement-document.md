# Participant-Initiated Call-End Handling — Requirement Document
Version: 1.0
Status: DRAFT
Author: Business Analyst Agent
Date: 2026-07-27
Feature ID: B2B-41
Source: CEO Feature Brief, 2026-07-27
(`.claude/agents/clio/feature-briefs/B2B-41-participant-initiated-call-end-handling.md`)

---

## 0. How this document is organized

This is a single, small, one-file P0 correctness/billing fix — no bundling, no Parts, unlike
B2B-34/35/36. The CEO brief already resolved the one implementation-level fork it found (fixed
mode-invariant text vs. a `sessionContentMode` fork; numbering placement) with reasoning attached,
following independent live-code verification. **This document independently re-verifies every
load-bearing factual claim in the brief against the live file
(`lib/voice/hume-native/prompt-template.ts`, read in full 2026-07-27) before treating it as fact** —
not assumed from the brief's own narrative. All three call sites the brief names were re-confirmed
live: `app/api/hume-native/provision-config/route.ts:469`, `lib/partner/live-render.ts:286` and
`:429`, and the `end_session` tool handler at
`app/partner-render/[clio_session_ref]/PartnerRenderClient.tsx:201,221`.

**Section 11 (Open Questions) is empty.**

---

## 1. Purpose

Clio's live-voice prompt (`HUME_NATIVE_PROMPT_TEMPLATE`) today contains exactly one rule — rule 8 —
that ever instructs the model to call the `end_session` tool, and it is narrowly scoped to Clio's
own self-initiated closing sequence "at the natural end of the material" (a three-step
summarize/confirm/goodbye-then-`end_session` flow Clio decides to start herself). There is no rule
anywhere telling Clio what to do when the **participant** proactively says they want to end the
call. Confirmed live tonight by Arun: he told Clio he wanted to end the call, Clio said "bye" but
never called `end_session`, and the session kept running — and kept accruing billed minutes, per
`inngest/partner-live-cutoff.ts`/`inngest/partner-trial-cutoff.ts` — until whatever external
cutoff/timeout eventually intervened. The participant was left sitting in a call he believed had
ended.

Failure without this fix: every live session remains vulnerable to the same failure mode any time a
participant asks to leave early — the model has no scripted directive to fall back on, so it
improvises a farewell-sounding remark without the one action (`end_session`) that actually stops the
call and the billing clock. This is a live correctness bug with a direct billing-accuracy
consequence (partners are billed for minutes the participant did not intend to use), not a
theoretical edge case.

---

## 2. User Story

As a **live-session participant** (e.g. Arun in the public demo, or a future partner's end user),
I want Clio to actually end the call — promptly, and without running through her full closing
routine — the moment I tell her I want to stop,
So that I am not left sitting in a call I believe has ended, and the session's billed minutes stop
accruing the moment I asked to leave.

As the **reseller/partner** whose end user is billed for live session minutes,
I want Clio to reliably end a session when the participant asks to end it,
So that my customers are not billed for minutes that ran past the point the participant wanted to
stop.

---

## 3. Trigger / Entry Point

No new route, no new UI, no new tool. This is a prompt-text-only change to the fixed portion of
`HUME_NATIVE_PROMPT_TEMPLATE` inside `lib/voice/hume-native/prompt-template.ts`, picked up
automatically and unconditionally by every existing caller of `assembleHumeNativePrompt()` — no
call-site code changes required for any of the three:

- `app/api/hume-native/provision-config/route.ts:469` (legacy/pre-partner caller) — confirmed live.
- `lib/partner/live-render.ts:286` (`resolveLiveSessionRender`, Option 2 / `'template'` content
  mode) — confirmed live.
- `lib/partner/live-render.ts:429` (`resolveInlineSessionRender`, Option 1 / `'inline'` content
  mode) — confirmed live.

**Runtime trigger**: during a live voice session, whenever the participant explicitly states or asks
— in any phrasing — that they want to end the call or session. This is model judgment applied to
live speech, not a deterministic keyword/intent classifier (same class of mechanism as every other
behavioral rule in this template, e.g. rule 6's off-topic-question deferral).

**State required**: an already-live, already-connected Hume-native voice session — identical to
every other behavioral rule in this template. No new state, no new auth, no new session field.

---

## 4. Flow Description

**Today's flow** (confirmed live in `lib/voice/hume-native/prompt-template.ts`, `PROMPT_TEMPLATE_VERSION = 'v9'`):
1. Rule 8 is the only rule that ever instructs Clio to call `end_session`. Its own closing
   parenthetical (lines 207-211 of the live file) explicitly scopes it to Clio's own
   self-initiated closing: *"This is your default closing behavior at the natural end of the
   material... If the participant raises a genuine question of their own before you reach this
   point, answer it naturally as you would mid-session — this rule only governs how YOU end the
   call, not how you respond if they speak up."*
2. If the participant states they want to end the call, no rule addresses this. The model has no
   scripted directive and, per Arun's live test, improvises a farewell without calling
   `end_session` — the call and its billing continue.

**New flow** (rule 13, added after rule 12, described in full in §6):
1. The participant states or asks, in any phrasing, that they want to end the call/session.
2. Clio does **not** run rule 8's a/b/c sequence (no two-sentence summary, no "anything else?"
   confirmation loop) — the participant has already said they're done.
3. In that same conversational turn: Clio briefly acknowledges the request in her own words, says a
   short natural goodbye, and calls the `end_session` tool.
4. `end_session`'s own existing behavior (client handler at `PartnerRenderClient.tsx:201,221`,
   confirmed live and unchanged by this brief) tears down the call exactly as it already does today
   when rule 8c calls it — this fix changes only **when** Clio decides to call `end_session`, never
   what happens once she does.
5. If the participant mentions wanting to continue "next time" or similar phrasing, that is ordinary
   conversational content for the goodbye — explicitly not a scheduling or follow-up mechanism, per
   the CEO brief's Known Constraints.

**Out-of-scope-but-adjacent case, left to model judgment (not specially scripted)**: a participant
who raises a genuine new question in the same breath as asking to end the call ("let's stop here,
but quickly — is X true?"). No deterministic handling is specified; see §9.

---

## 5. Visual Examples

This is a prompt-text change with no visual UI surface — there is no screen or wireframe to
document. In place of a wireframe, here are the assembled-output "before vs. after" examples that
stand in for this feature's only observable surface: the live conversation transcript.

### 5.1 — Live conversation, before (today, v9)

```
Participant: "I want to end the call and connect next time."
Clio:        "Bye!"
[No end_session tool call. Session remains connected. Billing clock keeps running.]
```

### 5.2 — Live conversation, after (v10, rule 13 applied)

```
Participant: "I want to end the call and connect next time."
Clio:        "Sounds good — we'll pick this up next time. Take care!"
              [end_session tool called in the same turn]
[Call ends. Billing clock stops.]
```

### 5.3 — Assembled prompt tail, before vs. after (this is the actual code-level "wireframe" for a
prompt-text feature)

**Before** (`PROMPT_TEMPLATE_VERSION = 'v9'`, live lines 224-228):
```
12. ${RULE_12_PLACEHOLDER}${PARTNER_GUIDANCE_PLACEHOLDER}

=== PARTICIPANT CONTEXT ===

${CONTEXT_PLACEHOLDER}
```

**After** (`PROMPT_TEMPLATE_VERSION = 'v10'`):
```
12. ${RULE_12_PLACEHOLDER}
13. If the participant explicitly states or asks that they want to end the
    call or session — in any phrasing ("I want to end the call," "let's stop
    here," "I need to go," or similar) — do not run rule 8's full closing
    sequence: skip the two-sentence summary (8a) and the "anything else?"
    confirmation loop (8b), since they have already told you they are done.
    Instead, in that same turn, briefly acknowledge their request in your own
    words, say a short, natural goodbye, and call the end_session tool.
    end_session is the only way the call ends here, exactly as rule 8c
    already establishes for its own closing flow — the call does not end
    automatically just because you said goodbye, so you must call
    end_session explicitly every time you close a session this way. If they
    mention wanting to continue "next time" or something similar, treat that
    as ordinary conversational content for your goodbye — it needs no
    special handling beyond a natural acknowledgment. (This is distinct from
    rule 6, which governs deferring an off-topic or complex question the
    participant raises mid-session — this rule governs an explicit request
    to end the call itself.)${PARTNER_GUIDANCE_PLACEHOLDER}

=== PARTICIPANT CONTEXT ===

${CONTEXT_PLACEHOLDER}
```

---

## 6. Data Requirements

No database reads, writes, or migrations. No new API endpoints, request/response shapes, or
`localStorage`/`sessionStorage` usage. This section instead specifies the exact code change to the
one file touched: `lib/voice/hume-native/prompt-template.ts`.

### 6.1 — Rule 13 text, finalized

The CEO brief's proposed rule 13 text is a strong starting draft; the behavior it specifies is
CEO-resolved and is carried through unchanged. Phrasing has been tightened in two places so it reads
more naturally as a same-voice instruction to the model, consistent with how rule 8c already closes
its own parallel sentence ("...so you must call end_session explicitly every time you close a
session this way") — no behavioral change from the CEO's draft, wording only:

- "end_session is the only way the call ends here too — exactly as rule 8c already establishes"
  → "end_session is the only way the call ends here, exactly as rule 8c already establishes for
  its own closing flow" (removes the slightly awkward "here too," makes the cross-reference to
  rule 8c's own mechanism explicit rather than implied).
- Closing clause reworded to mirror rule 8c's own phrasing pattern ("...so you must call
  end_session explicitly every time you close a session this way") for voice consistency across
  the two rules that both invoke `end_session`.

Final text (also shown in context in §5.3):

> 13. If the participant explicitly states or asks that they want to end the call or session — in
>     any phrasing ("I want to end the call," "let's stop here," "I need to go," or similar) — do
>     not run rule 8's full closing sequence: skip the two-sentence summary (8a) and the "anything
>     else?" confirmation loop (8b), since they have already told you they are done. Instead, in
>     that same turn, briefly acknowledge their request in your own words, say a short, natural
>     goodbye, and call the end_session tool. end_session is the only way the call ends here,
>     exactly as rule 8c already establishes for its own closing flow — the call does not end
>     automatically just because you said goodbye, so you must call end_session explicitly every
>     time you close a session this way. If they mention wanting to continue "next time" or
>     something similar, treat that as ordinary conversational content for your goodbye — it needs
>     no special handling beyond a natural acknowledgment. (This is distinct from rule 6, which
>     governs deferring an off-topic or complex question the participant raises mid-session — this
>     rule governs an explicit request to end the call itself.)

**Indentation matches this file's own established convention**: continuation lines for two-digit
rules (10, 11, 12) are indented 4 spaces (matching the width of `"13. "`), confirmed live at
lines 214-223 of the current file — rule 13's continuation lines above follow the same 4-space
indent, not the 3-space indent used by single-digit rules 1-9.

### 6.2 — Exact diff, `lib/voice/hume-native/prompt-template.ts`

**(a) Version bump — line 15:**
```diff
-export const PROMPT_TEMPLATE_VERSION = 'v9'
+export const PROMPT_TEMPLATE_VERSION = 'v10'
```

**(b) New doc comment, placed immediately above `export const HUME_NATIVE_PROMPT_TEMPLATE = ` (i.e.
directly after the existing `ASSISTANT_SELF_REFERENCE` block ending at line 142, before line 144)** —
this is the placement convention this file already uses for documenting a new fixed rule that has no
separate placeholder constant of its own (contrast with the B2B-35/36 comments, which sit above
their placeholder `const` declarations because those rules resolve through placeholders; rule 13 has
no placeholder, so its doc comment sits directly above the template literal it modifies, which is
the closest available anchor):

```ts
/**
 * B2B-41 (docs/specs/B2B-41-requirement-document.md) — rule 13, added below after rule 12, is
 * fixed, mode-invariant text (embedded directly in the template literal, no placeholder constant,
 * no new AssembleHumeNativePromptInput field) instructing Clio to skip rule 8's Clio-initiated
 * closing sequence and call end_session immediately — in the same turn, after a brief
 * acknowledgment and short goodbye — when the PARTICIPANT explicitly asks to end the call. Rule 8
 * itself only ever covers Clio's own self-initiated closing (see its own closing parenthetical);
 * there was previously no rule covering a participant-initiated end request, which is what caused
 * a live P0 bug — the model said a farewell but never called end_session, leaving the session (and
 * its billing) running. No sessionContentMode fork is needed: this behavior does not vary between
 * 'template' and 'inline' content-delivery mode (unlike rules 1/8/12). PROMPT_TEMPLATE_VERSION
 * bumps v9 -> v10, and — unlike every optional B2B-11/35/36 field, all of which are byte-identical
 * when unconfigured — this IS a genuine, unconditional output change for every existing caller in
 * both content modes: that is the intended P0 fix, not an opt-in.
 */
```

**(c) Template body — replaces the current tail (live lines 224-228) with the new rule 13, inserted
between rule 12 and `${PARTNER_GUIDANCE_PLACEHOLDER}`:**

```diff
-12. ${RULE_12_PLACEHOLDER}${PARTNER_GUIDANCE_PLACEHOLDER}
+12. ${RULE_12_PLACEHOLDER}
+13. If the participant explicitly states or asks that they want to end the
+    call or session — in any phrasing ("I want to end the call," "let's stop
+    here," "I need to go," or similar) — do not run rule 8's full closing
+    sequence: skip the two-sentence summary (8a) and the "anything else?"
+    confirmation loop (8b), since they have already told you they are done.
+    Instead, in that same turn, briefly acknowledge their request in your own
+    words, say a short, natural goodbye, and call the end_session tool.
+    end_session is the only way the call ends here, exactly as rule 8c
+    already establishes for its own closing flow — the call does not end
+    automatically just because you said goodbye, so you must call
+    end_session explicitly every time you close a session this way. If they
+    mention wanting to continue "next time" or something similar, treat that
+    as ordinary conversational content for your goodbye — it needs no
+    special handling beyond a natural acknowledgment. (This is distinct from
+    rule 6, which governs deferring an off-topic or complex question the
+    participant raises mid-session — this rule governs an explicit request
+    to end the call itself.)${PARTNER_GUIDANCE_PLACEHOLDER}

 === PARTICIPANT CONTEXT ===

 ${CONTEXT_PLACEHOLDER}
```

**Placement confirmation, relative to `PARTNER_GUIDANCE_PLACEHOLDER` and rule 12**: rule 13's text
is appended directly (no intervening newline or space, matching the existing
`${RULE_12_PLACEHOLDER}${PARTNER_GUIDANCE_PLACEHOLDER}` pattern) immediately before
`${PARTNER_GUIDANCE_PLACEHOLDER}`, which itself must stay positioned after all fixed behavioral
rules per its own existing doc comment (`buildPartnerGuidanceBlock()`'s own comment: "lands here,
strictly after all 12 fixed BEHAVIORAL RULES" — now 13). This preserves `buildPartnerGuidanceBlock()`'s
"byte-identical when empty" invariant (§6.1's `if (parts.length === 0) return ''` path is
untouched) since the placeholder still resolves to `''` when no partner guidance is configured,
producing no extra whitespace after rule 13's closing parenthesis in that case.

### 6.3 — What does NOT change

- No new exported placeholder constant (unlike `PARTICIPANT_NAME_PLACEHOLDER`/
  `INDUSTRY_CLAUSE_PLACEHOLDER`/`PACING_GUIDANCE_PLACEHOLDER`) — rule 13 is fixed text embedded
  directly in `HUME_NATIVE_PROMPT_TEMPLATE`, exactly like rules 2-7 and 9-11 already are.
- No new field on `AssembleHumeNativePromptInput`.
- No change to `assembleHumeNativePrompt()`'s function body, its `.split(...).join(...)` chain, or
  any existing placeholder resolution.
- No change to rule 8's own text, its a/b/c sub-structure, its closing parenthetical, or its
  numbering — confirmed byte-for-byte unchanged in the diff above (§6.2(c) touches only the line
  containing rule 12/`PARTNER_GUIDANCE_PLACEHOLDER` and everything after it).
- No change to rules 1-7 or 9-11's text or numbering.
- No change to `PartnerRenderClient.tsx`'s `end_session` tool handler (confirmed live at lines
  201, 221 — out of scope per the CEO brief, and per this session's own prior B2B-37 investigation
  confirming it already works correctly once called).
- No new environment variable, no `.env.local.example` change.
- No database migration.

### 6.4 — Byte-identical-output regression discipline (stated explicitly, not glossed over)

Unlike B2B-35/36's optional, default-off fields and toggles — all of which produce **byte-identical**
assembled output for any caller that doesn't opt in — **this change is NOT byte-identical for any
existing caller.** Rule 13's text is fixed, unconditional, mode-invariant text with no toggle and no
optional input gating it. The moment this ships:

- Every session assembled via `app/api/hume-native/provision-config/route.ts` (legacy caller, no
  `sessionContentMode` passed) gets rule 13 in its prompt.
- Every session assembled via `resolveLiveSessionRender()` (`'template'` mode) gets rule 13.
- Every session assembled via `resolveInlineSessionRender()` (`'inline'` mode) gets rule 13.

This is intentional and is the entire point of the fix, per the CEO brief: this is a confirmed P0
correctness/billing bug, not an unproven theory-based mitigation like B2B-36 F5 (which Arun
explicitly wanted shippable-and-revertible behind `HUME_NATIVE_PACING_GUIDANCE_ENABLED`). There is
no env var, no `sessionContentMode` fork, and no default-off path — every live Hume-native session,
in both content modes and via the legacy route, should carry this rule unconditionally, the same way
rules 2-11 already apply unconditionally today. Any regression test asserting "output unchanged for
an unconfigured caller" — the pattern used throughout B2B-11/35/36 — does **not** apply to rule 13
itself; it applies only to confirming rules 1-12's own text is untouched (see AT-3 in §7).

---

## 7. Success Criteria (Acceptance Tests)

1. **AT-1** ✓ Given `sessionContentMode: 'inline'`, when the prompt is assembled, then the output
   contains rule 13's exact text verbatim (see §6.1), immediately following rule 12's resolved
   inline text and immediately preceding either the partner-guidance block or
   `=== PARTICIPANT CONTEXT ===` if no partner guidance is configured.
2. **AT-2** ✓ Given `sessionContentMode: 'template'` (or omitted, the legacy-caller shape), when the
   prompt is assembled, then the output contains rule 13's exact text verbatim, in the same
   position relative to rule 12 and `=== PARTICIPANT CONTEXT ===` — confirming rule 13 is genuinely
   mode-invariant, not accidentally scoped to one mode.
3. **AT-3** ✓ Given the prompt is assembled with any input shape (inline, template, or the legacy
   no-`sessionContentMode` shape), when rules 1-12's own resolved text is diffed against the
   pre-B2B-41 (v9) output for the same input, then every character of rules 1-12 is unchanged — no
   accidental edit leaked into rule 8's a/b/c sequence, its closing parenthetical, or any other
   existing rule.
4. **AT-4** ✓ Given the prompt is assembled with any input shape, when the output is inspected, then
   `PROMPT_TEMPLATE_VERSION` reads the literal string `'v10'` (not `'v9'`).
5. **AT-5** ✓ Given the prompt is assembled, when the output is inspected, then it contains no
   leftover bracketed placeholder tag for rule 13 (there is none to leak, since rule 13 uses no
   placeholder — this test exists to positively confirm the text is literal/embedded, not a
   silently-unresolved `.split().join()` token).
6. **AT-6** ✓ Given a caller matching `app/api/hume-native/provision-config/route.ts`'s exact call
   shape (no `sessionContentMode`, no `promptBehavior`), when the prompt is assembled, then the
   output contains rule 13's exact text — confirming the legacy caller is not accidentally excluded.
7. **AT-7** ✓ Given the assembled output is scanned for the literal substring `"end_session"`, when
   counted, then it appears in rule 8c's existing text (unchanged) **and** in rule 13's new text —
   two distinct, correctly-scoped instructions to call the same tool for two different triggers
   (Clio-initiated vs. participant-initiated).
8. **AT-8** ✓ Given `buildPartnerGuidanceBlock()` resolves to `''` (no partner guidance configured —
   the default for every existing caller), when the prompt is assembled, then rule 13's closing
   parenthesis is immediately followed by `\n\n=== PARTICIPANT CONTEXT ===` with no stray
   whitespace or leftover placeholder artifact — confirming the "byte-identical when empty" property
   of `PARTNER_GUIDANCE_PLACEHOLDER` still holds with rule 13 inserted before it.
9. **AT-9** (manual live-test, not a unit test — see §9) — Given a live session in which the
   participant says a clear phrase such as "I want to end the call," when Clio responds, then she
   does not run the two-sentence-summary/confirmation-loop pattern of rule 8a/8b, and the
   `end_session` tool is actually invoked (confirmed via session logs / `delivery_log`-equivalent
   trace, not just the transcript) within the same turn as her goodbye.

---

## 8. Error States

- **The model acknowledges the end request but does not call `end_session`** (a recurrence of the
  original bug, now against rule 13 instead of a total absence of guidance): not something this
  codebase can force deterministically — same class of risk every other behavioral rule in this
  prompt carries (the LLM may not perfectly comply with any given instruction). This is a prompt
  *request*, not a hard enforcement mechanism, exactly like B2B-36 F5's pacing guidance was
  documented as. The only verification path is a live test (AT-9) plus ongoing production
  monitoring of `end_session` call rates relative to session-end billing timestamps, which already
  exists independently of this brief via `inngest/partner-live-cutoff.ts`/
  `inngest/partner-trial-cutoff.ts` (the external cutoff safety net that already exists today and
  is not being removed by this change).
- **`end_session` is called but the client-side handler fails** (`PartnerRenderClient.tsx:201,221`):
  explicitly out of scope for this brief — that mechanism is unchanged and was already confirmed
  correct in the prior B2B-37 investigation. If it fails, that is a B2B-37-class bug, not a B2B-41
  regression.
- **Ambiguous participant phrasing** ("okay, talk later!") that could be read as either a farewell
  pleasantry or a genuine end-call request: not an error state — left to model judgment, same
  precedent as rule 6's undefined-boundary handling of "off-topic or complex" questions (see §9).

---

## 9. Edge Cases

- **Participant raises a genuine new question in the same breath as asking to end the call**
  ("let's stop here, but quickly — is X true?") — left to Clio's own natural-language judgment,
  same reliance on model judgment (not a deterministic state machine) that rule 6's deferral and
  rule 8b's "if the participant raises something new" loop already use. Per the CEO brief, this is
  flagged as a scenario worth a manual live-test pass (AT-9-adjacent), not a hard requirement to
  formally unit-test or additionally script.
- **Ambiguous farewell-sounding phrasing that may not be a real end-call request** ("okay, talk
  later!") — same reliance on model judgment; this brief does not attempt to enumerate exhaustive
  trigger phrasing, matching how rule 6 doesn't enumerate exhaustive off-topic-question phrasing
  either.
- **"Next time" framing** — explicitly not special-cased; per Known Constraints in the CEO brief,
  this is ordinary goodbye content, not a scheduling or follow-up mechanism to build.
- **Rule 13 and rule 8 firing "at the same time"** — cannot actually happen: rule 13 explicitly
  instructs skipping rule 8's sequence when it applies, and rule 8's own scope is unchanged (only
  Clio-initiated closing at the natural end of material). The two rules are mutually exclusive by
  construction, not by runtime detection logic.
- **A partner-configured `closingConfirmationQuestion` or `goodbyeLine`
  (`PromptBehaviorConfig`)** — these render inside the `=== PARTNER-CONFIGURED GUIDANCE ===` block,
  which (per `buildPartnerGuidanceBlock()`'s own existing guardrail language) can never override or
  take priority over any BEHAVIORAL RULE, including rule 13. No interaction/conflict: a
  partner-configured goodbye line may still influence *how* Clio phrases the short goodbye rule 13
  calls for, but does not change *whether* `end_session` gets called or *when*.
- **Legacy caller (`provision-config/route.ts`) sessions** — rule 13 applies unconditionally there
  too (§6.4), since this route calls `assembleHumeNativePrompt()` with the same shared template.

---

## 10. Out of Scope (explicit, carried from the CEO brief)

- Any change to rule 8's own a/b/c flow, its closing parenthetical, or its numbering.
- Any new tool, UI, billing, or scheduling logic.
- Any change to how `end_session` behaves once called, or to
  `app/partner-render/[clio_session_ref]/PartnerRenderClient.tsx`'s handler.
- A hard, deterministic (non-LLM-judgment) detection mechanism for "the participant wants to end
  the call" — this is a prompt instruction to the model, the same class of mechanism as every other
  behavioral rule in this file, not a keyword/intent classifier.
- Any `sessionContentMode`-conditional variant of rule 13 — it is fixed, mode-invariant text.
- Any new environment variable or toggle gating rule 13 — unlike B2B-36 F5, this ships
  unconditionally (§6.4).
- Automated verification that Clio actually complies with rule 13 in every live case — the only
  verification path available is a live test plus existing production monitoring/cutoff safety
  nets (§8).

---

## 11. Open Questions

None. The CEO brief resolved the one implementation-level fork it identified (fixed mode-invariant
text vs. a `sessionContentMode` fork; rule numbering/placement), and this document independently
re-verified every factual claim against the live file (`PROMPT_TEMPLATE_VERSION` genuinely `'v9'`
today; rule 8's exact text, including its closing parenthetical, matches byte-for-byte; rules 10-12's
4-space continuation-line indentation convention confirmed live; all three
`assembleHumeNativePrompt()` call sites confirmed live at the brief's stated line numbers; the
`end_session` client handler confirmed live at `PartnerRenderClient.tsx:201,221`) rather than
assumed from the brief's own narrative. Ready for CEO Agent approval. No developer should begin work
until that approval lands.

---

## 12. Dependencies

None. This touches exactly one file
(`lib/voice/hume-native/prompt-template.ts`) — no migration, no other Feature Brief's work is a
prerequisite, and no other in-flight B2B-3x/4x brief conflicts with this file's tail section (the
most recent prior edit to this file, B2B-36, touched the opening sentence, rule 7, and
`RULE_1_INLINE_TEXT` — none of which overlap with the rule-12/`PARTNER_GUIDANCE_PLACEHOLDER` tail
this brief edits).

**Test plan** (this codebase's existing Vitest convention, following
`tests/unit/b2b36-name-industry-pacing.test.ts`'s pattern directly): add
`tests/unit/b2b41-participant-end-call.test.ts`, importing `assembleHumeNativePrompt` and
`PROMPT_TEMPLATE_VERSION` from `@/lib/voice/hume-native/prompt-template`, structured as:
- A `describe('B2B-41 — rule 13, participant-initiated call end')` block covering AT-1, AT-2, AT-6,
  AT-7, AT-8 above (assert exact substring/verbatim-text presence per §6.1's finalized text, for
  both `sessionContentMode: 'inline'` and `'template'`, and for the legacy no-mode input shape used
  by `provision-config/route.ts`).
- A `describe('B2B-41 — regression, rules 1-12 unchanged')` block covering AT-3: assert rule 8's
  exact a/b/c text and closing parenthetical (byte-for-byte, copied from the live v9 file) are
  still present unmodified in the v10 output.
- A single `it('PROMPT_TEMPLATE_VERSION is v10')` covering AT-4, asserting the literal exported
  constant.
- AT-9 is explicitly called out in the test file's own top-of-file comment as **not** covered by
  this suite — a manual live-test item for Arun's next live session, mirroring how B2B-36's own
  spec (§8) flagged F5's compliance-verification as "the only verification is Arun's next live
  test," not an automated assertion.
