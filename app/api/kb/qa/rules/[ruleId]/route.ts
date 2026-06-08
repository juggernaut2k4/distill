import { NextRequest, NextResponse } from 'next/server'
import { requireSessionAuth } from '@/lib/session-auth'
import { z } from 'zod'

import { createSupabaseAdminClient } from '@/lib/supabase'
import { canAccessKB } from '@/lib/kb-access'
import { invalidateRulesCache } from '@/lib/templates/generator'

interface Params { params: { ruleId: string } }

const Body = z.object({
  action: z.enum(['approve', 'reject', 'pause', 'unpause']),
  user_suggestion: z.string().max(1000).optional(),
})

/**
 * PATCH /api/kb/qa/rules/[ruleId]
 * Approve, reject, pause, or unpause a rule.
 * Approving automatically invalidates the rules cache so next generation picks it up.
 */
export async function PATCH(request: NextRequest, { params }: Params) {
  const { userId, error } = await requireSessionAuth(request)
  if (error) return error

  const supabase = createSupabaseAdminClient()
  const { data: user } = await supabase
    .from('users').select('email').eq('id', userId!).single()

  if (!canAccessKB(user?.email)) {
    return NextResponse.json({ error: 'Access denied' }, { status: 403 })
  }

  const body = Body.safeParse(await request.json())
  if (!body.success) {
    return NextResponse.json({ error: 'Invalid action' }, { status: 400 })
  }

  const { action, user_suggestion } = body.data

  const statusMap: Record<string, string> = {
    approve:  'approved',
    reject:   'rejected',
    pause:    'paused',
    unpause:  'approved',
  }

  const updatePayload: Record<string, unknown> = {
    status: statusMap[action],
    updated_at: new Date().toISOString(),
  }

  if (action === 'approve' || action === 'unpause') {
    updatePayload.approved_at = new Date().toISOString()
  }

  if (user_suggestion) {
    updatePayload.user_suggestion = user_suggestion
  }

  const { data: updated, error: dbError } = await supabase
    .from('kb_qa_rules')
    .update(updatePayload)
    .eq('id', params.ruleId)
    .select()
    .single()

  if (dbError) {
    return NextResponse.json({ error: 'Update failed' }, { status: 500 })
  }

  // Invalidate in-memory cache so new generations pick up the change immediately
  if (action === 'approve' || action === 'unpause' || action === 'pause' || action === 'reject') {
    invalidateRulesCache()
  }

  return NextResponse.json({ rule: updated })
}

/**
 * DELETE /api/kb/qa/rules/[ruleId]
 * Hard-deletes a rule.
 */
export async function DELETE(request: NextRequest, { params }: Params) {
  const { userId, error } = await requireSessionAuth(request)
  if (error) return error

  const supabase = createSupabaseAdminClient()
  const { data: user } = await supabase
    .from('users').select('email').eq('id', userId!).single()

  if (!canAccessKB(user?.email)) {
    return NextResponse.json({ error: 'Access denied' }, { status: 403 })
  }

  await supabase.from('kb_qa_rules').delete().eq('id', params.ruleId)
  invalidateRulesCache()

  return NextResponse.json({ success: true })
}
