import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { auth } from '@clerk/nextjs/server'
import { createSupabaseAdminClient } from '@/lib/supabase'
import { getUserContentPlan } from '@/lib/content/personalizer'
import { assignPhoneNumber } from '@/lib/delivery/sms'

const OnboardingSchema = z.object({
  role: z.string().min(1, 'Role is required'),
  industry: z.string().min(1, 'Industry is required'),
  aiMaturity: z.enum(['observer', 'evaluator', 'pilot', 'scaler']),
  worry: z.string().min(1, 'Worry is required'),
  deliveryPreference: z.enum(['email', 'sms', 'both']),
  timezone: z.string().default('America/New_York'),
  email: z.string().email().optional(),
  phone: z.string().optional(),
  plan: z.enum(['free', 'starter', 'pro', 'executive']).default('free'),
})

/**
 * POST /api/onboarding
 * Saves user profile, generates initial learning plan, assigns Twilio number.
 */
export async function POST(request: NextRequest) {
  try {
    const { userId } = auth()

    const body = await request.json()
    const parsed = OnboardingSchema.safeParse(body)

    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Validation failed', details: parsed.error.flatten() },
        { status: 400 }
      )
    }

    const data = parsed.data

    // Assign Twilio phone number if plan supports SMS
    let twilioNumber: string | null = null
    if (
      data.deliveryPreference !== 'email' &&
      data.plan !== 'free' &&
      userId
    ) {
      twilioNumber = assignPhoneNumber(userId ?? 'anon', data.plan)
    }

    const supabase = createSupabaseAdminClient()

    // Upsert user record
    const userRecord = {
      id: userId ?? `anon_${Date.now()}`,
      email: data.email ?? null,
      phone: data.phone ?? null,
      role: data.role,
      industry: data.industry,
      ai_maturity: data.aiMaturity,
      worry_tags: [data.worry],
      delivery_preference: data.deliveryPreference,
      timezone: data.timezone,
      plan_tier: data.plan,
      twilio_number_assigned: twilioNumber,
      onboarded_at: new Date().toISOString(),
      needs_recalibration: false,
      streak_days: 0,
      ai_readiness_score: 0,
    }

    const { error: upsertError } = await supabase
      .from('users')
      .upsert(userRecord)

    if (upsertError) {
      console.error('[onboarding] Supabase upsert error:', upsertError.message)
      return NextResponse.json(
        { error: 'Failed to save profile' },
        { status: 500 }
      )
    }

    // Generate initial learning plan preview (stub if DB empty)
    let planPreview: string | null = null
    try {
      if (userId) {
        const plan = await getUserContentPlan(userId)
        planPreview = plan.emailContent.substring(0, 120) + '...'
      }
    } catch {
      // Non-fatal — plan preview is optional on first onboarding
      planPreview = null
    }

    return NextResponse.json({
      success: true,
      userId: userRecord.id,
      planPreview,
      twilioNumber,
    })
  } catch (err) {
    console.error('[onboarding] Unexpected error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
