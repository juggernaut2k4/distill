import { NextRequest, NextResponse } from 'next/server'
import { requireSessionAuth } from '@/lib/session-auth'
import { z } from 'zod'

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
  const { userId, error } = await requireSessionAuth(request)
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

  let { phone } = parsed.data

  // Normalize to E.164: strip spaces/dashes/parens, prepend +1 if 10 digits (US/CA default)
  phone = phone.replace(/[\s\-().]/g, '')
  if (!phone.startsWith('+')) {
    phone = phone.length === 10 ? `+1${phone}` : `+${phone}`
  }

  // Generate 6-digit OTP
  const otp = Math.floor(100000 + Math.random() * 900000).toString()
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString()

  const supabase = createSupabaseAdminClient()

  const { error: updateError } = await supabase
    .from('users')
    .update({ phone_otp: otp, phone_otp_expires_at: expiresAt })
    .eq('id', userId!)

  if (updateError) {
    console.error('[send-otp] Failed to store OTP:', updateError.message)
    return NextResponse.json({ error: 'Failed to generate code. Please try again.' }, { status: 500 })
  }

  const fromNumber = process.env.TWILIO_PHONE_POOL?.split(',')[0]?.trim() ?? '+15550000001'

  try {
    await sendSMS(phone, fromNumber, `Your Clio verification code is: ${otp}. Valid for 10 minutes.`)
  } catch (smsErr) {
    console.error('[send-otp] SMS send failed:', smsErr)
    return NextResponse.json(
      { error: 'Could not send SMS to this number. Check the number and try again.' },
      { status: 502 }
    )
  }

  return NextResponse.json({ success: true })
}
