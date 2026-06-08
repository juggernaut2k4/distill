import { NextRequest, NextResponse } from 'next/server'
import { requireSessionAuth } from '@/lib/session-auth'
import { z } from 'zod'

import { createSupabaseAdminClient } from '@/lib/supabase'

/**
 * GET /api/user/preferences
 * Returns 200 with basic profile data if the user record exists.
 * Returns 404 if no profile — used by the onboarding page to detect new sign-ups.
 */
export async function GET(request: NextRequest) {
  const { userId, error } = await requireSessionAuth(request)
  if (error) return error

  const supabase = createSupabaseAdminClient()
  const { data: user } = await supabase
    .from('users')
    .select('id, role, delivery_preference, plan_tier, plan_approved')
    .eq('id', userId!)
    .single()

  if (!user) return NextResponse.json({ exists: false }, { status: 404 })
  return NextResponse.json({ exists: true, role: user.role, plan_tier: user.plan_tier, plan_approved: user.plan_approved })
}

const PreferencesSchema = z.object({
  deliveryPreference: z.enum(['email', 'sms', 'both']).optional(),
  deliveryPaused: z.boolean().optional(),
  timezone: z.string().optional(),
})

/**
 * PATCH /api/user/preferences
 * Updates user delivery preferences.
 */
export async function PATCH(request: NextRequest) {
  const { userId, error } = await requireSessionAuth(request)
  if (error) return error

  try {
    const body = await request.json()
    const parsed = PreferencesSchema.safeParse(body)

    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Validation failed', details: parsed.error.flatten() },
        { status: 400 }
      )
    }

    const supabase = createSupabaseAdminClient()
    const updates: Record<string, unknown> = {}

    if (parsed.data.deliveryPreference !== undefined) {
      updates.delivery_preference = parsed.data.deliveryPreference
    }
    if (parsed.data.deliveryPaused !== undefined) {
      updates.delivery_paused = parsed.data.deliveryPaused
    }
    if (parsed.data.timezone !== undefined) {
      updates.timezone = parsed.data.timezone
    }

    const { error: updateError } = await supabase
      .from('users')
      .update(updates)
      .eq('id', userId)

    if (updateError) {
      return NextResponse.json({ error: 'Update failed' }, { status: 500 })
    }

    return NextResponse.json({ success: true })
  } catch {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
