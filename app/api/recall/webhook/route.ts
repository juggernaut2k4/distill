import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseAdminClient } from '@/lib/supabase'
import { analyzeTranscription } from '@/lib/session-ai'
import {
  getOrCreateContext,
  updateSentiment,
  addUnresolvedQuestion,
} from '@/lib/user-context'

/**
 * POST /api/recall/webhook
 * Receives all Recall.ai webhook events.
 * Always returns 200 — never 5xx (Recall.ai retries on server errors).
 *
 * Voice AND visuals are now driven by the ElevenLabs Conversational AI agent
 * (Clio) running in the walkthrough browser via the show_visual client tool.
 * This webhook handles: session lifecycle, sentiment tracking, deferred questions.
 */
export async function POST(request: NextRequest) {
  let event: RecallWebhookEvent
  try {
    event = (await request.json()) as RecallWebhookEvent
  } catch {
    console.error('[recall/webhook] Invalid JSON body')
    return NextResponse.json({ ok: true }, { status: 200 })
  }

  console.log('[recall/webhook] Received event:', event.event, '| bot_id:', event.data?.bot_id)

  handleEvent(event).catch((err) =>
    console.error('[recall/webhook] Unhandled error in handleEvent:', err)
  )

  return NextResponse.json({ ok: true }, { status: 200 })
}

// ─── TYPES ────────────────────────────────────────────────────────────────────

interface RecallWebhookEvent {
  event: string
  data: {
    bot_id?: string
    transcript?: {
      speaker?: string
      words?: Array<{ text: string; start_time: number; end_time: number }>
      is_final?: boolean
    }
    participant?: { id: string; name?: string; is_host?: boolean }
    data?: {
      speaker?: string
      words?: Array<{ text: string; start_time: number; end_time: number }>
      participant?: { id: string; name?: string; is_host?: boolean }
    }
  }
}

// ─── EVENT HANDLER ────────────────────────────────────────────────────────────

async function handleEvent(event: RecallWebhookEvent) {
  const supabase = createSupabaseAdminClient()
  const botId = event.data?.bot_id ?? (event.data as { bot?: { id?: string } })?.bot?.id

  if (!botId) {
    console.warn('[recall/webhook] No bot_id in event', event.event, JSON.stringify(event.data).slice(0, 200))
    return
  }

  const { data: walkthroughRow } = await supabase
    .from('walkthrough_state')
    .select('*')
    .eq('bot_id', botId)
    .single()

  if (!walkthroughRow) {
    console.warn('[recall/webhook] No walkthrough_state found for botId', botId)
    return
  }

  const userId = walkthroughRow.user_id as string
  const sessionId = walkthroughRow.session_id as string | null
  const currentTopicId = (walkthroughRow.topic_id as string | null) ?? 'introduction'

  switch (event.event) {
    case 'bot.joining_call':
    case 'status.joining_call':
    case 'bot.in_call_not_recording':
    case 'status.in_call_not_recording':
    case 'bot.in_call_recording':
    case 'status.in_call_recording':
    case 'realtime_endpoint.running':
      // ElevenLabs agent connects and greets automatically — nothing to do here
      console.log('[recall/webhook] Bot is live', { botId, userId, event: event.event })
      break

    // transcript.data: Analyze participant speech for sentiment + deferred question tracking.
    // Visual generation is handled by the ElevenLabs show_visual client tool.
    case 'transcript.data':
    case 'transcript.done': {
      const transcript = event.data.transcript ?? event.data.data
      if (!transcript) break

      const words = (transcript as { words?: Array<{ text: string }> }).words ?? []
      const text = words.map((w) => w.text).join(' ').trim()
      if (!text || text.length < 8) break

      // Skip the bot's own speech
      const speaker = (transcript as { speaker?: string }).speaker ?? ''
      if (speaker.toLowerCase().includes('clio')) break

      // Write transcript to DB — WalkthroughClient polls this and feeds it
      // to the ElevenLabs agent via sendUserMessage(), bypassing the headless
      // browser mic which returns silence in Recall.ai's environment.
      await supabase
        .from('walkthrough_state')
        .update({ pending_transcript: text })
        .eq('bot_id', botId)

      console.log('[recall/webhook] Transcript queued for agent:', text.slice(0, 80))

      // Background: sentiment + deferred question tracking
      try {
        const userCtx = await getOrCreateContext(userId)
        const analysis = await analyzeTranscription(text, currentTopicId, {
          role: 'executive',
          communicationStyle: userCtx.communicationStyle,
          engagementLevel: userCtx.engagementLevel,
        })

        if (sessionId) {
          await updateSentiment(userId, analysis.sentiment, sessionId).catch(console.error)
        }

        if (analysis.intent === 'question' && analysis.isComplex && analysis.extractedQuestion && sessionId) {
          await addUnresolvedQuestion(userId, analysis.extractedQuestion, sessionId).catch(console.error)
        }

        if (analysis.intent === 'no_time' && analysis.extractedQuestion && sessionId) {
          await addUnresolvedQuestion(userId, `[Deferred] ${analysis.extractedQuestion}`, sessionId).catch(console.error)
        }
      } catch (err) {
        console.error('[recall/webhook] Transcript analysis error:', err)
      }
      break
    }

    case 'transcript.processing':
      break

    case 'bot.call_ended':
    case 'status.call_ended': {
      await supabase
        .from('walkthrough_state')
        .update({
          status: 'idle',
          bot_id: null,
          visual_spec: null,
          topic_id: null,
          topic_title: null,
        })
        .eq('bot_id', botId)

      if (sessionId) {
        await supabase
          .from('sessions')
          .update({ status: 'completed', ended_at: new Date().toISOString() })
          .eq('id', sessionId)
      }

      console.log('[recall/webhook] Call ended', { botId, userId })
      break
    }

    default:
      console.log('[recall/webhook] Unhandled event type', event.event)
  }
}
