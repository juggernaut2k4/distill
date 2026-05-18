import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireAuth } from '@/lib/clerk'
import { createSupabaseAdminClient } from '@/lib/supabase'
import { sendPlanReadyEmail, type User as EmailUser } from '@/lib/delivery/email'
import { sendSMS } from '@/lib/delivery/sms'

const TopicsSchema = z.object({
  topics: z.array(z.string().min(1).max(200)).min(0).max(50),
})

/**
 * POST /api/topics
 * Saves user topic interests and triggers curriculum plan generation.
 * Fires plan-ready notification async (email + optional SMS) — does not block response.
 */
export async function POST(request: NextRequest) {
  const { userId, error } = requireAuth()
  if (error) return error

  const body = await request.json()
  const parsed = TopicsSchema.safeParse(body)

  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Validation failed', details: parsed.error.flatten() },
      { status: 400 }
    )
  }

  const supabase = createSupabaseAdminClient()

  const { error: updateError } = await supabase
    .from('users')
    .update({
      topic_interests: parsed.data.topics,
      needs_recalibration: false,
      plan_approved: false,
    })
    .eq('id', userId!)

  if (!updateError) {
    // Fire-and-forget: notify user that plan is ready
    void (async () => {
      try {
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
          await sendPlanReadyEmail(user as EmailUser)
        }

        const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'https://hello-clio.com'
        if (user?.phone && user.twilio_number_assigned) {
          await sendSMS(
            user.phone as string,
            user.twilio_number_assigned as string,
            `Your Clio learning plan is ready! Review and approve it here: ${appUrl}/dashboard/plan — Clio`
          )
        }
      } catch (notifyErr) {
        console.error('[topics] Plan-ready notification failed:', notifyErr)
      }
    })()
  }

  return NextResponse.json({ success: true })
}
