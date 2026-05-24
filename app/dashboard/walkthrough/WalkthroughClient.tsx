'use client'

import { useEffect, useRef, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import ConceptVisualizer from '@/components/walkthrough/ConceptVisualizer'
import SessionStack from '@/components/templates/SessionStack'
import type { VisualSpec } from '@/lib/session-ai'
import type { TemplateSection } from '@/lib/templates/types'
import { Conversation } from '@11labs/client'

const AGENT_ID = process.env.NEXT_PUBLIC_ELEVENLABS_AGENT_ID ?? 'agent_0701krp1ta48fswrff17ctb0520m'

// Siren voice ID — locked via overrides.tts.voiceId to ensure consistent voice
// across the firstMessage and all subsequent LLM-generated responses.
const VOICE_ID = process.env.NEXT_PUBLIC_ELEVENLABS_VOICE_ID ?? 'eXpIbVcVbLo8ZJQDlDnl'

// How long (ms) of polling silence before sending a keep-alive context update.
// Keep short — ElevenLabs closes the WebSocket after ~15s of inactivity.
const KEEPALIVE_INTERVAL = 8_000
const MAX_RECONNECT = 6

// ElevenLabs agent.prompt.prompt override has a practical limit around 12,000 chars.
// Beyond this the connection drops silently. session_brief + session_script fit easily;
// topic_context is truncated to fill the remaining budget.
const MAX_PROMPT_CHARS = 12_000

type WalkthroughStatus = 'idle' | 'generating' | 'ready' | 'wiping'
type AgentStatus = 'disconnected' | 'connecting' | 'listening' | 'speaking' | 'error'

// Inline types — mirrors lib/content/script-generator.ts without the server-only Anthropic import
type ScriptSegmentType = 'TEACH' | 'CHECKPOINT' | 'PROBE' | 'CONTINUE'
interface ScriptSegment {
  type: ScriptSegmentType
  content: string
  duration_seconds?: number
}
interface TrainingScript {
  subtopic_title: string
  subtopic_slug: string
  segments: ScriptSegment[]
}

interface WalkthroughState {
  user_id: string
  status: WalkthroughStatus
  visual_spec: VisualSpec | null
  sections: TemplateSection[] | null
  current_section_index: number
  topic_title?: string | null
  bot_id?: string | null
  pending_transcript?: string | null
  skipped_topics?: string[] | null
  training_scripts?: TrainingScript[] | null
  // Three-document system
  session_brief?: string | null
  topic_context?: string | null
  session_script?: string | null
  // Legacy combined field — fallback only
  clio_session_context?: string | null
}

/**
 * Formats all training scripts as a coaching brief for Clio's LLM context.
 * Sent once on session connect — gives Clio the exact content for every section
 * so its spoken words align with the visuals shown on screen.
 */
function buildScriptContext(scripts: TrainingScript[]): string {
  if (scripts.length === 0) return ''
  const sections = scripts
    .filter(Boolean)
    .map((s, i) => {
      const get = (type: ScriptSegmentType) =>
        s.segments.find((seg) => seg.type === type)?.content ?? ''
      return [
        `[SECTION ${i + 1}: "${s.subtopic_title}"]`,
        `TEACH: ${get('TEACH')}`,
        `CHECKPOINT: ${get('CHECKPOINT')}`,
        `PROBE (if they seem uncertain): ${get('PROBE')}`,
        `CONTINUE (bridge before calling show_visual for next section): ${get('CONTINUE')}`,
      ].join('\n')
    })
    .join('\n\n---\n\n')

  return (
    '\n\nYOUR PRE-WRITTEN COACHING SCRIPTS — these are your exact words for this session. ' +
    'Deliver the TEACH content naturally when you advance to each section. Do not improvise the core explanation — use the script.\n\n' +
    sections +
    '\n\nScript delivery rules: ' +
    '(1) Call show_visual first, then deliver the TEACH script for that section. ' +
    '(2) After TEACH, ask the CHECKPOINT question verbatim. ' +
    '(3) If the participant seems uncertain, deliver the PROBE reframe. ' +
    '(4) Use the CONTINUE text as the bridge before advancing to the next section.'
  )
}

interface Props {
  userId: string
  initialState: WalkthroughState
}

function DotsLoader() {
  return (
    <div className="flex gap-2 items-center">
      {[0, 1, 2].map((i) => (
        <motion.div
          key={i}
          className="w-2 h-2 rounded-full bg-[#7C3AED]"
          animate={{ opacity: [0.3, 1, 0.3], scale: [0.8, 1.2, 0.8] }}
          transition={{ duration: 1.2, repeat: Infinity, delay: i * 0.2 }}
        />
      ))}
    </div>
  )
}

function PulsingRing() {
  return (
    <div className="relative w-24 h-24 flex items-center justify-center">
      {[0, 1, 2].map((i) => (
        <motion.div
          key={i}
          className="absolute inset-0 rounded-full border-2 border-[#7C3AED]"
          animate={{ scale: [1, 1.6 + i * 0.3], opacity: [0.6, 0] }}
          transition={{ duration: 2, repeat: Infinity, delay: i * 0.5, ease: 'easeOut' }}
        />
      ))}
      <div className="w-12 h-12 rounded-full bg-purple-950/50 border border-[#7C3AED] flex items-center justify-center">
        <span className="text-sm font-bold text-white">C</span>
      </div>
    </div>
  )
}

export default function WalkthroughClient({ userId, initialState }: Props) {
  const [state, setState] = useState<WalkthroughState>(initialState)
  const containerRef = useRef<HTMLDivElement>(null)
  const [dimensions, setDimensions] = useState({ width: 1280, height: 720 })
  const [agentStatus, setAgentStatus] = useState<AgentStatus>('disconnected')
  const [agentError, setAgentError] = useState<string | null>(null)
  const [pollCount, setPollCount] = useState(0)
  const [pollError, setPollError] = useState<string | null>(null)
  const conversationRef = useRef<Conversation | null>(null)
  const lastSentTranscriptRef = useRef<string | null>(null)
  const lastActivityRef = useRef<number>(Date.now())
  const hasConnectedRef = useRef(false)
  const sessionEndedRef = useRef(false)
  const topicRef = useRef<string | null | undefined>(initialState.topic_title)
  const skippedTopicsRef = useRef<string[]>(initialState.skipped_topics ?? [])
  const sectionsRef = useRef<TemplateSection[]>(initialState.sections ?? [])
  const trainingScriptsRef = useRef<TrainingScript[]>((initialState.training_scripts ?? []) as TrainingScript[])
  // Three-document system — used to build the ElevenLabs system prompt override
  const sessionBriefRef = useRef<string | null>(initialState.session_brief ?? null)
  const topicContextRef = useRef<string | null>(initialState.topic_context ?? null)
  const sessionScriptRef = useRef<string | null>(initialState.session_script ?? null)
  // Legacy fallback
  const clioSessionContextRef = useRef<string | null>(initialState.clio_session_context ?? null)
  const reconnectAttemptsRef = useRef(0)
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Track container dimensions
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect
        setDimensions({ width, height })
      }
    })
    observer.observe(el)
    setDimensions({ width: el.clientWidth, height: el.clientHeight })
    return () => observer.disconnect()
  }, [])

  // Track graceful session end — set true when Clio says goodbye or calls end_session
  const [sessionComplete, setSessionComplete] = useState(false)
  // Track the reason for a permanent connection failure (after all retries exhausted)
  const [connectionError, setConnectionError] = useState<string | null>(null)
  // Retry count as state so the UI re-renders when it changes
  const [retryCount, setRetryCount] = useState(0)
  const stableConnectionTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Connect to ElevenLabs agent on mount, with auto-reconnect on unexpected drops
  useEffect(() => {
    let cancelled = false

    const connect = async () => {
      if (cancelled) return
      const isReconnect = hasConnectedRef.current
      setAgentStatus('connecting')
      setAgentError(null)

      try {
        // Mic permission required for WebSocket audio session.
        // Headless browser mic returns silence — participant speech reaches the
        // agent via sendUserMessage() fed by the transcript webhook instead.
        await navigator.mediaDevices.getUserMedia({ audio: true })
        if (cancelled) return

        const topic = topicRef.current
        const greeting = topic
          ? `Hi, I'm Clio, your AI learning companion. Today we're covering "${topic}". I've prepared everything — let's dive straight in. Ready?`
          : `Hi, I'm Clio, your AI learning companion. I'm here and ready to coach you. Let's get started.`

        // Custom LLM mode: the full session context (41k chars) lives server-side at
        // /api/clio/llm. We pass only the userId so the endpoint knows which user's
        // context to fetch from walkthrough_state. No size limit issues.
        const conv = await Conversation.startSession({
          agentId: AGENT_ID,
          connectionType: 'websocket',
          dynamicVariables: { user_id: userId },
          overrides: {
            agent: {
              // Minimal prompt — just the userId marker. The custom LLM endpoint
              // at /api/clio/llm fetches the real 41k context from the DB each turn.
              prompt: { prompt: `You are Clio, an AI business coach. DISTILL_USER_ID: ${userId}` },
              // Suppress re-greeting on reconnect — ElevenLabs replays firstMessage
              // every time a new WebSocket session starts without this override.
              firstMessage: isReconnect ? '' : greeting,
            },
            tts: {
              voiceId: VOICE_ID,
            },
          },
          clientTools: {
            end_session: async () => {
              console.log('[Walkthrough] Agent called end_session — session closing')
              sessionEndedRef.current = true
              setSessionComplete(true)
              return 'Session ended.'
            },
            show_visual: async ({ topic_id, topic_title }: { topic_id: string; topic_title: string }) => {
              console.log('[Walkthrough] show_visual called —', topic_title)
              try {
                // New flow: find matching section and scroll to it
                const sections = sectionsRef.current
                if (sections.length > 0) {
                  const needle = topic_title.toLowerCase()
                  const idx = sections.findIndex((s) => {
                    const haystack = s.meta.subtopicTitle.toLowerCase()
                    const words = needle.split(' ').slice(0, 4).join(' ')
                    return haystack.includes(words) || needle.includes(haystack.split(' ').slice(0, 4).join(' '))
                  })
                  if (idx >= 0) {
                    await fetch(`/api/walkthrough-state/${userId}`, {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ command: 'scroll_to', section_index: idx }),
                    })

                    // Look up the training script for this section and return it as an
                    // instruction so Clio's LLM delivers the pre-written TEACH script
                    // verbatim — aligning what Clio says with what's on screen.
                    const scripts = trainingScriptsRef.current
                    const script = scripts[idx]
                    if (script) {
                      const teachSeg = script.segments.find((s) => s.type === 'TEACH')
                      const checkpointSeg = script.segments.find((s) => s.type === 'CHECKPOINT')
                      const probeSeg = script.segments.find((s) => s.type === 'PROBE')
                      const continueSeg = script.segments.find((s) => s.type === 'CONTINUE')
                      if (teachSeg) {
                        const sectionTitle = sections[idx].meta.subtopicTitle
                        return (
                          `Visual is now showing: "${sectionTitle}" (section ${idx + 1} of ${sections.length}).\n\n` +
                          `Deliver your TEACH script for this section now — speak it naturally as if from memory:\n\n` +
                          `${teachSeg.content}\n\n` +
                          `Then ask this CHECKPOINT question:\n"${checkpointSeg?.content ?? 'How does that land for you?'}"\n\n` +
                          `If they seem uncertain, use this PROBE reframe:\n"${probeSeg?.content ?? 'Let me try a different angle.'}"\n\n` +
                          `When ready to advance, say this CONTINUE bridge:\n"${continueSeg?.content ?? 'Good — let\'s move on.'}"\n` +
                          `Then call show_visual for the next section.`
                        )
                      }
                    }

                    return `Now showing: ${sections[idx].meta.subtopicTitle}`
                  }
                }
                // Legacy fallback: generate a VisualSpec and display it
                const res = await fetch('/api/generate-visual', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ userId, topicId: topic_id, topicTitle: topic_title }),
                })
                const data = await res.json() as { ok: boolean }
                return data.ok ? 'Visual is now showing on screen.' : 'Visual could not be loaded.'
              } catch {
                return 'Visual failed to load.'
              }
            },
            defer_question: async ({ question }: { question: string }) => {
              console.log('[Walkthrough] defer_question called —', question.slice(0, 80))
              try {
                await fetch('/api/defer-question', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ userId, question }),
                })
              } catch {
                // Non-fatal — Clio still continues the session
              }
              return 'Question saved for follow-up session.'
            },
          },
          onConnect: ({ conversationId }: { conversationId: string }) => {
            console.log('[Walkthrough] Agent connected, id:', conversationId)
            setAgentStatus('listening')
            // Only reset retry counter after 30s of stable connection.
            // ElevenLabs can hold a WebSocket for 10-15s before dropping even when
            // something is wrong — 30s means the session is genuinely working.
            if (stableConnectionTimerRef.current) clearTimeout(stableConnectionTimerRef.current)
            stableConnectionTimerRef.current = setTimeout(() => {
              reconnectAttemptsRef.current = 0
              setRetryCount(0)
              console.log('[Walkthrough] Connection stable for 30s — retry counter reset')
            }, 30_000)
          },
          onDisconnect: () => {
            console.log('[Walkthrough] Agent disconnected')
            conversationRef.current = null
            setAgentStatus('disconnected')

            if (sessionEndedRef.current) {
              console.log('[Walkthrough] Session ended by agent — not reconnecting')
              return
            }

            if (!cancelled && reconnectAttemptsRef.current < MAX_RECONNECT) {
              reconnectAttemptsRef.current++
              setRetryCount(reconnectAttemptsRef.current)
              const delay = Math.min(3000 * reconnectAttemptsRef.current, 20000)
              console.log(`[Walkthrough] Reconnecting in ${delay}ms (attempt ${reconnectAttemptsRef.current}/${MAX_RECONNECT})`)
              reconnectTimerRef.current = setTimeout(connect, delay)
            } else if (!cancelled) {
              const reason = 'ElevenLabs WebSocket dropped and could not reconnect after 6 attempts.'
              console.error('[Walkthrough] Max reconnect attempts reached —', reason)
              setAgentStatus('error')
              setAgentError(reason)
              setConnectionError(reason)
            }
          },
          onError: (message: string) => {
            console.error('[Walkthrough] Agent error:', message)
            setAgentStatus('error')
            setAgentError(message.slice(0, 60))
          },
          onModeChange: ({ mode }: { mode: 'listening' | 'speaking' }) => {
            console.log('[Walkthrough] Agent mode:', mode)
            setAgentStatus(mode)
          },
          onMessage: ({ message, source }: { message: string; source: string }) => {
            console.log(`[Walkthrough] Agent message [${source}]:`, message.slice(0, 120))
            // Detect graceful session end from Clio's speech so we don't reconnect
            if (source === 'ai') {
              const lower = message.toLowerCase()
              const farewells = ['bye', 'goodbye', 'farewell', 'take care', 'see you',
                'until next time', 'session is complete', "that's all for today",
                "we're done", 'all done', 'great work today', 'well done today']
              if (farewells.some((w) => lower.includes(w))) {
                console.log('[Walkthrough] Farewell detected in agent speech — marking session ended')
                sessionEndedRef.current = true
                setSessionComplete(true)
              }
            }
          },
          onStatusChange: ({ status }: { status: string }) => {
            console.log('[Walkthrough] Agent status:', status)
          },
        })

        if (cancelled) { conv.endSession().catch(() => {}); return }
        hasConnectedRef.current = true
        conversationRef.current = conv
        lastActivityRef.current = Date.now()

        // Context is fetched server-side by /api/clio/llm on every turn — no client-side context needed.
        // Only send a reconnect notice if the WebSocket dropped mid-session.
        if (isReconnect) {
          conv.sendContextualUpdate(
            'The WebSocket connection briefly dropped and reconnected. Do not re-introduce yourself — continue the session naturally from where you left off.'
          )
        }

        console.log(
          '[Walkthrough]',
          isReconnect ? 'Reconnected — server-side context persists' : `Session started — context fetched by custom LLM for user=${userId}`
        )
      } catch (err) {
        if (cancelled) return
        const msg = err instanceof Error ? err.message : String(err)
        console.error('[Walkthrough] Failed to start agent session:', msg)
        setAgentStatus('error')
        setAgentError(msg.slice(0, 60))

        if (reconnectAttemptsRef.current < MAX_RECONNECT) {
          reconnectAttemptsRef.current++
          setRetryCount(reconnectAttemptsRef.current)
          const delay = Math.min(3000 * reconnectAttemptsRef.current, 20000)
          console.log(`[Walkthrough] Connection failed, retrying in ${delay}ms (attempt ${reconnectAttemptsRef.current}/${MAX_RECONNECT})`)
          reconnectTimerRef.current = setTimeout(connect, delay)
        } else {
          const reason = `Failed to establish ElevenLabs connection after ${MAX_RECONNECT} attempts. Last error: ${msg}`
          console.error('[Walkthrough] Giving up —', reason)
          setConnectionError(reason)
        }
      }
    }

    connect()
    return () => {
      cancelled = true
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current)
      conversationRef.current?.endSession().catch(() => {})
      conversationRef.current = null
    }
  }, [userId])

  // Poll walkthrough_state every second:
  // - Update visual_spec / status for the screen
  // - Forward pending_transcript to ElevenLabs agent via sendUserMessage
  // - Send keep-alive context update every 25s to prevent inactivity disconnect
  useEffect(() => {
    let active = true

    const poll = async () => {
      try {
        const res = await fetch(`/api/walkthrough-state/${userId}`)
        if (!active) return
        if (!res.ok) { setPollError(`HTTP ${res.status}`); return }

        setPollError(null)
        setPollCount(n => n + 1)
        const data = await res.json() as WalkthroughState
        setState(data)
        if (data.topic_title) topicRef.current = data.topic_title
        if (data.skipped_topics) skippedTopicsRef.current = data.skipped_topics
        if (data.sections) sectionsRef.current = data.sections
        if (data.training_scripts) trainingScriptsRef.current = data.training_scripts as TrainingScript[]
        if (data.session_brief) sessionBriefRef.current = data.session_brief
        if (data.topic_context) topicContextRef.current = data.topic_context
        if (data.session_script) sessionScriptRef.current = data.session_script
        if (data.clio_session_context) clioSessionContextRef.current = data.clio_session_context

        const conv = conversationRef.current

        // Feed participant transcript to agent if new
        const transcript = data.pending_transcript
        if (transcript && transcript !== lastSentTranscriptRef.current && conv) {
          lastSentTranscriptRef.current = transcript
          lastActivityRef.current = Date.now()
          conv.sendUserMessage(transcript)
          console.log('[Walkthrough] Sent to agent:', transcript.slice(0, 80))
          fetch(`/api/walkthrough-state/${userId}`, { method: 'PATCH' }).catch(() => {})
          setTimeout(poll, 0)
        }

        // Keep-alive: prevent ElevenLabs inactivity disconnect when user is silent
        if (conv && Date.now() - lastActivityRef.current > KEEPALIVE_INTERVAL) {
          lastActivityRef.current = Date.now()
          conv.sendContextualUpdate('Session is ongoing. Participant may be listening.')
          console.log('[Walkthrough] Keep-alive sent')
        }
      } catch (err) {
        if (active) setPollError(String(err).slice(0, 30))
      }
    }

    poll()
    const interval = setInterval(poll, 300)
    return () => { active = false; clearInterval(interval) }
  }, [userId])

  const status = state.status ?? 'idle'
  const spec = state.visual_spec
  const hasSections = (state.sections?.length ?? 0) > 0

  const agentStatusColor =
    agentStatus === 'listening'    ? 'bg-blue-900/80 text-blue-300' :
    agentStatus === 'speaking'     ? 'bg-green-900/80 text-green-300' :
    agentStatus === 'connecting'   ? 'bg-yellow-900/80 text-yellow-300' :
    agentStatus === 'error'        ? 'bg-red-900/80 text-red-300' :
    'bg-gray-900/80 text-gray-500'

  return (
    <div
      ref={containerRef}
      className="min-h-screen w-full bg-[#080808] overflow-hidden relative"
      style={{ position: 'fixed', inset: 0 }}
    >
      {/* Template-based session stack — shown when sections are pre-generated */}
      {hasSections && state.sections && (
        <SessionStack
          sections={state.sections}
          currentSectionIndex={state.current_section_index ?? 0}
          userId={userId}
        />
      )}

      {/* Legacy single-visual renderer — shown when no sections are available */}
      {!hasSections && <AnimatePresence mode="wait">
        {status === 'idle' && (
          <motion.div
            key="idle"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.4 }}
            className="absolute inset-0 flex flex-col items-center justify-center gap-4"
          >
            <motion.div
              initial={{ scale: 0.8, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ delay: 0.1, duration: 0.5 }}
              className="flex items-baseline gap-2"
            >
              <span className="text-5xl font-extrabold tracking-tight text-white">Clio</span>
              <span className="text-sm text-[#7C3AED] font-semibold uppercase tracking-widest">AI</span>
            </motion.div>
            <motion.p
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.3 }}
              className="text-[#475569] text-lg"
            >
              Your session will begin shortly...
            </motion.p>
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.6 }}>
              <DotsLoader />
            </motion.div>
          </motion.div>
        )}

        {status === 'generating' && (
          <motion.div
            key="generating"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.4 }}
            className="absolute inset-0 flex flex-col items-center justify-center gap-6"
          >
            <PulsingRing />
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.2 }}
              className="text-center space-y-2"
            >
              <p className="text-white text-xl font-semibold">Preparing your visual...</p>
              <p className="text-[#475569] text-sm">Just a moment — your coach is building this explanation</p>
            </motion.div>
          </motion.div>
        )}

        {status === 'wiping' && (
          <motion.div
            key="wiping"
            initial={{ opacity: 1 }}
            animate={{ opacity: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.6 }}
            className="absolute inset-0 bg-[#080808]"
          />
        )}

        {status === 'ready' && spec && (
          <motion.div
            key={`ready-${spec.topicId}`}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.5 }}
            className="absolute inset-0"
          >
            <ConceptVisualizer
              spec={spec}
              containerWidth={dimensions.width}
              containerHeight={dimensions.height}
              animationPhase="intro"
            />
          </motion.div>
        )}
      </AnimatePresence>}

      {/* Session complete overlay */}
      {sessionComplete && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="fixed inset-0 z-40 flex items-center justify-center bg-[#080808]/90"
        >
          <div className="text-center space-y-4 max-w-md px-8">
            <div className="text-5xl">✓</div>
            <h2 className="text-2xl font-bold text-white">Session Complete</h2>
            <p className="text-[#94A3B8]">Great work today. Clio has wrapped up the session.</p>
          </div>
        </motion.div>
      )}

      {/* Permanent connection error overlay */}
      {connectionError && !sessionComplete && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="fixed inset-0 z-40 flex items-center justify-center bg-[#080808]/90"
        >
          <div className="bg-[#111111] border border-red-900/50 rounded-xl p-8 max-w-md mx-4 space-y-4">
            <div className="flex items-center gap-3">
              <div className="w-3 h-3 rounded-full bg-red-500 shrink-0" />
              <h2 className="text-lg font-semibold text-white">Unable to Connect</h2>
            </div>
            <p className="text-[#94A3B8] text-sm leading-relaxed">
              Clio could not establish a stable connection after 6 attempts. This is usually a
              temporary issue with the voice service.
            </p>
            <p className="text-[#475569] text-xs font-mono break-all">{connectionError}</p>
            <button
              onClick={() => window.location.reload()}
              className="w-full py-2.5 rounded-lg bg-[#7C3AED] text-white text-sm font-medium hover:bg-[#6D28D9] transition-colors"
            >
              Refresh & Try Again
            </button>
          </div>
        </motion.div>
      )}

      {/* Debug overlay */}
      <div className="fixed bottom-3 right-3 z-50 text-xs font-mono space-y-1">
        <div className={`px-2 py-1 rounded ${agentStatusColor}`}>
          🎙 {agentStatus}{retryCount > 0 && agentStatus !== 'error' ? ` (retry ${retryCount}/${MAX_RECONNECT})` : ''}{agentStatus === 'error' && agentError ? `: ${agentError.slice(0, 50)}` : ''}
        </div>
        <div className="bg-gray-900/60 text-gray-600 px-2 py-1 rounded">
          polls: {pollCount}
        </div>
        {pollError && (
          <div className="bg-red-900/80 text-red-300 px-2 py-1 rounded">
            poll err: {pollError}
          </div>
        )}
      </div>
    </div>
  )
}
