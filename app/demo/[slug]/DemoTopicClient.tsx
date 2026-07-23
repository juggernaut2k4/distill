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
  COLORS,
} from '../_styles'

const TABS = ['Course Overview', 'Transcript', 'Visuals', 'Resources', 'Discussion', 'Meeting', 'Learning Check'] as const
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

  // Meeting tab form state.
  const [urlInput, setUrlInput] = useState('')
  const [passcodeInput, setPasscodeInput] = useState('')
  const [saving, setSaving] = useState(false)
  const [saveUrlError, setSaveUrlError] = useState<string | null>(null)
  const [savePasscodeError, setSavePasscodeError] = useState<string | null>(null)
  const [saveGenericError, setSaveGenericError] = useState<string | null>(null)
  const [saveSuccess, setSaveSuccess] = useState(false)

  // Learn with AI dispatch state.
  const [dispatching, setDispatching] = useState(false)
  const [dispatchSucceeded, setDispatchSucceeded] = useState(false)
  const [dispatchErrorMessage, setDispatchErrorMessage] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setMeetingLoading(true)
    fetch(`/api/demo/${topic.slug}/meeting`)
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error('fetch failed'))))
      .then((data: { meeting_url: string | null; updated_at: string | null }) => {
        if (cancelled) return
        setSavedMeetingUrl(data.meeting_url)
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

  async function handleSave() {
    setSaveUrlError(null)
    setSavePasscodeError(null)
    setSaveGenericError(null)
    setSaving(true)
    try {
      const res = await fetch(`/api/demo/${topic.slug}/meeting`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ meeting_url: urlInput, passcode: passcodeInput }),
      })
      const data = await res.json().catch(() => null)

      if (res.ok) {
        setSavedMeetingUrl(data.meeting_url)
        setSavedMeetingUpdatedAt(data.updated_at)
        setUrlInput('')
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
    try {
      const res = await fetch(`/api/demo/${topic.slug}/dispatch`, { method: 'POST' })
      const data = await res.json().catch(() => null)

      if (res.ok && data?.status === 'dispatched') {
        setDispatchSucceeded(true)
        return
      }

      if (data?.error?.code === 'rate_limited') {
        setDispatchErrorMessage('Learn with AI was just triggered for this course. Try again in a few minutes.')
      } else {
        setDispatchErrorMessage('Something went wrong starting the bot. Try again in a moment.')
      }
    } catch {
      setDispatchErrorMessage('Something went wrong starting the bot. Try again in a moment.')
    } finally {
      setDispatching(false)
    }
  }

  const totalMinutes = topic.chapters.reduce((sum, ch) => {
    const m = parseInt(ch.durationLabel, 10)
    return sum + (Number.isNaN(m) ? 0 : m)
  }, 0)

  const canSave = urlInput.trim().length > 0 && passcodeInput.length > 0 && !saving
  const meetingReady = Boolean(savedMeetingUrl)

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
            ) : (
              <button
                type="button"
                style={{
                  ...aiButtonStyle,
                  opacity: !meetingReady || meetingLoading || dispatching ? 0.5 : 1,
                  cursor: !meetingReady || meetingLoading || dispatching ? 'not-allowed' : 'pointer',
                }}
                disabled={!meetingReady || meetingLoading || dispatching}
                onClick={handleLearnWithAi}
              >
                {dispatching ? 'Dispatching bot…' : '✨ Learn with AI'}
              </button>
            )}

            {!dispatchSucceeded && !meetingLoading && !meetingReady && !dispatching && (
              <span style={{ fontSize: 13, color: COLORS.textMuted }}>Save a meeting URL in the Meeting tab to enable this.</span>
            )}
            {!dispatchSucceeded && dispatchErrorMessage && (
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
              {savedMeetingUrl && (
                <p style={{ ...chapterBodyStyle, marginBottom: 20 }}>
                  Currently saved: <strong style={{ color: COLORS.textPrimary }}>{savedMeetingUrl}</strong>
                  {savedMeetingUpdatedAt && <> — saved {formatSavedAt(savedMeetingUpdatedAt)}.</>}
                </p>
              )}
              {!savedMeetingUrl && (
                <p style={{ ...chapterBodyStyle, marginBottom: 20 }}>
                  For this demo, paste the Google Meet URL you want Clio&apos;s bot to join, then Save.
                </p>
              )}

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
