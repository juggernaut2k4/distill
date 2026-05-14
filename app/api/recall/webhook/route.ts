import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseAdminClient } from '@/lib/supabase'
import {
  generateVisualSpec,
  reviewVisualSpec,
  analyzeTranscription,
  generateSpokenResponse,
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
    // transcript.done / transcript.processing
    transcript?: {
      speaker?: string
      words?: Array<{ text: string; start_time: number; end_time: number }>
      is_final?: boolean
    }
    // participant_events.done / participant_events.failed etc.
    participant?: {
      id: string
      name?: string
      is_host?: boolean
    }
    // Recall.ai sometimes nests the payload under data.data
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
  // bot_id is at data.bot_id in transcript events, and data.bot.id in status/endpoint events
  const botId = event.data?.bot_id ?? (event.data as { bot?: { id?: string } })?.bot?.id

  if (!botId) {
    console.warn('[recall/webhook] No bot_id in event', event.event, JSON.stringify(event.data).slice(0, 200))
    return
  }

  // Look up which user this bot belongs to
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

  // Normalize event names — Recall.ai dashboard webhooks use "status.*" format
  // while realtime_endpoints uses "bot.*" and "transcript.*" format
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
      // realtime_endpoint.running is the most reliable event we receive via realtime_endpoints.
      // status.* events come from the dashboard-level webhook only.
      // All of these mean the bot is live in the call — queue the greeting.

      // Only greet on first join (check current status to avoid double-greeting)
      const { data: current } = await supabase
        .from('walkthrough_state')
        .select('status, pending_speech')
        .eq('bot_id', botId)
        .single()

      // Skip if already greeted (pending_speech set) or session is underway
      if (current?.pending_speech || current?.status === 'generating' || current?.status === 'ready') {
        console.log('[recall/webhook] Skipping greeting — already active', { botId })
        break
      }

      const { error: greetErr } = await supabase
        .from('walkthrough_state')
        .update({
          status: 'idle',
          pending_speech: "Hello, I'm Clio, your AI coach. I'll be sharing visuals as we talk. Just speak naturally — ask questions whenever you like.",
        })
        .eq('bot_id', botId)
      if (greetErr) {
        console.error('[recall/webhook] Failed to set pending_speech for greeting:', greetErr.message)
      } else {
        console.log('[recall/webhook] Greeting queued via pending_speech for bot', botId)
      }
      break
    }

    case 'participant_events.done': {
      // When a real participant joins, start the first topic
      const participant = event.data.participant ?? event.data.data?.participant
      const participantName = participant?.name ?? 'participant'
      const isBot = participantName.toLowerCase().includes('clio')
      if (isBot) break

      const userContext = await getOrCreateContext(userId)
      console.log('[recall/webhook] Participant joined — loading first topic', { userId })

      // Generate first visual asynchronously
      generateAndPushVisual(botId, userId, 'introduction', 'AI Fundamentals for Leaders', userContext, supabase).catch(
        console.error
      )

      await supabase
        .from('walkthrough_state')
        .update({ pending_speech: `Welcome. Let's dive in. I'll start with the foundations — and you can redirect me at any point.` })
        .eq('bot_id', botId)
      break
    }

    // transcript.data = real-time utterance (recording_config / realtime_endpoints)
    // transcript.done = final transcript (legacy bot status webhook)
    // transcript.processing = interim (skip)
    case 'transcript.data':
    case 'transcript.done':
    case 'transcript.processing': {
      if (event.event === 'transcript.processing') break

      const transcript = event.data.transcript ?? event.data.data
      if (!transcript) break

      const words = (transcript as { words?: Array<{ text: string }> }).words ?? []
      const text = words.map((w) => w.text).join(' ').trim()
      if (!text || text.length < 8) break

      // Skip if speaker is the bot
      const speaker = (transcript as { speaker?: string }).speaker ?? ''
      if (speaker.toLowerCase().includes('clio')) break

      const userCtx = await getOrCreateContext(userId)
      const analysis = await analyzeTranscription(text, currentTopicId, {
        role: 'executive',
        communicationStyle: userCtx.communicationStyle,
        engagementLevel: userCtx.engagementLevel,
      })

      // Update sentiment
      if (sessionId) {
        await updateSentiment(userId, analysis.sentiment, sessionId).catch(console.error)
      }

      switch (analysis.intent) {
        case 'question': {
          if (analysis.isComplex) {
            // Too complex for now — note it and move on
            if (analysis.extractedQuestion && sessionId) {
              await addUnresolvedQuestion(userId, analysis.extractedQuestion, sessionId).catch(
                console.error
              )
            }
            await supabase.from('walkthrough_state').update({ pending_speech: "That's a deep one — let's dedicate a full session to it. I've noted it and will schedule time to cover it properly." }).eq('bot_id', botId)
          } else {
            // Generate a new visual for this question
            await supabase.from('walkthrough_state').update({ pending_speech: 'Great question. Let me build that out for you — one moment.' }).eq('bot_id', botId)

            const topicTitle =
              analysis.extractedQuestion ?? analysis.newTopicNeeded ?? text.slice(0, 60)
            const topicId = topicTitle.toLowerCase().replace(/\s+/g, '-').slice(0, 40)

            // Wipe then generate
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

            const spokenResponse = await generateSpokenResponse(
              analysis.extractedQuestion ?? text,
              topicTitle,
              { communicationStyle: userCtx.communicationStyle },
              120
            )
            await supabase.from('walkthrough_state').update({ pending_speech: spokenResponse }).eq('bot_id', botId)
          }
          break
        }

        case 'confused': {
          // Regenerate simpler visual for same topic
          await supabase.from('walkthrough_state').update({ pending_speech: 'Let me break this down differently.' }).eq('bot_id', botId)
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

        case 'skip': {
          await supabase.from('walkthrough_state').update({ pending_speech: 'Moving on.' }).eq('bot_id', botId)
          // Could advance to next topic in curriculum here
          break
        }

        case 'no_time': {
          await supabase.from('walkthrough_state').update({ pending_speech: "Understood — I'll capture this and add it to your next session." }).eq('bot_id', botId)
          if (analysis.extractedQuestion && sessionId) {
            await addUnresolvedQuestion(
              userId,
              `[Deferred] ${analysis.extractedQuestion}`,
              sessionId
            ).catch(console.error)
          }
          break
        }

        case 'acknowledgment':
        case 'other':
        default:
          // Continue — no action needed
          break
      }
      break
    }

    case 'bot.call_ended':
    case 'status.call_ended': {
      // Wipe state and mark session done
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

  // userCtx available for future per-user customization (e.g. tone)
  void userCtx
}
