import { NextRequest, NextResponse } from 'next/server'
import { requireSessionAuth } from '@/lib/session-auth'
import { createSupabaseAdminClient } from '@/lib/supabase'
import { isConfiguredApprover } from '@/lib/templates/approval'

/**
 * GET /api/templates/library
 * RTV-04 — lists every template_library row for the admin approval UI.
 * Any authenticated user may read (read-only for everyone except the
 * configured approver — see PATCH /api/templates/library/[templateName]).
 *
 * Also returns `viewerIsApprover` so the client can disable Approve/Request
 * Changes buttons for everyone but the configured approver, without ever
 * sending the approver's email address to the browser.
 */
export async function GET(request: NextRequest) {
  const { userId, error } = await requireSessionAuth(request)
  if (error) return error

  const supabase = createSupabaseAdminClient()

  const { data: user } = await supabase
    .from('users').select('email').eq('id', userId!).single()

  const { data, error: dbError } = await supabase
    .from('template_library')
    .select('*')
    .order('provenance', { ascending: false }) // 'new' before 'existing' — surfaces the 2 new templates first
    .order('template_name', { ascending: true })

  if (dbError) {
    return NextResponse.json({ error: "Couldn't load the template library." }, { status: 500 })
  }

  return NextResponse.json({
    templates: data ?? [],
    viewerIsApprover: isConfiguredApprover(user?.email),
  })
}
