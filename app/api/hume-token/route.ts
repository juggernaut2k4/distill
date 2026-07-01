import { NextResponse } from 'next/server'

export async function GET() {
  const apiKey = process.env.HUME_API_KEY
  const secretKey = process.env.HUME_SECRET_KEY

  if (!apiKey || !secretKey) {
    console.error('[hume-token] Missing HUME_API_KEY or HUME_SECRET_KEY')
    return NextResponse.json({ error: 'Hume credentials not configured' }, { status: 500 })
  }

  const credentials = Buffer.from(`${apiKey}:${secretKey}`).toString('base64')

  const res = await fetch('https://api.hume.ai/oauth2-cc/token', {
    method: 'POST',
    headers: {
      Authorization: `Basic ${credentials}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
  })

  if (!res.ok) {
    const body = await res.text()
    console.error('[hume-token] Hume token exchange failed:', res.status, body)
    return NextResponse.json({ error: 'Failed to obtain Hume access token' }, { status: 502 })
  }

  const data = await res.json() as { access_token: string; expires_in: number }
  return NextResponse.json({ accessToken: data.access_token, expiresIn: data.expires_in })
}
