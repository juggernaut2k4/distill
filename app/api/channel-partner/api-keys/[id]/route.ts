import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseAdminClient } from '@/lib/supabase'
import { requireChannelPartnerAdmin } from '@/lib/partner/auth'

/**
 * DELETE /api/channel-partner/api-keys/:id — revoke a sales-partner's own per-client key
 * immediately. No confirm dialog (existing codebase convention, B2B-21/B2B-26), effective on the
 * next request. 404 for both "key doesn't exist" and "key exists but belongs to a different
 * account" — same indistinguishable-404 convention as the internal `/api/admin/partner-keys/:id`
 * route this mirrors.
 */

interface Params {
  params: { id: string }
}

export async function DELETE(_request: NextRequest, { params }: Params) {
  const admin = await requireChannelPartnerAdmin()
  if (admin.error) return admin.error

  const supabase = createSupabaseAdminClient()

  const { data: keyRows } = await supabase
    .from('partner_api_keys')
    .select('id, partner_account_id, status, revoked_at')
    .eq('id', params.id)
    .limit(1)
  const key = keyRows?.[0] ?? null

  if (!key || key.partner_account_id !== admin.partnerAccountId) {
    return NextResponse.json({ error: { code: 'not_found', message: 'Key not found.' } }, { status: 404 })
  }

  if (key.status === 'revoked') {
    return NextResponse.json({ id: key.id, status: 'revoked', revoked_at: key.revoked_at }, { status: 409 })
  }

  const revokedAt = new Date().toISOString()
  const { error: updateError } = await supabase
    .from('partner_api_keys')
    .update({ status: 'revoked', revoked_at: revokedAt })
    .eq('id', key.id)

  if (updateError) {
    console.error('[channel-partner/api-keys] Revoke failed:', updateError.message)
    return NextResponse.json({ error: { code: 'internal_error', message: 'Failed to revoke key.' } }, { status: 500 })
  }

  return NextResponse.json({ id: key.id, status: 'revoked', revoked_at: revokedAt }, { status: 200 })
}
