import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createSupabaseAdminClient } from '@/lib/supabase'
import { requireChannelPartnerAdmin, requireChannelPartnerClientAccess } from '@/lib/partner/auth'
import { generateApiKey } from '@/lib/partner/api-keys'

/**
 * POST /api/channel-partner/api-keys — issue a new per-client API key for the sales-partner's own
 * account.
 * GET  /api/channel-partner/api-keys — list keys across every client (prefix + label only, never
 *      the full key after issuance).
 *
 * B2B-78 (docs/specs/B2B-78-requirement-document.md §6.4 "This is the first sales-partner-
 * self-service key-issuance path this codebase has ever had"). Structurally parallel to but
 * independent from the internal-only `/api/admin/partner-keys` (Clerk-admin-only, no partner-
 * facing UI) — this pair is sales-partner-facing and always writes `scoped_client_id`.
 *
 * `partner_account_id` on the inserted row is the sales-partner's OWN account (so wallet/billing
 * resolution — keyed on partner_account_id throughout lib/partner/wallet-gate.ts — correctly rolls
 * up to the sales-partner), while `scoped_client_id` narrows which client_id body value the key
 * may be used with on bot-sessions.
 */

const CreateKeySchema = z.object({
  client_id: z.string().uuid(),
  mode: z.enum(['test', 'live']),
  label: z.string().min(1).max(200).optional(),
})

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null)
  const parsed = CreateKeySchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Validation failed', details: parsed.error.flatten() }, { status: 422 })
  }

  const access = await requireChannelPartnerClientAccess(parsed.data.client_id)
  if (access.error) return access.error

  const generated = generateApiKey(parsed.data.mode)
  const supabase = createSupabaseAdminClient()

  const { data: inserted, error } = await supabase
    .from('partner_api_keys')
    .insert({
      partner_account_id: access.channelPartnerAccountId,
      scoped_client_id: parsed.data.client_id,
      mode: parsed.data.mode,
      key_prefix: generated.keyPrefix,
      key_hash: generated.keyHash,
      label: parsed.data.label ?? null,
    })
    .select('id, mode, label')
    .single()

  if (error || !inserted) {
    console.error('[channel-partner/api-keys] Insert failed:', error?.message)
    return NextResponse.json({ error: { code: 'internal_error', message: 'Failed to create key.' } }, { status: 500 })
  }

  // The full key is returned exactly once, in this response only — never retrievable again.
  return NextResponse.json(
    {
      id: inserted.id,
      key: generated.key,
      key_prefix: generated.keyPrefix,
      mode: inserted.mode,
      label: inserted.label,
      client_id: parsed.data.client_id,
    },
    { status: 201 }
  )
}

export async function GET() {
  const admin = await requireChannelPartnerAdmin()
  if (admin.error) return admin.error

  const supabase = createSupabaseAdminClient()
  const { data } = await supabase
    .from('partner_api_keys')
    .select('id, mode, key_prefix, label, status, scoped_client_id, last_used_at, created_at, revoked_at')
    .eq('partner_account_id', admin.partnerAccountId)
    .not('scoped_client_id', 'is', null)
    .order('created_at', { ascending: false })

  return NextResponse.json({ keys: data ?? [] })
}
