import { NextRequest, NextResponse } from 'next/server'
import { requireSessionAuth } from '@/lib/session-auth'
import { requireSuperAdmin } from '@/lib/internal-admin/auth'
import { createSupabaseAdminClient } from '@/lib/supabase'
import { isConfiguredApprover } from '@/lib/templates/approval'

/**
 * GET /api/templates/library
 * RTV-04 — lists every template_library row for the admin approval UI.
 *
 * B2B-21 Requirement Doc §7 note — template_library is global (no
 * partner_account_id column at all), Clio's own content-approval queue.
 * `requireSuperAdmin()` is layered ON TOP of the existing `requireSessionAuth`
 * check (which still resolves `userId` for the `viewerIsApprover` calc below)
 * as an additional, orthogonal gate — who may VIEW this page at all is now
 * super-admin-only, a separate, untouched concern from who may approve
 * (`isConfiguredApprover`, governed by PATCH below).
 *
 * Also returns `viewerIsApprover` so the client can disable Approve/Request
 * Changes buttons for everyone but the configured approver, without ever
 * sending the approver's email address to the browser.
 */
export async function GET(request: NextRequest) {
  const { userId, error } = await requireSessionAuth(request)
  if (error) return error

  const admin = await requireSuperAdmin()
  if (admin.error) return admin.error

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
