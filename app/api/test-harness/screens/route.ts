import crypto from 'crypto'
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createSupabaseAdminClient } from '@/lib/supabase'
import { nextScreenPosition } from '@/lib/test-harness/data'
import { validateImageUpload, MAX_HTML_BYTES } from '@/lib/test-harness/image-validation'
import { uploadScreenImage } from '@/lib/test-harness/storage'

/**
 * POST /api/test-harness/screens
 *
 * B2B-32 (docs/specs/B2B-32-requirement-document.md §4 Screen B "Add a screen", §6.4, AT-8).
 * `screen_type: 'html'` is a JSON body; `screen_type: 'image'` is `multipart/form-data`. `position`
 * is set to `max(existing positions for this topic) + 1`.
 */

const HtmlScreenSchema = z.object({
  topic_id: z.string().uuid(),
  screen_type: z.literal('html'),
  title: z.string().max(200).optional(),
  transition_trigger: z.string().min(1).max(500),
  html_content: z.string().min(1).max(MAX_HTML_BYTES),
})

export async function POST(request: NextRequest) {
  const contentType = request.headers.get('content-type') ?? ''

  if (contentType.includes('multipart/form-data')) {
    return handleImageScreenCreate(request)
  }
  return handleHtmlScreenCreate(request)
}

async function handleHtmlScreenCreate(request: NextRequest) {
  const body = await request.json().catch(() => null)
  const parsed = HtmlScreenSchema.safeParse(body)
  if (!parsed.success) {
    if (
      typeof (body as { html_content?: unknown } | null)?.html_content === 'string' &&
      ((body as { html_content: string }).html_content.length > MAX_HTML_BYTES)
    ) {
      return NextResponse.json({ error: { code: 'html_too_large', message: 'HTML is too large (max 500 KB).' } }, { status: 422 })
    }
    return NextResponse.json({ error: 'Validation failed', details: parsed.error.flatten() }, { status: 422 })
  }

  const supabase = createSupabaseAdminClient()
  const position = await nextScreenPosition(parsed.data.topic_id)

  const { data: inserted, error } = await supabase
    .from('test_harness_screens')
    .insert({
      topic_id: parsed.data.topic_id,
      screen_type: 'html',
      position,
      title: parsed.data.title ?? null,
      transition_trigger: parsed.data.transition_trigger,
      html_content: parsed.data.html_content,
    })
    .select('id')
    .single()

  if (error || !inserted) {
    console.error('[test-harness/screens] html create failed:', error?.message)
    return NextResponse.json({ error: { code: 'internal_error', message: 'Failed to add screen.' } }, { status: 500 })
  }

  return NextResponse.json({ id: inserted.id as string }, { status: 201 })
}

async function handleImageScreenCreate(request: NextRequest) {
  const form = await request.formData().catch(() => null)
  if (!form) {
    return NextResponse.json({ error: { code: 'invalid_form', message: 'Malformed upload.' } }, { status: 422 })
  }

  const topicId = form.get('topic_id')
  const transitionTrigger = form.get('transition_trigger')
  const title = form.get('title')
  const file = form.get('file')

  if (typeof topicId !== 'string' || !z.string().uuid().safeParse(topicId).success) {
    return NextResponse.json({ error: { code: 'validation_failed', message: 'Invalid topic_id.' } }, { status: 422 })
  }
  if (typeof transitionTrigger !== 'string' || transitionTrigger.length === 0 || transitionTrigger.length > 500) {
    return NextResponse.json({ error: { code: 'validation_failed', message: 'transition_trigger is required.' } }, { status: 422 })
  }
  if (!(file instanceof File)) {
    return NextResponse.json({ error: { code: 'validation_failed', message: 'File must be PNG, JPEG, GIF, or WebP, under 10 MB.' } }, { status: 422 })
  }

  const buffer = Buffer.from(await file.arrayBuffer())
  const validation = validateImageUpload(buffer)
  if (!validation.ok || !validation.mimeType) {
    return NextResponse.json({ error: { code: 'invalid_image', message: validation.reason } }, { status: 422 })
  }

  const screenId = crypto.randomUUID()
  let storagePath: string
  try {
    storagePath = await uploadScreenImage(screenId, buffer, validation.mimeType)
  } catch (err) {
    console.error('[test-harness/screens] image upload failed:', err instanceof Error ? err.message : err)
    return NextResponse.json({ error: { code: 'internal_error', message: 'Failed to upload image.' } }, { status: 500 })
  }

  const supabase = createSupabaseAdminClient()
  const position = await nextScreenPosition(topicId)

  const { data: inserted, error } = await supabase
    .from('test_harness_screens')
    .insert({
      id: screenId,
      topic_id: topicId,
      screen_type: 'image',
      position,
      title: typeof title === 'string' && title.length > 0 ? title : null,
      transition_trigger: transitionTrigger,
      storage_path: storagePath,
      image_mime_type: validation.mimeType,
    })
    .select('id')
    .single()

  if (error || !inserted) {
    console.error('[test-harness/screens] image create failed:', error?.message)
    return NextResponse.json({ error: { code: 'internal_error', message: 'Failed to add screen.' } }, { status: 500 })
  }

  return NextResponse.json({ id: inserted.id as string }, { status: 201 })
}
