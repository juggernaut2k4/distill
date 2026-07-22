import { describe, it, expect } from 'vitest'
import { sniffImageMimeType, validateImageUpload, MAX_IMAGE_BYTES } from '@/lib/test-harness/image-validation'

/**
 * B2B-32 (docs/specs/B2B-32-requirement-document.md §0 point 3, AT-8). Magic-byte sniffing — never
 * trusts a client-supplied Content-Type/extension, only the actual file bytes.
 */

const PNG_HEADER = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0])
const JPEG_HEADER = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0])
const GIF_HEADER = Buffer.from('GIF89a\0\0\0\0', 'ascii')
const WEBP_HEADER = Buffer.concat([Buffer.from('RIFF', 'ascii'), Buffer.from([0, 0, 0, 0]), Buffer.from('WEBP', 'ascii')])

describe('sniffImageMimeType', () => {
  it('identifies a real PNG by magic bytes', () => {
    expect(sniffImageMimeType(PNG_HEADER)).toBe('image/png')
  })

  it('identifies a real JPEG by magic bytes', () => {
    expect(sniffImageMimeType(JPEG_HEADER)).toBe('image/jpeg')
  })

  it('identifies a real GIF by magic bytes', () => {
    expect(sniffImageMimeType(GIF_HEADER)).toBe('image/gif')
  })

  it('identifies a real WebP by magic bytes', () => {
    expect(sniffImageMimeType(WEBP_HEADER)).toBe('image/webp')
  })

  it('returns null for a file whose bytes do not match any allowed type, regardless of claimed type', () => {
    const notAnImage = Buffer.from('#!/bin/sh\necho hello\n', 'ascii')
    expect(sniffImageMimeType(notAnImage)).toBeNull()
  })

  it('returns null for an empty buffer', () => {
    expect(sniffImageMimeType(Buffer.alloc(0))).toBeNull()
  })
})

describe('validateImageUpload (AT-8)', () => {
  it('accepts a valid PNG under the size cap', () => {
    const result = validateImageUpload(PNG_HEADER)
    expect(result.ok).toBe(true)
    expect(result.mimeType).toBe('image/png')
  })

  it('rejects a file over 10 MB even if its magic bytes are valid', () => {
    const oversized = Buffer.concat([PNG_HEADER, Buffer.alloc(MAX_IMAGE_BYTES)])
    const result = validateImageUpload(oversized)
    expect(result.ok).toBe(false)
    expect(result.reason).toContain('under 10 MB')
  })

  it('rejects a file whose magic bytes do not match any allowed type, regardless of claimed Content-Type', () => {
    const fakeImage = Buffer.from('this is not actually an image', 'ascii')
    const result = validateImageUpload(fakeImage)
    expect(result.ok).toBe(false)
    expect(result.mimeType).toBeNull()
  })
})
