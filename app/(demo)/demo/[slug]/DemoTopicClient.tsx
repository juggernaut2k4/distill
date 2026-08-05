'use client'

import { useEffect, useState } from 'react'
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

const TABS = ['Course Overview', 'Transcript', 'Visuals', 'Meeting', 'Widget Demo', 'Learning Check'] as const
type Tab = (typeof TABS)[number]

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
                  <div style={actionBarStyle}>
                    <button
                      type="button"
                      onClick={() => window.open(widgetRenderUrl, '_blank', 'noopener,noreferrer')}
                      style={aiButtonStyle}
                    >
                      ✨ Open widget session (full screen)
                    </button>
                    <button
                      type="button"
                      disabled={widgetEnding}
                      onClick={handleEndWidgetSession}
                      style={{
                        ...secondaryButtonStyle,
                        opacity: widgetEnding ? 0.5 : 1,
                        cursor: widgetEnding ? 'not-allowed' : 'pointer',
                      }}
                    >
                      {widgetEnding ? 'Ending…' : 'End session'}
                    </button>
                  </div>
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
        </div>
      </div>
    </div>
  )
}
