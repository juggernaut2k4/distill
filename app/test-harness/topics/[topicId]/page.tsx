'use client'

import { useEffect, useState, useRef } from 'react'
import Link from 'next/link'
import { Loader2 } from 'lucide-react'
import {
  COLORS,
  pageStyle,
  containerStyle,
  cardStyle,
  labelStyle,
  fieldStyle,
  primaryButtonStyle,
  secondaryButtonStyle,
  linkButtonStyle,
  disabledStyle,
} from '../../_styles'
import { shallowFieldsEqual } from '@/lib/test-harness/dirty-state'

/**
 * /test-harness/topics/[topicId] — Screen B: Topic + Screen authoring
 *
 * B2B-32 (docs/specs/B2B-32-requirement-document.md §4 Screen B, §5, AT-10, AT-11, AT-12). Same
 * dirty-state Save pattern as `ShowcaseContentClient.tsx` for both the topic form and every
 * in-place screen edit: Save disabled while unchanged from the last-saved values or while
 * in-flight, inline "Saved." flash for ~1.5s, inline error on failure — never autosave (§0 point
 * 9). The pasted-HTML preview is a sandboxed `<iframe srcDoc sandbox="allow-scripts">` with no
 * `allow-same-origin` — the only place pasted HTML is ever rendered inside the authoring UI, never
 * via `dangerouslySetInnerHTML` (§0 point 6, AT-10).
 */

interface ScreenItem {
  id: string
  screenType: 'html' | 'image'
  position: number
  title: string | null
  transitionTrigger: string
  htmlContent: string | null
  hasImage: boolean
}

interface TopicFields {
  title: string | null
  subtitle: string | null
  content_to_explain: string | null
}

function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs)
    return () => clearTimeout(timer)
  }, [value, delayMs])
  return debounced
}

function SandboxedPreview({ html }: { html: string }) {
  const debounced = useDebouncedValue(html, 300)
  if (debounced.trim().length === 0) {
    return (
      <div style={{ ...fieldStyle, minHeight: 160, display: 'flex', alignItems: 'center', justifyContent: 'center', color: COLORS.textMuted }}>
        Paste HTML above to preview it here.
      </div>
    )
  }
  return (
    <iframe
      srcDoc={debounced}
      sandbox="allow-scripts"
      title="HTML screen preview"
      style={{ width: '100%', minHeight: 220, border: `1px solid ${COLORS.borderStrong}`, borderRadius: 8, background: '#ffffff' }}
    />
  )
}

export default function TestHarnessTopicPage({ params }: { params: { topicId: string } }) {
  const topicId = params.topicId

  const [saved, setSaved] = useState<TopicFields | null>(null)
  const [title, setTitle] = useState('')
  const [subtitle, setSubtitle] = useState('')
  const [contentToExplain, setContentToExplain] = useState('')
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [savedFlash, setSavedFlash] = useState(false)
  const [loadError, setLoadError] = useState(false)

  const [screens, setScreens] = useState<ScreenItem[]>([])
  const [editingId, setEditingId] = useState<string | null>(null)

  const [addMode, setAddMode] = useState<'html' | 'image' | null>(null)

  async function load() {
    setLoadError(false)
    try {
      const res = await fetch(`/api/test-harness/topics/${topicId}`)
      if (!res.ok) throw new Error('load failed')
      const data = (await res.json()) as { topic: TopicFields; screens: ScreenItem[] }
      setSaved(data.topic)
      setTitle(data.topic.title ?? '')
      setSubtitle(data.topic.subtitle ?? '')
      setContentToExplain(data.topic.content_to_explain ?? '')
      setScreens(data.screens)
    } catch {
      setLoadError(true)
    }
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [topicId])

  const topicUnchanged =
    saved !== null &&
    shallowFieldsEqual(
      { title, subtitle, contentToExplain },
      { title: saved.title ?? '', subtitle: saved.subtitle ?? '', contentToExplain: saved.content_to_explain ?? '' }
    )

  async function handleSaveTopic() {
    setSaveError(null)
    setSaving(true)
    try {
      const res = await fetch(`/api/test-harness/topics/${topicId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: title.trim() || null,
          subtitle: subtitle.trim() || null,
          content_to_explain: contentToExplain.trim() || null,
        }),
      })
      if (!res.ok) {
        setSaveError("Couldn't save. Try again.")
        return
      }
      setSaved({ title: title.trim() || null, subtitle: subtitle.trim() || null, content_to_explain: contentToExplain.trim() || null })
      setSavedFlash(true)
      setTimeout(() => setSavedFlash(false), 1500)
    } catch {
      setSaveError("Couldn't save. Try again.")
    } finally {
      setSaving(false)
    }
  }

  async function handleMove(screenId: string, direction: 'up' | 'down') {
    const index = screens.findIndex((s) => s.id === screenId)
    const swapIndex = direction === 'up' ? index - 1 : index + 1
    if (index === -1 || swapIndex < 0 || swapIndex >= screens.length) return

    const a = screens[index]
    const b = screens[swapIndex]

    await Promise.all([
      fetch(`/api/test-harness/screens/${a.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ position: b.position }),
      }),
      fetch(`/api/test-harness/screens/${b.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ position: a.position }),
      }),
    ])
    await load()
  }

  async function handleDeleteScreen(screenId: string) {
    if (!window.confirm('Delete this screen?')) return
    await fetch(`/api/test-harness/screens/${screenId}`, { method: 'DELETE' })
    await load()
  }

  return (
    <div style={pageStyle}>
      <div style={containerStyle}>
        <Link href="/test-harness" style={{ color: COLORS.textSecondary, fontSize: 13, textDecoration: 'none' }}>
          &larr; Back to topics
        </Link>

        {loadError && (
          <div style={{ ...cardStyle, marginTop: 16 }}>
            <p style={{ color: COLORS.red, fontSize: 13, margin: 0 }}>Couldn&apos;t load this topic. Try refreshing the page.</p>
          </div>
        )}

        {/* ─── Topic fields ─── */}
        <div style={{ ...cardStyle, marginTop: 16 }}>
          <label style={{ ...labelStyle, marginTop: 0 }}>Title</label>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            maxLength={200}
            placeholder="Q3 AI Strategy Briefing"
            disabled={saved === null}
            style={fieldStyle}
          />

          <label style={labelStyle}>Subtitle</label>
          <input
            type="text"
            value={subtitle}
            onChange={(e) => setSubtitle(e.target.value)}
            maxLength={300}
            placeholder="A test of HTML + image screen rendering"
            disabled={saved === null}
            style={fieldStyle}
          />

          <label style={labelStyle}>Content to explain</label>
          <textarea
            value={contentToExplain}
            onChange={(e) => setContentToExplain(e.target.value)}
            maxLength={5000}
            rows={6}
            placeholder="Walk through the current-state overview, the three strategic bets, and risk posture."
            disabled={saved === null}
            style={{ ...fieldStyle, resize: 'vertical' }}
          />

          {saveError && <p style={{ color: COLORS.red, fontSize: 12, marginTop: 12 }}>{saveError}</p>}
          {savedFlash && <p style={{ color: COLORS.green, fontSize: 12, marginTop: 12 }}>Saved.</p>}

          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 16 }}>
            <button
              style={{ ...primaryButtonStyle, ...disabledStyle(saved === null || topicUnchanged || saving) }}
              disabled={saved === null || topicUnchanged || saving}
              onClick={handleSaveTopic}
            >
              {saving && <Loader2 className="inline-block w-3.5 h-3.5 animate-spin mr-1.5" style={{ verticalAlign: 'middle' }} />}
              Save
            </button>
          </div>
        </div>

        {/* ─── Screens list ─── */}
        <div style={cardStyle}>
          <h2 style={{ fontSize: 16, fontWeight: 600, margin: 0 }}>Screens</h2>
          <p style={{ color: COLORS.textSecondary, fontSize: 13, marginTop: 6, marginBottom: 16 }}>
            Each screen becomes one page in the real content_pages payload, in this order.
          </p>

          {screens.length === 0 && <p style={{ color: COLORS.textMuted, fontSize: 13 }}>No screens yet — add one below.</p>}

          {screens.map((screen, idx) =>
            editingId === screen.id ? (
              <EditScreenRow
                key={screen.id}
                screen={screen}
                index={idx}
                onCancelled={() => setEditingId(null)}
                onSaved={async () => {
                  setEditingId(null)
                  await load()
                }}
              />
            ) : (
              <div key={screen.id} style={{ borderTop: idx === 0 ? 'none' : `1px solid ${COLORS.border}`, padding: '12px 0' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' }}>
                  <div>
                    <span
                      style={{
                        display: 'inline-block',
                        fontSize: 11,
                        fontWeight: 700,
                        letterSpacing: 0.5,
                        color: screen.screenType === 'html' ? COLORS.accent : '#06b6d4',
                        border: `1px solid ${screen.screenType === 'html' ? COLORS.accent : '#06b6d4'}`,
                        borderRadius: 4,
                        padding: '2px 6px',
                        marginRight: 8,
                      }}
                    >
                      {screen.screenType.toUpperCase()}
                    </span>
                    <span style={{ fontSize: 14, fontWeight: 500 }}>{screen.title || `Screen ${idx + 1}`}</span>
                    <div style={{ color: COLORS.textSecondary, fontSize: 12, marginTop: 4 }}>&ldquo;{screen.transitionTrigger}&rdquo;</div>
                  </div>
                  <div style={{ display: 'flex', gap: 4, alignItems: 'center', flexShrink: 0 }}>
                    <button style={linkButtonStyle} onClick={() => handleMove(screen.id, 'up')} disabled={idx === 0} aria-label="Move up">
                      &uarr;
                    </button>
                    <button
                      style={linkButtonStyle}
                      onClick={() => handleMove(screen.id, 'down')}
                      disabled={idx === screens.length - 1}
                      aria-label="Move down"
                    >
                      &darr;
                    </button>
                    <a href={`/test-harness-render/${screen.id}`} target="_blank" rel="noreferrer" style={{ ...linkButtonStyle, textDecoration: 'none', display: 'inline-block' }}>
                      Preview
                    </a>
                    <button style={linkButtonStyle} onClick={() => setEditingId(screen.id)}>
                      Edit
                    </button>
                    <button style={{ ...linkButtonStyle, color: COLORS.red }} onClick={() => handleDeleteScreen(screen.id)}>
                      Delete
                    </button>
                  </div>
                </div>
              </div>
            )
          )}

          <div style={{ marginTop: 20, borderTop: `1px solid ${COLORS.border}`, paddingTop: 20 }}>
            <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
              <span style={{ color: COLORS.textSecondary, fontSize: 13, alignSelf: 'center', marginRight: 4 }}>Add a screen —</span>
              <button
                style={addMode === 'html' ? primaryButtonStyle : secondaryButtonStyle}
                onClick={() => setAddMode(addMode === 'html' ? null : 'html')}
              >
                HTML
              </button>
              <button
                style={addMode === 'image' ? primaryButtonStyle : secondaryButtonStyle}
                onClick={() => setAddMode(addMode === 'image' ? null : 'image')}
              >
                Image
              </button>
            </div>

            {addMode === 'html' && (
              <AddHtmlScreenForm
                topicId={topicId}
                onAdded={async () => {
                  setAddMode(null)
                  await load()
                }}
              />
            )}
            {addMode === 'image' && (
              <AddImageScreenForm
                topicId={topicId}
                onAdded={async () => {
                  setAddMode(null)
                  await load()
                }}
              />
            )}
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 20 }}>
            <Link href={`/test-harness/topics/${topicId}/payload`} style={{ textDecoration: 'none' }}>
              <span style={primaryButtonStyle}>Review payload &rarr;</span>
            </Link>
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── Add — HTML screen ──────────────────────────────────────────────────────

function AddHtmlScreenForm({ topicId, onAdded }: { topicId: string; onAdded: () => void | Promise<void> }) {
  const [title, setTitle] = useState('')
  const [transitionTrigger, setTransitionTrigger] = useState('')
  const [htmlContent, setHtmlContent] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const canAdd = htmlContent.trim().length > 0 && transitionTrigger.trim().length > 0

  async function handleAdd() {
    setError(null)
    setSaving(true)
    try {
      const res = await fetch('/api/test-harness/screens', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          topic_id: topicId,
          screen_type: 'html',
          title: title.trim() || undefined,
          transition_trigger: transitionTrigger.trim(),
          html_content: htmlContent,
        }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => null)
        setError(body?.error?.message ?? "Couldn't add screen. Try again.")
        return
      }
      await onAdded()
    } catch {
      setError("Couldn't add screen. Try again.")
    } finally {
      setSaving(false)
    }
  }

  return (
    <div style={{ background: '#101010', border: `1px solid ${COLORS.border}`, borderRadius: 8, padding: 16 }}>
      <h3 style={{ fontSize: 14, fontWeight: 600, margin: 0 }}>Add a screen — HTML</h3>

      <label style={labelStyle}>Title (optional)</label>
      <input type="text" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} placeholder="Where we are today" style={fieldStyle} />

      <label style={labelStyle}>Transition trigger — when should the bot move on?</label>
      <input
        type="text"
        value={transitionTrigger}
        onChange={(e) => setTransitionTrigger(e.target.value)}
        maxLength={500}
        placeholder="move on after the current-state overview"
        style={fieldStyle}
      />

      <label style={labelStyle}>Paste your HTML</label>
      <textarea
        value={htmlContent}
        onChange={(e) => setHtmlContent(e.target.value)}
        maxLength={500000}
        rows={12}
        placeholder='<div style="...">...</div>'
        style={{ ...fieldStyle, resize: 'vertical', fontFamily: 'ui-monospace, monospace', fontSize: 12 }}
      />

      <label style={labelStyle}>Preview (sandboxed)</label>
      <SandboxedPreview html={htmlContent} />

      {error && <p style={{ color: COLORS.red, fontSize: 12, marginTop: 12 }}>{error}</p>}

      <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 16 }}>
        <button style={{ ...primaryButtonStyle, ...disabledStyle(!canAdd || saving) }} disabled={!canAdd || saving} onClick={handleAdd}>
          {saving ? 'Adding…' : 'Add'}
        </button>
      </div>
    </div>
  )
}

// ─── Add — Image screen ─────────────────────────────────────────────────────

function AddImageScreenForm({ topicId, onAdded }: { topicId: string; onAdded: () => void | Promise<void> }) {
  const [title, setTitle] = useState('')
  const [transitionTrigger, setTransitionTrigger] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [clientError, setClientError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const ALLOWED = ['image/png', 'image/jpeg', 'image/gif', 'image/webp']
  const MAX_BYTES = 10 * 1024 * 1024

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const chosen = e.target.files?.[0] ?? null
    setClientError(null)
    if (!chosen) {
      setFile(null)
      setPreviewUrl(null)
      return
    }
    if (chosen.size > MAX_BYTES || !ALLOWED.includes(chosen.type)) {
      setClientError('File must be PNG, JPEG, GIF, or WebP, under 10 MB.')
      setFile(null)
      setPreviewUrl(null)
      return
    }
    setFile(chosen)
    setPreviewUrl(URL.createObjectURL(chosen))
  }

  const canAdd = file !== null && transitionTrigger.trim().length > 0

  async function handleAdd() {
    if (!file) return
    setError(null)
    setSaving(true)
    try {
      const formData = new FormData()
      formData.set('topic_id', topicId)
      formData.set('screen_type', 'image')
      formData.set('title', title.trim())
      formData.set('transition_trigger', transitionTrigger.trim())
      formData.set('file', file)

      const res = await fetch('/api/test-harness/screens', { method: 'POST', body: formData })
      if (!res.ok) {
        const body = await res.json().catch(() => null)
        setError(body?.error?.message ?? "Couldn't add screen. Try again.")
        return
      }
      if (fileInputRef.current) fileInputRef.current.value = ''
      await onAdded()
    } catch {
      setError("Couldn't add screen. Try again.")
    } finally {
      setSaving(false)
    }
  }

  return (
    <div style={{ background: '#101010', border: `1px solid ${COLORS.border}`, borderRadius: 8, padding: 16 }}>
      <h3 style={{ fontSize: 14, fontWeight: 600, margin: 0 }}>Add a screen — Image</h3>

      <label style={labelStyle}>Title (optional)</label>
      <input type="text" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} placeholder="The three bets" style={fieldStyle} />

      <label style={labelStyle}>Transition trigger — when should the bot move on?</label>
      <input
        type="text"
        value={transitionTrigger}
        onChange={(e) => setTransitionTrigger(e.target.value)}
        maxLength={500}
        placeholder="advance once the three bets are introduced"
        style={fieldStyle}
      />

      <label style={labelStyle}>Image file</label>
      <input ref={fileInputRef} type="file" accept="image/png,image/jpeg,image/gif,image/webp" onChange={handleFileChange} style={{ color: COLORS.textPrimary, fontSize: 13 }} />
      {clientError && <p style={{ color: COLORS.red, fontSize: 12, marginTop: 8 }}>{clientError}</p>}

      {previewUrl && (
        <>
          <label style={labelStyle}>Preview</label>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={previewUrl} alt="Selected file preview" style={{ maxWidth: '100%', maxHeight: 300, borderRadius: 8, border: `1px solid ${COLORS.borderStrong}` }} />
        </>
      )}

      {error && <p style={{ color: COLORS.red, fontSize: 12, marginTop: 12 }}>{error}</p>}

      <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 16 }}>
        <button style={{ ...primaryButtonStyle, ...disabledStyle(!canAdd || saving) }} disabled={!canAdd || saving} onClick={handleAdd}>
          {saving ? 'Adding…' : 'Add'}
        </button>
      </div>
    </div>
  )
}

// ─── Edit (in place) — either screen type ───────────────────────────────────

function EditScreenRow({
  screen,
  index,
  onCancelled,
  onSaved,
}: {
  screen: ScreenItem
  index: number
  onCancelled: () => void
  onSaved: () => void | Promise<void>
}) {
  const [title, setTitle] = useState(screen.title ?? '')
  const [transitionTrigger, setTransitionTrigger] = useState(screen.transitionTrigger)
  const [htmlContent, setHtmlContent] = useState(screen.htmlContent ?? '')
  const [replaceFile, setReplaceFile] = useState<File | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const textFieldsUnchanged = shallowFieldsEqual(
    { title, transitionTrigger, htmlContent },
    { title: screen.title ?? '', transitionTrigger: screen.transitionTrigger, htmlContent: screen.htmlContent ?? '' }
  )
  const unchanged = screen.screenType === 'html' ? textFieldsUnchanged : title === (screen.title ?? '') && transitionTrigger === screen.transitionTrigger && replaceFile === null

  async function handleSave() {
    setError(null)
    setSaving(true)
    try {
      let res: Response
      if (screen.screenType === 'html') {
        res = await fetch(`/api/test-harness/screens/${screen.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ title: title.trim() || null, transition_trigger: transitionTrigger.trim(), html_content: htmlContent }),
        })
      } else {
        const formData = new FormData()
        formData.set('title', title.trim())
        formData.set('transition_trigger', transitionTrigger.trim())
        if (replaceFile) formData.set('file', replaceFile)
        res = await fetch(`/api/test-harness/screens/${screen.id}`, { method: 'PATCH', body: formData })
      }
      if (!res.ok) {
        const body = await res.json().catch(() => null)
        setError(body?.error?.message ?? "Couldn't save. Try again.")
        return
      }
      await onSaved()
    } catch {
      setError("Couldn't save. Try again.")
    } finally {
      setSaving(false)
    }
  }

  return (
    <div style={{ borderTop: index === 0 ? 'none' : `1px solid ${COLORS.border}`, padding: '12px 0' }}>
      <div style={{ background: '#101010', border: `1px solid ${COLORS.border}`, borderRadius: 8, padding: 16 }}>
        <label style={{ ...labelStyle, marginTop: 0 }}>Title (optional)</label>
        <input type="text" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} style={fieldStyle} />

        <label style={labelStyle}>Transition trigger</label>
        <input type="text" value={transitionTrigger} onChange={(e) => setTransitionTrigger(e.target.value)} maxLength={500} style={fieldStyle} />

        {screen.screenType === 'html' ? (
          <>
            <label style={labelStyle}>Your HTML</label>
            <textarea
              value={htmlContent}
              onChange={(e) => setHtmlContent(e.target.value)}
              maxLength={500000}
              rows={12}
              style={{ ...fieldStyle, resize: 'vertical', fontFamily: 'ui-monospace, monospace', fontSize: 12 }}
            />
            <label style={labelStyle}>Preview (sandboxed)</label>
            <SandboxedPreview html={htmlContent} />
          </>
        ) : (
          <>
            <label style={labelStyle}>Replace image (leave untouched to keep the existing image)</label>
            <input
              type="file"
              accept="image/png,image/jpeg,image/gif,image/webp"
              onChange={(e) => setReplaceFile(e.target.files?.[0] ?? null)}
              style={{ color: COLORS.textPrimary, fontSize: 13 }}
            />
          </>
        )}

        {error && <p style={{ color: COLORS.red, fontSize: 12, marginTop: 12 }}>{error}</p>}

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
          <button style={secondaryButtonStyle} onClick={onCancelled}>
            Cancel
          </button>
          <button style={{ ...primaryButtonStyle, ...disabledStyle(unchanged || saving) }} disabled={unchanged || saving} onClick={handleSave}>
            {saving && <Loader2 className="inline-block w-3.5 h-3.5 animate-spin mr-1.5" style={{ verticalAlign: 'middle' }} />}
            Save
          </button>
        </div>
      </div>
    </div>
  )
}
