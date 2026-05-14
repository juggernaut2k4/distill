import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseAdminClient } from '@/lib/supabase'
import { speakText } from '@/lib/recall'
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
  // Optional webhook secret validation
  const webhookSecret = process.env.RECALL_WEBHOOK_SECRET
  if (webhookSecret && !webhookSecret.startsWith('PLACEHOLDER')) {
    const receivedSecret = request.headers.get('x-recall-webhook-secret')
    if (receivedSecret !== webhookSecret) {
      console.warn('[recall/webhook] Invalid webhook secret')
      return NextResponse.json({ error: 'Invalid secret' }, { status: 200 }) // still 200
    }
  }

  let event: RecallWebhookEvent
  try {
    event = (await request.json()) as RecallWebhookEvent
  } catch {
    console.error('[recall/webhook] Invalid JSON body')
    return NextResponse.json({ ok: true }, { status: 200 })
  }

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
  }
}

// ─── EVENT HANDLER ────────────────────────────────────────────────────────────

async function handleEvent(event: RecallWebhookEvent) {
  const supabase = createSupabaseAdminClient()
  const botId = event.data?.bot_id

  if (!botId) return

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

  switch (event.event) {
    case 'bot.joining_call':
      console.log('[recall/webhook] Bot joining call', { botId, userId })
      break

    case 'bot.in_call_not_recording': {
      // Bot is in the call — set status to idle, greet user
      await supabase
        .from('walkthrough_state')
        .update({ status: 'idle' })
        .eq('bot_id', botId)

      await speakText(
        botId,
        "Hello, I'm Clio, your AI coach. I'll be sharing visuals as we talk. Just speak naturally — ask questions whenever you like."
      )
      break
    }

    case 'participant.join': {
      // When a real participant joins, start the first topic
      const participantName = event.data.participant?.name ?? 'participant'
      const isBot = participantName.toLowerCase().includes('clio')
      if (isBot) break

      const userContext = await getOrCreateContext(userId)
      console.log('[recall/webhook] Participant joined — loading first topic', { userId })

      // Generate first visual asynchronously
      generateAndPushVisual(botId, userId, 'introduction', 'AI Fundamentals for Leaders', userContext, supabase).catch(
        console.error
      )

      await speakText(
        botId,
        `Welcome. Let's dive in. I'll start with the foundations — and you can redirect me at any point.`
      )
      break
    }

    case 'transcript.data': {
      const transcript = event.data.transcript
      if (!transcript?.is_final) break // Only process final transcripts

      const words = transcript.words ?? []
      const text = words.map((w) => w.text).join(' ').trim()
      if (!text) break

      // Skip if speaker is the bot
      const speaker = transcript.speaker ?? ''
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
            await speakText(
              botId,
              "That's a deep one — let's dedicate a full session to it. I've noted it and will schedule time to cover it properly."
            )
          } else {
            // Generate a new visual for this question
            await speakText(botId, 'Great question. Let me build that out for you — one moment.')

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
            await speakText(botId, spokenResponse)
          }
          break
        }

        case 'confused': {
          // Regenerate simpler visual for same topic
          await speakText(botId, 'Let me break this down differently.')
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
          await speakText(botId, 'Moving on.')
          // Could advance to next topic in curriculum here
          break
        }

        case 'no_time': {
          await speakText(
            botId,
            "Understood — I'll capture this and add it to your next session."
          )
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

    case 'bot.call_ended': {
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
