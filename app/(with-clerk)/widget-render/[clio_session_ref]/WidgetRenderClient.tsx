'use client'

import { Component, useEffect, useRef, useState } from 'react'
import type { ErrorInfo, ReactNode } from 'react'
import { HumeAdapter } from '@/lib/voice/hume-adapter'
import { OpenAIRealtimeAdapter } from '@/lib/voice/openai-realtime-adapter'
import type { VoiceSessionAdapter } from '@/lib/voice/adapter'
import { shouldAdvanceOnTransition } from '@/lib/partner/advance-transition'
import { reportClientError } from '@/lib/partner/report-client-error'
import { resolveWidgetJumpIndex, computeNextProgressIndex } from '@/lib/voice/widget-jump-resolution'
import { createJumpGuardState, shouldAllowJump } from '@/lib/partner/widget-jump-debounce'
import { WIDGET_AWAITING_ANSWER_TOOL } from '@/lib/voice/widget-prompt-rules'

/**
 * B2B-71 (docs/specs/B2B-71-requirement-document.md §6.2-§6.5) — the widget channel's OWN,
 * standalone render + tool-handling implementation. Structurally parallel to
 * `PartnerRenderClient.tsx`'s inline-mode branch ONLY (no template/`sections` branch at all — widget
 * sessions are exclusively inline-content) — but a genuinely separate file, sharing no code with
 * that component beyond already-existing, unmodified shared modules (the voice adapters, the
 * advance-debounce module, the client-error reporter). Built this way per Arun's explicit,
 * risk-driven decision to protect the just-stabilized meeting-bot render path while this new
 * capability proves itself out; if it works, folding it into the shared path is a separate, later
 * decision, not part of this build.
 *
 * The one new capability this component adds beyond a faithful port of `inlineTools`: `show_visual`
 * actually moves the screen (to any page, by exact title or index) when the model calls it to answer
 * an off-current-page question — `PartnerRenderClient.tsx`'s own `inlineTools.show_visual` is
 * deliberately still a no-op there (B2B-58), unchanged. This uses two distinct pieces of state to
 * keep the jump a pure "side-trip" that never redefines forward progress — see `progressIndexRef`/
 * `displayedIndex` below (§6.5).
 */

class InlinePageErrorBoundary extends Component<
  { clioSessionRef: string; pageLabel: string; children: ReactNode },
  { hasError: boolean }
> {
  state = { hasError: false }

  static getDerivedStateFromError() {
    return { hasError: true }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    reportClientError(this.props.clioSessionRef, 'error', `[${this.props.pageLabel}] ${error.message}`, error.stack ?? info.componentStack ?? undefined)
  }

  render() {
    if (this.state.hasError) {
      return <p className="px-6 text-center text-sm text-white/70">This page isn&apos;t available right now.</p>
    }
    return this.props.children
  }
}

/** B2B-73 — "Refined equalizer" pill (Arun's approved design option C, 2026-08-04). Purely
 *  presentational: `levels` is a 3-element 0-1 array already sampled from a real AnalyserNode by
 *  the caller. `active` gates whether this channel can carry real signal at all (e.g. false while
 *  connecting, or for the mic while muted) — the bars stay neutral grey whenever `active` is false
 *  or the real level is near the idle floor, and only take on color once the actual signal crosses
 *  a real speaking threshold. No decorative/fake glow — color is a direct readout of the same
 *  amplitude data driving the bar heights. */
function LevelPill({
  label,
  levels,
  active,
  variant,
}: {
  label: string
  levels: number[]
  active: boolean
  variant: 'mic' | 'bot'
}) {
  const speaking = active && levels.some((level) => level > 0.22)
  const barColor = speaking ? (variant === 'mic' ? '#4e8cff' : '#7dd3c8') : 'rgba(255,255,255,0.7)'
  return (
    // Relative wrapper sized to exactly the circle (56px) so this element's box is directly
    // comparable to the Mute/End-session buttons for cross-axis alignment in the control row below —
    // the label is positioned absolutely beneath it, out of flow, so it never affects that alignment
    // (previously the label sat in-flow inside a flex-col, making this whole component ~20px taller
    // than the buttons and forcing an `items-end` + manual `mb-1` offset hack that still left the
    // circles visibly higher than the buttons — Arun's "pills group is unaligned" report).
    <div className="relative h-14 w-14">
      <div className="flex h-14 w-14 items-center justify-center gap-[5px] rounded-full border border-white/15 bg-white/[0.06]">
        {levels.map((level, i) => (
          <div
            key={i}
            className="w-[5px] rounded-full"
            style={{
              // Per Arun: idle state should read as a small dot, and real speech should stretch it
              // into an unmistakably tall bar — widened from a 14-30px (barely 2x) range to 8-40px
              // (5x) so the transition is actually noticeable, not just a subtle wobble.
              height: `${Math.max(8, Math.round(level * 40))}px`,
              backgroundColor: barColor,
              transition: 'height 120ms ease-out, background-color 150ms',
            }}
          />
        ))}
      </div>
      <span className="absolute left-1/2 top-full mt-1.5 -translate-x-1/2 whitespace-nowrap text-[10px] uppercase tracking-wide text-white/50">
        {label}
      </span>
    </div>
  )
}

/** Mute button icon (Arun's approved design option C, 2026-08-04) — plain inline SVG, no icon
 *  library, matching how the rest of this component already handles graphics. */
function MicIcon({ muted }: { muted: boolean }) {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
      <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
      <path d="M12 19v4" />
      <path d="M8 23h8" />
      {muted && <path d="M3 3l18 18" />}
    </svg>
  )
}

export interface WidgetInlinePageProp {
  mediaType: 'html' | 'image'
  title: string | null
  subtitle: string | null
  transitionMarker: string
  status: 'ok' | 'unavailable'
  contentHtml?: string
  imageDataUri?: string
  sourceUrl?: string
}

export interface WidgetRenderClientProps {
  clioSessionRef: string
  inlinePages: WidgetInlinePageProp[]
  humeConfigId: string | null
  voiceProvider: 'hume' | 'openai_realtime'
  // The widget channel's OWN, fully self-contained OpenAI Realtime prompt
  // (lib/voice/widget-prompt-rules.ts's assembleWidgetOpenAIPrompt() output, computed server-side in
  // widget-render/page.tsx — already includes the on-topic-jump rule, no client-side concatenation
  // needed). Hume needs no equivalent prop here — its prompt is baked server-side into the opaque
  // `humeConfigId` before this component ever mounts; HumeAdapter.create() below passes no
  // instructions text at all, matching PartnerRenderClient.tsx's own current behavior exactly.
  openaiVoiceInstructions: string | null
}

// Same anti-stall floor `PartnerRenderClient.tsx`'s own advance_tab uses — ported because it uses
// only the shared VoiceSessionAdapter interface's `triggerRecoveryNudge` (lib/voice/adapter.ts,
// reused unmodified), not anything from the shared component file itself. Omitting it here would
// reintroduce, in this new component, the exact "silence after a tool call" bug class a whole prior
// session spent multiple live-test rounds fixing.
const POST_TOOL_NUDGE_MS = 7000

// Per Arun's direct instruction (2026-08-05): if the model asks a question at one of its four real
// stopping points and gets no spoken reply for ~20s, it should acknowledge that and it's then fine to
// end the session. OpenAI Realtime has no built-in clock, so this can't be judged by the model on its
// own — armed on the explicit awaiting_answer tool call (see the tools object below; v11 moved this
// off the earlier, imprecise speaking->listening mode-transition trigger), not on the initial
// post-connect 'listening' state before Clio has said anything yet.
const SILENCE_AFTER_QUESTION_MS = 20000
const SILENCE_AFTER_QUESTION_NUDGE_TEXT =
  'About 20 seconds have passed with no spoken reply after your last question. Acknowledge that ' +
  "gracefully, in your own words — something like \"I didn't catch anything from you there\" — then " +
  'say a real, out-loud goodbye and call end_session immediately after, in this same turn.'

// v12 (CEO review, P0) — a distinct, non-terminal watchdog for the gap the precise timer above
// can't cover: a live test showed the model asking a real stopping-point question and then simply
// ending its turn with NO tool call at all (not even awaiting_answer), which means the timer above
// — armed only inside the awaiting_answer handler — never arms either, so the session was hanging
// with zero safety net. This one is deliberately imprecise (it arms on ANY response completing with
// no tool call, regardless of why) but safe under that imprecision because its action is non-terminal
// — a nudge to keep going, never an end_session — unlike v10's old mode-transition timer, whose harm
// came from ending the session on an imprecise trigger, not from arming imprecisely in the first
// place. Two stages: a NON-terminal "keep going" nudge, then — only if still nothing happens — a
// graceful close, so a genuinely dead connection doesn't nudge forever.
const NO_TOOL_CALL_NUDGE_MS = 30000
const NO_TOOL_CALL_CLOSE_MS = 30000
const NO_TOOL_CALL_NUDGE_TEXT =
  'You have been quiet for a while and the participant has not spoken. This does not end the ' +
  'session — do not say goodbye or call end_session. If you had just asked one of your four ' +
  'questions, ask it once more briefly and call awaiting_answer. If you were partway through ' +
  'explaining something, simply continue from where you left off.'
const NO_TOOL_CALL_CLOSE_TEXT =
  'You have now been silent for about a minute with no response and no further action. Say a ' +
  'brief, graceful goodbye out loud right now, and call end_session immediately after, in this ' +
  'same turn.'

export default function WidgetRenderClient({
  clioSessionRef,
  inlinePages,
  humeConfigId,
  voiceProvider,
  openaiVoiceInstructions,
}: WidgetRenderClientProps) {
  const count = inlinePages.length

  const [status, setStatus] = useState<'connecting' | 'listening' | 'speaking' | 'error' | 'ended'>('connecting')
  const [showConnectWarmup, setShowConnectWarmup] = useState(Boolean(humeConfigId))
  const warmupTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const postToolNudgeTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const silenceNudgeTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  // v12 — no-tool-call watchdog state (see NO_TOOL_CALL_* constants above).
  const noToolWatchdogTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const responseHadToolCallRef = useRef(false)
  const adapterRef = useRef<VoiceSessionAdapter | null>(null)
  const connectStartRef = useRef<number | null>(null)
  const endedRef = useRef(false)

  // §6.5 — the two distinct pieces of position state. `progressIndexRef` is where real forward
  // progress continues from, touched ONLY by advance_tab. `displayedIndex`/`displayedIndexRef` is
  // what's currently scrolled into view, touched by BOTH handlers via the shared `scrollToIndex`
  // helper below — this is the entire mechanism realizing "a side-trip, not a redefinition of
  // progress."
  const progressIndexRef = useRef(0)
  const [displayedIndex, setDisplayedIndex] = useState(0)
  const displayedIndexRef = useRef(0)
  const sectionEls = useRef<(HTMLDivElement | null)[]>([])

  // Forward-advance dedup — reused unmodified from lib/partner/advance-transition.ts, same as
  // PartnerRenderClient.tsx's own inline branch.
  const firedMarkersRef = useRef<Set<string>>(new Set())
  const lastAdvanceAtRef = useRef<number | null>(null)

  // §6.4 — jump-specific rate guard. Independent of the advance_tab dedup above; has no effect on
  // advance_tab at all.
  const jumpGuardRef = useRef(createJumpGuardState())

  const joinGreetingRetriedRef = useRef(false)

  // B2B-73 — mic/bot amplitude pills, mute, timer, connection status. Mic analyser is a dedicated
  // AudioContext tap on the same micStream already captured for the adapter — deliberately NOT
  // connected to its own destination, so raw mic audio is never routed back out to the speaker.
  // Bot analyser comes from the adapter's own getOutputAnalyser() (spliced into its existing
  // playback graph). Both are sampled on a plain interval (not a 60fps rAF loop) since bar
  // movement doesn't need that resolution and it keeps re-render cost low.
  const micAudioCtxRef = useRef<AudioContext | null>(null)
  const micAnalyserRef = useRef<AnalyserNode | null>(null)
  const levelIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const [micLevels, setMicLevels] = useState<number[]>([0.12, 0.12, 0.12])
  const [botLevels, setBotLevels] = useState<number[]>([0.12, 0.12, 0.12])
  const [isMuted, setIsMuted] = useState(false)
  const [elapsedSeconds, setElapsedSeconds] = useState(0)
  // OpenAI gets a real live proxy via onDiagnostic (ws_close/ws_error/realtime_error); Hume has no
  // equivalent live hook today (documented, scoped gap in the B2B-73 brief) so this stays 'green'
  // for Hume sessions except on a hard onError, which both providers already report.
  const [connectionHealth, setConnectionHealth] = useState<'green' | 'yellow' | 'red'>('green')

  /** Computes one real amplitude level from an analyser's time-domain (waveform) data — an RMS of
   *  the signal around its silence midpoint — then fans it out across `bars` with a center-weighted
   *  taper for a natural look, all still driven by the same real signal (never decorative/fake).
   *  Deliberately NOT a linear frequency-band split: voice energy concentrates almost entirely in
   *  the lowest few frequency bins, which made bar 1 do all the moving and the rest sit idle. */
  function sampleAnalyserBars(analyser: AnalyserNode, bars = 3): number[] {
    const data = new Uint8Array(analyser.fftSize)
    analyser.getByteTimeDomainData(data)
    let sumSquares = 0
    for (let i = 0; i < data.length; i++) {
      const centered = (data[i] - 128) / 128
      sumSquares += centered * centered
    }
    const rms = Math.sqrt(sumSquares / data.length)
    const level = Math.max(0, Math.min(1, rms * 4)) // typical speech RMS is small; boost to fill the range
    const taper = [0.75, 1, 0.75]
    return Array.from({ length: bars }, (_, i) => Math.max(0.12, Math.min(1, level * (taper[i] ?? 1))))
  }

  useEffect(() => {
    const onError = (event: ErrorEvent) => {
      reportClientError(clioSessionRef, 'error', event.message, event.error?.stack)
    }
    const onRejection = (event: PromiseRejectionEvent) => {
      const reason = event.reason
      const message = reason instanceof Error ? reason.message : String(reason)
      const stack = reason instanceof Error ? reason.stack : undefined
      reportClientError(clioSessionRef, 'unhandledrejection', message, stack)
    }
    window.addEventListener('error', onError)
    window.addEventListener('unhandledrejection', onRejection)
    return () => {
      window.removeEventListener('error', onError)
      window.removeEventListener('unhandledrejection', onRejection)
    }
  }, [clioSessionRef])

  /** Moves the on-screen stack to `idx`, clamped, and scrolls it into view. The single code path
   *  both advance_tab and show_visual funnel through — reduces duplication risk (§6.5). */
  function scrollToIndex(idx: number) {
    const clamped = Math.max(0, Math.min(idx, count - 1))
    displayedIndexRef.current = clamped
    setDisplayedIndex(clamped)
    sectionEls.current[clamped]?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  function advanceOnTransition(transitionMarker: string) {
    if (!shouldAdvanceOnTransition(transitionMarker, Date.now(), firedMarkersRef.current, lastAdvanceAtRef)) return
    progressIndexRef.current = computeNextProgressIndex(progressIndexRef.current, count)
    scrollToIndex(progressIndexRef.current)
  }

  useEffect(() => {
    let cancelled = false

    async function connect() {
      if (!humeConfigId) return // session proceeds without voice; content still renders

      warmupTimeoutRef.current = setTimeout(() => setShowConnectWarmup(false), 6000)

      try {
        const micStream = await navigator.mediaDevices.getUserMedia({ audio: true })
        if (cancelled) return

        connectStartRef.current = Date.now()

        // B2B-73 — mic amplitude tap. Deliberately not connected to micCtx.destination: this is a
        // read-only analysis tap, never a playback path — the mic must never be routed back out.
        try {
          const micCtx = new AudioContext()
          const micSource = micCtx.createMediaStreamSource(micStream)
          const micAnalyser = micCtx.createAnalyser()
          micAnalyser.fftSize = 256
          micSource.connect(micAnalyser)
          micAudioCtxRef.current = micCtx
          micAnalyserRef.current = micAnalyser
        } catch { /* pill just stays at its idle floor if this fails */ }

        levelIntervalRef.current = setInterval(() => {
          if (micAnalyserRef.current) setMicLevels(sampleAnalyserBars(micAnalyserRef.current))
          const botAnalyser = adapterRef.current?.getOutputAnalyser?.()
          if (botAnalyser) setBotLevels(sampleAnalyserBars(botAnalyser))
        }, 80)

        const clearPostToolNudge = () => {
          if (postToolNudgeTimeoutRef.current) {
            clearTimeout(postToolNudgeTimeoutRef.current)
            postToolNudgeTimeoutRef.current = null
          }
        }
        const armPostToolNudge = () => {
          clearPostToolNudge()
          postToolNudgeTimeoutRef.current = setTimeout(() => {
            postToolNudgeTimeoutRef.current = null
            adapterRef.current?.triggerRecoveryNudge?.(
              'You have gone silent immediately after a tool call. A tool call never ends your turn — ' +
                'continue speaking right now, in this same turn, with whatever comes next.'
            )
          }, POST_TOOL_NUDGE_MS)
        }

        const clearSilenceNudge = () => {
          if (silenceNudgeTimeoutRef.current) {
            clearTimeout(silenceNudgeTimeoutRef.current)
            silenceNudgeTimeoutRef.current = null
          }
        }
        const armSilenceNudge = () => {
          clearSilenceNudge()
          silenceNudgeTimeoutRef.current = setTimeout(() => {
            silenceNudgeTimeoutRef.current = null
            adapterRef.current?.triggerRecoveryNudge?.(SILENCE_AFTER_QUESTION_NUDGE_TEXT)
          }, SILENCE_AFTER_QUESTION_MS)
        }

        const clearNoToolWatchdog = () => {
          if (noToolWatchdogTimeoutRef.current) {
            clearTimeout(noToolWatchdogTimeoutRef.current)
            noToolWatchdogTimeoutRef.current = null
          }
        }
        const logNoToolDiagnostic = (label: string) => {
          fetch('/api/partner/render/voice-diagnostic-capture', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ clio_session_ref: clioSessionRef, label, detail: {} }),
            keepalive: true,
          }).catch(() => {})
        }
        const armNoToolWatchdog = () => {
          clearNoToolWatchdog()
          logNoToolDiagnostic('no_tool_call_watchdog_armed')
          noToolWatchdogTimeoutRef.current = setTimeout(() => {
            adapterRef.current?.triggerRecoveryNudge?.(NO_TOOL_CALL_NUDGE_TEXT)
            logNoToolDiagnostic('no_tool_call_watchdog_nudge_fired')
            noToolWatchdogTimeoutRef.current = setTimeout(() => {
              noToolWatchdogTimeoutRef.current = null
              adapterRef.current?.triggerRecoveryNudge?.(NO_TOOL_CALL_CLOSE_TEXT)
              logNoToolDiagnostic('no_tool_call_watchdog_close_fired')
            }, NO_TOOL_CALL_CLOSE_MS)
          }, NO_TOOL_CALL_NUDGE_MS)
        }

        const tools = {
          show_visual: async (params: Record<string, unknown>) => {
            const now = Date.now()
            if (!shouldAllowJump(jumpGuardRef.current, now)) {
              // §6.4/§8 — silently suppressed, never a tool error: the model's own turn-taking must
              // never be disrupted by an apparent tool failure, and Clio's spoken answer never
              // depended on the screen actually moving.
              return 'Visual is showing.'
            }
            const idx = resolveWidgetJumpIndex(params, inlinePages, displayedIndexRef.current)
            scrollToIndex(idx)
            return 'Visual is showing.'
          },
          advance_tab: async () => {
            armPostToolNudge()
            progressIndexRef.current = computeNextProgressIndex(progressIndexRef.current, count)
            // Same fire-and-forget playback-catch-up wait PartnerRenderClient.tsx's own advance_tab
            // uses (VoiceSessionAdapter.waitForPlaybackCaughtUp — no-op for Hume) — the visual
            // advance must never get ahead of what the participant has actually heard.
            void (async () => {
              await adapterRef.current?.waitForPlaybackCaughtUp?.()
              scrollToIndex(progressIndexRef.current)
            })()
            return 'Advanced.'
          },
          end_session: async () => {
            setStatus('ended')
            void endSessionOnce()
            return 'Session ended.'
          },
          // v10 — OpenAI-only signal (see WIDGET_AWAITING_ANSWER_TOOL): the model calls this the
          // instant it reaches one of its four real stopping points, right before genuinely waiting.
          // Arms the 20s silence timer on this explicit signal instead of inferring it from a
          // generic mode change, which couldn't distinguish a real stopping point from the model
          // stalling mid-teaching.
          awaiting_answer: async () => {
            armSilenceNudge()
            return 'Waiting.'
          },
        }

        const onMessage = (text: string, source: 'user' | 'ai') => {
          if (voiceProvider === 'openai_realtime' && text.trim()) {
            fetch('/api/partner/render/transcript-capture', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ clio_session_ref: clioSessionRef, source, text }),
              keepalive: true,
            }).catch(() => {})
          }
        }

        const revealContentAfterWarmup = () => {
          if (warmupTimeoutRef.current) {
            clearTimeout(warmupTimeoutRef.current)
            warmupTimeoutRef.current = null
          }
          setShowConnectWarmup(false)
        }

        const sharedCallbacks = {
          onConnect: (sessionId: string) => {
            setStatus('listening')
            setConnectionHealth('green')
            if (sessionId) {
              fetch('/api/partner/render/session-chat-id', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ clio_session_ref: clioSessionRef, hume_chat_id: sessionId }),
              }).catch((err) => console.warn('[widget-render] Failed to persist hume_chat_id:', err))
            }
          },
          onDisconnect: () => { setStatus('ended'); clearPostToolNudge(); clearSilenceNudge(); clearNoToolWatchdog() },
          onError: (message: string) => {
            console.error('[widget-render] Voice session error:', message)
            setStatus('error')
            setConnectionHealth('red')
            revealContentAfterWarmup()
            clearPostToolNudge()
            clearSilenceNudge()
            clearNoToolWatchdog()
          },
          onModeChange: (mode: 'listening' | 'speaking') => {
            setStatus(mode)
            if (mode === 'speaking') {
              clearPostToolNudge()
              clearSilenceNudge()
            }
            // Silence-timer arming moved to the awaiting_answer tool handler below (v10) — a
            // generic speaking->listening transition can't tell "just asked one of the four real
            // stopping-point questions" apart from "model unexpectedly stalled mid-teaching," and a
            // live test confirmed the latter also fired this timer, ending sessions mid-lesson.
          },
          onMessage,
        }

        let adapter: VoiceSessionAdapter

        if (voiceProvider === 'openai_realtime') {
          const tokenRes = await fetch('/api/openai-realtime-token')
          if (!tokenRes.ok) throw new Error(`OpenAI Realtime token fetch failed: ${tokenRes.status}`)
          const { accessToken, model } = (await tokenRes.json()) as { accessToken: string; model: string }
          if (cancelled) return

          adapter = await OpenAIRealtimeAdapter.create({
            ephemeralToken: accessToken,
            model,
            onUserSpeechStarted: () => { clearPostToolNudge(); clearSilenceNudge(); clearNoToolWatchdog() },
            onDiagnostic: (label, detail) => {
              // B2B-73 — the one real, live connection-health proxy available today (see the
              // feature brief's item 8 analysis: neither adapter uses WebRTC, so there's no
              // packet-loss/jitter signal to read — this is the most honest signal that exists).
              if (label === 'ws_close') {
                const d = detail as { willReconnect?: boolean }
                setConnectionHealth(d.willReconnect ? 'yellow' : 'red')
              } else if (label === 'ws_error' || label === 'realtime_error') {
                setConnectionHealth('red')
              } else if (label === 'response_created') {
                setConnectionHealth('green')
                // v12 — reset per-response tracking; a new response starting also means the model
                // resumed on its own, so any pending no-tool-call watchdog from a prior turn is moot.
                responseHadToolCallRef.current = false
                clearNoToolWatchdog()
              } else if (label === 'tool_call') {
                // Any tool call — including awaiting_answer — is real progress; never let the
                // no-tool-call watchdog fire underneath one.
                responseHadToolCallRef.current = true
                clearNoToolWatchdog()
              } else if (label === 'response_done') {
                // v12 (CEO review, P0) — the response that just completed carried zero tool calls,
                // meaning nothing else (not the precise awaiting_answer timer, not an auto-continue)
                // will happen on its own. Arm the non-terminal watchdog. Also logged as its own
                // diagnostic label so tool-call compliance at the four stopping points is directly
                // queryable later, rather than inferred from anecdote.
                if (!responseHadToolCallRef.current) {
                  logNoToolDiagnostic('response_done_no_tool_call')
                  armNoToolWatchdog()
                }
              }
              fetch('/api/partner/render/voice-diagnostic-capture', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ clio_session_ref: clioSessionRef, label, detail }),
                keepalive: true,
              }).catch(() => {})
            },
            // Already-complete widget-only prompt (lib/voice/widget-prompt-rules.ts), computed
            // server-side — no client-side string concatenation.
            instructions:
              openaiVoiceInstructions ??
              'You are Clio, an AI business coach delivering a live coaching session over voice. ' +
                'Use the show_visual, advance_tab, and end_session tools exactly as instructed by ' +
                'their own descriptions.',
            userId: clioSessionRef,
            mediaStream: micStream,
            tools,
            extraTools: [WIDGET_AWAITING_ANSWER_TOOL],
            turnEndingToolNames: ['awaiting_answer'],
            reportError: (message) => reportClientError(clioSessionRef, 'openai-realtime-adapter-error', message),
            ...sharedCallbacks,
          })
        } else {
          const tokenRes = await fetch('/api/hume-token')
          if (!tokenRes.ok) throw new Error(`Hume token fetch failed: ${tokenRes.status}`)
          const { accessToken } = (await tokenRes.json()) as { accessToken: string }
          if (cancelled) return

          adapter = await HumeAdapter.create({
            accessToken,
            configId: humeConfigId,
            userId: clioSessionRef,
            mediaStream: micStream,
            isNativeMode: true,
            tools,
            reportError: (message) => reportClientError(clioSessionRef, 'hume-adapter-error', message),
            ...sharedCallbacks,
          })
        }

        if (cancelled) {
          await adapter.endSession()
          return
        }

        adapterRef.current = adapter
        adapter.onSpeakVerified(revealContentAfterWarmup)
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        console.error('[widget-render] Voice connect failed:', message)
        reportClientError(clioSessionRef, 'hume-connect-error', message, err instanceof Error ? err.stack : undefined)
        setStatus('error')
        setShowConnectWarmup(false)
        if (warmupTimeoutRef.current) {
          clearTimeout(warmupTimeoutRef.current)
          warmupTimeoutRef.current = null
        }
      }
    }

    connect()

    return () => {
      cancelled = true
      if (warmupTimeoutRef.current) clearTimeout(warmupTimeoutRef.current)
      if (postToolNudgeTimeoutRef.current) clearTimeout(postToolNudgeTimeoutRef.current)
      if (silenceNudgeTimeoutRef.current) clearTimeout(silenceNudgeTimeoutRef.current)
      if (noToolWatchdogTimeoutRef.current) clearTimeout(noToolWatchdogTimeoutRef.current)
      if (levelIntervalRef.current) clearInterval(levelIntervalRef.current)
      try { micAnalyserRef.current?.disconnect() } catch { /* noop */ }
      void micAudioCtxRef.current?.close().catch(() => {})
      void endSessionOnce()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // B2B-73 — elapsed session timer, a derived 1-second tick off connectStartRef (a plain ref, not
  // reactive by itself). connectStartRef itself is untouched — still feeds endSessionOnce()'s
  // billing-duration calculation exactly as before.
  useEffect(() => {
    if (!humeConfigId) return
    const interval = setInterval(() => {
      if (connectStartRef.current) setElapsedSeconds(Math.floor((Date.now() - connectStartRef.current) / 1000))
    }, 1000)
    return () => clearInterval(interval)
  }, [humeConfigId])

  // Join-greeting poll — reused as-is (§6.7), same proven flag-set → poll → send → clear pattern
  // PartnerRenderClient.tsx already uses.
  useEffect(() => {
    let active = true

    const poll = async () => {
      try {
        const res = await fetch(`/api/partner/render/join-greeting/${clioSessionRef}`)
        if (!active || !res.ok) return

        const data = (await res.json()) as { pending: boolean; greeting_text: string | null }
        if (!data.pending || !data.greeting_text) {
          joinGreetingRetriedRef.current = false
          return
        }

        const adapter = adapterRef.current
        const clearFlag = () => {
          fetch(`/api/partner/render/join-greeting/${clioSessionRef}`, { method: 'PATCH' }).catch(() => {})
        }

        if (adapter?.isOpen()) {
          const sent = adapter.sendWrapUpNudge?.(data.greeting_text)
          if (sent) {
            joinGreetingRetriedRef.current = false
            clearFlag()
          } else if (!joinGreetingRetriedRef.current) {
            joinGreetingRetriedRef.current = true
            adapter.sendWrapUpNudge?.(data.greeting_text)
            clearFlag()
          }
        } else if (!joinGreetingRetriedRef.current) {
          joinGreetingRetriedRef.current = true
        }
      } catch {
        /* swallow — next 2s cycle retries */
      }
    }

    poll()
    const interval = setInterval(poll, 2000)
    return () => { active = false; clearInterval(interval) }
  }, [clioSessionRef])

  async function endSessionOnce() {
    if (endedRef.current) return
    endedRef.current = true

    const durationMinutes = connectStartRef.current ? (Date.now() - connectStartRef.current) / 60000 : 0

    try {
      await adapterRef.current?.endSession()
    } catch {
      /* best-effort */
    }

    try {
      await fetch('/api/partner/render/end-session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clio_session_ref: clioSessionRef, duration_minutes: durationMinutes }),
      })
    } catch (err) {
      console.error('[widget-render] end-session call failed:', err instanceof Error ? err.message : err)
    }
  }

  // B2B-73 — items 7+8 collapsed into one indicator per the CEO's own call in the approved brief:
  // a single dot/label, honestly named "Connection" (a connection-health proxy, not a measured
  // network-quality metric). `status` covers connecting/error; `connectionHealth` adds OpenAI's
  // finer live signal on top (stays 'green' for Hume, which has no equivalent live hook today).
  const connectionDotColor =
    status === 'error' || connectionHealth === 'red' ? 'bg-red-500'
      : status === 'connecting' || connectionHealth === 'yellow' ? 'bg-amber-400'
        : 'bg-green-500'
  const connectionLabel =
    status === 'connecting' ? 'Connecting'
      : status === 'error' ? 'Disconnected'
        : connectionHealth === 'yellow' ? 'Reconnecting'
          : 'Connected'
  const elapsedLabel = `${Math.floor(elapsedSeconds / 60)}:${String(elapsedSeconds % 60).padStart(2, '0')}`

  function handleToggleMute() {
    const next = !isMuted
    setIsMuted(next)
    adapterRef.current?.setMicMuted(next)
  }

  const callControlsOverlay = Boolean(humeConfigId) && (
    <>
      <div className="pointer-events-none fixed left-4 top-4 z-40 flex items-center gap-3 rounded-full border border-white/10 bg-black/60 px-4 py-2 text-xs text-white/80 backdrop-blur">
        <span className="flex items-center gap-1.5">
          <span className={`h-2 w-2 rounded-full ${connectionDotColor}`} />
          {connectionLabel}
        </span>
        <span className="text-white/30">•</span>
        <span className="tabular-nums">{elapsedLabel}</span>
        <span className="text-white/30">•</span>
        <span className="tabular-nums">{displayedIndex + 1} of {count}</span>
      </div>

      {/* items-center (not items-end) + no per-button margin hacks: LevelPill's box is now exactly
          the 56px circle (label lives outside flow, see LevelPill above), so it's directly
          comparable to the buttons' own heights — the browser centers all four on one true line.
          Bottom padding is enlarged to give the two now-absolutely-positioned pill labels room to
          sit fully inside the container's own visual bounds instead of overflowing past its edge. */}
      <div className="pointer-events-auto fixed bottom-6 left-1/2 z-40 flex -translate-x-1/2 items-center gap-4 rounded-2xl border border-white/10 bg-black/60 px-5 pb-8 pt-3 backdrop-blur">
        <LevelPill label="You" levels={micLevels} active={status !== 'connecting' && !isMuted} variant="mic" />
        <button
          type="button"
          onClick={handleToggleMute}
          className={
            isMuted
              ? 'flex h-11 items-center gap-2 rounded-full border border-red-500/40 bg-red-500/20 pl-3 pr-4 text-xs font-medium text-red-200 hover:bg-red-500/30'
              : 'flex h-11 items-center gap-2 rounded-full border border-blue-400/40 bg-blue-500/15 pl-3 pr-4 text-xs font-medium text-blue-200 hover:bg-blue-500/25'
          }
        >
          <MicIcon muted={isMuted} />
          {isMuted ? 'Unmute' : 'Mute'}
        </button>
        <LevelPill label="Clio" levels={botLevels} active={status !== 'connecting'} variant="bot" />
        <button
          type="button"
          onClick={() => { setStatus('ended'); void endSessionOnce() }}
          className="flex h-10 items-center rounded-full border border-white/15 bg-white/[0.06] px-4 text-xs font-medium text-white/80 hover:bg-red-500/20 hover:border-red-500/30"
        >
          End session
        </button>
      </div>
    </>
  )

  const connectWarmupOverlay = (
    <div
      aria-hidden={!showConnectWarmup}
      className={`pointer-events-none fixed inset-0 z-50 flex items-center justify-center bg-black transition-opacity duration-500 ${
        showConnectWarmup ? 'opacity-100' : 'opacity-0'
      }`}
    >
      <div className="h-10 w-10 animate-spin rounded-full border-2 border-white/20 border-t-white/80" />
    </div>
  )

  // B2B-72 — once the session has ended (the model's own end_session tool call after its spoken
  // farewell, per rule 9, or the participant disconnecting), fully replace the page stack with a
  // plain "thanks" screen — not an overlay on top of still-mounted iframes. Arun's own framing ("so
  // the user can no longer talk to the bot") is about visual/interactive closure: the inline pages
  // stop being rendered entirely, not just visually covered. No new termination mechanism needed —
  // endSessionOnce()/adapter.endSession()/the end-session API call already run on both the
  // end_session tool path and onDisconnect/unmount; this is a pure rendering-branch addition.
  if (status === 'ended') {
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-black">
        <div className="text-center px-6">
          <p className="text-white text-xl font-medium mb-2">Thanks for joining.</p>
          <p className="text-white/60 text-sm">This session has ended.</p>
        </div>
      </div>
    )
  }

  return (
    <div className="relative h-screen w-screen overflow-y-auto bg-black">
      {connectWarmupOverlay}
      {callControlsOverlay}
      {inlinePages.map((page, index) => (
        <div
          key={index}
          ref={(el) => { sectionEls.current[index] = el }}
          className="relative flex h-screen w-screen items-center justify-center bg-black"
        >
          <InlinePageErrorBoundary clioSessionRef={clioSessionRef} pageLabel={page.title ?? `page ${index + 1}`}>
            {page.status === 'unavailable' ? (
              <p className="px-6 text-center text-sm text-white/70">This page isn&apos;t available right now.</p>
            ) : page.mediaType === 'image' ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={page.imageDataUri} alt={page.title ?? `page ${index + 1}`} className="max-h-full max-w-full object-contain" />
            ) : page.sourceUrl ? (
              <iframe
                title={page.title ?? `page ${index + 1}`}
                src={page.sourceUrl}
                sandbox="allow-scripts"
                className="h-full w-full border-0"
              />
            ) : (
              <iframe
                title={page.title ?? `page ${index + 1}`}
                srcDoc={page.contentHtml}
                sandbox="allow-scripts"
                className="h-full w-full border-0"
              />
            )}
          </InlinePageErrorBoundary>
        </div>
      ))}
      {status === 'error' && (
        <div className="fixed bottom-4 right-4 rounded bg-black/60 px-3 py-2 text-xs text-white">
          Voice connection issue — content is still visible.
        </div>
      )}
    </div>
  )
}
