import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireSessionAuth } from '@/lib/session-auth'
import { createSupabaseAdminClient } from '@/lib/supabase'
import { isConfiguredApprover } from '@/lib/templates/approval'

interface Params { params: { templateName: string } }

const Body = z.object({
  action: z.enum(['approve', 'request_changes', 'reset_to_pending']),
  notes: z.string().max(2000).optional(),
})

const STATUS_MAP: Record<z.infer<typeof Body>['action'], string> = {
  approve: 'approved',
  request_changes: 'changes_requested',
  reset_to_pending: 'pending_review',
}

/**
 * PATCH /api/templates/library/[templateName]
 * RTV-04 Gate B — the ONLY write path for template_library's status/
 * reviewed_by/reviewed_at/review_notes columns.
 *
 * Fail-closed auth: the authenticated caller's email must exactly equal
 * process.env.TEMPLATE_LIBRARY_APPROVER_EMAIL. Wrong email -> 403. Unset env
 * var -> 403 for EVERYONE, including an email that would otherwise match
 * (isConfiguredApprover handles this and logs a one-time warning). No
 * partial state change ever happens before this check passes.
 *
 * `reviewed_by` is always set from the authenticated session — the request
 * body has no such field, so it is structurally impossible for a client to
 * spoof it.
 */
export async function PATCH(request: NextRequest, { params }: Params) {
  const { userId, error } = await requireSessionAuth(request)
  if (error) return error

  const supabase = createSupabaseAdminClient()
  const { data: user } = await supabase
    .from('users').select('email').eq('id', userId!).single()

  if (!isConfiguredApprover(user?.email)) {
    return NextResponse.json(
      { error: 'Only the configured approver may change template approval status.' },
      { status: 403 }
    )
  }

  let json: unknown
  try {
    json = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const body = Body.safeParse(json)
  if (!body.success) {
    return NextResponse.json({ error: 'Invalid action' }, { status: 400 })
  }

  const { action, notes } = body.data
  const status = STATUS_MAP[action]

  const updatePayload =
    action === 'reset_to_pending'
      ? { status, reviewed_by: null, reviewed_at: null, review_notes: null, updated_at: new Date().toISOString() }
      : {
          status,
          reviewed_by: user!.email as string, // never client-supplied
          reviewed_at: new Date().toISOString(),
          review_notes: notes ?? null,
          updated_at: new Date().toISOString(),
        }

  const { data: updated, error: dbError } = await supabase
    .from('template_library')
    .update(updatePayload)
    .eq('template_name', params.templateName)
    .select()
    .single()

  if (dbError) {
    return NextResponse.json({ error: 'Update failed' }, { status: 500 })
  }

  return NextResponse.json({ template: updated })
}
