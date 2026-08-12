import { createSupabaseAdminClient } from '@/lib/supabase'
import { getElevenLabsAgentIdForVoice } from '@/lib/voice/elevenlabs-agents'

/**
 * B2B-78 (docs/specs/B2B-78-requirement-document.md §6.3) — resolves a sales-partner's own
 * `bot_id` alias to the real, hidden ElevenLabs agent ID, via the three-layer catalog (D20):
 *
 *   layer 3 (bot_alias_mappings, per sales-partner) -> layer 2 (bot_catalog_agents, Clio's own
 *   catalog) -> layer 1 (ELEVENLABS_VOICE_OPTIONS, hidden) -> real agent ID.
 *
 * Scoped to `channel_partner`-authenticated calls only — direct partners continue using the
 * existing `elevenlabs_agent_id` enum field unchanged; they have no alias-management dashboard and
 * no reason to need vendor-hiding indirection at the API level.
 */
export async function resolveBotIdToAgentId(partnerAccountId: string, botId: string): Promise<string | null> {
  const supabase = createSupabaseAdminClient()

  const { data: mappingRows } = await supabase
    .from('bot_alias_mappings')
    .select('bot_catalog_agent_id')
    .eq('partner_account_id', partnerAccountId)
    .eq('alias', botId)
    .limit(1)
  const mapping = mappingRows?.[0] ?? null
  if (!mapping) return null

  const { data: catalogRows } = await supabase
    .from('bot_catalog_agents')
    .select('elevenlabs_voice_key')
    .eq('id', mapping.bot_catalog_agent_id as string)
    .eq('status', 'active')
    .limit(1)
  const catalogAgent = catalogRows?.[0] ?? null
  if (!catalogAgent) return null

  return getElevenLabsAgentIdForVoice(catalogAgent.elevenlabs_voice_key as string)
}
