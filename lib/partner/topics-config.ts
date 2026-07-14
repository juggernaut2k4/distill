import { createSupabaseAdminClient } from '@/lib/supabase'
import { decryptOutboundToken } from './crypto'

/**
 * B2B-03 — Topics/prerequisites source config (Requirement Doc Section 4.A.2,
 * 6.2; architecture.md Section 12). Two genuinely independent toggles.
 */

export type TopicSource = 'clio_generated' | 'partner_supplied'

export interface PartnerTopicConfig {
  topicsSource: TopicSource
  prerequisitesSource: TopicSource
}

const DEFAULT_TOPIC_CONFIG: PartnerTopicConfig = {
  topicsSource: 'clio_generated',
  prerequisitesSource: 'clio_generated',
}

export async function getTopicConfig(partnerAccountId: string): Promise<PartnerTopicConfig> {
  const supabase = createSupabaseAdminClient()
  const { data } = await supabase
    .from('partner_topic_config')
    .select('topics_source, prerequisites_source')
    .eq('partner_account_id', partnerAccountId)
    .maybeSingle()

  if (!data) return DEFAULT_TOPIC_CONFIG
  return {
    topicsSource: data.topics_source as TopicSource,
    prerequisitesSource: data.prerequisites_source as TopicSource,
  }
}

function isValidSource(v: unknown): v is TopicSource {
  return v === 'clio_generated' || v === 'partner_supplied'
}

export async function upsertTopicConfig(
  partnerAccountId: string,
  input: { topicsSource?: string; prerequisitesSource?: string }
): Promise<{ ok: true; data: PartnerTopicConfig } | { ok: false; error: string }> {
  const current = await getTopicConfig(partnerAccountId)
  const topicsSource = input.topicsSource ?? current.topicsSource
  const prerequisitesSource = input.prerequisitesSource ?? current.prerequisitesSource

  if (!isValidSource(topicsSource) || !isValidSource(prerequisitesSource)) {
    return { ok: false, error: 'invalid_source' }
  }

  const supabase = createSupabaseAdminClient()
  const { data, error } = await supabase
    .from('partner_topic_config')
    .upsert(
      { partner_account_id: partnerAccountId, topics_source: topicsSource, prerequisites_source: prerequisitesSource },
      { onConflict: 'partner_account_id' }
    )
    .select('topics_source, prerequisites_source')
    .single()

  if (error || !data) return { ok: false, error: error?.message ?? 'upsert_failed' }
  return { ok: true, data: { topicsSource: data.topics_source as TopicSource, prerequisitesSource: data.prerequisites_source as TopicSource } }
}

export interface TopicsPullResult {
  status: 'ok' | 'unavailable' | 'not_configured'
  topics?: unknown
}

/**
 * `GET {outbound_base_url}/topics` — pull-only, used when
 * `topics_source = 'partner_supplied'` (Section 6.2). Never falls back
 * silently to Clio-generated topics on failure — a `not_configured`/
 * `unavailable` result must be surfaced as such by the caller, per Section
 * 7's acceptance test ("never a thrown error or a silent fallback").
 */
export async function pullPartnerTopics(partnerAccountId: string): Promise<TopicsPullResult> {
  const supabase = createSupabaseAdminClient()
  const { data: account } = await supabase
    .from('partner_accounts')
    .select('outbound_base_url, outbound_auth_token_ciphertext')
    .eq('id', partnerAccountId)
    .maybeSingle()

  const outboundBaseUrl = (account?.outbound_base_url as string | null) ?? null
  if (!outboundBaseUrl) return { status: 'not_configured' }

  const token = decryptOutboundToken((account?.outbound_auth_token_ciphertext as string | null) ?? null)
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (token) headers.Authorization = `Bearer ${token}`

  try {
    const res = await fetch(`${outboundBaseUrl.replace(/\/$/, '')}/topics`, { method: 'GET', headers })
    if (!res.ok) return { status: 'unavailable' }
    return { status: 'ok', topics: await res.json() }
  } catch (err) {
    console.error('[partner/topics-config] pullPartnerTopics failed:', err instanceof Error ? err.message : err)
    return { status: 'unavailable' }
  }
}
