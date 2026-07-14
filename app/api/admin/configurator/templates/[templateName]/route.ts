import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requirePartnerAdmin } from '@/lib/partner/auth'
import { getTemplateConfig, upsertTemplateConfig } from '@/lib/partner/theme'
import { recordPreferenceSignal } from '@/lib/partner/preference'

/**
 * GET/PATCH /api/admin/configurator/templates/:templateName — Level B
 * (Section 4.A.4 Screen state 3). `409 { error: 'template_not_approved' }`
 * on write if `template_library.status != 'approved'` (Section 7's
 * acceptance test — enforced regardless of which partner is calling).
 */

export async function GET(request: NextRequest, { params }: { params: { templateName: string } }) {
  const { searchParams } = new URL(request.url)
  const partnerAccountId = searchParams.get('partner_account_id')
  if (!partnerAccountId) return NextResponse.json({ error: 'partner_account_id query param is required' }, { status: 400 })

  const admin = await requirePartnerAdmin(partnerAccountId)
  if (admin.error) return admin.error

  const config = await getTemplateConfig(partnerAccountId, params.templateName)
  return NextResponse.json({ config })
}

const PatchSchema = z.object({
  partner_account_id: z.string().uuid(),
  title_override: z.string().max(200).nullable().optional(),
  show_so_what_footer: z.boolean(),
  motion_enabled: z.boolean(),
  color_variant: z.enum(['default', 'lighter', 'darker']),
})

export async function PATCH(request: NextRequest, { params }: { params: { templateName: string } }) {
  const body = await request.json().catch(() => null)
  const parsed = PatchSchema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: 'Validation failed', details: parsed.error.flatten() }, { status: 400 })

  const admin = await requirePartnerAdmin(parsed.data.partner_account_id)
  if (admin.error) return admin.error

  const result = await upsertTemplateConfig(parsed.data.partner_account_id, params.templateName, {
    titleOverride: parsed.data.title_override ?? null,
    showSoWhatFooter: parsed.data.show_so_what_footer,
    motionEnabled: parsed.data.motion_enabled,
    colorVariant: parsed.data.color_variant,
  })

  if (!result.ok) {
    const status = result.error === 'template_not_approved' ? 409 : 422
    return NextResponse.json({ error: result.error }, { status })
  }

  await recordPreferenceSignal(parsed.data.partner_account_id, { kind: 'style_change_unreverted' })

  return NextResponse.json({ config: result.data })
}
