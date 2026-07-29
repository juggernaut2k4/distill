import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

/**
 * B2B-48 — root cause: Clio's own first-party demo pages (app/(demo)/demo/**) were being pushed
 * through the SSRF-hardened fetch-and-reinject-as-opaque-`srcDoc` pipeline built for genuine
 * untrusted partner content. Inside a `srcDoc` iframe, window.location.href is literally
 * 'about:srcdoc', which breaks the fetched Next.js document's own client-side router hydration
 * bootstrap. Fix: resolveInlineSessionRender() (reached via resolveLiveSessionRender() when
 * session.contentPages is set) now detects first-party page URLs (origin matches
 * DEMO_CONTENT_BASE_URL or NEXT_PUBLIC_APP_URL) and skips safeFetchPartnerPage()/
 * injectIframeDiagnosticShim() entirely for them, returning `sourceUrl` instead of `contentHtml`
 * so PartnerRenderClient.tsx renders a real `<iframe src="...">` navigation. Genuine partner pages
 * must be completely unaffected — same fetch, same shim, same srcDoc as before this fix.
 *
 * Mirrors tests/unit/b2b35-live-render-call-sites.test.ts's mocking pattern. All external calls
 * (Supabase, Hume, content pull, theming, templates) are mocked — no real network calls.
 */

const safeFetchPartnerPageMock = vi.fn(async () => ({
  status: 'ok' as const,
  contentType: 'text/html',
  body: Buffer.from('<html><head></head><body>partner content</body></html>'),
}))

vi.mock('@/lib/voice/hume-native/prompt-template', () => ({
  assembleHumeNativePrompt: vi.fn(() => 'ASSEMBLED_PROMPT'),
}))

vi.mock('@/lib/voice/hume-native/config-provisioner', () => ({
  provisionNativeConfig: vi.fn(async () => ({ configId: 'cfg_123' })),
}))

vi.mock('@/lib/supabase', () => ({
  createSupabaseAdminClient: () => ({
    from: () => ({
      update: () => ({ eq: async () => ({ error: null }) }),
      select: () => ({
        eq: () => ({
          eq: () => ({ maybeSingle: async () => ({ data: null }) }),
          maybeSingle: async () => ({ data: null }),
        }),
      }),
    }),
  }),
}))

vi.mock('@/lib/partner/theme', () => ({
  getThemeConfig: vi.fn(async () => ({ assistantDisplayName: 'your AI guide' })),
  resolvePartnerTheme: vi.fn(async () => ({})),
}))

vi.mock('@/lib/partner/prompt-config', () => ({
  getPromptConfig: vi.fn(async () => ({})),
}))

vi.mock('@/lib/partner/webhooks', () => ({
  recordBillableEvent: vi.fn(async () => {}),
}))

vi.mock('@/lib/partner/content-sources', () => ({
  getContentSource: vi.fn(async () => null),
  resolveContentSourceHeaders: vi.fn(async () => ({ status: 'ok', headers: {} })),
}))

vi.mock('@/lib/partner/ssrf', () => ({
  safeFetchPartnerPage: (...args: unknown[]) => safeFetchPartnerPageMock(...(args as [])),
}))

vi.mock('@/inngest/client', () => ({
  inngest: { send: vi.fn(async () => Promise.resolve()) },
}))

import { resolveLiveSessionRender, type PartnerSessionRow, type InlineContentPage } from '@/lib/partner/live-render'

const BASE_SESSION: PartnerSessionRow = {
  id: 'session-1',
  partnerAccountId: 'partner-1',
  contentRef: null,
  partnerTopicRef: null,
  partnerEndUserRef: null,
  status: 'requested',
  testMode: false,
  contentSourceId: null,
  contentPages: null,
  contentToExplain: null,
  contentTitle: null,
  contentSubtitle: null,
  endUserRole: null,
  endUserName: null,
  endUserIndustry: null,
  // B2B-50 — new required field on PartnerSessionRow, unrelated to this file's own coverage.
  providerBotId: null,
}

function page(overrides: Partial<InlineContentPage>): InlineContentPage {
  return {
    url: 'https://partner.example.com/page.html',
    media_type: 'html',
    title: 'A Page',
    subtitle: null,
    transition_trigger: 'after this page',
    transition_marker: 'MARKER_X',
    content_text: null,
    ...overrides,
  }
}

const ORIGINAL_ENV = { ...process.env }

describe('B2B-48 — first-party demo page vs. genuine partner page render branching', () => {
  beforeEach(() => {
    safeFetchPartnerPageMock.mockClear()
    process.env.DEMO_CONTENT_BASE_URL = 'https://test.hello-clio.com'
    process.env.NEXT_PUBLIC_APP_URL = 'https://hello-clio.com'
  })

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV }
  })

  it("a first-party page (origin matches DEMO_CONTENT_BASE_URL) never gets passed through safeFetchPartnerPage(), and the result carries sourceUrl (not contentHtml)", async () => {
    const firstPartyUrl = 'https://test.hello-clio.com/demo/claude-ai/visuals/what-is-claude'
    const session = { ...BASE_SESSION, contentPages: [page({ url: firstPartyUrl })] }

    const result = await resolveLiveSessionRender(session)

    expect(safeFetchPartnerPageMock).not.toHaveBeenCalled()
    expect(result.status).toBe('ok')
    if (result.status !== 'ok' || result.mode !== 'inline') throw new Error('expected inline ok result')
    expect(result.inlinePages).toHaveLength(1)
    expect(result.inlinePages[0].status).toBe('ok')
    expect(result.inlinePages[0].sourceUrl).toBe(firstPartyUrl)
    expect(result.inlinePages[0].contentHtml).toBeUndefined()
  })

  it("a first-party page whose origin matches NEXT_PUBLIC_APP_URL instead of DEMO_CONTENT_BASE_URL is also detected as first-party", async () => {
    const firstPartyUrl = 'https://hello-clio.com/demo/claude-ai/visuals/model-family'
    const session = { ...BASE_SESSION, contentPages: [page({ url: firstPartyUrl })] }

    const result = await resolveLiveSessionRender(session)

    expect(safeFetchPartnerPageMock).not.toHaveBeenCalled()
    if (result.status !== 'ok' || result.mode !== 'inline') throw new Error('expected inline ok result')
    expect(result.inlinePages[0].sourceUrl).toBe(firstPartyUrl)
  })

  it('a genuine partner page (different origin) still gets passed through safeFetchPartnerPage(), and the result carries contentHtml (not sourceUrl) — completely unaffected by this fix', async () => {
    const partnerUrl = 'https://partner.example.com/lesson-1.html'
    const session = { ...BASE_SESSION, contentPages: [page({ url: partnerUrl })] }

    const result = await resolveLiveSessionRender(session)

    expect(safeFetchPartnerPageMock).toHaveBeenCalledTimes(1)
    expect(safeFetchPartnerPageMock).toHaveBeenCalledWith(partnerUrl, {}, 'html')
    if (result.status !== 'ok' || result.mode !== 'inline') throw new Error('expected inline ok result')
    expect(result.inlinePages[0].sourceUrl).toBeUndefined()
    expect(result.inlinePages[0].contentHtml).toContain('partner content')
    // Shim injection still runs for genuine partner content — confirms the srcDoc pipeline is untouched.
    expect(result.inlinePages[0].contentHtml).toContain('__CLIO_REPORT_REACT_ERROR__')
  })

  it('a mixed page set routes each page independently: first-party pages skip the fetch, partner pages still fetch', async () => {
    const firstPartyUrl = 'https://test.hello-clio.com/demo/claude-ai/visuals/what-is-claude'
    const partnerUrl = 'https://partner.example.com/lesson-1.html'
    const session = {
      ...BASE_SESSION,
      contentPages: [page({ url: firstPartyUrl, transition_marker: 'M1' }), page({ url: partnerUrl, transition_marker: 'M2' })],
    }

    const result = await resolveLiveSessionRender(session)

    expect(safeFetchPartnerPageMock).toHaveBeenCalledTimes(1)
    expect(safeFetchPartnerPageMock).toHaveBeenCalledWith(partnerUrl, {}, 'html')
    if (result.status !== 'ok' || result.mode !== 'inline') throw new Error('expected inline ok result')
    expect(result.inlinePages).toHaveLength(2)
    expect(result.inlinePages[0].sourceUrl).toBe(firstPartyUrl)
    expect(result.inlinePages[1].contentHtml).toBeDefined()
  })

  it('fails CLOSED when the relevant env vars are unset: a would-be first-party URL falls through to the existing fetch/srcDoc pipeline unchanged, never treated as first-party by a hardcoded host guess', async () => {
    delete process.env.DEMO_CONTENT_BASE_URL
    delete process.env.NEXT_PUBLIC_APP_URL
    const url = 'https://test.hello-clio.com/demo/claude-ai/visuals/what-is-claude'
    const session = { ...BASE_SESSION, contentPages: [page({ url })] }

    const result = await resolveLiveSessionRender(session)

    expect(safeFetchPartnerPageMock).toHaveBeenCalledTimes(1)
    if (result.status !== 'ok' || result.mode !== 'inline') throw new Error('expected inline ok result')
    expect(result.inlinePages[0].sourceUrl).toBeUndefined()
    expect(result.inlinePages[0].contentHtml).toBeDefined()
  })

  it('a malformed page URL never throws and is treated as not-first-party (falls through to the existing fetch pipeline)', async () => {
    const session = { ...BASE_SESSION, contentPages: [page({ url: 'not a valid url' })] }

    const result = await resolveLiveSessionRender(session)

    expect(safeFetchPartnerPageMock).toHaveBeenCalledTimes(1)
    if (result.status !== 'ok' || result.mode !== 'inline') throw new Error('expected inline ok result')
    expect(result.inlinePages[0].sourceUrl).toBeUndefined()
  })

  it('image pages are never routed through the first-party src branch, even when their origin matches — only mediaType html is eligible', async () => {
    const firstPartyImageUrl = 'https://test.hello-clio.com/demo/claude-ai/some-image.png'
    const session = {
      ...BASE_SESSION,
      contentPages: [page({ url: firstPartyImageUrl, media_type: 'image' })],
    }
    safeFetchPartnerPageMock.mockResolvedValueOnce({
      status: 'ok' as const,
      contentType: 'image/png',
      body: Buffer.from('fake-image-bytes'),
    })

    const result = await resolveLiveSessionRender(session)

    expect(safeFetchPartnerPageMock).toHaveBeenCalledTimes(1)
    if (result.status !== 'ok' || result.mode !== 'inline') throw new Error('expected inline ok result')
    expect(result.inlinePages[0].mediaType).toBe('image')
    expect(result.inlinePages[0].sourceUrl).toBeUndefined()
    expect(result.inlinePages[0].imageDataUri).toBeDefined()
  })
})
