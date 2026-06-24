import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseAdminClient } from '@/lib/supabase'
import { analyzeTranscription } from '@/lib/session-ai'
import {
  getOrCreateContext,
  updateSentiment,
  addUnresolvedQuestion,
} from '@/lib/user-context'
import { inngest } from '@/inngest/client'

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

  // userId is embedded in the URL for realtime_endpoint calls (transcript.data)
  // because Recall.ai realtime_endpoints payloads don't include bot_id
  const userIdFromQuery = request.nextUrl.searchParams.get('userId') ?? undefined

  console.log('[recall/webhook] Received event:', event.event, '| bot_id:', event.data?.bot_id, '| userId from query:', userIdFromQuery)

  await handleEvent(event, userIdFromQuery).catch((err) =>
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

async function handleEvent(event: RecallWebhookEvent, userIdFromQuery?: string) {
  const supabase = createSupabaseAdminClient()
  const botId = event.data?.bot_id ?? (event.data as { bot?: { id?: string } })?.bot?.id

  // Look up walkthrough_state — prefer userId from query (transcript.data events
  // don't include bot_id in their payload), fall back to bot_id for status events
  let walkthroughRow: Record<string, unknown> | null = null

  if (userIdFromQuery) {
    const { data } = await supabase
      .from('walkthrough_state')
      .select('*')
      .eq('user_id', userIdFromQuery)
      .single()
    walkthroughRow = data
  } else if (botId) {
    const { data } = await supabase
      .from('walkthrough_state')
      .select('*')
      .eq('bot_id', botId)
      .single()
    walkthroughRow = data
  } else {
    console.warn('[recall/webhook] No bot_id or userId in event', event.event, JSON.stringify(event.data).slice(0, 200))
    return
  }

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
      // Recall.ai realtime_endpoints may place words/speaker directly on event.data,
      // inside event.data.data, or inside event.data.transcript depending on the
      // provider and endpoint type. Try all three paths.
      const raw = event.data as Record<string, unknown>
      // Recall.ai realtime_endpoints puts the transcript content in event.data.data.
      // event.data.transcript exists but is metadata (no words field).
      const pick = (o: unknown): o is { words: Array<{ text: string }>; speaker?: string } =>
        Array.isArray((o as Record<string, unknown>)?.words)
      const transcriptObj = pick(raw.data) ? raw.data : pick(raw.transcript) ? raw.transcript : raw as never

      const words: Array<{ text: string }> = (transcriptObj as { words?: Array<{ text: string }> }).words ?? []
      const text = words.map((w) => w.text).join(' ').trim()

      console.log('[recall/webhook] transcript.data — words:', words.length, '| text:', text.slice(0, 80))

      if (!text || text.length < 2) break

      // Skip the bot's own speech
      const speaker = transcriptObj.speaker ?? ''
      if (speaker.toLowerCase().includes('clio')) break

      // Write transcript to DB — WalkthroughClient polls this and feeds it
      // to the ElevenLabs agent via sendUserMessage(), bypassing the headless
      // browser mic which returns silence in Recall.ai's environment.
      await supabase
        .from('walkthrough_state')
        .update({ pending_transcript: text })
        .eq('user_id', userId)

      console.log('[recall/webhook] Transcript queued for agent:', text.slice(0, 80))

      // Sentiment + deferred question tracking — non-critical, run after response
      ;(async () => {
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
      })()
      break
    }

    case 'transcript.processing':
      break

    case 'bot.call_ended':
    case 'status.call_ended': {
      // Snapshot topic info before clearing walkthrough_state
      const topicTitle = (walkthroughRow.topic_title as string | null) ?? 'Unknown Session'
      const topicId = (walkthroughRow.topic_id as string | null) ?? ''

      await supabase
        .from('walkthrough_state')
        .update({
          status: 'idle',
          bot_id: null,
          visual_spec: null,
          topic_id: null,
          topic_title: null,
          sections: null,
          training_scripts: null,
          session_brief: null,
          topic_context: null,
          session_script: null,
          clio_session_context: null,
          current_section_index: 0,
        })
        .eq('bot_id', botId)

      if (sessionId) {
        await supabase
          .from('sessions')
          .update({ status: 'completed', ended_at: new Date().toISOString() })
          .eq('id', sessionId)
      }

      // Fetch session sentiment to pass to profile updater
      const { data: ctxRow } = await supabase
        .from('user_session_context')
        .select('sentiment_history')
        .eq('user_id', userId)
        .maybeSingle()
      const sentimentHistory = (ctxRow?.sentiment_history ?? []) as Array<{ sentiment: string; session: string }>
      const sessionSentiment = sentimentHistory.find((h) => h.session === sessionId)?.sentiment ?? 'neutral'

      // Fetch user's primary domain for the profile update
      const { data: userRow } = await supabase
        .from('users')
        .select('primary_domain, domains')
        .eq('id', userId)
        .maybeSingle()
      const domain = (userRow?.primary_domain as string | null) ?? 'ai-ml'

      // Emit session.completed — Inngest job updates the learner profile asynchronously
      if (sessionId) {
        inngest.send({
          name: 'distill/session.completed',
          data: { userId, sessionId, domain, topicTitle, topicId, sessionSentiment },
        }).catch((err) => console.error('[recall/webhook] Failed to emit session.completed:', err))
      }

      // Emit ice breaker response events — one per subtopic where the user spoke during
      // the ICE_BREAKER segment. The walkthrough_state stores a pending_transcript from
      // transcript.data events; we use that as the raw response.
      // This is best-effort: if the transcript is empty or no session exists, no event fires.
      // The analyzeIceBreakerResponse Inngest function handles the async signal extraction.
      if (sessionId && userId) {
        const { data: walkthroughForIceBrk } = await supabase
          .from('walkthrough_state')
          .select('pending_transcript, current_section_index, sections')
          .eq('user_id', userId)
          .maybeSingle()

        const rawTranscript = (walkthroughForIceBrk?.pending_transcript as string | null) ?? ''
        if (rawTranscript && rawTranscript.trim().length > 10) {
          // Derive subtopic slug from the last active section index
          const sectionIndex = (walkthroughForIceBrk?.current_section_index as number | null) ?? 0
          const sections = walkthroughForIceBrk?.sections as Array<{ id?: string; subtopic_slug?: string }> | null
          const activeSection = sections?.[sectionIndex]
          const subtopicSlug = activeSection?.id ?? activeSection?.subtopic_slug ?? `subtopic-${sectionIndex}`

          inngest.send({
            name: 'distill/session.ice-breaker.response',
            data: {
              sessionId,
              userId,
              subtopicSlug,
              rawTranscript: rawTranscript.trim(),
            },
          }).catch((err) => console.error('[recall/webhook] Failed to emit ice-breaker.response:', err))

          console.log('[recall/webhook] Emitted ice-breaker.response for subtopic:', subtopicSlug, '| transcript length:', rawTranscript.length)
        } else {
          console.log('[recall/webhook] No ice breaker transcript captured — skipping emission')
        }
      }

      console.log('[recall/webhook] Call ended', { botId, userId })
      break
    }

    default:
      console.log('[recall/webhook] Unhandled event type', event.event)
  }
}
