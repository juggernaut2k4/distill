import { createSupabaseAdminClient } from '@/lib/supabase'

/**
 * B2B-79 (docs/specs/B2B-79-requirement-document.md §6.3) — the actual behavioral change that
 * document makes: resolves a widget/bot session's `render_url` host from the authenticated
 * account's own verified custom domain, instead of the shared `NEXT_PUBLIC_APP_URL`.
 *
 * `channel_partner` (sales-partner) accounts: MUST have a verified custom domain — no shared
 * fallback (D16 — "no exceptions, no shared fallback offered" describes the sales-partner
 * relationship itself, not one endpoint). `partner` (direct) accounts: unchanged, resolves against
 * `NEXT_PUBLIC_APP_URL` as it always has — untouched by this document.
 *
 * Applied to BOTH `bot-sessions` (new) and `widget-sessions` (existing, per §6.3's explicit
 * recommendation) — confirmed safe to extend today: every current `channel_partner` account has
 * `custom_domain_status = 'none'` (verified directly against production data before this shipped),
 * so no live integration is broken by adding this gate; it only prevents one from ever starting
 * without a domain, which is the intended behavior.
 */
export type RenderUrlHostResolution =
  | { ok: true; baseUrl: string }
  | { ok: false }

/**
 * Resolves the base URL (scheme + host, no path) a `widget-render` link should use — callers
 * append `/widget-render/{sessionId}` themselves. Split out from a single sessionId-in/URL-out
 * function so a caller can cheaply pre-check domain readiness (e.g. before claiming a
 * bot-dispatch reservation) without needing a real session id yet, and resolve it exactly once
 * per request either way.
 */
export async function resolveWidgetRenderBaseUrl(
  accountKind: 'partner' | 'channel_partner',
  partnerAccountId: string
): Promise<RenderUrlHostResolution> {
  if (accountKind === 'partner') {
    return { ok: true, baseUrl: process.env.NEXT_PUBLIC_APP_URL ?? 'https://distill-peach.vercel.app' }
  }

  const supabase = createSupabaseAdminClient()
  const { data: rows } = await supabase
    .from('partner_accounts')
    .select('custom_domain, custom_domain_status')
    .eq('id', partnerAccountId)
    .limit(1)
  const account = rows?.[0] ?? null

  if (!account || account.custom_domain_status !== 'verified' || !account.custom_domain) {
    return { ok: false }
  }

  return { ok: true, baseUrl: `https://${account.custom_domain}` }
}
