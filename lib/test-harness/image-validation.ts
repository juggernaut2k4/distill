/**
 * B2B-32 (docs/specs/B2B-32-requirement-document.md §0 point 3, AT-8).
 *
 * Server-side image validation for uploaded screens — sniffs the actual file's magic bytes rather
 * than trusting the client-supplied `Content-Type` header alone. Matches B2B-19's own
 * `safeFetchPartnerPage` image-size ceiling (`lib/partner/ssrf.ts` `MAX_IMAGE_BYTES`) — no point
 * accepting an upload the real fetch pipeline would reject anyway.
 */

export const MAX_IMAGE_BYTES = 10 * 1024 * 1024 // 10 MB — matches lib/partner/ssrf.ts MAX_IMAGE_BYTES
export const MAX_HTML_BYTES = 500_000 // 500 KB — §0 point 3

export const ALLOWED_IMAGE_MIME_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'] as const
export type AllowedImageMimeType = (typeof ALLOWED_IMAGE_MIME_TYPES)[number]

const EXTENSION_BY_MIME: Record<AllowedImageMimeType, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
}

/** Maps a sniffed mime type to a Storage object file extension. */
export function extensionForMimeType(mimeType: AllowedImageMimeType): string {
  return EXTENSION_BY_MIME[mimeType]
}

/**
 * Sniffs a buffer's actual image type by magic bytes. Returns null if it doesn't match any of the
 * four allowed types, regardless of what the client claimed. Never throws.
 */
export function sniffImageMimeType(buffer: Buffer): AllowedImageMimeType | null {
  if (buffer.length >= 8 && buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47 && buffer[4] === 0x0d && buffer[5] === 0x0a && buffer[6] === 0x1a && buffer[7] === 0x0a) {
    return 'image/png'
  }
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return 'image/jpeg'
  }
  if (buffer.length >= 6) {
    const header = buffer.subarray(0, 6).toString('ascii')
    if (header === 'GIF87a' || header === 'GIF89a') return 'image/gif'
  }
  if (buffer.length >= 12) {
    const riff = buffer.subarray(0, 4).toString('ascii')
    const webp = buffer.subarray(8, 12).toString('ascii')
    if (riff === 'RIFF' && webp === 'WEBP') return 'image/webp'
  }
  return null
}

export interface ImageValidationResult {
  ok: boolean
  mimeType: AllowedImageMimeType | null
  reason?: string
}

/** Combined size + magic-byte validation (AT-8) — used by both the create and edit-replace paths. */
export function validateImageUpload(buffer: Buffer): ImageValidationResult {
  if (buffer.byteLength > MAX_IMAGE_BYTES) {
    return { ok: false, mimeType: null, reason: 'File must be PNG, JPEG, GIF, or WebP, under 10 MB.' }
  }
  const mimeType = sniffImageMimeType(buffer)
  if (!mimeType) {
    return { ok: false, mimeType: null, reason: 'File must be PNG, JPEG, GIF, or WebP, under 10 MB.' }
  }
  return { ok: true, mimeType }
}
