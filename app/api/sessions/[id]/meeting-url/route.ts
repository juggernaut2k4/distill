import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { currentUser } from '@clerk/nextjs/server'
import { createSupabaseAdminClient } from '@/lib/supabase'

const PatchBodySchema = z.object({
  meetingUrl: z.string().url('Must be a valid URL').max(500),
})

/**
 * PATCH /api/sessions/[id]/meeting-url
 * Updates the meeting_url for a session owned by the authenticated user.
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const user = await currentUser()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = await request.json()
  const parsed = PatchBodySchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Validation failed', details: parsed.error.flatten().fieldErrors },
      { status: 400 }
    )
  }

  const supabase = createSupabaseAdminClient()

  // AUTOGEN-01 §11 Q5 / §3 Part C: /meeting-url requires curriculum_plan.is_approved = true.
  const { data: existing, error: fetchError } = await supabase
    .from('sessions')
    .select('id, curriculum_plan_id')
    .eq('id', params.id)
    .eq('user_id', user.id)
    .single()

  if (fetchError || !existing) {
    return NextResponse.json({ error: 'Session not found' }, { status: 404 })
  }

  if (existing.curriculum_plan_id) {
    const { data: plan } = await supabase
      .from('curriculum_plans')
      .select('is_approved')
      .eq('id', existing.curriculum_plan_id)
      .maybeSingle()

    if (!plan?.is_approved) {
      return NextResponse.json(
        { error: 'This session\'s plan has not been approved yet.' },
        { status: 403 }
      )
    }
  }

  const { data, error } = await supabase
    .from('sessions')
    .update({ meeting_url: parsed.data.meetingUrl })
    .eq('id', params.id)
    .eq('user_id', user.id)
    .select('id')

  if (error) {
    console.error('[meeting-url] Supabase update error:', error)
    return NextResponse.json({ error: 'Failed to save meeting link' }, { status: 500 })
  }

  if (!data || data.length === 0) {
    return NextResponse.json({ error: 'Session not found' }, { status: 404 })
  }

  return NextResponse.json({ success: true })
}
