/**
 * POST /api/sessions/acknowledge-adaptation
 * Auth: Clerk required
 *
 * Sets users.plan_adaptation_acknowledged_at = NOW() for the authenticated user.
 * Called when the user clicks the X on the plan adaptation notification banner
 * on /dashboard/sessions. Dismisses the banner server-side so it does not
 * reappear on future page loads or across devices.
 *
 * SCR-01 — Adaptive Plan Reordering
 */

import { auth } from '@clerk/nextjs/server'
import { NextResponse } from 'next/server'
import { createSupabaseAdminClient } from '@/lib/supabase'

export async function POST() {
  const { userId } = auth()

  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const supabase = createSupabaseAdminClient()

  const { error } = await supabase
    .from('users')
    .update({ plan_adaptation_acknowledged_at: new Date().toISOString() })
    .eq('id', userId)

  if (error) {
    console.error('[acknowledge-adaptation] Failed to update plan_adaptation_acknowledged_at:', error.message)
    return NextResponse.json({ error: 'Failed to acknowledge' }, { status: 500 })
  }

  return NextResponse.json({ success: true })
}
