'use client'

import { useEffect, useRef, useState } from 'react'
import TemplateRenderer from '@/components/templates/TemplateRenderer'
import { HumeAdapter } from '@/lib/voice/hume-adapter'
import type { TemplateSection } from '@/lib/templates/types'
import { cssCustomPropertiesToStyleBlock, type CSSCustomProperties } from '@/lib/partner/theme-client-safe'

/**
 * B2B-03 — Live-session render client (Requirement Doc Section 4.C Screen
 * state 2; architecture.md Section 12.6).
 *
 * Structurally the same "stack of templates driven by a live Hume voice
 * session" experience as the existing Hume-native `WalkthroughClient.tsx`
 * flow, reused *conceptually* — a parallel, partner-scoped implementation,
 * not a fork of that 1687-line component's session-plan/feedback-tracking
 * logic, none of which applies to a partner session (Section 4.C's own
 * instruction). Audio only, no visible call-control chrome, matching the
 * existing Hume-native in-session experience.
 *
 * GAP CLOSED (follow-up to the original B2B-03 build): `resolveLiveSessionRender`
 * provisions this session's Hume config via the same `provisionNativeConfig`
 * used by `WalkthroughClient.tsx` (lib/partner/live-render.ts step 7), which
 * always attaches the `show_visual` / `advance_tab` / `end_session` custom
 * tools (lib/voice/hume-native/config-provisioner.ts) and the fixed prompt
 * template instructs Hume's own LLM to call them as it narrates
 * (lib/voice/hume-native/prompt-template.ts rules 3/5/8c) — Hume was always
 * going to *call* these tools during a partner session. The only thing
 * missing was a client-side handler map (`tools: {}` below, previously),
 * so every call silently no-op'd (HumeAdapter logs a warning and returns a
 * generic "Tool executed." ack — see lib/voice/hume-adapter.ts's `tool_call`
 * case) while the on-screen stack stayed pinned to section 0 for the whole
 * session and the call never explicitly ended.
 *
 * Fix follows the same *pattern* WalkthroughClient.tsx uses (tool-call-driven
 * section switching — the mechanism the B2B-03 requirement doc's Section 4.C
 * explicitly calls out as the one to reuse conceptually), simplified for this
 * context: no `sessionsRef`/training-scripts/split-context injection (partner
 * `sections` are fully-formed `TemplateSection`s pulled once, not separately
 * scripted), and no server-persisted `walkthrough_state` polling loop (this
 * client is the only viewer — a bare `useState` index plus `scrollIntoView`,
 * the same primitive `components/templates/SessionStack.tsx` uses for its own
 * scroll-on-activate behavior, is sufficient and keeps this component
 * server-poll-free).
 *
 * NOT using RTV-05's server-side transcript-tracker mechanism here: that
 * toggle (`NEXT_PUBLIC_RTV_DISPLAY_SWITCH_ENABLED`) defaults OFF even for
 * Clio's own product today, is explicitly scoped to Hume-native
 * *summary-mode* sessions tied to `sessions`/RTV-03's `rtv_eligible` column
 * (neither of which exist for a `partner_sessions` row), and per its own
 * requirement doc is "Hume-native summary-mode only" scope, not a
 * general-purpose replacement for tool-call-driven display. Reusing the
 * tool-call pattern already wired into this session's Hume config is the
 * smaller, already-proven mechanism — see the build report for the full
 * reasoning.
 */

interface RenderedSectionProp {
  section: TemplateSection
  cssCustomProperties: CSSCustomProperties
}

export interface PartnerRenderClientProps {
  clioSessionRef: string
  sections: RenderedSectionProp[]
  humeConfigId: string | null
}

export default function PartnerRenderClient({ clioSessionRef, sections, humeConfigId }: PartnerRenderClientProps) {
  const [status, setStatus] = useState<'connecting' | 'listening' | 'speaking' | 'error' | 'ended'>('connecting')
  const adapterRef = useRef<HumeAdapter | null>(null)
  const connectStartRef = useRef<number | null>(null)
  const endedRef = useRef(false)

  // Voice-triggered section advancement (gap closed — see module doc comment
  // above). `activeIndex` drives which section TemplateRenderer marks active
  // and re-renders on change; `activeIndexRef` mirrors it so the tool
  // handlers (registered once, at connect time, inside a `[]`-dep effect)
  // always read the *current* index rather than the value captured at mount.
  const [activeIndex, setActiveIndex] = useState(0)
  const activeIndexRef = useRef(0)
  const sectionEls = useRef<(HTMLDivElement | null)[]>([])

  /** Moves the on-screen stack to `idx`, clamped to a valid section, and
   *  scrolls it into view — mirrors SessionStack.tsx's scrollToSection. */
  function goToSection(idx: number) {
    const clamped = Math.max(0, Math.min(idx, sections.length - 1))
    activeIndexRef.current = clamped
    setActiveIndex(clamped)
    sectionEls.current[clamped]?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  /** Resolves the target section index from a show_visual/advance_tab tool
   *  call's params — mirrors WalkthroughClient.tsx's show_visual idx
   *  resolution (section_index first, then a title match fallback), falling
   *  back to the current index (never an out-of-range or negative index)
   *  when neither param is usable. */
  function resolveSectionIndex(params: Record<string, unknown>): number {
    const sectionIndex = params.section_index as number | undefined
    const topicTitle = params.topic_title as string | undefined
    let idx = -1
    if (typeof sectionIndex === 'number') {
      idx = sectionIndex
    } else if (topicTitle) {
      idx = sections.findIndex(({ section }) => section.meta.subtopicTitle === topicTitle)
    }
    return idx < 0 ? activeIndexRef.current : idx
  }

  useEffect(() => {
    let cancelled = false

    async function connect() {
      if (!humeConfigId) {
        // Session proceeds without voice (Section 8's "Hume provisioning
        // failed" degraded state) — the template stack still renders.
        return
      }

      try {
        const micStream = await navigator.mediaDevices.getUserMedia({ audio: true })
        if (cancelled) return

        const tokenRes = await fetch('/api/hume-token')
        if (!tokenRes.ok) throw new Error(`Hume token fetch failed: ${tokenRes.status}`)
        const { accessToken } = (await tokenRes.json()) as { accessToken: string }
        if (cancelled) return

        connectStartRef.current = Date.now()

        const adapter = await HumeAdapter.create({
          accessToken,
          configId: humeConfigId,
          userId: clioSessionRef,
          mediaStream: micStream,
          isNativeMode: true,
          tools: {
            // Primary trigger (prompt-template.ts rule 3) — Hume calls this
            // at the moment it begins covering a section.
            show_visual: async (params) => {
              const idx = resolveSectionIndex(params)
              goToSection(idx)
              const title = sections[idx]?.section.meta.subtopicTitle ?? `section ${idx + 1}`
              return `Visual is now showing: "${title}" (section ${idx + 1} of ${sections.length}).`
            },
            // Secondary trigger (prompt-template.ts rule 5) — Hume may call
            // this instead of show_visual to move to the next section. No
            // partner-session equivalent of the LIVE-01 live-conductor
            // `advance_tab` route exists (that route is keyed on a Clerk
            // `userId` + `walkthrough_state` row, neither of which a
            // `partner_sessions` row has) — this is a local, session-scoped
            // "advance by one" instead.
            advance_tab: async () => {
              const idx = Math.min(activeIndexRef.current + 1, sections.length - 1)
              goToSection(idx)
              const title = sections[idx]?.section.meta.subtopicTitle ?? `section ${idx + 1}`
              return `Advanced to: "${title}" (section ${idx + 1} of ${sections.length}).`
            },
            // prompt-template.ts rule 8c — this is the only way Hume itself
            // signals the call is over. Without a handler it previously
            // no-op'd (HumeAdapter acks with a generic "Tool executed." and
            // keeps the WebSocket open), leaving the session running (and
            // billing voice minutes) after Clio had already said goodbye.
            // Reuses this component's own existing teardown path.
            end_session: async () => {
              setStatus('ended')
              void endSessionOnce()
              return 'Session ended.'
            },
          },
          // B2B-09 architecture.md §16.3 / Requirement Doc §4.B.1, §9 — capture
          // the real Hume chat_id the instant the WebSocket connects and
          // persist it fire-and-forget. Best-effort by design (route always
          // returns 200): a missed write here is recoverable via the 30-minute
          // backstop sweep (inngest/partner-session-insights-extractor.ts),
          // so this never blocks or delays session start.
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
          onMessage: () => {},
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

  async function endSessionOnce() {
    if (endedRef.current) return
    endedRef.current = true

    const durationMinutes = connectStartRef.current ? (Date.now() - connectStartRef.current) / 60000 : 0

    try {
      await adapterRef.current?.endSession()
    } catch {
      // best-effort — never blocks the end-session accounting call below
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

  return (
    <div className="relative h-screen w-screen overflow-y-auto">
      {sections.map(({ section, cssCustomProperties }, index) => (
        <div
          key={section.id}
          ref={(el) => { sectionEls.current[index] = el }}
          className="relative h-screen w-screen"
        >
          <style
            // Values are enum/hex/short-text constrained at write time
            // (lib/partner/theme.ts) before ever reaching this string.
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
