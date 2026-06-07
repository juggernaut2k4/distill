/**
 * Clio session token — per-user short-lived JWT signed with SESSION_JWT_SECRET.
 * No third-party libraries needed: uses Node.js built-in crypto (HS256).
 *
 * Flow:
 *   POST /api/auth/session   → verify Clerk token → issue Clio JWT → return { token, expiresAt }
 *   All protected routes     → Accept Authorization: Bearer <clio-jwt>
 */

import crypto from 'crypto'
import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'

// ─── TOKEN ───────────────────────────────────────────────────────────────────

export interface ClioTokenPayload {
  userId: string
  iat: number
  exp: number
}

function secret(): string {
  const s = process.env.SESSION_JWT_SECRET
  if (!s) throw new Error('SESSION_JWT_SECRET is not set')
  return s
}

function b64url(s: string): string {
  return Buffer.from(s).toString('base64url')
}
function fromB64url(s: string): string {
  return Buffer.from(s, 'base64url').toString('utf8')
}

const HEADER = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))

export function signClioToken(userId: string, expirySeconds = 3600): string {
  const now = Math.floor(Date.now() / 1000)
  const payload: ClioTokenPayload = { userId, iat: now, exp: now + expirySeconds }
  const body = b64url(JSON.stringify(payload))
  const sig = crypto.createHmac('sha256', secret()).update(`${HEADER}.${body}`).digest('base64url')
  return `${HEADER}.${body}.${sig}`
}

export function verifyClioToken(token: string): ClioTokenPayload | null {
  try {
    const parts = token.split('.')
    if (parts.length !== 3) return null
    const [header, body, sig] = parts
    const expectedSig = crypto
      .createHmac('sha256', secret())
      .update(`${header}.${body}`)
      .digest('base64url')
    // Constant-time comparison to prevent timing attacks
    if (
      sig.length !== expectedSig.length ||
      !crypto.timingSafeEqual(Buffer.from(sig, 'utf8'), Buffer.from(expectedSig, 'utf8'))
    ) return null
    const payload = JSON.parse(fromB64url(body)) as ClioTokenPayload
    if (payload.exp < Math.floor(Date.now() / 1000)) return null
    return payload
  } catch {
    return null
  }
}

// ─── AUTH HELPER (ASYNC — accepts Clerk cookie OR Bearer token) ───────────────

/**
 * requireSessionAuth — use in routes that must be accessible both from the browser
 * (Clerk cookie) and from API clients (Authorization: Bearer token).
 *
 * Accepts three token types in priority order:
 *   1. Clerk cookie session (no header needed — existing browser behaviour)
 *   2. Authorization: Bearer <clio-jwt> (issued by POST /api/auth/session)
 *   3. Authorization: Bearer <clerk-jwt> (Clerk session token, for developer tooling)
 */
export async function requireSessionAuth(
  request: NextRequest
): Promise<{ userId: string; error: null } | { userId: null; error: NextResponse }> {
  // 1. Clerk cookie session (browser calls, no extra work needed)
  const { userId: cookieUserId } = auth()
  if (cookieUserId) return { userId: cookieUserId, error: null }

  // 2. Bearer token
  const authHeader = request.headers.get('Authorization')
  if (!authHeader?.startsWith('Bearer ')) {
    return { userId: null, error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  }
  const token = authHeader.slice(7)

  // 2a. Try Clio JWT
  const clioPayload = verifyClioToken(token)
  if (clioPayload) return { userId: clioPayload.userId, error: null }

  // 2b. Try Clerk JWT (developer / tooling use case — Clerk does the heavy lifting)
  try {
    const { verifyToken } = await import('@clerk/nextjs/server')
    const clerkPayload = await verifyToken(token, { secretKey: process.env.CLERK_SECRET_KEY! })
    if (clerkPayload?.sub) return { userId: clerkPayload.sub, error: null }
  } catch {
    // Invalid Clerk token — fall through
  }

  return { userId: null, error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
}
