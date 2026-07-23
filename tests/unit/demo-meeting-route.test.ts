import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

/**
 * B2B-33 (docs/specs/B2B-33-requirement-document.md §6.1/§6.2, AT-2/AT-3/AT-4). Covers
 * GET/POST /api/demo/[slug]/meeting — reading/saving the Google Meet URL for a public demo topic.
 * GET is unauthenticated; POST is passcode-gated (write-only) and must never write a row on an
 * incorrect passcode or invalid URL.
 */

const state = { upserted: [] as unknown[], row: null as { meeting_url: string; updated_at: string } | null }

vi.mock('@/lib/supabase', () => ({
  createSupabaseAdminClient: vi.fn(() => ({
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          maybeSingle: vi.fn(() => Promise.resolve({ data: state.row })),
        })),
      })),
      upsert: vi.fn((row: unknown) => {
        state.upserted.push(row)
        return {
          select: vi.fn(() => ({
            single: vi.fn(() =>
              Promise.resolve({ data: { meeting_url: 'https://meet.google.com/abc-defg-hij', updated_at: '2026-07-23T00:00:00.000Z' }, error: null })
            ),
          })),
        }
      }),
    })),
  })),
}))

import { GET, POST } from '@/app/api/demo/[slug]/meeting/route'

function getRequest() {
  return new NextRequest('https://test.hello-clio.com/api/demo/claude-ai/meeting')
}

function postRequest(body: unknown) {
  return new NextRequest('https://test.hello-clio.com/api/demo/claude-ai/meeting', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  })
}

describe('GET /api/demo/[slug]/meeting', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    state.upserted = []
    state.row = null
  })

  it('404s an unknown slug', async () => {
    const res = await GET(getRequest(), { params: { slug: 'not-a-real-topic' } })
    expect(res.status).toBe(404)
  })

  it('returns null meeting_url/updated_at when nothing is saved yet (not an error)', async () => {
    const res = await GET(getRequest(), { params: { slug: 'claude-ai' } })
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body).toEqual({ meeting_url: null, updated_at: null })
  })

  it('returns the saved row when one exists', async () => {
    state.row = { meeting_url: 'https://meet.google.com/abc-defg-hij', updated_at: '2026-07-22T16:03:00.000Z' }
    const res = await GET(getRequest(), { params: { slug: 'claude-ai' } })
    const body = await res.json()
    expect(body).toEqual({ meeting_url: 'https://meet.google.com/abc-defg-hij', updated_at: '2026-07-22T16:03:00.000Z' })
  })
})

describe('POST /api/demo/[slug]/meeting', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    state.upserted = []
    state.row = null
    process.env.DEMO_MEETING_PASSCODE = 'correct-passcode'
  })

  it('AT-4: 401s on an incorrect passcode and never writes a row', async () => {
    const res = await POST(postRequest({ meeting_url: 'https://meet.google.com/abc-defg-hij', passcode: 'wrong' }), {
      params: { slug: 'claude-ai' },
    })
    const body = await res.json()
    expect(res.status).toBe(401)
    expect(body.error.code).toBe('incorrect_passcode')
    expect(state.upserted).toHaveLength(0)
  })

  it('fails closed (401) when DEMO_MEETING_PASSCODE is unconfigured, even with a matching empty guess', async () => {
    delete process.env.DEMO_MEETING_PASSCODE
    const res = await POST(postRequest({ meeting_url: 'https://meet.google.com/abc-defg-hij', passcode: 'anything' }), {
      params: { slug: 'claude-ai' },
    })
    expect(res.status).toBe(401)
    expect(state.upserted).toHaveLength(0)
  })

  it('422s a non-https URL and never writes a row', async () => {
    const res = await POST(postRequest({ meeting_url: 'http://meet.google.com/abc-defg-hij', passcode: 'correct-passcode' }), {
      params: { slug: 'claude-ai' },
    })
    expect(res.status).toBe(422)
    expect(state.upserted).toHaveLength(0)
  })

  it('AT-3: saves on a correct passcode + valid https URL, returning the saved row', async () => {
    const res = await POST(postRequest({ meeting_url: 'https://meet.google.com/abc-defg-hij', passcode: 'correct-passcode' }), {
      params: { slug: 'claude-ai' },
    })
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body).toEqual({ meeting_url: 'https://meet.google.com/abc-defg-hij', updated_at: '2026-07-23T00:00:00.000Z' })
    expect(state.upserted).toHaveLength(1)
  })

  it('404s an unknown slug before any passcode check', async () => {
    const res = await POST(postRequest({ meeting_url: 'https://meet.google.com/abc-defg-hij', passcode: 'correct-passcode' }), {
      params: { slug: 'not-a-real-topic' },
    })
    expect(res.status).toBe(404)
    expect(state.upserted).toHaveLength(0)
  })
})
