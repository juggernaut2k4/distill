import { NextRequest, NextResponse } from 'next/server'
import { auth as clerkAuth } from '@clerk/nextjs/server'
import { createSupabaseAdminClient } from '@/lib/supabase'

/**
 * DELETE /api/admin/partner-keys/:id — revoke a key immediately.
 *
 * docs/specs/B2B-02-requirement-document.md Section 4.5: 404 for BOTH "key
 * doesn't exist" and "key exists but caller doesn't administer its partner
 * account" — deliberately indistinguishable (same rationale as the
 * session-status-check 404 collapsing in Section 4.2), so this does NOT reuse
 * `requirePartnerAdmin()`'s 403 response; membership is checked directly here.
 * 409 (idempotent-friendly) if the key is already revoked — returns the
 * existing revoked state rather than erroring twice.
 */

interface Params {
  params: { id: string }
}

export async function DELETE(_request: NextRequest, { params }: Params) {
  const { userId } = clerkAuth()
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const supabase = createSupabaseAdminClient()

  const { data: key } = await supabase
    .from('partner_api_keys')
    .select('id, partner_account_id, status, revoked_at')
    .eq('id', params.id)
    .maybeSingle()

  if (!key) {
    return NextResponse.json({ error: { code: 'not_found', message: 'Key not found.' } }, { status: 404 })
  }

  const { data: membership } = await supabase
    .from('partner_admin_users')
    .select('id')
    .eq('clerk_user_id', userId)
    .eq('partner_account_id', key.partner_account_id)
    .maybeSingle()

  if (!membership) {
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
    console.error('[admin/partner-keys] Revoke failed:', updateError.message)
    return NextResponse.json({ error: 'Failed to revoke key' }, { status: 500 })
  }

  return NextResponse.json({ id: key.id, status: 'revoked', revoked_at: revokedAt }, { status: 200 })
}
