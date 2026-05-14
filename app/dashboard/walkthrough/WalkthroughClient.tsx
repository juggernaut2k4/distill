'use client'

import { useEffect, useRef, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import ConceptVisualizer from '@/components/walkthrough/ConceptVisualizer'
import type { VisualSpec } from '@/lib/session-ai'

type WalkthroughStatus = 'idle' | 'generating' | 'ready' | 'wiping'
type AudioStatus = 'idle' | 'fetching' | 'playing' | 'error'

interface WalkthroughState {
  user_id: string
  status: WalkthroughStatus
  visual_spec: VisualSpec | null
  topic_title?: string | null
  bot_id?: string | null
  pending_speech?: string | null
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
  const lastPlayedSpeechRef = useRef<string | null>(null)
  const audioCtxRef = useRef<AudioContext | null>(null)
  const [audioStatus, setAudioStatus] = useState<AudioStatus>('idle')
  const [audioError, setAudioError] = useState<string | null>(null)

  // Initialize AudioContext on mount — must happen early so it's unlocked
  useEffect(() => {
    const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
    if (!Ctx) return
    const ctx = new Ctx()
    audioCtxRef.current = ctx
    // Resume immediately — Recall.ai headless browser allows this without user gesture
    ctx.resume().catch(() => {})
    return () => { ctx.close().catch(() => {}) }
  }, [])

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

  // Play TTS audio whenever pending_speech is set by the webhook
  useEffect(() => {
    const text = state.pending_speech
    if (!text || text === lastPlayedSpeechRef.current) return
    lastPlayedSpeechRef.current = text

    // Clear pending_speech via API so it doesn't replay on next poll
    fetch(`/api/walkthrough-state/${userId}`, { method: 'DELETE' }).catch(() => {})

    setAudioStatus('fetching')
    setAudioError(null)

    const playAudio = async () => {
      const res = await fetch('/api/tts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
      })
      if (!res.ok) throw new Error(`TTS HTTP ${res.status}`)

      const arrayBuffer = await res.arrayBuffer()
      const ctx = audioCtxRef.current

      if (ctx) {
        // Ensure AudioContext is running (may be suspended in some headless environments)
        if (ctx.state === 'suspended') await ctx.resume()
        // decodeAudioData needs a copy — slice to avoid detached buffer issues
        const decoded = await ctx.decodeAudioData(arrayBuffer.slice(0))
        const source = ctx.createBufferSource()
        source.buffer = decoded
        source.connect(ctx.destination)
        source.start(0)
        setAudioStatus('playing')
        console.log(`[Walkthrough] TTS playing via AudioContext — ${decoded.duration.toFixed(1)}s`)
        source.onended = () => setAudioStatus('idle')
      } else {
        // Fallback: Audio element
        const blob = new Blob([arrayBuffer], { type: 'audio/mpeg' })
        const url = URL.createObjectURL(blob)
        const audio = new Audio(url)
        setAudioStatus('playing')
        await audio.play()
        audio.onended = () => {
          URL.revokeObjectURL(url)
          setAudioStatus('idle')
        }
      }
    }

    playAudio().catch((err) => {
      console.error('[WalkthroughClient] TTS error:', err)
      setAudioStatus('error')
      setAudioError(String(err))
    })
  }, [state.pending_speech, userId])

  // Poll walkthrough state every second — more reliable than Supabase Realtime
  // in Recall.ai's headless browser (WebSocket connections can be unreliable there)
  useEffect(() => {
    let active = true

    const poll = async () => {
      try {
        const res = await fetch(`/api/walkthrough-state/${userId}`)
        if (!res.ok || !active) return
        const data = await res.json() as WalkthroughState
        setState(data)
      } catch {
        // ignore network errors — will retry next tick
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

      {/* Debug overlay — visible in screen share, shows audio pipeline status */}
      <div className="fixed bottom-3 right-3 z-50 text-xs font-mono space-y-1">
        <div className={`px-2 py-1 rounded ${
          audioStatus === 'idle' ? 'bg-gray-900/80 text-gray-500' :
          audioStatus === 'fetching' ? 'bg-yellow-900/80 text-yellow-300' :
          audioStatus === 'playing' ? 'bg-green-900/80 text-green-300' :
          'bg-red-900/80 text-red-300'
        }`}>
          🔊 {audioStatus}{audioStatus === 'error' && audioError ? `: ${audioError.slice(0, 40)}` : ''}
        </div>
        <div className="bg-gray-900/60 text-gray-600 px-2 py-1 rounded">
          ctx: {audioCtxRef.current?.state ?? 'none'}
        </div>
      </div>
    </div>
  )
}
