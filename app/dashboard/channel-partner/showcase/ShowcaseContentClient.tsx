'use client'

import { useEffect, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { COLORS, Card, PrimaryButton } from '../_shared'

/**
 * B2B-31 (docs/specs/B2B-31-requirement-document.md §4). Same dirty-state
 * Save pattern as `SettingsClient.tsx`'s Company-info card: Save disabled
 * while unchanged from the last-loaded value or while in-flight, inline
 * "Saved." flash for 1.5s, inline error on failure.
 */

interface ContentData {
  title: string | null
  subtitle: string | null
  content_to_explain: string | null
  exists: boolean
}

const TITLE_PLACEHOLDER = 'How Clio Works'
const SUBTITLE_PLACEHOLDER = 'A live look at AI-narrated learning'
const CONTENT_PLACEHOLDER =
  'Paste or write the material you want to walk a prospective partner through during a live demo call...'

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

export default function ShowcaseContentClient() {
  const [saved, setSaved] = useState<ContentData | null>(null)
  const [loadError, setLoadError] = useState(false)

  const [title, setTitle] = useState('')
  const [subtitle, setSubtitle] = useState('')
  const [contentToExplain, setContentToExplain] = useState('')

  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [savedFlash, setSavedFlash] = useState(false)

  async function load() {
    setLoadError(false)
    try {
      const res = await fetch('/api/channel-partner/showcase/content')
      if (!res.ok) throw new Error('load failed')
      const data: ContentData = await res.json()
      setSaved(data)
      setTitle(data.title ?? '')
      setSubtitle(data.subtitle ?? '')
      setContentToExplain(data.content_to_explain ?? '')
    } catch {
      setLoadError(true)
    }
  }

  useEffect(() => {
    load()
  }, [])

  const unchanged =
    saved !== null &&
    title === (saved.title ?? '') &&
    subtitle === (saved.subtitle ?? '') &&
    contentToExplain === (saved.content_to_explain ?? '')

  async function handleSave() {
    setSaveError(null)
    setSaving(true)
    try {
      const res = await fetch('/api/channel-partner/showcase/content', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: title.trim() || null,
          subtitle: subtitle.trim() || null,
          contentToExplain: contentToExplain.trim() || null,
        }),
      })
      if (!res.ok) {
        setSaveError("Couldn't save. Try again.")
        return
      }
      setSaved({
        title: title.trim() || null,
        subtitle: subtitle.trim() || null,
        content_to_explain: contentToExplain.trim() || null,
        exists: true,
      })
      setSavedFlash(true)
      setTimeout(() => setSavedFlash(false), 1500)
    } catch {
      setSaveError("Couldn't save. Try again.")
    } finally {
      setSaving(false)
    }
  }

  return (
    <div>
      <h1 className="text-white text-2xl font-bold mb-1">Content</h1>
      <p style={{ color: COLORS.textSecondary, fontSize: 13, marginBottom: 20 }}>
        What you enter here persists indefinitely and is reused across demo calls until you change it.
      </p>

      {loadError && (
        <Card style={{ marginBottom: 16 }}>
          <p style={{ color: COLORS.red, fontSize: 13 }}>Couldn&apos;t load your content. Try refreshing the page.</p>
        </Card>
      )}

      <Card>
        <label style={{ display: 'block', color: COLORS.textSecondary, fontSize: 13, fontWeight: 500, marginBottom: 6 }}>
          Title
        </label>
        <input
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          maxLength={200}
          placeholder={TITLE_PLACEHOLDER}
          disabled={saved === null}
          style={fieldStyle}
        />

        <label style={{ display: 'block', color: COLORS.textSecondary, fontSize: 13, fontWeight: 500, marginBottom: 6 }}>
          Subtitle
        </label>
        <input
          type="text"
          value={subtitle}
          onChange={(e) => setSubtitle(e.target.value)}
          maxLength={300}
          placeholder={SUBTITLE_PLACEHOLDER}
          disabled={saved === null}
          style={fieldStyle}
        />

        <label style={{ display: 'block', color: COLORS.textSecondary, fontSize: 13, fontWeight: 500, marginBottom: 6 }}>
          Content
        </label>
        <textarea
          value={contentToExplain}
          onChange={(e) => setContentToExplain(e.target.value)}
          maxLength={5000}
          rows={10}
          placeholder={CONTENT_PLACEHOLDER}
          disabled={saved === null}
          style={{ ...fieldStyle, resize: 'vertical' }}
        />

        {saveError && <p style={{ color: COLORS.red, fontSize: 12, marginBottom: 12 }}>{saveError}</p>}
        {savedFlash && <p style={{ color: COLORS.green, fontSize: 12, marginBottom: 12 }}>Saved.</p>}

        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <PrimaryButton disabled={saved === null || unchanged || saving} onClick={handleSave}>
            {saving && <Loader2 className="inline-block w-3.5 h-3.5 animate-spin mr-1.5" style={{ verticalAlign: 'middle' }} />}
            Save
          </PrimaryButton>
        </div>
      </Card>
    </div>
  )
}
