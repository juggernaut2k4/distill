import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { createSupabaseAdminClient } from '@/lib/supabase'
import { OnboardingSchema, saveOnboardingProfile } from '@/lib/onboarding'

/**
 * GET /api/onboarding
 * Returns { hasProfile: boolean } — used by the onboarding page to detect
 * returning users and redirect them to /dashboard immediately.
 */
export async function GET() {
  const { userId } = auth()
  if (!userId) {
    return NextResponse.json({ hasProfile: false })
  }
  const supabase = createSupabaseAdminClient()
  const { data } = await supabase
    .from('users')
    .select('id, role')
    .eq('id', userId)
    .maybeSingle()
  // A row with a non-null role means onboarding was completed
  const hasProfile = !!(data?.role)
  return NextResponse.json({ hasProfile })
}

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

    const result = await saveOnboardingProfile(userId, parsed.data)

    if (!result.success) {
      return NextResponse.json({ error: result.error }, { status: 500 })
    }

    return NextResponse.json({
      success: true,
      userId: result.userId,
      planPreview: result.planPreview,
      twilioNumber: result.twilioNumber,
    })
  } catch (err) {
    console.error('[onboarding] Unexpected error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
