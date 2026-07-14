import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requirePartnerAdmin } from '@/lib/partner/auth'
import { createContentItem, getContentSource } from '@/lib/partner/content-generation'
import { inngest } from '@/inngest/client'

/**
 * POST /api/admin/configurator/content/generate
 * Section 4.A.3 — creates the `generating` row immediately, dispatches the
 * background pipeline via Inngest (`distill/partner-content.generate`), and
 * returns without waiting for it to complete (Section 4.A.3's polling UI
 * contract).
 */

const BodySchema = z.object({
  partner_account_id: z.string().uuid(),
  partner_topic_ref: z.string().min(1).max(512),
})

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null)
  const parsed = BodySchema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: 'Validation failed', details: parsed.error.flatten() }, { status: 400 })

  const admin = await requirePartnerAdmin(parsed.data.partner_account_id)
  if (admin.error) return admin.error

  const contentSource = await getContentSource(parsed.data.partner_account_id)
  if (contentSource !== 'clio_generated') {
    return NextResponse.json({ error: 'content_source_is_partner_supplied' }, { status: 409 })
  }

  const item = await createContentItem(parsed.data.partner_account_id, parsed.data.partner_topic_ref)
  if (!item) return NextResponse.json({ error: 'Failed to create content item' }, { status: 500 })

  await inngest.send({
    name: 'distill/partner-content.generate',
    data: {
      partnerAccountId: parsed.data.partner_account_id,
      itemId: item.id,
      partnerTopicRef: parsed.data.partner_topic_ref,
    },
  })

  return NextResponse.json({ item }, { status: 201 })
}
