import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { auth, clerkClient } from '@clerk/nextjs/server'
import { createSupabaseAdminClient } from '@/lib/supabase'
import { getUserContentPlan } from '@/lib/content/personalizer'
import { assignPhoneNumber } from '@/lib/delivery/sms'
import { normaliseMaturity } from '@/lib/curriculum/planner'

const OnboardingSchema = z.object({
  role: z.string().min(1, 'Role is required'),
  roleLevel: z.enum(['c-suite', 'vp-dir', 'vp-technology', 'vp-product', 'manager', 'specialist']).default('c-suite'),
  industry: z.string().default(''),
  aiMaturity: z.enum([
    // UI values (current onboarding page)
    'observer', 'emerging', 'practitioner', 'leader',
    // Legacy API values (kept for backwards compat)
    'evaluator', 'pilot', 'scaler', 'beginner', 'intermediate', 'advanced', 'expert',
    'no experience', 'some experience', 'somewhat experience',
  ]).default('observer'),
  worry: z.string().default(''),
  deliveryPreference: z.enum(['email', 'sms', 'both']).default('email'),
  timezone: z.string().default('America/New_York'),
  email: z.string().email().optional(),
  phone: z.string().optional(),
  plan: z.enum(['free', 'starter', 'pro', 'executive']).default('starter'),
  // Multi-domain fields
  domains: z.array(z.string()).default([]),
  customDomains: z.array(z.string()).default([]),
  primaryDomain: z.string().default('ai-ml'),
  domainProficiency: z.record(z.string(), z.string()).default({}),
  learningGoal: z.string().default('steady_progress'),
  subDomain: z.string().min(1).max(100).optional(),
})

/**
 * POST /api/onboarding
 * Saves user profile, generates initial learning plan, assigns Twilio number.
 */
export async function POST(request: NextRequest) {
  try {
    // Try cookie-based auth first, then fall back to Bearer token.
    // Bearer token path handles the __client_uat=0 case that occurs
    // immediately after OAuth sign-up before the cookie is fully set.
    let userId = auth().userId

    if (!userId) {
      const authHeader = request.headers.get('Authorization')
      if (authHeader?.startsWith('Bearer ')) {
        const { verifyToken } = await import('@clerk/nextjs/server')
        try {
          const payload = await verifyToken(authHeader.slice(7), {
            secretKey: process.env.CLERK_SECRET_KEY!,
          })
          userId = payload.sub ?? null
        } catch {
          // Token invalid — fall through to 401
        }
      }
    }

    if (!userId) {
      return NextResponse.json(
        { error: 'session_not_ready', message: 'Authentication session not yet available. Please retry.' },
        { status: 401 }
      )
    }

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
      userId
    ) {
      twilioNumber = assignPhoneNumber(userId ?? 'anon', data.plan)
    }

    // Fetch email + phone from Clerk so they're always captured,
    // regardless of whether the onboarding form includes them.
    let clerkEmail: string | null = data.email ?? null
    let clerkPhone: string | null = data.phone ?? null
    try {
      const clerkUser = await clerkClient().users.getUser(userId)
      const primaryEmailId = clerkUser.primaryEmailAddressId
      const primaryPhoneId = clerkUser.primaryPhoneNumberId
      clerkEmail =
        clerkUser.emailAddresses.find((e) => e.id === primaryEmailId)?.emailAddress ?? clerkEmail
      clerkPhone =
        clerkUser.phoneNumbers?.find((p) => p.id === primaryPhoneId)?.phoneNumber ?? clerkPhone
    } catch (err) {
      console.error('[onboarding] Failed to fetch Clerk user for email/phone:', err)
    }

    const supabase = createSupabaseAdminClient()

    // Normalise to canonical DB value before saving (CURR-01)
    const canonicalMaturity = normaliseMaturity(data.aiMaturity)

    // Upsert user record
    const userRecord = {
      id: userId ?? `anon_${Date.now()}`,
      email: clerkEmail,
      phone: clerkPhone,
      role: data.role,
      role_level: data.roleLevel,
      industry: data.industry,
      ai_maturity: canonicalMaturity,
      worry_tags: data.worry ? [data.worry] : [],
      delivery_preference: data.deliveryPreference,
      timezone: data.timezone,
      plan_tier: data.plan,
      twilio_number_assigned: twilioNumber,
      needs_recalibration: false,
      streak_days: 0,
      ai_readiness_score: 0,
      // Multi-domain fields
      domains: data.domains,
      custom_domains: data.customDomains,
      primary_domain: data.primaryDomain,
      domain_proficiency: data.domainProficiency,
      learning_goal: data.learningGoal,
      sub_domain: data.subDomain ?? null,
    }

    console.log('[onboarding] upsert — role:', data.role, '| roleLevel:', data.roleLevel, '| industry:', data.industry, '| aiMaturity:', data.aiMaturity, '→', canonicalMaturity)

    const { error: upsertError } = await supabase
      .from('users')
      .upsert(userRecord, { onConflict: 'id' })

    if (upsertError) {
      console.error('[onboarding] Supabase upsert error:', upsertError.message)
      return NextResponse.json(
        { error: 'Failed to save profile' },
        { status: 500 }
      )
    }

    // Bootstrap user_learning_profiles row from onboarding signals.
    // Sets the minimum viable profile before session 1 (profile_confidence = 'low').
    // Infer business_focus_lens from the worry field; all other dims use defaults.
    const inferredLens = (() => {
      const w = data.worry.toLowerCase()
      if (w.includes('cost') || w.includes('budget') || w.includes('saving')) return 'cost_reduction'
      if (w.includes('risk') || w.includes('compliance') || w.includes('regulation')) return 'risk_compliance'
      if (w.includes('team') || w.includes('staff') || w.includes('people')) return 'team_enablement'
      if (w.includes('compet') || w.includes('market')) return 'competitive_edge'
      if (w.includes('productiv') || w.includes('efficiency')) return 'productivity'
      return 'capability_building'
    })()

    await supabase
      .from('user_learning_profiles')
      .upsert(
        {
          user_id: userId,
          domains_active: data.domains,
          per_domain_levels: data.domainProficiency,
          overall_goal: data.learningGoal,
          business_focus_lens: inferredLens,
          profile_confidence: 'low',
          sessions_used_for_profile: 0,
        },
        { onConflict: 'user_id', ignoreDuplicates: false }
      )

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
