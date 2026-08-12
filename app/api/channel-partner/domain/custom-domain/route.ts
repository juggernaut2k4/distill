import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireChannelPartnerAdmin } from '@/lib/partner/auth'
import { addCustomDomain, removeCustomDomain, serializeDomainSettings } from '@/lib/partner/domain-settings'

/**
 * PATCH  /api/channel-partner/domain/custom-domain — add/replace this sales-partner's own domain.
 * DELETE /api/channel-partner/domain/custom-domain — remove it.
 *
 * B2B-79 (docs/specs/B2B-79-requirement-document.md §6.2). Thin wrapper over the existing
 * `lib/partner/domain-settings.ts`, swapping `requirePartnerAdmin` for
 * `requireChannelPartnerAdmin()`. `PATCH` per the Feature Brief's own trigger list (§3), not `POST`
 * — a direct partner's identical action uses `POST` (that route is unaffected, out of scope here).
 */

const BodySchema = z.object({ custom_domain: z.string().min(1).max(253) })

export async function PATCH(request: NextRequest) {
  const body = await request.json().catch(() => null)
  const parsed = BodySchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Validation failed', details: parsed.error.flatten() }, { status: 422 })
  }

  const admin = await requireChannelPartnerAdmin()
  if (admin.error) return admin.error

  const result = await addCustomDomain(admin.partnerAccountId, parsed.data.custom_domain.toLowerCase())

  if (!result.ok) {
    if (result.status === 409) {
      return NextResponse.json({ error: { code: result.code, message: result.message } }, { status: 409 })
    }
    if (result.code === 'invalid_format') {
      return NextResponse.json({ error: { code: result.code, message: result.message } }, { status: 422 })
    }
    return NextResponse.json(
      { custom_domain_status: result.data.customDomainStatus, custom_domain_error: result.data.customDomainError },
      { status: 422 }
    )
  }

  return NextResponse.json(serializeDomainSettings(result.data), { status: 201 })
}

export async function DELETE() {
  const admin = await requireChannelPartnerAdmin()
  if (admin.error) return admin.error

  const result = await removeCustomDomain(admin.partnerAccountId)
  if (!result.ok) {
    return NextResponse.json({ error: { code: result.code } }, { status: 404 })
  }

  return NextResponse.json({ custom_domain_status: 'none' })
}
