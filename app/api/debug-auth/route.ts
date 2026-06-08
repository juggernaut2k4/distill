import { NextRequest, NextResponse } from 'next/server'
import { verifyClioToken } from '@/lib/session-auth'

// Temporary diagnostic route — delete after debugging
export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('Authorization')
  if (!authHeader?.startsWith('Bearer ')) {
    return NextResponse.json({ error: 'no Bearer header' })
  }
  const token = authHeader.slice(7)
  const parts = token.split('.')
  const hasSecret = !!(process.env.SESSION_JWT_SECRET)
  const secretLength = (process.env.SESSION_JWT_SECRET ?? '').length

  let payloadStr = ''
  let isExpired = false
  try {
    payloadStr = Buffer.from(parts[1], 'base64url').toString('utf8')
    const payload = JSON.parse(payloadStr)
    isExpired = payload.exp < Math.floor(Date.now() / 1000)
  } catch { payloadStr = 'parse error' }

  const clioPayload = verifyClioToken(token)

  return NextResponse.json({
    hasSecret,
    secretLength,
    tokenParts: parts.length,
    payloadStr,
    isExpired,
    clioVerified: !!clioPayload,
    clioPayload,
  })
}
