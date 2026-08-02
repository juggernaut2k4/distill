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
 * document in front of it client-side. **Superseded 2026-08-02 by B2B-68**, per Arun's direct
 * instruction: "i dont want you to concatenate and send 2 files instead generate only one prompt
 * template for openai and send that. no need to take 2 files, concatenate and then send. that is
 * confusing and risky." The two-document concatenation was the confirmed root cause of the
 * closing/goodbye instruction existing in two disconnected places (persona's incomplete version,
 * prepended first; the shared template's rule 8c, positioned much later) — a real test call ended
 * with Marin saying "Let me wrap this up clearly" and dropping off with zero farewell.
 *
 * This file now tests the B2B-68 replacement: OpenAI Realtime gets its own single,
 * self-contained prompt (`lib/voice/openai-realtime-prompt-template.ts`), computed independently
 * server-side in `lib/partner/live-render.ts` alongside (never derived from) Hume's own
 * `assembledPrompt`. The Hume-specific assertions below (still passing, unchanged) prove Hume's
 * path was not touched by this rewrite.
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
    expect(OPENAI_PROMPT_TEMPLATE_VERSION).toBe('v2')
  })

  it('consolidates the old persona\'s 6 overlapping "warm/calm/unhurried" sections down to === HOW YOU SOUND ===\'s 3 tight, non-overlapping ones (Pacing/Pronunciation/Teaching manner) — no leftover "Accent/Affect"/"Personality Affect"/"Emotion"/"Interaction Style"/"Overall Experience" section headers', () => {
    expect(OPENAI_REALTIME_PROMPT_TEMPLATE).toContain('=== HOW YOU SOUND ===')
    expect(OPENAI_REALTIME_PROMPT_TEMPLATE).toContain('Pacing:')
    expect(OPENAI_REALTIME_PROMPT_TEMPLATE).toContain('Pronunciation:')
    expect(OPENAI_REALTIME_PROMPT_TEMPLATE).toContain('Teaching manner:')
    expect(OPENAI_REALTIME_PROMPT_TEMPLATE).not.toContain('Accent/Affect')
    expect(OPENAI_REALTIME_PROMPT_TEMPLATE).not.toContain('Personality Affect')
    expect(OPENAI_REALTIME_PROMPT_TEMPLATE).not.toContain('Emotion:')
    expect(OPENAI_REALTIME_PROMPT_TEMPLATE).not.toContain('Interaction Style:')
    expect(OPENAI_REALTIME_PROMPT_TEMPLATE).not.toContain('Overall Experience:')
  })

  it('rule 12 is repurposed (participant-initiated end, was rule 13) rather than left as the old wasted "this rule does not apply in this mode" no-op placeholder', () => {
    expect(OPENAI_REALTIME_PROMPT_TEMPLATE).toContain('12. If the participant explicitly states or asks')
    expect(OPENAI_REALTIME_PROMPT_TEMPLATE).not.toContain('does not apply in this mode')
  })

  it('the old rule 12\'s real (template-mode-only) content — "say the word overview/summary out loud" — is folded directly into rule 1\'s and rule 8\'s own template-mode text, not left occupying its own numbered slot', () => {
    const templateModeAssembled = assembleOpenAIRealtimePrompt({
      profileContext: '', intentContext: '', sessionContent: 'x', sessionContentMode: 'template',
    })
    const normalized = templateModeAssembled.replace(/\s+/g, ' ')
    expect(normalized).toContain('explicitly say the word "overview"')
    expect(normalized).toContain('explicitly say the word "summary"')

    // Inline mode has no equivalent text at all — nothing to announce, matching the reality that
    // inline sessions have nothing labeled "Overview"/"Summary" to call out.
    const inlineAssembled = assembleOpenAIRealtimePrompt({
      profileContext: '', intentContext: '', sessionContent: 'x', sessionContentMode: 'inline',
    })
    expect(inlineAssembled.replace(/\s+/g, ' ')).not.toContain('explicitly say the word')
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

  it('rule 7 (session-length responsibility) no longer duplicates the Pacing section\'s "never rushed" guidance — pacing is stated in exactly one place', () => {
    const rule7 = OPENAI_REALTIME_PROMPT_TEMPLATE.slice(
      OPENAI_REALTIME_PROMPT_TEMPLATE.indexOf('7. You are responsible'),
      OPENAI_REALTIME_PROMPT_TEMPLATE.indexOf('11. Before moving')
    )
    const normalizedRule7 = rule7.replace(/\s+/g, ' ')
    expect(normalizedRule7).not.toContain('teach with patience, not speed')
    expect(normalizedRule7.toLowerCase()).not.toContain('never rushed')
    expect(normalizedRule7).toContain('see the Pacing guidance above')
  })

  it('includes an explicit, unmistakable === SESSION SHAPE === section stating overview -> topics -> farewell -> end_session', () => {
    const normalized = OPENAI_REALTIME_PROMPT_TEMPLATE.replace(/\s+/g, ' ')
    expect(OPENAI_REALTIME_PROMPT_TEMPLATE).toContain('=== SESSION SHAPE ===')
    expect(normalized).toContain('Do not call end_session until after you have actually spoken a real goodbye out loud')
  })

  it('rule 8c requires the actual goodbye words, not a description of saying them — covers the exact observed bug phrase', () => {
    const normalized = OPENAI_REALTIME_PROMPT_TEMPLATE.replace(/\s+/g, ' ')
    expect(normalized).toContain('the actual farewell words themselves')
    expect(normalized).toContain('"I\'ll wrap this up clearly,"')
    expect(normalized).toContain('"let me," "I\'ll," "I\'m going to," or similar')
  })

  it('rule 8c gives concrete SAMPLE PHRASES for the goodbye, mirroring rule 1\'s worked-example pattern for the greeting', () => {
    const normalized = OPENAI_REALTIME_PROMPT_TEMPLATE.replace(/\s+/g, ' ')
    expect(normalized).toContain('Sample phrases you can use directly')
    expect(normalized).toContain('"Take care, talk soon — bye for now,"')
  })

  it('has exactly one closing/goodbye/end_session MECHANISM (rule 8c), applied at exactly two triggers — no second, disconnected, competing closing paragraph anywhere in the file', () => {
    // Whitespace-normalized so line-wrapping inside the template literal (e.g. "end_session\n
    // tool.") doesn't hide/split a real occurrence.
    const normalized = OPENAI_REALTIME_PROMPT_TEMPLATE.replace(/\s+/g, ' ')
    const endSessionMentions = (normalized.match(/call the end_session tool/g) ?? []).length
    // Three legitimate mentions, all pointing at the SAME single mechanism, never a competing
    // second version of it: (1) === SESSION SHAPE ==='s framing sentence ("only then, call the
    // end_session tool"), (2) rule 8c (self-initiated close), (3) rule 12 (participant-initiated
    // close, was rule 13 in the old shared template) — rule 12's own text explicitly says "exactly
    // as rule 8c already establishes." Anything beyond 3 would indicate a reintroduced duplicate;
    // anything less would mean one of the three legitimate references lost its own end_session
    // requirement.
    expect(endSessionMentions).toBe(3)
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

  it('rule 3 (show_visual) core mechanics/anti-narration guard are byte-for-byte identical between the two files', () => {
    const humeRule3 = extractRule(humeSource, '3. For every section', '4. After teaching')
    const openaiRule3 = extractRule(OPENAI_REALTIME_PROMPT_TEMPLATE, '3. For every section', '4. After teaching')
    // B2B-69 ported B2B-66's adaptive-teaching placeholder to this file too, in the same position
    // — both files now carry their own equivalent, toggle-gated placeholder token here (Hume's raw
    // source still has the unevaluated `${ADAPTIVE_DELIVERY_PLACEHOLDER}` syntax since humeSource is
    // read via fs.readFileSync; OPENAI_REALTIME_PROMPT_TEMPLATE is imported as an evaluated JS
    // value, so its own placeholder already resolved to its literal bracketed value at module load).
    // Stripping each file's own placeholder token is the only allowed difference.
    expect(humeRule3.replace('${ADAPTIVE_DELIVERY_PLACEHOLDER}', '')).toBe(
      openaiRule3.replace('[ADAPTIVE DELIVERY GUIDANCE]', '')
    )
  })

  // 2026-08-02 — B2B items 6/7 intentionally diverged rule 5 (and rule 4) between the two files:
  // OpenAI's advance_tab is now gated on a new record_verification_result tool call (the
  // code-enforced "ready to advance" signal — see docs/2026-08-02-farewell-narration-findings.md
  // §6), replacing trust in the model's own unaided judgment. Hume's tools are configured on
  // Hume's own hosted dashboard (lib/voice/hume-native/config-provisioner.ts), out of reach for
  // this build, so Hume's rule 5 is deliberately left unchanged. This replaces the old
  // byte-for-byte-identical assertion, which no longer holds by design.
  it('rule 5 (advance_tab): Hume keeps its original wording; OpenAI gains the record_verification_result gate', () => {
    const humeRule5 = extractRule(humeSource, '5. When you judge', '6. If the participant asks')
    expect(humeRule5).toContain('5. When you judge a section is complete')
    expect(humeRule5).not.toContain('record_verification_result')

    const openaiRule5 = extractRule(OPENAI_REALTIME_PROMPT_TEMPLATE, '5. Only once', '6. If the participant asks')
    const openaiRule5Normalized = openaiRule5.replace(/\s+/g, ' ')
    expect(openaiRule5Normalized).toContain("record_verification_result's response")
    expect(openaiRule5Normalized).toContain('advance_tab only succeeds once that condition has actually been met')
  })

  it('rule 11 (inter-topic recap-then-transition) is byte-for-byte identical between the two files', () => {
    // B2B-68's OpenAI document groups rules by call-phase (rule 11 is immediately followed by a
    // "--- Closing ---" section header, not "12. ..." like the flat-numbered Hume template) — so,
    // unlike rules 3/5 above, this extracts up through rule 11's own last sentence (a shared anchor
    // phrase present verbatim in both files) rather than up to whatever follows it structurally.
    function extractThroughAnchor(source: string, startMarker: string, anchor: string): string {
      const start = source.indexOf(startMarker)
      const anchorIndex = source.indexOf(anchor, start)
      expect(start).toBeGreaterThan(-1)
      expect(anchorIndex).toBeGreaterThan(start)
      return source.slice(start, anchorIndex + anchor.length)
    }
    const anchor = 'expect to summarize at the end.'
    const humeRule11 = extractThroughAnchor(humeSource, '11. Before moving', anchor)
    const openaiRule11 = extractThroughAnchor(OPENAI_REALTIME_PROMPT_TEMPLATE, '11. Before moving', anchor)
    expect(humeRule11).toBe(openaiRule11)
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

  it('defaults to template mode when sessionContentMode is omitted, matching assembleHumeNativePrompt\'s own default', () => {
    const assembled = assembleOpenAIRealtimePrompt(BASE_INPUT)
    const normalized = assembled.replace(/\s+/g, ' ')
    // Template-mode rule 1 now also folds in the old rule 12's "say the word overview out loud"
    // instruction (module doc comment) — this substring covers both without depending on exact
    // line-wrap placement. 2026-08-02 — B2B item 4 added an icebreaker requirement ahead of the
    // "overview" instruction (docs/2026-08-02-farewell-narration-findings.md §3 Issue 4).
    expect(normalized).toContain("Open the session warmly. Greet them, then ask how they're doing today")
    expect(normalized).toContain("immediately before you begin delivering the Session Overview section's content")
  })

  it('inline mode resolves rule 1 to the warm-icebreaker/agenda text, participant name substituted', () => {
    const assembled = assembleOpenAIRealtimePrompt({ ...BASE_INPUT, sessionContentMode: 'inline', participantName: 'Dana' })
    expect(assembled).toContain('Greet Dana, introduce yourself briefly')
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
