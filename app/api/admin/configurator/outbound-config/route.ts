import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createSupabaseAdminClient } from '@/lib/supabase'
import { requirePartnerAdmin } from '@/lib/partner/auth'
import { encryptOutboundToken, generateSigningSecret } from '@/lib/partner/crypto'

/**
 * GET/PATCH /api/admin/configurator/outbound-config — thin Configurator-UI
 * wrapper around the existing outbound-config mechanism (B2B-06,
 * docs/specs/B2B-06-requirement-document.md Section 4.B.5, architecture.md
 * §18.9).
 *
 * GET did not exist before this document — the pre-existing PATCH route
 * (app/api/admin/partner-accounts/[id]/outbound-config/route.ts) has no
 * corresponding read route, since it was built API-only with no UI in
 * B2B-02. This GET never returns the token/secret themselves — only booleans
 * indicating whether each is configured.
 *
 * PATCH here is a direct pass-through of the existing route's logic (same
 * Zod schema, same behavior, same update semantics), added under
 * `/api/admin/configurator/*` purely so this document's UI follows the same
 * URL-namespace convention every other Configurator screen already uses. The
 * pre-existing dynamic-segment route (`.../partner-accounts/:id/outbound-config`)
 * is untouched — this is a new, additive, thin wrapper reading
 * `partner_account_id` from the request body instead of a path param.
 */

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const partnerAccountId = searchParams.get('partner_account_id')
  if (!partnerAccountId) {
    return NextResponse.json({ error: 'partner_account_id query param is required' }, { status: 400 })
  }

  const admin = await requirePartnerAdmin(partnerAccountId)
  if (admin.error) return admin.error

  const supabase = createSupabaseAdminClient()
  const { data } = await supabase
    .from('partner_accounts')
    .select('outbound_base_url, outbound_auth_token_ciphertext, outbound_signing_secret')
    .eq('id', partnerAccountId)
    .maybeSingle()

  return NextResponse.json({
    outbound_base_url: data?.outbound_base_url ?? null,
    outbound_auth_token_set: Boolean(data?.outbound_auth_token_ciphertext),
    outbound_signing_secret_set: Boolean(data?.outbound_signing_secret),
  })
}

const PatchSchema = z.object({
  partner_account_id: z.string().uuid(),
  outbound_base_url: z.string().url().optional(),
  outbound_auth_token: z.string().min(1).optional(),
  regenerate_signing_secret: z.boolean().optional(),
})

export async function PATCH(request: NextRequest) {
  const body = await request.json().catch(() => null)
  const parsed = PatchSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Validation failed', details: parsed.error.flatten() }, { status: 422 })
  }

  const admin = await requirePartnerAdmin(parsed.data.partner_account_id)
  if (admin.error) return admin.error

  const update: Record<string, unknown> = {}
  if (parsed.data.outbound_base_url) update.outbound_base_url = parsed.data.outbound_base_url
  if (parsed.data.outbound_auth_token) update.outbound_auth_token_ciphertext = encryptOutboundToken(parsed.data.outbound_auth_token)

  let newSigningSecret: string | null = null
  if (parsed.data.regenerate_signing_secret) {
    newSigningSecret = generateSigningSecret()
    update.outbound_signing_secret = newSigningSecret
  }

  if (Object.keys(update).length === 0) {
    return NextResponse.json({ error: 'No fields to update' }, { status: 400 })
  }

  const supabase = createSupabaseAdminClient()
  const { error } = await supabase.from('partner_accounts').update(update).eq('id', parsed.data.partner_account_id)

  if (error) {
    console.error('[admin/configurator/outbound-config] Update failed:', error.message)
    return NextResponse.json({ error: 'Failed to update outbound config' }, { status: 500 })
  }

  return NextResponse.json({
    id: parsed.data.partner_account_id,
    outbound_base_url_updated: Boolean(update.outbound_base_url),
    outbound_auth_token_updated: Boolean(update.outbound_auth_token_ciphertext),
    // Shown exactly once, per the one-time-copy convention this route follows.
    ...(newSigningSecret ? { outbound_signing_secret: newSigningSecret } : {}),
  })
}
