import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requirePartnerAdmin } from '@/lib/partner/auth'
import { getComponentConfig, upsertComponentConfig } from '@/lib/partner/theme'
import { recordPreferenceSignal } from '@/lib/partner/preference'

/** GET/PATCH /api/admin/configurator/templates/:templateName/components/:slot — Level C (Section 4.A.4 Screen state 3). */

export async function GET(request: NextRequest, { params }: { params: { templateName: string; slot: string } }) {
  const { searchParams } = new URL(request.url)
  const partnerAccountId = searchParams.get('partner_account_id')
  if (!partnerAccountId) return NextResponse.json({ error: 'partner_account_id query param is required' }, { status: 400 })

  const admin = await requirePartnerAdmin(partnerAccountId)
  if (admin.error) return admin.error

  const config = await getComponentConfig(partnerAccountId, params.templateName, params.slot)
  return NextResponse.json({ config })
}

const PatchSchema = z.object({
  partner_account_id: z.string().uuid(),
  style_mode: z.enum(['fill', 'outline', 'neon']),
  motion: z.enum(['none', 'fade', 'stagger', 'slide']),
})

export async function PATCH(request: NextRequest, { params }: { params: { templateName: string; slot: string } }) {
  const body = await request.json().catch(() => null)
  const parsed = PatchSchema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: 'Validation failed', details: parsed.error.flatten() }, { status: 400 })

  const admin = await requirePartnerAdmin(parsed.data.partner_account_id)
  if (admin.error) return admin.error

  const result = await upsertComponentConfig(parsed.data.partner_account_id, params.templateName, params.slot, {
    styleMode: parsed.data.style_mode,
    motion: parsed.data.motion,
  })

  if (!result.ok) {
    const status = result.error === 'template_not_approved' ? 409 : 422
    return NextResponse.json({ error: result.error }, { status })
  }

  await recordPreferenceSignal(parsed.data.partner_account_id, { kind: 'style_change_unreverted' })

  return NextResponse.json({ config: result.data })
}
