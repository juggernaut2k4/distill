'use client'

import { Component, useEffect, useRef, useState } from 'react'
import type { ErrorInfo, ReactNode } from 'react'
import TemplateRenderer from '@/components/templates/TemplateRenderer'
import { HumeAdapter } from '@/lib/voice/hume-adapter'
import { OpenAIRealtimeAdapter } from '@/lib/voice/openai-realtime-adapter'
import { OPENAI_VOICE_PERSONA_INSTRUCTIONS } from '@/lib/voice/openai-realtime-persona'
import type { VoiceSessionAdapter } from '@/lib/voice/adapter'
import type { TemplateSection } from '@/lib/templates/types'
import { cssCustomPropertiesToStyleBlock, type CSSCustomProperties } from '@/lib/partner/theme-client-safe'
import { matchesSpokenPhrase, computeStage2Eligibility, STAGE_1_WRAP_UP_PHRASE } from '@/lib/content/transition-markers'
import { shouldAdvanceOnTransition } from '@/lib/partner/advance-transition'
// B2B-49 — reportClientError() extracted to a shared module (was local to this file, 2026-07-27)
// so lib/voice/hume-adapter.ts can also report its own silent WS failure paths through it, without
// HumeAdapter importing from a page-level client component. Logic is unchanged, only relocated.
import { reportClientError } from '@/lib/partner/report-client-error'

/**
 * 2026-07-27 — found live: an uncaught render error inside one inline page
 * (e.g. a malformed fetched content page) unmounted the ENTIRE render tree,
 * including the sibling component holding the active Hume voice connection —
 * the whole session dropped silently along with the visible "Application
 * error" screen. This boundary contains a crash to the single page that
 * threw, leaving every other page AND the voice connection (which lives
 * outside this boundary, in the parent component) untouched.
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
  // B2B-48 — set only for Clio's own first-party demo pages. See lib/partner/live-render.ts's
  // RenderedInlinePage.sourceUrl doc comment for the full reasoning.
  sourceUrl?: string
}

export interface PartnerRenderClientProps {
  clioSessionRef: string
  humeConfigId: string | null
  // B2B-61 Part B (docs/specs/B2B-61-requirement-document.md §14 CEO Addendum) — server-resolved
  // provider, read from the persisted system_voice_config toggle by the parent server component
  // alongside `humeConfigId`. Consumed directly in connect() below (2026-07-31, once Part A's
  // live connectivity spike confirmed the adapter's assumptions) to select which adapter to
  // construct — Hume remains the default for any value other than 'openai_realtime'.
  voiceProvider: 'hume' | 'openai_realtime'
  // B2B-61 Part C — the same real, per-session assembled prompt Hume's native mode gets
  // (lib/voice/hume-native/prompt-template.ts's assembleHumeNativePrompt output, computed
  // server-side in lib/partner/live-render.ts and threaded through here). OpenAI Realtime has no
  // hosted-config concept like Hume's `configId`, so it needs the actual instructions text handed
  // to it directly at connect time. Null if prompt assembly failed server-side (session still
  // proceeds without real voice content, mirroring humeConfigId's own null-safe fallback).
  voiceInstructions: string | null
  // B2B-62 — session-wide language Clio conducts the conversation in. Null means English (every
  // pre-B2B-62 session). Also gates the two-stage transcript-watch cue below off for any
  // non-English session — matchesSpokenPhrase/wordTokens (lib/content/transition-markers.ts) are
  // ASCII-only and cannot correctly match accented-language transcripts, so non-English sessions
  // fall back to the advance_tab tool call alone (the existing, already-proven ineligible-page
  // fallback — never worse than today's reliability).
  conversationLanguage: string | null
  sections?: RenderedSectionProp[]
  inlinePages?: InlinePageProp[]
}

export default function PartnerRenderClient({
  clioSessionRef,
  sections,
  inlinePages,
  humeConfigId,
  voiceProvider,
  voiceInstructions,
  conversationLanguage,
}: PartnerRenderClientProps) {
  // B2B-62 — English (null/absent, or explicitly "english") is the only language the two-stage
  // transcript-watch cue can safely match against today.
  const isEnglishSession = !conversationLanguage || conversationLanguage.trim().toLowerCase() === 'english'
  const isInline = Array.isArray(inlinePages)
  const count = isInline ? inlinePages!.length : (sections?.length ?? 0)

  const [status, setStatus] = useState<'connecting' | 'listening' | 'speaking' | 'error' | 'ended'>('connecting')
  // B2B-61 Part A — typed against the provider-agnostic interface, not HumeAdapter directly, so
  // this ref works unchanged regardless of which adapter `connect()` below constructs.
  const adapterRef = useRef<VoiceSessionAdapter | null>(null)
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

  // B2B-59 — timestamp of the last successful advance. Closes the dual-signal race where a
  // delayed echo of the SAME real transition re-resolves activeIndexRef.current (already moved by
  // the first signal) into a fresh, not-yet-fired marker and slips past firedMarkersRef's dedup.
  // See lib/partner/advance-transition.ts for the decision logic and full root-cause writeup.
  const lastAdvanceAtRef = useRef<number | null>(null)

  // B2B-60 — two-stage natural transition state. `stage1ArmedRef` tracks whether Clio has said
  // the fixed Stage 1 wrap-up phrase for the CURRENT page yet; only once armed does Stage 2 (the
  // next page's title) get checked. Reset to false on every real advance (see
  // advanceOnTransition below) so a stale armed state can never leak into the next page's
  // transition. `stage2EligibleRef` is computed once from `inlinePages` (a stable prop for the
  // session's lifetime) — index i is true iff page i+1's title is a safe, distinctive
  // transcript-detection target for the transition FROM page i (see computeStage2Eligibility).
  // Note: `InlinePageProp` carries only title/subtitle (no transitionTrigger or session-level
  // narration, unlike the server's collision-check scope in buildInlineSessionContent) — this is
  // the full input the client has available, and it still catches the two most important
  // collision cases (cross-page title/subtitle collisions and generic/too-short titles).
  const stage1ArmedRef = useRef(false)
  // B2B-62 — non-English sessions get an all-false eligibility array (never computed against real
  // titles), which forces every transition for that session onto the advance_tab tool call alone —
  // the same graceful fallback an individually-ineligible page already uses today, just applied
  // session-wide. See the isEnglishSession/conversationLanguage doc comment above.
  const stage2EligibleRef = useRef<boolean[]>(
    isInline && isEnglishSession ? computeStage2Eligibility(inlinePages!, '') : isInline ? inlinePages!.map(() => false) : []
  )

  // B2B-11 — join-greeting poll (unchanged).
  const joinGreetingRetriedRef = useRef(false)
  // B2B-19 — wrap-up-nudge poll (inline only).
  const wrapUpRetriedRef = useRef(false)

  // 2026-07-27 — global crash diagnostics. The meeting-bot's headless browser has no accessible
  // devtools console, so an uncaught error here was previously invisible from the server side —
  // this reports it to Vercel runtime logs instead of leaving it a guess. Deliberately mounted
  // once, top-level, independent of InlinePageErrorBoundary (which only catches React render
  // errors — this also catches non-render errors like a rejected promise in an event handler).
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

  /**
   * B2B-19 / B2B-59 — the single idempotent forward-only advance both signals feed into.
   * `shouldAdvanceOnTransition` applies, in order: (1) the B2B-59 time-based debounce — any call
   * within ADVANCE_DEBOUNCE_MS of the previous successful advance is ignored outright, regardless
   * of which marker it resolves to; (2) the pre-existing B2B-19 per-marker dedup, unchanged. A
   * blocked call never touches firedMarkersRef/lastAdvanceAtRef and never moves the page.
   */
  function advanceOnTransition(transitionMarker: string) {
    if (!shouldAdvanceOnTransition(transitionMarker, Date.now(), firedMarkersRef.current, lastAdvanceAtRef)) return
    stage1ArmedRef.current = false // B2B-60 — reset two-stage arm state on every real advance
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

        // B2B-61 Part A/B seam closed 2026-07-31: `voiceProvider` now comes from the component's
        // own prop (server-resolved from the persisted system_voice_config toggle — see the parent
        // server component that computes it alongside `humeConfigId`), not a client-side env-var
        // read. Hume remains the default: PartnerRenderClientProps types this 'hume' | 'openai_realtime'
        // with no other value possible.
        connectStartRef.current = Date.now()

        // Tool handlers differ per mode. Option 2 keeps its exact prior behavior;
        // inline mode: only advance_tab (plus the transcript phrase-match backup below)
        // advances the page. B2B-58 — show_visual used to be wired identically to
        // advance_tab, which force-advanced the page before Clio had said anything
        // about the new section. It is now a page-position no-op.
        const inlineTools = {
          show_visual: async () => {
            return 'Visual is showing.'
          },
          advance_tab: async () => {
            const marker = inlinePages![activeIndexRef.current]?.transitionMarker
            // B2B-61 round 3 — the model can call this tool the instant it finishes GENERATING the
            // sentence naming the next topic, while that audio may still be mid-flight through the
            // local playback queue. Wait for actual playback to catch up before executing the move,
            // so the visual advance never gets ahead of what the participant has actually heard.
            // No-op for Hume (method not implemented there — see adapter.ts's doc comment).
            await adapterRef.current?.waitForPlaybackCaughtUp?.()
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
            // B2B-61 round 3 — same playback-catch-up guard as inlineTools.advance_tab above.
            await adapterRef.current?.waitForPlaybackCaughtUp?.()
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

        // B2B-60 transcript-watch (primary signal, inline only) — two-stage natural cue.
        // Extends RTV-02/03's forward-only, single-hit-decisive pattern: Stage 1 arms on the
        // fixed wrap-up phrase, Stage 2 (the next page's real title) then triggers the advance.
        // `transitionMarker` is no longer spoken/matched here — it is passed to
        // advanceOnTransition() purely as the internal dedup key (unchanged plumbing).
        const onMessage = isInline
          ? (text: string, source: string) => {
              if (source !== 'ai' || !text) return
              const idx = activeIndexRef.current
              const page = inlinePages![idx]
              if (!page) return
              if (idx === count - 1) return // last page — no Stage 2 target; see §4a
              if (!stage2EligibleRef.current[idx]) return // collision/too-generic — advance_tab is sole signal here

              if (!stage1ArmedRef.current) {
                if (matchesSpokenPhrase(text, STAGE_1_WRAP_UP_PHRASE)) stage1ArmedRef.current = true
                return
              }

              const nextTitle = inlinePages![idx + 1]?.title
              if (nextTitle && matchesSpokenPhrase(text, nextTitle)) {
                advanceOnTransition(page.transitionMarker) // resets stage1ArmedRef — see above
              }
            }
          : () => {}

        // Shared across both providers — VoiceSessionAdapter's callback shapes are provider-agnostic
        // by design (see adapter.ts), so none of this needs to branch.
        const sharedCallbacks = {
          onConnect: (sessionId: string) => {
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
          onError: (message: string) => {
            console.error('[partner-render] Voice session error:', message)
            setStatus('error')
          },
          onModeChange: (mode: 'listening' | 'speaking') => setStatus(mode),
          // B2B-63 (docs/specs/B2B-63-requirement-document.md §6) — wraps, does not replace, the
          // existing per-mode onMessage closure above (byte-for-byte unchanged behavior, first, for
          // both modes). Inline-mode-only for this build (§0/§11 Q4) — template mode is being paused
          // as a separate product decision; isInline is already computed above. Widening this to
          // cover template mode later, if/when it's reactivated, is a one-word change here (drop
          // `isInline &&`) — no other part of this design needs to change.
          onMessage: (text: string, source: 'user' | 'ai') => {
            onMessage(text, source)
            if (isInline && voiceProvider === 'openai_realtime' && text.trim()) {
              fetch('/api/partner/render/transcript-capture', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ clio_session_ref: clioSessionRef, source, text }),
                keepalive: true,
              }).catch(() => {}) // best-effort — mirrors reportClientError's exact fire-and-forget pattern
            }
          },
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
            // B2B-61 Part C — real content wiring closed 2026-07-31: uses the exact same
            // per-session assembled prompt Hume's native mode gets (server-computed in
            // lib/partner/live-render.ts, passed down as `voiceInstructions`). The template
            // itself contains no Hume-specific mechanics or branding — it's provider-neutral
            // prose already, so no per-provider rewriting was needed. Falls back to a minimal
            // placeholder only if server-side prompt assembly failed for this session (mirrors
            // humeConfigId's own null-safe degrade — session proceeds, just without real content).
            //
            // 2026-08-01 — OPENAI_VOICE_PERSONA_INSTRUCTIONS (lib/voice/openai-realtime-persona.ts)
            // prepended per Arun's exact wording, addressing "marin speaks a little faster than I'd
            // like." OpenAI-only: this text is never sent to Hume, and the shared assembleHumeNativePrompt
            // content/behavior instructions below it are untouched.
            instructions:
              `${OPENAI_VOICE_PERSONA_INSTRUCTIONS}\n\n${
                voiceInstructions ??
                'You are Clio, an AI business coach delivering a live coaching session over voice. ' +
                'Use the show_visual, advance_tab, and end_session tools exactly as instructed by their ' +
                'own descriptions.'
              }`,
            // 2026-08-01 — experiment toggle for the premature-page-advance investigation
            // (docs/b2b-pivot-status.md's B2B-59/60 backlog entry). Read directly from an env var
            // (not a DB-backed admin toggle like voiceProvider) so it's instantly revertible —
            // unset or misconfigure it and this falls back to 'immediate', today's exact existing
            // behavior, with zero code changes needed. See OpenAIRealtimeAdapterConfig.transcriptGateMode.
            transcriptGateMode:
              process.env.NEXT_PUBLIC_OPENAI_TRANSCRIPT_GATE_MODE === 'playback_complete'
                ? 'playback_complete'
                : 'immediate',
            userId: clioSessionRef,
            mediaStream: micStream,
            tools: isInline ? inlineTools : templateTools,
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
            tools: isInline ? inlineTools : templateTools,
            // B2B-49 — surfaces HumeAdapter's own ws.onerror/ws.onclose failures (including the real
            // WS close code/reason) to the same Vercel-log-visible sink as every other diagnostic
            // here. Zero behavior change: HumeAdapter still calls its existing onError/onDisconnect
            // callbacks exactly as before, this is purely an additional fire-and-forget report.
            reportError: (message) => reportClientError(clioSessionRef, 'hume-adapter-error', message),
            ...sharedCallbacks,
          })
        }

        if (cancelled) {
          await adapter.endSession()
          return
        }

        adapterRef.current = adapter
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        console.error('[partner-render] Voice connect failed:', message)
        // B2B-49 — previously only console.error'd, invisible inside the meeting-bot's headless
        // browser. Catches getUserMedia / token-fetch / HumeAdapter.create() setup failures that
        // reach here (which may include a WS failure already separately reported above as
        // 'hume-adapter-error' — reporting both is intentional and harmless, each carries different
        // detail).
        reportClientError(clioSessionRef, 'hume-connect-error', message, err instanceof Error ? err.stack : undefined)
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
          const sent = adapter.sendWrapUpNudge?.(data.nudge_text)
          if (sent) {
            wrapUpRetriedRef.current = false
            clearFlag()
          } else if (!wrapUpRetriedRef.current) {
            wrapUpRetriedRef.current = true
            adapter.sendWrapUpNudge?.(data.nudge_text)
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
            <InlinePageErrorBoundary clioSessionRef={clioSessionRef} pageLabel={page.title ?? `page ${index + 1}`}>
              {page.status === 'unavailable' ? (
                <p className="px-6 text-center text-sm text-white/70">This page isn&apos;t available right now.</p>
              ) : page.mediaType === 'image' ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={page.imageDataUri} alt={page.title ?? `page ${index + 1}`} className="max-h-full max-w-full object-contain" />
              ) : page.sourceUrl ? (
                // B2B-48 — Clio's own first-party demo content: a REAL navigation (src, not
                // srcDoc) so the fetched page's own Next.js router hydration bootstrap gets a
                // real, navigable window.location to reconcile against — eliminates the
                // opaque-origin `about:srcdoc` hydration crash by construction, exactly the way
                // this page already renders correctly when visited directly in a browser tab.
                // Sandboxing is otherwise identical to the srcDoc branch below (allow-scripts,
                // still no allow-same-origin) — this changes only the transport, not the
                // security boundary.
                <iframe
                  title={page.title ?? `page ${index + 1}`}
                  src={page.sourceUrl}
                  sandbox="allow-scripts"
                  className="h-full w-full border-0"
                />
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
