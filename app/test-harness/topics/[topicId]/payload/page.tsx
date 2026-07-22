'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Loader2 } from 'lucide-react'
import { COLORS, pageStyle, containerStyle, cardStyle, labelStyle, fieldStyle, primaryButtonStyle, secondaryButtonStyle, disabledStyle } from '../../../_styles'
import { buildPostmanCollection, slugify, type PostmanCollectionV21 } from '@/lib/test-harness/postman'
import { PLACEHOLDER_MEETING_URL, type TestHarnessPayload } from '@/lib/test-harness/payload-types'

/**
 * /test-harness/topics/[topicId]/payload — Screen C: Payload review / dispatch
 *
 * B2B-32 (docs/specs/B2B-32-requirement-document.md §4 Screen C, §0 point 10, AT-13 through AT-16).
 * Both dispatch paths ship together (Arun's explicit confirmation, §0 point 10): an in-tool
 * "Dispatch now" (server-side proxy to the real `POST /api/partner/v1/sessions`, relayed verbatim)
 * and a client-side-generated "Download Postman collection" (never embeds the real API key, AT-15;
 * byte-identical to the on-screen JSON, AT-16). Both read from the same in-memory payload state —
 * the JSON panel's own `meeting_url` field live-updates from the Meeting URL input with no re-fetch.
 */

type DispatchState =
  | { status: 'idle' }
  | { status: 'in-flight' }
  | { status: 'success'; clioSessionRef: string; sessionStatus: string; renderUrl: string }
  | { status: 'error'; code: string; message: string }

export default function TestHarnessPayloadPage({ params }: { params: { topicId: string } }) {
  const topicId = params.topicId

  const [topicTitle, setTopicTitle] = useState('')
  const [basePayload, setBasePayload] = useState<TestHarnessPayload | null>(null)
  const [loadState, setLoadState] = useState<'loading' | 'ok' | 'no_screens' | 'error'>('loading')
  const [meetingUrl, setMeetingUrl] = useState('')
  const [copied, setCopied] = useState(false)
  const [dispatch, setDispatch] = useState<DispatchState>({ status: 'idle' })

  useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        const [topicRes, payloadRes] = await Promise.all([
          fetch(`/api/test-harness/topics/${topicId}`),
          fetch(`/api/test-harness/payload/${topicId}`),
        ])
        if (cancelled) return

        if (topicRes.ok) {
          const topicData = (await topicRes.json()) as { topic: { title: string | null } }
          setTopicTitle(topicData.topic.title ?? '')
        }

        if (payloadRes.status === 422) {
          setLoadState('no_screens')
          return
        }
        if (!payloadRes.ok) {
          setLoadState('error')
          return
        }
        const payloadData = (await payloadRes.json()) as { payload: TestHarnessPayload }
        setBasePayload(payloadData.payload)
        setLoadState('ok')
      } catch {
        if (!cancelled) setLoadState('error')
      }
    }
    load()
    return () => {
      cancelled = true
    }
  }, [topicId])

  const displayedPayload: TestHarnessPayload | null = basePayload
    ? { ...basePayload, meeting_url: meetingUrl.trim() || PLACEHOLDER_MEETING_URL }
    : null

  const meetingUrlLooksValid = (() => {
    if (meetingUrl.trim().length === 0) return false
    try {
      // eslint-disable-next-line no-new
      new URL(meetingUrl.trim())
      return true
    } catch {
      return false
    }
  })()

  async function handleCopyJson() {
    if (!displayedPayload) return
    await navigator.clipboard.writeText(JSON.stringify(displayedPayload, null, 2))
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  function handleDownloadPostman() {
    if (!displayedPayload) return
    const collection: PostmanCollectionV21 = buildPostmanCollection(topicTitle, displayedPayload)
    const blob = new Blob([JSON.stringify(collection, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `clio-test-harness-${slugify(topicTitle || 'untitled')}.postman_collection.json`
    a.click()
    URL.revokeObjectURL(url)
  }

  async function handleDispatch() {
    if (!meetingUrlLooksValid) return
    setDispatch({ status: 'in-flight' })
    try {
      const res = await fetch(`/api/test-harness/dispatch/${topicId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ meeting_url: meetingUrl.trim() }),
      })
      const body = await res.json().catch(() => null)
      if (res.ok && body?.clio_session_ref) {
        setDispatch({
          status: 'success',
          clioSessionRef: body.clio_session_ref,
          sessionStatus: body.status ?? 'unknown',
          renderUrl: body.render_url ?? '',
        })
      } else {
        setDispatch({
          status: 'error',
          code: body?.error?.code ?? 'unknown',
          message: body?.error?.message ?? 'Something went wrong. Try again.',
        })
      }
    } catch {
      setDispatch({ status: 'error', code: 'network_error', message: "Couldn't reach the session endpoint. Try again." })
    }
  }

  return (
    <div style={pageStyle}>
      <div style={containerStyle}>
        <Link href={`/test-harness/topics/${topicId}`} style={{ color: COLORS.textSecondary, fontSize: 13, textDecoration: 'none' }}>
          &larr; Back
        </Link>

        {loadState === 'loading' && <p style={{ color: COLORS.textMuted, fontSize: 13, marginTop: 24 }}>Loading…</p>}

        {loadState === 'error' && (
          <div style={{ ...cardStyle, marginTop: 16 }}>
            <p style={{ color: COLORS.red, fontSize: 13, margin: 0 }}>Couldn&apos;t prepare the payload. Try again.</p>
          </div>
        )}

        {loadState === 'no_screens' && (
          <div style={{ ...cardStyle, marginTop: 16 }}>
            <p style={{ fontSize: 14, margin: 0 }}>Add at least one screen before reviewing a payload.</p>
            <div style={{ marginTop: 16 }}>
              <Link href={`/test-harness/topics/${topicId}`} style={{ textDecoration: 'none' }}>
                <span style={secondaryButtonStyle}>&larr; Back</span>
              </Link>
            </div>
          </div>
        )}

        {loadState === 'ok' && displayedPayload && (
          <div style={{ ...cardStyle, marginTop: 16 }}>
            <h1 style={{ fontSize: 18, fontWeight: 700, margin: 0 }}>Session payload — ready to test</h1>
            <p style={{ color: COLORS.textSecondary, fontSize: 13, marginTop: 8 }}>
              This is the exact real payload for POST /api/partner/v1/sessions. Fire it below, or download it as a Postman collection to run it
              yourself.
            </p>

            <pre
              style={{
                background: '#050505',
                border: `1px solid ${COLORS.border}`,
                borderRadius: 8,
                padding: 16,
                fontSize: 12,
                overflowX: 'auto',
                color: COLORS.textPrimary,
                marginTop: 16,
              }}
            >
              {JSON.stringify(displayedPayload, null, 2)}
            </pre>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 12, alignItems: 'center', marginTop: 8 }}>
              {copied && <span style={{ color: COLORS.green, fontSize: 12 }}>Copied.</span>}
              <button style={secondaryButtonStyle} onClick={handleCopyJson}>
                Copy JSON
              </button>
            </div>

            {dispatch.status !== 'success' && (
              <>
                <label style={labelStyle}>Meeting URL</label>
                <input
                  type="url"
                  value={meetingUrl}
                  onChange={(e) => setMeetingUrl(e.target.value)}
                  placeholder="https://meet.google.com/abc-defg-hij"
                  style={fieldStyle}
                  disabled={dispatch.status === 'in-flight'}
                />
              </>
            )}

            {dispatch.status === 'error' && (
              <div style={{ marginTop: 16, padding: 16, borderRadius: 8, border: `1px solid ${COLORS.red}`, background: 'rgba(239,68,68,0.08)' }}>
                <p style={{ color: COLORS.red, fontSize: 13, fontWeight: 600, margin: 0 }}>&#10007; Dispatch failed: {dispatch.code}</p>
                <p style={{ color: COLORS.textSecondary, fontSize: 13, marginTop: 6 }}>{dispatch.message}</p>
              </div>
            )}

            {dispatch.status === 'success' && (
              <div style={{ marginTop: 16, padding: 16, borderRadius: 8, border: `1px solid ${COLORS.green}`, background: 'rgba(34,197,94,0.08)' }}>
                <p style={{ color: COLORS.green, fontSize: 13, fontWeight: 600, margin: 0 }}>&#10003; Session dispatched.</p>
                <p style={{ color: COLORS.textSecondary, fontSize: 13, marginTop: 8 }}>clio_session_ref: {dispatch.clioSessionRef}</p>
                <p style={{ color: COLORS.textSecondary, fontSize: 13 }}>status: {dispatch.sessionStatus}</p>
                {dispatch.renderUrl && (
                  <p style={{ fontSize: 13, marginTop: 4 }}>
                    <a href={dispatch.renderUrl} target="_blank" rel="noreferrer" style={{ color: COLORS.accent }}>
                      Render URL &rarr; (open in a new tab to watch the render)
                    </a>
                  </p>
                )}
                <div style={{ marginTop: 12 }}>
                  <button style={secondaryButtonStyle} onClick={() => setDispatch({ status: 'idle' })}>
                    Dispatch again
                  </button>
                </div>
              </div>
            )}

            {dispatch.status !== 'success' && (
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, marginTop: 16, flexWrap: 'wrap' }}>
                <button
                  style={{ ...primaryButtonStyle, ...disabledStyle(!meetingUrlLooksValid || dispatch.status === 'in-flight') }}
                  disabled={!meetingUrlLooksValid || dispatch.status === 'in-flight'}
                  onClick={handleDispatch}
                >
                  {dispatch.status === 'in-flight' ? (
                    <>
                      <Loader2 className="inline-block w-3.5 h-3.5 animate-spin mr-1.5" style={{ verticalAlign: 'middle' }} />
                      Dispatching…
                    </>
                  ) : (
                    'Dispatch now'
                  )}
                </button>
                <button style={secondaryButtonStyle} onClick={handleDownloadPostman}>
                  Download Postman collection
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
