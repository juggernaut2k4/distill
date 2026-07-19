import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireChannelPartnerAdmin } from '@/lib/partner/auth'
import { listClientsForChannelPartner, createClientForChannelPartner } from '@/lib/partner/clients'

/**
 * B2B-26 (docs/specs/B2B-26-requirement-document.md §12, §6.7, §7 AT-10/11).
 * GET lists the caller's own client roster (`owning_channel_partner_id =
 * <caller's channel-partner account id>`). POST adds a new client — name +
 * company URL only (per this brief's explicit minimal scope; Integration/
 * usage-cap/routing-address fields are B2B-27's job).
 */

const CreateClientSchema = z.object({
  name: z.string().trim().min(1).max(200),
  companyUrl: z.string().trim().max(500).optional().nullable(),
})

export async function GET() {
  const admin = await requireChannelPartnerAdmin()
  if (admin.error) return admin.error

  const clients = await listClientsForChannelPartner(admin.partnerAccountId)
  return NextResponse.json({ clients })
}

export async function POST(request: NextRequest) {
  const admin = await requireChannelPartnerAdmin()
  if (admin.error) return admin.error

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Validation failed', details: 'Invalid JSON body' }, { status: 422 })
  }

  const parsed = CreateClientSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Validation failed', details: parsed.error.flatten() }, { status: 422 })
  }

  const companyUrl = parsed.data.companyUrl?.trim() || null
  const result = await createClientForChannelPartner(admin.partnerAccountId, parsed.data.name, companyUrl)

  if (!result.success || !result.client) {
    console.error('[channel-partner/clients] createClientForChannelPartner failed:', result.error)
    return NextResponse.json({ error: "Couldn't add this client. Try again." }, { status: 500 })
  }

  return NextResponse.json({ client: result.client }, { status: 201 })
}
