'use client'

import { useEffect, useState } from 'react'

/**
 * B2B-61 Part B (docs/specs/B2B-61-requirement-document.md §4-§6). Admin-only card on
 * /dashboard/admin letting the super-admin see and change which live-voice provider new
 * partner sessions use platform-wide (the first GLOBAL, non-partner-scoped config in this
 * codebase — system_voice_config). Fetch-on-mount 'use client' component, deliberately reusing
 * DemoAccessCard.tsx's own structural conventions throughout: `data`/`loadError` state split,
 * a `window.confirm(...)`-gated mutating action, "…ing…" disabled-button label swap, and the
 * `TOPUP_TIERS` radio-tile `border-[#7C3AED] bg-[#7C3AED]/10` (selected) /
 * `border-[#222222]` (unselected) styling — see DemoAccessCard.tsx for the precedent this card
 * mirrors rather than inventing a new visual style.
 */

type Provider = 'hume' | 'openai_realtime'

interface VoiceConfigData {
  active_provider: Provider
  updated_at: string
  openai_realtime_available: boolean
}

const PROVIDER_LABEL: Record<Provider, string> = {
  hume: 'Hume EVI',
  openai_realtime: 'OpenAI Realtime',
}

// Stated twice by design (§4 State 4→5, §5's confirm-dialog wireframe, §11 open-question 2): once
// here (inside the confirm dialog) and again as INFO_LINE below (persistent card copy) — same
// wording both places so the admin isn't reading two different claims about in-flight sessions.
const CONFIRM_MESSAGE =
  'This changes the voice provider for new live sessions immediately after saving. Sessions already in progress are not affected. Continue?'

const INFO_LINE =
  'Sessions already in progress keep using their original provider — only sessions started after you save switch to the new one.'

export default function VoiceProviderCard() {
  const [data, setData] = useState<VoiceConfigData | null>(null)
  const [loadError, setLoadError] = useState(false)

  const [pendingSelection, setPendingSelection] = useState<Provider | null>(null)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [saveSuccessMessage, setSaveSuccessMessage] = useState<string | null>(null)

  async function loadData() {
    setLoadError(false)
    try {
      const res = await fetch('/api/admin/voice-config')
      if (!res.ok) throw new Error('load failed')
      const body: VoiceConfigData = await res.json()
      setData(body)
    } catch {
      setLoadError(true)
    }
  }

  useEffect(() => {
    loadData()
  }, [])

  function handleTileClick(provider: Provider) {
    if (!data || saving) return
    if (provider === 'openai_realtime' && !data.openai_realtime_available) return
    // Clicking the currently-saved provider's tile a second time clears the pending selection
    // (§4 State 4→3 transition) — a true no-op PATCH can never be sent from the UI (§9).
    setPendingSelection(provider === data.active_provider ? null : provider)
  }

  async function doSave(provider: Provider) {
    setSaveError(null)
    setSaving(true)
    try {
      const res = await fetch('/api/admin/voice-config', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ active_provider: provider }),
      })
      if (!res.ok) {
        setSaveError("Couldn't save — try again.")
        return
      }
      const body: { active_provider: Provider; updated_at: string } = await res.json()
      // Non-optimistic by design (§4 State 6/7, §8, §11): the displayed active provider only
      // changes once the PATCH has actually returned 200.
      setData((prev) => (prev ? { ...prev, active_provider: body.active_provider, updated_at: body.updated_at } : prev))
      setPendingSelection(null)
      setSaveSuccessMessage(`Saved — new sessions will now use ${PROVIDER_LABEL[body.active_provider]}.`)
      setTimeout(() => setSaveSuccessMessage(null), 4000)
    } catch {
      // Network failure: displayed active provider and pendingSelection are left exactly as they
      // were so the admin can retry without re-selecting (§4 State 7, §8).
      setSaveError("Couldn't save — try again.")
    } finally {
      setSaving(false)
    }
  }

  function handleSaveClick() {
    if (!pendingSelection) return
    const confirmed = window.confirm(CONFIRM_MESSAGE)
    if (!confirmed) return
    doSave(pendingSelection)
  }

  return (
    <div className="bg-[#111111] border border-[#222222] rounded-xl p-5 mb-6">
      <h2 className="text-white text-base font-semibold mb-0.5">Live voice provider</h2>
      <p className="text-[#475569] text-xs mb-4">
        Controls which voice AI powers new live sessions across all partners.
      </p>

      {loadError && (
        <p className="text-[#EF4444] text-sm">Couldn&apos;t load voice provider settings. Try refreshing the page.</p>
      )}

      {!loadError && data === null && <p className="text-[#94A3B8] text-sm">Checking…</p>}

      {!loadError && data !== null && (
        <>
          {saveSuccessMessage && <p className="text-[#10B981] text-xs mb-3">{saveSuccessMessage}</p>}

          <div className="flex flex-col gap-2 sm:flex-row sm:gap-3">
            {/* Tile 1 — Hume EVI (default). Always selectable. */}
            <button
              type="button"
              disabled={saving}
              onClick={() => handleTileClick('hume')}
              className={`sm:flex-1 text-left rounded-lg border p-3 ${saving ? 'pointer-events-none' : ''} ${
                pendingSelection === 'hume' || (!pendingSelection && data.active_provider === 'hume')
                  ? 'border-[#7C3AED] bg-[#7C3AED]/10'
                  : 'border-[#222222]'
              }`}
            >
              <span className="text-white text-sm font-medium">Hume EVI (default)</span>
              {pendingSelection === 'hume' && (
                <p className="text-[10px] uppercase tracking-wide text-[#7C3AED] mt-1">SELECTED</p>
              )}
              {!pendingSelection && data.active_provider === 'hume' && (
                <p className="text-[10px] uppercase tracking-wide text-[#7C3AED] mt-1">ACTIVE</p>
              )}
              {!!pendingSelection && pendingSelection !== 'hume' && data.active_provider === 'hume' && (
                <p className="text-[#94A3B8] text-[11px] mt-1">Currently active</p>
              )}
            </button>

            {/* Tile 2 — OpenAI Realtime. Selectable only once OPENAI_REALTIME_ADAPTER_AVAILABLE
                flips to true (openai_realtime_available from the API) — see
                lib/voice/provider-availability.ts. */}
            <button
              type="button"
              disabled={saving || !data.openai_realtime_available}
              onClick={() => handleTileClick('openai_realtime')}
              className={`sm:flex-1 text-left rounded-lg border p-3 ${
                !data.openai_realtime_available ? 'opacity-40 cursor-not-allowed pointer-events-none' : ''
              } ${saving ? 'pointer-events-none' : ''} ${
                pendingSelection === 'openai_realtime' || (!pendingSelection && data.active_provider === 'openai_realtime')
                  ? 'border-[#7C3AED] bg-[#7C3AED]/10'
                  : 'border-[#222222]'
              }`}
            >
              <span className="text-white text-sm font-medium">OpenAI Realtime</span>
              {!data.openai_realtime_available && (
                <p className="text-[#475569] text-[11px] mt-1">Coming soon — adapter in development.</p>
              )}
              {data.openai_realtime_available && pendingSelection === 'openai_realtime' && (
                <p className="text-[10px] uppercase tracking-wide text-[#7C3AED] mt-1">SELECTED</p>
              )}
              {data.openai_realtime_available && !pendingSelection && data.active_provider === 'openai_realtime' && (
                <p className="text-[10px] uppercase tracking-wide text-[#7C3AED] mt-1">ACTIVE</p>
              )}
              {data.openai_realtime_available &&
                !!pendingSelection &&
                pendingSelection !== 'openai_realtime' &&
                data.active_provider === 'openai_realtime' && (
                  <p className="text-[#94A3B8] text-[11px] mt-1">Currently active</p>
                )}
            </button>
          </div>

          <p className="text-[#94A3B8] text-xs mt-3">{INFO_LINE}</p>

          {saveError && <p className="text-[#EF4444] text-xs mt-3">{saveError}</p>}

          {pendingSelection && (
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
