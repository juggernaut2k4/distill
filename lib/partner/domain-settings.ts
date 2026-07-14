import { createSupabaseAdminClient } from '@/lib/supabase'
import {
  isValidSlugFormat,
  isReservedSlug,
  isValidCustomDomainFormat,
  isClioOwnedDomainSpace,
} from './domain-config'
import { addDomainToProject, checkDomainVerification, removeDomainFromProject } from './vercel-domains'

/**
 * B2B-05 — Domain settings business logic (Requirement Doc Section 4.B,
 * architecture.md §14). Backs `/api/admin/configurator/domain*`. Follows the
 * existing `lib/partner/topics-config.ts`/`theme.ts` pattern: routes stay
 * thin, this module owns validation + DB reads/writes + the Vercel call.
 */

export function getRootDomain(): string {
  return process.env.CLIO_ROOT_DOMAIN ?? ''
}

export type CustomDomainStatus = 'none' | 'pending_verification' | 'verified' | 'failed'

export interface DomainSettings {
  rootDomain: string
  subdomainSlug: string | null
  subdomainUrl: string | null
  customDomain: string | null
  customDomainStatus: CustomDomainStatus
  customDomainError: string | null
  customDomainVerification: { type: string; domain: string; value: string; reason: string }[] | null
  customDomainUrl: string | null
}

interface PartnerAccountDomainRow {
  subdomain_slug: string | null
  custom_domain: string | null
  custom_domain_status: CustomDomainStatus
  custom_domain_error: string | null
  custom_domain_verification: DomainSettings['customDomainVerification']
}

/** Snake-case wire format for every `/api/admin/configurator/domain*` response (Requirement Doc 4.B). */
export function serializeDomainSettings(settings: DomainSettings) {
  return {
    root_domain: settings.rootDomain,
    subdomain_slug: settings.subdomainSlug,
    subdomain_url: settings.subdomainUrl,
    custom_domain: settings.customDomain,
    custom_domain_status: settings.customDomainStatus,
    custom_domain_error: settings.customDomainError,
    custom_domain_verification: settings.customDomainVerification,
    custom_domain_url: settings.customDomainUrl,
  }
}

function toSettings(row: PartnerAccountDomainRow, rootDomain: string): DomainSettings {
  return {
    rootDomain,
    subdomainSlug: row.subdomain_slug,
    subdomainUrl: row.subdomain_slug && rootDomain ? `https://${row.subdomain_slug}.${rootDomain}` : null,
    customDomain: row.custom_domain,
    customDomainStatus: row.custom_domain_status,
    customDomainError: row.custom_domain_error,
    customDomainVerification: row.custom_domain_status === 'pending_verification' ? row.custom_domain_verification : null,
    customDomainUrl: row.custom_domain_status === 'verified' && row.custom_domain ? `https://${row.custom_domain}` : null,
  }
}

/** `GET /api/admin/configurator/domain` (Requirement Doc 4.B.1). */
export async function getDomainSettings(partnerAccountId: string): Promise<DomainSettings | null> {
  const supabase = createSupabaseAdminClient()
  const { data } = await supabase
    .from('partner_accounts')
    .select('subdomain_slug, custom_domain, custom_domain_status, custom_domain_error, custom_domain_verification')
    .eq('id', partnerAccountId)
    .maybeSingle()

  if (!data) return null
  return toSettings(data as PartnerAccountDomainRow, getRootDomain())
}

export type SlugUnavailableReason = 'taken' | 'reserved' | 'invalid_format'

/** `GET /api/admin/configurator/domain/check-slug` (Requirement Doc 4.B.2). */
export async function checkSlugAvailability(
  partnerAccountId: string,
  slug: string
): Promise<{ available: true } | { available: false; reason: SlugUnavailableReason }> {
  if (!isValidSlugFormat(slug)) return { available: false, reason: 'invalid_format' }
  if (isReservedSlug(slug)) return { available: false, reason: 'reserved' }

  const supabase = createSupabaseAdminClient()
  const { data } = await supabase
    .from('partner_accounts')
    .select('id')
    .eq('subdomain_slug', slug)
    .maybeSingle()

  // Checking your own current slug is never a conflict with yourself (Section 9).
  if (data && data.id !== partnerAccountId) return { available: false, reason: 'taken' }
  return { available: true }
}

export type ClaimSubdomainResult =
  | { ok: true; data: { subdomainSlug: string; subdomainUrl: string } }
  | { ok: false; code: 'slug_taken' | 'slug_reserved'; message: string }
  | { ok: false; code: 'invalid_format'; message: string }

/** `PATCH /api/admin/configurator/domain/subdomain` (Requirement Doc 4.B.3). */
export async function claimSubdomain(partnerAccountId: string, slug: string): Promise<ClaimSubdomainResult> {
  if (!isValidSlugFormat(slug)) {
    return { ok: false, code: 'invalid_format', message: 'Only lowercase letters, numbers, and hyphens, 3–63 characters.' }
  }
  if (isReservedSlug(slug)) {
    return { ok: false, code: 'slug_reserved', message: 'This subdomain is reserved.' }
  }

  const supabase = createSupabaseAdminClient()

  // Server-side re-validation of uniqueness even though the UI already
  // checked (never trust a client-side-only check for a uniqueness
  // constraint) — Requirement Doc 4.B.3.
  const { data: existing } = await supabase
    .from('partner_accounts')
    .select('id')
    .eq('subdomain_slug', slug)
    .maybeSingle()
  if (existing && existing.id !== partnerAccountId) {
    return { ok: false, code: 'slug_taken', message: 'This subdomain is already taken.' }
  }

  const { data, error } = await supabase
    .from('partner_accounts')
    .update({ subdomain_slug: slug })
    .eq('id', partnerAccountId)
    .select('subdomain_slug')
    .single()

  if (error) {
    // Race condition: slug became unavailable between the check and the save.
    if (error.code === '23505') {
      return { ok: false, code: 'slug_taken', message: 'This subdomain is already taken.' }
    }
    return { ok: false, code: 'invalid_format', message: error.message }
  }

  const rootDomain = getRootDomain()
  return {
    ok: true,
    data: {
      subdomainSlug: data.subdomain_slug as string,
      subdomainUrl: rootDomain ? `https://${data.subdomain_slug}.${rootDomain}` : '',
    },
  }
}

export type AddCustomDomainResult =
  | { ok: true; status: 201; data: DomainSettings }
  | { ok: false; status: 409; code: 'domain_already_configured'; message: string }
  | { ok: false; status: 422; code: 'invalid_format'; message: string }
  | { ok: false; status: 422; code: 'vercel_rejected'; data: DomainSettings }

/** `POST /api/admin/configurator/domain/custom-domain` (Requirement Doc 4.B.4). */
export async function addCustomDomain(partnerAccountId: string, domain: string): Promise<AddCustomDomainResult> {
  const rootDomain = getRootDomain()

  if (!isValidCustomDomainFormat(domain)) {
    return { ok: false, status: 422, code: 'invalid_format', message: 'Not a valid domain.' }
  }
  if (isClioOwnedDomainSpace(domain, rootDomain)) {
    return { ok: false, status: 422, code: 'invalid_format', message: 'This domain is reserved by Clio.' }
  }

  const supabase = createSupabaseAdminClient()

  const { data: account } = await supabase
    .from('partner_accounts')
    .select('custom_domain')
    .eq('id', partnerAccountId)
    .maybeSingle()

  if (account?.custom_domain && account.custom_domain !== domain) {
    return { ok: false, status: 409, code: 'domain_already_configured', message: 'A custom domain is already configured for this account. Remove it first.' }
  }

  // Another partner account already holds this exact domain (verified or
  // still pending) — the DB's unique index is the ultimate guarantee
  // (Section 7's isolation acceptance test); this is a pre-check to avoid an
  // unnecessary Vercel call in the obviously-conflicting case.
  const { data: conflicting } = await supabase
    .from('partner_accounts')
    .select('id')
    .eq('custom_domain', domain)
    .neq('id', partnerAccountId)
    .maybeSingle()
  if (conflicting) {
    return { ok: false, status: 409, code: 'domain_already_configured', message: 'This domain is already configured on another account.' }
  }

  const result = await addDomainToProject(domain)

  if (!result.ok) {
    await supabase
      .from('partner_accounts')
      .update({
        custom_domain: domain,
        custom_domain_status: 'failed',
        custom_domain_error: result.errorMessage,
        custom_domain_verification: null,
        custom_domain_added_at: new Date().toISOString(),
      })
      .eq('id', partnerAccountId)

    return {
      ok: false,
      status: 422,
      code: 'vercel_rejected',
      data: {
        rootDomain,
        subdomainSlug: null,
        subdomainUrl: null,
        customDomain: domain,
        customDomainStatus: 'failed',
        customDomainError: result.errorMessage,
        customDomainVerification: null,
        customDomainUrl: null,
      },
    }
  }

  const status: CustomDomainStatus = result.verified ? 'verified' : 'pending_verification'
  const nowIso = new Date().toISOString()

  const { data: updated, error } = await supabase
    .from('partner_accounts')
    .update({
      custom_domain: domain,
      custom_domain_status: status,
      custom_domain_error: null,
      custom_domain_verification: status === 'pending_verification' ? result.verification : null,
      custom_domain_added_at: nowIso,
      custom_domain_verified_at: status === 'verified' ? nowIso : null,
    })
    .eq('id', partnerAccountId)
    .select('subdomain_slug, custom_domain, custom_domain_status, custom_domain_error, custom_domain_verification')
    .single()

  if (error || !updated) {
    // Race: another partner claimed this exact domain between our pre-check
    // and this write (DB unique index is the authoritative guarantee).
    if (error?.code === '23505') {
      return { ok: false, status: 409, code: 'domain_already_configured', message: 'This domain is already configured on another account.' }
    }
    return { ok: false, status: 422, code: 'invalid_format', message: error?.message ?? 'Failed to save domain.' }
  }

  return { ok: true, status: 201, data: toSettings(updated as PartnerAccountDomainRow, rootDomain) }
}

export type RecheckResult =
  | { ok: true; data: DomainSettings }
  | { ok: false; code: 'no_custom_domain_configured' }

/** `POST /api/admin/configurator/domain/custom-domain/recheck` (Requirement Doc 4.B.5). */
export async function recheckCustomDomain(partnerAccountId: string): Promise<RecheckResult> {
  const supabase = createSupabaseAdminClient()
  const rootDomain = getRootDomain()

  const { data: account } = await supabase
    .from('partner_accounts')
    .select('custom_domain')
    .eq('id', partnerAccountId)
    .maybeSingle()

  if (!account?.custom_domain) {
    return { ok: false, code: 'no_custom_domain_configured' }
  }

  const check = await checkDomainVerification(account.custom_domain as string)
  const nowIso = new Date().toISOString()

  const { data: updated, error } = await supabase
    .from('partner_accounts')
    .update(
      check.verified
        ? {
            custom_domain_status: 'verified',
            custom_domain_verified_at: nowIso,
            custom_domain_verification: null,
            custom_domain_error: null,
          }
        : {
            custom_domain_verification: check.verification,
          }
    )
    .eq('id', partnerAccountId)
    .select('subdomain_slug, custom_domain, custom_domain_status, custom_domain_error, custom_domain_verification')
    .single()

  if (error || !updated) {
    return { ok: false, code: 'no_custom_domain_configured' }
  }

  return { ok: true, data: toSettings(updated as PartnerAccountDomainRow, rootDomain) }
}

export type RemoveResult =
  | { ok: true }
  | { ok: false; code: 'no_custom_domain_configured' }

/** `DELETE /api/admin/configurator/domain/custom-domain` (Requirement Doc 4.B.6). */
export async function removeCustomDomain(partnerAccountId: string): Promise<RemoveResult> {
  const supabase = createSupabaseAdminClient()

  const { data: account } = await supabase
    .from('partner_accounts')
    .select('custom_domain')
    .eq('id', partnerAccountId)
    .maybeSingle()

  if (!account?.custom_domain) {
    return { ok: false, code: 'no_custom_domain_configured' }
  }

  // Always succeeds locally even if the upstream Vercel call itself failed
  // (Requirement Doc Section 6/8) — the removal function itself never throws.
  await removeDomainFromProject(account.custom_domain as string)

  await supabase
    .from('partner_accounts')
    .update({
      custom_domain: null,
      custom_domain_status: 'none',
      custom_domain_error: null,
      custom_domain_verification: null,
      custom_domain_verified_at: null,
    })
    .eq('id', partnerAccountId)

  return { ok: true }
}
