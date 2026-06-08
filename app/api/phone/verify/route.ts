import { NextRequest, NextResponse } from 'next/server'
import { requireSessionAuth } from '@/lib/session-auth'
import { z } from 'zod'

import { createSupabaseAdminClient } from '@/lib/supabase'
import { assignPhoneNumber } from '@/lib/delivery/sms'

const VerifySchema = z.object({
  phone: z.string().min(7).max(20),
  code: z.string().length(6),
})

/**
 * POST /api/phone/verify
 * Verifies the OTP code and saves the phone number to the user record.
 */
export async function POST(request: NextRequest) {
  const { userId, error } = await requireSessionAuth(request)
  if (error) return error

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const parsed = VerifySchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Validation failed', details: parsed.error.flatten() },
      { status: 400 }
    )
  }

  const { phone, code } = parsed.data
  const supabase = createSupabaseAdminClient()

  // Fetch stored OTP and expiry
  const { data: user } = await supabase
    .from('users')
    .select('phone_otp, phone_otp_expires_at, plan_tier')
    .eq('id', userId!)
    .single()

  if (!user) {
    return NextResponse.json({ error: 'User not found' }, { status: 404 })
  }

  const storedOtp = user.phone_otp as string | null
  const expiresAt = user.phone_otp_expires_at as string | null

  // Validate OTP
  if (!storedOtp || storedOtp !== code) {
    return NextResponse.json({ error: 'Invalid or expired code' }, { status: 400 })
  }

  if (!expiresAt || new Date(expiresAt) < new Date()) {
    return NextResponse.json({ error: 'Invalid or expired code' }, { status: 400 })
  }

  // Assign a Twilio number from the pool
  const planTier = (user.plan_tier as string) ?? 'starter'
  const validPlan = ['starter', 'pro', 'executive', 'free'].includes(planTier)
    ? (planTier as 'starter' | 'pro' | 'executive' | 'free')
    : 'starter'
  const twilioNumber = assignPhoneNumber(userId!, validPlan)

  // Save phone, clear OTP
  await supabase
    .from('users')
    .update({
      phone,
      phone_otp: null,
      phone_otp_expires_at: null,
      twilio_number_assigned: twilioNumber,
    })
    .eq('id', userId!)

  return NextResponse.json({ success: true })
}
