'use client'

import { useEffect, useRef, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import ConceptVisualizer from '@/components/walkthrough/ConceptVisualizer'
import SessionStack from '@/components/templates/SessionStack'
import VisualizationTabPanel from '@/components/kb/VisualizationTabPanel'
import type { VisualSpec } from '@/lib/session-ai'
import type { TabManifest, TemplateSection, VisualizationTab } from '@/lib/templates/types'
import { Conversation } from '@11labs/client'
import { createVoiceAdapter, type VoiceSessionAdapter, HumeAdapter } from '@/lib/voice'
// LIVE-01 — new, isolated client module for the toggle-gated live conductor
// path. This is invoked conditionally at a few well-defined points below (tool
// registration + poll-state application + rendering); it does NOT read or
// write any of this component's existing refs (sectionsRef, trainingScriptsRef,
// billing/audit state, etc.) and holds its own state object instead.
import {
  isLiveConductorEnabledClient,
  createLiveConductorClientState,
  applyLiveConductorPoll,
  createAdvanceTabToolHandler,
  type LiveConductorClientState,
} from '@/lib/content/live-conductor-client'
import LiveConductorVisual from '@/components/live-conductor/LiveConductorVisual'

const AGENT_ID = process.env.NEXT_PUBLIC_ELEVENLABS_AGENT_ID ?? 'agent_0701krp1ta48fswrff17ctb0520m'

// Siren voice ID — locked via overrides.tts.voiceId to ensure consistent voice
// across the firstMessage and all subsequent LLM-generated responses.
const VOICE_ID = process.env.NEXT_PUBLIC_ELEVENLABS_VOICE_ID ?? 'eXpIbVcVbLo8ZJQDlDnl'

// Voice provider toggle — set NEXT_PUBLIC_VOICE_PROVIDER=hume to use Hume EVI 3.
// Defaults to elevenlabs so existing sessions are unaffected.
const VOICE_PROVIDER = process.env.NEXT_PUBLIC_VOICE_PROVIDER ?? 'elevenlabs'
const HUME_CONFIG_ID = process.env.NEXT_PUBLIC_HUME_CONFIG_ID ?? ''

// HUME-NATIVE-01 — separate, additive toggle (per BA spec 4.1). Branches
// alongside (not inside) VOICE_PROVIDER/LIVE_CONDUCTOR checks, at the point
// where a session's Hume Config is selected, in this component's session-start
// path below. Default unset/false leaves the existing VOICE_PROVIDER==='hume'
// (Custom-LLM/LIVE-01) path completely untouched — this only ever changes
// which configId is requested before connecting; hume-adapter.ts itself is
// not modified and requires no changes.
const HUME_NATIVE_ENABLED = process.env.NEXT_PUBLIC_HUME_NATIVE_ENABLED === 'true'

// HUME-NATIVE-01 (Graceful Session End) — the wrap-up nudge instruction sent
// once, near the end of a Hume-native session, over the already-open
// WebSocket (see HumeAdapter.sendWrapUpNudge). Matches rule 8 of
// lib/voice/hume-native/prompt-template.ts (already shipped, unmodified):
// Clio should generate a real, content-aware closing summary of the two most
// important takeaways and say a natural goodbye, which Hume EVI's own
// built-in end-of-conversation detection then turns into a hang-up.
const HUME_WRAPUP_NUDGE_TEXT =
  '[SYSTEM] The session is nearing its end. Naturally wrap up now: briefly ' +
  'summarize the two most important takeaways from this session in your own ' +
  'words, thank the participant, and say a clear, warm goodbye immediately ' +
  'afterward. Do not ask a further question and do not wait for the ' +
  'participant to speak first once you have delivered the closing summary ' +
  'and farewell.'

// How long (ms) of polling silence before sending a keep-alive context update.
// Keep short — ElevenLabs closes the WebSocket after ~15s of inactivity.
const KEEPALIVE_INTERVAL = 8_000
const MAX_RECONNECT = 6

// ─── Silence / no-response handling ───────────────────────────────────────
// Two-stage escalation when NEITHER side has spoken for a while. This is a
// simpler, safer v1 than "after Clio asks a question": detecting whether a
// specific utterance was literally a question is unreliable, so instead we
// reset a single "last activity from either side" clock every time the user
// speaks (transcript forwarded) OR Clio speaks (onMessage source === 'ai').
// Stage 1 fires a gentle in-context check-in nudge; Stage 2 (measured from
// the Stage-1 check-in, not from the original silence start) ends the call
// gracefully via the existing end-call mechanism, framed as a possible
// technical/audio issue rather than the user being unresponsive.
const SILENCE_CHECKIN_MS = 18_000
const SILENCE_END_CALL_MS = 18_000

// ElevenLabs agent.prompt.prompt override has a practical limit around 12,000 chars.
// Beyond this the connection drops silently. session_brief + session_script fit easily;
// topic_context is truncated to fill the remaining budget.
const MAX_PROMPT_CHARS = 12_000

// ─── AUTOGEN-01 Part D — billing audit event helper ───────────────────────────
// Writes one row to the session billing audit log via the public,
// userId-keyed /api/sessions/audit-event route (this component runs inside the
// Recall.ai bot's own headless browser and only knows userId, not session id —
// same constraint as the existing /api/walkthrough-state/[userId] polling route).
// Non-fatal by design: audit logging must never break or delay the live session.
//
// SECURITY (CEO review fix): the route now requires `token` — the per-session
// audit token minted by /api/sessions/[id]/start and read here from
// walkthrough_state's initial server-rendered state (see auditTokenRef). If the
// token is missing (e.g. state hasn't loaded yet), we still attempt the call —
// the server rejects it with 401 and logs are non-fatal to the live session,
// same as any other audit-event failure.
type BillingAuditEventType = 'voice_connect_attempt' | 'speak_verified' | 'gap_start' | 'gap_end'

function writeAuditEvent(
  userId: string,
  eventType: BillingAuditEventType,
  token: string | null,
  provider?: 'elevenlabs' | 'hume'
): void {
  fetch('/api/sessions/audit-event', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userId, eventType, provider, token }),
  }).catch((err) => console.error(`[Walkthrough] Failed to write audit event "${eventType}":`, err))
}

// ─── Call-end fix ──────────────────────────────────────────────────────────
// Actually tells Recall.ai to leave/delete the bot when a session ends — the
// `end_session` client tool and farewell-detection heuristics below previously
// only flipped local UI state, so the bot lingered in the meeting indefinitely.
// Public, userId+token-keyed (same auth model as writeAuditEvent above — this
// component runs inside the bot's own headless browser with no Clerk session).
// Fire-and-forget by design: the UI must still show "Session Complete" even if
// this call is slow or fails; forceEndSession on the server is idempotent, so
// the D3 wall-clock backstop or the gap watchdog will still clean up the bot
// if this request never lands.
function endCallOnServer(userId: string, token: string | null): void {
  if (!token) {
    console.warn('[Walkthrough] endCallOnServer: no audit token available — skipping bot teardown call')
    return
  }
  fetch('/api/sessions/end-call', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userId, token }),
  }).catch((err) => console.error('[Walkthrough] Failed to call end-call:', err))
}

// ─── Split-mode script formatter ──────────────────────────────────────────────
// Formats a single section's training script for injection via injectContext.
// Produces the same structure as buildSessionScript for one section in isolation.
function formatSectionScript(
  section: { meta: { subtopicTitle: string } },
  script: TrainingScript | null,
  sectionNum: number,
  totalSections: number
): string {
  const title = section.meta.subtopicTitle
  const get = (type: string) =>
    script?.segments.find((s) => s.type === type)?.content ?? null

  const teach = get('TEACH')
  const checkpoint = get('CHECKPOINT')
  const probe = get('PROBE')
  const cont = get('CONTINUE')
  const isLast = sectionNum >= totalSections

  return [
    `[SPLIT MODE — SECTION ${sectionNum} SCRIPT INJECTED]`,
    `--- SECTION ${sectionNum}/${totalSections}: "${title}" --- [call show_visual({ section_index: ${sectionNum} })]`,
    ``,
    `[STAGE DIRECTION — DO NOT SAY] Deliver teaching content after show_visual({ section_index: ${sectionNum} }):`,
    teach ?? `(No script — explain the key concepts from the knowledge base in plain language.)`,
    ``,
    `[STAGE DIRECTION — DO NOT SAY] Verification question — ask after TEACH:`,
    checkpoint ?? `How does that land for you?`,
    ``,
    `[STAGE DIRECTION — DO NOT SAY] Reframe fallback — use if participant seems uncertain:`,
    probe ?? `Let me try a different angle.`,
    ``,
    isLast
      ? `[STAGE DIRECTION — DO NOT SAY] Final bridge — say this after verification response, then summarise 2 sentences, then call end_session immediately:`
      : `[STAGE DIRECTION — DO NOT SAY] Bridge to next section:`,
    cont ?? (isLast ? `That wraps up today's session.` : `Good. Let's move to the next section.`),
  ].join('\n')
}

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
  // AGENT-POOL-01: when set, overrides NEXT_PUBLIC_ELEVENLABS_AGENT_ID for this session
  agent_id?: string | null
  // Per-section tab manifests — keyed by section index as string (e.g. "0", "1").
  // Present only when the section has a VisualizationTabPanel with 2+ tabs.
  tab_manifests?: Record<string, TabManifest> | null
  // SECURITY (CEO review fix, AUTOGEN-01 Part D) — minted by POST
  // /api/sessions/[id]/start and required on every write to
  // /api/sessions/audit-event (see that route + lib/session-billing.ts). Read
  // once from the server-rendered initial state; never re-fetched by this
  // client on its own.
  audit_token?: string | null
  // LIVE-01 — additive fields for the toggle-gated live conductor path (see
  // migration 054_live_conductor_state.sql). Present only when
  // NEXT_PUBLIC_LIVE_CONDUCTOR_ENABLED is on and a live-conductor session is
  // active; otherwise always null/absent and never read.
  live_conductor_tab_index?: number | null
  live_conductor_visual?: import('@/lib/content/live-conductor-visual').LiveConductorVisualData | null
  // HUME-NATIVE-01 (Graceful Session End) — set true by inngest/session-timer.ts's
  // Hume-native branch ~2 minutes before the hard cutoff. Present/relevant only
  // for Hume-native sessions (HUME_NATIVE_ENABLED); otherwise always false/absent.
  hume_wrapup_nudge_pending?: boolean | null
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

/**
 * Parses a [NAV:command] directive from Clio's spoken text.
 * Returns the text with the directive stripped (for TTS) and the command
 * value (for client-side tab navigation).
 *
 * Supported formats:
 *   [NAV:tab_id]   — jump to tab by semantic ID
 *   [NAV:±N]       — relative offset (e.g. [NAV:-1], [NAV:+2])
 *   [NAV:N]        — absolute 1-indexed tab number (e.g. [NAV:5])
 */
function parseNavCommand(text: string): { cleanText: string; navCommand: string | null } {
  const navMatch = text.match(/\[NAV:([^\]]+)\]/)
  if (!navMatch) return { cleanText: text, navCommand: null }
  return {
    cleanText: text.replace(/\[NAV:[^\]]+\]/g, '').trim(),
    navCommand: navMatch[1],
  }
}

/**
 * Resolves a NAV command string into a new 0-based tab index.
 *
 * @param command  - raw command value extracted by parseNavCommand
 * @param tabs     - the current section's tab array
 * @param current  - current 0-based active tab index
 * @returns new 0-based index, clamped to valid range
 */
function resolveNavIndex(command: string, tabs: VisualizationTab[], current: number): number {
  if (!tabs.length) return current

  // Relative offset: starts with + or -
  if (/^[+-]\d+$/.test(command)) {
    const delta = parseInt(command, 10)
    return Math.max(0, Math.min(tabs.length - 1, current + delta))
  }

  // Absolute 1-indexed number (e.g. "5" → index 4)
  if (/^\d+$/.test(command)) {
    const idx = parseInt(command, 10) - 1
    return Math.max(0, Math.min(tabs.length - 1, idx))
  }

  // Semantic tab_id lookup
  const idx = tabs.findIndex((t) => t.tab_id === command)
  return idx >= 0 ? idx : current
}

// Multi-word / unambiguous closing phrases only. Deliberately excludes bare
// "bye" and "see you" — both are common inside ordinary conversational
// sentences (e.g. Clio's own opening greeting "Great to see you today") and
// produced false-positive session terminations when matched as a substring.
const FAREWELL_PHRASES = [
  'goodbye',
  'farewell',
  'take care',
  'until next time',
  'session is complete',
  "that's all for today",
  "we're done",
  'all done',
  'great work today',
  'well done today',
]

/**
 * Detects whether an AI utterance is a genuine session-closing remark.
 *
 * Word-boundary matching avoids substring false positives (e.g. "goodbye"
 * inside a longer word). The very first AI message of a session is never
 * treated as a farewell — it's always Clio's opening greeting, and greetings
 * routinely contain phrasing ("great to see you today") that would otherwise
 * collide with farewell detection before any real conversation has happened.
 *
 * @param text - the AI message text to check
 * @param isFirstAiMessage - true if this is the first AI message in the session
 */
function isFarewellMessage(text: string, isFirstAiMessage: boolean): boolean {
  if (isFirstAiMessage) return false
  const lower = text.toLowerCase()
  return FAREWELL_PHRASES.some((phrase) => {
    const escaped = phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    return new RegExp(`\\b${escaped}\\b`).test(lower)
  })
}

interface Props {
  userId: string
  botView?: boolean
  userFirstName?: string
  initialState: WalkthroughState
  // SECURITY (CEO review fix) — explicit override for the public bot page
  // (app/walkthrough/[userId]/page.tsx), which sources the token from a URL
  // query param rather than from initialState (see that file's comment for why).
  // The Clerk-authenticated dashboard page does not pass this; it relies on
  // initialState.audit_token instead, which is safe there because that page is
  // auth-gated.
  auditToken?: string | null
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

export default function WalkthroughClient({ userId, userFirstName, initialState, botView = false, auditToken = null }: Props) {
  const [state, setState] = useState<WalkthroughState>(initialState)
  const [showLandscapePrompt, setShowLandscapePrompt] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const [dimensions, setDimensions] = useState({ width: 1280, height: 720 })
  // Tab navigation state for VisualizationTabPanel
  const [activeTabIndex, setActiveTabIndex] = useState(0)
  // Ref mirrors state so onMessage callback (captured at session start) always sees fresh value
  const activeTabIndexRef = useRef(0)
  const [agentStatus, setAgentStatus] = useState<AgentStatus>('disconnected')
  const [agentError, setAgentError] = useState<string | null>(null)
  const [pollCount, setPollCount] = useState(0)
  const [pollError, setPollError] = useState<string | null>(null)
  const conversationRef = useRef<Conversation | null>(null)
  // adapterRef: provider-agnostic handle (injectContext, endSession, setVolume, etc.)
  // elevenLabsConvRef: raw Conversation kept separately for sendUserMessage (ElevenLabs-specific)
  const adapterRef = useRef<VoiceSessionAdapter | null>(null)
  const elevenLabsConvRef = useRef<Conversation | null>(null)
  // HUME-NATIVE-01 (Graceful Session End) — tracks whether a retry has
  // already been attempted for the CURRENT nudge-pending flag, so the once
  // per-poll-cycle retry policy (Section 8: "one immediate retry, then give
  // up silently") doesn't re-retry on every subsequent 2s poll while the
  // flag is still true (e.g. because the clear-PATCH itself is in flight or
  // failed). Reset to false whenever the flag transitions back to false.
  const humeWrapupNudgeRetriedRef = useRef(false)
  const lastSentTranscriptRef = useRef<string | null>(null)
  const lastActivityRef = useRef<number>(Date.now())
  // ─── Silence / no-response handling ─────────────────────────────────────
  // lastEitherSpokeRef: timestamp of the last time EITHER side spoke (user
  // transcript forwarded, or Clio's onMessage fired with source 'ai'). Kept
  // separate from lastActivityRef (which drives the pre-existing ElevenLabs
  // keep-alive/inactivity-disconnect logic above) so this new feature cannot
  // change that unrelated behavior.
  const lastEitherSpokeRef = useRef<number>(Date.now())
  // checkinSentAtRef: set when the Stage-1 gentle check-in is injected; used
  // to measure the Stage-2 window from the check-in itself (not from the
  // original silence start), and reset to null on any subsequent activity.
  const checkinSentAtRef = useRef<number | null>(null)
  const hasConnectedRef = useRef(false)
  // Debounce: buffer the latest transcript and wait 500ms after the last update
  // before sending to ElevenLabs. Prevents cascade from partial transcript events.
  const pendingTranscriptRef = useRef<string | null>(null)
  const sendTranscriptTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const sessionEndedRef = useRef(false)
  // Counts AI utterances so farewell detection can skip the very first one
  // (Clio's opening greeting) — see isFarewellMessage above.
  const aiMessageCountRef = useRef(0)
  const topicRef = useRef<string | null | undefined>(initialState.topic_title)
  const skippedTopicsRef = useRef<string[]>(initialState.skipped_topics ?? [])
  const sectionsRef = useRef<TemplateSection[]>(initialState.sections ?? [])
  const trainingScriptsRef = useRef<TrainingScript[]>((initialState.training_scripts ?? []) as TrainingScript[])
  const tabManifestsRef = useRef<Record<string, TabManifest> | null>(initialState.tab_manifests ?? null)
  const currentSectionIndexRef = useRef<number>(initialState.current_section_index ?? 0)
  // Three-document system — used to build the ElevenLabs system prompt override
  const sessionBriefRef = useRef<string | null>(initialState.session_brief ?? null)
  const topicContextRef = useRef<string | null>(initialState.topic_context ?? null)
  const sessionScriptRef = useRef<string | null>(initialState.session_script ?? null)
  // Legacy fallback
  const clioSessionContextRef = useRef<string | null>(initialState.clio_session_context ?? null)
  // SECURITY (CEO review fix) — audit token proving this bot instance owns the
  // current session; required on every /api/sessions/audit-event write. Read
  // once from server-rendered initial state; refreshed by the walkthrough_state
  // poll below in case a reconnect picks up a rotated token.
  const auditTokenRef = useRef<string | null>(auditToken ?? initialState.audit_token ?? null)
  const reconnectAttemptsRef = useRef(0)
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  // AUTOGEN-01 Part D — billing audit trail state.
  // speakVerifiedWrittenRef: true once the `speak_verified` audit event has been
  // written for this session (across the whole component lifetime, not per-adapter
  // instance — reconnects must never re-fire billing-start).
  const speakVerifiedWrittenRef = useRef(false)
  // gapOpenRef: true while a voice-connection gap is currently open (disconnected
  // after billing had already started, not yet reconnected).
  const gapOpenRef = useRef(false)

  // LIVE-01 — own, isolated state for the toggle-gated live conductor path.
  // Deliberately a separate ref object (not merged into sectionsRef /
  // trainingScriptsRef / any of the above) so the two paths never share
  // mutable state. Only read/written when isLiveConductorEnabledClient() is
  // true; a no-op object otherwise.
  const liveConductorRef = useRef<LiveConductorClientState>(createLiveConductorClientState())
  const [liveConductorVisual, setLiveConductorVisual] = useState<LiveConductorClientState['visual']>(null)

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

  // Detect portrait orientation on mobile and prompt user to rotate
  useEffect(() => {
    const check = () => {
      const isMobile = window.innerWidth < 768
      const isPortrait = window.innerHeight > window.innerWidth
      setShowLandscapePrompt(isMobile && isPortrait)
    }
    check()
    window.addEventListener('resize', check)
    window.addEventListener('orientationchange', check)
    return () => {
      window.removeEventListener('resize', check)
      window.removeEventListener('orientationchange', check)
    }
  }, [])

  // Keep ref in sync so NAV handler inside onMessage (closure) always reads fresh index
  useEffect(() => {
    activeTabIndexRef.current = activeTabIndex
  }, [activeTabIndex])

  // Reset active tab to 0 whenever the section changes
  useEffect(() => {
    setActiveTabIndex(0)
    activeTabIndexRef.current = 0
  }, [state.current_section_index])

  // Track graceful session end — set true when Clio says goodbye or calls end_session
  const [sessionComplete, setSessionComplete] = useState(false)
  // Track the reason for a permanent connection failure (after all retries exhausted)
  const [connectionError, setConnectionError] = useState<string | null>(null)
  // Retry count as state so the UI re-renders when it changes
  const [retryCount, setRetryCount] = useState(0)
  // Bot view warmup: Attendee's screen capture needs ~3s to stabilise on first join.
  // We hide the content behind a dark overlay until the stream is ready.
  // On reconnects the stream is already warm, so we skip the wait.
  const [botViewReady, setBotViewReady] = useState(!botView)
  const stableConnectionTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Connect to ElevenLabs agent on mount, with auto-reconnect on unexpected drops
  useEffect(() => {
    // AUD-01: relay mode — ElevenLabs runs server-side via the audio relay.
    // Skip browser session startup entirely; visual polling (below) still runs.
    const audioMode = process.env.NEXT_PUBLIC_MEETING_BOT_AUDIO_MODE ?? 'browser'
    if (audioMode === 'relay') return

    let cancelled = false

    const connect = async () => {
      if (cancelled) return
      const isReconnect = hasConnectedRef.current
      // Detect mid-session reconnects from the Attendee bot reloading its page.
      // hasConnectedRef is false on fresh page loads, so isReconnect misses this case.
      // If the DB shows we're past section 0, the session was already underway.
      const isMidSession = !isReconnect && (currentSectionIndexRef.current > 0)

      // The bot's own page-warmup reload happens once, shortly after first load —
      // matches the existing botViewReady delay below (setTimeout 3000ms). Starting
      // a real voice connection before that reload lands gets it torn down almost
      // immediately (WS opens, mic starts, then the remount cleanup closes it —
      // Hume logs this as a clean USER_ENDED with no error, easy to misread as a
      // Hume-side rejection). Wait out the same warmup window on a genuinely fresh
      // bot load before opening the connection at all; reconnects/mid-session skip this.
      if (botView && !isReconnect && !isMidSession) {
        await new Promise((resolve) => setTimeout(resolve, 3500))
        if (cancelled) return
      }

      setAgentStatus('connecting')
      setAgentError(null)

      try {
        // Mic permission required for WebSocket audio session.
        // Headless browser mic returns silence — participant speech reaches the
        // agent via sendUserMessage() fed by the transcript webhook instead.
        const micStream = await navigator.mediaDevices.getUserMedia({ audio: true })
        if (cancelled) return

        // AUTOGEN-01 Part D — informational only, NOT the billing-start signal.
        writeAuditEvent(userId, 'voice_connect_attempt', auditTokenRef.current, VOICE_PROVIDER === 'hume' ? 'hume' : 'elevenlabs')

        // ── HUME EVI 3 path ───────────────────────────────────────────────────
        if (VOICE_PROVIDER === 'hume') {
          const tokenRes = await fetch('/api/hume-token')
          if (!tokenRes.ok) throw new Error(`Hume token fetch failed: ${tokenRes.status}`)
          const { accessToken } = await tokenRes.json() as { accessToken: string }

          // HUME-NATIVE-01 — small, clearly-commented conditional block, not an
          // inline restructuring of this function. Branches at the point the
          // Config is selected (per BA spec 4.1), above HumeAdapter.create().
          // hume-adapter.ts requires no change: which mode runs is entirely a
          // property of which configId is passed in below. On any failure here,
          // provision-config's route already blocks with a clear error (no
          // silent fallback to Custom-LLM mode) — that error simply propagates
          // up through this connect() try/catch like any other connect failure.
          let humeConfigId = HUME_CONFIG_ID
          if (HUME_NATIVE_ENABLED) {
            const provisionRes = await fetch('/api/hume-native/provision-config', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ userId }),
            })
            if (!provisionRes.ok) {
              const errBody = await provisionRes.text().catch(() => '')
              throw new Error(`Hume native Config provisioning failed (${provisionRes.status}): ${errBody.slice(0, 200)}`)
            }
            const { configId } = await provisionRes.json() as { configId: string }
            humeConfigId = configId
          }

          const hume = await HumeAdapter.create({
            accessToken,
            configId: humeConfigId,
            userId,
            mediaStream: micStream,
            onConnect: (sessionId) => {
              console.log('[Walkthrough/Hume] Connected, session:', sessionId)
              setAgentStatus('listening')
              // HUME-NATIVE-01 — capture hume_chat_id (per BA spec 4.5), gated so
              // it only runs when native mode is enabled for this session — no
              // behavior change for Custom-LLM-mode sessions, which don't need
              // this field. Fire-and-forget: never blocks or affects connect flow.
              if (HUME_NATIVE_ENABLED && sessionId) {
                fetch('/api/hume-native/session-chat-id', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ userId, humeChatId: sessionId }),
                }).catch((err) => console.warn('[Walkthrough/Hume] Failed to persist hume_chat_id:', err))
              }
              if (stableConnectionTimerRef.current) clearTimeout(stableConnectionTimerRef.current)
              stableConnectionTimerRef.current = setTimeout(() => {
                reconnectAttemptsRef.current = 0
                setRetryCount(0)
                console.log('[Walkthrough/Hume] Connection stable for 30s — retry counter reset')
              }, 30_000)
              // AUTOGEN-01 Part D / Edge Case D2 — a successful (re)connect after
              // billing had already started (speak_verified written) closes any
              // open gap. onConnect alone is NOT the speak_verified signal (see
              // onSpeakVerified registration below) — this only closes gaps.
              if (gapOpenRef.current) {
                gapOpenRef.current = false
                writeAuditEvent(userId, 'gap_end', auditTokenRef.current, 'hume')
              }
            },
            onDisconnect: () => {
              console.log('[Walkthrough/Hume] Disconnected')
              adapterRef.current = null
              setAgentStatus('disconnected')
              // AUTOGEN-01 Part D / Edge Case D2 — only a genuine gap if billing had
              // already started; a disconnect before speak_verified is just a failed
              // connection attempt (AC-D3 covers that case with zero billed minutes).
              if (speakVerifiedWrittenRef.current && !gapOpenRef.current && !sessionEndedRef.current) {
                gapOpenRef.current = true
                writeAuditEvent(userId, 'gap_start', auditTokenRef.current, 'hume')
              }
              if (sessionEndedRef.current) return
              if (!cancelled && reconnectAttemptsRef.current < MAX_RECONNECT) {
                reconnectAttemptsRef.current++
                setRetryCount(reconnectAttemptsRef.current)
                const delay = Math.min(3000 * reconnectAttemptsRef.current, 20000)
                console.log(`[Walkthrough/Hume] Reconnecting in ${delay}ms (attempt ${reconnectAttemptsRef.current}/${MAX_RECONNECT})`)
                reconnectTimerRef.current = setTimeout(connect, delay)
              } else if (!cancelled) {
                // Prefer whatever specific reason onError already captured (e.g. an
                // actual Hume-provided close reason) over this generic fallback —
                // onError fires first on a terminal close, and this handler used to
                // unconditionally clobber it a moment later, hiding the real cause.
                setAgentStatus('error')
                setAgentError((prev) => prev || 'Hume EVI WebSocket dropped and could not reconnect after 6 attempts.')
                setConnectionError((prev) => prev || 'Hume EVI WebSocket dropped and could not reconnect after 6 attempts.')
              }
            },
            onError: (message) => {
              console.error('[Walkthrough/Hume] Error:', message)
              setAgentStatus('error')
              setAgentError(message.slice(0, 200))
              setConnectionError(message)
            },
            onModeChange: (mode) => {
              console.log('[Walkthrough/Hume] Mode:', mode)
              setAgentStatus(mode)
            },
            onMessage: (text, source) => {
              console.log(`[Walkthrough/Hume] Message [${source}]:`, text.slice(0, 120))
              // Silence handling: reset on Clio speaking too, so the escalation
              // only fires during genuine two-sided silence, never while she's
              // mid-monologue.
              if (source === 'ai') {
                lastEitherSpokeRef.current = Date.now()
                checkinSentAtRef.current = null
              }
              if (source === 'ai') {
                // NAV command processing — same logic as ElevenLabs path
                const { navCommand } = parseNavCommand(text)
                if (navCommand !== null) {
                  if (currentSectionIndexRef.current === 0) {
                    console.log(`[Walkthrough/Hume] NAV "${navCommand}" ignored — overview section`)
                  } else {
                    const sectionKey = String(currentSectionIndexRef.current)
                    const manifest = tabManifestsRef.current?.[sectionKey]
                    if (manifest && manifest.tabs.length >= 2) {
                      const newIndex = resolveNavIndex(navCommand, manifest.tabs, activeTabIndexRef.current)
                      activeTabIndexRef.current = newIndex
                      setActiveTabIndex(newIndex)
                    }
                  }
                }
                // Farewell detection — skip the first AI message (opening
                // greeting) and use word-boundary matching (see isFarewellMessage).
                const isFirstAiMessage = aiMessageCountRef.current === 0
                aiMessageCountRef.current += 1
                if (isFarewellMessage(text, isFirstAiMessage)) {
                  console.log('[Walkthrough/Hume] Farewell detected in agent speech — marking session ended')
                  sessionEndedRef.current = true
                  setSessionComplete(true)
                  endCallOnServer(userId, auditTokenRef.current)
                }
              }
            },
            tools: {
              show_visual: async (params) => {
                const section_index = params.section_index as number | undefined
                const topic_id = params.topic_id as string | undefined
                const topic_title = params.topic_title as string | undefined
                console.log('[Walkthrough/Hume] show_visual — section_index:', section_index)
                try {
                  const sections = sectionsRef.current
                  if (sections.length > 0) {
                    let idx: number
                    if (typeof section_index === 'number') {
                      idx = section_index
                    } else {
                      idx = sections.findIndex((s) => s.meta.subtopicTitle === topic_title)
                    }
                    if (idx < 0) idx = Math.max(0, currentSectionIndexRef.current)
                    else if (idx >= sections.length) idx = sections.length - 1

                    if (idx >= 0) {
                      const splitCtxMode = process.env.NEXT_PUBLIC_CLIO_CONTEXT_MODE ?? 'all-upfront'
                      if (splitCtxMode === 'split' && idx > 0) {
                        const scriptIndex = idx - 1
                        const tabScript = trainingScriptsRef.current[scriptIndex] ?? null
                        const tabSection = sections[idx] ?? null
                        const formattedScript = tabScript && tabSection
                          ? formatSectionScript(tabSection, tabScript, idx, sections.length - 1)
                          : '[Context for this section is loading — coach from the TOPIC KNOWLEDGE BASE for now.]'
                        try { adapterRef.current?.injectContext(formattedScript) } catch { /* noop */ }
                      }

                      await fetch(`/api/walkthrough-state/${userId}`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ command: 'scroll_to', section_index: idx }),
                      })

                      const script = trainingScriptsRef.current[idx]
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
                  const fallbackTopicId = topic_id ?? `section-${section_index ?? 0}`
                  const fallbackTopicTitle = topic_title ?? `Section ${(section_index ?? 0) + 1}`
                  const res = await fetch('/api/generate-visual', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ userId, topicId: fallbackTopicId, topicTitle: fallbackTopicTitle }),
                  })
                  const data = await res.json() as { ok: boolean }
                  return data.ok ? 'Visual is now showing on screen.' : 'Visual could not be loaded.'
                } catch {
                  return 'Visual failed to load.'
                }
              },
              end_session: async () => {
                console.log('[Walkthrough/Hume] end_session called')
                sessionEndedRef.current = true
                setSessionComplete(true)
                endCallOnServer(userId, auditTokenRef.current)
                return 'Session ended.'
              },
              // LIVE-01 — registered unconditionally (a no-op tool if the model
              // never calls it), so the handler map shape doesn't change based
              // on the toggle. The actual tab-advance + visual generation work
              // happens server-side in the bridge route; this client only
              // acknowledges the call and later picks up the result via polling
              // (see applyLiveConductorPoll in the poll effect below).
              advance_tab: createAdvanceTabToolHandler(),
            },
          })

          if (cancelled) { await hume.endSession(); return }
          hasConnectedRef.current = true
          adapterRef.current = hume
          lastActivityRef.current = Date.now()

          // AUTOGEN-01 Part D / AC-D1 — billing starts here, and only here: once
          // BOTH onConnect (chat_metadata) and the first assistant_message/speaking
          // event have occurred (enforced inside HumeAdapter). Written at most once
          // per session lifetime regardless of reconnects.
          hume.onSpeakVerified(() => {
            if (!speakVerifiedWrittenRef.current) {
              speakVerifiedWrittenRef.current = true
              writeAuditEvent(userId, 'speak_verified', auditTokenRef.current, 'hume')
            }
          })

          if (botView) {
            if (isReconnect || isMidSession) {
              setBotViewReady(true)
            } else {
              setTimeout(() => setBotViewReady(true), 3000)
            }
          }

          // Hume: do NOT call injectContext on reconnect — it sends session_settings.system_prompt
          // which Hume rejects with E0716 (1008 close) when a custom LLM is configured.
          // Reconnect context is handled server-side by the custom LLM endpoint.
          console.log('[Walkthrough/Hume] Session started — userId:', userId, '| reconnect:', isReconnect, '| midSession:', isMidSession)
          return // skip ElevenLabs path
        }
        // ── END HUME path ─────────────────────────────────────────────────────

        const topic = topicRef.current
        const nameGreet = userFirstName ? `Welcome, ${userFirstName}! ` : ''
        const greeting = topic
          ? `${nameGreet}I'm Clio, your AI learning companion. Today we're covering "${topic}". I've prepared everything — let's dive straight in. Ready?`
          : `${nameGreet}I'm Clio, your AI learning companion. I'm here and ready to coach you. Let's get started.`

        // Custom LLM mode: the full session context (41k chars) lives server-side at
        // /api/clio/llm. We pass only the userId so the endpoint knows which user's
        // context to fetch from walkthrough_state. No size limit issues.
        // AGENT-POOL-01: use pool-assigned agent when available, else env var default
        const conv = await Conversation.startSession({
          agentId: state.agent_id ?? AGENT_ID,
          connectionType: 'websocket',
          dynamicVariables: { user_id: userId },
          overrides: {
            agent: {
              // Minimal prompt — just the userId marker. The custom LLM endpoint
              // at /api/clio/llm fetches the real 41k context from the DB each turn.
              prompt: { prompt: `You are Clio, an AI business coach. DISTILL_USER_ID: ${userId}` },
              // Suppress greeting on any reconnect (same-page WS drop OR Attendee bot reload)
              firstMessage: (isReconnect || isMidSession) ? '' : greeting,
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
              endCallOnServer(userId, auditTokenRef.current)
              return 'Session ended.'
            },
            show_visual: async ({
              section_index,
              topic_id,
              topic_title,
            }: {
              section_index?: number
              topic_id?: string
              topic_title?: string
            }) => {
              console.log('[Walkthrough] show_visual called — section_index:', section_index, 'title:', topic_title ?? '(none)')
              try {
                // New flow: find matching section and scroll to it
                const sections = sectionsRef.current
                if (sections.length > 0) {
                  // Primary: use section_index directly (reliable, title-independent).
                  // Fallback: exact string match on subtopicTitle for backwards compat
                  // with older scripts that did not emit section_index.
                  let idx: number
                  if (typeof section_index === 'number') {
                    idx = section_index
                  } else {
                    // Backwards-compat exact match — no fuzzy matching
                    idx = sections.findIndex(
                      (s) => s.meta.subtopicTitle === topic_title
                    )
                  }
                  // Bounds check: clamp idx to a valid range rather than falling through
                  // to the legacy generate-visual path with an undefined section.
                  if (idx < 0) {
                    // Title not matched and no index given — show the current section.
                    idx = Math.max(0, currentSectionIndexRef.current)
                    console.log(`[Walkthrough] show_visual: idx resolved to -1, clamping to current section ${idx}`)
                  } else if (idx >= sections.length) {
                    idx = sections.length - 1
                    console.log(`[Walkthrough] show_visual: idx ${section_index} out of bounds, clamping to ${idx}`)
                  }
                  if (idx >= 0) {
                    // Split-mode: inject this tab's script before scrolling to it.
                    // idx > 0 because overview (idx=0) has no training script.
                    const splitCtxMode = process.env.NEXT_PUBLIC_CLIO_CONTEXT_MODE ?? 'all-upfront'
                    if (splitCtxMode === 'split' && idx > 0) {
                      const scriptIndex = idx - 1  // section_index 1 → training_scripts[0]
                      const allScripts = trainingScriptsRef.current
                      const tabScript = allScripts[scriptIndex] ?? null
                      const tabSection = sections[idx] ?? null
                      const formattedScript = tabScript && tabSection
                        ? formatSectionScript(tabSection, tabScript, idx, sections.length - 1)
                        : '[Context for this section is loading — coach from the TOPIC KNOWLEDGE BASE for now.]'
                      try {
                        adapterRef.current?.injectContext(formattedScript)
                        console.log(`[split mode] Tab ${idx} script injected at show_visual section_index=${idx}${!tabScript ? ' (fallback — not ready)' : ''}`)
                      } catch (e) {
                        console.error(`[split mode] injectContext failed at section_index=${idx}:`, e)
                      }
                    }

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
                // Legacy fallback: generate a VisualSpec and display it.
                // topic_id and topic_title are optional in the show_visual schema —
                // guard against undefined so /api/generate-visual never receives an
                // empty topicId that fails Zod validation.
                const fallbackTopicId = topic_id ?? `section-${section_index ?? 0}`
                const fallbackTopicTitle = topic_title ?? `Section ${(section_index ?? 0) + 1}`
                const res = await fetch('/api/generate-visual', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ userId, topicId: fallbackTopicId, topicTitle: fallbackTopicTitle }),
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
            // LIVE-01 — same additive, unconditional registration as the Hume
            // path above; see that comment for why this is safe to register
            // even when the toggle is off (server-side model prompt never
            // instructs calling this tool unless the live-conductor branch is
            // active, so it is simply never invoked in the default path).
            advance_tab: createAdvanceTabToolHandler(),
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
            // AUTOGEN-01 Part D / Edge Case D2 — a successful reconnect after
            // billing had already started closes any open gap.
            if (gapOpenRef.current) {
              gapOpenRef.current = false
              writeAuditEvent(userId, 'gap_end', auditTokenRef.current, 'elevenlabs')
            }
          },
          onDisconnect: () => {
            console.log('[Walkthrough] Agent disconnected')
            adapterRef.current = null
            elevenLabsConvRef.current = null
            setAgentStatus('disconnected')

            // AUTOGEN-01 Part D / Edge Case D2 — only a genuine gap if billing had
            // already started; a disconnect before speak_verified is just a failed
            // connection attempt (AC-D3 covers that with zero billed minutes).
            if (speakVerifiedWrittenRef.current && !gapOpenRef.current && !sessionEndedRef.current) {
              gapOpenRef.current = true
              writeAuditEvent(userId, 'gap_start', auditTokenRef.current, 'elevenlabs')
            }

            if (sessionEndedRef.current) {
              console.log('[Walkthrough] Session ended by agent — not reconnecting')
              return
            }

            if (!cancelled && reconnectAttemptsRef.current < MAX_RECONNECT) {
              reconnectAttemptsRef.current++
              setRetryCount(reconnectAttemptsRef.current)
              console.log('[walkthrough] WebSocket reconnect attempt', reconnectAttemptsRef.current, '| userId recovered:', !!userId, '| timestamp:', new Date().toISOString())
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
            // Silence handling: reset on Clio speaking too, so the escalation
            // only fires during genuine two-sided silence, never while she's
            // mid-monologue.
            if (source === 'ai') {
              lastEitherSpokeRef.current = Date.now()
              checkinSentAtRef.current = null
            }
            if (source === 'ai') {
              // ── NAV command processing ─────────────────────────────────────
              // Strip [NAV:...] from the spoken text and fire tab navigation.
              // The clean text was already sent to TTS server-side by /api/clio/llm;
              // here we act on the command to update the visible tab index.
              const { navCommand } = parseNavCommand(message)
              if (navCommand !== null) {
                if (currentSectionIndexRef.current === 0) {
                  // Overview section (section 0) — ignore NAV directives to prevent
                  // premature tab advances while Clio is still on the overview.
                  console.log(`[Walkthrough] NAV command "${navCommand}" ignored — overview section (section 0)`)
                } else {
                  const sectionKey = String(currentSectionIndexRef.current)
                  const manifest = tabManifestsRef.current?.[sectionKey]
                  if (manifest && manifest.tabs.length >= 2) {
                    const newIndex = resolveNavIndex(navCommand, manifest.tabs, activeTabIndexRef.current)
                    activeTabIndexRef.current = newIndex
                    setActiveTabIndex(newIndex)
                    console.log(`[Walkthrough] NAV command "${navCommand}" → tab index ${newIndex}`)
                  } else {
                    console.log(`[Walkthrough] NAV command "${navCommand}" ignored — no tab manifest for section ${sectionKey}`)
                  }
                }
              }

              // ── Farewell detection ─────────────────────────────────────────
              // Skip the first AI message (opening greeting) and use
              // word-boundary matching (see isFarewellMessage above).
              const isFirstAiMessage = aiMessageCountRef.current === 0
              aiMessageCountRef.current += 1
              if (isFarewellMessage(message, isFirstAiMessage)) {
                console.log('[Walkthrough] Farewell detected in agent speech — marking session ended')
                sessionEndedRef.current = true
                setSessionComplete(true)
                endCallOnServer(userId, auditTokenRef.current)
              }
            }
          },
          onStatusChange: ({ status }: { status: string }) => {
            console.log('[Walkthrough] Agent status:', status)
          },
        })

        if (cancelled) { conv.endSession().catch(() => {}); return }
        hasConnectedRef.current = true
        elevenLabsConvRef.current = conv
        adapterRef.current = createVoiceAdapter('elevenlabs', conv)
        lastActivityRef.current = Date.now()

        // AUTOGEN-01 Part D / AC-D1 — billing starts here, and only here: once the
        // adapter confirms a verified `isOpen()` transition. Written at most once
        // per session lifetime regardless of reconnects.
        adapterRef.current.onSpeakVerified(() => {
          if (!speakVerifiedWrittenRef.current) {
            speakVerifiedWrittenRef.current = true
            writeAuditEvent(userId, 'speak_verified', auditTokenRef.current, 'elevenlabs')
          }
        })

        // Bot view warmup: on first join, delay revealing content for 3s so Attendee's
        // headless browser screen capture has time to stabilise. On reconnects the
        // stream is already running — reveal immediately.
        if (botView) {
          if (isReconnect || isMidSession) {
            setBotViewReady(true)
          } else {
            setTimeout(() => setBotViewReady(true), 3000)
          }
        }

        const contextMode = process.env.NEXT_PUBLIC_CLIO_CONTEXT_MODE ?? 'all-upfront'

        if (isReconnect || isMidSession) {
          const section = currentSectionIndexRef.current
          adapterRef.current.injectContext(
            isReconnect
              ? 'The WebSocket connection briefly dropped and reconnected. Do not re-introduce yourself — continue the session naturally from where you left off.'
              : `You are resuming a session that was briefly interrupted (the bot reconnected). The participant is already on section ${section} of the session — do NOT restart from the overview or re-introduce yourself. Call show_visual({ section_index: ${section} }) and continue from where you left off.`
          )
        } else if (contextMode === 'split') {
          // Inject Tab 1 script immediately — overview is section 0, first content tab is section 1
          const tab1Script = trainingScriptsRef.current[0] ?? null
          const sections = sectionsRef.current
          const tab1Section = sections[1] ?? null
          if (tab1Script && tab1Section) {
            const formatted = formatSectionScript(tab1Section, tab1Script, 1, sections.length - 1)
            try {
              adapterRef.current.injectContext(formatted)
              console.log('[split mode] Tab 1 script injected at session start')
            } catch (e) {
              console.error('[split mode] injectContext failed at session start:', e)
            }
          } else {
            console.log('[split mode] Tab 1 script not ready at session start — skipping initial injection')
          }
        }

        console.log(
          '[Walkthrough]',
          isReconnect ? 'Reconnected — server-side context persists' : `Session started — context fetched by custom LLM for user=${userId} (mode=${contextMode})`
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
      adapterRef.current?.endSession().catch(() => {})
      adapterRef.current = null
      elevenLabsConvRef.current = null
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
        if (data.tab_manifests !== undefined) tabManifestsRef.current = data.tab_manifests ?? null
        currentSectionIndexRef.current = data.current_section_index ?? 0
        if (data.session_brief) sessionBriefRef.current = data.session_brief
        if (data.topic_context) topicContextRef.current = data.topic_context
        if (data.session_script) sessionScriptRef.current = data.session_script
        if (data.clio_session_context) clioSessionContextRef.current = data.clio_session_context
        // SECURITY: /api/walkthrough-state/[userId] intentionally strips audit_token
        // from its response (that endpoint is public/unauthenticated), so this is
        // normally a no-op — auditTokenRef is set once, from initialState/auditToken
        // at mount. Kept defensive in case a future authenticated-only variant of
        // this poll route legitimately includes it.
        if (data.audit_token !== undefined) auditTokenRef.current = data.audit_token ?? null

        // HUME-NATIVE-01 (Graceful Session End) — relay the server-set
        // hume_wrapup_nudge_pending flag to Clio over the already-open Hume
        // WebSocket. Only ever relevant for Hume-native sessions: the flag is
        // never written to true by session-timer.ts for any other session
        // type, and the adapter check below additionally requires a
        // HumeAdapter instance, so this is a no-op for ElevenLabs and Hume
        // Custom-LLM/LIVE-01 sessions even if somehow polled.
        if (!data.hume_wrapup_nudge_pending) {
          // Flag is false/absent — reset the once-per-flag retry tracker so a
          // future nudge (should not normally happen twice per session, but
          // defensive) gets its own fresh single-retry attempt.
          humeWrapupNudgeRetriedRef.current = false
        } else if (HUME_NATIVE_ENABLED && adapterRef.current instanceof HumeAdapter) {
          const humeAdapter = adapterRef.current
          const clearNudgeFlag = () => {
            fetch(`/api/walkthrough-state/${userId}`, {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ clear: 'hume_wrapup_nudge_pending' }),
            }).catch(() => {})
          }

          if (humeAdapter.isOpen()) {
            const sent = humeAdapter.sendWrapUpNudge(HUME_WRAPUP_NUDGE_TEXT)
            if (sent) {
              console.log('[Walkthrough/Hume] Wrap-up nudge sent')
              humeWrapupNudgeRetriedRef.current = false
              clearNudgeFlag()
            } else if (!humeWrapupNudgeRetriedRef.current) {
              // One immediate retry (Section 8 / Section 4, State 4).
              humeWrapupNudgeRetriedRef.current = true
              const retrySent = humeAdapter.sendWrapUpNudge(HUME_WRAPUP_NUDGE_TEXT)
              console.log('[Walkthrough/Hume] Wrap-up nudge retry', retrySent ? 'succeeded' : 'failed — giving up silently')
              clearNudgeFlag()
            } else {
              // Retry already attempted for this flag occurrence and also
              // failed — give up silently, no further retries, no
              // user-visible error. The flag stays true only if the clear
              // call above also failed; the backstop fires regardless.
              console.warn('[Walkthrough/Hume] Wrap-up nudge failed after retry — relying on session-timer backstop')
            }
          } else if (!humeWrapupNudgeRetriedRef.current) {
            // Adapter not currently open (e.g. mid-reconnect) — treat as a
            // failed send. One retry on the next poll cycle only, per spec;
            // if still not open by the time the backstop's grace window
            // elapses, the backstop fires regardless. Do NOT clear the flag
            // here — it must persist so a reconnecting client still sees it.
            humeWrapupNudgeRetriedRef.current = true
            console.warn('[Walkthrough/Hume] Wrap-up nudge pending but adapter not open — will retry next poll only')
          }
        }

        // LIVE-01 — only reads/writes liveConductorRef (its own isolated state
        // object) and only when the toggle is on. When off, this block never
        // runs and liveConductorRef stays at its initial no-op value.
        if (isLiveConductorEnabledClient()) {
          applyLiveConductorPoll(liveConductorRef.current, {
            live_conductor_tab_index: data.live_conductor_tab_index,
            live_conductor_visual: data.live_conductor_visual,
          })
          setLiveConductorVisual(liveConductorRef.current.visual)
        }

        // elevenLabsConvRef used for sendUserMessage (ElevenLabs-specific transcript forwarding)
        const conv = elevenLabsConvRef.current

        // Feed participant transcript to agent — debounced to prevent cascade.
        // Recall.ai fires transcript.data events every 100-300ms while someone speaks.
        // Without debouncing, each partial fires a separate LLM call → 6+ second cascade.
        // We buffer the latest transcript and only send after 500ms of no new updates,
        // ensuring one LLM call per utterance rather than one per partial word chunk.
        const transcript = data.pending_transcript
        // Silence handling: any new transcript content means the user spoke —
        // reset the shared "either side spoke" clock for BOTH providers (Hume's
        // user speech also arrives via this same pending_transcript field from
        // Recall.ai transcription, even though Hume forwards it server-side
        // rather than via elevenLabsConvRef/sendUserMessage below).
        if (transcript && transcript !== lastSentTranscriptRef.current) {
          lastEitherSpokeRef.current = Date.now()
          checkinSentAtRef.current = null
        }
        if (transcript && transcript !== lastSentTranscriptRef.current && conv && !sessionEndedRef.current) {
          // Skip very short transcripts while Clio is speaking — filler words ("mm", "ok",
          // "yeah") picked up during TTS should not interrupt or queue a new LLM call.
          const wordCount = transcript.trim().split(/\s+/).length
          const currentMode = agentStatus
          if (wordCount < 3 && (currentMode === 'speaking')) {
            // Too short to act on while Clio is talking — clear it from DB and skip
            if (transcript !== lastSentTranscriptRef.current) {
              fetch(`/api/walkthrough-state/${userId}`, { method: 'PATCH' }).catch(() => {})
            }
          } else {
            // Always buffer the latest (may be longer than the previous partial)
            pendingTranscriptRef.current = transcript

            // Reset debounce timer — fires 500ms after the last transcript update
            if (sendTranscriptTimerRef.current) clearTimeout(sendTranscriptTimerRef.current)
            sendTranscriptTimerRef.current = setTimeout(() => {
              const toSend = pendingTranscriptRef.current
              const convNow = elevenLabsConvRef.current
              if (!toSend || !convNow || toSend === lastSentTranscriptRef.current) return
              lastSentTranscriptRef.current = toSend
              pendingTranscriptRef.current = null
              lastActivityRef.current = Date.now()
              convNow.sendUserMessage(toSend)
              console.log('[Walkthrough] Sent to agent (debounced):', toSend.slice(0, 80))
              fetch(`/api/walkthrough-state/${userId}`, { method: 'PATCH' }).catch(() => {})
            }, 500)
          }
        }

        // Keep-alive: prevent ElevenLabs inactivity disconnect when user is silent
        if (adapterRef.current && Date.now() - lastActivityRef.current > KEEPALIVE_INTERVAL) {
          lastActivityRef.current = Date.now()
          adapterRef.current.injectContext('Session is ongoing. Participant may be listening.')
          console.log('[Walkthrough] Keep-alive sent')
        }

        // ─── Silence / no-response escalation (two-stage) ───────────────────
        // Applies generally after Clio finishes speaking (and equally after the
        // user speaks) — not narrowly scoped to "after a detected question".
        // The clock resets whenever EITHER side speaks (see resets above and
        // in both onMessage handlers), so this only escalates during genuine
        // two-sided silence, never mid-monologue.
        if (adapterRef.current && !sessionEndedRef.current) {
          const now = Date.now()
          if (checkinSentAtRef.current === null) {
            // Stage 1: no activity from either side for SILENCE_CHECKIN_MS —
            // nudge Clio to check in naturally, via the same injectContext
            // mechanism used for keep-alives above (no new injection pathway).
            if (now - lastEitherSpokeRef.current > SILENCE_CHECKIN_MS) {
              checkinSentAtRef.current = now
              adapterRef.current.injectContext(
                'The participant has been silent for a while. Naturally check in with them in one short sentence — e.g. ask if they\'re still there or still with you — then wait for their response. Do not repeat this if they already responded.'
              )
              console.log('[Walkthrough] Silence check-in sent')
            }
          } else if (now - checkinSentAtRef.current > SILENCE_END_CALL_MS) {
            // Stage 2: still silent SILENCE_END_CALL_MS after the check-in —
            // end the session gracefully via the existing end-call mechanism,
            // framed as a possible technical/audio issue (not the user being
            // unresponsive).
            console.log('[Walkthrough] No response after check-in — ending session (assumed audio/technical issue)')
            sessionEndedRef.current = true
            setSessionComplete(true)
            try {
              adapterRef.current.injectContext(
                'It seems there may be a technical issue with the participant\'s audio or connection — say a brief, friendly line acknowledging this (assume a technical difficulty, not that they are ignoring you) and that the session will end for now, then stop.'
              )
            } catch { /* noop — non-fatal, end-call proceeds regardless */ }
            endCallOnServer(userId, auditTokenRef.current)
          }
        }
      } catch (err) {
        if (active) setPollError(String(err).slice(0, 30))
      }
    }

    poll()
    const interval = setInterval(poll, 2000)
    return () => { active = false; clearInterval(interval) }
  }, [userId])

  const status = state.status ?? 'idle'
  const spec = state.visual_spec
  const hasSections = (state.sections?.length ?? 0) > 0

  // Derive the tab manifest for the currently active section (if any)
  const currentSectionIdx = state.current_section_index ?? 0
  const currentTabManifest: TabManifest | null =
    state.tab_manifests?.[String(currentSectionIdx)] ?? null
  const shouldShowTabPanel = hasSections && currentTabManifest !== null && (currentTabManifest?.tabs.length ?? 0) >= 2

  // The topicId used by VisualizationTabPanel — derived from the current section's meta
  // or falls back to an empty string. Used by KBSessionPreview for data binding.
  const currentSection = state.sections?.[currentSectionIdx] ?? null
  const tabPanelTopicId = currentSection?.meta.subtopicTitle.toLowerCase().replace(/\s+/g, '-') ?? ''

  const agentStatusColor =
    agentStatus === 'listening'    ? 'bg-blue-900/80 text-blue-300' :
    agentStatus === 'speaking'     ? 'bg-green-900/80 text-green-300' :
    agentStatus === 'connecting'   ? 'bg-yellow-900/80 text-yellow-300' :
    agentStatus === 'error'        ? 'bg-red-900/80 text-red-300' :
    'bg-gray-900/80 text-gray-500'

  // LIVE-01 — only true when the toggle is on AND this session actually has a
  // live-conductor tab index reported by the poll (i.e. the pipeline branch in
  // inngest/session-content-pipeline.ts ran for this session). When false, the
  // render tree below falls through entirely to the pre-existing tab
  // panel / session stack / legacy renderer logic, completely unchanged.
  const showLiveConductorVisual =
    isLiveConductorEnabledClient() && typeof state.live_conductor_tab_index === 'number'

  return (
    <div
      ref={containerRef}
      className="min-h-screen w-full bg-[#080808] overflow-hidden relative"
      style={{ position: 'fixed', inset: 0 }}
    >
      {/* Bot view warmup overlay — hides content while Attendee's screen capture initialises.
          Fades out after 3s on first join; skipped entirely on reconnects. */}
      {botView && !botViewReady && (
        <motion.div
          key="bot-warmup"
          initial={{ opacity: 1 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.5 }}
          className="absolute inset-0 z-50 bg-[#080808]"
        />
      )}

      {/* Mobile landscape prompt — shown when device is in portrait orientation */}
      {showLandscapePrompt && (
        <div className="fixed inset-0 z-50 bg-[#080808] flex flex-col items-center justify-center gap-6 p-8">
          <div className="text-6xl">↻</div>
          <h2 className="text-2xl font-bold text-white text-center">Rotate to landscape</h2>
          <p className="text-[#94A3B8] text-center text-base">
            Turn your phone sideways for the best session experience.
          </p>
          <button
            onClick={() => setShowLandscapePrompt(false)}
            className="mt-4 px-6 py-3 rounded-xl border border-[#333333] text-[#94A3B8] text-sm hover:text-white hover:border-[#555555] transition-colors"
          >
            Continue anyway
          </button>
        </div>
      )}

      {/* LIVE-01 — live conductor visual, shown only when the toggle is on and
          this session has live-conductor state. Renders LiveConductorVisual
          (a new, separate component — not any of the 22 template renderers)
          with whatever visual is currently in walkthrough_state.live_conductor_visual
          (null = text-only fallback, handled inside the component itself).
          When this branch is active it takes over the whole screen and the
          existing tab-panel / session-stack / legacy renderer below are never
          reached for this render (mutually exclusive via early return in JSX). */}
      {showLiveConductorVisual ? (
        <div className="absolute inset-0 flex flex-col">
          <LiveConductorVisual
            data={liveConductorVisual}
            tabTitle={state.topic_title ?? 'Live session'}
          />
        </div>
      ) : (
        <>
      {/* VisualizationTabPanel — shown when the active section has a tab manifest with 2+ tabs */}
      {shouldShowTabPanel && currentTabManifest && (
        <div className="absolute inset-0 flex flex-col">
          <VisualizationTabPanel
            tabs={currentTabManifest.tabs}
            activeIndex={activeTabIndex}
            onTabChange={(idx) => {
              activeTabIndexRef.current = idx
              setActiveTabIndex(idx)
            }}
            topicId={tabPanelTopicId}
          />
        </div>
      )}

      {/* Template-based session stack — shown when sections exist but no tab manifest for active section */}
      {hasSections && !shouldShowTabPanel && state.sections && (
        <SessionStack
          sections={state.sections}
          currentSectionIndex={state.current_section_index ?? 0}
          userId={userId}
          botView={botView}
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
        </>
      )}

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
