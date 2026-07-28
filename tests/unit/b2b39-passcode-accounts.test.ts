import { describe, it, expect, vi, beforeEach } from 'vitest'
import crypto from 'crypto'

/**
 * B2B-39 (docs/specs/B2B-39-requirement-document.md §6.4). Tests for
 * lib/demo/passcode-accounts.ts: generateDemoPasscode (format/entropy), hashDemoPasscode
 * (normalization), and resolveDemoPasscodeToAccount (dispatch-time resolution, AT-2's "old passcode
 * fails immediately" behavior).
 */

const state: { row: { id: string; partner_account_id: string } | null } = { row: null }

vi.mock('@/lib/supabase', () => ({
  createSupabaseAdminClient: vi.fn(() => ({
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          is: vi.fn(() => ({
            maybeSingle: vi.fn(() => Promise.resolve({ data: state.row })),
          })),
        })),
      })),
    })),
  })),
}))

import { generateDemoPasscode, hashDemoPasscode, resolveDemoPasscodeToAccount, DEMO_ADMIN_PARTNER_ACCOUNT_ID } from '@/lib/demo/passcode-accounts'

describe('generateDemoPasscode', () => {
  it('produces a 10-character code (plus one cosmetic hyphen) in XXXX-XXXXXX format', () => {
    const generated = generateDemoPasscode()
    expect(generated.passcode).toMatch(/^[A-Z0-9]{4}-[A-Z0-9]{6}$/)
    expect(generated.passcode.replace('-', '')).toHaveLength(10)
  })

  it('only uses the unambiguous 31-symbol alphabet (excludes O, I, L, 0, 1)', () => {
    for (let i = 0; i < 20; i++) {
      const generated = generateDemoPasscode()
      const chars = generated.passcode.replace('-', '')
      expect(chars).not.toMatch(/[OIL01]/)
    }
  })

  it('passcodePrefix is exactly the first 4 characters', () => {
    const generated = generateDemoPasscode()
    expect(generated.passcodePrefix).toBe(generated.passcode.slice(0, 4))
  })

  it('passcodeHash is the SHA-256 hex digest of the hyphen-stripped, uppercased plaintext', () => {
    const generated = generateDemoPasscode()
    const expected = crypto.createHash('sha256').update(generated.passcode.replace('-', '').toUpperCase()).digest('hex')
    expect(generated.passcodeHash).toBe(expected)
  })

  it('generates different plaintexts across calls (no fixed/hardcoded output)', () => {
    const a = generateDemoPasscode()
    const b = generateDemoPasscode()
    expect(a.passcode).not.toBe(b.passcode)
  })
})

describe('hashDemoPasscode', () => {
  it('produces the same hash regardless of hyphen, case, or surrounding whitespace', () => {
    const h1 = hashDemoPasscode('XK7P-4QRT9M')
    const h2 = hashDemoPasscode('xk7p4qrt9m')
    const h3 = hashDemoPasscode('  XK7P 4QRT9M  ')
    expect(h1).toBe(h2)
    expect(h1).toBe(h3)
  })

  it('produces different hashes for different passcodes', () => {
    expect(hashDemoPasscode('AAAA-BBBBBB')).not.toBe(hashDemoPasscode('CCCC-DDDDDD'))
  })
})

describe('resolveDemoPasscodeToAccount', () => {
  beforeEach(() => {
    state.row = null
  })

  it('returns the billing account id + passcode row id for an active passcode', async () => {
    state.row = { id: 'passcode-1', partner_account_id: 'acct-1' }
    const result = await resolveDemoPasscodeToAccount('XK7P-4QRT9M')
    expect(result).toEqual({ partnerAccountId: 'acct-1', passcodeId: 'passcode-1' })
  })

  // AT-2 — a demo dispatch attempted with the OLD (revoked) passcode immediately returns null,
  // since the lookup query filters revoked_at IS NULL — a revoked row is never returned by the mock
  // in this test's setup (state.row stays null, mirroring the DB-level filter).
  it('returns null when no active (non-revoked) passcode matches — AT-2 regression', async () => {
    state.row = null
    const result = await resolveDemoPasscodeToAccount('WRONG-PASSCO')
    expect(result).toBeNull()
  })
})

describe('DEMO_ADMIN_PARTNER_ACCOUNT_ID', () => {
  it('matches the "Clio Internal — Public Demo" sentinel account id used elsewhere in the codebase', () => {
    expect(DEMO_ADMIN_PARTNER_ACCOUNT_ID).toBe('30d40f51-5d6e-49e9-bdda-519b7d70e13a')
  })
})
