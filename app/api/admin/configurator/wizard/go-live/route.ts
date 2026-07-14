import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requirePartnerAdmin } from '@/lib/partner/auth'
import { goLive } from '@/lib/partner/wizard'

/** POST /api/admin/configurator/wizard/go-live — Requirement Doc 13.4.C/14.7.3. */

const BodySchema = z.object({ partner_account_id: z.string().uuid() })

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null)
  const parsed = BodySchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Validation failed', details: parsed.error.flatten() }, { status: 400 })
  }

  const admin = await requirePartnerAdmin(parsed.data.partner_account_id)
  if (admin.error) return admin.error

  const result = await goLive(parsed.data.partner_account_id)

  if (!result.ok) {
    return NextResponse.json({ error: { code: result.code, pending_steps: result.pendingSteps } }, { status: 422 })
  }

  return NextResponse.json({ onboarding_completed_at: result.onboardingCompletedAt, live_url: result.liveUrl })
}
