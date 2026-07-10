import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { checkRtv03Transition, buildRtv03AuditMetadata } from '@/lib/content/rtv03-tracker'
import type { SessionMarkerEntry } from '@/lib/content/session-markers'

/**
 * RTV-03 — coverage for the depth-2 lookahead state machine per requirement
 * doc Section 4a/7/9. The live end-to-end observe-only behavior (Section 7's
 * screen-recording-diff acceptance test) and the real Inngest cron run are
 * manual/QA acceptance tests per the spec's own framing — not simulated here.
 */

function makeTopics(): SessionMarkerEntry[] {
  return [
    { section_index: 0, type: 'SessionOverview', subtopic_slug: null, is_bookend: true, golden_word: 'overview', markers: [{ word: 'overview', literal: true }] },
    { section_index: 1, type: 'topic', subtopic_slug: 'genai-basics', subtopic_title: 'What Generative AI Is', is_bookend: false, golden_word: 'transformer', markers: [{ word: 'transformer', within_topic_freq: 4, rank: 1 }] },
    { section_index: 2, type: 'topic', subtopic_slug: 'foundation-models', subtopic_title: 'The Foundation Model Landscape', is_bookend: false, golden_word: 'gemini', markers: [{ word: 'gemini', within_topic_freq: 3, rank: 1 }, { word: 'claude', within_topic_freq: 2, rank: 2 }] },
    { section_index: 3, type: 'topic', subtopic_slug: 'realistic-capability', subtopic_title: 'What AI Can Do Today', is_bookend: false, golden_word: 'hallucination', markers: [{ word: 'hallucination', within_topic_freq: 2, rank: 1 }] },
    { section_index: 4, type: 'SessionSummary', subtopic_slug: null, is_bookend: true, golden_word: 'summary', markers: [{ word: 'summary', literal: true }] },
  ]
}

describe('checkRtv03Transition — depth-2 lookahead state machine', () => {
  it('advances by 1 on a current+1 hit (normal, lookahead_depth 1)', () => {
    const topics = makeTopics()
    const hit = checkRtv03Transition(0, topics, 'Let\'s talk about how a transformer actually works.')
    expect(hit).not.toBeNull()
    expect(hit!.fromState).toBe(0)
    expect(hit!.toState).toBe(1)
    expect(hit!.matchedWord).toBe('transformer')
    expect(hit!.lookaheadDepth).toBe(1)
    expect(hit!.correctionType).toBe('normal')
    expect(hit!.subtopicSlug).toBe('genai-basics')
  })

  it('advances directly from k to k+2 on a current+2 hit when current+1 never matched (gap_jump, lookahead_depth 2)', () => {
    const topics = makeTopics()
    // currentState = 0: depth-1 target is topic 1 (transformer) — never
    // mentioned in this utterance. depth-2 target is topic 2 (gemini/claude)
    // — mentioned. Must gap_jump 0 -> 2, never passing through state 1.
    const hit = checkRtv03Transition(0, topics, 'Gemini and other foundation models are converging fast.')
    expect(hit).not.toBeNull()
    expect(hit!.fromState).toBe(0)
    expect(hit!.toState).toBe(2)
    expect(hit!.matchedWord).toBe('gemini')
    expect(hit!.lookaheadDepth).toBe(2)
    expect(hit!.correctionType).toBe('gap_jump')
  })

  it('same-utterance double-match resolves to depth-1 priority — never skips a state', () => {
    const topics = makeTopics()
    // currentState = 0: this utterance mentions BOTH topic 1's word
    // (transformer, current+1) and topic 2's word (gemini, current+2) in the
    // same breath. Depth-1 must win.
    const hit = checkRtv03Transition(0, topics, 'A transformer is the architecture behind models like Gemini.')
    expect(hit).not.toBeNull()
    expect(hit!.toState).toBe(1)
    expect(hit!.lookaheadDepth).toBe(1)
    expect(hit!.correctionType).toBe('normal')
  })

  it('returns null when neither current+1 nor current+2 markers appear', () => {
    const topics = makeTopics()
    const hit = checkRtv03Transition(0, topics, 'How does your team currently think about this?')
    expect(hit).toBeNull()
  })

  it('never checks depth 3+ — a topic-3 word alone, from state 0, is ignored', () => {
    const topics = makeTopics()
    // From state 0, current+1 = topic 1 (transformer), current+2 = topic 2
    // (gemini/claude). Topic 3's word ("hallucination") is depth 3 and must
    // never trigger a transition.
    const hit = checkRtv03Transition(0, topics, 'Hallucination is a real risk with these models.')
    expect(hit).toBeNull()
  })

  it('never jumps backward — a hit for an earlier topic\'s word (behind current) is ignored', () => {
    const topics = makeTopics()
    // currentState = 3: topic 1's word ("transformer", behind current) must
    // never be checked, so it produces no hit even though it's a valid
    // marker word somewhere in the session.
    const hit = checkRtv03Transition(3, topics, 'As I mentioned, a transformer processes tokens in parallel.')
    expect(hit).toBeNull()
  })

  it('single-hit-decisive holds at both depth 1 and depth 2 — no corroboration required', () => {
    const topics = makeTopics()
    const depth1 = checkRtv03Transition(0, topics, 'transformer')
    expect(depth1?.toState).toBe(1)
    // From state 0 again (a fresh, independent check): a single mention of
    // "claude" (topic 2's secondary marker) alone is sufficient for a
    // depth-2 gap_jump — no corroborating second word required.
    const depth2 = checkRtv03Transition(0, topics, 'claude')
    expect(depth2?.toState).toBe(2)
    expect(depth2?.correctionType).toBe('gap_jump')
  })

  it('N=1 session: depth-2 lookahead from state 0 correctly includes the Summary bookend as a valid depth-2 target', () => {
    const topics: SessionMarkerEntry[] = [
      { section_index: 0, type: 'SessionOverview', subtopic_slug: null, is_bookend: true, golden_word: 'overview', markers: [{ word: 'overview', literal: true }] },
      { section_index: 1, type: 'topic', subtopic_slug: 'only-topic', subtopic_title: 'The Only Topic', is_bookend: false, golden_word: 'transformer', markers: [{ word: 'transformer', within_topic_freq: 1, rank: 1 }] },
      { section_index: 2, type: 'SessionSummary', subtopic_slug: null, is_bookend: true, golden_word: 'summary', markers: [{ word: 'summary', literal: true }] },
    ]
    const hit = checkRtv03Transition(0, topics, 'Let\'s wrap up with a summary of what we covered.')
    expect(hit).not.toBeNull()
    expect(hit!.toState).toBe(2)
    expect(hit!.correctionType).toBe('gap_jump')
  })

  it('freezes (returns null forever) once the tracker is at the last state — no state beyond N+1 exists to check', () => {
    const topics = makeTopics()
    const hit = checkRtv03Transition(4, topics, 'summary transformer gemini hallucination overview')
    expect(hit).toBeNull()
  })

  it('bookend literal markers (overview/summary) match via tokenize, same as a topic golden word', () => {
    const topics = makeTopics()
    const hit = checkRtv03Transition(3, topics, 'Let\'s do a quick summary before we finish up.')
    expect(hit).not.toBeNull()
    expect(hit!.toState).toBe(4)
    expect(hit!.matchedWord).toBe('summary')
  })
})

describe('buildRtv03AuditMetadata', () => {
  it('builds all three metadata payloads off the same single hit, with the shared-signal flag disclosed', () => {
    const topics = makeTopics()
    const hit = checkRtv03Transition(0, topics, 'transformer')!
    const { stateAdvance, quickSummaryCue, nextTopicCue } = buildRtv03AuditMetadata(hit)

    expect(stateAdvance).toMatchObject({
      from_state: 0,
      to_state: 1,
      matched_word: 'transformer',
      lookahead_depth: 1,
      correction_type: 'normal',
      subtopic_slug: 'genai-basics',
    })
    expect(quickSummaryCue).toMatchObject({
      state: 1,
      matched_word: 'transformer',
      same_signal_as_next_topic_cue: true,
    })
    expect(nextTopicCue).toMatchObject({
      from_state: 0,
      to_state: 1,
      matched_word: 'transformer',
    })
  })
})

describe('RTV-03 observe-only enforcement (Section 4b) — grep-checkable guarantee', () => {
  const trackerSrcRaw = fs.readFileSync(
    path.resolve(__dirname, '../../lib/content/rtv03-tracker.ts'),
    'utf8',
  )
  // Strip comments before checking: the constraint is about CODE references
  // (the grep any reviewer/CI would run against the executable surface), not
  // about the file's own doc comments describing/quoting the constraint by
  // name (which this file's header intentionally does, for reviewers).
  const trackerCode = trackerSrcRaw
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '')

  it('contains zero CODE references to /api/walkthrough-state', () => {
    expect(trackerCode).not.toMatch(/\/api\/walkthrough-state/)
  })

  it('contains zero CODE references to screenQueueRef', () => {
    expect(trackerCode).not.toMatch(/screenQueueRef/)
  })

  it('never assigns to sectionsRef.current or currentSectionIndexRef.current', () => {
    expect(trackerCode).not.toMatch(/sectionsRef\.current\s*=/)
    expect(trackerCode).not.toMatch(/currentSectionIndexRef\.current\s*=/)
  })

  it('contains no fetch() call at all (it is a pure state machine — the fetch to /api/sessions/audit-event lives in WalkthroughClient.tsx, not here)', () => {
    expect(trackerCode).not.toMatch(/fetch\(/)
  })
})

describe('RTV-03 observe-only enforcement — WalkthroughClient.tsx integration point', () => {
  const clientSrc = fs.readFileSync(
    path.resolve(__dirname, '../../app/dashboard/walkthrough/WalkthroughClient.tsx'),
    'utf8',
  )

  it('rtvStateRef and currentSectionIndexRef are declared as separate useRef objects', () => {
    expect(clientSrc).toMatch(/const rtvStateRef = useRef<number>\(0\)/)
    expect(clientSrc).toMatch(/const currentSectionIndexRef = useRef<number>/)
  })

  it('no code path assigns rtvStateRef.current from currentSectionIndexRef (or vice versa)', () => {
    expect(clientSrc).not.toMatch(/rtvStateRef\.current\s*=\s*currentSectionIndexRef/)
    expect(clientSrc).not.toMatch(/currentSectionIndexRef\.current\s*=\s*rtvStateRef/)
  })

  it('the RTV-03 tracker check never writes to sectionsRef, trainingScriptsRef, or currentSectionIndexRef', () => {
    // Isolate the RTV-03 block itself (between its start comment and the
    // closing of the enclosing if(source === 'ai') block) and assert no
    // display-ref writes appear inside it.
    const startMarker = '// RTV-03 — observe-only position tracker.'
    const startIdx = clientSrc.indexOf(startMarker)
    expect(startIdx).toBeGreaterThan(-1)
    const endIdx = clientSrc.indexOf('tools: {', startIdx)
    expect(endIdx).toBeGreaterThan(startIdx)
    const block = clientSrc.slice(startIdx, endIdx)

    expect(block).not.toMatch(/sectionsRef\.current\s*=/)
    expect(block).not.toMatch(/trainingScriptsRef\.current\s*=/)
    expect(block).not.toMatch(/currentSectionIndexRef\.current\s*=/)
    expect(block).not.toMatch(/\/api\/walkthrough-state/)
    expect(block).not.toMatch(/screenQueueRef/)
  })
})
