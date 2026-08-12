import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { submitSalesPartnerLead } from '@/lib/partner/sales-partner-leads'

/**
 * POST /api/partner-inquiry — B2B-80 (docs/specs/B2B-80-requirement-document.md §4.A/§6.5).
 * Public, unauthenticated — no Clerk session of any kind, and submitting this never creates one.
 * Honeypot field (`website`, visually hidden on the form) silently drops any submission that fills
 * it in — 200 response, no row inserted, never signals the check exists. The 24-hour
 * duplicate-email guard lives in `submitSalesPartnerLead()` itself.
 */

const InquirySchema = z.object({
  name: z.string().trim().min(1, 'Your name is required').max(200),
  company_name: z.string().trim().min(1, 'Company name is required').max(200),
  email: z.string().trim().email('Enter a valid email address').max(320),
  phone: z.string().trim().max(40).optional(),
  message: z.string().trim().max(1000).optional(),
  // Honeypot — real visitors never see or fill this field.
  website: z.string().max(200).optional(),
})

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null)
  const parsed = InquirySchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Validation failed', details: parsed.error.flatten() }, { status: 422 })
  }

  // Honeypot triggered — silent success, no row written, no signal given to the submitter.
  if (parsed.data.website) {
    return NextResponse.json({ success: true })
  }

  const submittedIp = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? undefined

  const result = await submitSalesPartnerLead({
    name: parsed.data.name,
    companyName: parsed.data.company_name,
    email: parsed.data.email,
    phone: parsed.data.phone,
    message: parsed.data.message,
    submittedIp,
  })

  if (!result.ok && result.code === 'duplicate_recent_submission') {
    return NextResponse.json(
      { error: { code: 'duplicate_recent_submission', message: 'We already have your submission and will be in touch.' } },
      { status: 200 }
    )
  }
  if (!result.ok) {
    return NextResponse.json({ error: { code: 'internal_error', message: 'Something went wrong. Please try again.' } }, { status: 500 })
  }

  return NextResponse.json({ success: true })
}
