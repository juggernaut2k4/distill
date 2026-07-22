import { createSupabaseAdminClient } from '@/lib/supabase'
import { extensionForMimeType, type AllowedImageMimeType } from './image-validation'

/**
 * B2B-32 (docs/specs/B2B-32-requirement-document.md §0 point 3).
 *
 * Supabase Storage access for uploaded image screens — a new private bucket, `test-harness-screens`
 * (service-role access only, no public bucket policy, see migration 092). The bucket is never
 * exposed as a public/signed URL — the render route (`app/test-harness-render/[screenId]/route.ts`)
 * downloads bytes server-side via the admin client and streams them back with the correct
 * `Content-Type`, keeping "one URL format, one auth boundary" for every screen type.
 */

const BUCKET = 'test-harness-screens'

/** Uploads an image screen's bytes, keyed by the screen's own id (`${screenId}.${extension}`). */
export async function uploadScreenImage(screenId: string, buffer: Buffer, mimeType: AllowedImageMimeType): Promise<string> {
  const supabase = createSupabaseAdminClient()
  const path = `${screenId}.${extensionForMimeType(mimeType)}`
  const { error } = await supabase.storage.from(BUCKET).upload(path, buffer, { contentType: mimeType, upsert: true })
  if (error) {
    throw new Error(`Failed to upload screen image: ${error.message}`)
  }
  return path
}

/** Downloads an image screen's bytes for the public render route. Returns null on any failure — never throws. */
export async function downloadScreenImage(storagePath: string): Promise<Buffer | null> {
  const supabase = createSupabaseAdminClient()
  const { data, error } = await supabase.storage.from(BUCKET).download(storagePath)
  if (error || !data) return null
  try {
    const arrayBuffer = await data.arrayBuffer()
    return Buffer.from(arrayBuffer)
  } catch {
    return null
  }
}

/** Removes an image screen's Storage object (called on screen delete / image replace / topic delete). */
export async function deleteScreenImage(storagePath: string): Promise<void> {
  const supabase = createSupabaseAdminClient()
  await supabase.storage.from(BUCKET).remove([storagePath])
}
