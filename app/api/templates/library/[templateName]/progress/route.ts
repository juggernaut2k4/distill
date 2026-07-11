import { NextRequest, NextResponse } from 'next/server'
import { requireSessionAuth } from '@/lib/session-auth'
import { createSupabaseAdminClient } from '@/lib/supabase'

interface Params { params: { templateName: string } }

/**
 * GET /api/templates/library/[templateName]/progress
 * TMPL-01 (requirement doc Section 4.3/6) — read-only feed for the new
 * per-template Fix Progress view. Any authenticated user may read this,
 * matching the existing GET /api/templates/library read pattern — only the
 * mutating actions (this PATCH endpoint's actions, and the nudge endpoint)
 * are gated to the configured approver.
 *
 * Returns the row's current fix_state, fix_attempt_count,
 * fix_last_activity_at, fix_failure_reason, fix_changes_summary, and the full
 * template_fix_log history for this template, newest entry first.
 */
export async function GET(request: NextRequest, { params }: Params) {
  const { error } = await requireSessionAuth(request)
  if (error) return error

  const supabase = createSupabaseAdminClient()
  const templateName = params.templateName

  const { data: template, error: templateError } = await supabase
    .from('template_library')
    .select('fix_state, fix_attempt_count, fix_last_activity_at, fix_failure_reason, fix_changes_summary')
    .eq('template_name', templateName)
    .maybeSingle()

  if (templateError) {
    return NextResponse.json({ error: "Couldn't load fix progress. Refresh to try again." }, { status: 500 })
  }

  if (!template) {
    return NextResponse.json({ error: 'Template not found' }, { status: 404 })
  }

  const { data: log, error: logError } = await supabase
    .from('template_fix_log')
    .select('*')
    .eq('template_name', templateName)
    .order('created_at', { ascending: false })

  if (logError) {
    return NextResponse.json({ error: "Couldn't load fix progress. Refresh to try again." }, { status: 500 })
  }

  return NextResponse.json({
    fixState: template.fix_state,
    fixAttemptCount: template.fix_attempt_count,
    fixLastActivityAt: template.fix_last_activity_at,
    fixFailureReason: template.fix_failure_reason,
    fixChangesSummary: template.fix_changes_summary,
    log: log ?? [],
  })
}
