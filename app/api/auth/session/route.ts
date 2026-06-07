/**
 * POST /api/auth/session
 * Exchanges a Clerk session token for a short-lived Clio session JWT.
 *
 * Accepts:
 *   Authorization: Bearer <clerk-session-token>   (from Clerk's getToken() in browser)
 *
 * Returns:
 *   { token: string, expiresAt: string, userId: string }
 *
 * The returned token is used in all subsequent API calls:
 *   Authorization: Bearer <clio-token>
 *
 * Example (browser):
 *   const clerkToken = await getToken()
 *   const { token } = await fetch('/api/auth/session', {
 *     method: 'POST',
 *     headers: { Authorization: `Bearer ${clerkToken}` }
 *   }).then(r => r.json())
 *
 * Example (terminal / AI client):
 *   TOKEN=$(curl -s -X POST https://distill-peach.vercel.app/api/auth/session \
 *     -H "Authorization: Bearer $CLERK_TOKEN" | jq -r .token)
 */

import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { signClioToken } from '@/lib/session-auth'

export async function POST(request: NextRequest): Promise<NextResponse> {
  let userId: string | null = null

  // 1. Try Clerk cookie session (browser)
  const { userId: cookieId } = auth()
  if (cookieId) {
    userId = cookieId
  }

  // 2. Try Authorization: Bearer <clerk-jwt>
  if (!userId) {
    const authHeader = request.headers.get('Authorization')
    if (authHeader?.startsWith('Bearer ')) {
      try {
        const { verifyToken } = await import('@clerk/nextjs/server')
        const payload = await verifyToken(authHeader.slice(7), {
          secretKey: process.env.CLERK_SECRET_KEY!,
        })
        userId = payload?.sub ?? null
      } catch {
        // Invalid Clerk token
      }
    }
  }

  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const expirySeconds = 3600
  const token = signClioToken(userId, expirySeconds)
  const expiresAt = new Date(Date.now() + expirySeconds * 1000).toISOString()

  return NextResponse.json({ token, expiresAt, userId })
}
