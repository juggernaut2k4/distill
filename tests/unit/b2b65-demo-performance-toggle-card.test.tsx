// @vitest-environment jsdom
//
// B2B-65 (docs/specs/B2B-65-requirement-document.md §4.A/§7) — component tests for
// DemoPerformanceToggleCard.tsx's state transitions, mirroring
// tests/unit/b2b61-partb-voice-provider-card.test.tsx's own established pattern for this
// codebase's admin toggle cards.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, fireEvent, cleanup } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import DemoPerformanceToggleCard from '../../app/(with-clerk)/dashboard/admin/DemoPerformanceToggleCard'

const APPENDING_PAYLOAD = { append_enabled: true, updated_at: '2026-08-01T00:00:00.000Z' }
const PAUSED_PAYLOAD = { append_enabled: false, updated_at: '2026-08-01T00:00:00.000Z' }

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

describe('DemoPerformanceToggleCard — load', () => {
  it('shows "Checking…" before the GET resolves, then resolves to "Appending" marked ACTIVE (default state)', async () => {
    mockFetchSequence([{ ok: true, body: APPENDING_PAYLOAD }])
    render(<DemoPerformanceToggleCard />)
    expect(screen.getByText('Checking…')).toBeInTheDocument()

    await waitFor(() => expect(screen.getByText('Appending')).toBeInTheDocument())
    expect(screen.getByText('ACTIVE')).toBeInTheDocument()
  })

  it('resolves to "Paused" marked ACTIVE when append_enabled is false', async () => {
    mockFetchSequence([{ ok: true, body: PAUSED_PAYLOAD }])
    render(<DemoPerformanceToggleCard />)
    await waitFor(() => expect(screen.getByText('Paused')).toBeInTheDocument())
    expect(screen.getByText('ACTIVE')).toBeInTheDocument()
  })

  it('shows the load-error message and renders no interactive tiles when GET fails', async () => {
    mockFetchSequence([{ ok: false, body: {} }])
    render(<DemoPerformanceToggleCard />)
    await waitFor(() =>
      expect(screen.getByText("Couldn't load demo performance settings. Try refreshing the page.")).toBeInTheDocument()
    )
    expect(screen.queryByText('Appending')).not.toBeInTheDocument()
    expect(screen.queryByText('Paused')).not.toBeInTheDocument()
  })
})

describe('DemoPerformanceToggleCard — pending selection', () => {
  it('selecting "Paused" shows "Save changes" and marks it SELECTED without firing a request', async () => {
    mockFetchSequence([{ ok: true, body: APPENDING_PAYLOAD }])
    render(<DemoPerformanceToggleCard />)
    await waitFor(() => expect(screen.getByText('Paused')).toBeInTheDocument())

    fireEvent.click(screen.getByText('Paused').closest('button')!)

    expect(await screen.findByText('Save changes')).toBeInTheDocument()
    expect(screen.getByText('SELECTED')).toBeInTheDocument()
    expect(screen.getByText('Currently active')).toBeInTheDocument()
    expect(global.fetch).toHaveBeenCalledTimes(1) // only the initial GET
  })

  it('clicking the same tile a second time (back to the saved value) clears the pending selection', async () => {
    mockFetchSequence([{ ok: true, body: APPENDING_PAYLOAD }])
    render(<DemoPerformanceToggleCard />)
    await waitFor(() => expect(screen.getByText('Paused')).toBeInTheDocument())

    fireEvent.click(screen.getByText('Paused').closest('button')!)
    expect(await screen.findByText('Save changes')).toBeInTheDocument()

    fireEvent.click(screen.getByText('Appending').closest('button')!) // back to saved value
    await waitFor(() => expect(screen.queryByText('Save changes')).not.toBeInTheDocument())
  })
})

describe('DemoPerformanceToggleCard — save flow (confirm / success / cancel / error)', () => {
  it('cancelling window.confirm sends no PATCH and preserves the pending selection', async () => {
    mockFetchSequence([{ ok: true, body: APPENDING_PAYLOAD }])
    vi.spyOn(window, 'confirm').mockReturnValue(false)
    render(<DemoPerformanceToggleCard />)
    await waitFor(() => expect(screen.getByText('Paused')).toBeInTheDocument())

    fireEvent.click(screen.getByText('Paused').closest('button')!)
    fireEvent.click(await screen.findByText('Save changes'))

    expect(window.confirm).toHaveBeenCalledWith(
      'Pausing stops NEW demo sessions from being added to the Performance tab. Sessions already extracted while this was on stay exactly as they are — nothing is removed. Continue?'
    )
    expect(global.fetch).toHaveBeenCalledTimes(1) // GET only — no PATCH sent
    expect(screen.getByText('Save changes')).toBeInTheDocument()
    expect(screen.getByText('SELECTED')).toBeInTheDocument()
  })

  it('on confirm + PATCH success (pause): shows the pause-specific success message and the new ACTIVE tile', async () => {
    mockFetchSequence([
      { ok: true, body: APPENDING_PAYLOAD },
      { ok: true, body: PAUSED_PAYLOAD },
    ])
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    render(<DemoPerformanceToggleCard />)
    await waitFor(() => expect(screen.getByText('Paused')).toBeInTheDocument())

    fireEvent.click(screen.getByText('Paused').closest('button')!)
    fireEvent.click(await screen.findByText('Save changes'))

    await waitFor(() =>
      expect(screen.getByText('Saved — new demo sessions will no longer be added to the Performance tab.')).toBeInTheDocument()
    )
    expect(screen.queryByText('Save changes')).not.toBeInTheDocument()
    expect(screen.getByText('ACTIVE')).toBeInTheDocument()
  })

  it('on confirm + PATCH success (resume): shows the resume-specific success message', async () => {
    mockFetchSequence([
      { ok: true, body: PAUSED_PAYLOAD },
      { ok: true, body: APPENDING_PAYLOAD },
    ])
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    render(<DemoPerformanceToggleCard />)
    await waitFor(() => expect(screen.getByText('Appending')).toBeInTheDocument())

    fireEvent.click(screen.getByText('Appending').closest('button')!)
    fireEvent.click(await screen.findByText('Save changes'))

    expect(window.confirm).toHaveBeenCalledWith('Demo sessions completed from now on will be added to the Performance tab. Continue?')
    await waitFor(() =>
      expect(screen.getByText('Saved — new demo sessions will now be added to the Performance tab.')).toBeInTheDocument()
    )
  })

  it('on confirm + PATCH failure: active tile unchanged, pending selection preserved, retry available', async () => {
    mockFetchSequence([
      { ok: true, body: APPENDING_PAYLOAD },
      { ok: false, body: {} },
    ])
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    render(<DemoPerformanceToggleCard />)
    await waitFor(() => expect(screen.getByText('Paused')).toBeInTheDocument())

    fireEvent.click(screen.getByText('Paused').closest('button')!)
    fireEvent.click(await screen.findByText('Save changes'))

    await waitFor(() => expect(screen.getByText("Couldn't save — try again.")).toBeInTheDocument())
    expect(screen.getByText('Currently active')).toBeInTheDocument()
    expect(screen.getByText('SELECTED')).toBeInTheDocument()
    expect(screen.getByText('Save changes')).toBeInTheDocument()
    expect((screen.getByText('Save changes') as HTMLButtonElement).disabled).toBe(false)
  })
})
