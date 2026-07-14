import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createSupabaseAdminClient } from '@/lib/supabase'
import { requirePartnerAdmin } from '@/lib/partner/auth'
import { encryptOutboundToken, generateSigningSecret } from '@/lib/partner/crypto'

/**
 * PATCH /api/admin/partner-accounts/:id/outbound-config
 *
 * architecture.md Section 3.2: set/update `outbound_base_url`, rotate
 * `outbound_auth_token`, regenerate `outbound_signing_secret`. Clerk-
 * authenticated only — the credentials configured here are what every
 * Clio→partner call (content/profile push-pull, usage webhooks) authenticates
 * with, per the "Two Different Auth Directions" note in architecture.md
 * Section 2. No UI is built for this in this brief (B2B-03's Configurator).
 *
 * The plaintext `outbound_auth_token` is never stored — only its ciphertext
 * (lib/partner/crypto.ts). The generated `outbound_signing_secret` is
 * returned exactly once, in the response to a `regenerate_signing_secret:
 * true` request, mirroring the one-time-copy discipline for partner API keys
 * (Section 4.4) — it is never echoed back on a plain read.
 */

const PatchSchema = z.object({
  outbound_base_url: z.string().url().optional(),
  outbound_auth_token: z.string().min(1).optional(),
  regenerate_signing_secret: z.boolean().optional(),
})

interface Params {
  params: { id: string }
}

export async function PATCH(request: NextRequest, { params }: Params) {
  const admin = await requirePartnerAdmin(params.id)
  if (admin.error) return admin.error

  const body = await request.json().catch(() => null)
  const parsed = PatchSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Validation failed', details: parsed.error.flatten() }, { status: 400 })
  }

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
  const { error } = await supabase.from('partner_accounts').update(update).eq('id', params.id)

  if (error) {
    console.error('[admin/partner-accounts/outbound-config] Update failed:', error.message)
    return NextResponse.json({ error: 'Failed to update outbound config' }, { status: 500 })
  }

  return NextResponse.json({
    id: params.id,
    outbound_base_url_updated: Boolean(update.outbound_base_url),
    outbound_auth_token_updated: Boolean(update.outbound_auth_token_ciphertext),
    // Shown exactly once, per the one-time-copy convention this route follows.
    ...(newSigningSecret ? { outbound_signing_secret: newSigningSecret } : {}),
  })
}
