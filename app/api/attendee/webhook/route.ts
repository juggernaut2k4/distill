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
import { handleSessionEnd } from '@/lib/partner/live-render'
import { getThemeConfig } from '@/lib/partner/theme'
import { extractAttendeeEventTimestamp, clampDurationMinutes } from '@/lib/partner/attendee-timing'

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
    // B2B-10 — a bot dispatched via the B2B partner flow (dispatchMeetingBot() in
    // lib/partner/session-init.ts) has no walkthrough_state row at all; its
    // event.bot_metadata.user_id carries partner_sessions.id instead. Try that
    // lookup before giving up. See docs/specs/B2B-10-requirement-document.md
    // Section 4.1 — this is the only change to the pre-existing B2C miss path.
    const { data: partnerSessionRow } = await supabase
      .from('partner_sessions')
      .select('id, partner_account_id, status, test_mode, updated_at, attendee_joined_at, provider_bot_id')
      .eq('id', userId)
      .maybeSingle()

    if (partnerSessionRow) {
      await handlePartnerSessionEvent(event, {
        id: partnerSessionRow.id as string,
        partnerAccountId: partnerSessionRow.partner_account_id as string,
        status: partnerSessionRow.status as string,
        testMode: Boolean(partnerSessionRow.test_mode),
        updatedAt: partnerSessionRow.updated_at as string,
        attendeeJoinedAt: (partnerSessionRow.attendee_joined_at as string | null) ?? null,
        providerBotId: (partnerSessionRow.provider_bot_id as string | null) ?? null,
      })
      return
    }

    console.warn('[attendee/webhook] No walkthrough_state or partner_sessions row for userId', userId)
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

// ─── B2B-10 — PARTNER SESSION HANDLER ───────────────────────────────────────
// See docs/specs/B2B-10-requirement-document.md Section 4.2. Reached only on
// a walkthrough_state lookup miss (the B2C switch above is byte-for-byte
// unchanged). Mirrors the B2C switch's structure and log style, but every
// branch here is deliberately thinner — see the spec for why each one is a
// no-op or confirmatory-log-only, except the ended/fatal_error fallback path.

interface PartnerSessionForEvent {
  id: string
  partnerAccountId: string
  status: string
  testMode: boolean
  updatedAt: string
  attendeeJoinedAt: string | null
  // B2B-50 — threaded through so the fatal_error/ended fallback path can also proactively tell
  // Attendee to leave (a safe, cheap no-op in the common case — the bot's typically already gone
  // by the time this fallback fires).
  providerBotId: string | null
}

async function handlePartnerSessionEvent(
  event: AttendeeWebhookEvent,
  row: PartnerSessionForEvent
) {
  const botId = event.bot_id

  switch (event.trigger) {
    case 'bot.state_change': {
      const state = event.data.new_state as string | undefined

      if (state === 'joined_recording') {
        // B2B-19 (billing gap 2) — capture Attendee's authoritative bot-join
        // timestamp when the payload carries one, so session end can bill the
        // real (ended − joined) duration. Provider_bot_id is already persisted
        // at dispatch time; this write only records timing.
        const joinedTs = extractAttendeeEventTimestamp(event)
        if (joinedTs) {
          const supabase = createSupabaseAdminClient()
          await supabase.from('partner_sessions').update({ attendee_joined_at: joinedTs }).eq('id', row.id)
        }
        console.log('[attendee/webhook] partner session joined_recording:', { botId, partnerSessionId: row.id, attendeeJoinedAt: joinedTs })
        break
      }

      if (state === 'ended' || state === 'fatal_error') {
        // Fallback safety net, not a second source of truth — the client-side
        // path (PartnerRenderClient.tsx's endSessionOnce() -> /api/partner/render/end-session
        // -> handleSessionEnd()) is authoritative and expected to win in the common case.
        if (row.status === 'completed' || row.status === 'failed') {
          console.log('[attendee/webhook] partner session already finalized — no-op:', { botId, partnerSessionId: row.id, state, status: row.status })
          break
        }

        // B2B-19 (billing gap 2) — prefer Attendee's own timing. If both the
        // join (row.attendeeJoinedAt) and this end event carry real Attendee
        // timestamps, bill (ended − joined) and label 'attendee'. Otherwise fall
        // back to webhook-RECEIPT time, labeled 'attendee_receipt' (distinct from
        // a true Attendee-measured value) so provenance stays honest/queryable.
        const supabase = createSupabaseAdminClient()
        const endedTsReal = extractAttendeeEventTimestamp(event)
        const joinedTsReal = row.attendeeJoinedAt

        let durationMinutes: number
        let billedSource: 'attendee' | 'attendee_receipt'
        let attendeeEndedAtToStore: string

        if (endedTsReal && joinedTsReal) {
          durationMinutes = clampDurationMinutes(new Date(endedTsReal).getTime() - new Date(joinedTsReal).getTime())
          billedSource = 'attendee'
          attendeeEndedAtToStore = endedTsReal
        } else {
          const base = joinedTsReal ? new Date(joinedTsReal).getTime() : new Date(row.updatedAt).getTime()
          durationMinutes = clampDurationMinutes(Date.now() - base)
          billedSource = 'attendee_receipt'
          attendeeEndedAtToStore = new Date().toISOString()
        }

        await supabase.from('partner_sessions').update({ attendee_ended_at: attendeeEndedAtToStore }).eq('id', row.id)

        const targetStatus: 'completed' | 'failed' = state === 'fatal_error' ? 'failed' : 'completed'

        console.warn('[attendee/webhook] partner session fallback completion triggered (client-side end-session never landed):', {
          botId,
          partnerSessionId: row.id,
          state,
          targetStatus,
          durationMinutes,
          billedSource,
        })

        await handleSessionEnd(row.id, row.partnerAccountId, durationMinutes, row.testMode, row.providerBotId, targetStatus, billedSource)
      }
      break
    }

    case 'transcript.update': {
      // No-op, log-only. See docs/specs/B2B-10-requirement-document.md Section 4.2 —
      // building a partner-session equivalent of analyzeTranscription()/user_session_context
      // would mean persisting partner end-user transcript content, in tension with
      // CORE_OBJECTIVES.md's Non-Negotiable Data Boundary. Never log the transcript text itself.
      const text = ((event.data.transcription as Record<string, unknown>)?.transcript as string | null) ?? ''
      console.log('[attendee/webhook] partner session transcript.update (not forwarded, not persisted):', { partnerSessionId: row.id, transcriptLength: text.length })
      break
    }

    case 'participant_events.join_leave': {
      // B2B-11 (Requirement Doc Section 6.2) — closes the gap B2B-10
      // deliberately left open: sets the join-greeting flag instead of only
      // logging. Guard shape mirrors the B2C branch's own
      // `eventType !== 'participant_joined' || !participantName` check.
      const participantName = (event.data.participant_name as string | null) ?? ''
      const eventType = event.data.event_type as string | undefined
      const supabase = createSupabaseAdminClient()

      // Resolve the partner's configured assistant display name once — used by both branches
      // below to make sure the bot's own presence is never counted as a participant (AT-12).
      const theme = await getThemeConfig(row.partnerAccountId)
      const botNameLower = (theme.assistantDisplayName ?? 'clio').toLowerCase()
      const isBotName = (name: string) => name.toLowerCase().includes(botNameLower) || name.toLowerCase().includes('clio')

      // B2B-46 Step 1 — diagnostic only, zero behavioral change. This codebase's
      // 'participant_joined' string is an unverified guess at Attendee's actual event_type
      // vocabulary (their public docs describe 'join'/'leave', not 'participant_joined'/
      // 'participant_left') — the same guessing mistake already may have left this very branch's
      // join-greeting silently non-functional. Logging the raw payload here, before any behavior is
      // built on top of a second guess, lets the next live test confirm the real "participant left"
      // event_type value with certainty rather than assuming it.
      if (eventType !== 'participant_joined') {
        console.log('[attendee/webhook] participant_events.join_leave — non-join event, raw payload for B2B-46 diagnosis:', {
          partnerSessionId: row.id,
          eventType,
          fullPayload: JSON.stringify(event.data),
        })

        // B2B-50 §6.4 — deliberately does NOT match a guessed "leave" string. Any non-join event
        // on this trigger is treated as a departure. Skips the bot's own name exactly like the
        // join branch below does, so the bot leaving (deleteBot() tearing down its own presence)
        // is never miscounted as a participant leaving (AT-12).
        const isBot = Boolean(participantName) && isBotName(participantName)
        if (!isBot) {
          const { data: decremented, error: decrementError } = await supabase
            .rpc('decrement_active_participant_count', { p_session_id: row.id })
          if (decrementError) {
            console.error('[attendee/webhook] decrement_active_participant_count failed (non-fatal):', decrementError.message)
          } else {
            const newCount = (decremented as { active_participant_count?: number } | null)?.active_participant_count ?? null
            console.log('[attendee/webhook] participant left (inferred, non-join event) — active_participant_count now:', newCount, { partnerSessionId: row.id })
            if (newCount === 0 && row.status !== 'completed' && row.status !== 'failed') {
              inngest.send({
                name: 'clio/partner-session.participants-empty',
                data: { clioSessionRef: row.id, partnerAccountId: row.partnerAccountId },
              }).catch((err) => console.error('[attendee/webhook] clio/partner-session.participants-empty emit failed:', err))
            }
          }
        }
      }

      if (eventType !== 'participant_joined' || !participantName) break

      // Skip the bot itself — also checks the partner's configured assistant
      // name, not just the literal "clio" the B2C branch checks, since a
      // partner-branded bot's display name in the meeting roster may not be
      // "Clio".
      if (isBotName(participantName)) break

      const firstName = participantName.split(' ')[0] ?? participantName

      await supabase.from('partner_sessions')
        .update({ join_greeting_pending: true, join_greeting_participant_first_name: firstName })
        .eq('id', row.id)

      // B2B-50 §6.5 — arms the debounce mechanism above. A no-op update failure here is logged,
      // non-fatal (mirrors every other best-effort write in this file).
      const { error: incrementError } = await supabase.rpc('increment_active_participant_count', { p_session_id: row.id })
      if (incrementError) console.error('[attendee/webhook] increment_active_participant_count failed (non-fatal):', incrementError.message)

      console.log('[attendee/webhook] partner session participant.joined — join greeting flag set:', { partnerSessionId: row.id, firstName })
      break
    }

    default:
      console.log('[attendee/webhook] Unhandled trigger for partner session:', event.trigger, { partnerSessionId: row.id })
  }
}
