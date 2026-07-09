import { describe, it, expect } from 'vitest'
import { buildSessionScript, buildSessionSummary } from '@/lib/clio-context-builder'

/**
 * SESSCTX-01 — coverage for buildSessionSummary() and the byte-identical
 * regression guarantee for buildSessionScript(), per requirement doc Section
 * 7 acceptance tests 1-4 and 6-7. Test 5 (a real/fully-simulated live Hume
 * session reaching show_visual/advance_tab for every index and calling
 * end_session only at the true end) is a manual/QA-run acceptance test, not
 * a unit test — it is not covered here, per the spec's own framing.
 */

// Minimal local shapes mirroring lib/clio-context-builder.ts's internal
// (non-exported) Section / TrainingScript types structurally — TypeScript's
// structural typing lets these satisfy the exported functions' parameters
// without needing to widen the module's exports for this test.
interface Segment {
  type: 'TEACH' | 'CHECKPOINT' | 'ICE_BREAKER' | 'PROBE' | 'CONTINUE' | 'CLOSE'
  content: string
  variants?: {
    v1_perfect?: string
    v2_correct_incomplete?: string
    v3_partial_gap?: string
    v4_adjacent_wrong?: string
    v5_incorrect?: string
    v6_dont_know?: string
    v7_explain_again?: string
  }
}

interface TrainingScript {
  subtopic_title: string
  subtopic_slug: string
  segments: Segment[]
}

interface Section {
  id: string
  type?: string
  meta: { subtopicTitle: string; sessionTitle?: string }
  data?: unknown
}

function realSection(id: string, title: string): Section {
  return { id, type: 'DefinitionTriptych', meta: { subtopicTitle: title } }
}

function trainingScriptWithTeach(title: string, teach: string, checkpoint?: string): TrainingScript {
  const segments: Segment[] = [{ type: 'TEACH', content: teach }]
  if (checkpoint) {
    segments.push({
      type: 'CHECKPOINT',
      content: checkpoint,
      variants: {
        v1_perfect: 'Nailed it.',
        v2_correct_incomplete: 'Right, missing a piece.',
        v3_partial_gap: 'Partial.',
        v4_adjacent_wrong: 'Adjacent.',
        v5_incorrect: 'Incorrect.',
        v6_dont_know: "Don't know.",
        v7_explain_again: 'Explain again.',
      },
    })
  }
  return { subtopic_title: title, subtopic_slug: title.toLowerCase().replace(/\s+/g, '-'), segments }
}

function overviewSection(totalIncludingBookends: number): Section {
  return {
    id: 'session-overview',
    type: 'SessionOverview',
    meta: { subtopicTitle: 'Session Overview' },
    data: {
      script: {
        teach: 'Today we are covering three things. Let us get started.',
        checkpoint: 'Does that agenda work for you?',
        continue: "Perfect — let's dive into the first one.",
      },
    },
  }
}

function summarySection(): Section {
  return {
    id: 'session-summary',
    type: 'SessionSummary',
    meta: { subtopicTitle: 'Session Summary' },
    data: {
      script: {
        teach: "That's a wrap. Today we covered a lot of ground.",
        checkpoint: 'How did that feel?',
        continue: 'Nice work today. Talk soon.',
      },
    },
  }
}

/** Builds a full N-real-section + bookends fixture, mirroring wrapSectionsWithBookends' shape. */
function buildFixture() {
  const sections: Section[] = [
    overviewSection(5),
    realSection('model-choice', 'Choosing Your Model: Haiku vs. Sonnet vs. Opus'),
    realSection('context-windows', 'Context Windows and Tokens'),
    realSection('no-script', 'Section With No Training Script'),
    summarySection(),
  ]

  const trainingScripts: (TrainingScript | null)[] = [
    null, // overview — read from data.script, not trainingScripts
    trainingScriptWithTeach(
      'Choosing Your Model: Haiku vs. Sonnet vs. Opus',
      'Model selection in the Claude API is not a one-time architectural decision — it is a per-request engineering trade-off that directly shapes your system\'s cost structure, latency, and output quality. Anthropic offers three tiers: Haiku (speed and economy), Sonnet (the balanced workhorse), and Opus (maximum reasoning depth).',
      'Given what we just covered, which of your team\'s current AI features do you think is using the wrong-tier model right now?'
    ),
    trainingScriptWithTeach('Context Windows and Tokens', 'Short clause only.'),
    null, // no training script at all — exercises the fallback path
    null, // summary — read from data.script, not trainingScripts
  ]

  return { sections, trainingScripts }
}

describe('buildSessionScript (regression — must be completely unaffected)', () => {
  it('produces unchanged output shape/content for a fixture (flag-equivalent regression)', () => {
    const { sections, trainingScripts } = buildFixture()
    const output = buildSessionScript(sections as never, trainingScripts as never)

    expect(output).toContain('=== SESSION SCRIPT ===')
    expect(output).toContain('Deliver each section\'s TEACH script after calling show_visual.')
    // Bookend full content intact
    expect(output).toContain('Today we are covering three things. Let us get started.')
    expect(output).toContain("That's a wrap. Today we covered a lot of ground.")
    // Real section literal TEACH paragraph intact (not summarized)
    expect(output).toContain(
      'Model selection in the Claude API is not a one-time architectural decision'
    )
    // Literal checkpoint + V1-V7 variants intact
    expect(output).toContain(
      "Given what we just covered, which of your team's current AI features do you think is using the wrong-tier model right now?"
    )
    expect(output).toContain('V1 (nailed it + added insight)')
    expect(output).toContain('V7 (explain again)')
    // Snapshot-style stability check: calling twice with the same input is deterministic
    const secondCall = buildSessionScript(sections as never, trainingScripts as never)
    expect(secondCall).toBe(output)
  })
})

describe('buildSessionSummary — structural tests', () => {
  it('emits header lines with identical index/format to buildSessionScript for the same sections array', () => {
    const { sections, trainingScripts } = buildFixture()
    const scriptOutput = buildSessionScript(sections as never, trainingScripts as never)
    const summaryOutput = buildSessionSummary(sections as never, trainingScripts as never)

    const headerRe = /--- SECTION (\d+)\/(\d+): "([^"]+)" --- \[call show_visual\(\{ section_index: (\d+) \}\)\]/g

    const extractHeaders = (text: string) =>
      Array.from(text.matchAll(headerRe)).map((m) => ({ i: m[1], total: m[2], title: m[3], idx: m[4] }))

    const scriptHeaders = extractHeaders(scriptOutput)
    const summaryHeaders = extractHeaders(summaryOutput)

    expect(summaryHeaders).toEqual(scriptHeaders)
    expect(summaryHeaders.length).toBe(sections.length)
  })

  it('contains no literal V1-V7 checkpoint-variant markers anywhere in non-bookend output', () => {
    const { sections, trainingScripts } = buildFixture()
    const summaryOutput = buildSessionSummary(sections as never, trainingScripts as never)

    for (const marker of ['V1 (', 'V2 (', 'V3 (', 'V4 (', 'V5 (', 'V6 (', 'V7 (']) {
      expect(summaryOutput).not.toContain(marker)
    }
    // The literal checkpoint question text must not leak into summary mode either.
    expect(summaryOutput).not.toContain(
      "Given what we just covered, which of your team's current AI features do you think is using the wrong-tier model right now?"
    )
  })

  it('gives bookend sections their full, unabridged content identical to buildSessionScript output', () => {
    const { sections, trainingScripts } = buildFixture()
    const scriptOutput = buildSessionScript(sections as never, trainingScripts as never)
    const summaryOutput = buildSessionSummary(sections as never, trainingScripts as never)

    const extractBlock = (text: string, sectionTitle: string) => {
      const lines = text.split('\n')
      const startIdx = lines.findIndex((l) => l.includes(`"${sectionTitle}"`))
      expect(startIdx).toBeGreaterThanOrEqual(0)
      const nextHeaderIdx = lines
        .slice(startIdx + 1)
        .findIndex((l) => l.startsWith('--- SECTION'))
      const endIdx = nextHeaderIdx === -1 ? lines.length : startIdx + 1 + nextHeaderIdx
      return lines.slice(startIdx, endIdx).join('\n')
    }

    const overviewScriptBlock = extractBlock(scriptOutput, 'Session Overview')
    const overviewSummaryBlock = extractBlock(summaryOutput, 'Session Overview')
    expect(overviewSummaryBlock).toBe(overviewScriptBlock)

    const summaryScriptBlock = extractBlock(scriptOutput, 'Session Summary')
    const summarySummaryBlock = extractBlock(summaryOutput, 'Session Summary')
    expect(summarySummaryBlock).toBe(summaryScriptBlock)
  })

  it('uses the fallback string when a section has no training script / TEACH segment, without throwing or emitting undefined', () => {
    const { sections, trainingScripts } = buildFixture()
    expect(() => buildSessionSummary(sections as never, trainingScripts as never)).not.toThrow()

    const summaryOutput = buildSessionSummary(sections as never, trainingScripts as never)
    expect(summaryOutput).toContain(
      '(No prepared script — explain the key concepts for this topic from the Topic Knowledge Base above, in plain language.)'
    )
    expect(summaryOutput).not.toContain('undefined')
    expect(summaryOutput).not.toContain('null')
  })

  it('truncates the ~40-word cap at a sentence boundary, never mid-sentence', () => {
    const longTeach =
      'Model selection in the Claude API is not a one-time architectural decision — it is a per-request engineering trade-off that directly shapes your system\'s cost structure, latency, and output quality. Anthropic offers three tiers: Haiku (speed and economy), Sonnet (the balanced workhorse), and Opus (maximum reasoning depth). Over-provisioning Opus for simple tasks burns budget.'

    const sections: Section[] = [realSection('model-choice', 'Choosing Your Model')]
    const trainingScripts: (TrainingScript | null)[] = [
      trainingScriptWithTeach('Choosing Your Model', longTeach),
    ]

    const output = buildSessionSummary(sections as never, trainingScripts as never)
    const lines = output.split('\n')
    const labelIdx = lines.findIndex((l) => l.includes('What to cover'))
    const whatToCoverLine = lines[labelIdx + 1]

    // Must end on a sentence boundary (a terminal punctuation mark), not mid-word/mid-sentence.
    expect(/[.!?]$/.test(whatToCoverLine.trim())).toBe(true)
    // Must not include the third sentence (well beyond the ~40-word/~260-char cap).
    expect(whatToCoverLine).not.toContain('Over-provisioning Opus for simple tasks burns budget.')
    // Must not be empty.
    expect(whatToCoverLine.trim().length).toBeGreaterThan(0)
  })

  it('never pads content shorter than the cap', () => {
    const shortTeach = 'Short clause only.'
    const sections: Section[] = [realSection('short', 'A Short Section')]
    const trainingScripts: (TrainingScript | null)[] = [
      trainingScriptWithTeach('A Short Section', shortTeach),
    ]

    const output = buildSessionSummary(sections as never, trainingScripts as never)
    const lines = output.split('\n')
    const labelIdx = lines.findIndex((l) => l.includes('What to cover'))
    const whatToCoverLine = lines[labelIdx + 1]

    expect(whatToCoverLine.trim()).toBe(shortTeach)
  })
})
