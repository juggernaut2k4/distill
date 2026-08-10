'use client'

import { Component, useEffect, useRef, useState } from 'react'
import type { ErrorInfo, ReactNode } from 'react'
import { HumeAdapter } from '@/lib/voice/hume-adapter'
import { OpenAIRealtimeAdapter } from '@/lib/voice/openai-realtime-adapter'
import { ElevenLabsAdapter } from '@/lib/voice/elevenlabs-adapter'
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
  voiceProvider: 'hume' | 'openai_realtime' | 'elevenlabs'
  // The widget channel's OWN, fully self-contained OpenAI Realtime prompt
  // (lib/voice/widget-prompt-rules.ts's assembleWidgetOpenAIPrompt() output, computed server-side in
  // widget-render/page.tsx — already includes the on-topic-jump rule, no client-side concatenation
  // needed). Hume needs no equivalent prop here — its prompt is baked server-side into the opaque
  // `humeConfigId` before this component ever mounts; HumeAdapter.create() below passes no
  // instructions text at all, matching PartnerRenderClient.tsx's own current behavior exactly.
  openaiVoiceInstructions: string | null
  // B2B-75 — the ElevenLabs agent id (a plain identifier, NOT a secret; the API key is never a
  // prop and never reaches the browser) and this channel's own ElevenLabs prompt, assembled
  // server-side by lib/voice/widget-elevenlabs-prompt-rules.ts. Both null unless
  // voiceProvider === 'elevenlabs'.
  elevenlabsAgentId: string | null
  elevenlabsVoiceInstructions: string | null
}

// Same anti-stall floor `PartnerRenderClient.tsx`'s own advance_tab uses — ported because it uses
// only the shared VoiceSessionAdapter interface's `triggerRecoveryNudge` (lib/voice/adapter.ts,
// reused unmodified), not anything from the shared component file itself. Omitting it here would
// reintroduce, in this new component, the exact "silence after a tool call" bug class a whole prior
// session spent multiple live-test rounds fixing.
const POST_TOOL_NUDGE_MS = 7000

// v14 — per Arun's direct instruction, the entire awaiting_answer tool-call mechanism (v10-v13) is
// removed: he was uncomfortable depending on the model reliably remembering to call a function at
// the right moment (confirmed unreliable across several live tests — the model repeatedly skipped
// it at genuine stopping points), and asked for a "wait, check in again, then end gracefully" flow
// driven by real silence instead. Clio's basic ability to wait after asking a question was never in
// question — that's native OpenAI Realtime turn-taking and always worked on its own; only the
// *safety-net* timing needed a reliable signal, and it now comes from OpenAI's own native
// idle_timeout_ms silence detector (see openai-realtime-adapter.ts's turn_detection config) instead
// of a tool call — a platform-level signal that fires on real audio silence regardless of what the
// model is doing, with zero dependency on it calling anything.
//
// v16 — per Arun's direct instruction, silence alone never ends a session anymore: every fire gets
// the same non-terminal "check in warmly" reaction, no matter how many times in a row it happens.
// This sidesteps a real bug found via live testing (a growing audio-playback backlog — generation
// runs 3-5x faster than real speech, so a long teaching turn can leave several responses queued
// locally; the native idle_timeout_ms signal is anchored to the SERVER's own generation timeline,
// not to what the participant has actually heard yet, so it could fire while the participant was
// still hearing an EARLIER response, well before they'd even heard the question being asked) without
// needing to touch response pacing or reintroduce a client-side clock — the only way a session ends
// automatically now is the max-call-duration cap below. Deliberately the simple fix for now; revisit
// with a pacing-aware fix only if this needs further optimization later.
const IDLE_TIMEOUT_CHECKIN_TEXT =
  'You have gone quiet for a bit and the participant has not spoken. This does not end the ' +
  "session — silence alone is never a reason to close, no matter how many times you receive this " +
  'note. Check in warmly and briefly, in your own words — something like "Still there?" or "Take ' +
  'your time — whenever you\'re ready" — then continue naturally: if you had just asked a ' +
  'question, wait for their real answer again; if you were partway through explaining something, ' +
  'simply continue from where you left off.'

// v14 — per Arun's instruction, a hard ceiling on total call length ("max call duration set as 60
// for now"), independent of the silence-detector logic above. Armed once, at connect time, off the
// same connectStartRef already used for the elapsed-session UI timer and billing-duration
// calculation — a single client-side timeout, no adapter/platform involvement needed for this one.
//
// B2B-76 §1.3 — this is a NUDGE only (asks Clio to wrap up out loud); it cannot survive a killed
// tab or a JS-frozen background tab. inngest/partner-trial-cutoff.ts's
// `MAX_WIDGET_CALL_DURATION_MS` is the genuine server-side backstop for the same ceiling, copied
// from this exact value rather than sharing an import (this is a 'use client' browser bundle, that
// is a server-only Inngest function) — if this number ever changes, that one must change with it,
// and vice versa.
const MAX_CALL_DURATION_MS = 60 * 60 * 1000
const MAX_CALL_DURATION_NUDGE_TEXT_OPENAI =
  'This session has reached its maximum allowed length. The one thing you say next is a real, ' +
  'out-loud goodbye, briefly wrapping up wherever you are right now even if not everything has ' +
  'been covered — with your acknowledgment that time is up carried inside the goodbye itself ' +
  'rather than ahead of it, for example: "We\'re right at time, so let\'s wrap up here — great ' +
  'progress today, we can pick up the rest another time." Then call end_session immediately ' +
  'after, in this same turn.'

// 2026-08-09 — ElevenLabs variant, using the native end_call system tool instead of the custom
// end_session client tool (per Arun's direct instruction to switch to it). end_call's own
// `message` parameter is spoken by the ElevenLabs platform itself before hangup, so this asks
// Clio to carry the goodbye as that parameter rather than needing to say it out loud first, then
// call the tool in a separate step — see widget-elevenlabs-prompt-rules.ts's G22 for the mirrored,
// primary copy of this instruction (this nudge is the one client-side path that can't go through
// that file, since it fires from a plain JS timer, not from the prompt).
const MAX_CALL_DURATION_NUDGE_TEXT_ELEVENLABS =
  'This session has reached its maximum allowed length. Call the end_call tool now, with a reason ' +
  'noting the time limit, and set its message to a real, warm goodbye — briefly wrapping up ' +
  'wherever you are right now even if not everything has been covered, with your acknowledgment ' +
  'that time is up carried inside the goodbye itself, for example: "We\'re right at time, so ' +
  'let\'s wrap up here — great progress today, we can pick up the rest another time."'

// 2026-08-10 — mutual-silence nudge, ElevenLabs only. Built after confirming, live, that neither
// ElevenLabs' native turn_timeout (per-agent "Take turn after silence") nor
// silence_end_call_timeout ("End conversation after silence") can be trusted for this: the SDK has
// no client-side override path for turn_timeout at all (verified against the installed SDK's own
// constructOverrides() source — it never even reads a `turn` field from what we pass), and
// silence_end_call_timeout is documented as counting "since the user last spoke" — it does NOT
// reset while Clio herself is mid-monologue, so any value low enough to matter kills real sessions
// mid-sentence (confirmed live: set to 15s, ended a call while Clio was actively teaching). This
// timer is the fully client-owned replacement discussed with Arun: we already get live
// onModeChange events, so we can track "has NEITHER side said anything" ourselves, with no
// dependency on either unreliable native mechanism.
//
// Armed the instant mode flips to 'listening' (Clio stopped talking); cleared the instant mode
// flips back to 'speaking' (Clio resumed) OR a user transcript actually arrives (whichever comes
// first — catches the case where the participant answered but Clio's reply hasn't started
// generating yet, which would otherwise let the timer fire on a false positive). At 7s with
// neither, sends a real contextual nudge via the same triggerRecoveryNudge/sendContextualUpdate
// path the other nudges already use — see widget-elevenlabs-prompt-rules.ts's G23 for the matching
// prompt-side instruction on how to act on this note.
const MUTUAL_SILENCE_NUDGE_MS = 7000
const MUTUAL_SILENCE_NUDGE_TEXT =
  'Neither of you has said anything for about 7 seconds — this is genuine silence, not you still ' +
  "speaking. Treat it exactly as your own instructions say to treat silence for whatever you're " +
  "currently doing: if you're waiting on the answer to a specific question, that's your cue to act " +
  'on it now, in your own words, per that rule. If you were just checking whether they have ' +
  'anything more to add, treat this as a "no" and move on now, without waiting any further.'

// 2026-08-07 — EXPERIMENTAL, per Arun's direct instruction, trivially revertible: flip to `false`
// and redeploy to fully disable, no other changes needed. Root cause under investigation this round
// is that advance_tab has been observed firing silently BEFORE the model finishes speaking the
// content that belongs before it — the screen moves ahead of what's actually been said. This tries
// a different mechanism entirely: instead of trusting the model's own tool-call timing to drive the
// screen, watch its own completed spoken turn (onMessage's 'ai' text, already the real, final
// transcript) for the fixed transition phrase rule 3 already asks it to say ("next up is ...") and
// advance the screen ourselves the instant we see it — driven by what was actually said, not by a
// separate, disconnected tool-call decision. advance_tab itself is left fully intact as a fallback:
// if the model still calls it (nothing in the prompt tells it not to), `performAdvance`'s own
// debounce below treats a second call within the guard window as the same transition, not a double
// advance — so this is additive, not a replacement, and safe if phrase detection ever misses.
// 2026-08-07 — turned OFF per Arun's direct instruction: confirmed via a live test's diagnostics
// that this never actually fired (the model said "<Title> is next" that session, not "next up is
// ..." — a phrasing mismatch, not a logic bug), so the whole mechanism sat inert while show_visual
// did all the real navigation work. Disabling cleanly rather than leaving dead code active — flip
// back to `true` (and widen NEXT_TOPIC_TRANSITION_PHRASE to also match "<Title> is next") to retry.
const PHRASE_TRIGGERED_ADVANCE_ENABLED = false
const NEXT_TOPIC_TRANSITION_PHRASE = /next up is/i
const PHRASE_ADVANCE_DEBOUNCE_MS = 5000

export default function WidgetRenderClient({
  clioSessionRef,
  inlinePages,
  humeConfigId,
  voiceProvider,
  openaiVoiceInstructions,
  elevenlabsAgentId,
  elevenlabsVoiceInstructions,
}: WidgetRenderClientProps) {
  const count = inlinePages.length

  // B2B-75 (§6.7b). `humeConfigId` was doing double duty as "is voice configured at all" for EVERY
  // provider, including OpenAI Realtime — a latent gate a third provider would silently trip (it
  // guarded the whole connect() body, the warm-up overlay, the elapsed timer, and the entire
  // call-controls overlay, so an ElevenLabs session would have connected with no visible controls
  // and no timer). Replaced by an explicit per-provider precondition. Deliberately byte-equivalent
  // for 'hume' and 'openai_realtime' — both still require humeConfigId, exactly as today — so no
  // existing behaviour changes; only the 'elevenlabs' arm is new.
  const voiceEnabled =
    voiceProvider === 'elevenlabs' ? Boolean(elevenlabsAgentId) : Boolean(humeConfigId)

  const [status, setStatus] = useState<'connecting' | 'listening' | 'speaking' | 'error' | 'ended'>('connecting')
  const [showConnectWarmup, setShowConnectWarmup] = useState(voiceEnabled)
  const warmupTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const postToolNudgeTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const mutualSilenceTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  // v16 — a running total of native idle_timeout_ms fires this session, for observability only
  // (see handleIdleTimeoutFired's doc comment — v16 removed the escalate-on-repeated-fire behavior
  // this counter used to gate).
  const idleTimeoutFireCountRef = useRef(0)
  const maxDurationTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const adapterRef = useRef<VoiceSessionAdapter | null>(null)
  const connectStartRef = useRef<number | null>(null)
  const endedRef = useRef(false)

  // §6.5 — the two distinct pieces of position state. `progressIndexRef` is where real forward
  // progress continues from, touched by advance_tab (OpenAI) and, since 2026-08-09, by show_visual
  // itself when voiceProvider === 'elevenlabs' AND the requested page is exactly the next one in
  // sequence (widget-elevenlabs-prompt-rules.ts no longer instructs a separate advance_tab call —
  // see that file's rule 3g and the show_visual handler below). `displayedIndex`/`displayedIndexRef`
  // is what's currently scrolled into view, touched by every show_visual/advance_tab call via the
  // shared `scrollToIndex` helper below — this is the entire mechanism realizing "a side-trip, not
  // a redefinition of progress" for any jump that isn't the next page in order.
  const progressIndexRef = useRef(0)
  const [displayedIndex, setDisplayedIndex] = useState(0)
  const displayedIndexRef = useRef(0)
  // 2026-08-07 — debounce guard shared by performAdvance's two call sites (the real advance_tab
  // tool call and phrase-triggered detection below), so whichever fires first for a given topic
  // transition wins and the other is treated as the same event, not a second advance.
  const lastPerformAdvanceAtRef = useRef(0)
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

  /** B2B-75 — the same real amplitude readout as sampleAnalyserBars above, computed from byte
   *  FREQUENCY data instead of an AnalyserNode's time-domain data, for adapters whose SDK exposes
   *  the data but not the node producing it (ElevenLabs). Mean of the frequency bins, normalised to
   *  0-1, with the identical [0.75, 1, 0.75] centre-weighted taper and the identical 0.12 idle
   *  floor, so the pill's visual language is the same across providers. This is a real readout of
   *  real audio via a different (but equally real) accessor — never a decorative animation. */
  function sampleFrequencyBars(data: Uint8Array, bars = 3): number[] {
    if (data.length === 0) return Array.from({ length: bars }, () => 0.12)
    let sum = 0
    for (let i = 0; i < data.length; i++) sum += data[i]
    const level = Math.max(0, Math.min(1, (sum / data.length / 255) * 4))
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
      if (!voiceEnabled) return // session proceeds without voice; content still renders

      warmupTimeoutRef.current = setTimeout(() => setShowConnectWarmup(false), 6000)

      try {
        const micStream = await navigator.mediaDevices.getUserMedia({ audio: true })
        if (cancelled) return

        connectStartRef.current = Date.now()
        maxDurationTimeoutRef.current = setTimeout(() => {
          maxDurationTimeoutRef.current = null
          adapterRef.current?.triggerRecoveryNudge?.(
            voiceProvider === 'elevenlabs' ? MAX_CALL_DURATION_NUDGE_TEXT_ELEVENLABS : MAX_CALL_DURATION_NUDGE_TEXT_OPENAI
          )
        }, MAX_CALL_DURATION_MS)

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
          if (botAnalyser) {
            setBotLevels(sampleAnalyserBars(botAnalyser))
          } else {
            // B2B-75 — ElevenLabs owns its own playback graph and exposes no AnalyserNode, only
            // real byte frequency data. When neither accessor is available the pill simply sits at
            // its idle floor, which is the existing behaviour when an analyser isn't ready yet.
            const freq = adapterRef.current?.getOutputFrequencyData?.()
            if (freq) setBotLevels(sampleFrequencyBars(freq))
          }
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

        // 2026-08-10 — the mutual-silence timer's own arm/clear pair. ElevenLabs only: OpenAI keeps
        // its existing native idle_timeout_ms path (handleIdleTimeoutFired below) unchanged.
        const clearMutualSilenceTimer = () => {
          if (mutualSilenceTimeoutRef.current) {
            clearTimeout(mutualSilenceTimeoutRef.current)
            mutualSilenceTimeoutRef.current = null
          }
        }
        const armMutualSilenceTimer = () => {
          clearMutualSilenceTimer()
          mutualSilenceTimeoutRef.current = setTimeout(() => {
            mutualSilenceTimeoutRef.current = null
            fetch('/api/partner/render/voice-diagnostic-capture', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ clio_session_ref: clioSessionRef, label: 'mutual_silence_nudge_fired', detail: {} }),
              keepalive: true,
            }).catch(() => {})
            adapterRef.current?.triggerRecoveryNudge?.(MUTUAL_SILENCE_NUDGE_TEXT)
          }, MUTUAL_SILENCE_NUDGE_MS)
        }

        // v14/v16 — reacts to the platform-native idle_timeout_ms signal (openai-realtime-adapter.ts).
        // No client-side timer needed at all: OpenAI's own server-side VAD tracks the real silence
        // duration and tells us directly when it's crossed the threshold. v16 removed the old
        // escalate-to-close-on-second-fire staging — every fire now gets the identical non-terminal
        // check-in reaction (see IDLE_TIMEOUT_CHECKIN_TEXT's own doc comment for why); the counter
        // here is kept purely for observability (how many times this fired in a session), not to
        // gate behavior.
        const handleIdleTimeoutFired = () => {
          idleTimeoutFireCountRef.current += 1
          fetch('/api/partner/render/voice-diagnostic-capture', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              clio_session_ref: clioSessionRef,
              label: 'idle_timeout_checkin_fired',
              detail: { count: idleTimeoutFireCountRef.current },
            }),
            keepalive: true,
          }).catch(() => {})
          adapterRef.current?.triggerRecoveryNudge?.(IDLE_TIMEOUT_CHECKIN_TEXT)
        }

        // 2026-08-07 — shared by the real advance_tab tool call and phrase-triggered detection
        // (onMessage below). Extracted so both paths do the exact same thing and share the same
        // debounce guard — whichever fires first for a given transition wins, the other is a no-op.
        const performAdvance = () => {
          const now = Date.now()
          if (now - lastPerformAdvanceAtRef.current < PHRASE_ADVANCE_DEBOUNCE_MS) return
          lastPerformAdvanceAtRef.current = now
          armPostToolNudge()
          progressIndexRef.current = computeNextProgressIndex(progressIndexRef.current, count)
          // Same fire-and-forget playback-catch-up wait PartnerRenderClient.tsx's own advance_tab
          // uses (VoiceSessionAdapter.waitForPlaybackCaughtUp — no-op for Hume) — the visual
          // advance must never get ahead of what the participant has actually heard.
          void (async () => {
            await adapterRef.current?.waitForPlaybackCaughtUp?.()
            scrollToIndex(progressIndexRef.current)
          })()
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
            // 2026-08-09 — free-navigation redesign, per Arun's direct instruction: ElevenLabs'
            // prompt (widget-elevenlabs-prompt-rules.ts) no longer calls advance_tab at all, so
            // show_visual must carry advance_tab's progress-tracking job itself. Calling it for the
            // exact next page in SESSION CONTENT order IS what "moving forward" means; calling it
            // for any other page (jumping elsewhere to answer a question, or returning to the page
            // already at the front of progress) only changes what's displayed — mirrors
            // computeNextProgressIndex's own forward-only clamp, just triggered from this tool
            // instead of a separate one. Gated to voiceProvider === 'elevenlabs' so OpenAI's own
            // advance_tab-then-show_visual flow (unmodified, widget-prompt-rules.ts v21) can never
            // hit this branch even if its call order ever changes — by the time OpenAI's show_visual
            // fires, advance_tab has already set progressIndexRef to idx, so idx === current + 1 is
            // never true for that provider.
            if (voiceProvider === 'elevenlabs' && idx === progressIndexRef.current + 1) {
              progressIndexRef.current = idx
              armPostToolNudge()
            }
            // previously moved the screen unconditionally, with no playback-catch-up wait at all
            // (unlike advance_tab, which at least attempts one). Confirmed live: the screen jumped
            // to the next topic's page while ElevenLabs was still ~8 seconds from finishing speaking
            // the CURRENT topic's content, reproducing exactly what Arun described ("navigated to
            // topic 2 while explaining topic 1"). "Wait for response" is off for this tool, so
            // awaiting here does not block the model's own turn-taking — it only delays when the
            // SCREEN visibly updates, which is the entire point.
            await adapterRef.current?.waitForPlaybackCaughtUp?.()
            scrollToIndex(idx)
            return 'Visual is showing.'
          },
          advance_tab: async () => {
            // 2026-08-09 — code-level guard, per Arun's explicit instruction: widget-elevenlabs-
            // prompt-rules.ts never instructs calling this tool (show_visual alone carries progress
            // for this provider — see its own handler above), but that is only a prompt-level
            // guarantee. If advance_tab is still registered as an available client tool on the
            // ElevenLabs agent's dashboard config, the model could technically call it anyway;
            // throwing here — rather than silently no-opping or returning a success-shaped string —
            // makes that call actually FAIL: `@elevenlabs/client` catches a thrown handler and
            // reports it back to the model as `is_error: true` (see elevenlabs-adapter.ts's
            // `handleError` §6.6.6 doc comment), routed to the `el_tool_error` diagnostic rather than
            // the session-level error state, so this never flashes the connection-health pill or
            // disrupts the call — only the one stray tool call itself is rejected. OpenAI is
            // unaffected: it is the only provider whose prompt still calls this tool, and this guard
            // only fires for voiceProvider === 'elevenlabs'.
            if (voiceProvider === 'elevenlabs') {
              throw new Error('advance_tab is not available on this provider — call show_visual for the next page instead.')
            }
            performAdvance()
            return 'Advanced.'
          },
          end_session: async () => {
            setStatus('ended')
            void endSessionOnce()
            return 'Session ended.'
          },
        }

        const onMessage = (text: string, source: 'user' | 'ai') => {
          // B2B-75 §6.7d — widened from an openai_realtime-only check. Hume's transcripts are
          // retrieved post-hoc from Hume's own API; every non-Hume provider needs live capture. The
          // nested phrase-triggered-advance block below keeps its own PHRASE_TRIGGERED_ADVANCE_ENABLED
          // guard (currently false), so widening this outer condition has no effect on it.
          if (voiceProvider !== 'hume' && text.trim()) {
            // 2026-08-10 — a real user transcript arriving means they DID say something, even if
            // Clio's reply hasn't started generating yet (mode hasn't flipped to 'speaking' yet) —
            // clear the mutual-silence timer here too, not just on the mode flip, so a slow-to-start
            // reply can never cause a false-positive nudge on an already-answered question.
            if (voiceProvider === 'elevenlabs' && source === 'user') clearMutualSilenceTimer()

            fetch('/api/partner/render/transcript-capture', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ clio_session_ref: clioSessionRef, source, text }),
              keepalive: true,
            }).catch(() => {})

            // 2026-08-07 — EXPERIMENTAL (see PHRASE_TRIGGERED_ADVANCE_ENABLED's own doc comment
            // above). `text` here is already the final, complete transcript for this turn (the
            // adapter only calls onMessage on response.output_audio_transcript.done), so this fires
            // once the model has actually said the transition phrase rule 3 asks for — never before.
            if (
              PHRASE_TRIGGERED_ADVANCE_ENABLED &&
              source === 'ai' &&
              progressIndexRef.current < count - 1 &&
              NEXT_TOPIC_TRANSITION_PHRASE.test(text)
            ) {
              fetch('/api/partner/render/voice-diagnostic-capture', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ clio_session_ref: clioSessionRef, label: 'phrase_triggered_advance', detail: { text } }),
                keepalive: true,
              }).catch(() => {})
              performAdvance()
            }
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
          // 2026-08-08 — previously only updated UI state, never called endSessionOnce(). That left a
          // real gap: the SDK's own onDisconnect is the authoritative "this call is over" signal
          // (matches the shared VoiceSessionAdapter contract every provider uses), but only the
          // explicit end_session tool call, the "End call" button, and unmount cleanup ever triggered
          // the actual end-of-session flow (POST /api/partner/render/end-session -> handleSessionEnd()
          // -> clio/partner-session.ended -> the whole insights-extraction pipeline). A session whose
          // connection dropped for any OTHER reason (the provider closing it server-side, a network
          // failure) was left stuck at status='widget_active' forever — confirmed live in production
          // 2026-08-08 (partner_sessions 3da087d0-...). endSessionOnce()'s own endedRef guard makes
          // this call safe even when onDisconnect fires as a side effect of the end_session tool path
          // (which already called it) — a second call here is a guaranteed no-op, not a double-charge.
          //
          // Deliberately NOT added to onError below: per B2B-75 §6.6.6, onError also fires for
          // non-fatal tool faults (an unregistered tool call, a throwing tool handler) that must NOT
          // be treated as the call ending — onDisconnect is the one unambiguous signal.
          onDisconnect: () => { setStatus('ended'); clearPostToolNudge(); void endSessionOnce() },
          onError: (message: string) => {
            console.error('[widget-render] Voice session error:', message)
            setStatus('error')
            setConnectionHealth('red')
            revealContentAfterWarmup()
            clearPostToolNudge()
          },
          onModeChange: (mode: 'listening' | 'speaking') => {
            setStatus(mode)
            if (mode === 'speaking') {
              clearPostToolNudge()
              clearMutualSilenceTimer()
            } else if (mode === 'listening' && voiceProvider === 'elevenlabs') {
              armMutualSilenceTimer()
            }
          },
          onMessage,
        }

        let adapter: VoiceSessionAdapter

        if (voiceProvider === 'elevenlabs') {
          // B2B-75 §6.7c. No `mediaStream` is passed: the @elevenlabs/client SDK captures and
          // streams microphone audio itself once permission has been granted. `micStream` above is
          // still obtained (it must run to get permission before startSession, and it feeds the mic
          // analyser tap) — it is simply not handed to this adapter.
          const tokenRes = await fetch('/api/elevenlabs-token')
          if (!tokenRes.ok) throw new Error(`ElevenLabs token fetch failed: ${tokenRes.status}`)
          const { conversationToken } = (await tokenRes.json()) as { conversationToken: string; agentId: string }
          if (cancelled) return

          adapter = await ElevenLabsAdapter.create({
            conversationToken,
            instructions: elevenlabsVoiceInstructions ?? '',
            userId: clioSessionRef,
            tools,
            onDiagnostic: (label, detail) => {
              if (label === 'el_status_change') {
                // Status has FOUR values. 'disconnecting' is a normal teardown step, not a fault —
                // mapping it to red would flash a false "Disconnected" during every clean session
                // end. This is a REAL signal for ElevenLabs (onStatusChange is a first-class
                // provider event), unlike Hume, which has no equivalent live hook and stays green.
                const status = (detail as { status?: string }).status
                if (status === 'connected') setConnectionHealth('green')
                else if (status === 'connecting') setConnectionHealth('yellow')
                else if (status === 'disconnected') setConnectionHealth('red')
                // 'disconnecting' — deliberately leaves the pill unchanged
              } else if (label === 'el_error' || label === 'el_override_rejected') {
                setConnectionHealth('red')
              }
              // NOTE: 'el_tool_error' deliberately does NOT touch connectionHealth — a tool fault is
              // not a connection fault (§6.6.6). It is still captured below like every other
              // diagnostic.
              fetch('/api/partner/render/voice-diagnostic-capture', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ clio_session_ref: clioSessionRef, label, detail }),
                keepalive: true,
              }).catch(() => {})
            },
            reportError: (message) => reportClientError(clioSessionRef, 'elevenlabs-adapter-error', message),
            ...sharedCallbacks,
          })
        } else if (voiceProvider === 'openai_realtime') {
          const tokenRes = await fetch('/api/openai-realtime-token')
          if (!tokenRes.ok) throw new Error(`OpenAI Realtime token fetch failed: ${tokenRes.status}`)
          const { accessToken, model } = (await tokenRes.json()) as { accessToken: string; model: string }
          if (cancelled) return

          adapter = await OpenAIRealtimeAdapter.create({
            ephemeralToken: accessToken,
            model,
            onUserSpeechStarted: () => { clearPostToolNudge() },
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
              } else if (label === 'idle_timeout_triggered') {
                // v14 — the platform-native silence signal that replaced the awaiting_answer
                // tool-call mechanism entirely. See handleIdleTimeoutFired's own doc comment.
                handleIdleTimeoutFired()
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
            // 2026-08-07 — advance_tab re-enabled (the exclusion experiment from 2026-08-06 is
            // over): widget-prompt-rules.ts v21's rule 3g/3h design depends on it as the real
            // topic-boundary mechanism, and leaving it disabled would make 3g a dead instruction.
            // It stays a model-called tool per direct instruction, not client-triggered —
            // PHRASE_TRIGGERED_ADVANCE_ENABLED (below) stays off. No `toolDefs` override needed;
            // the adapter's own default (OPENAI_REALTIME_TOOLS, full set) applies.
            reportError: (message) => reportClientError(clioSessionRef, 'openai-realtime-adapter-error', message),
            ...sharedCallbacks,
          })
        } else {
          const tokenRes = await fetch('/api/hume-token')
          if (!tokenRes.ok) throw new Error(`Hume token fetch failed: ${tokenRes.status}`)
          const { accessToken } = (await tokenRes.json()) as { accessToken: string }
          if (cancelled) return

          // B2B-75 §6.7b — removing `if (!humeConfigId) return` above removed the narrowing that
          // let `configId: humeConfigId` type-check against HumeAdapterConfig.configId: string.
          // An explicit guard rather than a non-null assertion: this throw is caught by the
          // surrounding try/catch and produces the existing status:'error' degradation.
          if (!humeConfigId) throw new Error('Hume selected but no config id was resolved for this session')

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
      if (maxDurationTimeoutRef.current) clearTimeout(maxDurationTimeoutRef.current)
      if (postToolNudgeTimeoutRef.current) clearTimeout(postToolNudgeTimeoutRef.current)
      if (mutualSilenceTimeoutRef.current) clearTimeout(mutualSilenceTimeoutRef.current)
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
    if (!voiceEnabled) return
    const interval = setInterval(() => {
      if (connectStartRef.current) setElapsedSeconds(Math.floor((Date.now() - connectStartRef.current) / 1000))
    }, 1000)
    return () => clearInterval(interval)
  }, [voiceEnabled])

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

  const callControlsOverlay = voiceEnabled && (
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
