'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { Loader2, ChevronDown, ChevronRight } from 'lucide-react'
import TemplateRenderer from '@/components/templates/TemplateRenderer'
import type { TemplateSection } from '@/lib/templates/types'
import { COLORS, Card, PrimaryButton, SecondaryButton } from '../../_shared'

/**
 * B2B-31 (docs/specs/B2B-31-requirement-document.md §4, §6.6/§6.7). Owns the
 * whole Visualization tab: auto-fires topic grouping on first visit
 * (E-5/AT-7), an accordion of topics each with a canvas + excerpt/transition
 * textbox (E-7/E-8, AT-4 dirty-state), and the final "copy this JSON
 * payload" panel (E-10) once every current topic has a saved visualization.
 */

interface VisualizationInfo {
  id: string
  excerptText: string
  transitionTrigger: string
  templateSection: TemplateSection
}

interface TopicItem {
  id: string
  title: string
  position: number
  visualization: VisualizationInfo | null
}

interface ContentData {
  title: string | null
  subtitle: string | null
  content_to_explain: string | null
  exists: boolean
}

function defaultTransitionTrigger(topicTitle: string): string {
  return `Now let's look at ${topicTitle}.`
}

const fieldStyle: React.CSSProperties = {
  width: '100%',
  boxSizing: 'border-box',
  background: COLORS.raised,
  border: `1px solid ${COLORS.borderStrong}`,
  borderRadius: 8,
  padding: 10,
  color: COLORS.textPrimary,
  fontSize: 13,
  marginBottom: 16,
  fontFamily: 'inherit',
}

export default function ShowcaseVisualizationClient() {
  const [content, setContent] = useState<ContentData | null>(null)
  const [contentLoadError, setContentLoadError] = useState(false)

  const [topics, setTopics] = useState<TopicItem[] | null>(null)
  const [topicsLoadError, setTopicsLoadError] = useState(false)

  const [grouping, setGrouping] = useState(false)
  const [groupingError, setGroupingError] = useState(false)
  const autoGroupFiredRef = useRef(false)

  const [openTopicId, setOpenTopicId] = useState<string | null>(null)
  const [excerptByTopic, setExcerptByTopic] = useState<Record<string, string>>({})
  const [transitionByTopic, setTransitionByTopic] = useState<Record<string, string>>({})
  const [savingTopicId, setSavingTopicId] = useState<string | null>(null)
  const [saveErrorByTopic, setSaveErrorByTopic] = useState<Record<string, string>>({})
  const [copiedByTopic, setCopiedByTopic] = useState<Record<string, boolean>>({})

  const [contentSourceId, setContentSourceId] = useState<string | null>(null)
  const contentSourceRequestedRef = useRef(false)
  const [payloadCopied, setPayloadCopied] = useState(false)

  async function loadContent() {
    setContentLoadError(false)
    try {
      const res = await fetch('/api/channel-partner/showcase/content')
      if (!res.ok) throw new Error('load failed')
      const data: ContentData = await res.json()
      setContent(data)
    } catch {
      setContentLoadError(true)
    }
  }

  async function loadTopics() {
    setTopicsLoadError(false)
    try {
      const res = await fetch('/api/channel-partner/showcase/topics')
      if (!res.ok) throw new Error('load failed')
      const data: { topics: TopicItem[] } = await res.json()
      setTopics(data.topics)
    } catch {
      setTopicsLoadError(true)
    }
  }

  useEffect(() => {
    loadContent()
    loadTopics()
  }, [])

  async function runGrouping() {
    setGrouping(true)
    setGroupingError(false)
    try {
      const res = await fetch('/api/channel-partner/showcase/topics', { method: 'POST' })
      if (!res.ok) {
        setGroupingError(true)
        return
      }
      await loadTopics()
    } catch {
      setGroupingError(true)
    } finally {
      setGrouping(false)
    }
  }

  // E-5 (AT-7) — auto-fire the grouping call the first time Content exists
  // but zero topics exist yet. Never fires when Content doesn't exist.
  useEffect(() => {
    if (autoGroupFiredRef.current) return
    if (content?.exists && topics !== null && topics.length === 0 && !grouping) {
      autoGroupFiredRef.current = true
      runGrouping()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [content, topics])

  function openTopic(topic: TopicItem) {
    if (openTopicId === topic.id) {
      setOpenTopicId(null)
      return
    }
    setOpenTopicId(topic.id)
    setExcerptByTopic((prev) => (topic.id in prev ? prev : { ...prev, [topic.id]: topic.visualization?.excerptText ?? '' }))
    setTransitionByTopic((prev) =>
      topic.id in prev ? prev : { ...prev, [topic.id]: topic.visualization?.transitionTrigger ?? defaultTransitionTrigger(topic.title) }
    )
  }

  async function handleSaveVisualization(topic: TopicItem) {
    const excerpt = excerptByTopic[topic.id] ?? ''
    const transitionTrigger = transitionByTopic[topic.id] ?? defaultTransitionTrigger(topic.title)

    setSaveErrorByTopic((prev) => ({ ...prev, [topic.id]: '' }))
    setSavingTopicId(topic.id)
    try {
      const res = await fetch(`/api/channel-partner/showcase/visualizations/${topic.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ excerpt, transitionTrigger }),
      })
      if (!res.ok) {
        setSaveErrorByTopic((prev) => ({ ...prev, [topic.id]: "Couldn't generate a visualization. Try again." }))
        return
      }
      const data: { id: string; transitionTrigger: string; templateSection: TemplateSection } = await res.json()
      setTopics((prev) =>
        (prev ?? []).map((t) =>
          t.id === topic.id
            ? { ...t, visualization: { id: data.id, excerptText: excerpt, transitionTrigger: data.transitionTrigger, templateSection: data.templateSection } }
            : t
        )
      )
    } catch {
      setSaveErrorByTopic((prev) => ({ ...prev, [topic.id]: "Couldn't generate a visualization. Try again." }))
    } finally {
      setSavingTopicId(null)
    }
  }

  async function ensureContentSource() {
    if (contentSourceRequestedRef.current) return
    contentSourceRequestedRef.current = true
    try {
      const res = await fetch('/api/channel-partner/showcase/content-source', { method: 'POST' })
      if (!res.ok) return
      const data: { content_source_id: string } = await res.json()
      setContentSourceId(data.content_source_id)
    } catch {
      // Payload panel simply won't render content_source_id yet — no partial/broken JSON is shown.
    }
  }

  const allVisualized = topics !== null && topics.length > 0 && topics.every((t) => t.visualization !== null)

  useEffect(() => {
    if (allVisualized) {
      ensureContentSource()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allVisualized])

  function copyText(text: string, onDone: () => void) {
    navigator.clipboard.writeText(text).then(onDone).catch(() => {})
  }

  if (content === null || topics === null) {
    return (
      <div>
        <h1 className="text-white text-2xl font-bold mb-4">Visualization</h1>
        {contentLoadError || topicsLoadError ? (
          <Card>
            <p style={{ color: COLORS.red, fontSize: 13 }}>Couldn&apos;t load. Try refreshing the page.</p>
          </Card>
        ) : (
          <p style={{ color: COLORS.textSecondary, fontSize: 13 }}>Loading…</p>
        )}
      </div>
    )
  }

  if (!content.exists) {
    return (
      <div>
        <h1 className="text-white text-2xl font-bold mb-4">Visualization</h1>
        <Card>
          <p style={{ color: COLORS.textSecondary, fontSize: 13, marginBottom: 12 }}>
            Nothing to visualize yet. Add and save some Content first.
          </p>
          <Link
            href="/dashboard/channel-partner/showcase"
            style={{ color: COLORS.purple, fontSize: 13, fontWeight: 600, textDecoration: 'none' }}
          >
            Go to Content →
          </Link>
        </Card>
      </div>
    )
  }

  const origin = typeof window !== 'undefined' ? window.location.origin : ''
  const payload =
    allVisualized && contentSourceId
      ? {
          meeting_url: 'REPLACE_WITH_MEETING_URL',
          title: content.title ?? undefined,
          subtitle: content.subtitle ?? undefined,
          content_to_explain: content.content_to_explain ?? undefined,
          content_pages: topics.map((t) => ({
            url: `${origin}/showcase-render/${t.visualization!.id}`,
            media_type: 'html' as const,
            title: t.title,
            transition_trigger: t.visualization!.transitionTrigger,
          })),
          content_source_id: contentSourceId,
        }
      : null

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
        <h1 className="text-white text-2xl font-bold">Visualization</h1>
        {topics.length > 0 && (
          <SecondaryButton disabled={grouping} onClick={runGrouping}>
            {grouping ? 'Regenerating…' : 'Regenerate topics'}
          </SecondaryButton>
        )}
      </div>

      {grouping && topics.length === 0 && (
        <Card style={{ marginBottom: 16 }}>
          <p style={{ color: COLORS.textSecondary, fontSize: 13, display: 'flex', alignItems: 'center', gap: 8, margin: 0 }}>
            <Loader2 className="w-4 h-4 animate-spin" /> Grouping your content into topics...
          </p>
        </Card>
      )}

      {groupingError && (
        <Card style={{ marginBottom: 16 }}>
          <p style={{ color: COLORS.red, fontSize: 13, marginBottom: 12 }}>Couldn&apos;t group your content into topics. Try again.</p>
          <SecondaryButton onClick={runGrouping}>Retry</SecondaryButton>
        </Card>
      )}

      {topics.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 24 }}>
          {topics.map((topic, i) => {
            const isOpen = openTopicId === topic.id
            const excerpt = excerptByTopic[topic.id] ?? ''
            const transitionTrigger = transitionByTopic[topic.id] ?? defaultTransitionTrigger(topic.title)
            const saving = savingTopicId === topic.id
            const saveError = saveErrorByTopic[topic.id]
            const disabled = excerpt.trim() === '' || saving

            return (
              <Card key={topic.id} style={{ padding: 0, overflow: 'hidden' }}>
                <button
                  onClick={() => openTopic(topic)}
                  style={{
                    width: '100%',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    background: 'transparent',
                    border: 'none',
                    padding: 16,
                    cursor: 'pointer',
                    textAlign: 'left',
                  }}
                >
                  <span style={{ color: COLORS.textPrimary, fontSize: 14, fontWeight: 600 }}>
                    {i + 1}. {topic.title}
                  </span>
                  {isOpen ? (
                    <ChevronDown className="w-4 h-4" color={COLORS.textSecondary} />
                  ) : (
                    <ChevronRight className="w-4 h-4" color={COLORS.textSecondary} />
                  )}
                </button>

                {isOpen && (
                  <div style={{ padding: '0 16px 16px', borderTop: `1px solid ${COLORS.borderSubtle}` }}>
                    <div style={{ marginTop: 16, marginBottom: 16 }}>
                      {topic.visualization ? (
                        <TemplateRenderer section={topic.visualization.templateSection} isActive={true} />
                      ) : (
                        <div
                          style={{
                            display: 'flex',
                            height: 256,
                            alignItems: 'center',
                            justifyContent: 'center',
                            background: '#080808',
                            borderRadius: 12,
                            border: '1px solid #1a1a1a',
                          }}
                        >
                          <p style={{ color: COLORS.textMuted, fontSize: 13 }}>Not generated yet — paste an excerpt below and Save.</p>
                        </div>
                      )}
                    </div>

                    <label style={{ display: 'block', color: COLORS.textSecondary, fontSize: 13, fontWeight: 500, marginBottom: 6 }}>
                      Excerpt from your Content for this topic
                    </label>
                    <textarea
                      value={excerpt}
                      onChange={(e) => setExcerptByTopic((prev) => ({ ...prev, [topic.id]: e.target.value }))}
                      maxLength={4000}
                      rows={4}
                      style={{ ...fieldStyle, resize: 'vertical' }}
                    />

                    <label style={{ display: 'block', color: COLORS.textSecondary, fontSize: 13, fontWeight: 500, marginBottom: 6 }}>
                      Transition phrase (spoken cue to move to this topic)
                    </label>
                    <input
                      type="text"
                      value={transitionTrigger}
                      onChange={(e) => setTransitionByTopic((prev) => ({ ...prev, [topic.id]: e.target.value }))}
                      maxLength={500}
                      style={fieldStyle}
                    />

                    {topic.visualization && (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
                        <span style={{ color: COLORS.textSecondary, fontSize: 12 }}>
                          Render URL: {origin}/showcase-render/{topic.visualization.id}
                        </span>
                        <SecondaryButton
                          onClick={() =>
                            copyText(`${origin}/showcase-render/${topic.visualization!.id}`, () => {
                              setCopiedByTopic((prev) => ({ ...prev, [topic.id]: true }))
                              setTimeout(() => setCopiedByTopic((prev) => ({ ...prev, [topic.id]: false })), 1500)
                            })
                          }
                        >
                          {copiedByTopic[topic.id] ? 'Copied' : 'Copy'}
                        </SecondaryButton>
                      </div>
                    )}

                    {saveError && <p style={{ color: COLORS.red, fontSize: 12, marginBottom: 12 }}>{saveError}</p>}

                    <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                      <PrimaryButton disabled={disabled} onClick={() => handleSaveVisualization(topic)}>
                        {saving && (
                          <Loader2 className="inline-block w-3.5 h-3.5 animate-spin mr-1.5" style={{ verticalAlign: 'middle' }} />
                        )}
                        {saving ? 'Generating...' : 'Save'}
                      </PrimaryButton>
                    </div>
                  </div>
                )}
              </Card>
            )
          })}
        </div>
      )}

      {payload && (
        <Card>
          <h2 style={{ fontSize: 16, fontWeight: 600, color: COLORS.textPrimary, margin: '0 0 8px' }}>Session payload — ready to copy</h2>
          <p style={{ color: COLORS.textSecondary, fontSize: 13, marginBottom: 12 }}>
            Paste this into Postman, add your own meeting_url, and fire POST /api/partner/v1/sessions when you&apos;re live.
          </p>
          <pre
            style={{
              background: '#080808',
              border: `1px solid ${COLORS.borderSubtle}`,
              borderRadius: 8,
              padding: 12,
              color: COLORS.textPrimary,
              fontSize: 12,
              overflowX: 'auto',
              marginBottom: 12,
            }}
          >
            {JSON.stringify(payload, null, 2)}
          </pre>
          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <PrimaryButton
              onClick={() =>
                copyText(JSON.stringify(payload, null, 2), () => {
                  setPayloadCopied(true)
                  setTimeout(() => setPayloadCopied(false), 1500)
                })
              }
            >
              {payloadCopied ? 'Copied' : 'Copy JSON'}
            </PrimaryButton>
          </div>
        </Card>
      )}
    </div>
  )
}
