'use client'

import { useState } from 'react'
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
  COLORS,
} from '../_styles'

const TABS = ['Course Overview', 'Transcript', 'Visuals', 'Resources', 'Discussion', 'Learning Check'] as const
type Tab = (typeof TABS)[number]

const VISUAL_BLURBS: Record<string, string> = {
  'what-is-claude': 'Watch input become output — an animated flow diagram.',
  'model-family': 'An interactive capability-vs-speed chart for all four models.',
  'modes-of-interaction': 'Switch between modes and watch each one animate.',
  'choosing-the-right-model': 'Answer two quick questions to get a model recommendation.',
  'what-makes-claude-different': 'Flip each card to see what sets Claude apart.',
}

export default function DemoTopicClient({ topic }: { topic: DemoTopic }) {
  const [activeTab, setActiveTab] = useState<Tab>('Course Overview')
  const [aiClicked, setAiClicked] = useState(false)

  const totalMinutes = topic.chapters.reduce((sum, ch) => {
    const m = parseInt(ch.durationLabel, 10)
    return sum + (Number.isNaN(m) ? 0 : m)
  }, 0)

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
            <button
              type="button"
              style={aiButtonStyle}
              onClick={() => setAiClicked(true)}
              aria-pressed={aiClicked}
            >
              ✨ Learn with AI
            </button>
            {aiClicked && (
              <span style={{ fontSize: 13, color: COLORS.textMuted }}>
                Demo only — nothing is wired up behind this button yet.
              </span>
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
              {topic.slug === 'claude-ai' ? (
                <div style={{ display: 'grid', gap: 12 }}>
                  {topic.chapters.map((ch, i) => (
                    <Link
                      key={ch.id}
                      href={`/demo/claude-ai/visuals/${ch.id}`}
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
                          {VISUAL_BLURBS[ch.id] ?? 'Interactive visual'}
                        </div>
                      </div>
                      <span style={{ color: COLORS.accentBright, fontSize: 18 }}>→</span>
                    </Link>
                  ))}
                </div>
              ) : (
                <div style={{ color: COLORS.textMuted, fontSize: 14 }}>
                  No interactive visuals for this demo course yet.
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
