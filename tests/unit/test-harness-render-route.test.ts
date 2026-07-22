import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

/**
 * B2B-32 (docs/specs/B2B-32-requirement-document.md §0 point 2/6, AT-3, AT-4, AT-5). Covers
 * `GET /test-harness-render/[screenId]` — must serve exactly what's stored (or a minimal wrap for a
 * bare fragment), with the correct Content-Type, and the sandboxing CSP header on every HTML
 * response (AT-4's second isolation layer, §0 point 6).
 */

vi.mock('@/lib/test-harness/data', () => ({ getScreen: vi.fn() }))
vi.mock('@/lib/test-harness/storage', () => ({ downloadScreenImage: vi.fn() }))

import { getScreen } from '@/lib/test-harness/data'
import { downloadScreenImage } from '@/lib/test-harness/storage'
import { GET } from '@/app/test-harness-render/[screenId]/route'

const VALID_UUID = '11111111-1111-1111-1111-111111111111'

function req() {
  return new NextRequest(`https://hello-clio.com/test-harness-render/${VALID_UUID}`)
}

describe('GET /test-harness-render/[screenId]', () => {
  beforeEach(() => vi.clearAllMocks())

  it('404s a malformed (non-UUID) screenId without querying the database', async () => {
    const res = await GET(req(), { params: { screenId: 'not-a-uuid' } })
    expect(res.status).toBe(404)
    expect(getScreen).not.toHaveBeenCalled()
  })

  it('404s when no matching screen row exists', async () => {
    ;(getScreen as ReturnType<typeof vi.fn>).mockResolvedValue(null)
    const res = await GET(req(), { params: { screenId: VALID_UUID } })
    expect(res.status).toBe(404)
  })

  it('AT-4: serves a full HTML document byte-identical, with the sandbox CSP header', async () => {
    const fullDoc = '<!doctype html><html><body>hello</body></html>'
    ;(getScreen as ReturnType<typeof vi.fn>).mockResolvedValue({ screen_type: 'html', html_content: fullDoc })

    const res = await GET(req(), { params: { screenId: VALID_UUID } })
    const text = await res.text()

    expect(res.status).toBe(200)
    expect(text).toBe(fullDoc)
    expect(res.headers.get('Content-Type')).toContain('text/html')
    expect(res.headers.get('Content-Security-Policy')).toBe('sandbox allow-scripts')
  })

  it('AT-4: wraps a bare HTML fragment in a minimal document shell', async () => {
    const fragment = '<div>Where we are today</div>'
    ;(getScreen as ReturnType<typeof vi.fn>).mockResolvedValue({ screen_type: 'html', html_content: fragment })

    const res = await GET(req(), { params: { screenId: VALID_UUID } })
    const text = await res.text()

    expect(text).toContain('<!doctype html>')
    expect(text).toContain(fragment)
  })

  it('AT-5: serves raw image bytes with the correct Content-Type', async () => {
    ;(getScreen as ReturnType<typeof vi.fn>).mockResolvedValue({ screen_type: 'image', storage_path: 'abc.png', image_mime_type: 'image/png' })
    const fakeBytes = Buffer.from([0x89, 0x50, 0x4e, 0x47])
    ;(downloadScreenImage as ReturnType<typeof vi.fn>).mockResolvedValue(fakeBytes)

    const res = await GET(req(), { params: { screenId: VALID_UUID } })

    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Type')).toBe('image/png')
    const buf = Buffer.from(await res.arrayBuffer())
    expect(buf.equals(fakeBytes)).toBe(true)
  })

  it('degrades to the same 404 (never a 500) when the Storage object is missing/unreadable', async () => {
    ;(getScreen as ReturnType<typeof vi.fn>).mockResolvedValue({ screen_type: 'image', storage_path: 'abc.png', image_mime_type: 'image/png' })
    ;(downloadScreenImage as ReturnType<typeof vi.fn>).mockResolvedValue(null)

    const res = await GET(req(), { params: { screenId: VALID_UUID } })
    expect(res.status).toBe(404)
  })

  it('AT-3: requires no Authorization header at all — this route never checks one', async () => {
    ;(getScreen as ReturnType<typeof vi.fn>).mockResolvedValue({ screen_type: 'html', html_content: '<p>x</p>' })
    const request = new NextRequest(`https://hello-clio.com/test-harness-render/${VALID_UUID}`) // no Authorization header set
    const res = await GET(request, { params: { screenId: VALID_UUID } })
    expect(res.status).toBe(200)
  })
})
