import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'
import fs from 'node:fs'
import path from 'node:path'

/**
 * RTV-05 — coverage for Section 7's acceptance tests 1-9 (Live Pre-Fetch +
 * Dual-Trigger Toggle-Gated Display Switch). Test 10 (full end-to-end, real
 * session) is explicitly a manual/real-session acceptance check per the
 * requirement doc's own framing — not achievable in production today (the
 * Rollout Readiness Gate), and not simulated here.
 *
 * Four groups, mirroring this suite's established conventions
 * (tests/unit/rtv03-tracker.test.ts, tests/unit/template-approval.test.ts):
 *   1. computeRtv05DisplayGate() — Section 4.2's session-level gate, factored
 *      out of app/api/hume-native/provision-config/route.ts specifically so
 *      this phase's single highest-risk decision is directly unit-testable.
 *   2. POST /api/rtv05/prefetch-section — Section 4.4.
 *   3. POST /api/walkthrough-state/[userId]'s new update_section_data command
 *      — Section 6.3.
 *   4. Grep-checkable invariants against WalkthroughClient.tsx — Section 4.3's
 *      anti-LIVE-06 proof (dual-trigger single-writer guarantee), mirroring
 *      RTV-03's own "grep-checkable guarantee" test style exactly.
 */

// ─── 1. computeRtv05DisplayGate — Section 4.2 ─────────────────────────────

vi.mock('@/lib/supabase', () => ({
  createSupabaseAdminClient: vi.fn(() => ({
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          maybeSingle: vi.fn(() => Promise.resolve({ data: null, error: null })),
          single: vi.fn(() => Promise.resolve({ data: null, error: null })),
          order: vi.fn(() => ({
            limit: vi.fn(() => ({
              maybeSingle: vi.fn(() => Promise.resolve({ data: null, error: null })),
            })),
          })),
        })),
      })),
      update: vi.fn(() => ({ eq: vi.fn(() => Promise.resolve({ data: null, error: null })) })),
    })),
  })),
}))

import { computeRtv05DisplayGate } from '@/lib/content/rtv05-display-gate'

describe('computeRtv05DisplayGate — Section 4.2 session-level gate', () => {
  it('AC1 — toggle OFF resolves false on first connect without ever checking approvals', async () => {
    const checkApproval = vi.fn(() => Promise.resolve(true))
    const result = await computeRtv05DisplayGate({
      rtv05EnvToggleOn: false,
      rtv03Active: true,
      persistedRtv05DisplayActive: null,
      nonBookendTypes: ['DefinitionTriptych'],
      checkApproval,
    })
    expect(result).toEqual({ isFirstConnect: true, displayActive: false })
    expect(checkApproval).not.toHaveBeenCalled()
  })

  it('AC2 — toggle ON but rtv03Active false resolves false without checking approvals', async () => {
    const checkApproval = vi.fn(() => Promise.resolve(true))
    const result = await computeRtv05DisplayGate({
      rtv05EnvToggleOn: true,
      rtv03Active: false,
      persistedRtv05DisplayActive: null,
      nonBookendTypes: ['DefinitionTriptych'],
      checkApproval,
    })
    expect(result).toEqual({ isFirstConnect: true, displayActive: false })
    expect(checkApproval).not.toHaveBeenCalled()
  })

  it('AC2 — toggle ON, rtv03Active true, but one non-bookend template unapproved (true for every session today — zero approved) resolves false', async () => {
    const checkApproval = vi.fn((name: string) => Promise.resolve(name !== 'Heatmap'))
    const result = await computeRtv05DisplayGate({
      rtv05EnvToggleOn: true,
      rtv03Active: true,
      persistedRtv05DisplayActive: null,
      nonBookendTypes: ['DefinitionTriptych', 'Heatmap'],
      checkApproval,
    })
    expect(result).toEqual({ isFirstConnect: true, displayActive: false })
    expect(checkApproval).toHaveBeenCalledWith('DefinitionTriptych')
    expect(checkApproval).toHaveBeenCalledWith('Heatmap')
  })

  it('AC3 — every condition satisfied resolves true and reports isFirstConnect on a fresh session', async () => {
    const checkApproval = vi.fn(() => Promise.resolve(true))
    const result = await computeRtv05DisplayGate({
      rtv05EnvToggleOn: true,
      rtv03Active: true,
      persistedRtv05DisplayActive: null,
      nonBookendTypes: ['DefinitionTriptych', 'ConceptDefinition'],
      checkApproval,
    })
    expect(result).toEqual({ isFirstConnect: true, displayActive: true })
  })

  it('AC3 — a reconnect reuses the persisted TRUE value verbatim, never recomputing, even if approvals would now resolve false', async () => {
    const checkApproval = vi.fn(() => Promise.resolve(false))
    const result = await computeRtv05DisplayGate({
      rtv05EnvToggleOn: true,
      rtv03Active: true,
      persistedRtv05DisplayActive: true, // persisted from a prior connect
      nonBookendTypes: ['Heatmap'],
      checkApproval,
    })
    expect(result).toEqual({ isFirstConnect: false, displayActive: true })
    expect(checkApproval).not.toHaveBeenCalled()
  })

  it('a reconnect reuses a persisted FALSE value verbatim too — never recomputes even if approvals would now resolve true', async () => {
    const checkApproval = vi.fn(() => Promise.resolve(true))
    const result = await computeRtv05DisplayGate({
      rtv05EnvToggleOn: true,
      rtv03Active: true,
      persistedRtv05DisplayActive: false,
      nonBookendTypes: ['DefinitionTriptych'],
      checkApproval,
    })
    expect(result).toEqual({ isFirstConnect: false, displayActive: false })
    expect(checkApproval).not.toHaveBeenCalled()
  })

  it('Section 8 — a thrown/rejected checkApproval resolves the whole gate to false (fail closed), never throws', async () => {
    const checkApproval = vi.fn(() => Promise.reject(new Error('supabase down')))
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const result = await computeRtv05DisplayGate({
      rtv05EnvToggleOn: true,
      rtv03Active: true,
      persistedRtv05DisplayActive: null,
      nonBookendTypes: ['DefinitionTriptych'],
      checkApproval,
    })
    expect(result).toEqual({ isFirstConnect: true, displayActive: false })
    errSpy.mockRestore()
  })

  it('a session with zero non-bookend topics resolves false rather than vacuously true', async () => {
    const checkApproval = vi.fn(() => Promise.resolve(true))
    const result = await computeRtv05DisplayGate({
      rtv05EnvToggleOn: true,
      rtv03Active: true,
      persistedRtv05DisplayActive: null,
      nonBookendTypes: [],
      checkApproval,
    })
    expect(result.displayActive).toBe(false)
  })
})

// ─── 2. POST /api/rtv05/prefetch-section — Section 4.4 ────────────────────

vi.mock('@/lib/templates/generator', () => ({
  generateTemplateData: vi.fn(),
  validateTemplateData: vi.fn(),
}))

describe('POST /api/rtv05/prefetch-section', () => {
  let mockSections: Array<{ id: string; type: string; data: unknown; meta: { subtopicTitle: string; sessionTitle: string } }>
  let mockUserRow: { role: string; industry: string; ai_maturity: string; role_level: string | null } | null
  let mockStateMissing: boolean
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(async () => {
    vi.clearAllMocks()
    mockStateMissing = false
    mockUserRow = { role: 'CEO', industry: 'finance', ai_maturity: 'intermediate', role_level: 'c-suite' }
    mockSections = [
      { id: 'overview', type: 'SessionOverview', data: {}, meta: { subtopicTitle: 'Overview', sessionTitle: 'AI 101' } },
      { id: 'topic-1', type: 'DefinitionTriptych', data: { term: 'old' }, meta: { subtopicTitle: 'What is AI', sessionTitle: 'AI 101' } },
      { id: 'topic-2', type: 'ConceptDefinition', data: { term: 'old2' }, meta: { subtopicTitle: 'Foundation Models', sessionTitle: 'AI 101' } },
      { id: 'summary', type: 'SessionSummary', data: {}, meta: { subtopicTitle: 'Summary', sessionTitle: 'AI 101' } },
    ]

    const { createSupabaseAdminClient } = await import('@/lib/supabase')
    vi.mocked(createSupabaseAdminClient).mockReturnValue({
      from: vi.fn((table: string) => {
        if (table === 'walkthrough_state') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                maybeSingle: vi.fn(() =>
                  Promise.resolve(
                    mockStateMissing ? { data: null, error: null } : { data: { sections: mockSections }, error: null }
                  )
                ),
              })),
            })),
          }
        }
        if (table === 'users') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                maybeSingle: vi.fn(() => Promise.resolve({ data: mockUserRow, error: null })),
              })),
            })),
          }
        }
        throw new Error(`Unexpected table in test: ${table}`)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      }) as any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any)

    fetchMock = vi.fn(() => Promise.resolve(new Response(JSON.stringify({ ok: true }), { status: 200 })))
    vi.stubGlobal('fetch', fetchMock)
  })

  function makeRequest(body: unknown) {
    return new NextRequest('http://localhost:3000/api/rtv05/prefetch-section', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
  }

  it('AC9 — refuses to generate for a bookend target (SessionOverview) and never calls generateTemplateData', async () => {
    const { POST } = await import('@/app/api/rtv05/prefetch-section/route')
    const { generateTemplateData } = await import('@/lib/templates/generator')

    const res = await POST(makeRequest({ userId: 'user-1', sectionIndex: 0 }))
    const json = await res.json()

    expect(json).toEqual({ ok: false })
    expect(generateTemplateData).not.toHaveBeenCalled()
  })

  it('AC9 — refuses to generate for a bookend target (SessionSummary) and never calls generateTemplateData', async () => {
    const { POST } = await import('@/app/api/rtv05/prefetch-section/route')
    const { generateTemplateData } = await import('@/lib/templates/generator')

    const res = await POST(makeRequest({ userId: 'user-1', sectionIndex: 3 }))
    const json = await res.json()

    expect(json).toEqual({ ok: false })
    expect(generateTemplateData).not.toHaveBeenCalled()
  })

  it('out-of-bounds section_index is a no-op — returns { ok: false }, never calls generateTemplateData', async () => {
    const { POST } = await import('@/app/api/rtv05/prefetch-section/route')
    const { generateTemplateData } = await import('@/lib/templates/generator')

    const res = await POST(makeRequest({ userId: 'user-1', sectionIndex: 99 }))
    const json = await res.json()

    expect(json).toEqual({ ok: false })
    expect(generateTemplateData).not.toHaveBeenCalled()
  })

  it('AC6 — successful pre-fetch calls generateTemplateData live, validates the result, and writes via update_section_data', async () => {
    const { POST } = await import('@/app/api/rtv05/prefetch-section/route')
    const { generateTemplateData, validateTemplateData } = await import('@/lib/templates/generator')

    const generated = { term: 'fresh', category: 'AI Concept', what_it_is: 'x', real_example: { company: '', what: '', result: '' }, common_myth: '', so_what: '' }
    const validated = { ...generated, term: 'validated' }
    vi.mocked(generateTemplateData).mockResolvedValueOnce(generated)
    vi.mocked(validateTemplateData).mockResolvedValueOnce(validated)

    const res = await POST(makeRequest({ userId: 'user-1', sectionIndex: 1 }))
    const json = await res.json()

    expect(generateTemplateData).toHaveBeenCalledWith(
      'DefinitionTriptych',
      'What is AI',
      'AI 101',
      { role: 'CEO', industry: 'finance', maturity: 'intermediate' },
      { previous: 'Overview', next: 'Foundation Models' }
    )
    expect(validateTemplateData).toHaveBeenCalledWith('DefinitionTriptych', generated, 'What is AI')

    // Written via the update_section_data command over the walkthrough-state API surface.
    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:3000/api/walkthrough-state/user-1',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ command: 'update_section_data', section_index: 1, data: validated }),
      })
    )
    expect(json).toEqual({ ok: true })
  })

  it('AC8 (server side) — generation failing after the one retry returns { ok: false } and never attempts the write', async () => {
    const { POST } = await import('@/app/api/rtv05/prefetch-section/route')
    const { generateTemplateData } = await import('@/lib/templates/generator')

    vi.mocked(generateTemplateData).mockRejectedValue(new Error('anthropic down'))
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    const res = await POST(makeRequest({ userId: 'user-1', sectionIndex: 1 }))
    const json = await res.json()

    // One attempt + RTV05_GENERATION_MAX_RETRIES(1) retry = exactly 2 calls.
    expect(generateTemplateData).toHaveBeenCalledTimes(2)
    expect(json).toEqual({ ok: false })
    expect(fetchMock).not.toHaveBeenCalled()

    errSpy.mockRestore()
    warnSpy.mockRestore()
  })

  it('a failed update_section_data write (non-ok response) returns { ok: false }', async () => {
    const { POST } = await import('@/app/api/rtv05/prefetch-section/route')
    const { generateTemplateData, validateTemplateData } = await import('@/lib/templates/generator')

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(generateTemplateData).mockResolvedValueOnce({ term: 'x' } as any)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(validateTemplateData).mockResolvedValueOnce({ term: 'x' } as any)
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 500 }))
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    const res = await POST(makeRequest({ userId: 'user-1', sectionIndex: 1 }))
    const json = await res.json()

    expect(json).toEqual({ ok: false })
    errSpy.mockRestore()
  })

  it('never returns 5xx — an unrecognized/missing walkthrough_state row resolves { ok: false } with 200', async () => {
    mockStateMissing = true
    const { POST } = await import('@/app/api/rtv05/prefetch-section/route')

    const res = await POST(makeRequest({ userId: 'user-1', sectionIndex: 1 }))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: false })
  })

  it('invalid body returns 400, never touches generateTemplateData', async () => {
    const { POST } = await import('@/app/api/rtv05/prefetch-section/route')
    const { generateTemplateData } = await import('@/lib/templates/generator')

    const res = await POST(makeRequest({ userId: 'user-1' /* missing sectionIndex */ }))
    expect(res.status).toBe(400)
    expect(generateTemplateData).not.toHaveBeenCalled()
  })
})

// ─── 3. POST /api/walkthrough-state/[userId] — update_section_data (Section 6.3) ──

describe("POST /api/walkthrough-state/[userId] — 'update_section_data' command", () => {
  let mockSections: Array<{ id: string; type: string; data: unknown; meta: unknown; status: string }>
  let capturedUpdatePayload: Record<string, unknown> | null

  beforeEach(async () => {
    vi.clearAllMocks()
    capturedUpdatePayload = null
    mockSections = [
      { id: 'overview', type: 'SessionOverview', data: { a: 1 }, meta: { subtopicTitle: 'Overview' }, status: 'ready' },
      { id: 'topic-1', type: 'DefinitionTriptych', data: { term: 'old' }, meta: { subtopicTitle: 'What is AI' }, status: 'ready' },
      { id: 'summary', type: 'SessionSummary', data: { b: 2 }, meta: { subtopicTitle: 'Summary' }, status: 'ready' },
    ]

    const { createSupabaseAdminClient } = await import('@/lib/supabase')
    vi.mocked(createSupabaseAdminClient).mockReturnValue({
      from: vi.fn(() => ({
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            single: vi.fn(() => Promise.resolve({ data: { sections: mockSections }, error: null })),
          })),
        })),
        update: vi.fn((payload: Record<string, unknown>) => {
          capturedUpdatePayload = payload
          return { eq: vi.fn(() => Promise.resolve({ data: null, error: null })) }
        }),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      })) as any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any)
  })

  function makeRequest(body: unknown) {
    return new NextRequest('http://localhost:3000/api/walkthrough-state/user-1', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
  }

  it('AC6 — overwrites only the target section\'s data field, preserving id/type/meta/status, without touching current_section_index', async () => {
    const { POST } = await import('@/app/api/walkthrough-state/[userId]/route')

    const newData = { term: 'validated', category: 'AI Concept' }
    const res = await POST(makeRequest({ command: 'update_section_data', section_index: 1, data: newData }), {
      params: { userId: 'user-1' },
    })
    const json = await res.json()

    expect(json).toEqual({ ok: true, section_index: 1 })
    expect(capturedUpdatePayload).not.toBeNull()
    expect(capturedUpdatePayload).not.toHaveProperty('current_section_index')
    const written = (capturedUpdatePayload!.sections as typeof mockSections)
    expect(written[1]).toEqual({ id: 'topic-1', type: 'DefinitionTriptych', data: newData, meta: { subtopicTitle: 'What is AI' }, status: 'ready' })
    // Untouched sections pass through unchanged.
    expect(written[0]).toEqual(mockSections[0])
    expect(written[2]).toEqual(mockSections[2])
  })

  it('refuses to overwrite a SessionOverview bookend even if called incorrectly', async () => {
    const { POST } = await import('@/app/api/walkthrough-state/[userId]/route')

    const res = await POST(makeRequest({ command: 'update_section_data', section_index: 0, data: { a: 99 } }), {
      params: { userId: 'user-1' },
    })
    expect(res.status).toBe(400)
    expect(capturedUpdatePayload).toBeNull()
  })

  it('refuses to overwrite a SessionSummary bookend even if called incorrectly', async () => {
    const { POST } = await import('@/app/api/walkthrough-state/[userId]/route')

    const res = await POST(makeRequest({ command: 'update_section_data', section_index: 2, data: { b: 99 } }), {
      params: { userId: 'user-1' },
    })
    expect(res.status).toBe(400)
    expect(capturedUpdatePayload).toBeNull()
  })

  it('rejects an out-of-bounds section_index with 400', async () => {
    const { POST } = await import('@/app/api/walkthrough-state/[userId]/route')

    const res = await POST(makeRequest({ command: 'update_section_data', section_index: 99, data: {} }), {
      params: { userId: 'user-1' },
    })
    expect(res.status).toBe(400)
  })

  it('existing scroll_to command is completely unaffected by this new command\'s addition', async () => {
    const { POST } = await import('@/app/api/walkthrough-state/[userId]/route')

    const res = await POST(makeRequest({ command: 'scroll_to', section_index: 1 }), { params: { userId: 'user-1' } })
    const json = await res.json()
    expect(json).toEqual({ ok: true, current_section_index: 1 })
  })
})

// ─── 4. Grep-checkable invariants — WalkthroughClient.tsx (Section 4.3) ────

describe('RTV-05 dual-trigger single-writer proof — WalkthroughClient.tsx grep-checkable guarantee', () => {
  const clientSrcRaw = fs.readFileSync(
    path.resolve(__dirname, '../../app/dashboard/walkthrough/WalkthroughClient.tsx'),
    'utf8'
  )
  // Strip comments before checking write-gate invariants: the constraint is
  // about CODE references (what a reviewer/CI grep would run against the
  // executable surface), not the file's own doc comments describing/quoting
  // the guard by name for reviewers (which this file's RTV-05 comments do
  // extensively, by design) — mirrors tests/unit/rtv03-tracker.test.ts's own
  // "grep-checkable guarantee" convention exactly. Block boundaries below are
  // always located in the RAW (comment-intact) source — several landmarks
  // (e.g. the RTV-03 doc-comment marker) are themselves comments — and only
  // the extracted slice is then comment-stripped for code-level assertions.
  const stripComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
  const clientSrc = stripComments(clientSrcRaw)

  const trackerStartRaw = clientSrcRaw.indexOf('// RTV-03 — observe-only position tracker.')
  const toolsStartRaw = clientSrcRaw.indexOf('tools: {', trackerStartRaw)
  const trackerBlock = stripComments(clientSrcRaw.slice(trackerStartRaw, toolsStartRaw))

  const showVisualStartRaw = clientSrcRaw.indexOf('show_visual: async (params) => {')
  const showVisualEndRaw = clientSrcRaw.indexOf('end_session: async () => {', showVisualStartRaw)
  const showVisualBlock = stripComments(clientSrcRaw.slice(showVisualStartRaw, showVisualEndRaw))

  it('AC1 — the toggle is read with strict equality, defaulting OFF on unset/typo', () => {
    expect(clientSrc).toMatch(/process\.env\.NEXT_PUBLIC_RTV_DISPLAY_SWITCH_ENABLED === 'true'/)
  })

  it('rtv05DisplayActiveRef is declared as its own useRef<boolean>(false)', () => {
    expect(clientSrc).toMatch(/const rtv05DisplayActiveRef = useRef<boolean>\(false\)/)
  })

  it('rtv05DisplayActiveRef.current is assigned exactly once in the entire file (code, not comments)', () => {
    const occurrences = clientSrc.split('rtv05DisplayActiveRef.current = ').length - 1
    expect(occurrences).toBe(1)
  })

  it('that single assignment happens inside the provision-config response handler, ANDing the client-side toggle with the server-computed rtv05?.displayActive (belt-and-suspenders, Section 3)', () => {
    expect(clientSrc).toMatch(/rtv05DisplayActiveRef\.current = RTV_DISPLAY_SWITCH_ENV_ENABLED && rtv05\?\.displayActive === true/)
  })

  it('the client-side toggle constant reads NEXT_PUBLIC_RTV_DISPLAY_SWITCH_ENABLED with strict equality, same fail-safe pattern as the rest of this file', () => {
    expect(clientSrc).toMatch(/const RTV_DISPLAY_SWITCH_ENV_ENABLED = process\.env\.NEXT_PUBLIC_RTV_DISPLAY_SWITCH_ENABLED === 'true'/)
  })

  it('AC4/AC5 — exactly one WRITE-GATING block is opened on the negation (!rtv05DisplayActiveRef.current) { — the show_visual scroll_to guard', () => {
    // Deliberately distinct from the pre-fetch trigger's own early-return
    // guard (`if (!rtv05DisplayActiveRef.current) return`, no brace, a
    // different and legitimate check — "should this function do anything at
    // all" rather than "which of the two writers may enqueue a screen
    // write"). Requiring the block form `{` isolates the write-gate
    // specifically.
    const offWriteGates = (clientSrc.match(/if \(!rtv05DisplayActiveRef\.current\) \{/g) || []).length
    expect(offWriteGates).toBe(1)
  })

  it('AC4/AC5 — exactly one WRITE-GATING block is opened directly on the flag (rtv05DisplayActiveRef.current) { — the tracker-hit block\'s new logic', () => {
    const onWriteGates = (clientSrc.match(/if \(rtv05DisplayActiveRef\.current\) \{/g) || []).length
    expect(onWriteGates).toBe(1)
  })

  it('the pre-fetch trigger\'s own early-return guard is a single-statement negation check, structurally distinct from the write-gate above', () => {
    const earlyReturnGuards = (clientSrc.match(/if \(!rtv05DisplayActiveRef\.current\) return/g) || []).length
    expect(earlyReturnGuards).toBe(1)
  })

  it('AC5 — the show_visual handler\'s existing scroll_to write (section_index: idx) is gated by the negation block, and nothing else in that handler references the flag', () => {
    expect(showVisualStartRaw).toBeGreaterThan(-1)
    expect(showVisualEndRaw).toBeGreaterThan(showVisualStartRaw)

    expect(showVisualBlock).toMatch(/if \(!rtv05DisplayActiveRef\.current\) \{/)
    expect(showVisualBlock).toMatch(/command: 'scroll_to', section_index: idx/)
    // Exactly one reference to the flag in this whole handler (the gate
    // itself) — no second, independent check hiding elsewhere in it.
    expect((showVisualBlock.match(/rtv05DisplayActiveRef\.current/g) || []).length).toBe(1)
  })

  it('AC4 — the tracker-hit block\'s new display/pre-fetch logic (section_index: targetIdx) is the one gated on the flag directly', () => {
    expect(trackerStartRaw).toBeGreaterThan(-1)
    expect(toolsStartRaw).toBeGreaterThan(trackerStartRaw)

    expect(trackerBlock).toMatch(/if \(rtv05DisplayActiveRef\.current\) \{/)
    expect(trackerBlock).toMatch(/command: 'scroll_to', section_index: targetIdx/)
    expect(trackerBlock).toMatch(/triggerRtv05Prefetch\(targetIdx \+ 1\)/)
  })

  it('AC7/AC8 — the display step bounds its wait on a prior pre-fetch via RTV05_DISPLAY_WAIT_MS and proceeds regardless of the outcome', () => {
    expect(trackerBlock).toMatch(/Promise\.race\(\[\s*staged,/)
    expect(trackerBlock).toMatch(/RTV05_DISPLAY_WAIT_MS/)
    expect(clientSrcRaw).toMatch(/const RTV05_DISPLAY_WAIT_MS = 15_000/)
  })

  it('AC9 — the pre-fetch trigger refuses SessionOverview/SessionSummary bookend targets', () => {
    expect(clientSrc).toMatch(/targetType === 'SessionOverview' \|\| targetType === 'SessionSummary'\) return/)
  })

  it('pre-fetch fires at most once per section per session (deduped via rtv05StagedContentRef)', () => {
    expect(clientSrc).toMatch(/rtv05StagedContentRef\.current\.has\(targetIdx\)\) return/)
  })

  it('bootstrap pre-fetch for section_index 1 fires exactly once, at tracker initialization', () => {
    const occurrences = clientSrc.split('triggerRtv05Prefetch(1)').length - 1
    expect(occurrences).toBe(1)
  })

  it('the RTV-03 tracker\'s own log-only audit-write logic is unmodified — still runs before the new RTV-05 block', () => {
    const auditIdx = trackerBlock.indexOf('rtv03_next_topic_cue')
    const rtv05Idx = trackerBlock.indexOf('rtv05DisplayActiveRef.current) {')
    expect(auditIdx).toBeGreaterThan(-1)
    expect(rtv05Idx).toBeGreaterThan(auditIdx)
  })
})
