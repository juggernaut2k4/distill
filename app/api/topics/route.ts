import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireAuth } from '@/lib/clerk'
import { createSupabaseAdminClient } from '@/lib/supabase'
import { sendPlanReadyEmail, type User as EmailUser } from '@/lib/delivery/email'
import { sendSMS } from '@/lib/delivery/sms'

const ProfileSchema = z.object({
  role: z.string().optional(),
  domains: z.array(z.string()).optional(),
  primaryDomain: z.string().optional(),
  domainProficiency: z.record(z.string(), z.string()).optional(),
  learningGoal: z.string().optional(),
}).optional()

const TopicsSchema = z.object({
  topics: z.array(z.string().min(1).max(200)).min(0).max(50),
  profile: ProfileSchema,
})

/**
 * POST /api/topics
 * Saves user topic interests and triggers curriculum plan generation.
 * Awaits notifications before returning — Vercel kills fire-and-forget on response.
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

  const profileUpdate = parsed.data.profile
    ? {
        role: parsed.data.profile.role,
        domains: parsed.data.profile.domains,
        primary_domain: parsed.data.profile.primaryDomain,
        domain_proficiency: parsed.data.profile.domainProficiency,
        learning_goal: parsed.data.profile.learningGoal,
      }
    : {}

  const { error: updateError } = await supabase
    .from('users')
    .update({
      topic_interests: parsed.data.topics,
      needs_recalibration: false,
      plan_approved: false,
      ...profileUpdate,
    })
    .eq('id', userId!)

  if (!updateError) {
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

      const sends: Promise<unknown>[] = []

      if (user?.email) {
        sends.push(sendPlanReadyEmail(user as EmailUser).catch(console.error))
      }

      const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'https://hello-clio.com'
      if (user?.phone && user.twilio_number_assigned) {
        sends.push(
          sendSMS(
            user.phone as string,
            user.twilio_number_assigned as string,
            `Your Clio learning plan is ready! Review and approve it here: ${appUrl}/dashboard/plan — Clio`
          ).catch(console.error)
        )
      }

      await Promise.all(sends)
    } catch (notifyErr) {
      console.error('[topics] Plan-ready notification failed:', notifyErr)
    }
  }

  return NextResponse.json({ success: true })
}
