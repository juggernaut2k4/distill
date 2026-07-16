import { NextRequest, NextResponse } from 'next/server'
import { createHmac, timingSafeEqual } from 'crypto'
import { createSupabaseAdminClient } from '@/lib/supabase'
import { analyzeTranscription } from '@/lib/session-ai'
import {
  getOrCreateContext,
  updateSentiment,
  addUnresolvedQuestion,
} from '@/lib/user-context'
import { inngest } from '@/inngest/client'

/**
 * POST /api/attendee/webhook
 * Receives all Attendee.dev webhook events and normalizes them to the same
 * walkthrough_state DB writes as /api/recall/webhook — so the rest of Clio
 * (WalkthroughClient, quality-evaluator) is meeting-bot-provider-agnostic.
 *
 * Always returns 200. Attendee.dev retries on non-2xx.
 *
 * VERIFICATION ROLLOUT STATUS (2026-07-15): soft-verify mode. The signature
 * check below is Attendee's own documented algorithm (not a guess — see
 * sortKeys()'s comment), but has never been confirmed against a real
 * Attendee-signed request (no traffic in the observable log window). A
 * mismatch is logged loudly but the event still processes, so a subtle bug
 * in the canonical-JSON reconstruction can't silently break real sessions.
 * TODO: once a real webhook fires and `sig_match: true` is confirmed in
 * Vercel logs, flip the `if (!match)` branch below to `return 401` instead
 * of falling through — that closes the actual security hole this replaces.
 */

// Recursively sorts object keys so JSON.stringify produces the exact
// canonical form Attendee signs against — https://attendee.dev/blog/webhooks-implementation-guide
// (HMAC-SHA256 of JSON.stringify(sortKeys(payload)), base64-decoded secret,
// base64-encoded digest, sent in the X-Webhook-Signature header). Verified
// against Attendee's own published Node.js reference implementation, not
// guessed — the previous 4-strategy diagnostic mode never matched because it
// HMAC'd the raw body instead of this canonical reconstruction.
function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys)
  if (value && typeof value === 'object') {
    return Object.keys(value as Record<string, unknown>)
      .sort()
      .reduce((acc: Record<string, unknown>, k) => {
        acc[k] = sortKeys((value as Record<string, unknown>)[k])
        return acc
      }, {})
  }
  return value
}

function verifyAttendeeSignature(payload: unknown, signatureHeader: string, secretB64: string): boolean {
  const canonical = JSON.stringify(sortKeys(payload))
  const secretBuf = Buffer.from(secretB64, 'base64')
  const expected = createHmac('sha256', secretBuf).update(canonical, 'utf8').digest('base64')

  const expectedBuf = Buffer.from(expected, 'utf8')
  const providedBuf = Buffer.from(signatureHeader, 'utf8')
  if (expectedBuf.length !== providedBuf.length) return false
  return timingSafeEqual(expectedBuf, providedBuf)
}

export async function POST(request: NextRequest) {
  const rawBody = await request.text()

  let parsedBody: unknown
  try {
    parsedBody = JSON.parse(rawBody)
  } catch {
    return NextResponse.json({ ok: true })
  }

  const secret = process.env.ATTENDEE_WEBHOOK_SECRET
  const isPlaceholder = !secret || secret.startsWith('PLACEHOLDER')

  if (!isPlaceholder) {
    const signatureHeader = request.headers.get('x-webhook-signature') ?? ''
    const match = !!signatureHeader && verifyAttendeeSignature(parsedBody, signatureHeader, secret)
    // Loud, greppable, one-line log so a real event's verification result is
    // unambiguous in Vercel logs — see the rollout-status comment above.
    console.log('[attendee/webhook] sig_match:', match, '| trigger:', (parsedBody as { trigger?: string })?.trigger)
    if (!match) {
      console.warn('[attendee/webhook] Signature did not verify — soft-verify mode, processing anyway. Investigate before flipping to hard-reject.')
    }
  } else {
    console.log('[attendee/webhook] MOCK — ATTENDEE_WEBHOOK_SECRET unset, signature check skipped')
  }

  const event = parsedBody as AttendeeWebhookEvent
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
  const currentTopicId = (walkthroughRow.topic_id as string | null) ?? 'introduction'

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
          last_participant_transcript: null,
        }).eq('user_id', userId)

        if (sessionId) {
          await supabase.from('sessions').update({
            status: 'completed',
            ended_at: new Date().toISOString(),
          }).eq('id', sessionId)

          const { data: userRow } = await supabase
            .from('users').select('primary_domain').eq('id', userId).maybeSingle()
          const domain = (userRow?.primary_domain as string | null) ?? 'ai-ml'

          // Fetch session sentiment (parity with recall/webhook) — populated by the
          // updateSentiment() calls run from the transcript.update case below.
          const { data: ctxRow } = await supabase
            .from('user_session_context')
            .select('sentiment_history')
            .eq('user_id', userId)
            .maybeSingle()
          const sentimentHistory = (ctxRow?.sentiment_history ?? []) as Array<{ sentiment: string; session: string }>
          const sessionSentiment = sentimentHistory.find((h) => h.session === sessionId)?.sentiment ?? 'neutral'

          // Cancel the Inngest session timer — the bot has already disconnected
          inngest.send({
            name: 'clio/session.ended',
            data: { userId, sessionId },
          }).catch((err) => console.error('[attendee/webhook] clio/session.ended emit failed:', err))

          inngest.send({
            name: 'distill/session.completed',
            data: { userId, sessionId, domain, topicTitle, topicId, sessionSentiment },
          }).catch((err) => console.error('[attendee/webhook] session.completed emit failed:', err))

          // Emit ice breaker response events — one per subtopic where the user spoke during
          // the ICE_BREAKER segment. Parity with recall/webhook's bot.call_ended handling,
          // except this reads current_section_index/sections/transcript from walkthroughRow
          // (fetched at the top of handleEvent, before the clearing update above) rather than
          // re-querying afterward — re-querying after the clear would read back the very
          // null/0 values this handler just wrote, which would always resolve to section 0.
          // Also reads last_participant_transcript (not pending_transcript) — see the
          // "Do NOT write participant speech to pending_transcript" note in the
          // transcript.update case below for why the two fields are kept separate.
          const rawTranscript = ((walkthroughRow.last_participant_transcript as string | null) ?? '').trim()
          if (rawTranscript.length > 10) {
            const sectionIndex = (walkthroughRow.current_section_index as number | null) ?? 0
            const sections = walkthroughRow.sections as Array<{ id?: string; subtopic_slug?: string }> | null
            const activeSection = sections?.[sectionIndex]
            const subtopicSlug = activeSection?.id ?? activeSection?.subtopic_slug ?? `subtopic-${sectionIndex}`

            inngest.send({
              name: 'distill/session.ice-breaker.response',
              data: { sessionId, userId, subtopicSlug, rawTranscript },
            }).catch((err) => console.error('[attendee/webhook] Failed to emit ice-breaker.response:', err))

            console.log('[attendee/webhook] Emitted ice-breaker.response for subtopic:', subtopicSlug, '| transcript length:', rawTranscript.length)
          } else {
            console.log('[attendee/webhook] No ice breaker transcript captured — skipping emission')
          }
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

      // Dedicated, isolated capture for the ice-breaker signal (migration 069) —
      // never polled by the client, never forwarded to the voice agent, so it
      // carries none of the double-response risk noted above.
      await supabase
        .from('walkthrough_state')
        .update({ last_participant_transcript: text })
        .eq('user_id', userId)

      // Sentiment + deferred question tracking — non-critical, run after response.
      // Parity with recall/webhook's transcript.data handling.
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
          console.error('[attendee/webhook] Transcript analysis error:', err)
        }
      })()
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
