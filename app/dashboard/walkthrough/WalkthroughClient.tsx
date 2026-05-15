'use client'

import { useEffect, useRef, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import ConceptVisualizer from '@/components/walkthrough/ConceptVisualizer'
import type { VisualSpec } from '@/lib/session-ai'
import { Conversation } from '@11labs/client'

const AGENT_ID = process.env.NEXT_PUBLIC_ELEVENLABS_AGENT_ID ?? 'agent_0701krp1ta48fswrff17ctb0520m'

type WalkthroughStatus = 'idle' | 'generating' | 'ready' | 'wiping'
type AgentStatus = 'disconnected' | 'connecting' | 'listening' | 'speaking' | 'error'

interface WalkthroughState {
  user_id: string
  status: WalkthroughStatus
  visual_spec: VisualSpec | null
  topic_title?: string | null
  bot_id?: string | null
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

  // Connect to ElevenLabs Conversational AI agent on mount
  useEffect(() => {
    let cancelled = false

    const connect = async () => {
      setAgentStatus('connecting')
      setAgentError(null)

      try {
        // Request microphone access — Recall.ai headless browser provides meeting audio as mic input
        await navigator.mediaDevices.getUserMedia({ audio: true })

        if (cancelled) return

        const conv = await Conversation.startSession({
          agentId: AGENT_ID,
          connectionType: 'webrtc',
          onConnect: ({ conversationId }: { conversationId: string }) => {
            console.log('[Walkthrough] ElevenLabs agent connected, conversationId:', conversationId)
            setAgentStatus('listening')
          },
          onDisconnect: () => {
            console.log('[Walkthrough] ElevenLabs agent disconnected')
            setAgentStatus('disconnected')
          },
          onError: (message: string) => {
            console.error('[Walkthrough] ElevenLabs agent error:', message)
            setAgentStatus('error')
            setAgentError(message.slice(0, 60))
          },
          onModeChange: ({ mode }: { mode: 'listening' | 'speaking' }) => {
            console.log('[Walkthrough] Agent mode:', mode)
            setAgentStatus(mode)
          },
        })

        if (cancelled) {
          conv.endSession().catch(() => {})
          return
        }

        conversationRef.current = conv
        console.log('[Walkthrough] Agent session started, agent ID:', AGENT_ID)
      } catch (err) {
        if (cancelled) return
        const msg = err instanceof Error ? err.message : String(err)
        console.error('[Walkthrough] Failed to start agent session:', msg)
        setAgentStatus('error')
        setAgentError(msg.slice(0, 60))
      }
    }

    connect()

    return () => {
      cancelled = true
      conversationRef.current?.endSession().catch(() => {})
      conversationRef.current = null
    }
  }, [])

  // Poll walkthrough state every second for visual_spec and status updates
  useEffect(() => {
    let active = true

    const poll = async () => {
      try {
        const res = await fetch(`/api/walkthrough-state/${userId}`)
        if (!active) return
        if (!res.ok) {
          setPollError(`HTTP ${res.status}`)
          return
        }
        setPollError(null)
        setPollCount(n => n + 1)
        const data = await res.json() as WalkthroughState
        setState(data)
      } catch (err) {
        setPollError(String(err).slice(0, 30))
      }
    }

    poll()
    const interval = setInterval(poll, 1000)
    return () => {
      active = false
      clearInterval(interval)
    }
  }, [userId])

  const status = state.status ?? 'idle'
  const spec = state.visual_spec

  const agentStatusColor =
    agentStatus === 'listening' ? 'bg-blue-900/80 text-blue-300' :
    agentStatus === 'speaking' ? 'bg-green-900/80 text-green-300' :
    agentStatus === 'connecting' ? 'bg-yellow-900/80 text-yellow-300' :
    agentStatus === 'error' ? 'bg-red-900/80 text-red-300' :
    'bg-gray-900/80 text-gray-500'

  return (
    <div
      ref={containerRef}
      className="min-h-screen w-full bg-[#080808] overflow-hidden relative"
      style={{ position: 'fixed', inset: 0 }}
    >
      <AnimatePresence mode="wait">
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
      </AnimatePresence>

      {/* Debug overlay */}
      <div className="fixed bottom-3 right-3 z-50 text-xs font-mono space-y-1">
        <div className={`px-2 py-1 rounded ${agentStatusColor}`}>
          🎙 {agentStatus}{agentStatus === 'error' && agentError ? `: ${agentError}` : ''}
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
