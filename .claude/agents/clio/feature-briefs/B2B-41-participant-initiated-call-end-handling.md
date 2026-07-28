# Feature Brief: B2B-41 — Participant-Initiated Call-End Handling

From: CEO (Arun)
To: Business Analyst Agent
Priority: P0 (live correctness bug — a session Clio does not actually end keeps running and keeps
consuming billed minutes after the participant has explicitly asked to stop; found live tonight
during Arun's own testing, same session as B2B-38/39/40)
Date: 2026-07-27

---

## How to read this brief

This is a direct relay of Arun's own bug report from live testing tonight, not raw material for me
to interpret — the fix scope was given to me directly. **I independently re-verified the root cause
against live code before writing this brief** (not trusting the relay alone) — findings are called
out inline as "CEO verification." Section "Questions for BA" is empty; the one implementation-level
fork I found is resolved below with my own reasoning attached, per the B2B-34 through B2B-40 rigor
bar this project has been holding to.

---

## What Arun Said

Verbatim: "i said clio that i want to end the call and connect next time but clio did not end the
call instead it said bye and stayed in the call."

## The Problem Being Solved

**CEO verification against `lib/voice/hume-native/prompt-template.ts` (read in full, current
`PROMPT_TEMPLATE_VERSION = 'v9'`):** confirmed rule 8 (lines ~190-211 of the fixed
`HUME_NATIVE_PROMPT_TEMPLATE`) is the only rule anywhere in the entire prompt that ever instructs
Clio to call the `end_session` tool, and it is explicitly, narrowly scoped to Clio's own
closing sequence "at the natural end of the material" — a three-step summarize (8a) / confirm-nothing
-further (8b) / goodbye-then-`end_session` (8c) flow that **Clio herself initiates** when she judges
the material is done. The rule's own closing parenthetical makes this scope explicit, verbatim from
the live file:

> "(If the participant raises a genuine question of their own before you reach this point, answer it
> naturally as you would mid-session — this rule only governs how YOU end the call, not how you
> respond if they speak up.)"

There is no rule anywhere in the template today telling Clio what to do when the **participant**
proactively states or asks that they want to end the call. When Arun said he wanted to end the call
tonight, the model had no scripted directive telling it to call `end_session` in response — it
improvised a farewell-sounding remark ("bye") but never actually invoked the tool, so the session (and
its live minute billing, per `inngest/partner-live-cutoff.ts`/`inngest/partner-trial-cutoff.ts`) kept
running until whatever external cutoff/timeout eventually intervened, and the participant was left
sitting in a call he believed had ended.

**Confirmed both live call sites** that would be affected by this fix, so scope is accurate:
- `app/api/hume-native/provision-config/route.ts:469` — the legacy B2C/pre-partner caller.
- `lib/partner/live-render.ts:286` (`resolveLiveSessionRender`, Option 2 / template content mode) and
  `lib/partner/live-render.ts:429` (`resolveInlineSessionRender`, Option 1 / inline content mode) —
  the two live reseller-facing render paths.
- Confirmed the client-side `end_session` tool handler this fix ultimately drives —
  `app/partner-render/[clio_session_ref]/PartnerRenderClient.tsx:201,221` — already works correctly
  once called (per this session's own B2B-37 investigation); this brief is purely about getting Clio
  to decide to call it in a new situation, not about how the call itself is torn down.

## What Success Looks Like

When a participant explicitly states or asks — in any phrasing — that they want to end the call or
session, Clio does not run rule 8's full closing sequence (no two-sentence summary, no "anything
else?" confirmation loop — the participant has already told her they're done). Instead, in that same
turn, she briefly acknowledges the request, says a short natural goodbye, and calls the `end_session`
tool — ending the call and stopping the billing clock immediately, with the same "`end_session` is the
only way the call ends, never assume it ends automatically" discipline rule 8c already establishes. If
the participant mentions wanting to continue "next time" or similar, that's just normal conversational
content for the goodbye — no special handling beyond a natural acknowledgment.

## Known Constraints (from Arun, non-negotiable)

- Do not touch rule 8's own existing Clio-initiated closing flow (the a/b/c summarize/confirm/goodbye
  sequence) — it stays exactly as-is for the case it already covers correctly.
- No new tool, UI, or billing logic — this is a prompt-text addition instructing better use of the
  **existing** `end_session` tool call, which already exists and already works correctly once
  triggered.
- No change to what `end_session` itself does once called — only to **when** Clio decides to call it.

---

## CEO Resolution on the one implementation-level fork

**Where does the new rule go, and does it need mode-conditional (template vs. inline) text like rules
1/8/12?**

I read `assembleHumeNativePrompt()` and the `RULE_1_TEMPLATE_TEXT`/`RULE_1_INLINE_TEXT`,
`RULE_8_TEMPLATE_TEXT`/`RULE_8_INLINE_TEXT`, `RULE_12_TEMPLATE_TEXT`/`RULE_12_INLINE_TEXT` pairs in
full. Those three rules are mode-conditional because they each reference *content-delivery mechanics*
that differ by `sessionContentMode` — rule 1/8 recite an authored Session Overview/Summary section
verbatim in `'template'` mode but ad-lib in `'inline'` mode; rule 12 announces those same named
sections, which only exist in `'template'` mode. This new rule does none of that — "briefly
acknowledge, say a short goodbye, call `end_session`" is identical behavior regardless of which
content-delivery shape the session uses. **Resolution: this does not need a new placeholder or a
`sessionContentMode` fork — it is fixed, mode-invariant text, added as a new numbered rule, exactly
like rules 2-7 and 9-11 already are (embedded directly in `HUME_NATIVE_PROMPT_TEMPLATE`, no
placeholder, no new field on `AssembleHumeNativePromptInput`).**

**Numbering — append as rule 13, do not renumber.** F5 (B2B-36) already established the precedent of
choosing an additive placement specifically *to avoid renumbering rules 8-12*, since several
cross-reference each other by number (8b references "rule 6," rule 11 references "rule 8"). The same
discipline applies here: append as a new **rule 13**, immediately after rule 12, before
`PARTNER_GUIDANCE_PLACEHOLDER` (which must stay positioned after all fixed behavioral rules, per its
own existing doc comment). Concretely, the template's current tail:

```
12. ${RULE_12_PLACEHOLDER}${PARTNER_GUIDANCE_PLACEHOLDER}
```

becomes:

```
12. ${RULE_12_PLACEHOLDER}
13. [new fixed rule text — see below]${PARTNER_GUIDANCE_PLACEHOLDER}
```

**Proposed rule 13 text** (BA should treat this as a strong starting draft, not untouchable — the BA
should sanity-check phrasing/length against the rest of the file's voice, but the *behavior* it
specifies is CEO-resolved and should not be reinterpreted):

> 13. If the participant explicitly states or asks that they want to end the call or session — in any
>     phrasing ("I want to end the call," "let's stop here," "I need to go," or similar) — do not run
>     rule 8's full closing sequence: skip the two-sentence summary (8a) and the "anything else?"
>     confirmation loop (8b), since they have already told you they're done. Instead, briefly
>     acknowledge their request in your own words, say a short, natural goodbye, and call the
>     end_session tool in that same turn. end_session is the only way the call ends here too — exactly
>     as rule 8c already establishes, the call does not end automatically just because you said
>     goodbye, so you must call it explicitly every time. If they mention wanting to continue "next
>     time" or something similar, treat that as ordinary conversational content for your goodbye — it
>     needs no special handling beyond a natural acknowledgment. (This is distinct from rule 6, which
>     governs deferring an off-topic or complex question the participant raises mid-session — this rule
>     governs an explicit request to end the call itself.)

**Why no toggle, unlike F5's `HUME_NATIVE_PACING_GUIDANCE_ENABLED`.** F5 was an unproven theory-based
mitigation Arun explicitly wanted shippable-and-revertible behind a flag. This is a confirmed
correctness bug with a deterministic, unambiguous fix — every existing caller (both content modes and
the legacy B2C route) should get it unconditionally, the same way rules 2-11 apply unconditionally
today. No env var, no new `AssembleHumeNativePromptInput` field.

**Versioning.** `PROMPT_TEMPLATE_VERSION` bumps `'v9'` → `'v10'` — this is a genuine, intentional
assembled-output change for **every** caller (not the "byte-identical when unconfigured" pattern
B2B-11/35/36 used for optional parameterized fields), since the whole point is that every live
Hume-native session should now carry this rule. The BA's regression test should assert the new rule
13 text is present in the assembled output for both `sessionContentMode` values and for a call with no
`sessionContentMode` specified at all (the legacy B2C caller), and that rules 1-12's own text is
otherwise unchanged from `v9`.

**No DB/schema change, no migration.** This is prompt-text only — nothing to persist, nothing new to
read at request time.

---

## Edge Cases (resolved)

- Participant raises a genuine new question or topic *in the same breath* as asking to end the call
  ("let's stop here, but quickly — is X true?") — left to Clio's own natural-language judgment, the
  same way rule 6's deferral and rule 8b's "if the participant raises something new" loop already rely
  on model judgment rather than a deterministic state machine. Not specially scripted here; flag to
  the BA to note as an acceptance-test scenario worth a manual live-test pass, not a hard requirement
  to formally spec.
- Participant says something ambiguous that could be a farewell pleasantry rather than a real request
  to end ("okay, talk later!") — same reliance on the model's own judgment; this brief does not attempt
  to enumerate exhaustive trigger phrasing, matching how rule 6 doesn't enumerate exhaustive
  off-topic-question phrasing either.
- The "next time" framing in Arun's own report is explicitly **not** special-cased — per Known
  Constraints, it's ordinary goodbye content, not a scheduling or follow-up mechanism to build.

## Out of Scope (explicit)

- Any change to rule 8's own a/b/c flow, its closing parenthetical, or its numbering.
- Any new tool, UI, billing, or scheduling logic.
- Any change to how `end_session` behaves once called, or to
  `app/partner-render/[clio_session_ref]/PartnerRenderClient.tsx`'s handler.
- A hard deterministic (non-LLM-judgment) detection mechanism for "the participant wants to end the
  call" — this is a prompt instruction to the model, same class of mechanism as every other behavioral
  rule in this file, not a keyword/intent classifier.

## Dependencies

None. Touches one file (`lib/voice/hume-native/prompt-template.ts`) only. No migration, no other
brief's work is a prerequisite.

## Questions for BA

None. The one fork I found (mode-conditional vs. fixed text, and numbering placement) is resolved
above with my own reasoning attached, following live-code verification. If the BA finds a genuine
ambiguity I missed, stop and escalate per the standard chain — do not guess.
