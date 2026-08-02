import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'
import {
  OPENAI_REALTIME_PROMPT_TEMPLATE,
  OPENAI_PROMPT_TEMPLATE_VERSION,
  assembleOpenAIRealtimePrompt,
} from '@/lib/voice/openai-realtime-prompt-template'
import { HUME_NATIVE_PROMPT_TEMPLATE } from '@/lib/voice/hume-native/prompt-template'

/**
 * B2B-61 Part C (2026-07-31) originally wired OpenAI Realtime to reuse the exact same assembled
 * prompt Hume's native mode gets, prepending a separate `OPENAI_VOICE_PERSONA_INSTRUCTIONS`
 * document in front of it client-side. **Superseded 2026-08-02 by B2B-68**: OpenAI Realtime gets
 * its own single, self-contained prompt (`lib/voice/openai-realtime-prompt-template.ts`), computed
 * independently server-side in `lib/partner/live-render.ts` alongside (never derived from) Hume's
 * own `assembledPrompt`.
 *
 * 2026-08-02 (live editing session with Arun, later the same day) — template/inline mode
 * distinction removed entirely (single unconditional rule 1/rule 8 text now), rules renumbered
 * sequentially 1-12, rule 4's verification-outcome handling made unconditional (see
 * b2b69-openai-adaptive-teaching-prompt.test.ts for that), and `=== HOW YOU SOUND ===` rebuilt in
 * full against the pre-B2B-68 prompt document (superseding the earlier "consolidated down to 3
 * sections" design this file used to test for).
 *
 * Source-text assertions, following the same convention as tests/unit/b2b61-partb-wiring.test.ts
 * for the two server-component files that can't be live-imported under this repo's node-environment
 * vitest config.
 */

const liveRenderSource = fs.readFileSync(path.resolve(__dirname, '../../lib/partner/live-render.ts'), 'utf8')
const pageSource = fs.readFileSync(
  path.resolve(__dirname, '../../app/(with-clerk)/partner-render/[clio_session_ref]/page.tsx'),
  'utf8'
)
const clientSource = fs.readFileSync(
  path.resolve(__dirname, '../../app/(with-clerk)/partner-render/[clio_session_ref]/PartnerRenderClient.tsx'),
  'utf8'
)
const adapterSource = fs.readFileSync(path.resolve(__dirname, '../../lib/voice/openai-realtime-adapter.ts'), 'utf8')

describe('B2B-61 Part C (unchanged) — live-render.ts still returns Hume\'s own assembledPrompt for both content modes', () => {
  it('LiveRenderResult declares assembledPrompt on both the template and inline "ok" variants', () => {
    const typeMatch = liveRenderSource.match(/export type LiveRenderResult =[\s\S]*?\n\n/)
    expect(typeMatch).not.toBeNull()
    const occurrences = typeMatch![0].match(/assembledPrompt: string \| null/g) ?? []
    expect(occurrences).toHaveLength(2)
  })

  it('resolveLiveSessionRender (template mode) still sets and returns Hume\'s assembledPrompt', () => {
    expect(liveRenderSource).toContain('assembledPrompt = prompt')
    expect(liveRenderSource).toMatch(/mode: 'template',[\s\S]*?assembledPrompt,/)
  })

  it('resolveInlineSessionRender (inline mode) still sets and returns Hume\'s assembledPrompt', () => {
    expect(liveRenderSource).toMatch(/mode: 'inline',[\s\S]*?assembledPrompt,/)
  })

  it('page.tsx still passes voiceInstructions={result.assembledPrompt} at both call sites (Hume\'s path, unchanged)', () => {
    const occurrences = pageSource.match(/voiceInstructions=\{result\.assembledPrompt\}/g) ?? []
    expect(occurrences).toHaveLength(2)
  })

  it('the shared Hume template file itself is untouched by this rewrite (no OpenAI-only symbol leaked in)', () => {
    expect(HUME_NATIVE_PROMPT_TEMPLATE).not.toContain('OPENAI')
  })
})

describe('B2B-68 (2026-08-02) — live-render.ts computes an independent assembledOpenAIPrompt, never derived from Hume\'s', () => {
  it('LiveRenderResult declares assembledOpenAIPrompt on both the template and inline "ok" variants', () => {
    const typeMatch = liveRenderSource.match(/export type LiveRenderResult =[\s\S]*?\n\n/)
    expect(typeMatch).not.toBeNull()
    const occurrences = typeMatch![0].match(/assembledOpenAIPrompt: string \| null/g) ?? []
    expect(occurrences).toHaveLength(2)
  })

  it('imports assembleOpenAIRealtimePrompt from its own dedicated, self-contained module', () => {
    expect(liveRenderSource).toContain("import { assembleOpenAIRealtimePrompt } from '@/lib/voice/openai-realtime-prompt-template'")
  })

  it('resolveLiveSessionRender (template mode) sets and returns assembledOpenAIPrompt', () => {
    expect(liveRenderSource).toContain('assembledOpenAIPrompt = assembleOpenAIRealtimePrompt(')
    expect(liveRenderSource).toMatch(/mode: 'template',[\s\S]*?assembledOpenAIPrompt,/)
  })

  it('resolveInlineSessionRender (inline mode) sets and returns assembledOpenAIPrompt', () => {
    expect(liveRenderSource).toMatch(/mode: 'inline',[\s\S]*?assembledOpenAIPrompt,/)
  })

  it('assembleOpenAIRealtimePrompt is called twice (once per content mode), independently of assembleHumeNativePrompt', () => {
    const occurrences = liveRenderSource.match(/assembleOpenAIRealtimePrompt\(\{/g) ?? []
    expect(occurrences).toHaveLength(2)
  })

  it('page.tsx passes openaiVoiceInstructions={result.assembledOpenAIPrompt} at both call sites', () => {
    const occurrences = pageSource.match(/openaiVoiceInstructions=\{result\.assembledOpenAIPrompt\}/g) ?? []
    expect(occurrences).toHaveLength(2)
  })

  it('neither assembleOpenAIRealtimePrompt() call site passes a sessionContentMode field anymore (2026-08-02 — removed, single mode only; Hume\'s own assembleHumeNativePrompt() calls legitimately keep their own sessionContentMode, untouched)', () => {
    let searchFrom = 0
    let found = 0
    for (;;) {
      const callIdx = liveRenderSource.indexOf('assembleOpenAIRealtimePrompt({', searchFrom)
      if (callIdx === -1) break
      found += 1
      const windowEnd = liveRenderSource.indexOf('conversationLanguage:', callIdx)
      expect(windowEnd).toBeGreaterThan(callIdx)
      expect(liveRenderSource.slice(callIdx, windowEnd)).not.toContain('sessionContentMode')
      searchFrom = callIdx + 1
    }
    expect(found).toBe(2)
  })
})

describe('B2B-68 — PartnerRenderClient.tsx uses the new single OpenAI prompt, no concatenation', () => {
  it('PartnerRenderClientProps declares openaiVoiceInstructions: string | null', () => {
    const interfaceMatch = clientSource.match(/export interface PartnerRenderClientProps \{[\s\S]*?\n\}/)
    expect(interfaceMatch).not.toBeNull()
    expect(interfaceMatch![0]).toMatch(/openaiVoiceInstructions:\s*string\s*\|\s*null/)
  })

  it('the component destructures openaiVoiceInstructions from props', () => {
    const destructureMatch = clientSource.match(/export default function PartnerRenderClient\(\{([\s\S]*?)\}:\s*PartnerRenderClientProps\)/)
    expect(destructureMatch).not.toBeNull()
    expect(destructureMatch![1]).toMatch(/openaiVoiceInstructions,?/)
  })

  it('OpenAIRealtimeAdapter.create() is given openaiVoiceInstructions directly, falling back to the placeholder only when null — no concatenation with any second document', () => {
    expect(clientSource).toMatch(/instructions:\s*\n\s*openaiVoiceInstructions\s*\?\?/)
  })

  it('never IMPORTS the old, now-deleted persona module or its export (a prose comment mentioning it as historical context is fine and expected)', () => {
    expect(clientSource).not.toContain("from '@/lib/voice/openai-realtime-persona'")
    expect(clientSource).not.toMatch(/^\s*import.*OPENAI_VOICE_PERSONA_INSTRUCTIONS/m)
  })

  it('the old persona file no longer exists on disk', () => {
    const personaPath = path.resolve(__dirname, '../../lib/voice/openai-realtime-persona.ts')
    expect(fs.existsSync(personaPath)).toBe(false)
  })
})

describe('B2B-68 — the new OpenAI prompt template is genuinely self-contained', () => {
  const templateSource = fs.readFileSync(path.resolve(__dirname, '../../lib/voice/openai-realtime-prompt-template.ts'), 'utf8')

  it('does not IMPORT anything from lib/voice/hume-native/prompt-template.ts or the deleted persona module (prose comments naming them as historical context are fine and expected)', () => {
    expect(templateSource).not.toMatch(/^\s*import.*from '@\/lib\/voice\/hume-native\/prompt-template'/m)
    expect(templateSource).not.toMatch(/^\s*import.*openai-realtime-persona/m)
  })

  it('the shared Hume template does not import anything from this new OpenAI-only file', () => {
    const humeSource = fs.readFileSync(path.resolve(__dirname, '../../lib/voice/hume-native/prompt-template.ts'), 'utf8')
    expect(humeSource).not.toContain('openai-realtime-prompt-template')
  })

  it('OPENAI_PROMPT_TEMPLATE_VERSION is exported and versioned independently of the shared template\'s PROMPT_TEMPLATE_VERSION', () => {
    expect(OPENAI_PROMPT_TEMPLATE_VERSION).toBe('v7')
  })

  // 2026-08-02 — Arun reviewed the pre-B2B-68 prompt directly and asked for every tone/personality
  // aspect from it back, reworded to avoid the original's redundancy rather than pasted verbatim.
  // Supersedes this describe block's earlier "consolidated down to 3 sections" test.
  it('=== HOW YOU SOUND === covers every aspect from the pre-B2B-68 prompt: accent/affect, tone/emotion, pacing, pronunciation, teaching manner, personality, and overall experience', () => {
    expect(OPENAI_REALTIME_PROMPT_TEMPLATE).toContain('=== HOW YOU SOUND ===')
    expect(OPENAI_REALTIME_PROMPT_TEMPLATE).toContain('Accent and affect:')
    expect(OPENAI_REALTIME_PROMPT_TEMPLATE).toContain('Tone and emotion:')
    expect(OPENAI_REALTIME_PROMPT_TEMPLATE).toContain('Pacing:')
    expect(OPENAI_REALTIME_PROMPT_TEMPLATE).toContain('Pronunciation:')
    expect(OPENAI_REALTIME_PROMPT_TEMPLATE).toContain('Teaching manner:')
    expect(OPENAI_REALTIME_PROMPT_TEMPLATE).toContain('Personality:')
    expect(OPENAI_REALTIME_PROMPT_TEMPLATE).toContain('Overall experience:')
    // Restored guardrails that had gone missing during the original consolidation pass.
    expect(OPENAI_REALTIME_PROMPT_TEMPLATE).toContain('never performative')
    expect(OPENAI_REALTIME_PROMPT_TEMPLATE).toContain('not enthusiasm for its own sake')
    expect(OPENAI_REALTIME_PROMPT_TEMPLATE).toContain('applying what they\'ve learned')
  })

  it('the assistant is described as an "AI Coach," not an "AI business coach" — not scoped to business/strategy/technology only', () => {
    expect(OPENAI_REALTIME_PROMPT_TEMPLATE).not.toContain('AI business coach')
    expect(OPENAI_REALTIME_PROMPT_TEMPLATE).toContain('AI Coach')
    expect(OPENAI_REALTIME_PROMPT_TEMPLATE.replace(/\s+/g, ' ')).toContain('well beyond just business, strategy, or technology')
  })

  it('rule 13 covers a participant-initiated end request, not the old wasted "this rule does not apply in this mode" no-op placeholder', () => {
    expect(OPENAI_REALTIME_PROMPT_TEMPLATE).toContain('13. Participant Asks to End')
    expect(OPENAI_REALTIME_PROMPT_TEMPLATE.replace(/\s+/g, ' ')).toContain('If the participant explicitly states or asks')
    expect(OPENAI_REALTIME_PROMPT_TEMPLATE).not.toContain('does not apply in this mode')
  })

  it('there is no template-mode-only text anywhere — a single unconditional rule 1 and rule 9 (2026-08-02: template mode removed entirely)', () => {
    const normalized = OPENAI_REALTIME_PROMPT_TEMPLATE.replace(/\s+/g, ' ')
    expect(normalized).not.toContain('explicitly say the word "overview"')
    expect(normalized).not.toContain('explicitly say the word "summary"')
    expect(normalized).not.toContain('Session Overview section')
    expect(normalized).not.toContain('Session Summary section')
  })

  it('assembleOpenAIRealtimePrompt no longer accepts a sessionContentMode field', () => {
    const assembled = assembleOpenAIRealtimePrompt({
      profileContext: '',
      intentContext: '',
      sessionContent: 'x',
      // @ts-expect-error — intentionally passing a field the input type no longer declares.
      sessionContentMode: 'template',
    })
    // Extra/unknown fields are simply ignored by the function — this just confirms the type no
    // longer offers it (via the ts-expect-error above) and that assembly still works regardless.
    expect(assembled).toContain('=== BEHAVIORAL RULES ===')
  })

  it('the BEHAVIORAL RULES section is grouped by call phase (Opening / Each topic / Closing / Throughout), not a flat numbered list', () => {
    const rulesSection = OPENAI_REALTIME_PROMPT_TEMPLATE.slice(OPENAI_REALTIME_PROMPT_TEMPLATE.indexOf('=== BEHAVIORAL RULES ==='))
    const openingIdx = rulesSection.indexOf('--- Opening ---')
    const topicIdx = rulesSection.indexOf('--- Each topic')
    const closingIdx = rulesSection.indexOf('--- Closing ---')
    const throughoutIdx = rulesSection.indexOf('--- Throughout the call ---')
    expect(openingIdx).toBeGreaterThan(-1)
    expect(topicIdx).toBeGreaterThan(openingIdx)
    expect(closingIdx).toBeGreaterThan(topicIdx)
    expect(throughoutIdx).toBeGreaterThan(closingIdx)
  })

  it('rule numbers run sequentially 1-13 in display order, with no gaps or out-of-order jumps (2026-08-02 renumbering, then the second pass inserting new rule 10)', () => {
    const rulesSection = OPENAI_REALTIME_PROMPT_TEMPLATE.slice(OPENAI_REALTIME_PROMPT_TEMPLATE.indexOf('=== BEHAVIORAL RULES ==='))
    const numbers = Array.from(rulesSection.matchAll(/^(\d+)\. /gm)).map((m) => Number(m[1]))
    expect(numbers).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13])
  })

  it('every rule has a short title immediately after its number (2026-08-02 titling pass)', () => {
    expect(OPENAI_REALTIME_PROMPT_TEMPLATE).toContain('1. Opening — Greeting, Encouragement, Readiness Check & Session Overview.')
    expect(OPENAI_REALTIME_PROMPT_TEMPLATE).toContain('4. Verification — Judge the Answer, Call record_verification_result, Then')
    expect(OPENAI_REALTIME_PROMPT_TEMPLATE).toContain('9. Closing Sequence — Recap, Confirm Nothing\'s Left, Say Goodbye, Then End')
    expect(OPENAI_REALTIME_PROMPT_TEMPLATE).toContain('10. Never Stop Mid-Sequence — A Tool Call Never Ends Your Turn.')
    expect(OPENAI_REALTIME_PROMPT_TEMPLATE).toContain('13. Participant Asks to End — Shortened Goodbye, Same end_session')
  })

  it('new rule 10 (Throughout) requires continuing to speak immediately after any tool call, and never stopping on a filler acknowledgment alone (2026-08-02 CEO-review turn-continuation fix)', () => {
    const normalized = OPENAI_REALTIME_PROMPT_TEMPLATE.replace(/\s+/g, ' ')
    expect(normalized).toContain('Nothing in this session ever ends your turn except one of exactly three')
    expect(normalized).toContain('Calling a tool')
    expect(normalized).toContain('does not end your turn and is never, by itself, a')
    expect(normalized).toContain('Never let a turn end on a filler acknowledgment or a self-narrating phrase')
  })

  // 2026-08-02 — the first live test call after v5 shipped walked straight through the gap: turn
  // 05 was "Nice, that's a strong start. Let me think about how to build on that." then ~12.5s of
  // total silence. Rule 10's filler list never named the "let me..." self-narrating pattern even
  // though rules 3/5/9c already ban it by name elsewhere in this file. Fixed in v6.
  it('rule 10\'s filler list explicitly names "let me/I\'ll/I\'m going to" self-narration and cites the actual turn-05 near-miss as a labeled bad example', () => {
    const normalized = OPENAI_REALTIME_PROMPT_TEMPLATE.replace(/\s+/g, ' ')
    expect(normalized).toContain('let me think about that')
    expect(normalized).toContain('let me build on that')
    expect(normalized).toContain('I\'ll build on that')
    expect(normalized).toContain('Rules 3, 5, and 9c already ban "let me," "I\'ll," and "I\'m going to" phrasing')
    expect(normalized).toContain('Nice, that\'s a strong start — let me think about how to build on that')
  })

  it('a global "tool call never ends your turn" banner sits directly under the BEHAVIORAL RULES heading, ahead of the numbered list', () => {
    const rulesSection = OPENAI_REALTIME_PROMPT_TEMPLATE.slice(OPENAI_REALTIME_PROMPT_TEMPLATE.indexOf('=== BEHAVIORAL RULES ==='))
    const normalized = rulesSection.replace(/\s+/g, ' ')
    expect(normalized).toContain('[GLOBAL RULE, APPLIES THROUGHOUT: A TOOL CALL NEVER ENDS YOUR TURN.')
    expect(rulesSection.indexOf('[GLOBAL RULE')).toBeLessThan(rulesSection.indexOf('1. Opening'))
  })

  it('bracketed turn-continuation markers sit right where the live-call evidence showed the model stopping: end of rule 3, mid-rule 4, end of rule 5, end of rule 8', () => {
    const normalized = OPENAI_REALTIME_PROMPT_TEMPLATE.replace(/\s+/g, ' ')
    expect(normalized).toContain('[show_visual DOES NOT END YOUR TURN — KEEP TEACHING IMMEDIATELY AFTER CALLING IT]')
    expect(normalized).toContain('[record_verification_result RETURNING A RESPONSE DOES NOT END YOUR TURN')
    expect(normalized).toContain('[advance_tab SUCCEEDING DOES NOT END YOUR TURN')
    expect(normalized).toContain('[THIS RECAP-AND-TRANSITION HAPPENS IMMEDIATELY AFTER advance_tab SUCCEEDS')
  })

  it('rule 1 carries a "speak this overview exactly once" marker (cheap insurance against the reported "double overview" symptom)', () => {
    const normalized = OPENAI_REALTIME_PROMPT_TEMPLATE.replace(/\s+/g, ' ')
    expect(normalized).toContain('[SPEAK THIS OVERVIEW EXACTLY ONCE PER SESSION')
  })

  it('rule 13 (participant asks to end) checks for genuine ambiguity first, motivated by the semantic_vad/empty-transcript finding', () => {
    const normalized = OPENAI_REALTIME_PROMPT_TEMPLATE.replace(/\s+/g, ' ')
    expect(normalized).toContain('make sure it is an actual, clear, unambiguous')
    expect(normalized).toContain('ask a brief clarifying question instead of ending the session')
  })

  it('rule 7 (session-length responsibility) no longer duplicates the Pacing section\'s "never rushed" guidance — pacing is stated in exactly one place', () => {
    const rule7 = OPENAI_REALTIME_PROMPT_TEMPLATE.slice(
      OPENAI_REALTIME_PROMPT_TEMPLATE.indexOf('7. Overall Session Length'),
      OPENAI_REALTIME_PROMPT_TEMPLATE.indexOf('8. Between Topics')
    )
    const normalizedRule7 = rule7.replace(/\s+/g, ' ')
    expect(normalizedRule7).not.toContain('teach with patience, not speed')
    expect(normalizedRule7.toLowerCase()).not.toContain('never rushed')
    expect(normalizedRule7).toContain('see the Pacing guidance above')
  })

  it('the Pacing section itself restores the "prioritize understanding over velocity" instruction that had gone missing during the original consolidation', () => {
    const pacingSection = OPENAI_REALTIME_PROMPT_TEMPLATE.slice(
      OPENAI_REALTIME_PROMPT_TEMPLATE.indexOf('Pacing:'),
      OPENAI_REALTIME_PROMPT_TEMPLATE.indexOf('Pronunciation:')
    )
    expect(pacingSection.replace(/\s+/g, ' ')).toContain('Prioritize the participant actually understanding the material over covering everything at maximum velocity')
  })

  it('includes an explicit, unmistakable === SESSION SHAPE === section stating overview -> topics -> farewell -> end_session', () => {
    const normalized = OPENAI_REALTIME_PROMPT_TEMPLATE.replace(/\s+/g, ' ')
    expect(OPENAI_REALTIME_PROMPT_TEMPLATE).toContain('=== SESSION SHAPE ===')
    expect(normalized).toContain('Do not call end_session until after you have actually spoken a real goodbye out loud')
  })

  it('rule 9c requires the actual goodbye words, not a description of saying them — covers the exact observed bug phrase', () => {
    const normalized = OPENAI_REALTIME_PROMPT_TEMPLATE.replace(/\s+/g, ' ')
    expect(normalized).toContain('the actual farewell words themselves')
    expect(normalized).toContain('"I\'ll wrap this up clearly,"')
    expect(normalized).toContain('"let me," "I\'ll," "I\'m going to," or similar')
  })

  it('rule 9c gives concrete SAMPLE PHRASES for the goodbye, mirroring rule 1\'s worked-example pattern for the greeting', () => {
    const normalized = OPENAI_REALTIME_PROMPT_TEMPLATE.replace(/\s+/g, ' ')
    expect(normalized).toContain('Sample phrases you can use directly')
    expect(normalized).toContain('"Take care, talk soon — bye for now,"')
  })

  it('has exactly one closing/goodbye/end_session MECHANISM (rule 9c), applied at exactly five triggers — no second, disconnected, competing closing paragraph anywhere in the file', () => {
    // Whitespace-normalized so line-wrapping inside the template literal (e.g. "end_session\n
    // tool.") doesn't hide/split a real occurrence.
    const normalized = OPENAI_REALTIME_PROMPT_TEMPLATE.replace(/\s+/g, ' ')
    const endSessionMentions = (normalized.match(/call the end_session tool/g) ?? []).length
    // Five legitimate mentions, all pointing at the SAME single mechanism, never a competing
    // second version of it: (1) === SESSION SHAPE ==='s framing sentence ("only then, call the
    // end_session tool"), (2) rule 4's total-silence graceful closing (2026-08-02 addition),
    // (3) rule 4's repeated-garbled-speech graceful closing (2026-08-02 CEO-review follow-up
    // addition — note rule 1's own silence-escape says "calling", not "call", so it doesn't add a
    // 6th match here; it's still covered by its own dedicated test), (4) rule 9c (self-initiated
    // close), (5) rule 13, was rule 12 before the second CEO-review pass inserted new rule 10
    // (participant-initiated close) — rule 13's own text explicitly says "exactly as rule 9c
    // already establishes." Anything beyond 5 would indicate a reintroduced duplicate; anything
    // less would mean one of the five legitimate references lost its own end_session requirement.
    expect(endSessionMentions).toBe(5)
  })
})

describe('B2B-68 — transition/advancement substance is unchanged (Arun\'s explicit, repeated instruction not to touch it)', () => {
  const humeSource = fs.readFileSync(path.resolve(__dirname, '../../lib/voice/hume-native/prompt-template.ts'), 'utf8')

  function extractRule(source: string, startMarker: string, endMarker: string): string {
    const start = source.indexOf(startMarker)
    const end = source.indexOf(endMarker, start)
    expect(start).toBeGreaterThan(-1)
    expect(end).toBeGreaterThan(start)
    return source.slice(start, end)
  }

  it('rule 3 (show_visual) core mechanics/anti-narration guard are identical in substance (whitespace-normalized) between the two files', () => {
    const humeRule3 = extractRule(humeSource, '3. For every section', '4. After teaching')
    const openaiRule3 = extractRule(OPENAI_REALTIME_PROMPT_TEMPLATE, '3. Show the Visual', '4. Verification')
    const normalize = (t: string) => t.replace(/\s+/g, ' ').trim()
    // Two intentional, documented differences are stripped before comparing (both explained in the
    // module doc comment above the template): (1) each file's own equivalent, toggle-gated
    // placeholder token (Hume's raw source still has the unevaluated `${ADAPTIVE_DELIVERY_PLACEHOLDER}`
    // syntax since humeSource is read via fs.readFileSync; OPENAI_REALTIME_PROMPT_TEMPLATE is
    // imported as an evaluated JS value, so its own placeholder already resolved to its literal
    // bracketed value at module load); (2) this file's OpenAI-only rule title and trailing
    // turn-continuation bracket marker — Hume's own turn-taking model doesn't need an explicit
    // response.create to keep speaking after a tool result the way OpenAI Realtime does, so
    // there's nothing on Hume's side to mirror for this specific addition.
    const openaiRule3Stripped = normalize(openaiRule3)
      .replace('3. Show the Visual — Sync the Screen Before Teaching Each Section.', '3.')
      .replace(' in that same turn — [show_visual DOES NOT END YOUR TURN — KEEP TEACHING IMMEDIATELY AFTER CALLING IT].', '.')
      .replace('[ADAPTIVE DELIVERY GUIDANCE]', '')
    expect(openaiRule3Stripped).toBe(normalize(humeRule3).replace('${ADAPTIVE_DELIVERY_PLACEHOLDER}', ''))
  })

  // 2026-08-02 — B2B items 6/7 intentionally diverged rule 5 (and rule 4) between the two files:
  // OpenAI's advance_tab is now gated on a new record_verification_result tool call (the
  // code-enforced "ready to advance" signal — see docs/2026-08-02-farewell-narration-findings.md
  // §6), replacing trust in the model's own unaided judgment. Hume's tools are configured on
  // Hume's own hosted dashboard (lib/voice/hume-native/config-provisioner.ts), out of reach for
  // this build, so Hume's rule 5 is deliberately left unchanged.
  it('rule 5 (advance_tab): Hume keeps its original wording; OpenAI gains the record_verification_result gate', () => {
    const humeRule5 = extractRule(humeSource, '5. When you judge', '6. If the participant asks')
    expect(humeRule5).toContain('5. When you judge a section is complete')
    expect(humeRule5).not.toContain('record_verification_result')

    const openaiRule5 = extractRule(OPENAI_REALTIME_PROMPT_TEMPLATE, '5. Advance the Topic', '6. In-Session Questions')
    const openaiRule5Normalized = openaiRule5.replace(/\s+/g, ' ')
    expect(openaiRule5Normalized).toContain("record_verification_result's response")
    expect(openaiRule5Normalized).toContain('advance_tab only succeeds once that condition has actually been met')
    expect(openaiRule5Normalized).toContain('[advance_tab SUCCEEDING DOES NOT END YOUR TURN')
  })

  // 2026-08-02 — this rule is numbered 11 in Hume's file (unchanged, flat numbering) but 8 in this
  // file, purely because of this file's own renumbering (see module doc comment) — content is still
  // required to be byte-for-byte identical in substance regardless of the number.
  it('the inter-topic recap-then-transition rule (Hume\'s rule 11, this file\'s rule 8) is identical in substance (whitespace-normalized) between the two files', () => {
    function extractInclusive(source: string, startMarker: string, anchor: string): string {
      const start = source.indexOf(startMarker)
      const anchorIndex = source.indexOf(anchor, start)
      expect(start).toBeGreaterThan(-1)
      expect(anchorIndex).toBeGreaterThan(start)
      return source.slice(start, anchorIndex + anchor.length)
    }
    const anchor = 'expect to summarize at the end.'
    const humeRule = extractInclusive(humeSource, '11. Before moving', anchor)
    const openaiRule = extractInclusive(OPENAI_REALTIME_PROMPT_TEMPLATE, '8. Between Topics', anchor)
    // Strip each file's own leading number+title down to the same neutral marker before comparing —
    // Hume has no title (just "11."); this file has an OpenAI-only title (2026-08-02 titling pass,
    // documented in the module doc comment) that needs stripping down to that same baseline. The
    // internal cross-reference to the closing-sequence rule also correctly differs (rule 8 in Hume's
    // numbering, rule 9 in this file's) and is normalized the same way. The trailing turn-continuation
    // bracket marker doesn't need stripping — it comes after `anchor`, so extraction stops before it.
    const normalize = (text: string) => text.replace(/\s+/g, ' ').trim()
    const humeNormalized = normalize(humeRule).replace(/^11\./, 'RULE.').replace('described in rule 8,', 'described in rule 9,')
    const openaiNormalized = normalize(openaiRule)
      .replace('8. Between Topics — Recap What Was Covered, Then Name and Start the Next One.', 'RULE.')
    expect(openaiNormalized).toBe(humeNormalized)
  })
})

describe('B2B-68 — assembleOpenAIRealtimePrompt() produces correct output', () => {
  const BASE_INPUT = {
    profileContext: 'Executive in fintech.',
    intentContext: '',
    sessionContent: 'Section 1 content here.',
  }

  it('default (unconfigured): no leftover bracketed placeholder tags in the output', () => {
    const assembled = assembleOpenAIRealtimePrompt(BASE_INPUT)
    expect(assembled).not.toMatch(/\[RULE \d+ TEXT\]/)
    expect(assembled).not.toContain('[TONE GUIDANCE]')
    expect(assembled).not.toContain('[PARTNER CONFIGURED GUIDANCE]')
    expect(assembled).not.toContain('[AUDIENCE]')
    expect(assembled).not.toContain('[PARTICIPANT NAME]')
    expect(assembled).not.toContain('[INDUSTRY CLAUSE]')
    expect(assembled).not.toContain('[LANGUAGE INSTRUCTION]')
    expect(assembled).not.toContain('[CONTEXT]')
    expect(assembled).not.toContain('[SESSION CONTENT]')
  })

  it('rule 1 resolves to the warm-icebreaker/agenda text, participant name substituted, with no mode to select', () => {
    const assembled = assembleOpenAIRealtimePrompt(BASE_INPUT)
    const normalized = assembled.replace(/\s+/g, ' ')
    expect(normalized).toContain("Open the session warmly and with genuine energy. Greet the participant — use their name naturally")
    expect(normalized).toContain('if none was provided, this will simply read as "the participant," so greet warmly and generically instead of speaking that phrase aloud. Introduce yourself briefly by name, then ask how they\'re doing today')
  })

  it('participant name substitutes correctly into rule 1\'s greeting', () => {
    const assembled = assembleOpenAIRealtimePrompt({ ...BASE_INPUT, participantName: 'Dana' })
    expect(assembled).toContain('Greet Dana — use their name naturally')
    expect(assembled).toContain('Introduce yourself briefly by name')
  })

  // 2026-08-02 — a blank/whitespace-only assistantName (e.g. an empty-string partner theme setting
  // or reseller API field) must never leak into the template literally, producing a broken "You are
  // , an AI Coach" self-introduction. Per Arun's explicit instruction, blank always defaults to Clio.
  it.each(['', '   ', undefined])('a blank/whitespace/undefined assistantName (%j) defaults to Clio, never a broken self-introduction', (assistantName) => {
    const assembled = assembleOpenAIRealtimePrompt({ ...BASE_INPUT, assistantName })
    expect(assembled).toContain('You are Clio, an AI Coach')
    expect(assembled).not.toContain('You are , an AI Coach')
  })

  it('a real assistantName still substitutes correctly', () => {
    const assembled = assembleOpenAIRealtimePrompt({ ...BASE_INPUT, assistantName: 'Nova' })
    expect(assembled).toContain('You are Nova, an AI Coach')
    expect(assembled).not.toContain('You are Clio, an AI Coach')
  })

  // 2026-08-02 — CEO-review follow-up: the audienceDescription default was still the literal old
  // string 'a senior executive', so any call site that omitted it would still tell the model its
  // listener is an executive — directly contradicting the "AI Coach, not exec-scoped" rename.
  it('audienceDescription defaults to a role-neutral phrase, never the retired executive-only wording', () => {
    const assembled = assembleOpenAIRealtimePrompt(BASE_INPUT)
    expect(assembled).toContain('delivering a live, one-on-one coaching\nsession to the participant')
    expect(assembled).not.toContain('a senior executive')
  })

  it('partner-configured promptBehavior renders inside === PARTNER-CONFIGURED GUIDANCE ===, after the fixed rules', () => {
    const assembled = assembleOpenAIRealtimePrompt({
      ...BASE_INPUT,
      promptBehavior: { goodbyeLine: { mode: 'literal', text: 'Catch you next time!' } },
    })
    expect(assembled).toContain('=== PARTNER-CONFIGURED GUIDANCE ===')
    expect(assembled).toContain('Catch you next time!')
    expect(assembled.indexOf('=== PARTNER-CONFIGURED GUIDANCE ===')).toBeGreaterThan(assembled.indexOf('=== BEHAVIORAL RULES ==='))
  })

  it('byte-identical assembled output for two calls with the same input (pure function, no hidden state)', () => {
    const a = assembleOpenAIRealtimePrompt(BASE_INPUT)
    const b = assembleOpenAIRealtimePrompt(BASE_INPUT)
    expect(a).toBe(b)
  })
})

describe('B2B-61 Part C (unchanged) — voice selection', () => {
  it('openai-realtime-adapter.ts requests the "marin" voice, not the placeholder "alloy"', () => {
    expect(adapterSource).not.toContain("voice: 'alloy'")
    expect(adapterSource).toContain("voice: 'marin'")
  })

  it('requests speed: 1.0 (2026-08-01 round 2: reverted from 0.9 after live test — warmth/pacing pursued via prompt instructions, not the flat rate lever)', () => {
    expect(adapterSource).not.toContain('speed: 0.7')
    expect(adapterSource).not.toContain('speed: 0.9')
    expect(adapterSource).toContain('speed: 1.0')
  })
})
