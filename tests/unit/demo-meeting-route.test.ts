import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

/**
 * B2B-33 (docs/specs/B2B-33-requirement-document.md §6.1/§6.2, AT-2/AT-3/AT-4). Covers
 * GET/POST /api/demo/[slug]/meeting — reading/saving the Google Meet URL for a public demo topic.
 * GET is unauthenticated; POST is passcode-gated (write-only) and must never write a row on an
 * incorrect passcode or invalid URL.
 *
 * B2B-36 F4 (docs/specs/B2B-36-requirement-document.md §6.7) — end_user_name is now required
 * alongside meeting_url. Pre-existing tests below are updated to include it so they keep
 * validating their original scenario rather than failing on an unrelated missing field.
 *
 * B2B-42 (docs/specs/B2B-42-requirement-document.md §13.1) — the passcode check no longer compares
 * against the single shared DEMO_MEETING_PASSCODE env var (lib/demo/passcode.ts, deleted). It now
 * resolves, per-account, via resolveDemoPasscodeToAccount() (lib/demo/passcode-accounts.ts), mocked
 * here exactly as tests/unit/demo-dispatch-route.test.ts's own B2B-39 rewrite already does for the
 * sibling dispatch route.
 */

const state = {
  upserted: [] as unknown[],
  row: null as { meeting_url: string; end_user_name: string | null; updated_at: string } | null,
  resolvedPasscode: null as { partnerAccountId: string; passcodeId: string } | null,
}

vi.mock('@/lib/demo/passcode-accounts', () => ({
  resolveDemoPasscodeToAccount: vi.fn(() => Promise.resolve(state.resolvedPasscode)),
}))

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
              Promise.resolve({
                data: { meeting_url: 'https://meet.google.com/abc-defg-hij', end_user_name: 'Arun', updated_at: '2026-07-23T00:00:00.000Z' },
                error: null,
              })
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

  it('returns null meeting_url/end_user_name/updated_at when nothing is saved yet (not an error)', async () => {
    const res = await GET(getRequest(), { params: { slug: 'claude-ai' } })
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body).toEqual({ meeting_url: null, end_user_name: null, updated_at: null })
  })

  it('returns the saved row when one exists', async () => {
    state.row = { meeting_url: 'https://meet.google.com/abc-defg-hij', end_user_name: 'Arun', updated_at: '2026-07-22T16:03:00.000Z' }
    const res = await GET(getRequest(), { params: { slug: 'claude-ai' } })
    const body = await res.json()
    expect(body).toEqual({ meeting_url: 'https://meet.google.com/abc-defg-hij', end_user_name: 'Arun', updated_at: '2026-07-22T16:03:00.000Z' })
  })

  // B2B-36 F4 — the migration edge case: a pre-existing row with a saved URL but no saved name.
  it('returns end_user_name: null when the saved row predates the B2B-36 migration (URL saved, no name)', async () => {
    state.row = { meeting_url: 'https://meet.google.com/abc-defg-hij', end_user_name: null, updated_at: '2026-07-25T04:20:01.000Z' }
    const res = await GET(getRequest(), { params: { slug: 'claude-ai' } })
    const body = await res.json()
    expect(body).toEqual({ meeting_url: 'https://meet.google.com/abc-defg-hij', end_user_name: null, updated_at: '2026-07-25T04:20:01.000Z' })
  })
})

describe('POST /api/demo/[slug]/meeting', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    state.upserted = []
    state.row = null
    state.resolvedPasscode = null
  })

  it('AT-3: 401s on an incorrect/unrecognized passcode and never writes a row', async () => {
    state.resolvedPasscode = null
    const res = await POST(postRequest({ meeting_url: 'https://meet.google.com/abc-defg-hij', end_user_name: 'Arun', passcode: 'wrong' }), {
      params: { slug: 'claude-ai' },
    })
    const body = await res.json()
    expect(res.status).toBe(401)
    expect(body.error.code).toBe('incorrect_passcode')
    expect(state.upserted).toHaveLength(0)
  })

  it('AT-4: 401s when the passcode matches a revoked demo_passcodes row (resolves to null)', async () => {
    state.resolvedPasscode = null // resolveDemoPasscodeToAccount already filters revoked_at IS NULL
    const res = await POST(postRequest({ meeting_url: 'https://meet.google.com/abc-defg-hij', end_user_name: 'Arun', passcode: 'anything' }), {
      params: { slug: 'claude-ai' },
    })
    expect(res.status).toBe(401)
    expect(state.upserted).toHaveLength(0)
  })

  it('AT-5: 401s when the OLD DEMO_MEETING_PASSCODE-style value is sent but does not resolve to any demo_passcodes row', async () => {
    // Proves the mechanism swap took effect, not just that the code compiles — the pre-B2B-42
    // shared secret carries no special meaning to resolveDemoPasscodeToAccount() and is treated
    // like any other unrecognized string.
    state.resolvedPasscode = null
    const res = await POST(
      postRequest({ meeting_url: 'https://meet.google.com/abc-defg-hij', end_user_name: 'Arun', passcode: 'old-demo-meeting-passcode-value' }),
      { params: { slug: 'claude-ai' } }
    )
    expect(res.status).toBe(401)
    expect(state.upserted).toHaveLength(0)
  })

  it('422s a non-https URL and never writes a row', async () => {
    const res = await POST(
      postRequest({ meeting_url: 'http://meet.google.com/abc-defg-hij', end_user_name: 'Arun', passcode: 'correct-passcode' }),
      { params: { slug: 'claude-ai' } }
    )
    expect(res.status).toBe(422)
    expect(state.upserted).toHaveLength(0)
  })

  it('AT-1: saves on a valid reseller passcode + valid https URL + name, returning the saved row', async () => {
    state.resolvedPasscode = { partnerAccountId: 'acct-reseller-1', passcodeId: 'passcode-1' }
    const res = await POST(
      postRequest({ meeting_url: 'https://meet.google.com/abc-defg-hij', end_user_name: 'Arun', passcode: 'correct-passcode' }),
      { params: { slug: 'claude-ai' } }
    )
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body).toEqual({ meeting_url: 'https://meet.google.com/abc-defg-hij', end_user_name: 'Arun', updated_at: '2026-07-23T00:00:00.000Z' })
    expect(state.upserted).toHaveLength(1)
    expect(state.upserted[0]).toMatchObject({ end_user_name: 'Arun' })
  })

  it('AT-2: saves on a valid admin-sentinel-account passcode + valid https URL + name', async () => {
    state.resolvedPasscode = { partnerAccountId: '30d40f51-5d6e-49e9-bdda-519b7d70e13a', passcodeId: 'passcode-admin-1' }
    const res = await POST(
      postRequest({ meeting_url: 'https://meet.google.com/abc-defg-hij', end_user_name: 'Arun', passcode: 'admin-correct-passcode' }),
      { params: { slug: 'claude-ai' } }
    )
    expect(res.status).toBe(200)
    expect(state.upserted).toHaveLength(1)
  })

  it('404s an unknown slug before any passcode check', async () => {
    const res = await POST(
      postRequest({ meeting_url: 'https://meet.google.com/abc-defg-hij', end_user_name: 'Arun', passcode: 'correct-passcode' }),
      { params: { slug: 'not-a-real-topic' } }
    )
    expect(res.status).toBe(404)
    expect(state.upserted).toHaveLength(0)
  })

  // B2B-36 F4 (docs/specs/B2B-36-requirement-document.md §6.7/§8) — end_user_name is required.
  describe('B2B-36 F4 — end_user_name required', () => {
    it('422s with validation_failed and the updated message when end_user_name is missing', async () => {
      const res = await POST(
        postRequest({ meeting_url: 'https://meet.google.com/abc-defg-hij', passcode: 'correct-passcode' }),
        { params: { slug: 'claude-ai' } }
      )
      const body = await res.json()
      expect(res.status).toBe(422)
      expect(body.error.code).toBe('validation_failed')
      expect(body.error.message).toBe('Enter a name and a valid https:// meeting URL.')
      expect(state.upserted).toHaveLength(0)
    })

    it('422s with validation_failed when end_user_name is an empty string', async () => {
      const res = await POST(
        postRequest({ meeting_url: 'https://meet.google.com/abc-defg-hij', end_user_name: '', passcode: 'correct-passcode' }),
        { params: { slug: 'claude-ai' } }
      )
      expect(res.status).toBe(422)
      expect(state.upserted).toHaveLength(0)
    })
  })
})
