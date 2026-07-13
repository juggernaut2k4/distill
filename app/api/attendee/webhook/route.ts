import { NextRequest, NextResponse } from 'next/server'
import { createHmac } from 'crypto'
import { createSupabaseAdminClient } from '@/lib/supabase'
import { inngest } from '@/inngest/client'

/**
 * POST /api/attendee/webhook
 * Receives all Attendee.dev webhook events and normalizes them to the same
 * walkthrough_state DB writes as /api/recall/webhook — so the rest of Clio
 * (WalkthroughClient, quality-evaluator) is meeting-bot-provider-agnostic.
 *
 * Always returns 200. Attendee.dev retries on non-2xx.
 */
export async function POST(request: NextRequest) {
  const rawBody = await request.text()

  // Signature verification — diagnostic mode
  // Testing two strategies to identify Attendee.dev's actual signing algorithm.
  // Previous implementation (canonical JSON + base64-decoded key) never matched.
  const secret = process.env.ATTENDEE_WEBHOOK_SECRET
  if (secret && !secret.startsWith('PLACEHOLDER')) {
    const sig = request.headers.get('x-webhook-signature') ??
                request.headers.get('x-signature') ??
                request.headers.get('x-hub-signature-256') ?? ''

    // Log all header names to help identify the correct signature header
    const headerNames = Array.from(request.headers.keys()).join(', ')

    const keyBytes = Buffer.from(secret, 'base64')
    // A: raw secret → base64
    const stratA = createHmac('sha256', secret).update(rawBody).digest('base64')
    // B: base64-decoded secret → base64
    const stratB = createHmac('sha256', keyBytes).update(rawBody).digest('base64')
    // C: raw secret → hex
    const stratC = createHmac('sha256', secret).update(rawBody).digest('hex')
    // D: base64-decoded secret → hex
    const stratD = createHmac('sha256', keyBytes).update(rawBody).digest('hex')

    // Some providers prefix the signature with the algorithm name
    const sigNoPrefix = sig.replace(/^sha256=/, '').replace(/^v1,/, '')

    const match =
      sig === stratA           ? 'A_base64' :
      sig === stratB           ? 'B_base64_decoded_key' :
      sig === stratC           ? 'C_hex' :
      sig === stratD           ? 'D_hex_decoded_key' :
      sigNoPrefix === stratA   ? 'A_prefixed' :
      sigNoPrefix === stratB   ? 'B_prefixed' :
      sigNoPrefix === stratC   ? 'C_prefixed' :
      sigNoPrefix === stratD   ? 'D_prefixed' :
      'NONE'

    console.log('[attendee/webhook] sig_check', { match, sig: sig.slice(0, 20), headers: headerNames })

    if (match === 'NONE') {
      console.warn('[attendee/webhook] No strategy matched — passing through for diagnosis')
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
      // Attendee.dev uses data.new_state (not data.state)
      const state = event.data.new_state as string | undefined
      console.log('[attendee/webhook] state_change →', state, { botId, userId })
      console.log('[attendee/webhook] state_change full payload:', JSON.stringify(event.data))

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
          pending_transcript: null,
        }).eq('user_id', userId)

        if (sessionId) {
          await supabase.from('sessions').update({
            status: 'completed',
            ended_at: new Date().toISOString(),
          }).eq('id', sessionId)

          const { data: userRow } = await supabase
            .from('users').select('primary_domain').eq('id', userId).maybeSingle()
          const domain = (userRow?.primary_domain as string | null) ?? 'ai-ml'

          // Cancel the Inngest session timer — the bot has already disconnected
          inngest.send({
            name: 'clio/session.ended',
            data: { userId, sessionId },
          }).catch((err) => console.error('[attendee/webhook] clio/session.ended emit failed:', err))

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

      if (!text || text.length < 2) break

      // Skip Clio's own speech (bot speaks into the meeting via Hume)
      if (speaker.toLowerCase().includes('clio')) break

      // Hume hears participant audio directly via the Attendee bot's virtual microphone.
      // Do NOT write participant speech to pending_transcript — that would risk a
      // double response if a forwarding path is ever added back for this field.
      // Only [SYSTEM] messages (e.g. from the session timer) use pending_transcript.
      console.log('[attendee/webhook] Transcript (not forwarded — Hume hears audio directly):', speaker, '|', text.slice(0, 80))
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
