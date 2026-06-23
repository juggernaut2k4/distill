/**
 * Inngest function: analyzes an ICE_BREAKER segment response.
 * Triggered by 'distill/session.ice-breaker.response' after a user answers the
 * situational open question in a live coaching session.
 *
 * Step 1 — Write raw transcript to session_insights (INSERT)
 * Step 2 — Claude extracts 5 structured signals from the transcript
 * Step 3 — Update session_insights with extracted_signals + status = 'complete'
 * Step 4 — Upsert user_learning_profiles with derived values
 *
 * Failure is non-fatal: sets analysis_status = 'failed' and logs. Never throws
 * after exhausting retries — caller is not blocked by this job.
 */

import Anthropic from '@anthropic-ai/sdk'
import { inngest } from './client'
import { createSupabaseAdminClient } from '@/lib/supabase'

// ─── CLIENT ───────────────────────────────────────────────────────────────────

const isPlaceholder =
  !process.env.ANTHROPIC_API_KEY ||
  process.env.ANTHROPIC_API_KEY.startsWith('PLACEHOLDER')

const anthropic = isPlaceholder ? null : new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
const MODEL = 'claude-sonnet-4-6'

// ─── TYPES ────────────────────────────────────────────────────────────────────

interface ExtractedSignals {
  learning_intent: string         // what the user wants to achieve
  knowledge_level: string         // inferred from language used: 'novice' | 'intermediate' | 'advanced'
  organizational_context: string  // their team/company situation
  urgency: 'low' | 'medium' | 'high'
  primary_driver: 'compliance' | 'competitive' | 'cost' | 'curiosity' | 'other'
}

// primary_driver → learning_motivation mapping
const DRIVER_TO_MOTIVATION: Record<ExtractedSignals['primary_driver'], string> = {
  compliance:   'compliance_driven',
  competitive:  'opportunity_driven',
  cost:         'fear_driven',
  curiosity:    'opportunity_driven',
  other:        'opportunity_driven',
}

function confidenceFromSessionCount(count: number): string {
  if (count >= 7) return 'high'
  if (count >= 3) return 'medium'
  return 'low'
}

// ─── MOCK EXTRACTOR ───────────────────────────────────────────────────────────

function buildMockSignals(transcript: string): ExtractedSignals {
  return {
    learning_intent: `Understand AI strategy implications from: "${transcript.slice(0, 80)}..."`,
    knowledge_level: 'intermediate',
    organizational_context: 'Team currently evaluating AI vendors and use cases',
    urgency: 'medium',
    primary_driver: 'competitive',
  }
}

// ─── MAIN FUNCTION ────────────────────────────────────────────────────────────

export const analyzeIceBreakerResponse = inngest.createFunction(
  {
    id: 'analyze-ice-breaker-response',
    retries: 2,
    triggers: [{ event: 'distill/session.ice-breaker.response' }],
  },
  async ({
    event,
    step,
  }: {
    event: {
      data: {
        sessionId: string
        userId: string
        subtopicSlug: string
        rawTranscript: string
      }
    }
    step: {
      run: <T>(name: string, fn: () => Promise<T>) => Promise<T>
    }
  }) => {
    const { sessionId, userId, subtopicSlug, rawTranscript } = event.data
    const supabase = createSupabaseAdminClient()

    // Step 1: Write raw transcript to session_insights
    const insightId = await step.run('insert-session-insight', async () => {
      const { data, error } = await supabase
        .from('session_insights')
        .insert({
          session_id: sessionId,
          user_id: userId,
          subtopic_slug: subtopicSlug,
          raw_transcript: rawTranscript,
          segment_type: 'ice_breaker_response',
          analysis_status: 'pending',
        })
        .select('id')
        .single()

      if (error) {
        console.error('[ice-breaker-analyzer] Failed to insert session_insight:', error.message)
        throw new Error(`session_insights insert failed: ${error.message}`)
      }
      return data.id as string
    })

    // Step 2: Extract signals from transcript via Claude
    const extractedSignals = await step.run('extract-signals', async () => {
      if (!anthropic) {
        console.log('[MOCK] ice-breaker-analyzer: returning mock signals for user:', userId)
        return buildMockSignals(rawTranscript)
      }

      const prompt = `You are analyzing a response from a senior executive during an AI coaching session.
The executive answered an open situational question (ICE_BREAKER segment) about their context and motivation.

TRANSCRIPT:
"${rawTranscript}"

Extract 5 structured signals from this response. Return ONLY valid JSON (no markdown):
{
  "learning_intent": "1-2 sentences: what the user wants to achieve or learn",
  "knowledge_level": "novice | intermediate | advanced (inferred from vocabulary and framing used)",
  "organizational_context": "1-2 sentences: their team or company situation as described",
  "urgency": "low | medium | high (how time-pressured is their need)",
  "primary_driver": "compliance | competitive | cost | curiosity | other (what is primarily motivating them)"
}`

      const message = await anthropic.messages.create({
        model: MODEL,
        max_tokens: 400,
        messages: [{ role: 'user', content: prompt }],
      })

      let raw = (message.content[0] as { type: string; text: string }).text.trim()
      raw = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim()
      return JSON.parse(raw) as ExtractedSignals
    })

    // Step 3: Update session_insights with extracted signals
    await step.run('update-insight-record', async () => {
      const { error } = await supabase
        .from('session_insights')
        .update({
          extracted_signals: extractedSignals,
          analysis_status: 'complete',
          analyzed_at: new Date().toISOString(),
        })
        .eq('id', insightId)

      if (error) {
        console.error('[ice-breaker-analyzer] Failed to update session_insight:', error.message)
        // Non-fatal: log and continue to profile upsert
      }
    })

    // Step 4: Upsert user_learning_profiles with derived values
    await step.run('upsert-learning-profile', async () => {
      // Fetch current profile to calculate incremented session count + confidence
      const { data: existing } = await supabase
        .from('user_learning_profiles')
        .select('sessions_used_for_profile')
        .eq('user_id', userId)
        .maybeSingle()

      const currentCount = (existing?.sessions_used_for_profile as number | null) ?? 0
      const newCount = currentCount + 1
      const newConfidence = confidenceFromSessionCount(newCount)
      const learningMotivation = DRIVER_TO_MOTIVATION[extractedSignals.primary_driver] ?? 'opportunity_driven'

      const { error } = await supabase
        .from('user_learning_profiles')
        .upsert(
          {
            user_id: userId,
            learning_motivation: learningMotivation,
            profile_confidence: newConfidence,
            sessions_used_for_profile: newCount,
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'user_id' }
        )

      if (error) {
        console.error('[ice-breaker-analyzer] Failed to upsert user_learning_profiles:', error.message)
        // Non-fatal: the insight was already captured, profile update can retry next session
      }
    })

    return { insightId, userId, analysisStatus: 'complete' }
  }
)
