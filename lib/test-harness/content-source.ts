import { createSupabaseAdminClient } from '@/lib/supabase'

/**
 * B2B-32 (docs/specs/B2B-32-requirement-document.md §4 Screen C, §0 point 7, AT-7).
 *
 * Every topic in the harness shares ONE `partner_content_sources` row (every screen is served
 * publicly with no fetch auth, §0 point 2 — there is nothing per-topic to differentiate). This
 * registers it lazily and idempotently the first time it's needed, by calling the real, unmodified
 * `POST /api/partner/v1/content-sources` server-to-server using the harness's own real partner API
 * key — never a direct DB insert, unlike B2B-31's Showcase content-source route, because the
 * harness DOES have a real partner API key to call the real endpoint with (mirrors §6.4's own
 * "server-to-server, using the harness's own real API key resolved server-side" description).
 *
 * Reuse (AT-7): `test_harness_topics.content_source_id` doubles as a cheap process-wide cache —
 * before registering a new source, this scans for ANY topic that already has one set and reuses
 * it. This also means a second call for a different topic never re-registers (AT-7's exact
 * assertion).
 */
export async function ensureTestHarnessContentSource(topicId: string): Promise<string> {
  const supabase = createSupabaseAdminClient()

  const { data: existing } = await supabase
    .from('test_harness_topics')
    .select('content_source_id')
    .not('content_source_id', 'is', null)
    .limit(1)
    .maybeSingle()

  let contentSourceId = (existing?.content_source_id as string | null) ?? null

  if (!contentSourceId) {
    contentSourceId = await registerTestHarnessContentSource()
  }

  // Persist onto the current topic row too, if it doesn't have one yet (idempotent no-op
  // otherwise) — keeps the "scan any topic for a non-null content_source_id" cache warm for the
  // next topic that needs it.
  await supabase
    .from('test_harness_topics')
    .update({ content_source_id: contentSourceId })
    .eq('id', topicId)
    .is('content_source_id', null)

  return contentSourceId
}

/** Calls the real, unmodified content-source registration endpoint. Throws on failure — callers surface a 500. */
async function registerTestHarnessContentSource(): Promise<string> {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'https://distill-peach.vercel.app'
  const apiKey = process.env.TEST_HARNESS_PARTNER_API_KEY ?? ''

  const res = await fetch(`${appUrl}/api/partner/v1/content-sources`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ auth_type: 'none', label: 'Test harness — internal' }),
  })

  if (!res.ok) {
    throw new Error(`content-source registration failed with status ${res.status}`)
  }

  const json = (await res.json()) as { content_source_id?: string }
  if (!json.content_source_id) {
    throw new Error('content-source registration returned no content_source_id')
  }

  return json.content_source_id
}
