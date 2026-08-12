import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createSupabaseAdminClient } from '@/lib/supabase'
import { requireChannelPartnerAdmin } from '@/lib/partner/auth'

/**
 * GET  /api/channel-partner/bot-aliases — the "Bot Voices" tab (B2B-78 §4.B): every active catalog
 *      agent, grouped by language, with this sales-partner's own alias if one is set.
 * POST /api/channel-partner/bot-aliases — set/replace this sales-partner's own alias for a catalog
 *      agent (their own name, e.g. "english_bot" -> `clio_english`).
 *
 * "+ Add language" in the wireframe is client-side filtering over this same GET response — every
 * catalog agent is always returned; the UI only reveals a language's agents once the sales-partner
 * has chosen to enable it. There is no separate "enabled languages" table — enabling a language is
 * a UI-only reveal, not a persisted account preference, per the wireframe's own "not yet set" state
 * showing no error for an unmapped agent.
 */

export async function GET() {
  const admin = await requireChannelPartnerAdmin()
  if (admin.error) return admin.error

  const supabase = createSupabaseAdminClient()

  const { data: catalogAgents } = await supabase
    .from('bot_catalog_agents')
    .select('id, catalog_name, language')
    .eq('status', 'active')
    .order('language', { ascending: true })

  const { data: mappings } = await supabase
    .from('bot_alias_mappings')
    .select('bot_catalog_agent_id, alias')
    .eq('partner_account_id', admin.partnerAccountId)

  const aliasByCatalogAgentId = new Map((mappings ?? []).map((m) => [m.bot_catalog_agent_id as string, m.alias as string]))

  const agents = (catalogAgents ?? []).map((agent) => ({
    id: agent.id,
    catalog_name: agent.catalog_name,
    language: agent.language,
    alias: aliasByCatalogAgentId.get(agent.id as string) ?? null,
  }))

  return NextResponse.json({ agents })
}

const SetAliasSchema = z.object({
  bot_catalog_agent_id: z.string().uuid(),
  alias: z.string().trim().min(1).max(100),
})

export async function POST(request: NextRequest) {
  const admin = await requireChannelPartnerAdmin()
  if (admin.error) return admin.error

  const body = await request.json().catch(() => null)
  const parsed = SetAliasSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Validation failed', details: parsed.error.flatten() }, { status: 422 })
  }

  const supabase = createSupabaseAdminClient()

  const { data: catalogRows } = await supabase
    .from('bot_catalog_agents')
    .select('id')
    .eq('id', parsed.data.bot_catalog_agent_id)
    .eq('status', 'active')
    .limit(1)
  if (!catalogRows?.[0]) {
    return NextResponse.json({ error: { code: 'not_found', message: 'Catalog agent not found.' } }, { status: 404 })
  }

  const { data: upserted, error } = await supabase
    .from('bot_alias_mappings')
    .upsert(
      {
        partner_account_id: admin.partnerAccountId,
        bot_catalog_agent_id: parsed.data.bot_catalog_agent_id,
        alias: parsed.data.alias,
      },
      { onConflict: 'partner_account_id,alias' }
    )
    .select('id, bot_catalog_agent_id, alias')
    .single()

  if (error || !upserted) {
    console.error('[channel-partner/bot-aliases] Upsert failed:', error?.message)
    return NextResponse.json({ error: { code: 'internal_error', message: 'Failed to save alias.' } }, { status: 500 })
  }

  return NextResponse.json({ bot_catalog_agent_id: upserted.bot_catalog_agent_id, alias: upserted.alias }, { status: 200 })
}
