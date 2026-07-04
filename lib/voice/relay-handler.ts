/**
 * AUD-01: Server-side audio relay handler.
 *
 * Bridges Attendee's PCM16 audio stream to ElevenLabs' conversational AI WebSocket.
 * Audio flows: Attendee mic → relay → ElevenLabs STT + LLM + TTS → relay → Attendee speaker.
 * Tool calls (show_visual, end_session) are handled here — no browser involvement needed.
 *
 * Toggle: MEETING_BOT_AUDIO_MODE=relay  (browser mode leaves this file entirely unused)
 */

import type { IncomingMessage } from 'http'
import { WebSocket } from 'ws'
import { parse } from 'url'
import { createSupabaseAdminClient } from '../supabase'
import { forceEndSession } from '../session-billing'

const AGENT_ID = process.env.NEXT_PUBLIC_ELEVENLABS_AGENT_ID ?? ''
const VOICE_ID = process.env.NEXT_PUBLIC_ELEVENLABS_VOICE_ID ?? 'eXpIbVcVbLo8ZJQDlDnl'

// Direct WebSocket URL — same agent ID already used by the browser SDK.
// No separate API key needed for public agents.
const EL_WS_URL = `wss://api.elevenlabs.io/v1/convai/conversation?agent_id=${AGENT_ID}`

// ─── ElevenLabs event shapes ──────────────────────────────────────────────────

interface ElevenLabsAudioEvent {
  type: 'audio'
  audio_event: { audio_base_64: string; event_id: number }
}

interface ElevenLabsClientToolCall {
  type: 'client_tool_call'
  client_tool_call: {
    tool_name: string
    tool_call_id: string
    parameters: Record<string, unknown>
    expects_response: boolean
  }
}

interface ElevenLabsPingEvent {
  type: 'ping'
  ping_event: { event_id: number }
}

// ─── Tool handlers ────────────────────────────────────────────────────────────

async function handleShowVisual(userId: string, sectionIndex: number): Promise<string> {
  const supabase = createSupabaseAdminClient()

  await supabase
    .from('walkthrough_state')
    .update({ current_section_index: sectionIndex })
    .eq('user_id', userId)

  const { data } = await supabase
    .from('walkthrough_state')
    .select('sections, training_scripts')
    .eq('user_id', userId)
    .single()

  if (!data) return `Now showing section ${sectionIndex}`

  const sections = (data.sections as Array<{ meta: { subtopicTitle: string } }> | null) ?? []
  const scripts = (data.training_scripts as Array<{
    subtopic_title: string
    segments: Array<{ type: string; content: string }>
  } | null> | null) ?? []

  const section = sections[sectionIndex]
  const script = scripts[sectionIndex] ?? null

  if (!section) return `Now showing section ${sectionIndex}`

  const sectionTitle = section.meta.subtopicTitle
  if (!script) return `Now showing: ${sectionTitle}`

  const get = (type: string) => script.segments.find((s) => s.type === type)?.content ?? null
  const teach = get('TEACH')
  const checkpoint = get('CHECKPOINT')
  const probe = get('PROBE')
  const cont = get('CONTINUE')

  if (!teach) return `Now showing: ${sectionTitle}`

  return [
    `Visual is now showing: "${sectionTitle}" (section ${sectionIndex + 1} of ${sections.length}).`,
    ``,
    `Deliver your TEACH script for this section now — speak it naturally as if from memory:`,
    ``,
    teach,
    ``,
    `Then ask this CHECKPOINT question:`,
    `"${checkpoint ?? 'How does that land for you?'}"`,
    ``,
    `If they seem uncertain, use this PROBE reframe:`,
    `"${probe ?? 'Let me try a different angle.'}"`,
    ``,
    `When ready to advance, say this CONTINUE bridge:`,
    `"${cont ?? "Good — let's move on."}"`,
    `Then call show_visual for the next section.`,
  ].join('\n')
}

async function handleEndSession(userId: string, sessionId: string): Promise<void> {
  // Call-end fix: this previously only flipped `sessions.status` to a value
  // ('complete') that doesn't match the 'completed' status the rest of the app
  // uses, and never told Recall.ai to leave the meeting — so the bot lingered
  // in the call indefinitely after end_session fired. Route through the same
  // idempotent forceEndSession() used by the wall-clock timer (D3) and the
  // voice-gap watchdog (D2/AC-D8): it deletes the bot, tears down
  // walkthrough_state, deducts audit-log-derived minutes, and marks the
  // session 'completed'. Unlike WalkthroughClient's browser-mode path (which
  // calls the public /api/sessions/end-call route because it runs inside the
  // bot's headless browser), this handler already runs server-side with a
  // trusted userId/sessionId from the relay's own WS query params, so it can
  // call forceEndSession directly — no HTTP hop or token needed.
  if (!sessionId) {
    console.warn(`[relay] end_session called with no sessionId — skipping teardown for user=${userId}`)
    return
  }
  try {
    const result = await forceEndSession({ userId, sessionId })
    console.log(`[relay] Session ended — user=${userId} session=${sessionId}:`, result)
  } catch (err) {
    console.error(`[relay] forceEndSession failed for session ${sessionId}:`, err)
  }
}

// ─── Main relay handler ───────────────────────────────────────────────────────

export async function handleAudioRelay(attendeeWs: WebSocket, req: IncomingMessage): Promise<void> {
  const { query } = parse(req.url ?? '', true)
  const userId = typeof query.userId === 'string' ? query.userId : ''
  const sessionId = typeof query.sessionId === 'string' ? query.sessionId : ''

  if (!userId) {
    console.error('[relay] No userId in query params — closing')
    attendeeWs.close(1008, 'Missing userId')
    return
  }

  console.log(`[relay] Attendee connected — user=${userId} session=${sessionId}`)

  // Fetch user first name for greeting
  const supabase = createSupabaseAdminClient()
  let firstName = ''
  try {
    const { data: userRow } = await supabase
      .from('users')
      .select('first_name')
      .eq('id', userId)
      .single()
    firstName = (userRow as { first_name?: string } | null)?.first_name ?? ''
  } catch {
    // Non-critical — greeting will skip the name
  }

  // Connect to ElevenLabs conversational AI WebSocket — same agent ID used by browser SDK
  const elWs = new WebSocket(EL_WS_URL)

  // ── ElevenLabs WS opened → send session initiation ─────────────────────────

  elWs.on('open', () => {
    console.log(`[relay] ElevenLabs WS connected — user=${userId}`)
    const nameGreet = firstName ? `Welcome, ${firstName}! ` : ''
    const greeting = `${nameGreet}I'm Clio, your AI learning companion. I've prepared everything for today's session — let's dive straight in.`

    const initEvent = {
      type: 'conversation_initiation_client_data',
      conversation_config_override: {
        agent: {
          // Minimal prompt — custom LLM at /api/clio/llm fetches full context from DB each turn
          prompt: { prompt: `You are Clio, an AI business coach. DISTILL_USER_ID: ${userId}` },
          first_message: greeting,
        },
        tts: { voice_id: VOICE_ID },
      },
      dynamic_variables: { user_id: userId },
    }
    elWs.send(JSON.stringify(initEvent))
  })

  // ── Attendee → ElevenLabs: forward PCM16 audio ─────────────────────────────

  attendeeWs.on('message', (raw: Buffer | string) => {
    if (elWs.readyState !== WebSocket.OPEN) return
    try {
      const msg = JSON.parse(raw.toString()) as Record<string, unknown>
      if (msg.trigger === 'realtime_audio.mixed') {
        const chunk = (msg.data as { chunk: string }).chunk
        elWs.send(JSON.stringify({ user_audio_chunk: chunk }))
      }
    } catch {
      // Non-JSON frames: ignore (shouldn't happen with Attendee JSON protocol)
    }
  })

  // ── ElevenLabs → handle all incoming events ─────────────────────────────────

  elWs.on('message', async (raw: Buffer) => {
    let event: Record<string, unknown>
    try {
      event = JSON.parse(raw.toString()) as Record<string, unknown>
    } catch {
      return
    }

    switch (event.type) {
      case 'audio': {
        // Forward TTS audio to Attendee as bot_output
        const ev = event as unknown as ElevenLabsAudioEvent
        if (attendeeWs.readyState === WebSocket.OPEN) {
          attendeeWs.send(JSON.stringify({
            trigger: 'realtime_audio.bot_output',
            data: { chunk: ev.audio_event.audio_base_64, sample_rate: 16000 },
          }))
        }
        break
      }

      case 'client_tool_call': {
        const ev = event as unknown as ElevenLabsClientToolCall
        const { tool_name, tool_call_id, parameters, expects_response } = ev.client_tool_call

        const sendResult = (result: string, isError = false) => {
          if (elWs.readyState === WebSocket.OPEN) {
            elWs.send(JSON.stringify({
              type: 'client_tool_result',
              tool_call_id,
              result,
              is_error: isError,
            }))
          }
        }

        if (tool_name === 'show_visual') {
          const idx = typeof parameters.section_index === 'number' ? parameters.section_index : 0
          console.log(`[relay] show_visual section_index=${idx} user=${userId}`)
          try {
            const result = await handleShowVisual(userId, idx)
            if (expects_response) sendResult(result)
          } catch (err) {
            console.error('[relay] show_visual error:', err)
            if (expects_response) sendResult('Visual updated.', false)
          }
        } else if (tool_name === 'end_session') {
          console.log(`[relay] end_session called — user=${userId}`)
          if (expects_response) sendResult('Session ended.')
          await handleEndSession(userId, sessionId)
          elWs.close()
          attendeeWs.close()
        } else if (tool_name === 'defer_question') {
          if (expects_response) sendResult('Question deferred.')
        } else {
          console.warn(`[relay] Unknown tool call: ${tool_name}`)
          if (expects_response) sendResult(`Tool ${tool_name} acknowledged.`)
        }
        break
      }

      case 'ping': {
        const ev = event as unknown as ElevenLabsPingEvent
        if (elWs.readyState === WebSocket.OPEN) {
          elWs.send(JSON.stringify({ type: 'pong', event_id: ev.ping_event.event_id }))
        }
        break
      }

      case 'conversation_initiation_metadata':
        console.log('[relay] ElevenLabs session initiated:', JSON.stringify(event).slice(0, 200))
        break

      default:
        // agent_response, user_transcript, interruption etc. — log at debug level
        if (process.env.NODE_ENV !== 'production') {
          console.log(`[relay] ElevenLabs event: ${event.type as string}`)
        }
    }
  })

  // ── Cleanup on either side closing ─────────────────────────────────────────

  elWs.on('error', (err) => {
    console.error(`[relay] ElevenLabs WS error — user=${userId}:`, err)
    if (attendeeWs.readyState === WebSocket.OPEN) attendeeWs.close(1011, 'ElevenLabs error')
  })

  elWs.on('close', (code, reason) => {
    console.log(`[relay] ElevenLabs WS closed — user=${userId} code=${code} reason=${reason.toString()}`)
    if (attendeeWs.readyState === WebSocket.OPEN) attendeeWs.close()
  })

  attendeeWs.on('error', (err) => {
    console.error(`[relay] Attendee WS error — user=${userId}:`, err)
    if (elWs.readyState === WebSocket.OPEN) elWs.close()
  })

  attendeeWs.on('close', (code) => {
    console.log(`[relay] Attendee WS closed — user=${userId} code=${code}`)
    if (elWs.readyState === WebSocket.OPEN) elWs.close()
  })
}
