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

  // Await before returning — Vercel kills fire-and-forget promises when response sends
  const sends: Promise<unknown>[] = []

  if (user?.email) {
    sends.push(sendPlanApprovedEmail(user as User).catch(console.error))
  }

  if (user?.phone && user.twilio_number_assigned) {
    const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'https://hello-clio.com'
    sends.push(
      sendSMS(
        user.phone,
        user.twilio_number_assigned,
        `Clio: Your learning plan is approved! Schedule your first session: ${appUrl}/dashboard/schedule`
      ).catch(console.error)
    )
  }

  await Promise.all(sends)

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

  const sends2: Promise<unknown>[] = []

  if (user?.email) {
    sends2.push(sendPlanReadyEmail(user as User).catch(console.error))
  }

  if (user?.phone && user.twilio_number_assigned) {
    const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'https://hello-clio.com'
    sends2.push(
      sendSMS(
        user.phone,
        user.twilio_number_assigned,
        `Your Clio learning plan is ready! Review and approve it here: ${appUrl}/dashboard/plan — Clio`
      ).catch(console.error)
    )
  }

  await Promise.all(sends2)

  return NextResponse.json({ success: true })
}
