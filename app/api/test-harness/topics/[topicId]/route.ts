import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createSupabaseAdminClient } from '@/lib/supabase'
import { deleteScreenImage } from '@/lib/test-harness/storage'

/**
 * GET/PATCH/DELETE /api/test-harness/topics/[topicId]
 *
 * B2B-32 (docs/specs/B2B-32-requirement-document.md §4 Screen B, §6.4). GET returns the topic plus
 * its ordered screens — for `screen_type: 'html'` rows this includes `html_content` (needed to
 * byte-perfectly pre-fill the Screen B "Edit" sub-form, §4 "Editing an existing screen"); image
 * screens never inline bytes (those live in Supabase Storage and are only ever reached via the
 * public render route). PATCH is the topic form's explicit, dirty-state-gated Save action (§0
 * point 9) — never autosave. DELETE removes the topic and cascades its screens (DB-level FK
 * cascade, migration 092) — Storage objects for any image screens are deleted first, since Storage
 * isn't part of the Postgres cascade.
 */

const PatchTopicSchema = z.object({
  title: z.string().max(200).optional().nullable(),
  subtitle: z.string().max(300).optional().nullable(),
  content_to_explain: z.string().max(5000).optional().nullable(),
})

export async function GET(request: NextRequest, { params }: { params: { topicId: string } }) {
  const supabase = createSupabaseAdminClient()

  const { data: topic } = await supabase.from('test_harness_topics').select('*').eq('id', params.topicId).maybeSingle()
  if (!topic) {
    return NextResponse.json({ error: { code: 'not_found', message: 'Topic not found.' } }, { status: 404 })
  }

  const { data: screens } = await supabase
    .from('test_harness_screens')
    .select('id, screen_type, position, title, transition_trigger, html_content, storage_path, image_mime_type, updated_at')
    .eq('topic_id', params.topicId)
    .order('position', { ascending: true })

  return NextResponse.json({
    topic: {
      id: topic.id,
      title: topic.title,
      subtitle: topic.subtitle,
      content_to_explain: topic.content_to_explain,
    },
    screens: (screens ?? []).map((s) => ({
      id: s.id,
      screenType: s.screen_type,
      position: s.position,
      title: s.title,
      transitionTrigger: s.transition_trigger,
      // Only ever non-null for screen_type === 'html' — image bytes are never inlined (§6.4).
      htmlContent: s.html_content,
      hasImage: s.screen_type === 'image' && Boolean(s.storage_path),
    })),
  })
}

export async function PATCH(request: NextRequest, { params }: { params: { topicId: string } }) {
  const body = await request.json().catch(() => null)
  const parsed = PatchTopicSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Validation failed', details: parsed.error.flatten() }, { status: 422 })
  }

  const supabase = createSupabaseAdminClient()
  const { error } = await supabase
    .from('test_harness_topics')
    .update({
      ...(parsed.data.title !== undefined ? { title: parsed.data.title } : {}),
      ...(parsed.data.subtitle !== undefined ? { subtitle: parsed.data.subtitle } : {}),
      ...(parsed.data.content_to_explain !== undefined ? { content_to_explain: parsed.data.content_to_explain } : {}),
    })
    .eq('id', params.topicId)

  if (error) {
    console.error('[test-harness/topics/:id] update failed:', error.message)
    return NextResponse.json({ error: { code: 'internal_error', message: "Couldn't save. Try again." } }, { status: 500 })
  }

  return NextResponse.json({ success: true })
}

export async function DELETE(request: NextRequest, { params }: { params: { topicId: string } }) {
  const supabase = createSupabaseAdminClient()

  const { data: imageScreens } = await supabase
    .from('test_harness_screens')
    .select('storage_path')
    .eq('topic_id', params.topicId)
    .eq('screen_type', 'image')

  for (const row of imageScreens ?? []) {
    const path = row.storage_path as string | null
    if (path) await deleteScreenImage(path)
  }

  const { error } = await supabase.from('test_harness_topics').delete().eq('id', params.topicId)

  if (error) {
    console.error('[test-harness/topics/:id] delete failed:', error.message)
    return NextResponse.json({ error: { code: 'internal_error', message: 'Failed to delete topic.' } }, { status: 500 })
  }

  return NextResponse.json({ success: true })
}
