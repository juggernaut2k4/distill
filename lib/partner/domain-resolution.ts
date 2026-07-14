import { createSupabaseAdminClient } from '@/lib/supabase'

/**
 * B2B-05 — Host-header tenant resolution (Requirement Doc Section 5.B.5,
 * architecture.md §14.5/§14.6). Runs on `middleware.ts`'s Edge Runtime — uses
 * only `createSupabaseAdminClient()` (already Edge-compatible, reused
 * unmodified from every other `lib/partner/*` module).
 */

export interface ResolvedTenant {
  partnerAccountId: string
  status: 'active' | 'suspended'
}

/**
 * True if `host` is a `verified` `custom_domain` for some partner account.
 * Used by `middleware.ts` to decide whether an otherwise-non-`{root_domain}`
 * host should still be treated as a tenant host.
 */
export async function isVerifiedCustomDomain(host: string): Promise<boolean> {
  if (!host) return false
  const supabase = createSupabaseAdminClient()
  const { data } = await supabase
    .from('partner_accounts')
    .select('id')
    .eq('custom_domain', host)
    .eq('custom_domain_status', 'verified')
    .maybeSingle()
  return !!data
}

/**
 * Resolves an incoming `Host` header to the owning partner account.
 * architecture.md §14.5 — exact implementation. A `custom_domain` row only
 * ever resolves once `custom_domain_status = 'verified'`.
 */
export async function resolveTenantFromHost(
  host: string,
  rootDomain: string
): Promise<ResolvedTenant | null> {
  const supabase = createSupabaseAdminClient()
  if (rootDomain.length > 0 && host.endsWith(`.${rootDomain}`)) {
    const slug = host.slice(0, -(rootDomain.length + 1))
    const { data } = await supabase
      .from('partner_accounts')
      .select('id, status')
      .eq('subdomain_slug', slug)
      .maybeSingle()
    return data ? { partnerAccountId: data.id as string, status: data.status as 'active' | 'suspended' } : null
  }
  const { data } = await supabase
    .from('partner_accounts')
    .select('id, status')
    .eq('custom_domain', host)
    .eq('custom_domain_status', 'verified')
    .maybeSingle()
  return data ? { partnerAccountId: data.id as string, status: data.status as 'active' | 'suspended' } : null
}
