import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createSupabaseAdminClient } from '@/lib/supabase'
import { getScreen } from '@/lib/test-harness/data'
import { validateImageUpload, MAX_HTML_BYTES } from '@/lib/test-harness/image-validation'
import { uploadScreenImage, deleteScreenImage } from '@/lib/test-harness/storage'

/**
 * PATCH/DELETE /api/test-harness/screens/[screenId]
 *
 * B2B-32 (docs/specs/B2B-32-requirement-document.md §4 Screen B, §6.4). PATCH handles three shapes:
 * a reorder (`{ position }` alone, from the ↑/↓ controls), an HTML screen's explicit Save
 * (`{ title, transition_trigger, html_content }`), and an image screen's explicit Save
 * (`{ title, transition_trigger }` as JSON, or the same plus an optional replacement `file` as
 * `multipart/form-data`, which replaces the stored Storage object). DELETE removes the row and, for
 * image screens, the Storage object.
 */

const PatchScreenJsonSchema = z.object({
  position: z.number().int().min(1).optional(),
  title: z.string().max(200).optional().nullable(),
  transition_trigger: z.string().min(1).max(500).optional(),
  html_content: z.string().min(1).max(MAX_HTML_BYTES).optional(),
})

export async function PATCH(request: NextRequest, { params }: { params: { screenId: string } }) {
  const contentType = request.headers.get('content-type') ?? ''

  const screen = await getScreen(params.screenId)
  if (!screen) {
    return NextResponse.json({ error: { code: 'not_found', message: 'Screen not found.' } }, { status: 404 })
  }

  if (contentType.includes('multipart/form-data')) {
    return handleImageScreenPatch(request, params.screenId)
  }
  return handleJsonPatch(request, params.screenId)
}

async function handleJsonPatch(request: NextRequest, screenId: string) {
  const body = await request.json().catch(() => null)
  const parsed = PatchScreenJsonSchema.safeParse(body)
  if (!parsed.success) {
    if (
      typeof (body as { html_content?: unknown } | null)?.html_content === 'string' &&
      (body as { html_content: string }).html_content.length > MAX_HTML_BYTES
    ) {
      return NextResponse.json({ error: { code: 'html_too_large', message: 'HTML is too large (max 500 KB).' } }, { status: 422 })
    }
    return NextResponse.json({ error: 'Validation failed', details: parsed.error.flatten() }, { status: 422 })
  }

  const update: Record<string, unknown> = {}
  if (parsed.data.position !== undefined) update.position = parsed.data.position
  if (parsed.data.title !== undefined) update.title = parsed.data.title
  if (parsed.data.transition_trigger !== undefined) update.transition_trigger = parsed.data.transition_trigger
  if (parsed.data.html_content !== undefined) update.html_content = parsed.data.html_content

  const supabase = createSupabaseAdminClient()
  const { error } = await supabase.from('test_harness_screens').update(update).eq('id', screenId)

  if (error) {
    console.error('[test-harness/screens/:id] update failed:', error.message)
    return NextResponse.json({ error: { code: 'internal_error', message: "Couldn't save. Try again." } }, { status: 500 })
  }

  return NextResponse.json({ success: true })
}

async function handleImageScreenPatch(request: NextRequest, screenId: string) {
  const form = await request.formData().catch(() => null)
  if (!form) {
    return NextResponse.json({ error: { code: 'invalid_form', message: 'Malformed upload.' } }, { status: 422 })
  }

  const title = form.get('title')
  const transitionTrigger = form.get('transition_trigger')
  const file = form.get('file')

  const update: Record<string, unknown> = {}
  if (typeof title === 'string') update.title = title.length > 0 ? title : null
  if (typeof transitionTrigger === 'string') {
    if (transitionTrigger.length === 0 || transitionTrigger.length > 500) {
      return NextResponse.json({ error: { code: 'validation_failed', message: 'transition_trigger is required.' } }, { status: 422 })
    }
    update.transition_trigger = transitionTrigger
  }

  if (file instanceof File) {
    const buffer = Buffer.from(await file.arrayBuffer())
    const validation = validateImageUpload(buffer)
    if (!validation.ok || !validation.mimeType) {
      return NextResponse.json({ error: { code: 'invalid_image', message: validation.reason } }, { status: 422 })
    }
    try {
      const storagePath = await uploadScreenImage(screenId, buffer, validation.mimeType)
      update.storage_path = storagePath
      update.image_mime_type = validation.mimeType
    } catch (err) {
      console.error('[test-harness/screens/:id] image replace failed:', err instanceof Error ? err.message : err)
      return NextResponse.json({ error: { code: 'internal_error', message: 'Failed to upload image.' } }, { status: 500 })
    }
  }

  const supabase = createSupabaseAdminClient()
  const { error } = await supabase.from('test_harness_screens').update(update).eq('id', screenId)

  if (error) {
    console.error('[test-harness/screens/:id] image update failed:', error.message)
    return NextResponse.json({ error: { code: 'internal_error', message: "Couldn't save. Try again." } }, { status: 500 })
  }

  return NextResponse.json({ success: true })
}

export async function DELETE(request: NextRequest, { params }: { params: { screenId: string } }) {
  const screen = await getScreen(params.screenId)
  if (!screen) {
    return NextResponse.json({ error: { code: 'not_found', message: 'Screen not found.' } }, { status: 404 })
  }

  if (screen.screen_type === 'image' && screen.storage_path) {
    await deleteScreenImage(screen.storage_path)
  }

  const supabase = createSupabaseAdminClient()
  const { error } = await supabase.from('test_harness_screens').delete().eq('id', params.screenId)

  if (error) {
    console.error('[test-harness/screens/:id] delete failed:', error.message)
    return NextResponse.json({ error: { code: 'internal_error', message: 'Failed to delete screen.' } }, { status: 500 })
  }

  return NextResponse.json({ success: true })
}
