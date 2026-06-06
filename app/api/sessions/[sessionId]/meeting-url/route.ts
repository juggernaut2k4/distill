import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { currentUser } from '@clerk/nextjs/server'
import { createSupabaseAdminClient } from '@/lib/supabase'

const PatchBodySchema = z.object({
  meetingUrl: z.string().url('Must be a valid URL').max(500),
})

/**
 * PATCH /api/sessions/[sessionId]/meeting-url
 * Updates the meeting_url for a session owned by the authenticated user.
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: { sessionId: string } }
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

  const { data, error } = await supabase
    .from('sessions')
    .update({ meeting_url: parsed.data.meetingUrl })
    .eq('id', params.sessionId)
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
