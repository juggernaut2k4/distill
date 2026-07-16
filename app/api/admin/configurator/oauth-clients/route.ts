import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createSupabaseAdminClient } from '@/lib/supabase'
import { requirePartnerAdmin } from '@/lib/partner/auth'
import { generateOAuthClient } from '@/lib/partner/oauth'

/**
 * POST /api/admin/configurator/oauth-clients — self-serve OAuth2 credential
 * generation.
 * GET  /api/admin/configurator/oauth-clients?partner_account_id=... — list
 *      credentials (client_id/mode/label/status/last_used_at only, never the
 *      secret after issuance).
 *
 * B2B-06 (docs/specs/B2B-06-requirement-document.md Section 4.B.3/4.B.4,
 * architecture.md §18.8). Clerk-authenticated only (`requirePartnerAdmin`) —
 * a direct structural mirror of `app/api/admin/partner-keys/route.ts`,
 * substituting `generateOAuthClient()`/`partner_oauth_clients` for
 * `generateApiKey()`/`partner_api_keys`.
 */

const CreateClientSchema = z.object({
  partner_account_id: z.string().uuid(),
  mode: z.enum(['test', 'live']),
  label: z.string().min(1).max(200).optional(),
})

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null)
  const parsed = CreateClientSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Validation failed', details: parsed.error.flatten() }, { status: 422 })
  }

  const admin = await requirePartnerAdmin(parsed.data.partner_account_id)
  if (admin.error) return admin.error

  const generated = generateOAuthClient(parsed.data.mode)
  const supabase = createSupabaseAdminClient()

  const { data: inserted, error } = await supabase
    .from('partner_oauth_clients')
    .insert({
      partner_account_id: parsed.data.partner_account_id,
      mode: parsed.data.mode,
      client_id: generated.clientId,
      client_secret_hash: generated.clientSecretHash,
      label: parsed.data.label ?? null,
    })
    .select('id, mode, label')
    .single()

  if (error || !inserted) {
    console.error('[admin/configurator/oauth-clients] Insert failed:', error?.message)
    return NextResponse.json({ error: 'Failed to create OAuth2 client' }, { status: 500 })
  }

  // client_secret is returned exactly once, in this response only — never retrievable again.
  return NextResponse.json(
    {
      id: inserted.id,
      client_id: generated.clientId,
      client_secret: generated.clientSecret,
      mode: inserted.mode,
      label: inserted.label,
    },
    { status: 201 }
  )
}

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
    .from('partner_oauth_clients')
    .select('id, client_id, mode, label, status, last_used_at, created_at, revoked_at')
    .eq('partner_account_id', partnerAccountId)
    .order('created_at', { ascending: false })

  // Never includes client_secret_hash — matches GET /api/admin/partner-keys's never-echo discipline.
  return NextResponse.json({ clients: data ?? [] })
}
