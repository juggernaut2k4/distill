import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requirePartnerAdmin } from '@/lib/partner/auth'
import { generateCustomTemplateSkeleton, createPendingCustomTemplate } from '@/lib/partner/custom-templates'

/**
 * POST /api/admin/configurator/templates/generate-new
 * Section 6.4/11 Q1 — net-new skeleton generation, validated against the
 * generation-safety boundary before persisting. On safety-validation
 * failure: nothing persisted, no usage_events row (Section 7/8's
 * acceptance test).
 */

const BodySchema = z.object({
  partner_account_id: z.string().uuid(),
  template_label: z.string().min(1).max(100),
  free_text_description: z.string().min(1).max(500),
  source: z.enum(['free_text_generated', 'skeleton_generated']).default('free_text_generated'),
})

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null)
  const parsed = BodySchema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: 'Validation failed', details: parsed.error.flatten() }, { status: 400 })

  const admin = await requirePartnerAdmin(parsed.data.partner_account_id)
  if (admin.error) return admin.error

  const generation = await generateCustomTemplateSkeleton(parsed.data.free_text_description)
  if (!generation.valid) {
    return NextResponse.json({ error: 'unsafe_or_invalid_generation' }, { status: 422 })
  }

  const result = await createPendingCustomTemplate(
    parsed.data.partner_account_id,
    parsed.data.template_label,
    generation.skeleton,
    parsed.data.source
  )
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 500 })

  return NextResponse.json({ custom_template: result.data }, { status: 201 })
}
