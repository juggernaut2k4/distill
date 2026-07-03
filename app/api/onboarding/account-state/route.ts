import { NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { createSupabaseAdminClient } from '@/lib/supabase'

export type AccountState = 'no_account' | 'started_no_signup' | 'signed_up_unpaid' | 'active_paying'

interface AccountStateResponse {
  state: AccountState
  resumeUrl?: string
  email?: string
}

/**
 * GET /api/onboarding/account-state
 *
 * Classifies the caller into one of four account states (AUTH-02 Section 4.2)
 * so /onboarding can decide whether to render the question flow, resume the
 * user mid-signup, or show the "already signed in" interstitial.
 *
 * Auth is optional. Unauthenticated callers always get `no_account` — the
 * `started_no_signup` state (localStorage-driven) is determined entirely
 * client-side and never reaches this endpoint (see spec Section 7/12).
 *
 * CRITICAL: "paying customer" is defined ONLY as
 * `subscription_status IN ('active', 'trialing')` — the same check already
 * used by app/dashboard/layout.tsx. `plan_approved` is an unrelated
 * curriculum-approval flag (SCH-01) and must never be used here (spec
 * Section 4.1). Using it would misclassify paying customers who haven't yet
 * approved their curriculum as unpaid.
 */
export async function GET() {
  const { userId } = auth()

  if (!userId) {
    // Unauthenticated caller: state (a) "no account" from the server's point of
    // view. The client determines "started, never signed up" (state b) itself
    // from localStorage — that never requires a server round-trip.
    const response: AccountStateResponse = { state: 'no_account' }
    return NextResponse.json(response)
  }

  const supabase = createSupabaseAdminClient()
  const { data: user } = await supabase
    .from('users')
    .select('role, subscription_status, topic_interests, curriculum_plan')
    .eq('id', userId)
    .maybeSingle()

  const isPaying =
    user?.subscription_status === 'active' || user?.subscription_status === 'trialing'

  // State (d): fully active, paying customer.
  if (user?.role && isPaying) {
    const response: AccountStateResponse = { state: 'active_paying' }
    return NextResponse.json(response)
  }

  // State (c): signed up, never completed payment (includes the "role is null,
  // nothing to resume" sub-case per spec Section 4.2's note — that falls out
  // naturally below as resumeUrl '/onboarding').
  if (!user?.role) {
    // No profile saved at all — nothing to resume from. Treat as a fresh start.
    const response: AccountStateResponse = { state: 'signed_up_unpaid', resumeUrl: '/onboarding' }
    return NextResponse.json(response)
  }

  // Profile exists but not paying — resolve "where they left off" per Section 4.4.
  // Precedence: /topics takes priority over /plan, which takes priority over /checkout.
  const topicInterests = Array.isArray(user.topic_interests) ? user.topic_interests : []
  const hasTopics = topicInterests.length > 0
  const hasCurriculumPlan = user.curriculum_plan != null

  let resumeUrl: string
  if (!hasTopics) {
    resumeUrl = '/topics'
  } else if (!hasCurriculumPlan) {
    resumeUrl = '/plan'
  } else {
    resumeUrl = '/checkout'
  }

  const response: AccountStateResponse = { state: 'signed_up_unpaid', resumeUrl }
  return NextResponse.json(response)
}
