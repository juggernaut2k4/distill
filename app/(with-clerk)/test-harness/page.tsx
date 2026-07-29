'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import {
  COLORS,
  pageStyle,
  containerStyle,
  cardStyle,
  primaryButtonStyle,
  linkButtonStyle,
} from './_styles'

/**
 * /test-harness — Screen A: Topics list
 *
 * B2B-32 (docs/specs/B2B-32-requirement-document.md §4 Screen A, §5). Basic-Auth-gated at the
 * middleware layer (test.hello-clio.com host branch) — no client-side auth here. "+ New topic"
 * creates an empty topic and navigates straight to Screen B (the title/subtitle/body form lives
 * there, not a separate creation modal). Delete confirms via a native `window.confirm` — no custom
 * modal needed for a single-user tool — and is the only removal path (retention is indefinite, §0
 * point 9).
 */

interface TopicListItem {
  id: string
  title: string | null
  screenCount: number
  updatedAt: string
}

function formatRelativeTime(iso: string): string {
  const then = new Date(iso).getTime()
  const now = Date.now()
  const diffMs = Math.max(0, now - then)
  const minutes = Math.floor(diffMs / 60_000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'} ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`
  const days = Math.floor(hours / 24)
  return `${days} day${days === 1 ? '' : 's'} ago`
}

export default function TestHarnessTopicsPage() {
  const [topics, setTopics] = useState<TopicListItem[] | null>(null)
  const [loadError, setLoadError] = useState(false)
  const [creating, setCreating] = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)

  async function load() {
    setLoadError(false)
    try {
      const res = await fetch('/api/test-harness/topics')
      if (!res.ok) throw new Error('load failed')
      const data = (await res.json()) as { topics: TopicListItem[] }
      setTopics(data.topics)
    } catch {
      setLoadError(true)
    }
  }

  useEffect(() => {
    load()
  }, [])

  async function handleNewTopic() {
    setCreating(true)
    try {
      const res = await fetch('/api/test-harness/topics', { method: 'POST' })
      if (!res.ok) throw new Error('create failed')
      const data = (await res.json()) as { id: string }
      window.location.href = `/test-harness/topics/${data.id}`
    } catch {
      setCreating(false)
    }
  }

  async function handleDelete(id: string) {
    if (!window.confirm('Delete this test topic and all its screens? This cannot be undone.')) return
    setDeletingId(id)
    try {
      const res = await fetch(`/api/test-harness/topics/${id}`, { method: 'DELETE' })
      if (!res.ok) throw new Error('delete failed')
      setTopics((prev) => (prev ?? []).filter((t) => t.id !== id))
    } finally {
      setDeletingId(null)
    }
  }

  return (
    <div style={pageStyle}>
      <div style={containerStyle}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16, flexWrap: 'wrap' }}>
          <div>
            <h1 style={{ fontSize: 22, fontWeight: 700, margin: 0 }}>Test Content Harness</h1>
            <p style={{ color: COLORS.textSecondary, fontSize: 13, marginTop: 8, maxWidth: 520 }}>
              Hand-authored fixtures for testing the real B2B-19 content pipeline. Nothing here is AI-generated.
            </p>
          </div>
          <button style={primaryButtonStyle} onClick={handleNewTopic} disabled={creating}>
            {creating ? 'Creating…' : '+ New topic'}
          </button>
        </div>

        {loadError && (
          <div style={{ ...cardStyle, marginTop: 24 }}>
            <p style={{ color: COLORS.red, fontSize: 13, margin: 0 }}>Couldn&apos;t load topics. Try refreshing the page.</p>
          </div>
        )}

        {topics === null && !loadError && (
          <p style={{ color: COLORS.textMuted, fontSize: 13, marginTop: 32 }}>Loading…</p>
        )}

        {topics !== null && topics.length === 0 && (
          <p style={{ color: COLORS.textMuted, fontSize: 13, marginTop: 32 }}>No test topics yet.</p>
        )}

        {topics !== null && topics.length > 0 && (
          <div style={{ marginTop: 24 }}>
            {topics.map((topic) => (
              <div
                key={topic.id}
                style={{
                  ...cardStyle,
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  gap: 16,
                  flexWrap: 'wrap',
                }}
              >
                <Link href={`/test-harness/topics/${topic.id}`} style={{ color: COLORS.textPrimary, textDecoration: 'none', flex: 1, minWidth: 200 }}>
                  <div style={{ fontSize: 15, fontWeight: 600 }}>{topic.title || '(untitled topic)'}</div>
                  <div style={{ color: COLORS.textSecondary, fontSize: 12, marginTop: 4 }}>
                    {topic.screenCount} screen{topic.screenCount === 1 ? '' : 's'} &middot; {formatRelativeTime(topic.updatedAt)}
                  </div>
                </Link>
                <button
                  style={linkButtonStyle}
                  onClick={() => handleDelete(topic.id)}
                  disabled={deletingId === topic.id}
                >
                  {deletingId === topic.id ? 'Deleting…' : 'Delete'}
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
