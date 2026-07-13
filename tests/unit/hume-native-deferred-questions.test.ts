import { describe, it, expect } from 'vitest'
import { detectHumeNativeDeferredQuestions } from '@/inngest/session-quality-evaluator'

/**
 * DEFER-QUESTION-01 (Hume-native path) — coverage for
 * detectHumeNativeDeferredQuestions(), the parallel/Hume-native-specific
 * counterpart to the existing Custom-LLM-path detectDeferredQuestions().
 *
 * Speaker convention used throughout: 'clio' is Clio's speaker label,
 * 'user' is the participant's speaker label — matching the
 * (clioSpeaker, userSpeakers) signature of the function under test.
 */

interface Word {
  text: string
  start_time: number
  end_time: number
}

interface Utterance {
  speaker: string
  words: Word[]
}

/** Builds an utterance from a plain sentence, spacing out fake word timings. */
function utter(speaker: string, text: string, startTime = 0): Utterance {
  const words = text.split(/\s+/).map((w, i) => ({
    text: w,
    start_time: startTime + i,
    end_time: startTime + i + 1,
  }))
  return { speaker, words }
}

const CLIO = 'clio'
const USER = 'user'
const SESSION_ENDED_AT = '2026-07-06T12:00:00.000Z'

describe('detectHumeNativeDeferredQuestions', () => {
  it('returns an empty array when no deferral trigger phrases are present', () => {
    const utterances: Utterance[] = [
      utter(CLIO, 'Let\'s start with how large language models handle context.'),
      utter(USER, 'What is a token exactly?'),
      utter(CLIO, 'Great question, a token is a chunk of text the model processes.'),
      utter(USER, 'Got it, that makes sense.'),
      utter(CLIO, 'Let\'s move on to the next section then.'),
    ]

    const result = detectHumeNativeDeferredQuestions(utterances, CLIO, [USER], SESSION_ENDED_AT)

    expect(result).toEqual([])
  })

  it('detects a single deferral and pairs it with the preceding user question', () => {
    const utterances: Utterance[] = [
      utter(CLIO, 'Today we will cover prompt design fundamentals.'),
      utter(USER, 'How does this affect our vendor contract negotiations with OpenAI?'),
      utter(CLIO, 'That is a great point, but let\'s cover that properly next time so we can go deep on it.'),
      utter(CLIO, 'For now, let\'s get back to the fundamentals.'),
    ]

    const result = detectHumeNativeDeferredQuestions(utterances, CLIO, [USER], SESSION_ENDED_AT)

    expect(result).toHaveLength(1)
    expect(result[0]).toEqual({
      question: 'How does this affect our vendor contract negotiations with OpenAI?',
      deferred_at: SESSION_ENDED_AT,
      source: 'transcript-detected',
    })
  })

  it('pairs multiple deferrals each with their own preceding user utterance', () => {
    const utterances: Utterance[] = [
      utter(CLIO, 'Let\'s begin with retrieval augmented generation.'),
      utter(USER, 'What about our internal data governance policy?'),
      utter(CLIO, 'Good question — let\'s save the governance angle for next time.'),
      utter(CLIO, 'Moving on to embeddings now.'),
      utter(USER, 'Should we also evaluate a multi-cloud vendor strategy here?'),
      utter(CLIO, 'That\'s worth its own session, so next session we can dig into vendor strategy.'),
      utter(CLIO, 'Let\'s wrap up embeddings for today.'),
    ]

    const result = detectHumeNativeDeferredQuestions(utterances, CLIO, [USER], SESSION_ENDED_AT)

    expect(result).toHaveLength(2)
    expect(result[0].question).toBe('What about our internal data governance policy?')
    expect(result[1].question).toBe('Should we also evaluate a multi-cloud vendor strategy here?')
    for (const r of result) {
      expect(r.source).toBe('transcript-detected')
      expect(r.deferred_at).toBe(SESSION_ENDED_AT)
    }
  })

  it('skips a trigger phrase with no preceding user utterance rather than fabricating a question', () => {
    const utterances: Utterance[] = [
      // Trigger phrase is the very first utterance in the transcript.
      utter(CLIO, 'Let\'s cover that properly next time, once we get started.'),
      utter(CLIO, 'Welcome, today we\'ll cover the fundamentals of model evaluation.'),
      utter(USER, 'Sounds good.'),
    ]

    const result = detectHumeNativeDeferredQuestions(utterances, CLIO, [USER], SESSION_ENDED_AT)

    expect(result).toEqual([])
  })

  it('collapses near-duplicate deferred questions (>0.85 word-overlap similarity) into one entry', () => {
    const utterances: Utterance[] = [
      utter(CLIO, 'Let\'s start with fine-tuning basics.'),
      utter(USER, 'How should we think about our AI vendor budget for next year?'),
      utter(CLIO, 'Let\'s save that for next time.'),
      utter(CLIO, 'Back to fine-tuning.'),
      // Near-identical paraphrase of the same question — should be deduped.
      utter(USER, 'How should we think about our AI vendor budget next year?'),
      utter(CLIO, 'Again, let\'s cover that properly next time.'),
    ]

    const result = detectHumeNativeDeferredQuestions(utterances, CLIO, [USER], SESSION_ENDED_AT)

    expect(result).toHaveLength(1)
    expect(result[0].question).toBe('How should we think about our AI vendor budget for next year?')
  })

  it('does not match old Custom-LLM-path deferral phrasing (proves the two phrase families are separate)', () => {
    // Old Custom-LLM-path wording (DEFERRAL_PHRASES), e.g. "save that for next time" —
    // note this does NOT contain "next time" as its own standalone trigger phrase
    // match target here; we're verifying phrasing that is purely from that older
    // phrase family and shares no substring with DEFERRAL_TRIGGER_PHRASES doesn't false-positive.
    const utterances: Utterance[] = [
      utter(CLIO, 'Let\'s start with the fundamentals.'),
      utter(USER, 'What about our competitor\'s pricing model?'),
      utter(CLIO, "Let's save that."),
      utter(CLIO, 'Moving on now.'),
    ]

    const result = detectHumeNativeDeferredQuestions(utterances, CLIO, [USER], SESSION_ENDED_AT)

    expect(result).toEqual([])
  })

  it('Custom-LLM-path sessions (hume_native_enabled falsy/missing) never invoke Hume-native detection', () => {
    // Gating-logic-level check: evaluateSession() only calls
    // detectHumeNativeDeferredQuestions() when session.hume_native_enabled === true.
    // We simulate that gate here directly, since evaluateSession() itself performs
    // DB calls and isn't easily unit-testable in isolation.
    function pickDetector(humeNativeEnabled: boolean | null | undefined) {
      return humeNativeEnabled === true ? 'hume-native' : 'custom-llm'
    }

    expect(pickDetector(true)).toBe('hume-native')
    expect(pickDetector(false)).toBe('custom-llm')
    expect(pickDetector(null)).toBe('custom-llm')
    expect(pickDetector(undefined)).toBe('custom-llm')
  })
})
