import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

/**
 * B2B-32 (docs/specs/B2B-32-requirement-document.md §4 Screen B, AT-8). End-to-end route-level
 * coverage of `POST /api/test-harness/screens`'s image-upload validation — the DB insert/Storage
 * upload must never happen for a file that fails validation.
 */

const state = { inserted: [] as unknown[] }

vi.mock('@/lib/supabase', () => ({
  createSupabaseAdminClient: vi.fn(() => ({
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          order: vi.fn(() => ({ limit: vi.fn(() => ({ maybeSingle: vi.fn(() => Promise.resolve({ data: null })) })) })),
        })),
      })),
      insert: vi.fn((row: unknown) => {
        state.inserted.push(row)
        return { select: vi.fn(() => ({ single: vi.fn(() => Promise.resolve({ data: { id: 'new-screen-id' }, error: null })) })) }
      }),
    })),
  })),
}))

vi.mock('@/lib/test-harness/storage', () => ({
  uploadScreenImage: vi.fn(() => Promise.resolve('some/path.png')),
}))

import { uploadScreenImage } from '@/lib/test-harness/storage'
import { POST } from '@/app/api/test-harness/screens/route'

function multipartRequest(fields: Record<string, string>, file?: { name: string; type: string; bytes: Uint8Array }) {
  const formData = new FormData()
  for (const [key, value] of Object.entries(fields)) formData.set(key, value)
  if (file) {
    formData.set('file', new File([file.bytes as unknown as BlobPart], file.name, { type: file.type }))
  }
  return new NextRequest('https://test.hello-clio.com/api/test-harness/screens', { method: 'POST', body: formData })
}

const REAL_PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0])
const NOT_AN_IMAGE_BYTES = new TextEncoder().encode('#!/bin/sh\necho hi\n')

describe('POST /api/test-harness/screens (image, AT-8)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    state.inserted = []
  })

  it('422s a file whose magic bytes do not match any allowed image type — even with a spoofed image/png Content-Type — and never uploads or inserts', async () => {
    const req = multipartRequest(
      { topic_id: '11111111-1111-1111-1111-111111111111', transition_trigger: 'x' },
      { name: 'fake.png', type: 'image/png', bytes: NOT_AN_IMAGE_BYTES }
    )
    const res = await POST(req)

    expect(res.status).toBe(422)
    expect(uploadScreenImage).not.toHaveBeenCalled()
    expect(state.inserted).toHaveLength(0)
  })

  it('accepts a genuine PNG and uploads + inserts exactly once', async () => {
    const req = multipartRequest(
      { topic_id: '11111111-1111-1111-1111-111111111111', transition_trigger: 'x', title: 'A screen' },
      { name: 'real.png', type: 'image/png', bytes: REAL_PNG_BYTES }
    )
    const res = await POST(req)

    expect(res.status).toBe(201)
    expect(uploadScreenImage).toHaveBeenCalledTimes(1)
    expect(state.inserted).toHaveLength(1)
  })

  it('422s when transition_trigger is missing', async () => {
    const req = multipartRequest({ topic_id: '11111111-1111-1111-1111-111111111111' }, { name: 'real.png', type: 'image/png', bytes: REAL_PNG_BYTES })
    const res = await POST(req)
    expect(res.status).toBe(422)
    expect(uploadScreenImage).not.toHaveBeenCalled()
  })
})
