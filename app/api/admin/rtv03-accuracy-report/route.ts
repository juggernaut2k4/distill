/**
 * GET /api/admin/rtv03-accuracy-report?sessionId=<uuid>
 *
 * RTV-03 — the one JSON surface a human ever looks at for this observe-only
 * phase (requirement-docs/RTV-03-live-position-tracking.md Section 5). Mirrors
 * the exact auth pattern of app/api/admin/qa-session-context/route.ts: Clerk
 * `auth()`, 401 if no userId, no additional role check (this project's
 * existing single-owner-operated admin-route convention).
 *
 * Returns the stored rtv03_accuracy_reports row for the given session, or a
 * structured 404 distinguishing "not yet evaluated" from "not RTV-03-eligible"
 * (Section 8) — never a silent empty 200.
 */

import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { createSupabaseAdminClient } from '@/lib/supabase'

export async function GET(request: NextRequest) {
  const { userId } = auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const sessionId = request.nextUrl.searchParams.get('sessionId')
  if (!sessionId || sessionId.trim().length === 0) {
    return NextResponse.json({ error: 'sessionId query parameter is required' }, { status: 400 })
  }

  const supabase = createSupabaseAdminClient()

  const { data: report, error: reportErr } = await supabase
    .from('rtv03_accuracy_reports')
    .select('*')
    .eq('session_id', sessionId)
    .maybeSingle()

  if (reportErr) {
    console.error('[admin/rtv03-accuracy-report] Query failed:', reportErr.message)
    return NextResponse.json({ error: 'Failed to fetch accuracy report' }, { status: 500 })
  }

  if (report) {
    return NextResponse.json(report)
  }

  // No report row yet — distinguish "not eligible" from "not evaluated yet"
  // (Section 8) by checking the session's own rtv03_tracking_enabled flag.
  const { data: sessionRow } = await supabase
    .from('sessions')
    .select('id, rtv03_tracking_enabled')
    .eq('id', sessionId)
    .maybeSingle()

  if (!sessionRow) {
    return NextResponse.json(
      { error: 'No such session', reason: 'not_eligible' },
      { status: 404 },
    )
  }

  if (sessionRow.rtv03_tracking_enabled !== true) {
    return NextResponse.json(
      { error: 'No RTV-03 accuracy report available for this session', reason: 'not_eligible' },
      { status: 404 },
    )
  }

  return NextResponse.json(
    { error: 'No RTV-03 accuracy report available for this session', reason: 'not_evaluated' },
    { status: 404 },
  )
}
