import { NextRequest, NextResponse } from 'next/server'
import { createHmac } from 'crypto'
import { createSupabaseAdminClient } from '@/lib/supabase'
import { inngest } from '@/inngest/client'

/**
 * POST /api/attendee/webhook
 * Receives all Attendee.dev webhook events and normalizes them to the same
 * walkthrough_state DB writes as /api/recall/webhook — so the rest of Clio
 * (ElevenLabs, WalkthroughClient, quality-evaluator) is provider-agnostic.
 *
 * Always returns 200. Attendee.dev retries on non-2xx.
 */
export async function POST(request: NextRequest) {
  const rawBody = await request.text()

  // Signature verification
  const secret = process.env.ATTENDEE_WEBHOOK_SECRET
  if (secret && !secret.startsWith('PLACEHOLDER')) {
    const sig = request.headers.get('x-webhook-signature') ?? ''
    // Attendee signs: HMAC-SHA256(secret, JSON with keys sorted alphabetically), base64-encoded
    const parsed = JSON.parse(rawBody) as Record<string, unknown>
    const sorted = JSON.stringify(parsed, Object.keys(parsed).sort())
    const expected = createHmac('sha256', secret).update(sorted).digest('base64')
    if (sig !== expected) {
      console.warn('[attendee/webhook] Invalid signature — rejecting')
      return NextResponse.json({ ok: false }, { status: 403 })
    }
  }

  let event: AttendeeWebhookEvent
  try {
    event = JSON.parse(rawBody) as AttendeeWebhookEvent
  } catch {
    return NextResponse.json({ ok: true })
  }

  console.log('[attendee/webhook] event:', event.trigger, '| bot_id:', event.bot_id)

  await handleEvent(event).catch((err) =>
    console.error('[attendee/webhook] Unhandled error:', err)
  )

  return NextResponse.json({ ok: true })
}

// ─── TYPES ────────────────────────────────────────────────────────────────────

interface AttendeeWebhookEvent {
  idempotency_key: string
  bot_id: string
  bot_metadata?: { user_id?: string; [key: string]: unknown }
  trigger: string
  data: Record<string, unknown>
}

// ─── HANDLER ─────────────────────────────────────────────────────────────────

async function handleEvent(event: AttendeeWebhookEvent) {
  const supabase = createSupabaseAdminClient()
  const botId = event.bot_id
  const userId = event.bot_metadata?.user_id

  if (!userId) {
    console.warn('[attendee/webhook] No user_id in bot_metadata — cannot route event')
    return
  }

  const { data: walkthroughRow } = await supabase
    .from('walkthrough_state')
    .select('*')
    .eq('user_id', userId)
    .single()

  if (!walkthroughRow) {
    console.warn('[attendee/webhook] No walkthrough_state for userId', userId)
    return
  }

  const sessionId = walkthroughRow.session_id as string | null

  switch (event.trigger) {
    case 'bot.state_change': {
      const state = event.data.state as string | undefined
      console.log('[attendee/webhook] state_change →', state, { botId, userId })

      if (state === 'joined_recording') {
        // Mirror what /api/recall/webhook does on bot.in_call_recording:
        // persist bot_id so quality-evaluator can fetch transcript after session.
        await supabase.from('walkthrough_state').update({ bot_id: botId }).eq('user_id', userId)

        if (sessionId) {
          await supabase.from('sessions').update({ recall_bot_id: botId }).eq('id', sessionId)
        }
      }

      if (state === 'ended' || state === 'fatal_error') {
        const topicTitle = (walkthroughRow.topic_title as string | null) ?? 'Unknown Session'
        const topicId = (walkthroughRow.topic_id as string | null) ?? ''

        await supabase.from('walkthrough_state').update({
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
        }).eq('user_id', userId)

        if (sessionId) {
          await supabase.from('sessions').update({
            status: 'completed',
            ended_at: new Date().toISOString(),
          }).eq('id', sessionId)

          const { data: userRow } = await supabase
            .from('users').select('primary_domain').eq('id', userId).maybeSingle()
          const domain = (userRow?.primary_domain as string | null) ?? 'ai-ml'

          inngest.send({
            name: 'distill/session.completed',
            data: { userId, sessionId, domain, topicTitle, topicId, sessionSentiment: 'neutral' },
          }).catch((err) => console.error('[attendee/webhook] session.completed emit failed:', err))
        }

        console.log('[attendee/webhook] Call ended', { botId, userId, state })
      }
      break
    }

    case 'transcript.update': {
      const speaker = (event.data.speaker_name as string | null) ?? ''
      const text = ((event.data.transcription as Record<string, unknown>)?.transcript as string | null) ?? ''

      console.log('[attendee/webhook] transcript speaker:', speaker, '| text:', text.slice(0, 80))

      if (!text || text.length < 2) break

      // Skip Clio's own speech (bot speaks into the meeting via ElevenLabs)
      if (speaker.toLowerCase().includes('clio')) break

      await supabase.from('walkthrough_state')
        .update({ pending_transcript: text })
        .eq('user_id', userId)

      console.log('[attendee/webhook] Transcript queued:', text.slice(0, 80))
      break
    }

    case 'participant_events.join_leave': {
      const participantName = (event.data.participant_name as string | null) ?? ''
      const eventType = event.data.event_type as string | undefined

      if (eventType !== 'participant_joined' || !participantName) break

      // Skip the bot itself
      if (participantName.toLowerCase().includes('clio')) break

      const firstName = participantName.split(' ')[0] ?? participantName
      const topicTitle = (walkthroughRow.topic_title as string | null) ?? null
      const contextNote = topicTitle ? ` Arun and I were just covering "${topicTitle}".` : ''
      const greeting = `Hi ${firstName}, welcome!${contextNote}`

      await supabase.from('walkthrough_state')
        .update({ pending_transcript: greeting })
        .eq('user_id', userId)

      console.log('[attendee/webhook] participant.joined — greeting sent:', greeting)
      break
    }

    default:
      console.log('[attendee/webhook] Unhandled trigger:', event.trigger)
  }
}
