import { NextResponse } from 'next/server'
import { requireAuth } from '@/lib/clerk'
import { createSupabaseAdminClient } from '@/lib/supabase'
import { sendPlanReadyEmail, sendPlanApprovedEmail, type User } from '@/lib/delivery/email'
import { sendSMS } from '@/lib/delivery/sms'

/**
 * POST /api/plan/approve
 * Marks the user's curriculum plan as approved and sends confirmation notifications.
 */
export async function POST() {
  const { userId, error } = requireAuth()
  if (error) return error

  const supabase = createSupabaseAdminClient()

  await supabase
    .from('users')
    .update({ plan_approved: true })
    .eq('id', userId!)

  // Fetch user for notifications
  const { data: user } = await supabase
    .from('users')
    .select('id, email, role, industry, ai_maturity, phone, twilio_number_assigned')
    .eq('id', userId!)
    .single()

  if (user?.email) {
    await sendPlanApprovedEmail(user as User)
  }

  if (user?.phone && user.twilio_number_assigned) {
    const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'https://hello-clio.com'
    await sendSMS(
      user.phone,
      user.twilio_number_assigned,
      `Clio: Your learning plan is approved! Schedule your first session: ${appUrl}/dashboard/schedule`
    )
  }

  return NextResponse.json({ success: true })
}

/**
 * POST /api/plan/generate
 * Called after topic selection — notifies user their plan is ready.
 */
export async function PUT() {
  const { userId, error } = requireAuth()
  if (error) return error

  const supabase = createSupabaseAdminClient()

  await supabase
    .from('users')
    .update({ plan_generated_at: new Date().toISOString() })
    .eq('id', userId!)

  const { data: user } = await supabase
    .from('users')
    .select('id, email, role, industry, ai_maturity, phone, twilio_number_assigned')
    .eq('id', userId!)
    .single()

  if (user?.email) {
    await sendPlanReadyEmail(user as User)
  }

  if (user?.phone && user.twilio_number_assigned) {
    const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'https://hello-clio.com'
    await sendSMS(
      user.phone,
      user.twilio_number_assigned,
      `Your Clio learning plan is ready! Review and approve it here: ${appUrl}/dashboard/plan — Clio`
    )
  }

  return NextResponse.json({ success: true })
}
