import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  encryptContentSourceCredential,
  decryptContentSourceCredential,
} from '@/lib/partner/crypto'
import { resolveContentSourceHeaders, type ContentSourceRow } from '@/lib/partner/content-sources'

describe('B2B-19 content-source credentials', () => {
  beforeEach(() => {
    vi.stubEnv('PARTNER_OUTBOUND_TOKEN_ENCRYPTION_KEY', 'PLACEHOLDER_ENCRYPTION_KEY')
  })

  // AT-3 — round-trip for a bearer token and for an oauth {client_id, client_secret} blob.
  it('round-trips a bearer token (encrypt → decrypt)', () => {
    const token = 'partner-bearer-abc-123'
    const ct = encryptContentSourceCredential(token)
    expect(ct).toMatch(/^v1:[0-9a-f]+:[0-9a-f]+:[0-9a-f]+$/) // v1:<iv>:<tag>:<data>
    expect(ct).not.toContain(token) // plaintext never appears
    expect(decryptContentSourceCredential(ct)).toBe(token)
  })

  it('round-trips an oauth client_id/client_secret blob', () => {
    const blob = JSON.stringify({ client_id: 'abc123', client_secret: 'shhh-secret' })
    const ct = encryptContentSourceCredential(blob)
    expect(ct).not.toContain('shhh-secret')
    expect(JSON.parse(decryptContentSourceCredential(ct)!)).toEqual({ client_id: 'abc123', client_secret: 'shhh-secret' })
  })

  it('decryptContentSourceCredential returns null (never throws) on corrupt input', () => {
    expect(decryptContentSourceCredential('garbage')).toBeNull()
    expect(decryptContentSourceCredential(null)).toBeNull()
  })

  // AT-4 (code-level) — these are the AES-256-GCM path, not the hashApiKey path:
  // the exact ciphertext round-trips back to plaintext, which a hash never could.
  it('is retrievable-not-hashed (a hash could never round-trip)', () => {
    const secret = 'must-be-replayable-outward'
    expect(decryptContentSourceCredential(encryptContentSourceCredential(secret))).toBe(secret)
  })
})

describe('B2B-19 resolveContentSourceHeaders', () => {
  const base: ContentSourceRow = {
    id: 'cs-1',
    partnerAccountId: 'pa-1',
    authType: 'none',
    credentialCiphertext: null,
    oauthTokenUrl: null,
    oauthScope: null,
    oauthAudience: null,
    headerName: null,
    headerScheme: null,
  }

  beforeEach(() => {
    vi.stubEnv('PARTNER_OUTBOUND_TOKEN_ENCRYPTION_KEY', 'PLACEHOLDER_ENCRYPTION_KEY')
  })

  it('none → no headers', async () => {
    const res = await resolveContentSourceHeaders(base)
    expect(res).toEqual({ status: 'ok', headers: {} })
  })

  it('static_bearer → default Authorization: Bearer <token>', async () => {
    const row: ContentSourceRow = {
      ...base,
      authType: 'static_bearer',
      credentialCiphertext: encryptContentSourceCredential('tok-xyz'),
      headerName: 'Authorization',
      headerScheme: 'Bearer',
    }
    const res = await resolveContentSourceHeaders(row)
    expect(res).toEqual({ status: 'ok', headers: { Authorization: 'Bearer tok-xyz' } })
  })

  it('static_bearer with custom header + empty scheme → raw header value', async () => {
    const row: ContentSourceRow = {
      ...base,
      authType: 'static_bearer',
      credentialCiphertext: encryptContentSourceCredential('rawkey'),
      headerName: 'X-Api-Key',
      headerScheme: '',
    }
    const res = await resolveContentSourceHeaders(row)
    expect(res).toEqual({ status: 'ok', headers: { 'X-Api-Key': 'rawkey' } })
  })

  it('static_bearer with undecryptable credential → unavailable (never throws)', async () => {
    const row: ContentSourceRow = { ...base, authType: 'static_bearer', credentialCiphertext: 'corrupt' }
    const res = await resolveContentSourceHeaders(row)
    expect(res.status).toBe('unavailable')
  })
})
