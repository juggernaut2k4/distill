import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseAdminClient } from '@/lib/supabase'
import {
  generateVisualSpec,
  reviewVisualSpec,
  analyzeTranscription,
} from '@/lib/session-ai'
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
 * Voice is handled entirely by the ElevenLabs Conversational AI agent running
 * in the walkthrough browser. This webhook only drives VISUALS.
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

  // Fire-and-forget: process async without blocking response
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
    participant?: {
      id: string
      name?: string
      is_host?: boolean
    }
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
  const currentTopicTitle = (walkthroughRow.topic_title as string | null) ?? currentTopicId

  const eventName = event.event

  switch (eventName) {
    case 'bot.joining_call':
    case 'status.joining_call':
      console.log('[recall/webhook] Bot joining call', { botId, userId })
      break

    case 'bot.in_call_not_recording':
    case 'status.in_call_not_recording':
    case 'bot.in_call_recording':
    case 'status.in_call_recording':
    case 'bot.status_change':
    case 'realtime_endpoint.running': {
      // Bot is live — ElevenLabs agent will greet the participants on its own.
      // Just ensure status is idle so the idle screen shows.
      const { data: current } = await supabase
        .from('walkthrough_state')
        .select('status')
        .eq('bot_id', botId)
        .single()

      if (!current || current.status === 'idle') {
        console.log('[recall/webhook] Bot live — ElevenLabs agent will handle greeting', { botId })
      }
      break
    }

    case 'participant_events.done': {
      const participant = event.data.participant ?? event.data.data?.participant
      const participantName = participant?.name ?? ''
      if (participantName.toLowerCase().includes('clio')) break

      const userContext = await getOrCreateContext(userId)
      console.log('[recall/webhook] Participant joined — generating first visual', { userId })

      // Visual only — ElevenLabs agent speaks the welcome on its own
      generateAndPushVisual(botId, userId, 'introduction', 'AI Fundamentals for Leaders', userContext, supabase).catch(
        console.error
      )
      break
    }

    case 'transcript.data':
    case 'transcript.done': {
      const transcript = event.data.transcript ?? event.data.data
      if (!transcript) break

      const words = (transcript as { words?: Array<{ text: string }> }).words ?? []
      const text = words.map((w) => w.text).join(' ').trim()
      if (!text || text.length < 8) break

      // Skip if speaker is the bot (ElevenLabs agent or Recall.ai bot)
      const speaker = (transcript as { speaker?: string }).speaker ?? ''
      if (speaker.toLowerCase().includes('clio')) break

      const userCtx = await getOrCreateContext(userId)
      const analysis = await analyzeTranscription(text, currentTopicId, {
        role: 'executive',
        communicationStyle: userCtx.communicationStyle,
        engagementLevel: userCtx.engagementLevel,
      })

      if (sessionId) {
        await updateSentiment(userId, analysis.sentiment, sessionId).catch(console.error)
      }

      // ElevenLabs agent handles spoken responses — we only update visuals
      switch (analysis.intent) {
        case 'question': {
          if (analysis.isComplex) {
            if (analysis.extractedQuestion && sessionId) {
              await addUnresolvedQuestion(userId, analysis.extractedQuestion, sessionId).catch(console.error)
            }
            // No spoken response needed — agent handles it
          } else {
            const topicTitle = analysis.extractedQuestion ?? analysis.newTopicNeeded ?? text.slice(0, 60)
            const topicId = topicTitle.toLowerCase().replace(/\s+/g, '-').slice(0, 40)

            await supabase
              .from('walkthrough_state')
              .update({ status: 'wiping' })
              .eq('bot_id', botId)

            await new Promise((resolve) => setTimeout(resolve, 700))

            await supabase
              .from('walkthrough_state')
              .update({ status: 'generating' })
              .eq('bot_id', botId)

            const spec = await generateVisualSpec(topicId, topicTitle, {
              role: 'executive',
              industry: 'business',
              maturity: 'beginner',
            }, { width: 1280, height: 720 })

            const review = await reviewVisualSpec(spec)
            const finalSpec = review.revisedSpec ?? spec

            await supabase
              .from('walkthrough_state')
              .update({
                status: 'ready',
                visual_spec: finalSpec,
                topic_id: finalSpec.topicId,
                topic_title: finalSpec.title,
              })
              .eq('bot_id', botId)
          }
          break
        }

        case 'confused': {
          generateAndPushVisual(
            botId,
            userId,
            `${currentTopicId}-simplified`,
            `${currentTopicTitle} — Simplified`,
            userCtx,
            supabase
          ).catch(console.error)
          break
        }

        case 'no_time': {
          if (analysis.extractedQuestion && sessionId) {
            await addUnresolvedQuestion(
              userId,
              `[Deferred] ${analysis.extractedQuestion}`,
              sessionId
            ).catch(console.error)
          }
          break
        }

        case 'skip':
        case 'acknowledgment':
        case 'other':
        default:
          break
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

// ─── HELPER: GENERATE & PUSH VISUAL ──────────────────────────────────────────

async function generateAndPushVisual(
  botId: string,
  userId: string,
  topicId: string,
  topicTitle: string,
  userCtx: { communicationStyle: string },
  supabase: ReturnType<typeof createSupabaseAdminClient>
) {
  await supabase
    .from('walkthrough_state')
    .update({ status: 'generating' })
    .eq('bot_id', botId)

  const spec = await generateVisualSpec(
    topicId,
    topicTitle,
    { role: 'executive', industry: 'business', maturity: 'beginner' },
    { width: 1280, height: 720 }
  )

  const review = await reviewVisualSpec(spec)
  const finalSpec = review.revisedSpec ?? spec

  await supabase
    .from('walkthrough_state')
    .update({
      status: 'ready',
      visual_spec: finalSpec,
      topic_id: finalSpec.topicId,
      topic_title: finalSpec.title,
    })
    .eq('bot_id', botId)

  void userId
  void userCtx
}
