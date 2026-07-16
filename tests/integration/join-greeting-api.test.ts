import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

/**
 * B2B-11 — tests for
 * app/api/partner/render/join-greeting/[clio_session_ref]/route.ts.
 * See docs/specs/B2B-11-requirement-document.md Section 7 for the exact
 * acceptance-test list this file implements, including the two v1.1
 * fix-verification tests (full-prompt-preservation, missing-snapshot
 * fail-closed fallback).
 */

interface PartnerSessionRow {
  id: string
  partnerAccountId: string
  contentRef: string | null
  partnerTopicRef: string | null
  partnerEndUserRef: string | null
  status: string
  testMode: boolean
}

const state: {
  session: PartnerSessionRow | null
  sessionRow: Record<string, unknown> | null
  updateCalls: Array<Record<string, unknown>>
  promptConfig: { joinGreeting: { mode: 'literal' | 'instruction'; text: string } | null }
} = {
  session: null,
  sessionRow: null,
  updateCalls: [],
  promptConfig: { joinGreeting: null },
}

const getPartnerSessionMock = vi.fn((..._args: unknown[]) => Promise.resolve(state.session))
vi.mock('@/lib/partner/live-render', () => ({
  getPartnerSession: (...args: unknown[]) => getPartnerSessionMock(...args),
}))

const getPromptConfigMock = vi.fn((..._args: unknown[]) => Promise.resolve(state.promptConfig))
vi.mock('@/lib/partner/prompt-config', () => ({
  getPromptConfig: (...args: unknown[]) => getPromptConfigMock(...args),
  DEFAULT_JOIN_GREETING: {
    mode: 'instruction',
    text: 'The participant, {firstName}, just joined the call. Greet them warmly by name in one short, natural sentence, then continue exactly where you were before they joined — do not restart, re-introduce yourself, or repeat anything already covered.',
  },
}))

vi.mock('@/lib/supabase', () => ({
  createSupabaseAdminClient: vi.fn(() => ({
    from: vi.fn((table: string) => {
      if (table !== 'partner_sessions') throw new Error(`Unexpected table: ${table}`)
      return {
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            maybeSingle: vi.fn(() => Promise.resolve({ data: state.sessionRow })),
          })),
        })),
        update: vi.fn((patch: Record<string, unknown>) => ({
          eq: vi.fn(() => {
            state.updateCalls.push(patch)
            return Promise.resolve({ error: null })
          }),
        })),
      }
    }),
  })),
}))

import { GET, PATCH } from '@/app/api/partner/render/join-greeting/[clio_session_ref]/route'

function makeRequest() {
  return new NextRequest('http://localhost:3000/api/partner/render/join-greeting/session-1')
}

const FULL_PROMPT = 'You are Clio, an AI business coach...\n\n=== BEHAVIORAL RULES ===\n\n1. ...\n\n=== END OF UPFRONT BRIEFING ===\n\nYou now have everything you need. Begin the session.'

describe('GET/PATCH /api/partner/render/join-greeting/[clio_session_ref]', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    state.session = {
      id: 'session-1',
      partnerAccountId: 'acct-1',
      contentRef: null,
      partnerTopicRef: null,
      partnerEndUserRef: null,
      status: 'bot_active',
      testMode: false,
    }
    state.sessionRow = null
    state.updateCalls = []
    state.promptConfig = { joinGreeting: null }
  })

  it('GET returns 404 for a clio_session_ref that does not resolve to a real partner_sessions row', async () => {
    state.session = null
    const res = await GET(makeRequest(), { params: { clio_session_ref: 'nonexistent' } })
    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({ error: 'not_found' })
  })

  it('GET returns { pending: false, greeting_text: null } when join_greeting_pending is false', async () => {
    state.sessionRow = { join_greeting_pending: false, join_greeting_participant_first_name: null, assembled_prompt_snapshot: FULL_PROMPT }
    const res = await GET(makeRequest(), { params: { clio_session_ref: 'session-1' } })
    expect(await res.json()).toEqual({ pending: false, greeting_text: null })
  })

  // v1.1 fix verification — the core regression test for the flaw the CEO
  // Agent identified in v1.0 (sending the addendum alone would have wiped
  // the active Hume prompt under session_settings.system_prompt's confirmed
  // full-replace semantics).
  it('(v1.1 fix) greeting_text always begins with the full assembled_prompt_snapshot as a literal prefix, never the addendum alone', async () => {
    state.sessionRow = {
      join_greeting_pending: true,
      join_greeting_participant_first_name: 'Jane',
      assembled_prompt_snapshot: FULL_PROMPT,
    }

    const res = await GET(makeRequest(), { params: { clio_session_ref: 'session-1' } })
    const body = await res.json() as { pending: boolean; greeting_text: string }

    expect(body.pending).toBe(true)
    expect(body.greeting_text.startsWith(FULL_PROMPT)).toBe(true)
    expect(body.greeting_text).toContain('\n\n[SYSTEM] A participant just joined the call.')
    expect(body.greeting_text).toContain('Jane')
  })

  it('(v1.1 fix) missing/empty assembled_prompt_snapshot: no greeting sent (never falls back to the addendum alone), flag is cleared, console.warn is logged', async () => {
    state.sessionRow = {
      join_greeting_pending: true,
      join_greeting_participant_first_name: 'Jane',
      assembled_prompt_snapshot: null,
    }
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    const res = await GET(makeRequest(), { params: { clio_session_ref: 'session-1' } })
    const body = await res.json()

    expect(body).toEqual({ pending: false, greeting_text: null })
    expect(warnSpy).toHaveBeenCalled()
    expect(state.updateCalls).toContainEqual({ join_greeting_pending: false, join_greeting_participant_first_name: null })

    warnSpy.mockRestore()
  })

  it('a configured literal-mode join_greeting field renders the "say exactly" framing with {firstName} substituted', async () => {
    state.sessionRow = {
      join_greeting_pending: true,
      join_greeting_participant_first_name: 'Sam',
      assembled_prompt_snapshot: FULL_PROMPT,
    }
    state.promptConfig = { joinGreeting: { mode: 'literal', text: 'Hey {firstName}, glad you could make it!' } }

    const res = await GET(makeRequest(), { params: { clio_session_ref: 'session-1' } })
    const body = await res.json() as { greeting_text: string }

    expect(body.greeting_text).toContain('Say exactly the following, verbatim and naturally: "Hey Sam, glad you could make it!"')
  })

  it('an unconfigured join_greeting field uses DEFAULT_JOIN_GREETING verbatim, with {firstName} substituted', async () => {
    state.sessionRow = {
      join_greeting_pending: true,
      join_greeting_participant_first_name: 'Alex',
      assembled_prompt_snapshot: FULL_PROMPT,
    }
    state.promptConfig = { joinGreeting: null }

    const res = await GET(makeRequest(), { params: { clio_session_ref: 'session-1' } })
    const body = await res.json() as { greeting_text: string }

    expect(body.greeting_text).toContain('The participant, Alex, just joined the call.')
    expect(body.greeting_text).not.toContain('{firstName}')
  })

  it('PATCH clears join_greeting_pending and the stored first name', async () => {
    const res = await PATCH(makeRequest(), { params: { clio_session_ref: 'session-1' } })
    expect(await res.json()).toEqual({ ok: true })
    expect(state.updateCalls).toContainEqual({ join_greeting_pending: false, join_greeting_participant_first_name: null })
  })

  it('PATCH returns 404 for a clio_session_ref that does not resolve to a real row', async () => {
    state.session = null
    const res = await PATCH(makeRequest(), { params: { clio_session_ref: 'nonexistent' } })
    expect(res.status).toBe(404)
  })
})
