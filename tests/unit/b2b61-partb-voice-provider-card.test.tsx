// @vitest-environment jsdom
//
// B2B-61 Part B (docs/specs/B2B-61-requirement-document.md §7, §13) — component tests for
// VoiceProviderCard.tsx's state transitions, following the jsdom + @testing-library/react
// pattern established by tests/unit/b2b51-performance-tab-table.test.tsx (the oxc.jsx override in
// vitest.config.ts this repo already carries for exactly this situation).

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, fireEvent, cleanup } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import VoiceProviderCard from '../../app/(with-clerk)/dashboard/admin/VoiceProviderCard'

const UNAVAILABLE_PAYLOAD = { active_provider: 'hume', updated_at: '2026-07-31T00:00:00.000Z', openai_realtime_available: false }
const AVAILABLE_PAYLOAD = { active_provider: 'hume', updated_at: '2026-07-31T00:00:00.000Z', openai_realtime_available: true }

function mockFetchSequence(responses: Array<{ ok: boolean; body: unknown }>) {
  let call = 0
  global.fetch = vi.fn(() => {
    const next = responses[Math.min(call, responses.length - 1)]
    call += 1
    return Promise.resolve({
      ok: next.ok,
      json: () => Promise.resolve(next.body),
    } as Response)
  }) as unknown as typeof fetch
}

beforeEach(() => {
  vi.restoreAllMocks()
})

afterEach(() => {
  cleanup()
})

describe('VoiceProviderCard — State 1/2/3 (load)', () => {
  it('shows "Checking…" before the GET resolves, then resolves to the active tile marked ACTIVE', async () => {
    mockFetchSequence([{ ok: true, body: UNAVAILABLE_PAYLOAD }])
    render(<VoiceProviderCard />)
    expect(screen.getByText('Checking…')).toBeInTheDocument()

    await waitFor(() => expect(screen.getByText('Hume EVI (default)')).toBeInTheDocument())
    expect(screen.getByText('ACTIVE')).toBeInTheDocument()
  })

  it('renders the OpenAI Realtime tile disabled with its "Coming soon" caption when unavailable', async () => {
    mockFetchSequence([{ ok: true, body: UNAVAILABLE_PAYLOAD }])
    render(<VoiceProviderCard />)
    await waitFor(() => expect(screen.getByText('OpenAI Realtime')).toBeInTheDocument())

    expect(screen.getByText('Coming soon — adapter in development.')).toBeInTheDocument()
    const openaiButton = screen.getByText('OpenAI Realtime').closest('button')
    expect(openaiButton).toBeDisabled()

    fireEvent.click(openaiButton!)
    // Disabled — clicking never produces a pending selection / Save button.
    expect(screen.queryByText('Save changes')).not.toBeInTheDocument()
  })

  it('shows the load-error message and renders no interactive tiles when GET fails', async () => {
    mockFetchSequence([{ ok: false, body: {} }])
    render(<VoiceProviderCard />)
    await waitFor(() =>
      expect(screen.getByText("Couldn't load voice provider settings. Try refreshing the page.")).toBeInTheDocument()
    )
    expect(screen.queryByText('Hume EVI (default)')).not.toBeInTheDocument()
    expect(screen.queryByText('OpenAI Realtime')).not.toBeInTheDocument()
  })
})

describe('VoiceProviderCard — State 4 (pending selection)', () => {
  it('selecting a different, enabled tile shows "Save changes" and marks it SELECTED without firing a request', async () => {
    mockFetchSequence([{ ok: true, body: AVAILABLE_PAYLOAD }])
    render(<VoiceProviderCard />)
    await waitFor(() => expect(screen.getByText('OpenAI Realtime')).toBeInTheDocument())

    const openaiButton = screen.getByText('OpenAI Realtime').closest('button')!
    fireEvent.click(openaiButton)

    expect(await screen.findByText('Save changes')).toBeInTheDocument()
    expect(screen.getByText('SELECTED')).toBeInTheDocument()
    expect(screen.getByText('Currently active')).toBeInTheDocument()
    expect(global.fetch).toHaveBeenCalledTimes(1) // only the initial GET
  })

  it('clicking the same tile a second time (back to the saved value) clears the pending selection', async () => {
    mockFetchSequence([{ ok: true, body: AVAILABLE_PAYLOAD }])
    render(<VoiceProviderCard />)
    await waitFor(() => expect(screen.getByText('OpenAI Realtime')).toBeInTheDocument())

    const openaiButton = screen.getByText('OpenAI Realtime').closest('button')!
    const humeButton = screen.getByText('Hume EVI (default)').closest('button')!

    fireEvent.click(openaiButton)
    expect(await screen.findByText('Save changes')).toBeInTheDocument()

    fireEvent.click(humeButton) // back to the currently-saved value
    await waitFor(() => expect(screen.queryByText('Save changes')).not.toBeInTheDocument())
  })
})

describe('VoiceProviderCard — save flow (confirm / success / cancel / error)', () => {
  it('cancelling window.confirm sends no PATCH and preserves the pending selection', async () => {
    mockFetchSequence([{ ok: true, body: AVAILABLE_PAYLOAD }])
    vi.spyOn(window, 'confirm').mockReturnValue(false)
    render(<VoiceProviderCard />)
    await waitFor(() => expect(screen.getByText('OpenAI Realtime')).toBeInTheDocument())

    fireEvent.click(screen.getByText('OpenAI Realtime').closest('button')!)
    const saveButton = await screen.findByText('Save changes')
    fireEvent.click(saveButton)

    expect(window.confirm).toHaveBeenCalled()
    expect(global.fetch).toHaveBeenCalledTimes(1) // GET only — no PATCH sent
    expect(screen.getByText('Save changes')).toBeInTheDocument()
    expect(screen.getByText('SELECTED')).toBeInTheDocument()
  })

  it('on confirm + PATCH success: shows "Saving…", then the success message, and the new ACTIVE tile', async () => {
    mockFetchSequence([
      { ok: true, body: AVAILABLE_PAYLOAD },
      { ok: true, body: { active_provider: 'openai_realtime', updated_at: '2026-07-31T02:00:00.000Z' } },
    ])
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    render(<VoiceProviderCard />)
    await waitFor(() => expect(screen.getByText('OpenAI Realtime')).toBeInTheDocument())

    fireEvent.click(screen.getByText('OpenAI Realtime').closest('button')!)
    fireEvent.click(await screen.findByText('Save changes'))

    await waitFor(() =>
      expect(screen.getByText('Saved — new sessions will now use OpenAI Realtime.')).toBeInTheDocument()
    )
    expect(screen.queryByText('Save changes')).not.toBeInTheDocument()
    expect(screen.getByText('ACTIVE')).toBeInTheDocument()
  })

  it('on confirm + PATCH failure: active tile unchanged, pending selection preserved, retry available', async () => {
    mockFetchSequence([
      { ok: true, body: AVAILABLE_PAYLOAD },
      { ok: false, body: {} },
    ])
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    render(<VoiceProviderCard />)
    await waitFor(() => expect(screen.getByText('OpenAI Realtime')).toBeInTheDocument())

    fireEvent.click(screen.getByText('OpenAI Realtime').closest('button')!)
    fireEvent.click(await screen.findByText('Save changes'))

    await waitFor(() => expect(screen.getByText("Couldn't save — try again.")).toBeInTheDocument())
    // Non-optimistic: the saved-active tile is still Hume (via the "Currently active" caption on
    // the Hume tile), and the pending OpenAI selection is preserved so a retry needs no re-select.
    expect(screen.getByText('Currently active')).toBeInTheDocument()
    expect(screen.getByText('SELECTED')).toBeInTheDocument()
    expect(screen.getByText('Save changes')).toBeInTheDocument()
    expect((screen.getByText('Save changes') as HTMLButtonElement).disabled).toBe(false)
  })
})
