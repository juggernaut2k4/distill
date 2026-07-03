import { NextRequest, NextResponse } from 'next/server'
import { requireSessionAuth } from '@/lib/session-auth'
import { createSupabaseAdminClient } from '@/lib/supabase'
import { z } from 'zod'

const SchedulingPrefsSchema = z.object({
  selectedDays:    z.array(z.number().int().min(0).max(6)).min(1, 'At least one day required'),
  preferredHour:   z.number().int().min(1).max(12),
  preferredMinute: z.union([z.literal(0), z.literal(15), z.literal(30), z.literal(45)]),
  ampm:            z.enum(['AM', 'PM']),
  // AUTOGEN-01 Part B: duration is fixed at generation time from onboarding data.
  // app/dashboard/schedule-setup/ScheduleSetupClient.tsx no longer collects or sends
  // this field. Kept optional (not removed) because components/dashboard/ScheduleCard.tsx
  // — a separate, out-of-scope settings screen — still reads/writes it via this same route.
  maxDurationMins: z.union([z.literal(15), z.literal(30)]).optional(),
  timezone:        z.string().min(1).max(100),
})

/**
 * POST /api/user/schedule-prefs
 * Saves scheduling preferences for the authenticated user.
 */
export async function POST(request: NextRequest) {
  const { userId, error } = await requireSessionAuth(request)
  if (error) return error

  const body = await request.json()
  const parsed = SchedulingPrefsSchema.safeParse(body)

  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Validation failed', details: parsed.error.flatten() },
      { status: 400 }
    )
  }

  // Validate IANA timezone
  try {
    new Intl.DateTimeFormat(undefined, { timeZone: parsed.data.timezone })
  } catch {
    return NextResponse.json(
      { error: 'Invalid timezone — please reload the page and try again.' },
      { status: 400 }
    )
  }

  const supabase = createSupabaseAdminClient()

  const { error: dbError } = await supabase
    .from('users')
    .update({ scheduling_prefs: parsed.data })
    .eq('id', userId!)

  if (dbError) {
    console.error('[schedule-prefs] Failed to save preferences:', dbError.message)
    return NextResponse.json({ error: 'Failed to save preferences' }, { status: 500 })
  }

  return NextResponse.json({ success: true })
}

/**
 * GET /api/user/schedule-prefs
 * Returns the current scheduling preferences for the authenticated user.
 */
export async function GET(request: NextRequest) {
  const { userId, error } = await requireSessionAuth(request)
  if (error) return error

  const supabase = createSupabaseAdminClient()

  const { data } = await supabase
    .from('users')
    .select('scheduling_prefs')
    .eq('id', userId!)
    .single()

  return NextResponse.json({ schedulingPrefs: data?.scheduling_prefs ?? null })
}
