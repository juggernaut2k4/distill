'use client'

import { Component, useEffect, useRef, useState } from 'react'
import type { ErrorInfo, ReactNode } from 'react'
import TemplateRenderer from '@/components/templates/TemplateRenderer'
import { HumeAdapter } from '@/lib/voice/hume-adapter'
import { OpenAIRealtimeAdapter } from '@/lib/voice/openai-realtime-adapter'
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
  // B2B-68 — OpenAI Realtime's OWN independently-assembled, self-contained prompt
  // (lib/voice/openai-realtime-prompt-template.ts's assembleOpenAIRealtimePrompt output, computed
  // server-side in lib/partner/live-render.ts alongside voiceInstructions above, from the same
  // inputs). Replaces the prior architecture of concatenating a separate persona document in
  // front of `voiceInstructions` client-side — that concatenation is exactly why the closing/
  // goodbye instruction used to exist in two disconnected places. Null if prompt assembly failed
  // server-side (session still proceeds, falls back to the same minimal placeholder as before).
  openaiVoiceInstructions: string | null
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

// B2B items 6/7 (2026-08-02) — code-enforced correctness gate on advance_tab, per Arun's design:
// the tool call itself (via record_verification_result), not phrase-matching, is the authoritative
// "ready to advance" signal. See docs/2026-08-02-farewell-narration-findings.md §6 for the full
// design discussion and rationale. OpenAI Realtime only — Hume's tools are configured on Hume's own
// hosted dashboard (lib/voice/hume-native/config-provisioner.ts), out of reach for this build.
const MAX_WRONG_ANSWER_ATTEMPTS = 5
const MAX_GARBLED_ATTEMPTS = 2
// Silence-after-a-turn threshold (item 6) — deliberately generous per Arun's "10-15s, even ok to go
// longer to really confirm" guidance. A one-shot, narrowly-scoped timer (not the general watchdog
// Arun rejected): it only ever fires the graceful audio-issue closing, never a blind "keep talking"
// nudge for its own sake.
const SILENCE_THRESHOLD_MS = 12_000

interface PageVerificationState {
  status: 'unresolved' | 'correct' | 'capped'
  wrongCount: number
  garbledCount: number
}

const SILENCE_RECOVERY_INSTRUCTION =
  'The participant has not responded at all for a while — this is likely an audio or connection ' +
  'issue, not something they are choosing to ignore. Do not keep waiting or repeating yourself. Say, ' +
  'out loud, in your own words: something like "I haven\'t been able to hear anything for a little ' +
  'while, so I don\'t want to keep talking to an empty room. If something\'s off with your mic or ' +
  'connection, no worries at all — reconnect whenever it\'s sorted and we\'ll pick this back up ' +
  'properly. Talk soon." Immediately after saying that, in the same turn, call the end_session tool.'

export default function PartnerRenderClient({
  clioSessionRef,
  sections,
  inlinePages,
  humeConfigId,
  voiceProvider,
  voiceInstructions,
  openaiVoiceInstructions,
  conversationLanguage,
}: PartnerRenderClientProps) {
  // B2B-62 — English (null/absent, or explicitly "english") is the only language the two-stage
  // transcript-watch cue can safely match against today.
  const isEnglishSession = !conversationLanguage || conversationLanguage.trim().toLowerCase() === 'english'
  const isInline = Array.isArray(inlinePages)
  const count = isInline ? inlinePages!.length : (sections?.length ?? 0)

  const [status, setStatus] = useState<'connecting' | 'listening' | 'speaking' | 'error' | 'ended'>('connecting')
  // B2B item 3 (2026-08-02) — connect-time warm-up: hold the real content behind a loading
  // screen until voice is actually connected, instead of showing content that "races" against
  // voice startup. Only gates when voice is expected at all (humeConfigId null → no voice, no
  // gate, matches existing no-voice degrade). A hard timeout is the safety net so a slow/stuck
  // connection never leaves the participant staring at a blank loading screen indefinitely —
  // worse than the racing it replaces.
  const [showConnectWarmup, setShowConnectWarmup] = useState(Boolean(humeConfigId))
  const warmupTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // B2B items 6/7 — per-page verification state, keyed by page index, and the silence-after-a-turn
  // timer. See the module-level doc comment above these constants for the full design.
  const verificationStateRef = useRef<Record<number, PageVerificationState>>({})
  const silenceTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
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

      // B2B item 3 — safety-net timeout: reveal content even if voice never reaches 'listening'
      // or 'error' (e.g. a hang before either fires). Cleared on unmount and once real content is
      // revealed via onConnect/onError below.
      warmupTimeoutRef.current = setTimeout(() => setShowConnectWarmup(false), 6000)

      try {
        const micStream = await navigator.mediaDevices.getUserMedia({ audio: true })
        if (cancelled) return

        // B2B-61 Part A/B seam closed 2026-07-31: `voiceProvider` now comes from the component's
        // own prop (server-resolved from the persisted system_voice_config toggle — see the parent
        // server component that computes it alongside `humeConfigId`), not a client-side env-var
        // read. Hume remains the default: PartnerRenderClientProps types this 'hume' | 'openai_realtime'
        // with no other value possible.
        connectStartRef.current = Date.now()

        // B2B items 6/7 — record_verification_result is the authoritative signal for whether the
        // current page's understanding check has been satisfied; advance_tab is gated on it below.
        // Shared by both inline and template tool sets (identical logic, just called from either).
        const getVerificationState = (idx: number): PageVerificationState => {
          if (!verificationStateRef.current[idx]) {
            verificationStateRef.current[idx] = { status: 'unresolved', wrongCount: 0, garbledCount: 0 }
          }
          return verificationStateRef.current[idx]
        }

        const recordVerificationResult = async (params: Record<string, unknown>): Promise<string> => {
          const idx = activeIndexRef.current
          const state = getVerificationState(idx)
          const result = params?.result

          if (result === 'correct') {
            state.status = 'correct'
            return 'Recorded: correct. You can wrap up this topic and call advance_tab when ready.'
          }

          if (result === 'garbled') {
            state.garbledCount += 1
            if (state.garbledCount >= MAX_GARBLED_ATTEMPTS) {
              state.status = 'capped'
              return (
                'Recorded: garbled (max attempts reached). Do not keep guessing — this may be an ' +
                'audio or connection issue. Gracefully let the participant know you are having ' +
                'trouble understanding them clearly, then end the session now via end_session, ' +
                'rather than calling advance_tab.'
              )
            }
            return `Recorded: garbled (attempt ${state.garbledCount} of ${MAX_GARBLED_ATTEMPTS}). Ask them to repeat or rephrase their answer.`
          }

          // 'incorrect' (or any unrecognized value — treat as not-yet-correct rather than silently
          // advancing, since a malformed/missing result should never be trusted as success).
          state.wrongCount += 1
          if (state.wrongCount >= MAX_WRONG_ANSWER_ATTEMPTS) {
            state.status = 'capped'
            return (
              `Recorded: incorrect (attempt ${state.wrongCount} of ${MAX_WRONG_ANSWER_ATTEMPTS}, max reached). ` +
              'Do not ask again — gracefully let the participant know you will cover this properly ' +
              'in a future session, then wrap up and call advance_tab.'
            )
          }
          return `Recorded: incorrect (attempt ${state.wrongCount} of ${MAX_WRONG_ANSWER_ATTEMPTS}). Re-explain from a different angle or in simpler terms, then ask again.`
        }

        // Tool handlers differ per mode. Option 2 keeps its exact prior behavior;
        // inline mode: only advance_tab (plus the transcript phrase-match backup below)
        // advances the page. B2B-58 — show_visual used to be wired identically to
        // advance_tab, which force-advanced the page before Clio had said anything
        // about the new section. It is now a page-position no-op.
        const inlineTools = {
          show_visual: async () => {
            return 'Visual is showing.'
          },
          record_verification_result: recordVerificationResult,
          advance_tab: async () => {
            // B2B items 6/7 (2026-08-02) — gate on the recorded verification outcome for the
            // CURRENT page before doing anything else. A premature/invalid call is told explicitly
            // to continue the same topic rather than silently no-op'ing — silence here risks Clio
            // believing the move succeeded and drifting into the next topic's content while the
            // screen hasn't actually moved (a real display/speech desync, worse than not advancing).
            const idx = activeIndexRef.current
            if (getVerificationState(idx).status === 'unresolved') {
              return (
                'Not yet — this page\'s verification result has not been recorded as correct (or ' +
                'capped) via record_verification_result. Continue teaching or clarifying this same ' +
                'topic; do not move to the next one and do not talk about the next topic\'s content.'
              )
            }

            const marker = inlinePages![idx]?.transitionMarker
            // B2B-61 round 3 — the model can call this tool the instant it finishes GENERATING the
            // sentence naming the next topic, while that audio may still be mid-flight through the
            // local playback queue. Wait for actual playback to catch up before executing the move,
            // so the visual advance never gets ahead of what the participant has actually heard.
            // No-op for Hume (method not implemented there — see adapter.ts's doc comment).
            //
            // B2B item 7a (2026-08-02) — that wait used to block THIS function's return, which in
            // turn blocked the model from being allowed to speak again (the tool result gates
            // sending function_call_output + the follow-up response.create). Bounded at 8s
            // (waitForPlaybackToFinish's hard cap), that produced real dead air whenever local
            // audio hadn't drained cleanly. Now fire-and-forget: return immediately so she's never
            // blocked on it, while the wait + actual page move still happen right after.
            void (async () => {
              await adapterRef.current?.waitForPlaybackCaughtUp?.()
              if (marker) advanceOnTransition(marker)
            })()
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
          record_verification_result: recordVerificationResult,
          advance_tab: async () => {
            // B2B items 6/7 — same gate as inlineTools.advance_tab above, checked against the
            // CURRENT page (not the target page being advanced to).
            const currentIdx = activeIndexRef.current
            if (getVerificationState(currentIdx).status === 'unresolved') {
              return (
                'Not yet — this section\'s verification result has not been recorded as correct ' +
                '(or capped) via record_verification_result. Continue teaching or clarifying this ' +
                'same section; do not move to the next one and do not talk about its content.'
              )
            }

            // B2B-61 round 3 / B2B item 7a — same playback-catch-up guard, now fire-and-forget
            // (see inlineTools.advance_tab above for the full rationale).
            const idx = Math.min(currentIdx + 1, count - 1)
            void (async () => {
              await adapterRef.current?.waitForPlaybackCaughtUp?.()
              goToSection(idx)
            })()
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
        // B2B item 3 — clears the connect-warmup loading screen and its safety-net timeout.
        // 2026-08-02 fix: registered on the adapter's onSpeakVerified callback below (fires only
        // once real, confirmed-playable audio has arrived), NOT on onConnect — onConnect fires the
        // instant the server just acknowledges the session, well before there's any audio, which
        // was revealing the real screen too early (reported live: still-blurred start, "racing"
        // voice) and defeating the whole point of the warm-up. Still called from onError so a
        // connection failure never leaves the participant stuck behind the loading screen.
        const revealContentAfterWarmup = () => {
          if (warmupTimeoutRef.current) {
            clearTimeout(warmupTimeoutRef.current)
            warmupTimeoutRef.current = null
          }
          setShowConnectWarmup(false)
        }

        // B2B item 6 — silence-after-a-turn timer. Arms whenever Marin finishes speaking (mode
        // goes back to 'listening'), clears on real user speech (onUserSpeechStarted, OpenAI-only)
        // or the next time she starts speaking again. Firing triggers the graceful audio-issue
        // closing via triggerRecoveryNudge — a no-op for Hume (method not implemented there),
        // matching the same optional-chaining pattern as waitForPlaybackCaughtUp.
        const clearSilenceTimer = () => {
          if (silenceTimeoutRef.current) {
            clearTimeout(silenceTimeoutRef.current)
            silenceTimeoutRef.current = null
          }
        }
        const armSilenceTimer = () => {
          clearSilenceTimer()
          silenceTimeoutRef.current = setTimeout(() => {
            adapterRef.current?.triggerRecoveryNudge?.(SILENCE_RECOVERY_INSTRUCTION)
          }, SILENCE_THRESHOLD_MS)
        }

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
          onDisconnect: () => { setStatus('ended'); clearSilenceTimer() },
          onError: (message: string) => {
            console.error('[partner-render] Voice session error:', message)
            setStatus('error')
            revealContentAfterWarmup()
            clearSilenceTimer()
          },
          onModeChange: (mode: 'listening' | 'speaking') => {
            setStatus(mode)
            if (mode === 'listening') armSilenceTimer()
            else clearSilenceTimer()
          },
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
            // B2B item 6 — clears the silence timer on real detected speech, independent of
            // onModeChange's coarser 'listening'/'speaking' toggle. OpenAI-only; passed directly
            // here (not sharedCallbacks) since Hume's config has no equivalent field.
            onUserSpeechStarted: clearSilenceTimer,
            // TEMPORARY — 2026-08-02, diagnosing issues #2/#3 (docs/2026-08-02-farewell-narration-findings.md
            // §8/§9). Fire-and-forget, same pattern as the transcript-capture beacon above. Remove
            // alongside onDiagnostic itself once those issues are resolved.
            onDiagnostic: (label, detail) => {
              fetch('/api/partner/render/voice-diagnostic-capture', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ clio_session_ref: clioSessionRef, label, detail }),
                keepalive: true,
              }).catch(() => {})
            },
            // B2B-68 (2026-08-02) — OpenAI Realtime now gets its own single, self-contained prompt
            // (lib/voice/openai-realtime-prompt-template.ts, server-computed in
            // lib/partner/live-render.ts, passed down as `openaiVoiceInstructions`), replacing the
            // prior architecture of concatenating a separate persona document
            // (OPENAI_VOICE_PERSONA_INSTRUCTIONS) in front of Hume's own `voiceInstructions` — per
            // Arun's direct instruction, that concatenation was "confusing and risky" and was the
            // root cause of the closing/goodbye instruction existing in two disconnected places.
            // Falls back to a minimal placeholder only if server-side prompt assembly failed for
            // this session (mirrors humeConfigId's own null-safe degrade — session proceeds, just
            // without real content).
            instructions:
              openaiVoiceInstructions ??
              'You are Clio, an AI business coach delivering a live coaching session over voice. ' +
              'Use the show_visual, advance_tab, and end_session tools exactly as instructed by their ' +
              'own descriptions.',
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
        // B2B item 3 fix (2026-08-02) — reveal the real content only once real, confirmed-playable
        // audio has arrived, not on the earlier onConnect (server-ack) signal. See
        // revealContentAfterWarmup's own doc comment above for the full rationale.
        adapter.onSpeakVerified(revealContentAfterWarmup)
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
      if (silenceTimeoutRef.current) clearTimeout(silenceTimeoutRef.current)
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

  // B2B item 3 (2026-08-02) — connect-time warm-up overlay. Sits on top of the real content (which
  // still mounts underneath, unchanged) so nothing about page structure/transitions is touched —
  // just what's visually on top for the first moment. Fades out via opacity transition rather than
  // popping, and goes pointer-events-none once hidden so it never blocks interaction after voice
  // connects.
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

  // ─── Inline render (B2B-19) ─────────────────────────────────────────────────
  if (isInline) {
    return (
      <div className="relative h-screen w-screen overflow-y-auto bg-black">
        {connectWarmupOverlay}
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
      {connectWarmupOverlay}
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
