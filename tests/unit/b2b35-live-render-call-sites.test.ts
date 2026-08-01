import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * B2B-35 F2/F3 (docs/specs/B2B-35-requirement-document.md §6.6/§6.8/§7 AT-7/AT-8/AT-9-11) —
 * verifies that resolveLiveSessionRender() (Option 2/template path) and its inline counterpart,
 * resolveInlineSessionRender() (Option 1, reached via resolveLiveSessionRender() when
 * session.contentPages is set), each pass the correct `sessionContentMode` and
 * `audienceDescription` to assembleHumeNativePrompt(). All external calls (Supabase, Hume,
 * content pull, theming, templates) are mocked — no real network calls.
 */

const assembleHumeNativePromptMock = vi.fn((..._args: unknown[]) => 'ASSEMBLED_PROMPT')

vi.mock('@/lib/voice/hume-native/prompt-template', () => ({
  assembleHumeNativePrompt: (...args: unknown[]) => assembleHumeNativePromptMock(...args),
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

vi.mock('@/lib/partner/render-data', () => ({
  pullPartnerContent: vi.fn(async () => ({ status: 'ok', payload: { sections: [{ type: 'intro', meta: {} }] } })),
  pullPartnerProfile: vi.fn(async () => ({ status: 'ok', profile: {} })),
}))

vi.mock('@/lib/partner/theme', () => ({
  getThemeConfig: vi.fn(async () => ({ assistantDisplayName: 'your AI guide' })),
  resolvePartnerTheme: vi.fn(async () => ({})),
}))

vi.mock('@/lib/partner/prompt-config', () => ({
  getPromptConfig: vi.fn(async () => ({})),
}))

vi.mock('@/lib/partner/custom-templates', () => ({
  selectPartnerTemplate: vi.fn(async () => ({ kind: 'library', templateName: 'default' })),
}))

vi.mock('@/lib/partner/webhooks', () => ({
  recordBillableEvent: vi.fn(async () => {}),
}))

vi.mock('@/lib/partner/content-sources', () => ({
  getContentSource: vi.fn(async () => null),
  resolveContentSourceHeaders: vi.fn(async () => ({ status: 'ok', headers: {} })),
}))

vi.mock('@/lib/partner/ssrf', () => ({
  safeFetchPartnerPage: vi.fn(async () => ({
    status: 'ok',
    contentType: 'text/html',
    body: Buffer.from('<html></html>'),
  })),
}))

vi.mock('@/inngest/client', () => ({
  inngest: { send: vi.fn(async () => Promise.resolve()) },
}))

import { resolveLiveSessionRender, type PartnerSessionRow } from '@/lib/partner/live-render'

const BASE_SESSION: PartnerSessionRow = {
  id: 'session-1',
  partnerAccountId: 'partner-1',
  contentRef: 'content-ref-1',
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
  // B2B-36 F4 — new required fields on PartnerSessionRow; null here since this file predates and
  // is unrelated to B2B-36's own test coverage (tests/unit/b2b36-live-render-call-sites.test.ts).
  endUserName: null,
  endUserIndustry: null,
  // B2B-50 — new required field on PartnerSessionRow, unrelated to this file's own coverage.
  providerBotId: null,
  conversationLanguage: null,
}

const INLINE_SESSION: PartnerSessionRow = {
  ...BASE_SESSION,
  contentRef: null,
  contentPages: [
    {
      url: 'https://content.example.com/1.html',
      media_type: 'html',
      title: 'Page 1',
      subtitle: null,
      transition_trigger: 'after page one',
      transition_marker: 'MARKER_1',
      content_text: null,
    },
  ],
}

describe('B2B-35 F2 — sessionContentMode at each resolve*SessionRender() call site', () => {
  beforeEach(() => {
    assembleHumeNativePromptMock.mockClear()
  })

  // AT-7
  it("resolveLiveSessionRender() (Option 2/template path) calls assembleHumeNativePrompt with sessionContentMode 'template'", async () => {
    await resolveLiveSessionRender(BASE_SESSION)
    expect(assembleHumeNativePromptMock).toHaveBeenCalled()
    const callArgs = assembleHumeNativePromptMock.mock.calls[0][0] as { sessionContentMode?: string }
    expect(callArgs.sessionContentMode).toBe('template')
  })

  // AT-8
  it("resolveInlineSessionRender() (Option 1, reached via resolveLiveSessionRender when contentPages is set) calls assembleHumeNativePrompt with sessionContentMode 'inline'", async () => {
    await resolveLiveSessionRender(INLINE_SESSION)
    expect(assembleHumeNativePromptMock).toHaveBeenCalled()
    const callArgs = assembleHumeNativePromptMock.mock.calls[0][0] as { sessionContentMode?: string }
    expect(callArgs.sessionContentMode).toBe('inline')
  })
})

describe('B2B-35 F3 — audienceDescription resolution at each resolve*SessionRender() call site', () => {
  beforeEach(() => {
    assembleHumeNativePromptMock.mockClear()
  })

  it('a custom end_user_role is trimmed and passed through as audienceDescription (template path)', async () => {
    await resolveLiveSessionRender({ ...BASE_SESSION, endUserRole: '  a first-year sales associate  ' })
    const callArgs = assembleHumeNativePromptMock.mock.calls[0][0] as { audienceDescription?: string }
    expect(callArgs.audienceDescription).toBe('a first-year sales associate')
  })

  // AT-10 (via live-render's own resolution)
  it('endUserRole omitted (null) resolves to "a professional" (template path)', async () => {
    await resolveLiveSessionRender({ ...BASE_SESSION, endUserRole: null })
    const callArgs = assembleHumeNativePromptMock.mock.calls[0][0] as { audienceDescription?: string }
    expect(callArgs.audienceDescription).toBe('a professional')
  })

  // AT-11
  it('endUserRole as whitespace-only resolves to "a professional", not a literal whitespace string (template path)', async () => {
    await resolveLiveSessionRender({ ...BASE_SESSION, endUserRole: '   ' })
    const callArgs = assembleHumeNativePromptMock.mock.calls[0][0] as { audienceDescription?: string }
    expect(callArgs.audienceDescription).toBe('a professional')
  })

  it('a custom end_user_role is trimmed and passed through as audienceDescription (inline path)', async () => {
    await resolveLiveSessionRender({ ...INLINE_SESSION, endUserRole: 'a mid-level sales manager' })
    const callArgs = assembleHumeNativePromptMock.mock.calls[0][0] as { audienceDescription?: string }
    expect(callArgs.audienceDescription).toBe('a mid-level sales manager')
  })

  it('endUserRole omitted (null) resolves to "a professional" (inline path)', async () => {
    await resolveLiveSessionRender({ ...INLINE_SESSION, endUserRole: null })
    const callArgs = assembleHumeNativePromptMock.mock.calls[0][0] as { audienceDescription?: string }
    expect(callArgs.audienceDescription).toBe('a professional')
  })

  it('endUserRole as whitespace-only resolves to "a professional" (inline path)', async () => {
    await resolveLiveSessionRender({ ...INLINE_SESSION, endUserRole: '   ' })
    const callArgs = assembleHumeNativePromptMock.mock.calls[0][0] as { audienceDescription?: string }
    expect(callArgs.audienceDescription).toBe('a professional')
  })
})
