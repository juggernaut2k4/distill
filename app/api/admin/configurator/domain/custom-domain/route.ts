import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requirePartnerAdmin } from '@/lib/partner/auth'
import { addCustomDomain, removeCustomDomain, serializeDomainSettings } from '@/lib/partner/domain-settings'

/** POST/DELETE /api/admin/configurator/domain/custom-domain — Requirement Doc 4.B.4/4.B.6. */

const BodySchema = z.object({
  partner_account_id: z.string().uuid(),
  custom_domain: z.string().min(1).max(253).optional(),
})

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null)
  const parsed = BodySchema.safeParse(body)
  if (!parsed.success || !parsed.data.custom_domain) {
    return NextResponse.json({ error: 'Validation failed', details: parsed.success ? undefined : parsed.error.flatten() }, { status: 422 })
  }

  const admin = await requirePartnerAdmin(parsed.data.partner_account_id)
  if (admin.error) return admin.error

  const result = await addCustomDomain(parsed.data.partner_account_id, parsed.data.custom_domain.toLowerCase())

  if (!result.ok) {
    if (result.status === 409) {
      return NextResponse.json({ error: { code: result.code, message: result.message } }, { status: 409 })
    }
    if (result.code === 'invalid_format') {
      return NextResponse.json({ error: { code: result.code, message: result.message } }, { status: 422 })
    }
    // Vercel rejected the domain synchronously — 422, Screen state 5.
    return NextResponse.json(
      { custom_domain_status: result.data.customDomainStatus, custom_domain_error: result.data.customDomainError },
      { status: 422 }
    )
  }

  return NextResponse.json(serializeDomainSettings(result.data), { status: 201 })
}

export async function DELETE(request: NextRequest) {
  const body = await request.json().catch(() => null)
  const parsed = BodySchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Validation failed', details: parsed.error.flatten() }, { status: 400 })
  }

  const admin = await requirePartnerAdmin(parsed.data.partner_account_id)
  if (admin.error) return admin.error

  const result = await removeCustomDomain(parsed.data.partner_account_id)
  if (!result.ok) {
    return NextResponse.json({ error: { code: result.code } }, { status: 404 })
  }

  return NextResponse.json({ custom_domain_status: 'none' })
}
