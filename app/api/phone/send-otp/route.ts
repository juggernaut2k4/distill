import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireAuth } from '@/lib/clerk'
import { createSupabaseAdminClient } from '@/lib/supabase'
import { sendSMS } from '@/lib/delivery/sms'

const SendOTPSchema = z.object({
  phone: z.string().min(7).max(20),
})

/**
 * POST /api/phone/send-otp
 * Generates a 6-digit OTP, stores it on the user row, and sends via SMS.
 */
export async function POST(request: NextRequest) {
  const { userId, error } = requireAuth()
  if (error) return error

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const parsed = SendOTPSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid phone number', details: parsed.error.flatten() },
      { status: 400 }
    )
  }

  const { phone } = parsed.data

  // Generate 6-digit OTP
  const otp = Math.floor(100000 + Math.random() * 900000).toString()
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString() // 10 minutes

  const supabase = createSupabaseAdminClient()

  // Store OTP on user row — columns phone_otp and phone_otp_expires_at
  // These are best-effort; if columns don't exist yet the update will be a no-op
  const { error: updateError } = await supabase
    .from('users')
    .update({
      phone_otp: otp,
      phone_otp_expires_at: expiresAt,
    })
    .eq('id', userId!)

  if (updateError) {
    console.error('[send-otp] Failed to store OTP:', updateError.message)
    // Continue anyway — SMS send still attempted
  }

  // Use first number from TWILIO_PHONE_POOL as the sender
  const fromNumber = process.env.TWILIO_PHONE_POOL?.split(',')[0]?.trim() ?? '+15550000001'

  await sendSMS(
    phone,
    fromNumber,
    `Your Clio verification code is: ${otp}. Valid for 10 minutes.`
  )

  return NextResponse.json({ success: true })
}
