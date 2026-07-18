import crypto from 'crypto'

/**
 * B2B-21 — Sales-partner / super-admin invite token generation & hashing.
 *
 * Mirrors `lib/partner/api-keys.ts` (`generateApiKey`/`hashApiKey`) exactly:
 * `crypto.randomBytes(24).toString('hex')` (48 hex chars) as the plaintext
 * token, SHA-256 hex digest stored as `internal_admin_users.invite_token_hash`.
 * The plaintext token is embedded once in the invite email URL
 * (`/invite/accept?token=<plaintext>`) and never persisted anywhere.
 * Requirement Doc §6.5.
 */

export interface GeneratedInviteToken {
  /** Full plaintext token. Shown to the invitee exactly once — never store this value. */
  token: string
  /** SHA-256 hex digest of `token` — the only form ever persisted. */
  tokenHash: string
}

/** Generates a new invite token. Never logs the plaintext value. */
export function generateInviteToken(): GeneratedInviteToken {
  const token = crypto.randomBytes(24).toString('hex') // 48 hex chars
  return { token, tokenHash: hashInviteToken(token) }
}

/** SHA-256 hex digest of a plaintext token — used both at issuance and at every accept lookup. */
export function hashInviteToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex')
}

/** 7 days from issue/resend (Requirement Doc §6.5) — a plain technical default. */
export function inviteExpiresAt(): string {
  return new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()
}
