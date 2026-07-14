import { NextRequest, NextResponse } from 'next/server'
import { requirePartnerAdmin } from '@/lib/partner/auth'
import { createSupabaseAdminClient } from '@/lib/supabase'
import { listCustomTemplates } from '@/lib/partner/custom-templates'

/**
 * GET /api/admin/configurator/templates?partner_account_id=...
 * Section 4.A.4 Screen state 2 — only `template_library.status='approved'`
 * rows are listed, joined with this partner's own `partner_template_config`
 * (RTV-04 branch (a) gate). Also returns this partner's own
 * `partner_custom_templates` (Section 6.4/11 Q1).
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const partnerAccountId = searchParams.get('partner_account_id')
  if (!partnerAccountId) return NextResponse.json({ error: 'partner_account_id query param is required' }, { status: 400 })

  const admin = await requirePartnerAdmin(partnerAccountId)
  if (admin.error) return admin.error

  const supabase = createSupabaseAdminClient()
  const [{ data: approved }, { count: totalCount }, { data: configured }, customTemplates] = await Promise.all([
    supabase.from('template_library').select('template_name, display_name').eq('status', 'approved'),
    supabase.from('template_library').select('template_name', { count: 'exact', head: true }),
    supabase.from('partner_template_config').select('template_name').eq('partner_account_id', partnerAccountId),
    listCustomTemplates(partnerAccountId),
  ])

  const configuredNames = new Set((configured ?? []).map((r) => r.template_name as string))

  const templates = (approved ?? []).map((row) => ({
    templateName: row.template_name as string,
    displayName: row.display_name as string,
    parameterized: configuredNames.has(row.template_name as string),
  }))

  return NextResponse.json({
    templates,
    total_approved: templates.length,
    total_templates: totalCount ?? templates.length,
    custom_templates: customTemplates,
  })
}
