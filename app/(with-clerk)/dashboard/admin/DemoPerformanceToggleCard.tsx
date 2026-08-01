'use client'

import { useEffect, useState } from 'react'

/**
 * B2B-65 (docs/specs/B2B-65-requirement-document.md §4.A). Admin-only card on /dashboard/admin
 * letting the super-admin pause/resume whether newly-completed demo session results get added
 * to the public Performance tab's accumulating list — independent of whether extraction itself
 * runs. Structurally mirrors VoiceProviderCard.tsx's own conventions (fetch-on-mount, pending
 * selection + `window.confirm(...)`-gated save, non-optimistic update, disabled-button label
 * swap) — the established "global singleton config" card shape in this codebase, not a new one.
 */

interface DemoPerformanceConfigData {
  append_enabled: boolean
  updated_at: string
}

const CONFIRM_MESSAGE_PAUSE =
  'Pausing stops NEW demo sessions from being added to the Performance tab. Sessions already extracted while this was on stay exactly as they are — nothing is removed. Continue?'

const CONFIRM_MESSAGE_RESUME =
  'Demo sessions completed from now on will be added to the Performance tab. Continue?'

const INFO_LINE =
  "New demo-session results are being added to the Performance tab as they're extracted. Existing entries never disappear — pausing only stops new ones from being added."

export default function DemoPerformanceToggleCard() {
  const [data, setData] = useState<DemoPerformanceConfigData | null>(null)
  const [loadError, setLoadError] = useState(false)

  const [pendingSelection, setPendingSelection] = useState<boolean | null>(null)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [saveSuccessMessage, setSaveSuccessMessage] = useState<string | null>(null)

  async function loadData() {
    setLoadError(false)
    try {
      const res = await fetch('/api/admin/demo-performance-config')
      if (!res.ok) throw new Error('load failed')
      const body: DemoPerformanceConfigData = await res.json()
      setData(body)
    } catch {
      setLoadError(true)
    }
  }

  useEffect(() => {
    loadData()
  }, [])

  function handleTileClick(enabled: boolean) {
    if (!data || saving) return
    // Clicking the currently-saved state's tile a second time clears the pending selection — a
    // true no-op PATCH can never be sent from the UI, matching VoiceProviderCard's own rule.
    setPendingSelection(enabled === data.append_enabled ? null : enabled)
  }

  async function doSave(enabled: boolean) {
    setSaveError(null)
    setSaving(true)
    try {
      const res = await fetch('/api/admin/demo-performance-config', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ append_enabled: enabled }),
      })
      if (!res.ok) {
        setSaveError("Couldn't save — try again.")
        return
      }
      const body: DemoPerformanceConfigData = await res.json()
      // Non-optimistic by design (§4 State A3): the displayed state only changes once the PATCH
      // has actually returned 200.
      setData((prev) => (prev ? { ...prev, append_enabled: body.append_enabled, updated_at: body.updated_at } : prev))
      setPendingSelection(null)
      setSaveSuccessMessage(
        body.append_enabled
          ? 'Saved — new demo sessions will now be added to the Performance tab.'
          : 'Saved — new demo sessions will no longer be added to the Performance tab.'
      )
      setTimeout(() => setSaveSuccessMessage(null), 4000)
    } catch {
      setSaveError("Couldn't save — try again.")
    } finally {
      setSaving(false)
    }
  }

  function handleSaveClick() {
    if (pendingSelection === null) return
    const confirmed = window.confirm(pendingSelection ? CONFIRM_MESSAGE_RESUME : CONFIRM_MESSAGE_PAUSE)
    if (!confirmed) return
    doSave(pendingSelection)
  }

  return (
    <div className="bg-[#111111] border border-[#222222] rounded-xl p-5 mb-6">
      <h2 className="text-white text-base font-semibold mb-0.5">Demo Performance tab entries</h2>
      <p className="text-[#475569] text-xs mb-4">
        Controls whether newly completed demo sessions get added to the Performance tab&apos;s example list on /demo pages.
      </p>

      {loadError && (
        <p className="text-[#EF4444] text-sm">Couldn&apos;t load demo performance settings. Try refreshing the page.</p>
      )}

      {!loadError && data === null && <p className="text-[#94A3B8] text-sm">Checking…</p>}

      {!loadError && data !== null && (
        <>
          {saveSuccessMessage && <p className="text-[#10B981] text-xs mb-3">{saveSuccessMessage}</p>}

          <div className="flex flex-col gap-2 sm:flex-row sm:gap-3">
            <button
              type="button"
              disabled={saving}
              onClick={() => handleTileClick(true)}
              className={`sm:flex-1 text-left rounded-lg border p-3 ${saving ? 'pointer-events-none' : ''} ${
                pendingSelection === true || (pendingSelection === null && data.append_enabled)
                  ? 'border-[#7C3AED] bg-[#7C3AED]/10'
                  : 'border-[#222222]'
              }`}
            >
              <span className="text-white text-sm font-medium">Appending</span>
              {pendingSelection === true && (
                <p className="text-[10px] uppercase tracking-wide text-[#7C3AED] mt-1">SELECTED</p>
              )}
              {pendingSelection === null && data.append_enabled && (
                <p className="text-[10px] uppercase tracking-wide text-[#7C3AED] mt-1">ACTIVE</p>
              )}
              {pendingSelection !== null && pendingSelection !== true && data.append_enabled && (
                <p className="text-[#94A3B8] text-[11px] mt-1">Currently active</p>
              )}
            </button>

            <button
              type="button"
              disabled={saving}
              onClick={() => handleTileClick(false)}
              className={`sm:flex-1 text-left rounded-lg border p-3 ${saving ? 'pointer-events-none' : ''} ${
                pendingSelection === false || (pendingSelection === null && !data.append_enabled)
                  ? 'border-[#7C3AED] bg-[#7C3AED]/10'
                  : 'border-[#222222]'
              }`}
            >
              <span className="text-white text-sm font-medium">Paused</span>
              {pendingSelection === false && (
                <p className="text-[10px] uppercase tracking-wide text-[#7C3AED] mt-1">SELECTED</p>
              )}
              {pendingSelection === null && !data.append_enabled && (
                <p className="text-[10px] uppercase tracking-wide text-[#7C3AED] mt-1">ACTIVE</p>
              )}
              {pendingSelection !== null && pendingSelection !== false && !data.append_enabled && (
                <p className="text-[#94A3B8] text-[11px] mt-1">Currently active</p>
              )}
            </button>
          </div>

          <p className="text-[#94A3B8] text-xs mt-3">{INFO_LINE}</p>

          {saveError && <p className="text-[#EF4444] text-xs mt-3">{saveError}</p>}

          {pendingSelection !== null && (
            <button
              disabled={saving}
              onClick={handleSaveClick}
              className="mt-3 w-full sm:w-auto bg-[#7C3AED] text-white text-sm font-semibold rounded-lg px-4 py-2.5 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {saving ? 'Saving…' : 'Save changes'}
            </button>
          )}
        </>
      )}
    </div>
  )
}
