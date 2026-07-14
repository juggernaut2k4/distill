import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requirePartnerAdmin } from '@/lib/partner/auth'
import { generateSampleFillData, recordSampleFillUsage } from '@/lib/partner/template-discovery'
import { isTemplateApprovedForConfig } from '@/lib/partner/theme'

/**
 * POST /api/admin/configurator/templates/:templateName/sample-fill
 * Section 4.A.4 Screen state 6 — ephemeral AI preview fill, never saved.
 * Fires `usage_events` (llm_generation_sample_fill) on success only.
 */

const BodySchema = z.object({ partner_account_id: z.string().uuid() })

export async function POST(request: NextRequest, { params }: { params: { templateName: string } }) {
  const body = await request.json().catch(() => null)
  const parsed = BodySchema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: 'Validation failed', details: parsed.error.flatten() }, { status: 400 })

  const admin = await requirePartnerAdmin(parsed.data.partner_account_id)
  if (admin.error) return admin.error

  if (!(await isTemplateApprovedForConfig(params.templateName))) {
    return NextResponse.json({ error: 'template_not_approved' }, { status: 409 })
  }

  try {
    const { data, confidence } = await generateSampleFillData(parsed.data.partner_account_id, params.templateName)
    await recordSampleFillUsage(parsed.data.partner_account_id)
    return NextResponse.json({ data, confidence })
  } catch (err) {
    console.error('[configurator/sample-fill] failed:', err instanceof Error ? err.message : err)
    return NextResponse.json({ error: 'generation_failed' }, { status: 502 })
  }
}
