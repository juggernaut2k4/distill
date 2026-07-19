import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireChannelPartnerAdmin } from '@/lib/partner/auth'
import { createSupabaseAdminClient } from '@/lib/supabase'
import { checkCardOnFile } from '@/lib/partner/configurator-status'

/**
 * GET/PATCH /api/channel-partner/account
 *
 * B2B-29 (docs/specs/B2B-29-requirement-document.md §6.11). Same shape as
 * `/api/admin/configurator/account` (§6.10), but gated by
 * `requireChannelPartnerAdmin()` — no `partner_account_id` param, acts on
 * the caller's own account, matching every other `/api/channel-partner/*`
 * route's convention. `GET` additionally includes `card_on_file: boolean`
 * (reuses `checkCardOnFile`, already fully generic over any
 * `partner_account_id`).
 */

const PatchSchema = z.object({
  name: z.string().trim().min(1).max(200),
  companyUrl: z.string().trim().max(500).optional().nullable(),
})

export async function GET() {
  const admin = await requireChannelPartnerAdmin()
  if (admin.error) return admin.error

  const supabase = createSupabaseAdminClient()
  const [{ data }, cardOnFile] = await Promise.all([
    supabase.from('partner_accounts').select('name, company_url').eq('id', admin.partnerAccountId).maybeSingle(),
    checkCardOnFile(admin.partnerAccountId),
  ])

  return NextResponse.json({ name: data?.name ?? '', company_url: data?.company_url ?? null, card_on_file: cardOnFile })
}

export async function PATCH(request: NextRequest) {
  const admin = await requireChannelPartnerAdmin()
  if (admin.error) return admin.error

  const body = await request.json().catch(() => null)
  const parsed = PatchSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Validation failed', details: parsed.error.flatten() }, { status: 422 })
  }

  const supabase = createSupabaseAdminClient()
  const { error } = await supabase
    .from('partner_accounts')
    .update({ name: parsed.data.name, company_url: parsed.data.companyUrl?.trim() || null })
    .eq('id', admin.partnerAccountId)

  if (error) {
    return NextResponse.json({ error: "Couldn't save. Try again." }, { status: 500 })
  }
  return NextResponse.json({ success: true })
}
