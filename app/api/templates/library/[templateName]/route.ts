import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import crypto from 'crypto'
import { requireSessionAuth } from '@/lib/session-auth'
import { createSupabaseAdminClient } from '@/lib/supabase'
import { isConfiguredApprover } from '@/lib/templates/approval'
import { isFixLoopTemplate } from '@/lib/templates/styleOverrideSlots'
import { inngest } from '@/inngest/client'

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
 * reviewed_by/reviewed_at/review_notes columns. TMPL-01 extends this same
 * endpoint (requirement doc Section 6) with the automated fix-loop fields —
 * it does not add a new route.
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
  const templateName = params.templateName

  // TMPL-01 (Section 4.2) — approval is blocked server-side while a fix is in
  // flight or has failed, not just by hiding the Approve button in the UI. A
  // direct API call cannot bypass this either. Best-effort check-then-update;
  // this endpoint has a single configured approver so the race window is
  // negligible, matching this codebase's established risk tolerance for this
  // admin-only workflow.
  if (action === 'approve') {
    const { data: current } = await supabase
      .from('template_library')
      .select('fix_state')
      .eq('template_name', templateName)
      .maybeSingle()

    if (current && current.fix_state !== 'none') {
      return NextResponse.json(
        { error: 'Cannot approve while an automated fix is in progress or has failed. Resolve the fix first.' },
        { status: 400 }
      )
    }
  }

  let updatePayload: Record<string, unknown>
  let newFixCycleId: string | null = null

  if (action === 'reset_to_pending') {
    // TMPL-01 (Section 6) — additionally resets fix_state back to 'none'.
    updatePayload = {
      status,
      reviewed_by: null,
      reviewed_at: null,
      review_notes: null,
      fix_state: 'none',
      updated_at: new Date().toISOString(),
    }
  } else {
    updatePayload = {
      status,
      reviewed_by: user!.email as string, // never client-supplied
      reviewed_at: new Date().toISOString(),
      review_notes: notes ?? null,
      updated_at: new Date().toISOString(),
    }

    // TMPL-01 (Section 4.2/6/9) — only Heatmap/Overlay participate in the
    // automated fix loop, matching the existing RTV04_VALIDATED_TEMPLATES
    // scoping precedent. Every other template keeps exactly RTV-04's
    // original request_changes behavior (status + notes only, no automated
    // fix) — this is intentionally additive, not a behavior change for the
    // other 25 templates.
    if (action === 'request_changes' && isFixLoopTemplate(templateName)) {
      newFixCycleId = crypto.randomUUID()
      updatePayload = {
        ...updatePayload,
        fix_state: 'generating',
        fix_attempt_count: 0,
        fix_cycle_id: newFixCycleId,
        fix_changes_summary: null,
        fix_failure_reason: null,
        fix_last_activity_at: new Date().toISOString(),
      }
    }
  }

  const { data: updated, error: dbError } = await supabase
    .from('template_library')
    .update(updatePayload)
    .eq('template_name', templateName)
    .select()
    .single()

  if (dbError) {
    return NextResponse.json({ error: 'Update failed' }, { status: 500 })
  }

  // TMPL-01 (Section 6) — write the feedback_received log row and fire the
  // fix-requested event only AFTER the DB write has succeeded, and only for
  // the 2 fix-loop-enabled templates. No second click, no separate
  // "generate fix" button (Section 3).
  if (action === 'request_changes' && isFixLoopTemplate(templateName) && newFixCycleId) {
    await supabase.from('template_fix_log').insert({
      template_name: templateName,
      fix_cycle_id: newFixCycleId,
      attempt_number: null,
      event_type: 'feedback_received',
      message:
        notes && notes.length > 0
          ? `Feedback received: "${notes}"`
          : 'Feedback received (no notes provided).',
    })

    await inngest.send({
      name: 'clio/template.fix_requested',
      data: { templateName, notes: notes ?? '', fixCycleId: newFixCycleId },
    })
  }

  return NextResponse.json({ template: updated })
}
