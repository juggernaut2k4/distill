import { describe, it, expect } from 'vitest'
import { assembleHumeNativePrompt, PROMPT_TEMPLATE_VERSION } from '@/lib/voice/hume-native/prompt-template'

/**
 * B2B-41 (docs/specs/B2B-41-requirement-document.md §6.1/§7/§12) — tests for the new fixed,
 * mode-invariant rule 13 ("participant explicitly asks to end the call") added to
 * HUME_NATIVE_PROMPT_TEMPLATE. AT numbers below refer to the spec's Section 7 acceptance-test
 * list.
 *
 * AT-9 (live-test-only: confirming Clio actually skips rule 8's a/b/c sequence and calls
 * end_session in a real session) is explicitly NOT covered by this suite — it requires a manual
 * live-test pass by Arun, the same way B2B-36 F5's compliance verification was documented as
 * "the only verification is Arun's next live test," not an automated assertion.
 */

const BASE_INPUT = {
  profileContext: 'Executive in fintech.',
  intentContext: '',
  sessionContent: 'Section 1 content here.',
}

// Rule 13's exact text, verbatim from the spec (§6.1 / §6.2(c)), as it appears embedded in the
// template literal (4-space continuation-line indentation, matching rules 10-12's convention).
const RULE_13_TEXT =
  '13. If the participant explicitly states or asks that they want to end the\n' +
  '    call or session — in any phrasing ("I want to end the call," "let\'s stop\n' +
  '    here," "I need to go," or similar) — do not run rule 8\'s full closing\n' +
  '    sequence: skip the two-sentence summary (8a) and the "anything else?"\n' +
  '    confirmation loop (8b), since they have already told you they are done.\n' +
  '    Instead, in that same turn, briefly acknowledge their request in your own\n' +
  '    words, say a short, natural goodbye, and call the end_session tool.\n' +
  '    end_session is the only way the call ends here, exactly as rule 8c\n' +
  '    already establishes for its own closing flow — the call does not end\n' +
  '    automatically just because you said goodbye, so you must call\n' +
  '    end_session explicitly every time you close a session this way. If they\n' +
  '    mention wanting to continue "next time" or something similar, treat that\n' +
  '    as ordinary conversational content for your goodbye — it needs no\n' +
  '    special handling beyond a natural acknowledgment. (This is distinct from\n' +
  '    rule 6, which governs deferring an off-topic or complex question the\n' +
  '    participant raises mid-session — this rule governs an explicit request\n' +
  '    to end the call itself.)'

// Rule 8's exact a/b/c text and closing parenthetical, copied byte-for-byte from the live v9
// file (unaffected by this change — used for the AT-3 regression check below).
const RULE_8_UNCHANGED_TEXT =
  '   a. Briefly summarize what was covered today in exactly two sentences.\n' +
  '   b. Ask one direct closing question confirming there is nothing further to\n' +
  '      discuss — e.g. "Is there anything else on your mind before we wrap up?"\n' +
  '      — and wait for a response. If the participant raises something new,\n' +
  '      address it naturally (answer briefly, or use the deferral phrasing from\n' +
  '      rule 6 if it\'s complex or off-topic), then ask this closing question\n' +
  '      again. Repeat this until their response indicates nothing further (a\n' +
  '      "no," "that\'s all," "good," "I\'m all set," or similar).\n' +
  '   c. Once the participant confirms there is nothing further, thank them and\n' +
  '      say a clear, natural goodbye (e.g. "Take care, talk soon.") — do not\n' +
  '      wait for the participant to speak first once you\'ve delivered the\n' +
  '      farewell. Immediately after the goodbye, in that same turn, call the\n' +
  '      end_session tool. end_session is the only way the call ends when you\n' +
  '      decide it\'s over — the call does not end automatically just because you\n' +
  '      said goodbye, so you must call end_session explicitly every time you\n' +
  '      close a session this way.\n' +
  '   This is your default closing behavior at the natural end of the material,\n' +
  '   independent of anything else that may prompt you to wrap up. (If the\n' +
  '   participant raises a genuine question of their own before you reach this\n' +
  '   point, answer it naturally as you would mid-session — this rule only\n' +
  '   governs how YOU end the call, not how you respond if they speak up.)'

describe('B2B-41 — rule 13, participant-initiated call end', () => {
  // AT-1
  it("inline mode: assembled output contains rule 13's exact text verbatim, immediately following rule 12 and preceding PARTICIPANT CONTEXT (no partner guidance configured)", () => {
    const assembled = assembleHumeNativePrompt({ ...BASE_INPUT, sessionContentMode: 'inline' })
    expect(assembled).toContain(RULE_13_TEXT)
    expect(assembled).toContain(RULE_13_TEXT + '\n\n=== PARTICIPANT CONTEXT ===')
  })

  // AT-2
  it("template mode (and omitted mode): assembled output contains rule 13's exact text verbatim, in the same position relative to rule 12 and PARTICIPANT CONTEXT", () => {
    const templateMode = assembleHumeNativePrompt({ ...BASE_INPUT, sessionContentMode: 'template' })
    expect(templateMode).toContain(RULE_13_TEXT)
    expect(templateMode).toContain(RULE_13_TEXT + '\n\n=== PARTICIPANT CONTEXT ===')

    const omittedMode = assembleHumeNativePrompt(BASE_INPUT)
    expect(omittedMode).toContain(RULE_13_TEXT)
    expect(omittedMode).toContain(RULE_13_TEXT + '\n\n=== PARTICIPANT CONTEXT ===')
  })

  // AT-6
  it('legacy provision-config-shaped caller (no sessionContentMode, no promptBehavior) gets rule 13 — not accidentally excluded', () => {
    const assembled = assembleHumeNativePrompt({
      profileContext: 'Some profile.',
      intentContext: 'Some intent.',
      sessionContent: 'Some content.',
    })
    expect(assembled).toContain(RULE_13_TEXT)
  })

  // AT-7
  it('the literal substring "end_session" appears in rule 8c\'s existing text (unchanged) and in rule 13\'s new text — two distinct, correctly-scoped instructions to call the same tool for two different triggers', () => {
    const assembled = assembleHumeNativePrompt(BASE_INPUT)
    // Rule 8c's own end_session instruction, byte-for-byte from the unchanged live text.
    expect(assembled).toContain(
      'call the\n      end_session tool. end_session is the only way the call ends when you'
    )
    // Rule 13's own end_session instruction, from the new text.
    expect(assembled).toContain(
      'call the end_session tool.\n    end_session is the only way the call ends here'
    )
    // Sanity: the substring occurs at least twice overall (three times per rule, six total, given
    // no partner-configured goodbyeLine text is present to add a seventh).
    const occurrences = assembled.split('end_session').length - 1
    expect(occurrences).toBe(6)
  })

  // AT-8
  it('with no partner guidance configured, rule 13\'s closing parenthesis is immediately followed by "\\n\\n=== PARTICIPANT CONTEXT ===" with no stray whitespace or leftover placeholder artifact', () => {
    const assembled = assembleHumeNativePrompt({ ...BASE_INPUT, promptBehavior: null })
    expect(assembled).toContain('to end the call itself.)\n\n=== PARTICIPANT CONTEXT ===')
    expect(assembled).not.toContain('[PARTNER CONFIGURED GUIDANCE]')
  })

  // AT-5
  it('no leftover bracketed placeholder tag for rule 13 — the text is literal/embedded, not an unresolved token', () => {
    const assembled = assembleHumeNativePrompt(BASE_INPUT)
    expect(assembled).not.toContain('[RULE 13')
    expect(assembled).not.toContain('[RULE 13 TEXT]')
  })
})

describe('B2B-41 — regression, rules 1-12 unchanged', () => {
  // AT-3
  it("rule 8's exact a/b/c text and closing parenthetical are byte-for-byte unchanged in the v10 output (template mode)", () => {
    const assembled = assembleHumeNativePrompt({ ...BASE_INPUT, sessionContentMode: 'template' })
    expect(assembled).toContain(RULE_8_UNCHANGED_TEXT)
  })

  it("rule 8's exact a/b/c text and closing parenthetical are byte-for-byte unchanged in the v10 output (inline mode)", () => {
    const assembled = assembleHumeNativePrompt({ ...BASE_INPUT, sessionContentMode: 'inline' })
    expect(assembled).toContain(RULE_8_UNCHANGED_TEXT)
  })

  it("rule 8's exact a/b/c text and closing parenthetical are byte-for-byte unchanged in the v10 output (legacy no-mode caller)", () => {
    const assembled = assembleHumeNativePrompt(BASE_INPUT)
    expect(assembled).toContain(RULE_8_UNCHANGED_TEXT)
  })
})

describe('B2B-41 — PROMPT_TEMPLATE_VERSION', () => {
  // AT-4
  it('PROMPT_TEMPLATE_VERSION is the literal string v10 (not v9)', () => {
    expect(PROMPT_TEMPLATE_VERSION).toBe('v10')
  })
})

// AT-9 is a manual live-test item, not covered here: given a live session in which the
// participant says a clear phrase such as "I want to end the call," Clio should not run rule
// 8a/8b's summary/confirmation-loop pattern, and end_session should actually be invoked (confirmed
// via session logs / delivery_log-equivalent trace) within the same turn as her goodbye. See
// docs/specs/B2B-41-requirement-document.md §7 AT-9 and §9.
