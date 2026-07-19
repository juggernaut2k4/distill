import { createSupabaseAdminClient } from '@/lib/supabase'

/**
 * B2B-26 (docs/specs/B2B-26-requirement-document.md §6.7) — a sales-partner's
 * client roster. A client is itself a normal `partner_accounts` row
 * (`account_kind='partner'`) with `owning_channel_partner_id` set — this is
 * exactly what lets the entire existing Configurator, Integration step, and
 * billing wallet shape work for a client row with zero new code, once a
 * later brief (B2B-27) builds the per-client detail screen. Zero
 * `partner_admin_users` rows are ever created for a client — the client
 * never logs into Clio themselves; the owning sales-partner's own admin(s)
 * act on the client's behalf.
 */
export interface ChannelPartnerClient {
  id: string
  name: string
  company_url: string | null
  status: 'active' | 'suspended'
  created_at: string
}

export async function listClientsForChannelPartner(channelPartnerAccountId: string): Promise<ChannelPartnerClient[]> {
  const supabase = createSupabaseAdminClient()
  const { data } = await supabase
    .from('partner_accounts')
    .select('id, name, company_url, status, created_at')
    .eq('owning_channel_partner_id', channelPartnerAccountId)
    .order('created_at', { ascending: false })

  return (data ?? []).map((row) => ({
    id: row.id as string,
    name: row.name as string,
    company_url: (row.company_url as string | null) ?? null,
    status: row.status as 'active' | 'suspended',
    created_at: row.created_at as string,
  }))
}

export async function createClientForChannelPartner(
  channelPartnerAccountId: string,
  name: string,
  companyUrl: string | null
): Promise<{ success: boolean; client: ChannelPartnerClient | null; error: string | null }> {
  const supabase = createSupabaseAdminClient()
  const { data, error } = await supabase
    .from('partner_accounts')
    .insert({
      name,
      company_url: companyUrl,
      archetype: 'unspecified',
      status: 'active',
      account_kind: 'partner',
      owning_channel_partner_id: channelPartnerAccountId,
    })
    .select('id, name, company_url, status, created_at')
    .single()

  if (error || !data) {
    return { success: false, client: null, error: error?.message ?? 'partner_accounts insert failed' }
  }

  return {
    success: true,
    client: {
      id: data.id as string,
      name: data.name as string,
      company_url: (data.company_url as string | null) ?? null,
      status: data.status as 'active' | 'suspended',
      created_at: data.created_at as string,
    },
    error: null,
  }
}
