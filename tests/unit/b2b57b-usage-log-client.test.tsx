// @vitest-environment jsdom
//
// B2B-57b Requirement Doc §13 — component coverage for UsageLogClient.tsx: empty-state render,
// State C notice + Integration-page link, event-type filter re-fetch, and "Load more" pagination
// append behavior. Follows tests/unit/b2b51-performance-tab-table.test.tsx's established
// render/mockFetch pattern for this repo's Configurator client components.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, fireEvent, cleanup } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import UsageLogClient from '../../app/(with-clerk)/dashboard/configurator/usage/UsageLogClient'
import type { AdminPartnerAccount } from '@/lib/partner/admin-accounts'
import type { BillingHealth } from '../../app/(with-clerk)/dashboard/configurator/_shared'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
  usePathname: () => '/dashboard/configurator/usage',
}))

vi.mock('@clerk/nextjs', () => ({
  UserButton: () => null,
}))

const ACCOUNTS: AdminPartnerAccount[] = [{ id: 'acct-1', name: 'Acme Co' } as AdminPartnerAccount]
const BILLING_HEALTHY: BillingHealth = { state: 'healthy', balance_usd: 100, next_billing_date: null, voice_rate_usd: null }

function mockFetchOnce(response: unknown, opts: { ok?: boolean } = {}) {
  const ok = opts.ok ?? true
  global.fetch = vi.fn(() =>
    Promise.resolve({ ok, json: () => Promise.resolve(response) } as Response)
  ) as unknown as typeof fetch
}

function mockFetchSequence(responses: unknown[]) {
  let call = 0
  global.fetch = vi.fn(() => {
    const response = responses[Math.min(call, responses.length - 1)]
    call += 1
    return Promise.resolve({ ok: true, json: () => Promise.resolve(response) } as Response)
  }) as unknown as typeof fetch
}

function renderClient() {
  return render(<UsageLogClient accounts={ACCOUNTS} activePartnerAccountId="acct-1" billingHealth={BILLING_HEALTHY} />)
}

beforeEach(() => {
  vi.restoreAllMocks()
})

afterEach(() => {
  cleanup()
})

describe('B2B-57b Usage log — State B, zero rows', () => {
  it('renders the exact empty-state copy, no filter dropdown, no error', async () => {
    mockFetchOnce({ rows: [], has_more: false, delivery_configured: true })
    renderClient()

    await waitFor(() => expect(screen.getByText('No usage events yet')).toBeInTheDocument())
    expect(
      screen.getByText(
        'Usage events appear here automatically as soon as Clio records billable activity for your account — for example, voice minutes from a live session. Nothing has been recorded yet.'
      )
    ).toBeInTheDocument()
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument()
    expect(screen.queryByText(/Couldn.t load/)).not.toBeInTheDocument()
  })
})

describe('B2B-57b Usage log — State C, delivery not configured', () => {
  it('shows "Delivery not configured" for every row plus the inline notice with a working Integration link', async () => {
    mockFetchOnce({
      rows: [
        {
          id: 'row-1',
          event_type: 'usage.voice_minute',
          clio_session_ref: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
          reference: 'order-48213',
          quantity: 14.2,
          unit: 'minutes',
          generation_type: null,
          test_mode: false,
          occurred_at: '2026-07-30T09:41:00.000Z',
          delivery_status: 'not_configured',
          http_status_code: null,
        },
      ],
      has_more: false,
      delivery_configured: false,
    })
    renderClient()

    await waitFor(() => expect(screen.getByText('Delivery not configured')).toBeInTheDocument())
    expect(screen.getByText(/Delivery isn.t configured for your account yet/)).toBeInTheDocument()

    const link = screen.getByRole('link', { name: 'Configure it on the Integration page →' })
    expect(link).toHaveAttribute('href', '/dashboard/configurator/integration?partner_account_id=acct-1')
  })
})

describe('B2B-57b Usage log — event type filter', () => {
  it('re-fetches with the selected event_type and resets to the filtered first page', async () => {
    mockFetchSequence([
      {
        rows: [
          {
            id: 'row-1',
            event_type: 'usage.voice_minute',
            clio_session_ref: 'ref-1',
            reference: 'order-1',
            quantity: 5,
            unit: 'minutes',
            generation_type: null,
            test_mode: false,
            occurred_at: '2026-07-30T09:41:00.000Z',
            delivery_status: 'delivered',
            http_status_code: 200,
          },
        ],
        has_more: false,
        delivery_configured: true,
      },
      {
        rows: [
          {
            id: 'row-2',
            event_type: 'usage.llm_generation_call',
            clio_session_ref: 'ref-2',
            reference: 'order-2',
            quantity: 1,
            unit: 'calls',
            generation_type: 'topic',
            test_mode: true,
            occurred_at: '2026-07-30T09:38:00.000Z',
            delivery_status: 'delivered',
            http_status_code: 200,
          },
        ],
        has_more: false,
        delivery_configured: true,
      },
    ])
    renderClient()

    await waitFor(() => expect(screen.getByText('order-1')).toBeInTheDocument())

    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'usage.llm_generation_call' } })

    await waitFor(() => expect(screen.getByText('order-2')).toBeInTheDocument())
    expect(screen.queryByText('order-1')).not.toBeInTheDocument()

    const secondCallUrl = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[1][0] as string
    expect(secondCallUrl).toContain('event_type=usage.llm_generation_call')
    expect(secondCallUrl).toContain('offset=0')

    // Amount column singularizes "calls" -> "call" at quantity 1, with generation_type in parens.
    expect(screen.getByText('1 call (topic)')).toBeInTheDocument()
  })
})

describe('B2B-57b Usage log — pagination', () => {
  it('"Load more" appends the next page without removing existing rows, and disappears once has_more is false', async () => {
    mockFetchSequence([
      {
        rows: [
          {
            id: 'row-1',
            event_type: 'usage.voice_minute',
            clio_session_ref: 'ref-1',
            reference: 'order-1',
            quantity: 5,
            unit: 'minutes',
            generation_type: null,
            test_mode: false,
            occurred_at: '2026-07-30T09:41:00.000Z',
            delivery_status: 'delivered',
            http_status_code: 200,
          },
        ],
        has_more: true,
        delivery_configured: true,
      },
      {
        rows: [
          {
            id: 'row-2',
            event_type: 'session.completed',
            clio_session_ref: 'ref-2',
            reference: 'order-2',
            quantity: null,
            unit: null,
            generation_type: null,
            test_mode: false,
            occurred_at: '2026-07-29T09:41:00.000Z',
            delivery_status: 'delivered',
            http_status_code: 200,
          },
        ],
        has_more: false,
        delivery_configured: true,
      },
    ])
    renderClient()

    await waitFor(() => expect(screen.getByText('order-1')).toBeInTheDocument())
    const loadMoreButton = screen.getByRole('button', { name: 'Load more' })
    fireEvent.click(loadMoreButton)

    await waitFor(() => expect(screen.getByText('order-2')).toBeInTheDocument())
    expect(screen.getByText('order-1')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Load more' })).not.toBeInTheDocument()
  })

  it('a failed "Load more" fetch keeps existing rows and shows an inline retry message instead of the full error Card', async () => {
    let call = 0
    global.fetch = vi.fn(() => {
      call += 1
      if (call === 1) {
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              rows: [
                {
                  id: 'row-1',
                  event_type: 'usage.voice_minute',
                  clio_session_ref: 'ref-1',
                  reference: 'order-1',
                  quantity: 5,
                  unit: 'minutes',
                  generation_type: null,
                  test_mode: false,
                  occurred_at: '2026-07-30T09:41:00.000Z',
                  delivery_status: 'delivered',
                  http_status_code: 200,
                },
              ],
              has_more: true,
              delivery_configured: true,
            }),
        } as Response)
      }
      return Promise.resolve({ ok: false, json: () => Promise.resolve({}) } as Response)
    }) as unknown as typeof fetch

    renderClient()

    await waitFor(() => expect(screen.getByText('order-1')).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: 'Load more' }))

    await waitFor(() => expect(screen.getByText("Couldn't load more — try again")).toBeInTheDocument())
    expect(screen.getByText('order-1')).toBeInTheDocument()
    expect(screen.queryByText("Couldn't load your usage log right now. Try refreshing the page.")).not.toBeInTheDocument()
  })
})

describe('B2B-57b Usage log — State E, initial fetch error', () => {
  it('renders the error Card and no table when the initial fetch fails', async () => {
    global.fetch = vi.fn(() => Promise.resolve({ ok: false, json: () => Promise.resolve({}) } as Response)) as unknown as typeof fetch
    renderClient()

    await waitFor(() =>
      expect(screen.getByText("Couldn't load your usage log right now. Try refreshing the page.")).toBeInTheDocument()
    )
    expect(document.querySelector('table')).toBeNull()
  })
})
