import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireAuth } from '@/lib/clerk'
import { createSupabaseAdminClient } from '@/lib/supabase'

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
  const { userId, error } = requireAuth()
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
