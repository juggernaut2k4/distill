import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireAuth } from '@/lib/clerk'
import { createSupabaseAdminClient } from '@/lib/supabase'

/**
 * POST /api/admin/glitches/issues/:id/notes
 *
 * B2B-17 Requirement Doc §4.E.3 / §6.6 — append an investigation note. Insert-only: there is no
 * update or delete route by design, so the investigation trail is immutable. Clerk-authenticated only.
 */

const NoteSchema = z.object({
  body: z.string().trim().min(1).max(5000),
})

export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  const { userId, error } = requireAuth()
  if (error) return error

  let payload: unknown
  try {
    payload = await request.json()
  } catch {
    return NextResponse.json({ error: 'Validation failed', details: 'Invalid JSON body' }, { status: 400 })
  }

  const parsed = NoteSchema.safeParse(payload)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Validation failed', details: parsed.error.flatten() }, { status: 400 })
  }

  const supabase = createSupabaseAdminClient()

  // Confirm the issue exists so a note can never dangle (FK would reject it anyway; this returns a
  // clean 404 instead of a 500).
  const { data: issue, error: issueError } = await supabase
    .from('glitch_issues')
    .select('id')
    .eq('id', params.id)
    .maybeSingle()

  if (issueError) {
    console.error('[admin/glitches/issues/:id/notes] Failed to verify issue:', issueError.message)
    return NextResponse.json({ error: "Couldn't add the note." }, { status: 500 })
  }
  if (!issue) {
    return NextResponse.json({ error: 'Issue not found.' }, { status: 404 })
  }

  const { data: note, error: insertError } = await supabase
    .from('glitch_issue_notes')
    .insert({ issue_id: params.id, body: parsed.data.body, author_clerk_user_id: userId })
    .select('id, body, author_clerk_user_id, created_at')
    .single()

  if (insertError || !note) {
    console.error('[admin/glitches/issues/:id/notes] Failed to insert note:', insertError?.message)
    return NextResponse.json({ error: "Couldn't add the note." }, { status: 500 })
  }

  return NextResponse.json({ note }, { status: 201 })
}
