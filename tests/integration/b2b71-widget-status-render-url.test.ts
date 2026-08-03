import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

/**
 * B2B-71 (docs/specs/B2B-71-requirement-document.md §6.2/§13) — GET /api/demo/[slug]/widget-status
 * now constructs render_url on the new /widget-render/ route instead of /partner-render/. No prior
 * test file existed for this route (confirmed by the requirement doc's own §0) — this is a wholly
 * new test file, not a modification of an existing one.
 */

vi.mock('@/app/(demo)/demo/_content', () => ({
  getDemoTopicBySlug: (slug: string) => (slug === 'claude-ai' ? { slug: 'claude-ai' } : null),
}))

const latestWidgetRowsMock = vi.fn()

vi.mock('@/lib/supabase', () => ({
  createSupabaseAdminClient: () => ({
    from: (table: string) => {
      if (table === 'partner_sessions') {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                eq: () => ({
                  order: () => ({
                    limit: async () => latestWidgetRowsMock(),
                  }),
                }),
              }),
            }),
          }),
        }
      }
      throw new Error(`Unexpected table: ${table}`)
    },
  }),
}))

import { GET } from '@/app/api/demo/[slug]/widget-status/route'

function makeRequest(): NextRequest {
  return new NextRequest('http://localhost:3000/api/demo/claude-ai/widget-status')
}

describe('GET /api/demo/[slug]/widget-status — render_url construction', () => {
  beforeEach(() => {
    vi.stubEnv('DEMO_PARTNER_ACCOUNT_ID', 'demo-acct-1')
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://distill-peach.vercel.app')
    latestWidgetRowsMock.mockReset()
  })

  it('returns render_url on /widget-render/, not /partner-render/, for an active widget session', async () => {
    latestWidgetRowsMock.mockResolvedValue({ data: [{ id: 'session-1', status: 'widget_active' }], error: null })

    const res = await GET(makeRequest(), { params: { slug: 'claude-ai' } })
    const json = await res.json()

    expect(json.active).toBe(true)
    expect(json.render_url).toBe('https://distill-peach.vercel.app/widget-render/session-1')
    expect(json.render_url).not.toContain('/partner-render/')
  })

  it('returns active:false with no render_url when no widget session is active', async () => {
    latestWidgetRowsMock.mockResolvedValue({ data: [], error: null })

    const res = await GET(makeRequest(), { params: { slug: 'claude-ai' } })
    const json = await res.json()

    expect(json).toEqual({ active: false, clio_session_ref: null, render_url: null })
  })
})
