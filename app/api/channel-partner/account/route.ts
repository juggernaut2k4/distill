import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireChannelPartnerAdmin } from '@/lib/partner/auth'
import { createSupabaseAdminClient } from '@/lib/supabase'

/**
 * GET/PATCH /api/channel-partner/account
 *
 * B2B-29 (docs/specs/B2B-29-requirement-document.md §6.11). Same shape as
 * `/api/admin/configurator/account` (§6.10), but gated by
 * `requireChannelPartnerAdmin()` — no `partner_account_id` param, acts on
 * the caller's own account, matching every other `/api/channel-partner/*`
 * route's convention.
 *
 * Hotfix (2026-07-19, live-tested by Arun): GET no longer includes
 * `card_on_file`. It used to run `checkCardOnFile()` in the same
 * `Promise.all` as the name/company_url read, which meant the Company-info
 * form's inputs (disabled until this single combined response resolved)
 * sat disabled for as long as the slower Stripe/wallet card check took —
 * observed live as "the company name field became editable after a few
 * seconds [of] checking the payment field." Card status now has its own
 * endpoint (`GET /api/channel-partner/billing/card-status`) so the two
 * loads are genuinely independent — this read is a single-table select and
 * should always be fast.
 */

const PatchSchema = z.object({
  name: z.string().trim().min(1).max(200),
  companyUrl: z.string().trim().max(500).optional().nullable(),
})

export async function GET() {
  const admin = await requireChannelPartnerAdmin()
  if (admin.error) return admin.error

  const supabase = createSupabaseAdminClient()
  const { data } = await supabase.from('partner_accounts').select('name, company_url').eq('id', admin.partnerAccountId).maybeSingle()

  return NextResponse.json({ name: data?.name ?? '', company_url: data?.company_url ?? null })
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
