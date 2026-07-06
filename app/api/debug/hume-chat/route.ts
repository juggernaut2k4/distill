import { NextRequest, NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

/**
 * Fetch a Hume EVI config document by id.
 */
async function fetchConfig(apiKey: string, configId: string) {
  const res = await fetch(`https://api.hume.ai/v0/evi/configs/${configId}`, {
    headers: { 'X-Hume-Api-Key': apiKey },
  })
  const body = res.ok ? await res.json() : { error: await res.text(), status: res.status }
  return { ok: res.ok, body }
}

// Top-level fields worth comparing between a cloned config and the base config.
const DIFF_FIELDS = [
  'voice',
  'language_model',
  'ellm_model',
  'tools',
  'builtin_tools',
  'event_messages',
  'turn_detection',
  'interruption',
  'nudges',
  'timeouts',
  'webhooks',
] as const

/**
 * Build a field-by-field comparison between two config bodies, restricted to
 * DIFF_FIELDS. Uses JSON deep-equality (order-sensitive) since Hume config
 * fields are typically objects/arrays.
 */
function diffConfigs(a: Record<string, unknown>, b: Record<string, unknown>) {
  const result: Record<string, { status: 'match' | 'differs'; a?: unknown; b?: unknown }> = {}
  for (const field of DIFF_FIELDS) {
    const aVal = a?.[field]
    const bVal = b?.[field]
    const same = JSON.stringify(aVal) === JSON.stringify(bVal)
    result[field] = same ? { status: 'match' } : { status: 'differs', a: aVal, b: bVal }
  }
  return result
}

// Temporary debug endpoint — query Hume chat events/configs to diagnose disconnections
// Usage:
//   GET /api/debug/hume-chat?chat_id=<id>
//   GET /api/debug/hume-chat?config=1                                  (base config from NEXT_PUBLIC_HUME_CONFIG_ID)
//   GET /api/debug/hume-chat?configId=<id>                             (fetch any specific config by id)
//   GET /api/debug/hume-chat?configId=<id>&diff=1                      (compare that config against the base config)
// DELETE THIS FILE after debugging is complete.
export async function GET(request: NextRequest) {
  const chatId = request.nextUrl.searchParams.get('chat_id')
  const wantConfig = request.nextUrl.searchParams.get('config')
  const explicitConfigId = request.nextUrl.searchParams.get('configId')
  const wantDiff = request.nextUrl.searchParams.get('diff')
  const apiKey = process.env.HUME_API_KEY
  if (!apiKey) return NextResponse.json({ error: 'HUME_API_KEY not set' }, { status: 500 })

  // Explicit config id lookup — fetch any arbitrary config (e.g. a per-session
  // clone), optionally diffed against the base production config.
  if (explicitConfigId) {
    const target = await fetchConfig(apiKey, explicitConfigId)

    if (!wantDiff) {
      return NextResponse.json({ configId: explicitConfigId, result: target.body })
    }

    const baseConfigId = process.env.NEXT_PUBLIC_HUME_CONFIG_ID
    if (!baseConfigId) {
      return NextResponse.json({ error: 'NEXT_PUBLIC_HUME_CONFIG_ID not set, cannot diff' }, { status: 500 })
    }
    const base = await fetchConfig(apiKey, baseConfigId)

    if (!target.ok || !base.ok) {
      return NextResponse.json({
        error: 'One or both configs failed to fetch',
        target: { configId: explicitConfigId, ok: target.ok, result: target.body },
        base: { configId: baseConfigId, ok: base.ok, result: base.body },
      }, { status: 502 })
    }

    return NextResponse.json({
      target: { configId: explicitConfigId },
      base: { configId: baseConfigId },
      diff: diffConfigs(target.body, base.body),
    })
  }

  // Fetch the live config document itself — proves the actual tools/language_model
  // state of the config_id currently referenced by NEXT_PUBLIC_HUME_CONFIG_ID,
  // rather than trusting the dashboard UI or assuming it matches.
  if (wantConfig) {
    const configId = process.env.NEXT_PUBLIC_HUME_CONFIG_ID
    if (!configId) return NextResponse.json({ error: 'NEXT_PUBLIC_HUME_CONFIG_ID not set' }, { status: 500 })
    const { body } = await fetchConfig(apiKey, configId)
    return NextResponse.json({ configId, envConfigIdRaw: process.env.NEXT_PUBLIC_HUME_CONFIG_ID, result: body })
  }

  // No chat_id given — list recent chats instead, so a failed connection
  // that never reached chat_metadata (no chat_id ever assigned) can still
  // be diagnosed. Sorted newest first by Hume's API.
  if (!chatId) {
    const configId = process.env.NEXT_PUBLIC_HUME_CONFIG_ID
    const listRes = await fetch(
      `https://api.hume.ai/v0/evi/chats?page_size=5&ascending_order=false${configId ? `&config_id=${configId}` : ''}`,
      { headers: { 'X-Hume-Api-Key': apiKey } }
    )
    const list = listRes.ok ? await listRes.json() : { error: await listRes.text() }
    return NextResponse.json({ recent_chats: list })
  }

  const [chatRes, eventsRes] = await Promise.all([
    fetch(`https://api.hume.ai/v0/evi/chats/${chatId}`, {
      headers: { 'X-Hume-Api-Key': apiKey },
    }),
    fetch(`https://api.hume.ai/v0/evi/chats/${chatId}/events?page_size=50`, {
      headers: { 'X-Hume-Api-Key': apiKey },
    }),
  ])

  const chat = await chatRes.json()
  const events = eventsRes.ok ? await eventsRes.json() : { error: await eventsRes.text() }

  return NextResponse.json({ chat, events })
}
