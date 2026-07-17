'use client'

import { useEffect, useRef, useState } from 'react'
import TemplateRenderer from '@/components/templates/TemplateRenderer'
import { HumeAdapter } from '@/lib/voice/hume-adapter'
import type { TemplateSection } from '@/lib/templates/types'
import { cssCustomPropertiesToStyleBlock, type CSSCustomProperties } from '@/lib/partner/theme-client-safe'
import { matchesTransitionMarker } from '@/lib/content/transition-markers'

/**
 * B2B-03 / B2B-19 — Live-session render client.
 *
 * Two render modes, selected by which prop is supplied:
 *   - `sections`   → Option 2 (template/Designer). Behavior is byte-for-byte
 *                    unchanged from B2B-03: tool-call-driven section switching,
 *                    onMessage a no-op. Do not alter this path.
 *   - `inlinePages`→ Option 1 (B2B-19 inline content). Renders partner HTML in a
 *                    sandboxed iframe / images directly, and advances pages on a
 *                    DUAL SIGNAL over one system-generated per-page marker:
 *                    (1) transcript-watch of the bot's live `ai` speech, and
 *                    (2) the Hume advance_tab/show_visual tool-call. Whichever
 *                    fires first wins; the other is a no-op via a local
 *                    idempotency set keyed on the marker (race-free — both land
 *                    in this single client component's single-threaded runtime).
 */

interface RenderedSectionProp {
  section: TemplateSection
  cssCustomProperties: CSSCustomProperties
}

export interface InlinePageProp {
  mediaType: 'html' | 'image'
  title: string | null
  subtitle: string | null
  transitionMarker: string
  status: 'ok' | 'unavailable'
  contentHtml?: string
  imageDataUri?: string
}

export interface PartnerRenderClientProps {
  clioSessionRef: string
  humeConfigId: string | null
  sections?: RenderedSectionProp[]
  inlinePages?: InlinePageProp[]
}

export default function PartnerRenderClient({ clioSessionRef, sections, inlinePages, humeConfigId }: PartnerRenderClientProps) {
  const isInline = Array.isArray(inlinePages)
  const count = isInline ? inlinePages!.length : (sections?.length ?? 0)

  const [status, setStatus] = useState<'connecting' | 'listening' | 'speaking' | 'error' | 'ended'>('connecting')
  const adapterRef = useRef<HumeAdapter | null>(null)
  const connectStartRef = useRef<number | null>(null)
  const endedRef = useRef(false)

  const [activeIndex, setActiveIndex] = useState(0)
  const activeIndexRef = useRef(0)
  const sectionEls = useRef<(HTMLDivElement | null)[]>([])

  // B2B-19 — dual-signal transition dedup set. Keyed on transition_marker: the
  // first signal (transcript-watch OR tool-call) for a given marker advances;
  // every later signal for the same marker is a no-op. Race-free by
  // construction (single-threaded JS event loop, single client instance).
  const firedMarkersRef = useRef<Set<string>>(new Set())

  // B2B-11 — join-greeting poll (unchanged).
  const joinGreetingRetriedRef = useRef(false)
  // B2B-19 — wrap-up-nudge poll (inline only).
  const wrapUpRetriedRef = useRef(false)

  /** Moves the on-screen stack to `idx`, clamped, and scrolls it into view. */
  function goToSection(idx: number) {
    const clamped = Math.max(0, Math.min(idx, count - 1))
    activeIndexRef.current = clamped
    setActiveIndex(clamped)
    sectionEls.current[clamped]?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  /** Option 2 — resolve target section index from a show_visual/advance_tab call. */
  function resolveSectionIndex(params: Record<string, unknown>): number {
    const sectionIndex = params.section_index as number | undefined
    const topicTitle = params.topic_title as string | undefined
    let idx = -1
    if (typeof sectionIndex === 'number') {
      idx = sectionIndex
    } else if (topicTitle && sections) {
      idx = sections.findIndex(({ section }) => section.meta.subtopicTitle === topicTitle)
    }
    return idx < 0 ? activeIndexRef.current : idx
  }

  /** B2B-19 — the single idempotent forward-only advance both signals feed into. */
  function advanceOnTransition(transitionMarker: string) {
    if (firedMarkersRef.current.has(transitionMarker)) return // dedup — second signal is a no-op
    firedMarkersRef.current.add(transitionMarker)
    const next = Math.min(activeIndexRef.current + 1, count - 1)
    goToSection(next) // forward-only: never moves backward
  }

  useEffect(() => {
    let cancelled = false

    async function connect() {
      if (!humeConfigId) return // session proceeds without voice; content still renders

      try {
        const micStream = await navigator.mediaDevices.getUserMedia({ audio: true })
        if (cancelled) return

        const tokenRes = await fetch('/api/hume-token')
        if (!tokenRes.ok) throw new Error(`Hume token fetch failed: ${tokenRes.status}`)
        const { accessToken } = (await tokenRes.json()) as { accessToken: string }
        if (cancelled) return

        connectStartRef.current = Date.now()

        // Tool handlers differ per mode. Option 2 keeps its exact prior behavior;
        // inline routes advance_tab/show_visual through advanceOnTransition.
        const inlineTools = {
          show_visual: async () => {
            const marker = inlinePages![activeIndexRef.current]?.transitionMarker
            if (marker) advanceOnTransition(marker)
            return 'Advanced.'
          },
          advance_tab: async () => {
            const marker = inlinePages![activeIndexRef.current]?.transitionMarker
            if (marker) advanceOnTransition(marker)
            return 'Advanced.'
          },
          end_session: async () => {
            setStatus('ended')
            void endSessionOnce()
            return 'Session ended.'
          },
        }

        const templateTools = {
          show_visual: async (params: Record<string, unknown>) => {
            const idx = resolveSectionIndex(params)
            goToSection(idx)
            const title = sections?.[idx]?.section.meta.subtopicTitle ?? `section ${idx + 1}`
            return `Visual is now showing: "${title}" (section ${idx + 1} of ${count}).`
          },
          advance_tab: async () => {
            const idx = Math.min(activeIndexRef.current + 1, count - 1)
            goToSection(idx)
            const title = sections?.[idx]?.section.meta.subtopicTitle ?? `section ${idx + 1}`
            return `Advanced to: "${title}" (section ${idx + 1} of ${count}).`
          },
          end_session: async () => {
            setStatus('ended')
            void endSessionOnce()
            return 'Session ended.'
          },
        }

        // B2B-19 transcript-watch (primary signal, inline only). Extends
        // RTV-02/03's forward-only, single-hit-decisive pattern: on each `ai`
        // utterance, if the CURRENT page's unique marker is present, advance.
        const onMessage = isInline
          ? (text: string, source: string) => {
              if (source !== 'ai' || !text) return
              const marker = inlinePages![activeIndexRef.current]?.transitionMarker
              if (marker && matchesTransitionMarker(text, marker)) advanceOnTransition(marker)
            }
          : () => {}

        const adapter = await HumeAdapter.create({
          accessToken,
          configId: humeConfigId,
          userId: clioSessionRef,
          mediaStream: micStream,
          isNativeMode: true,
          tools: isInline ? inlineTools : templateTools,
          onConnect: (sessionId) => {
            setStatus('listening')
            if (sessionId) {
              fetch('/api/partner/render/session-chat-id', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ clio_session_ref: clioSessionRef, hume_chat_id: sessionId }),
              }).catch((err) => console.warn('[partner-render] Failed to persist hume_chat_id:', err))
            }
          },
          onDisconnect: () => setStatus('ended'),
          onError: (message) => {
            console.error('[partner-render] Voice session error:', message)
            setStatus('error')
          },
          onModeChange: (mode) => setStatus(mode),
          onMessage,
        })

        if (cancelled) {
          await adapter.endSession()
          return
        }

        adapterRef.current = adapter
      } catch (err) {
        console.error('[partner-render] Voice connect failed:', err instanceof Error ? err.message : err)
        setStatus('error')
      }
    }

    connect()

    return () => {
      cancelled = true
      void endSessionOnce()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // B2B-11 — join-greeting poll (unchanged).
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
          const sent = adapter.sendWrapUpNudge(data.greeting_text)
          if (sent) {
            joinGreetingRetriedRef.current = false
            clearFlag()
          } else if (!joinGreetingRetriedRef.current) {
            joinGreetingRetriedRef.current = true
            adapter.sendWrapUpNudge(data.greeting_text)
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

  // B2B-19 — wrap-up-nudge poll (inline only). Mirrors the join-greeting poll's
  // proven flag-set → poll → send → clear pattern. Delivers the graceful
  // mid-session wrap-up directive (via sendWrapUpNudge) set by the
  // partner-live-cutoff job — NOT a hard cut. Single-retry-then-give-up; the
  // job's clean bot-leave is the backstop so billing never overshoots.
  useEffect(() => {
    if (!isInline) return
    let active = true

    const poll = async () => {
      try {
        const res = await fetch(`/api/partner/render/wrap-up-nudge/${clioSessionRef}`)
        if (!active || !res.ok) return

        const data = (await res.json()) as { pending: boolean; nudge_text: string | null }
        if (!data.pending || !data.nudge_text) {
          wrapUpRetriedRef.current = false
          return
        }

        const adapter = adapterRef.current
        const clearFlag = () => {
          fetch(`/api/partner/render/wrap-up-nudge/${clioSessionRef}`, { method: 'PATCH' }).catch(() => {})
        }

        if (adapter?.isOpen()) {
          const sent = adapter.sendWrapUpNudge(data.nudge_text)
          if (sent) {
            wrapUpRetriedRef.current = false
            clearFlag()
          } else if (!wrapUpRetriedRef.current) {
            wrapUpRetriedRef.current = true
            adapter.sendWrapUpNudge(data.nudge_text)
            clearFlag()
          }
        } else if (!wrapUpRetriedRef.current) {
          wrapUpRetriedRef.current = true
        }
      } catch {
        /* swallow — next 2s cycle retries */
      }
    }

    poll()
    const interval = setInterval(poll, 2000)
    return () => { active = false; clearInterval(interval) }
  }, [clioSessionRef, isInline])

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
      console.error('[partner-render] end-session call failed:', err instanceof Error ? err.message : err)
    }
  }

  // ─── Inline render (B2B-19) ─────────────────────────────────────────────────
  if (isInline) {
    return (
      <div className="relative h-screen w-screen overflow-y-auto bg-black">
        {inlinePages!.map((page, index) => (
          <div
            key={index}
            ref={(el) => { sectionEls.current[index] = el }}
            className="relative flex h-screen w-screen items-center justify-center bg-black"
          >
            {page.status === 'unavailable' ? (
              <p className="px-6 text-center text-sm text-white/70">This page isn&apos;t available right now.</p>
            ) : page.mediaType === 'image' ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={page.imageDataUri} alt={page.title ?? `page ${index + 1}`} className="max-h-full max-w-full object-contain" />
            ) : (
              // Sandboxed: allow-scripts but NOT allow-same-origin → partner
              // script runs in a null/opaque origin and cannot read Clio's
              // render-page origin, the Hume token, or session data (AT-SSRF-3).
              // srcDoc, never dangerouslySetInnerHTML (CLAUDE.md rule).
              <iframe
                title={page.title ?? `page ${index + 1}`}
                srcDoc={page.contentHtml}
                sandbox="allow-scripts"
                className="h-full w-full border-0"
              />
            )}
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

  // ─── Template render (Option 2, unchanged) ──────────────────────────────────
  return (
    <div className="relative h-screen w-screen overflow-y-auto">
      {(sections ?? []).map(({ section, cssCustomProperties }, index) => (
        <div
          key={section.id}
          ref={(el) => { sectionEls.current[index] = el }}
          className="relative h-screen w-screen"
        >
          <style
            dangerouslySetInnerHTML={{
              __html: cssCustomPropertiesToStyleBlock(`[data-partner-section="${section.id}"]`, cssCustomProperties),
            }}
          />
          <div data-partner-section={section.id} className="h-full w-full">
            <TemplateRenderer section={section} isActive={index === activeIndex} />
          </div>
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
