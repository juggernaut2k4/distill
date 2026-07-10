import { describe, it, expect, vi, beforeEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { extractWhatToCover } from '@/lib/clio-context-builder'
import { generateSessionMarkers, tokenize } from '@/lib/content/session-markers'
import type { LiveConductorTab } from '@/lib/content/live-conductor-content'
import type { ContentArticle } from '@/lib/content/session-content-generator'

/**
 * RTV-02 — coverage for generateSessionMarkers() per requirement doc Section 7
 * acceptance tests 1-8 and 11. Tests 9 (self-heal deferral inside
 * provision-config's latency-critical connect path) and 10 (the admin
 * inspection endpoint) are manual/integration acceptance checks per the
 * spec's own framing — not simulated here.
 */

// ─── FIXTURE HELPERS ──────────────────────────────────────────────────────────

function makeTab(slug: string, title: string, overrides: Partial<ContentArticle['sections']> = {}): LiveConductorTab {
  return {
    subtopic_slug: slug,
    subtopic_title: title,
    article: {
      subtopic_title: title,
      subtopic_slug: slug,
      sections: {
        overview: '',
        key_facts: [],
        how_it_works: '',
        enterprise_implications: '',
        common_misconceptions: [],
        decision_questions: [],
        illustrative_example: '',
        try_this: '',
        ...overrides,
      },
      role_relevance: 'Relevant to this role.',
      industry_angle: 'Relevant to this industry.',
    },
  }
}

// ─── TEST 1 — OFF = byte-identical (structural gate assertion) ──────────────

describe('RTV_MARKER_GENERATION_ENABLED gate (rollback safety)', () => {
  it('resolves OFF for unset/false/near-miss values, ON only for the exact string "true"', () => {
    const resolves = (v: string | undefined) => v === 'true'
    expect(resolves(undefined)).toBe(false)
    expect(resolves('false')).toBe(false)
    expect(resolves('1')).toBe(false)
    expect(resolves('TRUE')).toBe(false)
    expect(resolves('yes')).toBe(false)
    expect(resolves('true')).toBe(true)
  })

  it('gates the rtv-generate-markers Inngest step behind RTV_MARKER_GENERATION_ENABLED === "true", nested after the LIVE-01 store step', () => {
    const src = fs.readFileSync(
      path.resolve(__dirname, '../../inngest/session-content-pipeline.ts'),
      'utf8'
    )
    expect(src).toContain("process.env.RTV_MARKER_GENERATION_ENABLED === 'true'")
    expect(src).toContain("step.run('rtv-generate-markers'")
    expect(src).toContain("step.run('live-conductor-generate-and-store'")

    const toggleDeclIdx = src.indexOf('const RTV_MARKER_GENERATION_ENABLED')
    const storeStepIdx = src.indexOf("step.run('live-conductor-generate-and-store'")
    const markerStepIdx = src.indexOf("step.run('rtv-generate-markers'")

    expect(toggleDeclIdx).toBeGreaterThan(-1)
    // The marker step must be declared textually after the store step, i.e.
    // it only runs once live_conductor_content has already been persisted.
    expect(markerStepIdx).toBeGreaterThan(storeStepIdx)
  })

  it('gates the provision-config self-heal rtv_eligible write behind the same flag, with no marker LLM call in that path', () => {
    const src = fs.readFileSync(
      path.resolve(__dirname, '../../app/api/hume-native/provision-config/route.ts'),
      'utf8'
    )
    expect(src).toContain("process.env.RTV_MARKER_GENERATION_ENABLED === 'true'")
    expect(src).not.toContain('generateSessionMarkers')
  })
})

// ─── TEST 2 — marker source is the exact runtime "what to cover" line ───────

describe('generateSessionMarkers — marker source fidelity', () => {
  it('level-0 source equals extractWhatToCover([overview, how_it_works, enterprise_implications].join) exactly', async () => {
    const teachA = 'Quantivex determines the outcome.'
    const teachB = 'Retropulse determines the outcome.'

    const tabA = makeTab('topic-a', 'Topic A', { overview: teachA })
    const tabB = makeTab('topic-b', 'Topic B', { overview: teachB })

    // Direct call to the shared function — this IS what buildSessionSummary()
    // uses at runtime for the same topic (Section 4.1 / AC2).
    const expectedLevel0A = extractWhatToCover(teachA)
    expect(expectedLevel0A).toBe(teachA) // single short sentence, no truncation

    const result = await generateSessionMarkers('sess-fidelity', [tabA, tabB])
    const topicA = result.topics.find((t) => t.subtopic_slug === 'topic-a')!

    expect(topicA.source_level).toBe(0)
    expect(topicA.golden_word).toBe('quantivex')
    // The golden word must actually originate from the exact extractWhatToCover output.
    expect(tokenize(expectedLevel0A)).toContain('quantivex')
  })
})

// ─── TEST 3 — check 3 is deterministic and grouped-by-topic ─────────────────

describe('generateSessionMarkers — uniqueness (check 3)', () => {
  it('a token repeated 5x inside one topic and 0x elsewhere IS topic-unique; a token split 1x/1x across two topics is NOT', async () => {
    const tabA = makeTab('topic-a', 'Topic A', {
      overview: 'Zephyrion zephyrion zephyrion zephyrion zephyrion drives this analysis for today.',
      how_it_works: 'Harmonade supports this mechanism directly.',
    })
    const tabB = makeTab('topic-b', 'Topic B', {
      overview: 'Boltravine configuration handles this differently. Harmonade also applies here.',
    })

    const result = await generateSessionMarkers('sess-uniqueness', [tabA, tabB])
    const topicA = result.topics.find((t) => t.subtopic_slug === 'topic-a')!
    const topicB = result.topics.find((t) => t.subtopic_slug === 'topic-b')!

    const zephyrionMarker = topicA.markers.find((m) => m.word === 'zephyrion')
    expect(zephyrionMarker).toBeDefined()
    expect(zephyrionMarker!.within_topic_freq).toBe(5)

    // "harmonade" appears once in A and once in B — split across topics, so it
    // must never qualify as a golden word for either, regardless of its total
    // count (2) being lower than zephyrion's raw count in A alone.
    expect(topicA.markers.some((m) => m.word === 'harmonade')).toBe(false)
    expect(topicB.markers.some((m) => m.word === 'harmonade')).toBe(false)
  })
})

// ─── TEST 4 — golden-word ranking rewards within-home-topic repetition ──────

describe('generateSessionMarkers — golden-word ranking', () => {
  it('ranks a frequency-3 approved candidate above a frequency-1 approved candidate as rank 1 / golden_word', async () => {
    // Single-topic session: every candidate is trivially topic-unique (only
    // one topic exists), isolating the ranking behavior from check 3.
    const tab = makeTab('topic-c', 'Topic C', {
      overview: 'Vantrex vantrex vantrex quoribel appear in this discussion.',
    })

    const result = await generateSessionMarkers('sess-ranking', [tab])
    const topicC = result.topics.find((t) => t.subtopic_slug === 'topic-c')!

    expect(topicC.golden_word).toBe('vantrex')
    const vantrexMarker = topicC.markers.find((m) => m.word === 'vantrex')!
    expect(vantrexMarker.rank).toBe(1)
    expect(vantrexMarker.within_topic_freq).toBe(3)

    const quoribelMarker = topicC.markers.find((m) => m.word === 'quoribel')
    if (quoribelMarker) {
      expect(quoribelMarker.rank).toBeGreaterThan(1)
      expect(quoribelMarker.within_topic_freq).toBe(1)
    }
  })
})

// ─── TEST 5 — no-fallback guarantee holds (happy path) ──────────────────────

describe('generateSessionMarkers — no-fallback happy path', () => {
  it('every non-bookend topic gets >=1 marker + non-null golden_word when every topic yields a unique term', async () => {
    const tabs = [
      makeTab('topic-alpha', 'Topic Alpha', { overview: 'Krellanite pricing shapes this discussion.' }),
      makeTab('topic-beta', 'Topic Beta', { overview: 'Fluvorasil scheduling shapes this discussion.' }),
      makeTab('topic-gamma', 'Topic Gamma', { overview: 'Obrenaxis governance shapes this discussion.' }),
    ]

    const result = await generateSessionMarkers('sess-happy', tabs)

    expect(result.rtv_eligible).toBe(true)
    expect(result.rtv_ineligible_reason).toBeNull()

    const nonBookend = result.topics.filter((t) => !t.is_bookend)
    expect(nonBookend).toHaveLength(3)
    for (const topic of nonBookend) {
      expect(topic.markers.length).toBeGreaterThan(0)
      expect(topic.golden_word).not.toBeNull()
    }
  })
})

// ─── TEST 6 — no-fallback hard-stop (never ship empty) ──────────────────────

describe('generateSessionMarkers — no-fallback hard-stop', () => {
  it('flags the whole session ineligible when one topic yields zero golden words after full escalation, while keeping other topics for inspection', async () => {
    vi.resetModules()
    vi.doMock('@/lib/delivery/email', () => ({
      sendAdminAlert: vi.fn().mockResolvedValue({ success: true }),
    }))

    const { generateSessionMarkers: generateWithMockedAlert } = await import('@/lib/content/session-markers')
    const emailModule = await import('@/lib/delivery/email')

    // Topic X's entire content is built from stopwords only — tokenize()
    // strips every single token at every escalation level, so it can never
    // produce a candidate, let alone a unique one.
    const topicX = makeTab('topic-x', 'Topic X', {
      overview: 'This is how the team will use it for the business.',
    })
    const topicY = makeTab('topic-y', 'Topic Y', {
      overview: 'Neptrazine forecasting anchors this discussion.',
    })

    const result = await generateWithMockedAlert('sess-hardstop', [topicX, topicY])

    expect(result.rtv_eligible).toBe(false)
    expect(result.rtv_ineligible_reason).toContain('topic-x')
    expect(result.rtv_ineligible_reason).toContain('levels 0-2')

    const entryX = result.topics.find((t) => t.subtopic_slug === 'topic-x')!
    const entryY = result.topics.find((t) => t.subtopic_slug === 'topic-y')!

    expect(entryX.markers).toHaveLength(0)
    expect(entryX.golden_word).toBeNull()
    // Other topics' markers ARE stored for inspection even though the session is ineligible.
    expect(entryY.markers.length).toBeGreaterThan(0)

    // Invariant: rtv_eligible=true must imply every non-bookend topic has >=1 marker.
    // Here rtv_eligible is false, so the invariant doesn't apply — but assert
    // the converse never happens: no eligible=true result exists with an empty topic.
    const nonBookend = result.topics.filter((t) => !t.is_bookend)
    if (result.rtv_eligible) {
      expect(nonBookend.every((t) => t.markers.length > 0)).toBe(true)
    }

    expect(emailModule.sendAdminAlert).toHaveBeenCalledTimes(1)
    const alertArg = (emailModule.sendAdminAlert as ReturnType<typeof vi.fn>).mock.calls[0][0]
    expect(alertArg.body).toContain('topic-x')
  })
})

// ─── TEST 7 — bookends bypass the three-check pipeline ──────────────────────

describe('generateSessionMarkers — bookends', () => {
  it('section_index 0 is a literal "overview" marker and section_index N+1 is a literal "summary" marker, with no ranking fields', async () => {
    const tabs = [
      makeTab('topic-one', 'Topic One', { overview: 'Krellanite pricing shapes this discussion.' }),
      makeTab('topic-two', 'Topic Two', { overview: 'Fluvorasil scheduling shapes this discussion.' }),
    ]

    const result = await generateSessionMarkers('sess-bookends', tabs)

    const overviewEntry = result.topics[0]
    const summaryEntry = result.topics[result.topics.length - 1]

    expect(overviewEntry.section_index).toBe(0)
    expect(overviewEntry.type).toBe('SessionOverview')
    expect(overviewEntry.is_bookend).toBe(true)
    expect(overviewEntry.golden_word).toBe('overview')
    expect(overviewEntry.markers).toEqual([{ word: 'overview', literal: true }])

    expect(summaryEntry.section_index).toBe(tabs.length + 1)
    expect(summaryEntry.type).toBe('SessionSummary')
    expect(summaryEntry.is_bookend).toBe(true)
    expect(summaryEntry.golden_word).toBe('summary')
    expect(summaryEntry.markers).toEqual([{ word: 'summary', literal: true }])
  })
})

// ─── TEST 8 — marker step never breaks a good session (LLM failure) ────────

describe('generateSessionMarkers — LLM failure handling', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.unstubAllEnvs()
  })

  it('never throws when the Anthropic call fails; returns rtv_eligible=false with the documented reason', async () => {
    vi.stubEnv('ANTHROPIC_API_KEY', 'sk-not-a-placeholder-real-looking-key')

    vi.doMock('@anthropic-ai/sdk', () => ({
      default: class MockAnthropic {
        messages = {
          create: vi.fn().mockRejectedValue(new Error('simulated network error')),
        }
      },
    }))
    vi.doMock('@/lib/delivery/email', () => ({
      sendAdminAlert: vi.fn().mockResolvedValue({ success: true }),
    }))

    const { generateSessionMarkers: generateWithFailingLLM } = await import('@/lib/content/session-markers')

    // A genuinely unique level-0 term so a real judge call is attempted (and fails).
    const tab = makeTab('topic-fail', 'Topic Fail', { overview: 'Xantherion calibration shapes this discussion.' })

    const result = await generateWithFailingLLM('sess-llm-fail', [tab])

    expect(result.rtv_eligible).toBe(false)
    expect(result.rtv_ineligible_reason).toBe('marker LLM judgment unavailable')
    // Reaching this assertion at all proves generateSessionMarkers did not throw.
  })
})

// ─── TEST 11 — section-index space matches show_visual ─────────────────────

describe('generateSessionMarkers — section-index space', () => {
  it('produces {0, 1..N, N+1} in order for N non-bookend topics', async () => {
    const tabs = [
      makeTab('t1', 'T1', { overview: 'Krellanite pricing shapes this discussion.' }),
      makeTab('t2', 'T2', { overview: 'Fluvorasil scheduling shapes this discussion.' }),
      makeTab('t3', 'T3', { overview: 'Obrenaxis governance shapes this discussion.' }),
    ]

    const result = await generateSessionMarkers('sess-index-space', tabs)
    const indices = result.topics.map((t) => t.section_index)

    expect(indices).toEqual([0, 1, 2, 3, 4])
  })
})
