import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requirePartnerAdmin } from '@/lib/partner/auth'
import { createSupabaseAdminClient } from '@/lib/supabase'

/**
 * GET/PATCH /api/admin/configurator/account
 *
 * B2B-29 (docs/specs/B2B-29-requirement-document.md §6.10). Backs the
 * "Company info" card on the Configurator's Dashboard tab
 * (`DashboardPanel.tsx`) — lets a direct partner (or, via Scope C's reused
 * surface, a sales-partner acting on a client) set the account's real name
 * post-signup. Gated by `requirePartnerAdmin`, the same as every other
 * Configurator route — it automatically benefits from this brief's own
 * chokepoint fix (`lib/partner/auth.ts`), so it works for both a direct
 * partner's own account and a sales-partner-managed client.
 */

const PatchSchema = z.object({
  partner_account_id: z.string().uuid(),
  name: z.string().trim().min(1).max(200),
  companyUrl: z.string().trim().max(500).optional().nullable(),
})

export async function GET(request: NextRequest) {
  const partnerAccountId = request.nextUrl.searchParams.get('partner_account_id')
  if (!partnerAccountId) {
    return NextResponse.json({ error: 'partner_account_id query param is required' }, { status: 400 })
  }
  const admin = await requirePartnerAdmin(partnerAccountId)
  if (admin.error) return admin.error

  const supabase = createSupabaseAdminClient()
  const { data } = await supabase.from('partner_accounts').select('name, company_url').eq('id', partnerAccountId).maybeSingle()
  return NextResponse.json({ name: data?.name ?? '', company_url: data?.company_url ?? null })
}

export async function PATCH(request: NextRequest) {
  const body = await request.json().catch(() => null)
  const parsed = PatchSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Validation failed', details: parsed.error.flatten() }, { status: 422 })
  }
  const admin = await requirePartnerAdmin(parsed.data.partner_account_id)
  if (admin.error) return admin.error

  const supabase = createSupabaseAdminClient()
  const { error } = await supabase
    .from('partner_accounts')
    .update({ name: parsed.data.name, company_url: parsed.data.companyUrl?.trim() || null })
    .eq('id', parsed.data.partner_account_id)

  if (error) {
    return NextResponse.json({ error: "Couldn't save. Try again." }, { status: 500 })
  }
  return NextResponse.json({ success: true })
}
