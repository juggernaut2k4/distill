import { NextRequest, NextResponse } from 'next/server'
import { requireSessionAuth } from '@/lib/session-auth'

import { createPortalSession } from '@/lib/stripe'
import { createSupabaseAdminClient } from '@/lib/supabase'

/**
 * POST /api/portal
 * Creates a Stripe Customer Portal session for billing management.
 * Requires authentication via Clerk.
 */
export async function POST(request: NextRequest) {
  const { userId, error } = await requireSessionAuth(request)
  if (error) return error

  try {
    const supabase = createSupabaseAdminClient()

    const { data: user } = await supabase
      .from('users')
      .select('stripe_customer_id')
      .eq('id', userId)
      .single()

    if (!user?.stripe_customer_id) {
      return NextResponse.json(
        { error: 'No billing account found' },
        { status: 404 }
      )
    }

    const portalUrl = await createPortalSession(user.stripe_customer_id)

    return NextResponse.json({ portalUrl })
  } catch (err) {
    console.error('[portal] Error:', err)
    return NextResponse.json({ error: 'Failed to create portal session' }, { status: 500 })
  }
}
