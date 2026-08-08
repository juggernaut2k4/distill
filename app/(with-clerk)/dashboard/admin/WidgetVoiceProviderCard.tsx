'use client'

import { useEffect, useState } from 'react'

/**
 * B2B-75 (docs/specs/B2B-75-requirement-document.md §4.2, §5) — admin-only card on
 * /dashboard/admin controlling which voice provider new WIDGET-CHANNEL sessions use, plus the
 * platform-level ElevenLabs credentials.
 *
 * A SEPARATE CARD from `VoiceProviderCard`, deliberately. That card keeps controlling
 * `active_provider`, which drives the inline / meeting-bot channel and keeps its existing two-value
 * domain — and it is left untouched apart from a copy-only subheading amendment. Two channels, two
 * settings, two cards: this separation is the visible expression of Decision D2. A single card with
 * a channel dropdown would recreate exactly the "the admin picked ElevenLabs but the inline channel
 * is actually running something else" ambiguity D2 exists to eliminate.
 *
 * Structural conventions are reused verbatim from `DemoAccessCard.tsx` and `VoiceProviderCard.tsx`
 * rather than invented: the `data`/`loadError` state split, fetch-on-mount, the `window.confirm(...)`
 * gate on the mutating provider switch, the "Saving…" disabled-label swap, and the `TOPUP_TIERS`
 * radio-tile `border-[#7C3AED] bg-[#7C3AED]/10` (selected) / `border-[#222222]` (unselected)
 * styling.
 *
 * THE API KEY NEVER ROUND-TRIPS. The GET/PATCH route returns only a boolean `elevenlabs_api_key_set`;
 * the input below is rendered empty on load and cleared after every successful save, so a stored
 * key can be REPLACED from here but never read back (Known Constraint C5).
 */

type WidgetProvider = 'hume' | 'openai_realtime' | 'elevenlabs'
type BlockedReason = 'flag' | 'api_key' | 'agent_id' | null

interface WidgetVoiceConfigData {
  widget_provider: WidgetProvider
  elevenlabs_agent_id: string | null
  elevenlabs_api_key_set: boolean
  openai_realtime_available: boolean
  elevenlabs_available: boolean
  elevenlabs_blocked_reason: BlockedReason
  updated_at: string
}

const PROVIDER_LABEL: Record<WidgetProvider, string> = {
  hume: 'Hume EVI',
  openai_realtime: 'OpenAI Realtime',
  elevenlabs: 'ElevenLabs',
}

// Same wording as the persistent INFO_LINE below, so the admin never reads two different claims
// about in-flight sessions — the convention VoiceProviderCard already established.
const CONFIRM_MESSAGE =
  'This changes the voice provider for new widget sessions immediately after saving. Meeting-bot sessions and sessions already in progress are not affected. Continue?'

const INFO_LINE =
  'Sessions already in progress keep using their original provider — only widget sessions started after you save switch to the new one.'

/** Server-decided (§6.3), so the caption names the SPECIFIC missing credential rather than being
 *  re-derived client-side from separate booleans. */
const BLOCKED_CAPTION: Record<Exclude<BlockedReason, null>, string> = {
  api_key: 'Add an API key below to enable.',
  agent_id: 'Add an agent ID below to enable.',
  flag: 'Coming soon — adapter in development.',
}

const SAVE_ERROR_BY_CODE: Record<string, string> = {
  elevenlabs_api_key_missing: 'Add an API key before selecting ElevenLabs.',
  elevenlabs_agent_id_missing: 'Add an agent ID before selecting ElevenLabs.',
  elevenlabs_not_available: "ElevenLabs isn't available yet.",
}

export default function WidgetVoiceProviderCard() {
  const [data, setData] = useState<WidgetVoiceConfigData | null>(null)
  const [loadError, setLoadError] = useState(false)

  const [pendingProvider, setPendingProvider] = useState<WidgetProvider | null>(null)
  const [apiKeyInput, setApiKeyInput] = useState('')
  const [agentIdInput, setAgentIdInput] = useState('')
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [saveSuccessMessage, setSaveSuccessMessage] = useState<string | null>(null)

  async function loadData() {
    setLoadError(false)
    try {
      const res = await fetch('/api/admin/widget-voice-config')
      if (!res.ok) throw new Error('load failed')
      const body: WidgetVoiceConfigData = await res.json()
      setData(body)
      setAgentIdInput(body.elevenlabs_agent_id ?? '')
      // Never populated from the server — the key is write-only from this card's perspective.
      setApiKeyInput('')
    } catch {
      setLoadError(true)
    }
  }

  useEffect(() => {
    loadData()
  }, [])

  function isTileSelectable(provider: WidgetProvider): boolean {
    if (!data) return false
    if (provider === 'openai_realtime') return data.openai_realtime_available
    if (provider === 'elevenlabs') return data.elevenlabs_available
    return true
  }

  function handleTileClick(provider: WidgetProvider) {
    if (!data || saving) return
    if (!isTileSelectable(provider)) return
    // Clicking the currently-saved provider's tile again clears the pending selection, so a true
    // no-op PATCH can never be sent from the UI.
    setPendingProvider(provider === data.widget_provider ? null : provider)
  }

  function applyResponse(body: WidgetVoiceConfigData) {
    // Non-optimistic by design: the displayed ACTIVE tile and the "✓ Configured" status only change
    // once a 200 has actually been received. The response carries the recomputed
    // elevenlabs_available / elevenlabs_blocked_reason, so a credentials save that has just made
    // ElevenLabs selectable drops the disabled styling in the same render — no second fetch, no
    // page refresh.
    setData(body)
    setAgentIdInput(body.elevenlabs_agent_id ?? '')
    setApiKeyInput('')
    setPendingProvider(null)
  }

  async function doSave(payload: Record<string, string>, successMessage: string) {
    setSaveError(null)
    setSaving(true)
    try {
      const res = await fetch('/api/admin/widget-voice-config', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      if (!res.ok) {
        const errorBody = (await res.json().catch(() => null)) as { error?: string } | null
        setSaveError((errorBody?.error && SAVE_ERROR_BY_CODE[errorBody.error]) || "Couldn't save — try again.")
        return
      }
      const body: WidgetVoiceConfigData = await res.json()
      applyResponse(body)
      setSaveSuccessMessage(successMessage)
      setTimeout(() => setSaveSuccessMessage(null), 4000)
    } catch {
      // Network failure: displayed saved state, pendingProvider and any typed input are all left
      // exactly as they were so the admin can retry without re-entering anything.
      setSaveError("Couldn't save — try again.")
    } finally {
      setSaving(false)
    }
  }

  function handleSaveProvider() {
    if (!pendingProvider) return
    // The confirm is deliberately on the provider switch ONLY. Saving credentials is additive and
    // does not change what any live or future session runs on, so it gets no confirm — stated
    // explicitly so the asymmetry does not read as an omission.
    if (!window.confirm(CONFIRM_MESSAGE)) return
    doSave({ widget_provider: pendingProvider }, `Saved — new widget sessions will now use ${PROVIDER_LABEL[pendingProvider]}.`)
  }

  function handleSaveCredentials() {
    if (!data) return
    const payload: Record<string, string> = {}
    if (apiKeyInput.trim().length > 0) payload.elevenlabs_api_key = apiKeyInput.trim()
    if (agentIdInput.trim().length > 0 && agentIdInput.trim() !== (data.elevenlabs_agent_id ?? '')) {
      payload.elevenlabs_agent_id = agentIdInput.trim()
    }
    if (Object.keys(payload).length === 0) return
    doSave(payload, 'ElevenLabs credentials saved.')
  }

  const credentialsDirty =
    data !== null &&
    (apiKeyInput.trim().length > 0 || agentIdInput.trim() !== (data.elevenlabs_agent_id ?? ''))

  function renderTile(provider: WidgetProvider, label: string, blockedCaption: string | null) {
    if (!data) return null
    const selectable = isTileSelectable(provider)
    const isPending = pendingProvider === provider
    const isSaved = data.widget_provider === provider
    return (
      <button
        type="button"
        disabled={saving || !selectable}
        onClick={() => handleTileClick(provider)}
        className={`sm:flex-1 text-left rounded-lg border p-3 ${
          !selectable ? 'opacity-40 cursor-not-allowed pointer-events-none' : ''
        } ${saving ? 'pointer-events-none' : ''} ${
          isPending || (!pendingProvider && isSaved) ? 'border-[#7C3AED] bg-[#7C3AED]/10' : 'border-[#222222]'
        }`}
      >
        <span className="text-white text-sm font-medium">{label}</span>
        {!selectable && blockedCaption && <p className="text-[#475569] text-[11px] mt-1">{blockedCaption}</p>}
        {selectable && isPending && (
          <p className="text-[10px] uppercase tracking-wide text-[#7C3AED] mt-1">SELECTED</p>
        )}
        {selectable && !pendingProvider && isSaved && (
          <p className="text-[10px] uppercase tracking-wide text-[#7C3AED] mt-1">ACTIVE</p>
        )}
        {selectable && !!pendingProvider && !isPending && isSaved && (
          <p className="text-[#94A3B8] text-[11px] mt-1">Currently active</p>
        )}
      </button>
    )
  }

  return (
    <div className="bg-[#111111] border border-[#222222] rounded-xl p-5 mb-6">
      <h2 className="text-white text-base font-semibold mb-0.5">Widget voice provider</h2>
      <p className="text-[#475569] text-xs mb-4">
        Controls which voice AI powers new widget-channel sessions. Meeting-bot sessions are unaffected by this setting.
      </p>

      {loadError && (
        <p className="text-[#EF4444] text-sm">Couldn&apos;t load widget voice settings. Try refreshing the page.</p>
      )}

      {!loadError && data === null && <p className="text-[#94A3B8] text-sm">Checking…</p>}

      {!loadError && data !== null && (
        <>
          {saveSuccessMessage && <p className="text-[#10B981] text-xs mb-3">{saveSuccessMessage}</p>}

          <div className="flex flex-col gap-2 sm:flex-row sm:gap-3">
            {renderTile('hume', 'Hume EVI', null)}
            {renderTile('openai_realtime', 'OpenAI Realtime', 'Coming soon — adapter in development.')}
            {renderTile(
              'elevenlabs',
              'ElevenLabs',
              data.elevenlabs_blocked_reason ? BLOCKED_CAPTION[data.elevenlabs_blocked_reason] : null
            )}
          </div>

          <p className="text-[#94A3B8] text-xs mt-3">{INFO_LINE}</p>

          {saveError && <p className="text-[#EF4444] text-xs mt-3">{saveError}</p>}

          {pendingProvider && (
            <button
              disabled={saving}
              onClick={handleSaveProvider}
              className="mt-3 w-full sm:w-auto bg-[#7C3AED] text-white text-sm font-semibold rounded-lg px-4 py-2.5 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {saving ? 'Saving…' : 'Save provider'}
            </button>
          )}

          <div className="border-t border-[#222222] mt-4 pt-4">
            <p className="text-white text-sm font-medium">ElevenLabs credentials</p>
            <p className="text-[#475569] text-[11px] mb-3">
              Stored encrypted. The API key can be replaced but never viewed again.
            </p>

            <label className="block text-[#94A3B8] text-xs mb-1" htmlFor="elevenlabs-api-key">
              API key
            </label>
            <input
              id="elevenlabs-api-key"
              type="password"
              autoComplete="off"
              disabled={saving}
              value={apiKeyInput}
              onChange={(e) => setApiKeyInput(e.target.value)}
              placeholder={data.elevenlabs_api_key_set ? 'Configured — enter a new key to replace' : 'xi-…'}
              className="w-full bg-[#0A0A0A] border border-[#333333] rounded-lg px-3 py-2 text-white text-sm disabled:opacity-40"
            />
            {data.elevenlabs_api_key_set ? (
              <p className="text-[#10B981] text-[11px] mt-1">✓ Configured</p>
            ) : (
              <p className="text-[#475569] text-[11px] mt-1">Not configured</p>
            )}

            <label className="block text-[#94A3B8] text-xs mb-1 mt-3" htmlFor="elevenlabs-agent-id">
              Agent ID
            </label>
            <input
              id="elevenlabs-agent-id"
              type="text"
              disabled={saving}
              value={agentIdInput}
              onChange={(e) => setAgentIdInput(e.target.value)}
              placeholder="agent_…"
              className="w-full bg-[#0A0A0A] border border-[#333333] rounded-lg px-3 py-2 text-white text-sm disabled:opacity-40"
            />
            <p className="text-[#475569] text-[11px] mt-1">
              Clio&apos;s agent in your ElevenLabs workspace. Change this only if you rebuild the agent.
            </p>

            {credentialsDirty && (
              <button
                disabled={saving}
                onClick={handleSaveCredentials}
                className="mt-3 w-full sm:w-auto bg-[#7C3AED] text-white text-sm font-semibold rounded-lg px-4 py-2.5 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {saving ? 'Saving…' : 'Save credentials'}
              </button>
            )}
          </div>
        </>
      )}
    </div>
  )
}
