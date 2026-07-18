import { NextRequest, NextResponse } from 'next/server'
import { requireSuperAdmin, internalAdminErrorEnvelope } from '@/lib/internal-admin/auth'
import { createSupabaseAdminClient } from '@/lib/supabase'

/**
 * DELETE /api/admin/team/super-admins/[id] — deactivates a super-admin.
 *
 * B2B-21 Requirement Doc §6.4 / §4.B State T5 — last-super-admin guard:
 * any active super-admin may deactivate any other super-admin (equal-peers,
 * no special-cased immunity for the seed row — §11 Q5), gated only by never
 * allowing the count of active+pending super-admins to reach zero. Server
 * independently rejects it (422) — defense in depth against a client-side-
 * only guard, matching this codebase's existing pattern for destructive
 * actions.
 */
export async function DELETE(_request: NextRequest, { params }: { params: { id: string } }) {
  const admin = await requireSuperAdmin()
  if (admin.error) return admin.error

  const supabase = createSupabaseAdminClient()

  const { data: target, error: targetError } = await supabase
    .from('internal_admin_users')
    .select('id, role, status')
    .eq('id', params.id)
    .eq('role', 'super_admin')
    .maybeSingle()

  if (targetError) {
    console.error('[admin/team/super-admins/:id] Failed to load target:', targetError.message)
    return NextResponse.json({ error: 'Could not deactivate super-admin.' }, { status: 500 })
  }
  if (!target) {
    return NextResponse.json({ error: 'Super-admin not found.' }, { status: 404 })
  }

  const { count, error: countError } = await supabase
    .from('internal_admin_users')
    .select('id', { count: 'exact', head: true })
    .eq('role', 'super_admin')
    .in('status', ['pending', 'active'])

  if (countError) {
    console.error('[admin/team/super-admins/:id] Failed to count active super-admins:', countError.message)
    return NextResponse.json({ error: 'Could not deactivate super-admin.' }, { status: 500 })
  }

  const targetIsActiveOrPending = target.status === 'pending' || target.status === 'active'
  if (targetIsActiveOrPending && (count ?? 0) <= 1) {
    return NextResponse.json(internalAdminErrorEnvelope('last_super_admin', 'At least one super-admin must remain.'), { status: 422 })
  }

  const { error: updateError } = await supabase
    .from('internal_admin_users')
    .update({ status: 'deactivated' })
    .eq('id', params.id)

  if (updateError) {
    console.error('[admin/team/super-admins/:id] Failed to deactivate super-admin:', updateError.message)
    return NextResponse.json({ error: 'Could not deactivate super-admin.' }, { status: 500 })
  }

  return NextResponse.json({ deactivated: true })
}
