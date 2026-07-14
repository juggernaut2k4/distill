import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requirePartnerAdmin } from '@/lib/partner/auth'
import { claimSubdomain } from '@/lib/partner/domain-settings'

/** PATCH /api/admin/configurator/domain/subdomain — Requirement Doc 4.B.3. */

const PatchSchema = z.object({
  partner_account_id: z.string().uuid(),
  subdomain_slug: z.string().min(1).max(63),
})

export async function PATCH(request: NextRequest) {
  const body = await request.json().catch(() => null)
  const parsed = PatchSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Validation failed', details: parsed.error.flatten() }, { status: 422 })
  }

  const admin = await requirePartnerAdmin(parsed.data.partner_account_id)
  if (admin.error) return admin.error

  const result = await claimSubdomain(parsed.data.partner_account_id, parsed.data.subdomain_slug.toLowerCase())

  if (!result.ok) {
    if (result.code === 'invalid_format') {
      return NextResponse.json({ error: { code: result.code, message: result.message } }, { status: 422 })
    }
    return NextResponse.json({ error: { code: result.code, message: result.message } }, { status: 409 })
  }

  return NextResponse.json({ subdomain_slug: result.data.subdomainSlug, subdomain_url: result.data.subdomainUrl })
}
