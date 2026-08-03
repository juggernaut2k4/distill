'use client'

import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import Link from 'next/link'
import type { DemoTopic } from '../_content'
import {
  pageStyle,
  navStyle,
  brandStyle,
  brandMarkStyle,
  containerStyle,
  heroTitleStyle,
  pillRowStyle,
  pillStyle,
  actionBarStyle,
  primaryButtonStyle,
  secondaryButtonStyle,
  aiButtonStyle,
  tabRowStyle,
  tabStyle,
  chapterListStyle,
  chapterRowStyle,
  chapterMarkerStyle,
  chapterTitleStyle,
  chapterBodyStyle,
  codeBlockStyle,
  listStyle,
  meetingInputStyle,
  meetingFieldWrapStyle,
  meetingLabelStyle,
  demoLabelStyle,
  COLORS,
} from '../_styles'

const TABS = ['Course Overview', 'Transcript', 'Visuals', 'Resources', 'Discussion', 'Meeting', 'Widget Demo', 'Learning Check', 'Performance'] as const
type Tab = (typeof TABS)[number]

// B2B-34 Piece 1 (docs/specs/B2B-34-requirement-document.md Part C §6.2) — mirrors the API route's own
// PerformanceResponse contract (app/api/demo/[slug]/performance/route.ts). Duplicated rather than
// shared across a client/server boundary import, matching this codebase's existing convention of
// inline response-shape types in client components (see the meeting_url fetch above).
type PerformanceSessionState = 'not_dispatched' | 'in_progress' | 'pending_extraction' | 'extraction_failed' | 'ready'

interface PerformanceLearnerInsight {
  summary: string
  topics_of_interest: string[]
  engagement_style: string
  suggested_next_topics: string[]
}

// B2B-57a (feature-briefs/B2B-57a) — mirrors the API route's own PerformanceUsage contract. Demo-only
// usage.voice_minute field group; `mode` is derived from the payload's test_mode boolean only (the
// brief's text mentions a `live_mode` field that does not actually exist on WebhookPayload).
interface PerformanceUsage {
  minutes_billed: string | null
  generation_type: string | null
  mode: 'Live' | 'Test'
  event_id: string
  recorded_at: string
}

// B2B-65 (docs/specs/B2B-65-requirement-document.md §6.4) — one accumulated, permanently-visible
// past demo session's outcome. No Duration/Usage per entry (spec §6.4's explicit scope cut).
// B2B-65 tabular-format amendment (docs/specs/B2B-65-tabular-performance-format-amendment-
// requirement-document.md §6.2) — widened to mirror the API route's own widened PerformanceEntry
// (all 18 real partner_session_insights columns) per Arun's explicit "display everything in this
// table" instruction — a knowing, time-boxed exception, see §9 for the tracked removal commitment.
interface PerformanceEntry {
  id: string
  partner_session_id: string
  partner_account_id: string
  end_client_id: string | null
  reseller_unique_id: string | null
  hume_chat_id: string | null
  hume_config_id: string | null
  extraction_status: 'pending' | 'success' | 'success_empty' | 'failed'
  attempt_count: number
  error_message: string | null
  transcript_event_count: number | null
  full_detail_purged_at: string | null
  created_at: string
  demo_performance_visible: boolean
  glitches: { type: string; description: string | null }[]
  extracted_at: string | null
  action_items: { text: string }[]
  summary: string | null
  topics_of_interest: string[]
  engagement_style: string | null
  suggested_next_topics: string[]
}

interface PerformanceResponse {
  session_state: PerformanceSessionState
  duration_minutes: number | null
  action_items: { text: string }[] | null
  learner_insight: PerformanceLearnerInsight | null
  usage: PerformanceUsage | null
  entries: PerformanceEntry[]
}

/** Dimmed heading/body pair for the Performance tab's non-ready states — same COLORS.textMuted-based
 * dimming convention already used for this page's other empty-state tabs (Resources/Discussion/Learning
 * Check), matching the Meeting tab's own dimmed/disabled visual language for "nothing here yet." */
const perfEmptyHeadingStyle = { fontSize: 18, fontWeight: 700, color: COLORS.textMuted, margin: '24px 0 8px 0' } as const
const perfEmptyBodyStyle = { fontSize: 14, color: COLORS.textMuted, lineHeight: 1.6, margin: 0 } as const

// B2B-51 (docs/specs/B2B-51-requirement-document.md §6.1/§6.4) — Performance tab "ready" state: a
// literal Field/Value table, replacing the prior narrative layout. Each row is its own flex container
// that reflows (Field cell above Value cell) via CSS flex-wrap once the viewport can't fit both
// columns side by side — no JS breakpoint detection, no media queries, and deliberately no
// `overflowX: 'auto'` (this file's existing horizontal-scroll pattern for codeBlockStyle/tabRowStyle):
// this content wraps/grows vertically (prose + bulleted lists), not sideways.
const perfTableWrapperStyle = { marginTop: 'clamp(20px, 3vw, 28px)' } as const

const perfTableRowStyle = {
  display: 'flex',
  flexWrap: 'wrap',
  gap: '6px 20px',
  padding: 'clamp(10px, 1.6vw, 14px) 0',
  borderBottom: `1px solid ${COLORS.border}`,
} as const

const perfTableHeaderCellStyle = {
  ...demoLabelStyle,
  marginBottom: 0,
} as const

const perfTableFieldCellStyle = {
  ...demoLabelStyle,
  color: COLORS.textMuted,
  marginBottom: 0,
  flexBasis: 'clamp(100px, 22%, 170px)',
  minWidth: 100,
  flexShrink: 0,
} as const

const perfTableValueCellStyle = {
  ...chapterBodyStyle,
  marginBottom: 0,
  flex: '1 1 260px',
  minWidth: 0,
} as const

const perfTableListStyle = {
  ...listStyle,
  margin: 0,
} as const

const perfTableMutedStyle = { color: COLORS.textMuted } as const

// B2B-65 — one bordered wrapper + timestamp heading per accumulating entry card. Same
// clamp()-based spacing convention as perfTableWrapperStyle/perfTableRowStyle (§9) — no fixed
// pixel widths, each card is just another stacked instance of the already-responsive row block.
const perfEntryCardStyle = {
  marginBottom: 'clamp(20px, 3vw, 28px)',
  paddingBottom: 'clamp(20px, 3vw, 28px)',
  borderBottom: `1px solid ${COLORS.border}`,
} as const

const perfEntryTimestampStyle = {
  ...demoLabelStyle,
  color: COLORS.textMuted,
  marginBottom: 'clamp(8px, 1.2vw, 12px)',
} as const

const perfEntriesProcessingNoteStyle = {
  fontSize: 13,
  color: COLORS.textMuted,
  marginBottom: 'clamp(12px, 2vw, 16px)',
} as const

// B2B-57a — lightweight section label for the new "Usage" row group. The existing table has no prior
// sub-heading precedent between its Duration row and its learner-insight rows (confirmed by reading
// the render block below — it's one flat row list), so this reuses the same label typography/muted
// color tokens as the rest of the tab (demoLabelStyle + COLORS.textMuted) rather than inventing new
// visual language, just to give this additive block a visible boundary.
const perfTableSectionLabelStyle = {
  ...demoLabelStyle,
  color: COLORS.textMuted,
  marginTop: 'clamp(16px, 2.4vw, 22px)',
  marginBottom: 0,
} as const

// B2B-65 tabular-format amendment (docs/specs/B2B-65-tabular-performance-format-amendment-
// requirement-document.md §6.3/§6.4) — literal <table> replacing the card/Field-Value stack for the
// accumulating entries list. New, page-local style constants — none of the perfTable* constants
// above are removed or modified, since the unrelated "ready + 0 entries" single-latest-session
// table (above) keeps using them unchanged.
const DEMO_PERFORMANCE_TABLE_DISPLAY_LIMIT = 3

const perfEntriesScrollWrapperStyle = { overflowX: 'auto', marginTop: 'clamp(20px, 3vw, 28px)' } as const

const perfEntriesCaptionStyle = { fontSize: 13, color: COLORS.textMuted, marginBottom: 8 } as const

const perfEntriesTableStyle = { width: '100%', borderCollapse: 'collapse', fontSize: 13 } as const

const perfEntriesThStyle = {
  textAlign: 'left',
  color: COLORS.textSecondary,
  fontWeight: 600,
  padding: '8px 12px',
  borderBottom: `1px solid ${COLORS.border}`,
  whiteSpace: 'nowrap',
} as const

const perfEntriesTdStyle = {
  padding: '8px 12px',
  borderBottom: `1px solid ${COLORS.border}`,
  color: COLORS.textPrimary,
  verticalAlign: 'top',
} as const

const perfEntriesMonoTdStyle = { ...perfEntriesTdStyle, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' } as const

/** §6.3 — scalar fields (Duration/Summary/Engagement style): null/empty/missing-parent renders "Not
 * available" in muted color. Each row evaluates its own condition independently (§8/§9) — no row's
 * rendering depends on any other row's data being present. */
function PerfScalarCell({ value }: { value: string | number | null | undefined }) {
  if (value === null || value === undefined || value === '') {
    return <span style={perfTableMutedStyle}>Not available</span>
  }
  return <>{value}</>
}

/** §6.2/§6.3/AT-8 — list fields (Action items/Topics of interest/Suggested next topics): always render
 * as a uniform bulleted list, even for a single item — never collapsed to plain text, never
 * comma-joined, no pills. Null/absent/empty array renders "None identified" in muted color. */
function PerfListCell({ items }: { items: string[] | null | undefined }) {
  if (!items || items.length === 0) {
    return <span style={perfTableMutedStyle}>None identified</span>
  }
  return (
    <ul style={perfTableListStyle}>
      {items.map((item, i) => (
        <li key={i}>{item}</li>
      ))}
    </ul>
  )
}

function PerfTableRow({ field, children }: { field: string; children: ReactNode }) {
  return (
    <div style={perfTableRowStyle}>
      <div style={perfTableFieldCellStyle}>{field}</div>
      <div style={perfTableValueCellStyle}>{children}</div>
    </div>
  )
}

// B2B-65 tabular-format amendment §6.1/§6.3 — one column definition per real
// partner_session_insights field (18 DB columns, learner_insight's 4 sub-fields flattened, 21 total),
// in the fixed order the spec specifies: identifiers first, then operational/diagnostic fields, then
// the toggle flag, then glitches, then the existing 6 content fields last. Single source of truth for
// both the <thead> and every <tr>'s cells — render(null) produces the exact same "Not
// available"/"None identified" placeholder every other column already uses (PerfScalarCell/
// PerfListCell's own null-handling), so State B2's placeholder row needs no separate implementation.
interface EntryColumn {
  header: string
  mono?: boolean
  minWidth?: number
  render: (entry: PerformanceEntry | null) => ReactNode
}

const ENTRY_COLUMNS: EntryColumn[] = [
  { header: 'ID', mono: true, minWidth: 140, render: (e) => <PerfScalarCell value={e?.id ?? null} /> },
  { header: 'Session ID', mono: true, minWidth: 140, render: (e) => <PerfScalarCell value={e?.partner_session_id ?? null} /> },
  { header: 'Partner Account ID', mono: true, minWidth: 140, render: (e) => <PerfScalarCell value={e?.partner_account_id ?? null} /> },
  { header: 'End Client ID', mono: true, minWidth: 140, render: (e) => <PerfScalarCell value={e?.end_client_id ?? null} /> },
  { header: 'Reseller Unique ID', render: (e) => <PerfScalarCell value={e?.reseller_unique_id ?? null} /> },
  { header: 'Hume Chat ID', render: (e) => <PerfScalarCell value={e?.hume_chat_id ?? null} /> },
  { header: 'Hume Config ID', render: (e) => <PerfScalarCell value={e?.hume_config_id ?? null} /> },
  { header: 'Extraction Status', render: (e) => <PerfScalarCell value={e?.extraction_status ?? null} /> },
  { header: 'Attempt Count', render: (e) => <PerfScalarCell value={e?.attempt_count ?? null} /> },
  { header: 'Error Message', render: (e) => <PerfScalarCell value={e?.error_message ?? null} /> },
  { header: 'Transcript Event Count', render: (e) => <PerfScalarCell value={e?.transcript_event_count ?? null} /> },
  { header: 'Full Detail Purged At', render: (e) => <PerfScalarCell value={e?.full_detail_purged_at ? formatSavedAt(e.full_detail_purged_at) : null} /> },
  { header: 'Created At', render: (e) => <PerfScalarCell value={e?.created_at ? formatSavedAt(e.created_at) : null} /> },
  { header: 'Demo Performance Visible', render: (e) => <PerfScalarCell value={e ? (e.demo_performance_visible ? 'Yes' : 'No') : null} /> },
  {
    header: 'Glitches',
    minWidth: 220,
    render: (e) => (
      <PerfListCell items={e?.glitches?.map((g) => (g.description ? `${g.type}: ${g.description}` : g.type)) ?? null} />
    ),
  },
  { header: 'Extracted At', render: (e) => <PerfScalarCell value={e?.extracted_at ? formatSavedAt(e.extracted_at) : null} /> },
  { header: 'Action Items', minWidth: 220, render: (e) => <PerfListCell items={e?.action_items?.map((item) => item.text) ?? null} /> },
  { header: 'Summary', render: (e) => <PerfScalarCell value={e?.summary ?? null} /> },
  { header: 'Topics of Interest', minWidth: 220, render: (e) => <PerfListCell items={e?.topics_of_interest ?? null} /> },
  { header: 'Engagement Style', render: (e) => <PerfScalarCell value={e?.engagement_style ?? null} /> },
  { header: 'Suggested Next Topics', minWidth: 220, render: (e) => <PerfListCell items={e?.suggested_next_topics ?? null} /> },
]

/** Both demo topics now have a full set of static visual pages under /demo/{slug}/visuals/{chapterId}. */
const VISUAL_TOPICS = new Set(['claude-ai', 'oop-fundamentals'])

const VISUAL_BLURBS: Record<string, string> = {
  'what-is-claude': 'What Claude is, and how Constitutional AI trains it.',
  'model-family': 'A capability-vs-speed chart across all four models.',
  'modes-of-interaction': 'Four ways to work with the same underlying models.',
  'choosing-the-right-model': 'A model recommendation for every kind of task.',
  'what-makes-claude-different': 'Four things that consistently set Claude apart.',
  'why-oop': 'Why structuring code around objects pays off as systems grow.',
  'classes-and-objects': 'The blueprint-vs-instance distinction, with real code.',
  'encapsulation': 'Controlling how state can change, with real code.',
  'abstraction': 'Interface vs. implementation, with real code.',
  'inheritance': 'Sharing and specializing behavior, with real code.',
  'polymorphism': 'Same call, different behavior per type, with real code.',
  'oop-in-the-real-world': 'The four pillars together, and where you’ll see them.',
}

function formatSavedAt(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })
}

export default function DemoTopicClient({ topic }: { topic: DemoTopic }) {
  const [activeTab, setActiveTab] = useState<Tab>('Course Overview')

  // B2B-33 — saved meeting URL state, fetched on mount independent of which tab is active
  // (Edge Case 1: the page is statically generated via generateStaticParams, so this cannot be a
  // server-rendered prop — it must be a client fetch, or a newly-saved URL would go stale until
  // the next redeploy).
  const [meetingLoading, setMeetingLoading] = useState(true)
  const [savedMeetingUrl, setSavedMeetingUrl] = useState<string | null>(null)
  const [savedMeetingUpdatedAt, setSavedMeetingUpdatedAt] = useState<string | null>(null)
  // B2B-36 F4 (docs/specs/B2B-36-requirement-document.md §6.8) — saved participant name, fetched
  // alongside the meeting URL.
  const [savedEndUserName, setSavedEndUserName] = useState<string | null>(null)

  // Meeting tab form state.
  const [nameInput, setNameInput] = useState('')
  const [urlInput, setUrlInput] = useState('')
  const [passcodeInput, setPasscodeInput] = useState('')
  const [saving, setSaving] = useState(false)
  const [saveNameError, setSaveNameError] = useState<string | null>(null)
  const [saveUrlError, setSaveUrlError] = useState<string | null>(null)
  const [savePasscodeError, setSavePasscodeError] = useState<string | null>(null)
  const [saveGenericError, setSaveGenericError] = useState<string | null>(null)
  const [saveSuccess, setSaveSuccess] = useState(false)

  // Learn with AI dispatch state. Per the B2B-33 §0a CEO amendment, dispatch is passcode-gated too —
  // clicking "Learn with AI" opens an inline passcode prompt (reusing the Meeting tab's passcode
  // field pattern) rather than dispatching immediately.
  const [dispatching, setDispatching] = useState(false)
  const [dispatchSucceeded, setDispatchSucceeded] = useState(false)
  const [dispatchErrorMessage, setDispatchErrorMessage] = useState<string | null>(null)
  const [showDispatchPasscode, setShowDispatchPasscode] = useState(false)
  const [dispatchPasscodeInput, setDispatchPasscodeInput] = useState('')
  const [dispatchPasscodeError, setDispatchPasscodeError] = useState<string | null>(null)

  // B2B-70 (docs/specs/B2B-70-requirement-document.md §6.8/§6.9) — Widget Demo tab state. Wholly
  // separate from the Meeting tab's own dispatch state above (different channel, different route,
  // no shared state) — the only thing reused is the passcode-prompt UI pattern.
  const [widgetStatusLoading, setWidgetStatusLoading] = useState(true)
  const [widgetActive, setWidgetActive] = useState(false)
  const [widgetSessionRef, setWidgetSessionRef] = useState<string | null>(null)
  const [widgetRenderUrl, setWidgetRenderUrl] = useState<string | null>(null)
  const [widgetStartedAt, setWidgetStartedAt] = useState<number | null>(null)
  const [widgetNameInput, setWidgetNameInput] = useState('')
  const [widgetShowPasscode, setWidgetShowPasscode] = useState(false)
  const [widgetPasscodeInput, setWidgetPasscodeInput] = useState('')
  const [widgetDispatching, setWidgetDispatching] = useState(false)
  const [widgetEnding, setWidgetEnding] = useState(false)
  const [widgetErrorMessage, setWidgetErrorMessage] = useState<string | null>(null)

  // B2B-34 Piece 1 — Performance tab data, fetched eagerly on mount (§3: "eager on mount, matching the
  // existing savedMeetingUrl fetch pattern already in this component, so switching to the tab never
  // shows an avoidable loading flash for data that could have already arrived").
  const [performanceLoading, setPerformanceLoading] = useState(true)
  const [performanceData, setPerformanceData] = useState<PerformanceResponse | null>(null)
  const [performanceFetchFailed, setPerformanceFetchFailed] = useState(false)

  useEffect(() => {
    let cancelled = false
    setPerformanceLoading(true)
    fetch(`/api/demo/${topic.slug}/performance`)
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error('fetch failed'))))
      .then((data: PerformanceResponse) => {
        if (cancelled) return
        setPerformanceData(data)
      })
      .catch(() => {
        if (cancelled) return
        // §8 — a frontend fetch failure falls back to the P-Pending visual treatment (fails toward
        // "still processing," never toward showing stale/fabricated data).
        setPerformanceFetchFailed(true)
      })
      .finally(() => {
        if (!cancelled) setPerformanceLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [topic.slug])

  // 2026-07-27 — found live: dispatchSucceeded was a one-time flag with no way to learn the real
  // Google Meet call had ended, so "✓ Bot is joining the meeting." stayed on screen forever,
  // blocking a relaunch. Simplified 2026-07-29 per Arun's direct instruction: this is a demo-only
  // affordance (a real partner integration is API-triggered and never shows a "bot is joining"
  // message at all), so a flat timer is intentionally preferred over trying to track the bot's
  // real join/session state precisely — just show it, then clear it and let the operator relaunch.
  useEffect(() => {
    if (!dispatchSucceeded) return
    const t = window.setTimeout(() => setDispatchSucceeded(false), 30000)
    return () => window.clearTimeout(t)
  }, [dispatchSucceeded])

  // Separate from the banner above: the Performance tab needs the session's REAL state (duration,
  // transcript-derived action items, learner insight), which the post-session insights extractor
  // computes as a genuine background job — not instantaneous, and not on the same 30s timer as the
  // banner. Found live 2026-07-29: a single poll that stopped as soon as the banner cleared left the
  // Performance tab frozen on stale "pending" data even after extraction had actually finished,
  // requiring a manual page refresh. This polls independently of the banner and stops itself only
  // once the state resolves to something terminal ('ready' or 'extraction_failed').
  useEffect(() => {
    if (!dispatchSucceeded && performanceData?.session_state !== 'in_progress' && performanceData?.session_state !== 'pending_extraction') return
    let cancelled = false
    const interval = window.setInterval(() => {
      fetch(`/api/demo/${topic.slug}/performance`)
        .then((res) => (res.ok ? res.json() : Promise.reject(new Error('fetch failed'))))
        .then((data: PerformanceResponse) => {
          if (cancelled) return
          setPerformanceData(data)
        })
        .catch(() => {
          // Transient poll failure — retry on the next tick rather than giving up.
        })
    }, 10000)
    return () => {
      cancelled = true
      window.clearInterval(interval)
    }
  }, [dispatchSucceeded, performanceData?.session_state, topic.slug])

  useEffect(() => {
    let cancelled = false
    setMeetingLoading(true)
    fetch(`/api/demo/${topic.slug}/meeting`)
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error('fetch failed'))))
      .then((data: { meeting_url: string | null; end_user_name: string | null; updated_at: string | null }) => {
        if (cancelled) return
        setSavedMeetingUrl(data.meeting_url)
        setSavedEndUserName(data.end_user_name)
        setSavedMeetingUpdatedAt(data.updated_at)
      })
      .catch(() => {
        // Fails closed (§8) — leaves savedMeetingUrl as null, so the button stays disabled rather
        // than assuming a URL is saved with no known-good value behind it.
      })
      .finally(() => {
        if (!cancelled) setMeetingLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [topic.slug])

  useEffect(() => {
    if (!saveSuccess) return
    const t = window.setTimeout(() => setSaveSuccess(false), 4000)
    return () => window.clearTimeout(t)
  }, [saveSuccess])

  // B2B-70 §6.9 — restores an already-active widget session on page load/refresh, so the iframe
  // reappears instead of the operator losing track of an in-progress session. widgetStartedAt is
  // deliberately left null on a restore (an exact start time isn't recoverable from this endpoint) —
  // handleEndWidgetSession() falls back to duration_minutes: 0 in that case, matching the existing
  // end-session route's own default for an unknown duration.
  useEffect(() => {
    let cancelled = false
    setWidgetStatusLoading(true)
    fetch(`/api/demo/${topic.slug}/widget-status`)
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error('fetch failed'))))
      .then((data: { active: boolean; clio_session_ref: string | null; render_url: string | null }) => {
        if (cancelled) return
        setWidgetActive(data.active)
        setWidgetSessionRef(data.clio_session_ref)
        setWidgetRenderUrl(data.render_url)
      })
      .catch(() => {
        // Fails closed — leaves widgetActive as false, so the operator sees the start form rather
        // than an iframe backed by an unknown state.
      })
      .finally(() => {
        if (!cancelled) setWidgetStatusLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [topic.slug])

  async function handleStartWidgetSession() {
    setWidgetDispatching(true)
    setWidgetErrorMessage(null)
    try {
      const res = await fetch(`/api/demo/${topic.slug}/widget-dispatch`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ passcode: widgetPasscodeInput, end_user_name: widgetNameInput }),
      })
      const data = await res.json().catch(() => null)

      if (res.ok && data?.status === 'dispatched') {
        setWidgetActive(true)
        setWidgetSessionRef(data.clio_session_ref)
        setWidgetRenderUrl(data.render_url)
        setWidgetStartedAt(Date.now())
        setWidgetShowPasscode(false)
        setWidgetPasscodeInput('')
        return
      }

      const code = data?.error?.code
      if (code === 'incorrect_passcode') {
        setWidgetErrorMessage('Incorrect passcode.')
        return
      }
      setWidgetShowPasscode(false)
      setWidgetPasscodeInput('')
      // B2B-70 v2.0 — the no_widget_container branch is retired: content is assembled by the
      // widget-dispatch route itself (from this topic's own already-authored chapters), so there is
      // nothing left to be "not registered." Every other failure falls to the generic catch-all.
      if (code === 'session_already_active') {
        setWidgetErrorMessage(data?.error?.message ?? 'A widget session is already active for this topic.')
      } else {
        setWidgetErrorMessage('Something went wrong starting the widget session. Try again in a moment.')
      }
    } catch {
      setWidgetShowPasscode(false)
      setWidgetPasscodeInput('')
      setWidgetErrorMessage('Something went wrong starting the widget session. Try again in a moment.')
    } finally {
      setWidgetDispatching(false)
    }
  }

  // B2B-70 — abandoned-tab fallback (Requirement Doc §6.10): if the operator just closes the tab
  // instead of clicking "End session," this best-effort beacon still reports the session's end so it
  // doesn't sit on the stuck-session backstop sweep's up-to-60-minute recovery window. `sendBeacon`
  // has no custom-header support, so the JSON body is sent as a Blob typed 'application/json' —
  // the existing end-session route reads it via request.json(), which works identically either way.
  useEffect(() => {
    if (!widgetActive || !widgetSessionRef) return
    const sessionRef = widgetSessionRef
    const startedAt = widgetStartedAt
    function handlePageHide() {
      const durationMinutes = startedAt ? Math.max(0, Math.round((Date.now() - startedAt) / 60000)) : 0
      const blob = new Blob([JSON.stringify({ clio_session_ref: sessionRef, duration_minutes: durationMinutes })], { type: 'application/json' })
      navigator.sendBeacon('/api/partner/render/end-session', blob)
    }
    window.addEventListener('pagehide', handlePageHide)
    return () => window.removeEventListener('pagehide', handlePageHide)
  }, [widgetActive, widgetSessionRef, widgetStartedAt])

  async function handleEndWidgetSession() {
    if (!widgetSessionRef) return
    setWidgetEnding(true)
    try {
      const durationMinutes = widgetStartedAt ? Math.max(0, Math.round((Date.now() - widgetStartedAt) / 60000)) : 0
      await fetch('/api/partner/render/end-session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clio_session_ref: widgetSessionRef, duration_minutes: durationMinutes }),
      })
    } catch {
      // Best-effort — the stuck-session backstop sweep (inngest/partner-trial-cutoff.ts) recovers
      // this session even if the explicit end-session call fails here.
    } finally {
      setWidgetActive(false)
      setWidgetSessionRef(null)
      setWidgetRenderUrl(null)
      setWidgetStartedAt(null)
      setWidgetEnding(false)
    }
  }

  async function handleSave() {
    setSaveNameError(null)
    setSaveUrlError(null)
    setSavePasscodeError(null)
    setSaveGenericError(null)
    setSaving(true)
    try {
      const res = await fetch(`/api/demo/${topic.slug}/meeting`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ meeting_url: urlInput, end_user_name: nameInput, passcode: passcodeInput }),
      })
      const data = await res.json().catch(() => null)

      if (res.ok) {
        setSavedMeetingUrl(data.meeting_url)
        setSavedEndUserName(data.end_user_name)
        setSavedMeetingUpdatedAt(data.updated_at)
        setUrlInput('')
        setNameInput('')
        setPasscodeInput('')
        setSaveSuccess(true)
        return
      }

      const code = data?.error?.code
      if (code === 'incorrect_passcode') {
        setSavePasscodeError('Incorrect passcode.')
      } else if (code === 'validation_failed') {
        setSaveUrlError('Enter a valid https:// meeting URL.')
      } else {
        setSaveGenericError("Couldn't save — try again.")
      }
    } catch {
      setSaveGenericError("Couldn't save — try again.")
    } finally {
      setSaving(false)
    }
  }

  async function handleLearnWithAi() {
    setDispatching(true)
    setDispatchErrorMessage(null)
    setDispatchPasscodeError(null)
    try {
      const res = await fetch(`/api/demo/${topic.slug}/dispatch`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ passcode: dispatchPasscodeInput }),
      })
      const data = await res.json().catch(() => null)

      if (res.ok && data?.status === 'dispatched') {
        setDispatchSucceeded(true)
        setShowDispatchPasscode(false)
        setDispatchPasscodeInput('')
        return
      }

      const code = data?.error?.code
      if (code === 'incorrect_passcode') {
        // Keep the prompt open so the operator can retry without re-clicking Learn with AI.
        setDispatchPasscodeError('Incorrect passcode.')
        return
      }

      setShowDispatchPasscode(false)
      setDispatchPasscodeInput('')
      if (code === 'rate_limited') {
        setDispatchErrorMessage('Learn with AI was just triggered for this course. Try again in a few minutes.')
      } else if (code === 'session_already_active') {
        // B2B-44 Fix 5a — server-side duplicate-dispatch guard rejected this attempt because a
        // session for this course is already active. Surface the server's own message rather than
        // inventing new copy, matching this handler's existing pattern for other error codes.
        setDispatchErrorMessage(data?.error?.message ?? 'A bot is already in this meeting.')
      } else {
        setDispatchErrorMessage('Something went wrong starting the bot. Try again in a moment.')
      }
    } catch {
      setShowDispatchPasscode(false)
      setDispatchPasscodeInput('')
      setDispatchErrorMessage('Something went wrong starting the bot. Try again in a moment.')
    } finally {
      setDispatching(false)
    }
  }

  const totalMinutes = topic.chapters.reduce((sum, ch) => {
    const m = parseInt(ch.durationLabel, 10)
    return sum + (Number.isNaN(m) ? 0 : m)
  }, 0)

  const canSave = urlInput.trim().length > 0 && nameInput.trim().length > 0 && passcodeInput.length > 0 && !saving
  const meetingReady = Boolean(savedMeetingUrl) && Boolean(savedEndUserName)

  return (
    <div style={pageStyle}>
      <nav style={navStyle}>
        <Link href="/demo" style={brandStyle}>
          <span style={brandMarkStyle} aria-hidden="true" />
          Learn with AI
        </Link>
        <Link href="/demo" style={{ color: COLORS.textMuted, fontSize: 13, textDecoration: 'none' }}>
          ← All demo courses
        </Link>
      </nav>

      <div style={containerStyle}>
        <div style={{ padding: '0 clamp(16px, 4vw, 48px)' }}>
          <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: COLORS.accentBright, marginBottom: 8 }}>
            {topic.category}
          </div>
          <h1 style={heroTitleStyle}>{topic.title}</h1>
          <p style={{ fontSize: 14, color: COLORS.textSecondary, margin: '4px 0 0 0' }}>
            By <strong style={{ color: COLORS.textPrimary }}>{topic.author}</strong> — {topic.authorRole}
          </p>

          <div style={pillRowStyle}>
            <span style={pillStyle}>Updated {topic.updatedLabel}</span>
            <span style={pillStyle}>Duration {topic.durationLabel}</span>
            <span style={pillStyle}>Level {topic.level}</span>
            <span style={pillStyle}>★ {topic.rating.toFixed(1)} ({topic.ratingCount})</span>
          </div>

          <div style={actionBarStyle}>
            <button type="button" style={primaryButtonStyle}>
              ▶ Start Course
            </button>
            <button type="button" style={secondaryButtonStyle}>
              Bookmark
            </button>

            {dispatchSucceeded ? (
              <span
                style={{
                  ...pillStyle,
                  color: COLORS.green,
                  borderColor: COLORS.green,
                }}
              >
                ✓ Bot is joining the meeting.
              </span>
            ) : showDispatchPasscode ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <input
                  type="password"
                  autoFocus
                  value={dispatchPasscodeInput}
                  onChange={(e) => setDispatchPasscodeInput(e.target.value)}
                  disabled={dispatching}
                  placeholder="Passcode"
                  style={{ ...meetingInputStyle, width: 160 }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && dispatchPasscodeInput.length > 0 && !dispatching) handleLearnWithAi()
                  }}
                />
                <button
                  type="button"
                  style={{
                    ...aiButtonStyle,
                    opacity: dispatchPasscodeInput.length === 0 || dispatching ? 0.5 : 1,
                    cursor: dispatchPasscodeInput.length === 0 || dispatching ? 'not-allowed' : 'pointer',
                  }}
                  disabled={dispatchPasscodeInput.length === 0 || dispatching}
                  onClick={handleLearnWithAi}
                >
                  {dispatching ? 'Dispatching bot…' : 'Join meeting'}
                </button>
                <button
                  type="button"
                  disabled={dispatching}
                  onClick={() => {
                    setShowDispatchPasscode(false)
                    setDispatchPasscodeInput('')
                    setDispatchPasscodeError(null)
                  }}
                  style={{
                    background: 'none',
                    border: 'none',
                    color: COLORS.textMuted,
                    fontSize: 13,
                    cursor: dispatching ? 'not-allowed' : 'pointer',
                  }}
                >
                  Cancel
                </button>
                {dispatchPasscodeError && <span style={{ fontSize: 13, color: COLORS.red }}>{dispatchPasscodeError}</span>}
              </div>
            ) : (
              <button
                type="button"
                style={{
                  ...aiButtonStyle,
                  opacity: !meetingReady || meetingLoading ? 0.5 : 1,
                  cursor: !meetingReady || meetingLoading ? 'not-allowed' : 'pointer',
                }}
                disabled={!meetingReady || meetingLoading}
                onClick={() => {
                  setDispatchErrorMessage(null)
                  setShowDispatchPasscode(true)
                }}
              >
                ✨ Learn with AI
              </button>
            )}

            {!dispatchSucceeded && !showDispatchPasscode && !meetingLoading && !meetingReady && (
              <span style={{ fontSize: 13, color: COLORS.textMuted }}>Save a meeting URL and name in the Meeting tab to enable this.</span>
            )}
            {!dispatchSucceeded && !showDispatchPasscode && dispatchErrorMessage && (
              <span style={{ fontSize: 13, color: COLORS.red }}>{dispatchErrorMessage}</span>
            )}
          </div>

          <div style={tabRowStyle}>
            {TABS.map((tab) => (
              <button
                key={tab}
                type="button"
                onClick={() => setActiveTab(tab)}
                style={{ ...tabStyle(activeTab === tab), background: 'none', border: 'none', cursor: 'pointer' }}
              >
                {tab}
              </button>
            ))}
          </div>

          {activeTab === 'Course Overview' && (
            <div style={{ maxWidth: 760, marginTop: 24 }}>
              <p style={chapterBodyStyle}>{topic.overview}</p>
              <h3 style={{ fontSize: 15, fontWeight: 700, margin: '20px 0 10px 0' }}>What you&apos;ll learn</h3>
              <ul style={listStyle}>
                {topic.chapters.map((ch) => (
                  <li key={ch.id}>{ch.title}</li>
                ))}
              </ul>
              <p style={{ fontSize: 13, color: COLORS.textMuted }}>
                {topic.chapters.length} chapters · {totalMinutes}m total
              </p>
            </div>
          )}

          {activeTab === 'Transcript' && (
            <div style={{ maxWidth: 760 }}>
              <div style={chapterListStyle}>
                {topic.chapters.map((ch, i) => (
                  <div key={ch.id} style={chapterRowStyle}>
                    <span style={chapterMarkerStyle}>{i + 1}</span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
                        <h3 style={chapterTitleStyle}>{ch.title}</h3>
                        <span style={{ fontSize: 13, color: COLORS.textMuted, whiteSpace: 'nowrap' }}>{ch.durationLabel}</span>
                      </div>
                      {ch.blocks.map((block, bi) => {
                        if (block.type === 'paragraph') {
                          return (
                            <p key={bi} style={chapterBodyStyle}>
                              {block.text}
                            </p>
                          )
                        }
                        if (block.type === 'list') {
                          return (
                            <ul key={bi} style={listStyle}>
                              {block.items?.map((item, li) => <li key={li}>{item}</li>)}
                            </ul>
                          )
                        }
                        if (block.type === 'code') {
                          return (
                            <pre key={bi} style={codeBlockStyle}>
                              <code>{block.code}</code>
                            </pre>
                          )
                        }
                        return null
                      })}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {activeTab === 'Visuals' && (
            <div style={{ maxWidth: 760, marginTop: 24 }}>
              {VISUAL_TOPICS.has(topic.slug) ? (
                <div style={{ display: 'grid', gap: 12 }}>
                  {topic.chapters.map((ch, i) => (
                    <Link
                      key={ch.id}
                      href={`/demo/${topic.slug}/visuals/${ch.id}`}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 16,
                        padding: '16px 18px',
                        borderRadius: 10,
                        background: COLORS.surface ?? '#181530',
                        border: `1px solid ${COLORS.border ?? '#2f2a54'}`,
                        textDecoration: 'none',
                        color: COLORS.textPrimary,
                      }}
                    >
                      <span style={chapterMarkerStyle}>{i + 1}</span>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 15, fontWeight: 700 }}>{ch.title}</div>
                        <div style={{ fontSize: 13, color: COLORS.textMuted, marginTop: 2 }}>
                          {VISUAL_BLURBS[ch.id] ?? 'Visual explainer'}
                        </div>
                      </div>
                      <span style={{ color: COLORS.accentBright, fontSize: 18 }}>→</span>
                    </Link>
                  ))}
                </div>
              ) : (
                <div style={{ color: COLORS.textMuted, fontSize: 14 }}>
                  No visuals for this demo course yet.
                </div>
              )}
            </div>
          )}

          {activeTab === 'Resources' && (
            <div style={{ maxWidth: 760, marginTop: 24, color: COLORS.textMuted, fontSize: 14 }}>
              No downloadable resources for this demo course.
            </div>
          )}

          {activeTab === 'Discussion' && (
            <div style={{ maxWidth: 760, marginTop: 24, color: COLORS.textMuted, fontSize: 14 }}>
              No discussion threads yet — this is a demo course.
            </div>
          )}

          {activeTab === 'Meeting' && (
            <div style={{ maxWidth: 760, marginTop: 24 }}>
              {savedMeetingUrl && savedEndUserName && (
                <p style={{ ...chapterBodyStyle, marginBottom: 20 }}>
                  Currently saved: <strong style={{ color: COLORS.textPrimary }}>{savedEndUserName}</strong>,
                  meeting at <strong style={{ color: COLORS.textPrimary }}>{savedMeetingUrl}</strong>
                  {savedMeetingUpdatedAt && <> — saved {formatSavedAt(savedMeetingUpdatedAt)}.</>}
                </p>
              )}
              {savedMeetingUrl && !savedEndUserName && (
                <p style={{ ...chapterBodyStyle, marginBottom: 20 }}>
                  Currently saved: <strong style={{ color: COLORS.textPrimary }}>{savedMeetingUrl}</strong>{' '}
                  (no name saved yet — add a name below to enable Learn with AI)
                  {savedMeetingUpdatedAt && <> — saved {formatSavedAt(savedMeetingUpdatedAt)}.</>}
                </p>
              )}
              {!savedMeetingUrl && (
                <p style={{ ...chapterBodyStyle, marginBottom: 20 }}>
                  For this demo, enter the participant&apos;s name and paste the Google Meet URL you want
                  Clio&apos;s bot to join, then Save.
                </p>
              )}

              <div style={{ ...meetingFieldWrapStyle, marginBottom: 16 }}>
                <label style={meetingLabelStyle} htmlFor="meeting-name-input">
                  Name
                </label>
                <input
                  id="meeting-name-input"
                  type="text"
                  value={nameInput}
                  onChange={(e) => setNameInput(e.target.value)}
                  disabled={saving}
                  placeholder="Participant's name"
                  style={meetingInputStyle}
                />
                {saveNameError && (
                  <div style={{ fontSize: 12.5, color: COLORS.red, marginTop: 6 }}>{saveNameError}</div>
                )}
              </div>

              <div style={{ ...meetingFieldWrapStyle, marginBottom: 16 }}>
                <label style={meetingLabelStyle} htmlFor="meeting-url-input">
                  Google Meet URL
                </label>
                <input
                  id="meeting-url-input"
                  type="url"
                  value={urlInput}
                  onChange={(e) => setUrlInput(e.target.value)}
                  disabled={saving}
                  placeholder={
                    savedMeetingUrl ? 'Paste a new Google Meet URL to replace the saved one' : 'https://meet.google.com/xxx-xxxx-xxx'
                  }
                  style={meetingInputStyle}
                />
                {saveUrlError && (
                  <div style={{ fontSize: 12.5, color: COLORS.red, marginTop: 6 }}>{saveUrlError}</div>
                )}
              </div>

              <div style={{ ...meetingFieldWrapStyle, marginBottom: 16 }}>
                <label style={meetingLabelStyle} htmlFor="meeting-passcode-input">
                  Passcode
                </label>
                <input
                  id="meeting-passcode-input"
                  type="password"
                  value={passcodeInput}
                  onChange={(e) => setPasscodeInput(e.target.value)}
                  disabled={saving}
                  placeholder="Passcode"
                  style={meetingInputStyle}
                />
                {savePasscodeError && (
                  <div style={{ fontSize: 12.5, color: COLORS.red, marginTop: 6 }}>{savePasscodeError}</div>
                )}
              </div>

              <button
                type="button"
                onClick={handleSave}
                disabled={!canSave}
                style={{
                  ...primaryButtonStyle,
                  opacity: canSave ? 1 : 0.5,
                  cursor: canSave ? 'pointer' : 'not-allowed',
                }}
              >
                {saving ? 'Saving…' : 'Save'}
              </button>

              {saveSuccess && <div style={{ fontSize: 13, color: COLORS.green, marginTop: 10 }}>✓ Saved.</div>}
              {saveGenericError && <div style={{ fontSize: 13, color: COLORS.red, marginTop: 10 }}>{saveGenericError}</div>}
            </div>
          )}

          {activeTab === 'Widget Demo' && (
            <div style={{ maxWidth: 760, marginTop: 24 }}>
              <p style={{ ...chapterBodyStyle, marginBottom: 20 }}>
                A different delivery channel from the Meeting tab above: no Google Meet, no bot joining a
                call — Clio renders directly in the box below, exactly as it would embedded in a
                reseller&apos;s own web page.
              </p>

              {widgetStatusLoading ? (
                <p style={{ color: COLORS.textMuted, fontSize: 14 }}>Checking…</p>
              ) : widgetActive && widgetRenderUrl ? (
                <>
                  {/* B2B-72 — per Arun's direct instruction: the widget no longer renders small,
                      embedded in this tab's own column. It opens in a new browser tab/window instead,
                      where WidgetRenderClient.tsx's own `h-screen w-screen` root already fills the
                      full viewport natively — no iframe sizing constraint at all. Zero change to the
                      widget-render route/component itself; this is purely how the demo page launches
                      it, mirroring exactly what a real reseller's own "Learn with AI" button does
                      (open render_url, full-viewport, in the reseller's own new tab/window). */}
                  <button
                    type="button"
                    onClick={() => window.open(widgetRenderUrl, '_blank', 'noopener,noreferrer')}
                    style={aiButtonStyle}
                  >
                    ✨ Open widget session (full screen)
                  </button>
                  <p style={{ color: COLORS.textMuted, fontSize: 13, marginTop: 10 }}>
                    Opens in a new tab at {widgetRenderUrl}
                  </p>
                  <button
                    type="button"
                    disabled={widgetEnding}
                    onClick={handleEndWidgetSession}
                    style={{
                      ...secondaryButtonStyle,
                      marginTop: 16,
                      opacity: widgetEnding ? 0.5 : 1,
                      cursor: widgetEnding ? 'not-allowed' : 'pointer',
                    }}
                  >
                    {widgetEnding ? 'Ending…' : 'End session'}
                  </button>
                </>
              ) : (
                <>
                  <div style={{ ...meetingFieldWrapStyle, marginBottom: 16 }}>
                    <label style={meetingLabelStyle} htmlFor="widget-name-input">
                      Name
                    </label>
                    <input
                      id="widget-name-input"
                      type="text"
                      value={widgetNameInput}
                      onChange={(e) => setWidgetNameInput(e.target.value)}
                      disabled={widgetDispatching}
                      placeholder="Participant's name"
                      style={meetingInputStyle}
                    />
                  </div>

                  {widgetShowPasscode ? (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                      <input
                        type="password"
                        autoFocus
                        value={widgetPasscodeInput}
                        onChange={(e) => setWidgetPasscodeInput(e.target.value)}
                        disabled={widgetDispatching}
                        placeholder="Passcode"
                        style={{ ...meetingInputStyle, width: 160 }}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' && widgetPasscodeInput.length > 0 && !widgetDispatching) handleStartWidgetSession()
                        }}
                      />
                      <button
                        type="button"
                        style={{
                          ...aiButtonStyle,
                          opacity: widgetPasscodeInput.length === 0 || widgetDispatching ? 0.5 : 1,
                          cursor: widgetPasscodeInput.length === 0 || widgetDispatching ? 'not-allowed' : 'pointer',
                        }}
                        disabled={widgetPasscodeInput.length === 0 || widgetDispatching}
                        onClick={handleStartWidgetSession}
                      >
                        {widgetDispatching ? 'Starting…' : 'Start widget session'}
                      </button>
                      <button
                        type="button"
                        disabled={widgetDispatching}
                        onClick={() => {
                          setWidgetShowPasscode(false)
                          setWidgetPasscodeInput('')
                        }}
                        style={{ background: 'none', border: 'none', color: COLORS.textMuted, fontSize: 13, cursor: widgetDispatching ? 'not-allowed' : 'pointer' }}
                      >
                        Cancel
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      style={{
                        ...aiButtonStyle,
                        opacity: widgetNameInput.trim().length === 0 ? 0.5 : 1,
                        cursor: widgetNameInput.trim().length === 0 ? 'not-allowed' : 'pointer',
                      }}
                      disabled={widgetNameInput.trim().length === 0}
                      onClick={() => {
                        setWidgetErrorMessage(null)
                        setWidgetShowPasscode(true)
                      }}
                    >
                      ✨ Start widget session
                    </button>
                  )}

                  {widgetErrorMessage && <p style={{ fontSize: 13, color: COLORS.red, marginTop: 10 }}>{widgetErrorMessage}</p>}
                </>
              )}
            </div>
          )}

          {activeTab === 'Learning Check' && (
            <div style={{ maxWidth: 760, marginTop: 24, color: COLORS.textMuted, fontSize: 14 }}>
              No learning check quiz for this demo course.
            </div>
          )}

          {activeTab === 'Performance' && (
            <div style={{ maxWidth: 760, marginTop: 24 }}>
              {performanceLoading ? (
                // §9 edge case "Slow network on first load" — a muted "Loading…" line, matching the
                // Meeting tab's own lack-of-spinner-for-fast-fetches precedent, never a layout shift
                // once resolved.
                <p style={{ color: COLORS.textMuted, fontSize: 14 }}>Loading…</p>
              ) : performanceFetchFailed || !performanceData ? (
                // §8 — frontend fetch failure falls back to State P-Pending's visual treatment.
                <>
                  <h3 style={perfEmptyHeadingStyle}>Performance data is being prepared.</h3>
                  <p style={perfEmptyBodyStyle}>This usually takes a few minutes after the meeting ends. Check back shortly.</p>
                </>
              ) : performanceData.session_state === 'ready' && (performanceData.entries ?? []).length === 0 ? (
                // B2B-51 — literal Field/Value table of the exact session-outcome fields Clio sends
                // resellers via the session.insights_ready webhook. Fixed 6-row shape, always in this
                // order, regardless of which values are populated (§4/§5.2). Deliberately excludes any
                // internal-only diagnostic data (that lives solely in the dashboard tracker, B2B-17)
                // and any wire-envelope/identifier fields (§10) — session-outcome content only.
                <div style={perfTableWrapperStyle}>
                  <div style={perfTableRowStyle}>
                    <div style={perfTableHeaderCellStyle}>Field</div>
                    <div style={perfTableHeaderCellStyle}>Value</div>
                  </div>

                  <PerfTableRow field="Duration">
                    {performanceData.duration_minutes !== null && performanceData.duration_minutes !== undefined ? (
                      `${performanceData.duration_minutes} minutes`
                    ) : (
                      <span style={perfTableMutedStyle}>Not available</span>
                    )}
                  </PerfTableRow>

                  <PerfTableRow field="Action items">
                    <PerfListCell items={performanceData.action_items?.map((item) => item.text) ?? null} />
                  </PerfTableRow>

                  <PerfTableRow field="Summary">
                    <PerfScalarCell value={performanceData.learner_insight?.summary} />
                  </PerfTableRow>

                  <PerfTableRow field="Topics of interest">
                    <PerfListCell items={performanceData.learner_insight?.topics_of_interest ?? null} />
                  </PerfTableRow>

                  <PerfTableRow field="Engagement style">
                    <PerfScalarCell value={performanceData.learner_insight?.engagement_style} />
                  </PerfTableRow>

                  <PerfTableRow field="Suggested next topics">
                    <PerfListCell items={performanceData.learner_insight?.suggested_next_topics ?? null} />
                  </PerfTableRow>

                  {/* B2B-57a — this demo session's own real usage.voice_minute billing event, if one
                      has been recorded yet. Demo-only; each row independently renders "Not available"
                      via PerfScalarCell when performanceData.usage is null (event not dispatched yet),
                      never a blank or fabricated value. */}
                  <div style={perfTableSectionLabelStyle}>Usage</div>

                  <PerfTableRow field="Minutes billed">
                    <PerfScalarCell value={performanceData.usage?.minutes_billed} />
                  </PerfTableRow>

                  <PerfTableRow field="Generation type">
                    <PerfScalarCell value={performanceData.usage?.generation_type} />
                  </PerfTableRow>

                  <PerfTableRow field="Mode">
                    <PerfScalarCell value={performanceData.usage?.mode} />
                  </PerfTableRow>

                  <PerfTableRow field="Event ID">
                    <PerfScalarCell value={performanceData.usage?.event_id} />
                  </PerfTableRow>

                  <PerfTableRow field="Recorded at">
                    <PerfScalarCell value={performanceData.usage ? formatSavedAt(performanceData.usage.recorded_at) : null} />
                  </PerfTableRow>
                </div>
              ) : (
                // B2B-65 (updated 2026-08-01 per Arun — replaces the four separate "no
                // meeting/being prepared/couldn't be generated" text states this branch used to
                // show): always render the table shell — Field/Value header plus either the real
                // accumulated entries, or a single empty placeholder row set with the exact same
                // shape (muted "Not available"/"None identified" per field, via the same
                // PerfScalarCell/PerfListCell null-handling every other row already uses) — so the
                // page never shows a blank message, and a real entry just populates into the same
                // structure once one exists. The muted "being processed" note still appears above
                // the table while the latest dispatch is still in flight, whether or not any
                // entries have accumulated yet.
                <>
                  {(performanceData.session_state === 'in_progress' || performanceData.session_state === 'pending_extraction') && (
                    <p style={perfEntriesProcessingNoteStyle}>A new session is being processed and will be added here once ready.</p>
                  )}
                  {/* REMOVE BEFORE PRODUCTION — all 21 partner_session_insights columns, including
                      internal IDs and glitches, are shown here per Arun's own explicit 2026-08-02
                      exception (docs/specs/B2B-65-tabular-performance-format-amendment-requirement-
                      document.md). Arun has personally committed to removing this table before
                      production. */}
                  <div style={perfEntriesScrollWrapperStyle}>
                    <p style={perfEntriesCaptionStyle}>Scroll horizontally to see all columns →</p>
                    <table style={perfEntriesTableStyle}>
                      <thead>
                        <tr>
                          {ENTRY_COLUMNS.map((col) => (
                            <th key={col.header} style={col.minWidth ? { ...perfEntriesThStyle, minWidth: col.minWidth } : perfEntriesThStyle}>
                              {col.header}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {(performanceData.entries ?? []).length > 0 ? (
                          performanceData.entries.slice(0, DEMO_PERFORMANCE_TABLE_DISPLAY_LIMIT).map((entry) => (
                            <tr key={entry.id}>
                              {ENTRY_COLUMNS.map((col) => (
                                <td key={col.header} style={col.mono ? perfEntriesMonoTdStyle : perfEntriesTdStyle}>
                                  {col.render(entry)}
                                </td>
                              ))}
                            </tr>
                          ))
                        ) : (
                          <tr>
                            {ENTRY_COLUMNS.map((col) => (
                              <td key={col.header} style={col.mono ? perfEntriesMonoTdStyle : perfEntriesTdStyle}>
                                {col.render(null)}
                              </td>
                            ))}
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
