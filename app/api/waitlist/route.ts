import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { submitWaitlistSignup } from '@/lib/partner/waitlist'

/**
 * POST /api/waitlist — WAITLIST-01 (docs/specs/WAITLIST-01-requirement-document.md §6.3).
 * Public, unauthenticated — structural twin of app/api/partner-inquiry/route.ts. Honeypot field
 * (`website`, visually hidden on the form) silently drops any submission that fills it in — 200
 * response, no row inserted, never signals the check exists. The hard-unique-constraint duplicate
 * guard lives in `submitWaitlistSignup()` itself.
 */

const WaitlistSchema = z.object({
  name: z.string().trim().min(1, 'Your name is required').max(200),
  email: z.string().trim().email('Enter a valid email address').max(320),
  // Honeypot — real visitors never see or fill this field.
  website: z.string().max(200).optional(),
})

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null)
  const parsed = WaitlistSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Validation failed', details: parsed.error.flatten() }, { status: 422 })
  }

  // Honeypot triggered — silent success, no row written, no signal given to the submitter.
  if (parsed.data.website) {
    return NextResponse.json({ success: true })
  }

  const submittedIp = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? undefined

  const result = await submitWaitlistSignup({
    name: parsed.data.name,
    email: parsed.data.email,
    submittedIp,
  })

  if (!result.ok && result.code === 'duplicate_email') {
    return NextResponse.json({ duplicate: true }, { status: 200 })
  }
  if (!result.ok) {
    return NextResponse.json(
      { error: { code: 'internal_error', message: 'Something went wrong. Please try again.' } },
      { status: 500 }
    )
  }

  return NextResponse.json({ success: true })
}
