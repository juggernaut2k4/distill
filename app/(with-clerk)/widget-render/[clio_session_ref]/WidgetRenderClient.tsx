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
            if (sessionId) {
              fetch('/api/partner/render/session-chat-id', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ clio_session_ref: clioSessionRef, hume_chat_id: sessionId }),
              }).catch((err) => console.warn('[widget-render] Failed to persist hume_chat_id:', err))
            }
          },
          onDisconnect: () => { setStatus('ended'); clearPostToolNudge() },
          onError: (message: string) => {
            console.error('[widget-render] Voice session error:', message)
            setStatus('error')
            revealContentAfterWarmup()
            clearPostToolNudge()
          },
          onModeChange: (mode: 'listening' | 'speaking') => {
            setStatus(mode)
            if (mode === 'speaking') clearPostToolNudge()
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
            onUserSpeechStarted: () => { clearPostToolNudge() },
            onDiagnostic: (label, detail) => {
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
      void endSessionOnce()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

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
