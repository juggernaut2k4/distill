import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * B2B-28 (docs/specs/B2B-28-requirement-document.md §7) — unit tests for
 * lib/internal-admin/direct-partner-invites.ts. Covers issuance, the
 * computed (never-stored) 'expired' status (§6.2), revoke-only-if-pending
 * (AT-10/11), and the token lookup's single-use semantics (AT-17).
 */

interface InviteState {
  insertError: string | null
  listData: unknown[]
  singleData: { id?: string; status: string; invite_token_expires_at: string } | null
  markData: unknown[] | null
}

const state: InviteState = { insertError: null, listData: [], singleData: null, markData: null }

vi.mock('@/lib/supabase', () => ({
  createSupabaseAdminClient: vi.fn(() => ({
    from: vi.fn((table: string) => {
      if (table !== 'direct_partner_invites') {
        throw new Error(`Unexpected table in mock: ${table}`)
      }
      let op: 'insert' | 'update' | 'select' | null = null
      const builder: {
        insert: ReturnType<typeof vi.fn>
        update: ReturnType<typeof vi.fn>
        select: ReturnType<typeof vi.fn>
        eq: ReturnType<typeof vi.fn>
        order: ReturnType<typeof vi.fn>
        maybeSingle: ReturnType<typeof vi.fn>
        then: (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) => Promise<unknown>
      } = {
        insert: vi.fn(() => {
          op = 'insert'
          return builder
        }),
        update: vi.fn(() => {
          op = 'update'
          return builder
        }),
        select: vi.fn(() => {
          if (op === null) op = 'select'
          return builder
        }),
        eq: vi.fn(() => builder),
        order: vi.fn(() => builder),
        maybeSingle: vi.fn(() => Promise.resolve({ data: state.singleData })),
        then: (resolve, reject) => {
          if (op === 'insert') return Promise.resolve({ error: state.insertError }).then(resolve, reject)
          if (op === 'select') return Promise.resolve({ data: state.listData }).then(resolve, reject)
          if (op === 'update') return Promise.resolve({ data: state.markData }).then(resolve, reject)
          return Promise.resolve({ data: null }).then(resolve, reject)
        },
      }
      return builder
    }),
  })),
}))

import {
  issueDirectPartnerInvite,
  listDirectPartnerInvites,
  revokeDirectPartnerInvite,
  lookupDirectPartnerInviteByToken,
  markDirectPartnerInviteAccepted,
} from '@/lib/internal-admin/direct-partner-invites'

describe('issueDirectPartnerInvite', () => {
  beforeEach(() => {
    state.insertError = null
  })

  it('creates a pending row and returns a single-use plaintext accept URL, never persisted', async () => {
    const result = await issueDirectPartnerInvite('Pluralsight — Jan outreach', 'admin-1')
    expect(result.success).toBe(true)
    expect(result.error).toBeNull()
    expect(result.acceptUrl).toMatch(/\/partner-invite\/accept\?token=[0-9a-f]{48}$/)
  })

  it('accepts a null label (optional field)', async () => {
    const result = await issueDirectPartnerInvite(null, 'admin-1')
    expect(result.success).toBe(true)
    expect(result.acceptUrl).toBeTruthy()
  })

  it('surfaces an insert failure without a plaintext URL', async () => {
    state.insertError = 'db unavailable'
    const result = await issueDirectPartnerInvite('label', 'admin-1')
    expect(result.success).toBe(false)
    expect(result.acceptUrl).toBeNull()
  })
})

describe('listDirectPartnerInvites — computed status (AT-9)', () => {
  it('flips a past-expiry pending row to "expired" at read time without touching accepted/revoked rows, and never mutates the stored status', async () => {
    const past = new Date(Date.now() - 1000).toISOString()
    const future = new Date(Date.now() + 60 * 60 * 1000).toISOString()
    state.listData = [
      { id: 'inv-expired', label: 'A', status: 'pending', invite_token_expires_at: past, created_at: 'x', accepted_at: null, internal_admin_users: { email: 'a@x.com' } },
      { id: 'inv-pending', label: 'B', status: 'pending', invite_token_expires_at: future, created_at: 'y', accepted_at: null, internal_admin_users: { email: 'b@x.com' } },
      { id: 'inv-accepted', label: 'C', status: 'accepted', invite_token_expires_at: past, created_at: 'z', accepted_at: 'z2', internal_admin_users: { email: 'c@x.com' } },
      { id: 'inv-revoked', label: 'D', status: 'revoked', invite_token_expires_at: past, created_at: 'w', accepted_at: null, internal_admin_users: { email: 'd@x.com' } },
    ]

    const rows = await listDirectPartnerInvites()

    expect(rows.find((r) => r.id === 'inv-expired')!.status).toBe('expired')
    expect(rows.find((r) => r.id === 'inv-pending')!.status).toBe('pending')
    expect(rows.find((r) => r.id === 'inv-accepted')!.status).toBe('accepted')
    expect(rows.find((r) => r.id === 'inv-revoked')!.status).toBe('revoked')
  })

  it('resolves the creator email via the joined internal_admin_users row', async () => {
    state.listData = [
      { id: 'inv-1', label: null, status: 'pending', invite_token_expires_at: new Date(Date.now() + 100000).toISOString(), created_at: 'x', accepted_at: null, internal_admin_users: { email: 'super@clio.example' } },
    ]
    const rows = await listDirectPartnerInvites()
    expect(rows[0].created_by_email).toBe('super@clio.example')
    expect(rows[0].label).toBeNull()
  })
})

describe('revokeDirectPartnerInvite (AT-10/11)', () => {
  it('revokes a genuinely pending, unexpired row', async () => {
    state.singleData = { status: 'pending', invite_token_expires_at: new Date(Date.now() + 100000).toISOString() }
    const result = await revokeDirectPartnerInvite('inv-1')
    expect(result.success).toBe(true)
    expect(result.error).toBeNull()
  })

  it('rejects revoking an already-accepted row (409-producing at the route level)', async () => {
    state.singleData = { status: 'accepted', invite_token_expires_at: new Date(Date.now() + 100000).toISOString() }
    const result = await revokeDirectPartnerInvite('inv-1')
    expect(result.success).toBe(false)
    expect(result.error).toBe('not_pending')
  })

  it('rejects revoking an already-revoked row', async () => {
    state.singleData = { status: 'revoked', invite_token_expires_at: new Date(Date.now() + 100000).toISOString() }
    const result = await revokeDirectPartnerInvite('inv-1')
    expect(result.success).toBe(false)
    expect(result.error).toBe('not_pending')
  })

  it('rejects revoking a computed-expired (still stored as pending) row', async () => {
    state.singleData = { status: 'pending', invite_token_expires_at: new Date(Date.now() - 1000).toISOString() }
    const result = await revokeDirectPartnerInvite('inv-1')
    expect(result.success).toBe(false)
    expect(result.error).toBe('not_pending')
  })
})

describe('lookupDirectPartnerInviteByToken (AT-12/13/17)', () => {
  it('returns valid for a genuinely pending, unexpired token', async () => {
    state.singleData = { id: 'inv-1', status: 'pending', invite_token_expires_at: new Date(Date.now() + 100000).toISOString() }
    const result = await lookupDirectPartnerInviteByToken('some-token')
    expect(result.valid).toBe(true)
    expect(result.inviteId).toBe('inv-1')
  })

  it('returns invalid for an expired token even though the stored status is still pending', async () => {
    state.singleData = { id: 'inv-1', status: 'pending', invite_token_expires_at: new Date(Date.now() - 1000).toISOString() }
    const result = await lookupDirectPartnerInviteByToken('some-token')
    expect(result.valid).toBe(false)
    expect(result.inviteId).toBeNull()
  })

  it('returns invalid for an already-accepted token (single-use — AT-17)', async () => {
    state.singleData = { id: 'inv-1', status: 'accepted', invite_token_expires_at: new Date(Date.now() + 100000).toISOString() }
    const result = await lookupDirectPartnerInviteByToken('some-token')
    expect(result.valid).toBe(false)
  })

  it('returns invalid for a revoked token', async () => {
    state.singleData = { id: 'inv-1', status: 'revoked', invite_token_expires_at: new Date(Date.now() + 100000).toISOString() }
    const result = await lookupDirectPartnerInviteByToken('some-token')
    expect(result.valid).toBe(false)
  })

  it('returns invalid for an unrecognized token (no-info-leak: same shape as expired/consumed)', async () => {
    state.singleData = null
    const result = await lookupDirectPartnerInviteByToken('unknown-token')
    expect(result.valid).toBe(false)
    expect(result.inviteId).toBeNull()
  })
})

describe('markDirectPartnerInviteAccepted', () => {
  it('does not throw when the conditional UPDATE affects zero rows (concurrent-accept race, §9 Edge Case 2)', async () => {
    state.markData = []
    await expect(markDirectPartnerInviteAccepted('inv-1', 'acct-1')).resolves.toBeUndefined()
  })

  it('resolves normally on a successful single-row update', async () => {
    state.markData = [{ id: 'inv-1' }]
    await expect(markDirectPartnerInviteAccepted('inv-1', 'acct-1')).resolves.toBeUndefined()
  })
})
