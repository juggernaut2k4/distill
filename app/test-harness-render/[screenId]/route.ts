import { NextRequest, NextResponse } from 'next/server'
import { getScreen } from '@/lib/test-harness/data'
import { downloadScreenImage } from '@/lib/test-harness/storage'
import { wrapHtmlFragmentIfNeeded } from '@/lib/test-harness/render'

/**
 * GET /test-harness-render/[screenId]
 *
 * B2B-32 (docs/specs/B2B-32-requirement-document.md §0 point 2/6, §6.5, AT-3, AT-4, AT-5). Public,
 * unauthenticated — directly parallel to `/partner-render/[clio_session_ref]` and
 * `/showcase-render/[visualizationId]`. This is the ONLY way the real pipeline
 * (`resolveInlineSessionRender()` → `safeFetchPartnerPage()`, `lib/partner/ssrf.ts`) can reach a
 * hand-authored screen — it performs a genuine server-side HTTPS fetch with no awareness of Basic
 * Auth, so this route must be truly public. Deliberately a Route Handler, not a page component, so
 * arbitrary `Content-Type` (image bytes) and the `Content-Security-Policy: sandbox allow-scripts`
 * header (§0 point 6, AT-10 — structural isolation, not sanitization) can be set precisely.
 *
 * Malformed UUID / no matching row / unreadable Storage object all render the identical
 * "This screen could not be found." message — no info leak about which (mirrors
 * `/showcase-render`'s own `NotFoundMessage` convention).
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function notFoundResponse(): NextResponse {
  return new NextResponse(
    '<!doctype html><html><head><meta charset="utf-8"></head><body style="min-height:100vh;width:100vw;display:flex;align-items:center;justify-content:center;background:#0a0a0a;color:#ffffff;font-family:system-ui,sans-serif;margin:0"><p style="font-size:14px">This screen could not be found.</p></body></html>',
    { status: 404, headers: { 'Content-Type': 'text/html; charset=utf-8' } }
  )
}

export async function GET(request: NextRequest, { params }: { params: { screenId: string } }) {
  if (!UUID_RE.test(params.screenId)) {
    return notFoundResponse()
  }

  const screen = await getScreen(params.screenId)
  if (!screen) {
    return notFoundResponse()
  }

  if (screen.screen_type === 'html') {
    const html = wrapHtmlFragmentIfNeeded(screen.html_content ?? '')
    return new NextResponse(html, {
      status: 200,
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        // §0 point 6 — second, independent isolation layer beyond the authoring-side sandboxed
        // iframe preview: forces the browser to treat this top-level document load as running in a
        // unique opaque origin (no cookies, no storage, no reading the parent app's session).
        'Content-Security-Policy': 'sandbox allow-scripts',
      },
    })
  }

  // screen_type === 'image'
  if (!screen.storage_path || !screen.image_mime_type) {
    return notFoundResponse()
  }

  const bytes = await downloadScreenImage(screen.storage_path)
  if (!bytes) {
    return notFoundResponse()
  }

  const arrayBuffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer

  return new NextResponse(arrayBuffer, {
    status: 200,
    headers: { 'Content-Type': screen.image_mime_type },
  })
}
