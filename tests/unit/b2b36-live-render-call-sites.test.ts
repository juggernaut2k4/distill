import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * B2B-36 F4 (docs/specs/B2B-36-requirement-document.md §6.5/§7 AT-1 through AT-9) — verifies that
 * resolveLiveSessionRender() (Option 2/template path) and resolveInlineSessionRender() (Option 1,
 * reached via resolveLiveSessionRender() when session.contentPages is set) each pass
 * `endUserIndustry` (both modes — Fork 1) and `participantName` (both modes as of 2026-08-02 — Fork
 * 2 removed, see below) to assembleHumeNativePrompt(). All external calls are mocked — no real
 * network calls. Mirrors tests/unit/b2b35-live-render-call-sites.test.ts's own mocking pattern.
 *
 * 2026-08-02 — Fork 2 (template mode never passing participantName) removed per Arun's direct
 * instruction: it was confirmed as the cause of a real test call never greeting him by name despite
 * `end_user_name='Arun'` already being stored correctly for that session (it had no content_pages,
 * so it took the template path). Both call sites in live-render.ts now pass participantName the
 * same way. On the Hume side specifically this remains a no-op in practice — Hume's own
 * RULE_1_TEMPLATE_TEXT has no name placeholder to fill (confirmed in
 * lib/voice/hume-native/prompt-template.ts, untouched by this change) — but the call site itself no
 * longer withholds the argument, which is what this test file verifies.
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

describe('B2B-36 F4 — endUserIndustry passed at both call sites (Fork 1)', () => {
  beforeEach(() => {
    assembleHumeNativePromptMock.mockClear()
  })

  it('resolveLiveSessionRender() (Option 2/template path) passes endUserIndustry', async () => {
    await resolveLiveSessionRender({ ...BASE_SESSION, endUserIndustry: 'healthcare' })
    const callArgs = assembleHumeNativePromptMock.mock.calls[0][0] as { endUserIndustry?: string }
    expect(callArgs.endUserIndustry).toBe('healthcare')
  })

  it('resolveInlineSessionRender() (Option 1) passes endUserIndustry', async () => {
    await resolveLiveSessionRender({ ...INLINE_SESSION, endUserIndustry: 'healthcare' })
    const callArgs = assembleHumeNativePromptMock.mock.calls[0][0] as { endUserIndustry?: string }
    expect(callArgs.endUserIndustry).toBe('healthcare')
  })

  it('endUserIndustry null resolves to undefined being passed through (template path)', async () => {
    await resolveLiveSessionRender({ ...BASE_SESSION, endUserIndustry: null })
    const callArgs = assembleHumeNativePromptMock.mock.calls[0][0] as { endUserIndustry?: string }
    expect(callArgs.endUserIndustry).toBeUndefined()
  })
})

describe('B2B-36 F4 — participantName passed at both call sites (2026-08-02: Fork 2 removed)', () => {
  beforeEach(() => {
    assembleHumeNativePromptMock.mockClear()
  })

  it('resolveInlineSessionRender() (Option 1) passes participantName from session.endUserName', async () => {
    await resolveLiveSessionRender({ ...INLINE_SESSION, endUserName: 'Arun' })
    const callArgs = assembleHumeNativePromptMock.mock.calls[0][0] as { participantName?: string }
    expect(callArgs.participantName).toBe('Arun')
  })

  // 2026-08-02 — was "does NOT pass participantName (Fork 2)" before Arun's direct instruction to
  // remove that gap. Confirmed root cause of a real test call never greeting him by name even
  // though end_user_name='Arun' was already stored correctly (that session had no content_pages,
  // so it took this template path). Passing it through here is a no-op for Hume specifically
  // (RULE_1_TEMPLATE_TEXT has no name placeholder) but is exactly what fixes it for OpenAI Realtime
  // (see the separate assembleOpenAIRealtimePrompt call site, not mocked in this file).
  it('resolveLiveSessionRender() (Option 2/template path) now also passes participantName', async () => {
    await resolveLiveSessionRender({ ...BASE_SESSION, endUserName: 'Arun' })
    const callArgs = assembleHumeNativePromptMock.mock.calls[0][0] as { participantName?: string }
    expect(callArgs.participantName).toBe('Arun')
  })

  it('endUserName null resolves to undefined being passed through (inline path)', async () => {
    await resolveLiveSessionRender({ ...INLINE_SESSION, endUserName: null })
    const callArgs = assembleHumeNativePromptMock.mock.calls[0][0] as { participantName?: string }
    expect(callArgs.participantName).toBeUndefined()
  })

  it('endUserName null resolves to undefined being passed through (template path too)', async () => {
    await resolveLiveSessionRender({ ...BASE_SESSION, endUserName: null })
    const callArgs = assembleHumeNativePromptMock.mock.calls[0][0] as { participantName?: string }
    expect(callArgs.participantName).toBeUndefined()
  })
})
