import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { NextResponse } from 'next/server'

/**
 * B2B-75 (docs/specs/B2B-75-requirement-document.md §13.2) — integration coverage for the three
 * server-side surfaces this feature adds or touches:
 *
 *   A. GET/PATCH /api/admin/widget-voice-config  (§6.2, §6.12 — AT-13, AT-17, AT-18)
 *   B. GET /api/elevenlabs-token                 (§6.4 — AT-14, AT-16's server half)
 *   C. inngest/partner-session-insights-extractor's widened voice_provider branch (§6.9 — AT-7)
 *
 * All three live in one file because §10.A's Files-Changed list is exhaustive and names exactly two
 * new test files; every assertion §13.2 calls for is present here. Everything is provable without a
 * real ElevenLabs API key — the outbound `fetch` is mocked and the stored credential is a test
 * string encrypted through the REAL `lib/partner/crypto.ts` (deliberately not mocked, so the
 * "genuinely encrypted, not stored raw" assertion means something).
 */

process.env.ANTHROPIC_API_KEY = 'PLACEHOLDER_TEST_KEY'
process.env.HUME_API_KEY = 'test-hume-key-not-real'

// ─── Shared mock state ────────────────────────────────────────────────────────────────────────

interface VoiceConfigRow {
  widget_provider: string
  elevenlabs_agent_id: string | null
  elevenlabs_api_key_ciphertext: string | null
  updated_at: string
}

interface FakePartnerSession {
  id: string
  partner_account_id: string
  hume_chat_id: string | null
  test_mode: boolean
  partner_reference: string | null
  end_client_id: string | null
  reseller_unique_id?: string | null
  hume_config_id?: string | null
  voice_provider?: 'hume' | 'openai_realtime' | 'elevenlabs' | null
  delivery_channel?: string | null
}

interface FakeInsightsRow {
  extraction_status: 'pending' | 'success' | 'success_empty' | 'failed'
  attempt_count: number
}

const db = {
  voiceConfigRow: null as VoiceConfigRow | null,
  voiceConfigSelectError: null as { message: string } | null,
  voiceConfigUpdateError: null as { message: string } | null,
  voiceConfigUpdateCalls: [] as Record<string, unknown>[],
  partnerSessionsById: {} as Record<string, FakePartnerSession | undefined>,
  insightsBySession: {} as Record<string, FakeInsightsRow | undefined>,
}

const auth = {
  superAdminError: null as NextResponse | null,
}

const flags = {
  openaiAvailable: true,
  elevenlabsAvailable: true,
}

vi.mock('@/lib/internal-admin/auth', () => ({
  requireSuperAdmin: vi.fn(() =>
    Promise.resolve(
      auth.superAdminError
        ? { role: null, clerkUserId: null, internalAdminUserId: null, scopedPartnerAccountIds: null, error: auth.superAdminError }
        : { role: 'super_admin', clerkUserId: 'clerk-admin-1', internalAdminUserId: 'internal-1', scopedPartnerAccountIds: null, error: null }
    )
  ),
}))

vi.mock('@/lib/voice/provider-availability', () => ({
  get OPENAI_REALTIME_ADAPTER_AVAILABLE() {
    return flags.openaiAvailable
  },
  get ELEVENLABS_ADAPTER_AVAILABLE() {
    return flags.elevenlabsAvailable
  },
}))

vi.mock('@/lib/supabase', () => ({
  createSupabaseAdminClient: () => ({
    from: (table: string) => {
      if (table === 'system_voice_config') {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: db.voiceConfigRow, error: db.voiceConfigSelectError }),
            }),
          }),
          update: (patch: Record<string, unknown>) => {
            db.voiceConfigUpdateCalls.push(patch)
            return {
              eq: () => ({
                select: () => ({
                  single: async () => {
                    if (db.voiceConfigUpdateError) return { data: null, error: db.voiceConfigUpdateError }
                    db.voiceConfigRow = { ...(db.voiceConfigRow as VoiceConfigRow), ...patch, updated_at: '2026-08-08T01:00:00.000Z' } as VoiceConfigRow
                    return { data: db.voiceConfigRow, error: null }
                  },
                }),
              }),
            }
          },
        }
      }

      if (table === 'partner_sessions') {
        return {
          select: () => ({
            eq: (_col: string, val: string) => ({
              limit: async () => ({ data: db.partnerSessionsById[val] ? [db.partnerSessionsById[val]] : [], error: null }),
            }),
          }),
          update: () => ({
            eq: async () => ({ error: null }),
          }),
        }
      }

      if (table === 'partner_session_insights') {
        return {
          select: () => ({
            eq: (_col: string, val: string) => ({
              limit: async () => ({ data: db.insightsBySession[val] ? [db.insightsBySession[val]] : [], error: null }),
            }),
          }),
          upsert: (row: Record<string, unknown>) => ({
            select: async () => {
              const sessionId = row.partner_session_id as string
              if (db.insightsBySession[sessionId]) return { data: [], error: null }
              db.insightsBySession[sessionId] = {
                extraction_status: (row.extraction_status as FakeInsightsRow['extraction_status']) ?? 'pending',
                attempt_count: 0,
              }
              return { data: [{ extraction_status: 'pending' }], error: null }
            },
          }),
          update: (fields: Record<string, unknown>) => ({
            eq: async (_col: string, val: string) => {
              const prior = db.insightsBySession[val] ?? { extraction_status: 'pending' as const, attempt_count: 0 }
              db.insightsBySession[val] = {
                extraction_status: (fields.extraction_status as FakeInsightsRow['extraction_status']) ?? prior.extraction_status,
                attempt_count: prior.attempt_count,
              }
              return { error: null }
            },
          }),
        }
      }

      throw new Error(`Unexpected table in test mock: ${table}`)
    },
  }),
}))

const fetchAllTranscriptEventsMock = vi.fn()
vi.mock('@/lib/voice/hume-native/session-details', () => ({
  fetchAllTranscriptEvents: (...args: unknown[]) => fetchAllTranscriptEventsMock(...args),
}))

const recordInsightsReadyEventMock = vi.fn()
vi.mock('@/lib/partner/webhooks', () => ({
  recordInsightsReadyEvent: (...args: unknown[]) => recordInsightsReadyEventMock(...args),
}))

const getStoredTranscriptTurnsMock = vi.fn()
vi.mock('@/lib/voice/openai-realtime-transcript-store', async () => {
  const actual = await vi.importActual<typeof import('@/lib/voice/openai-realtime-transcript-store')>(
    '@/lib/voice/openai-realtime-transcript-store'
  )
  return {
    ...actual,
    getStoredTranscriptTurns: (...args: unknown[]) => getStoredTranscriptTurnsMock(...args),
    deleteStoredTranscript: vi.fn(),
  }
})

// ─── Helpers ──────────────────────────────────────────────────────────────────────────────────

const REAL_KEY = 'sk_elevenlabs_test_value_never_real'

function makeRequest(body: unknown) {
  return { json: () => Promise.resolve(body) } as unknown as Parameters<
    typeof import('@/app/api/admin/widget-voice-config/route').PATCH
  >[0]
}

function defaultVoiceConfigRow(overrides: Partial<VoiceConfigRow> = {}): VoiceConfigRow {
  return {
    widget_provider: 'openai_realtime',
    elevenlabs_agent_id: 'agent_0701krp1ta48fswrff17ctb0520m',
    elevenlabs_api_key_ciphertext: null,
    updated_at: '2026-08-08T00:00:00.000Z',
    ...overrides,
  }
}

let consoleErrorSpy: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  vi.clearAllMocks()
  db.voiceConfigRow = defaultVoiceConfigRow()
  db.voiceConfigSelectError = null
  db.voiceConfigUpdateError = null
  db.voiceConfigUpdateCalls = []
  db.partnerSessionsById = {}
  db.insightsBySession = {}
  auth.superAdminError = null
  flags.openaiAvailable = true
  flags.elevenlabsAvailable = true
  fetchAllTranscriptEventsMock.mockReset()
  recordInsightsReadyEventMock.mockReset()
  getStoredTranscriptTurnsMock.mockReset()
  consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  consoleErrorSpy.mockRestore()
  vi.unstubAllGlobals()
})

function loggedText(): string {
  return (consoleErrorSpy.mock.calls as unknown[][])
    .map((args) => args.map((a) => String(a)).join(' '))
    .join('\n')
}

// ═══ A. GET/PATCH /api/admin/widget-voice-config ══════════════════════════════════════════════

describe('GET /api/admin/widget-voice-config', () => {
  it('AT-25: on the day-one state, returns the seeded agent id, api_key_set false, and blocked_reason api_key', async () => {
    const { GET } = await import('@/app/api/admin/widget-voice-config/route')
    const res = await GET()
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.widget_provider).toBe('openai_realtime')
    expect(body.elevenlabs_agent_id).toBe('agent_0701krp1ta48fswrff17ctb0520m')
    expect(body.elevenlabs_api_key_set).toBe(false)
    expect(body.elevenlabs_available).toBe(false)
    expect(body.elevenlabs_blocked_reason).toBe('api_key')
  })

  it('AT-17: never returns the ciphertext or the plaintext key, under any stored state', async () => {
    const { encryptOutboundToken } = await import('@/lib/partner/crypto')
    const ciphertext = encryptOutboundToken(REAL_KEY)
    db.voiceConfigRow = defaultVoiceConfigRow({ elevenlabs_api_key_ciphertext: ciphertext })

    const { GET } = await import('@/app/api/admin/widget-voice-config/route')
    const res = await GET()
    const body = await res.json()
    const serialized = JSON.stringify(body)

    expect(body.elevenlabs_api_key_set).toBe(true)
    expect(serialized).not.toContain(REAL_KEY)
    expect(serialized).not.toContain(ciphertext)
    expect(serialized).not.toContain('ciphertext')
  })

  it('reports elevenlabs_available true and blocked_reason null once both credentials are present', async () => {
    const { encryptOutboundToken } = await import('@/lib/partner/crypto')
    db.voiceConfigRow = defaultVoiceConfigRow({ elevenlabs_api_key_ciphertext: encryptOutboundToken(REAL_KEY) })

    const { GET } = await import('@/app/api/admin/widget-voice-config/route')
    const body = await (await GET()).json()

    expect(body.elevenlabs_available).toBe(true)
    expect(body.elevenlabs_blocked_reason).toBeNull()
  })

  it("blocked_reason is 'flag' when the availability flag is off, outranking both credential reasons", async () => {
    flags.elevenlabsAvailable = false
    const { encryptOutboundToken } = await import('@/lib/partner/crypto')
    db.voiceConfigRow = defaultVoiceConfigRow({ elevenlabs_api_key_ciphertext: encryptOutboundToken(REAL_KEY) })

    const { GET } = await import('@/app/api/admin/widget-voice-config/route')
    const body = await (await GET()).json()

    expect(body.elevenlabs_available).toBe(false)
    expect(body.elevenlabs_blocked_reason).toBe('flag')
  })

  it("blocked_reason is 'agent_id' when the key is present but the seeded agent id was cleared", async () => {
    const { encryptOutboundToken } = await import('@/lib/partner/crypto')
    db.voiceConfigRow = defaultVoiceConfigRow({
      elevenlabs_api_key_ciphertext: encryptOutboundToken(REAL_KEY),
      elevenlabs_agent_id: null,
    })

    const { GET } = await import('@/app/api/admin/widget-voice-config/route')
    const body = await (await GET()).json()
    expect(body.elevenlabs_blocked_reason).toBe('agent_id')
  })

  it('AT-18: propagates requireSuperAdmin\'s rejection unchanged and returns nothing', async () => {
    auth.superAdminError = NextResponse.json({ error: { code: 'forbidden' } }, { status: 403 })
    const { GET } = await import('@/app/api/admin/widget-voice-config/route')
    const res = await GET()
    expect(res.status).toBe(403)
  })

  it('500s with a generic message when the singleton row is missing', async () => {
    db.voiceConfigRow = null
    const { GET } = await import('@/app/api/admin/widget-voice-config/route')
    const res = await GET()
    expect(res.status).toBe(500)
  })
})

describe('PATCH /api/admin/widget-voice-config', () => {
  it('400s with the Zod envelope on an empty body, never touching the DB', async () => {
    const { PATCH } = await import('@/app/api/admin/widget-voice-config/route')
    const res = await PATCH(makeRequest({}))
    const body = await res.json()
    expect(res.status).toBe(400)
    expect(body.error).toBe('Validation failed')
    expect(body.details).toBeDefined()
    expect(db.voiceConfigUpdateCalls).toHaveLength(0)
  })

  it('400s on an out-of-domain provider value', async () => {
    const { PATCH } = await import('@/app/api/admin/widget-voice-config/route')
    const res = await PATCH(makeRequest({ widget_provider: 'not-a-provider' }))
    expect(res.status).toBe(400)
    expect(db.voiceConfigUpdateCalls).toHaveLength(0)
  })

  it('AT-13: selecting elevenlabs with no stored API key returns 400 elevenlabs_api_key_missing and writes nothing', async () => {
    const { PATCH } = await import('@/app/api/admin/widget-voice-config/route')
    const res = await PATCH(makeRequest({ widget_provider: 'elevenlabs' }))
    const body = await res.json()
    expect(res.status).toBe(400)
    expect(body.error).toBe('elevenlabs_api_key_missing')
    expect(db.voiceConfigUpdateCalls).toHaveLength(0)
    expect(db.voiceConfigRow!.widget_provider).toBe('openai_realtime')
  })

  it('selecting elevenlabs with a key but a cleared agent id returns 400 elevenlabs_agent_id_missing and writes nothing', async () => {
    const { encryptOutboundToken } = await import('@/lib/partner/crypto')
    db.voiceConfigRow = defaultVoiceConfigRow({
      elevenlabs_api_key_ciphertext: encryptOutboundToken(REAL_KEY),
      elevenlabs_agent_id: null,
    })
    const { PATCH } = await import('@/app/api/admin/widget-voice-config/route')
    const res = await PATCH(makeRequest({ widget_provider: 'elevenlabs' }))
    const body = await res.json()
    expect(res.status).toBe(400)
    expect(body.error).toBe('elevenlabs_agent_id_missing')
    expect(db.voiceConfigUpdateCalls).toHaveLength(0)
  })

  it('accepts the API key AND the provider selection in ONE request (post-write evaluation, §6.12 gate 3)', async () => {
    const { PATCH } = await import('@/app/api/admin/widget-voice-config/route')
    const res = await PATCH(makeRequest({ widget_provider: 'elevenlabs', elevenlabs_api_key: REAL_KEY }))
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body.widget_provider).toBe('elevenlabs')
    expect(body.elevenlabs_api_key_set).toBe(true)
    expect(body.elevenlabs_available).toBe(true)
    expect(body.elevenlabs_blocked_reason).toBeNull()
  })

  it('400s elevenlabs_not_available when the adapter flag is off, writing nothing', async () => {
    flags.elevenlabsAvailable = false
    const { PATCH } = await import('@/app/api/admin/widget-voice-config/route')
    const res = await PATCH(makeRequest({ widget_provider: 'elevenlabs', elevenlabs_api_key: REAL_KEY }))
    const body = await res.json()
    expect(res.status).toBe(400)
    expect(body.error).toBe('elevenlabs_not_available')
    expect(db.voiceConfigUpdateCalls).toHaveLength(0)
  })

  it('400s openai_realtime_not_available when THAT flag is off, writing nothing', async () => {
    flags.openaiAvailable = false
    const { PATCH } = await import('@/app/api/admin/widget-voice-config/route')
    const res = await PATCH(makeRequest({ widget_provider: 'openai_realtime' }))
    const body = await res.json()
    expect(res.status).toBe(400)
    expect(body.error).toBe('openai_realtime_not_available')
    expect(db.voiceConfigUpdateCalls).toHaveLength(0)
  })

  it('stores the API key GENUINELY ENCRYPTED — never raw — and it round-trips back to the original plaintext', async () => {
    const { PATCH } = await import('@/app/api/admin/widget-voice-config/route')
    const res = await PATCH(makeRequest({ elevenlabs_api_key: REAL_KEY }))
    expect(res.status).toBe(200)

    const stored = db.voiceConfigUpdateCalls[0].elevenlabs_api_key_ciphertext as string
    expect(stored).toBeTruthy()
    expect(stored).not.toBe(REAL_KEY)
    expect(stored.startsWith('v1:')).toBe(true)

    const { decryptOutboundToken } = await import('@/lib/partner/crypto')
    expect(decryptOutboundToken(stored)).toBe(REAL_KEY)
  })

  it('never echoes the plaintext key back in the response or into a log line', async () => {
    const { PATCH } = await import('@/app/api/admin/widget-voice-config/route')
    const res = await PATCH(makeRequest({ elevenlabs_api_key: REAL_KEY }))
    const body = await res.json()
    expect(JSON.stringify(body)).not.toContain(REAL_KEY)
    expect(loggedText()).not.toContain(REAL_KEY)
  })

  it('trims whitespace-padded credential pastes before encryption/storage', async () => {
    const { PATCH } = await import('@/app/api/admin/widget-voice-config/route')
    await PATCH(makeRequest({ elevenlabs_api_key: `  ${REAL_KEY}\n` }))
    const stored = db.voiceConfigUpdateCalls[0].elevenlabs_api_key_ciphertext as string
    const { decryptOutboundToken } = await import('@/lib/partner/crypto')
    expect(decryptOutboundToken(stored)).toBe(REAL_KEY)
  })

  it('updates only the fields supplied — a provider-only save never touches the credentials', async () => {
    const { PATCH } = await import('@/app/api/admin/widget-voice-config/route')
    const res = await PATCH(makeRequest({ widget_provider: 'hume' }))
    expect(res.status).toBe(200)
    expect(db.voiceConfigUpdateCalls[0]).toEqual({ widget_provider: 'hume' })
  })

  it('AT-18: propagates requireSuperAdmin\'s rejection unchanged, never touching the DB', async () => {
    auth.superAdminError = NextResponse.json({ error: { code: 'forbidden' } }, { status: 403 })
    const { PATCH } = await import('@/app/api/admin/widget-voice-config/route')
    const res = await PATCH(makeRequest({ widget_provider: 'hume' }))
    expect(res.status).toBe(403)
    expect(db.voiceConfigUpdateCalls).toHaveLength(0)
  })

  it('500s generically on an unexpected DB failure, never leaking DB error detail', async () => {
    db.voiceConfigUpdateError = { message: 'connection dropped: internal-secret-detail' }
    const { PATCH } = await import('@/app/api/admin/widget-voice-config/route')
    const res = await PATCH(makeRequest({ widget_provider: 'hume' }))
    const body = await res.json()
    expect(res.status).toBe(500)
    expect(body.error).toBe('Failed to save.')
    expect(JSON.stringify(body)).not.toContain('internal-secret-detail')
  })
})

// ═══ B. GET /api/elevenlabs-token ═════════════════════════════════════════════════════════════

describe('GET /api/elevenlabs-token', () => {
  function stubFetch(impl: (url: string, init?: RequestInit) => Promise<Response> | Response) {
    const spy = vi.fn(impl as unknown as typeof fetch)
    vi.stubGlobal('fetch', spy)
    return spy
  }

  function jsonResponse(body: unknown, status = 200): Response {
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => body,
      text: async () => JSON.stringify(body),
    } as unknown as Response
  }

  async function seedConfiguredKey() {
    const { encryptOutboundToken } = await import('@/lib/partner/crypto')
    db.voiceConfigRow = defaultVoiceConfigRow({ elevenlabs_api_key_ciphertext: encryptOutboundToken(REAL_KEY) })
  }

  it('500s when no credentials are configured, without logging any ciphertext', async () => {
    db.voiceConfigRow = defaultVoiceConfigRow({ elevenlabs_api_key_ciphertext: null })
    const { GET } = await import('@/app/api/elevenlabs-token/route')
    const res = await GET()
    const body = await res.json()
    expect(res.status).toBe(500)
    expect(body.error).toBe('ElevenLabs credentials not configured')
    expect(res.headers.get('Cache-Control')).toBe('no-store')
  })

  it('500s when the stored ciphertext cannot be decrypted, leaking neither ciphertext nor plaintext', async () => {
    db.voiceConfigRow = defaultVoiceConfigRow({ elevenlabs_api_key_ciphertext: 'v1:corrupt:corrupt:corrupt' })
    const { GET } = await import('@/app/api/elevenlabs-token/route')
    const res = await GET()
    const body = await res.json()
    expect(res.status).toBe(500)
    expect(body.error).toBe('ElevenLabs credentials could not be read')
    expect(loggedText()).not.toContain('v1:corrupt:corrupt:corrupt')
  })

  it('AT-14: 502s when ElevenLabs rejects the key, with the key in neither the body nor any log line', async () => {
    await seedConfiguredKey()
    stubFetch(() => jsonResponse({ detail: 'invalid api key' }, 401))

    const { GET } = await import('@/app/api/elevenlabs-token/route')
    const res = await GET()
    const body = await res.json()

    expect(res.status).toBe(502)
    expect(body.error).toBe('Failed to obtain ElevenLabs conversation token')
    expect(JSON.stringify(body)).not.toContain(REAL_KEY)
    expect(loggedText()).not.toContain(REAL_KEY)
  })

  it('502s when the response is missing a token field', async () => {
    await seedConfiguredKey()
    stubFetch(() => jsonResponse({ conversation_id: 'conv_1' }, 200))

    const { GET } = await import('@/app/api/elevenlabs-token/route')
    const res = await GET()
    const body = await res.json()
    expect(res.status).toBe(502)
    expect(body.error).toBe('Unexpected response from ElevenLabs conversation-token endpoint')
  })

  it('200s with { conversationToken, agentId } and deliberately omits conversation_id', async () => {
    await seedConfiguredKey()
    stubFetch(() => jsonResponse({ token: 'conv_token_xyz', conversation_id: 'conv_should_not_leak' }, 200))

    const { GET } = await import('@/app/api/elevenlabs-token/route')
    const res = await GET()
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body).toEqual({ conversationToken: 'conv_token_xyz', agentId: 'agent_0701krp1ta48fswrff17ctb0520m' })
    expect(JSON.stringify(body)).not.toContain('conv_should_not_leak')
    expect(JSON.stringify(body)).not.toContain(REAL_KEY)
    expect(res.headers.get('Cache-Control')).toBe('no-store')
  })

  it("targets /v1/convai/conversation/token with the xi-api-key header and cache: 'no-store'", async () => {
    await seedConfiguredKey()
    const spy = stubFetch(() => jsonResponse({ token: 'conv_token_xyz' }, 200))

    const { GET } = await import('@/app/api/elevenlabs-token/route')
    await GET()

    const [url, init] = spy.mock.calls[0] as [string, RequestInit & { cache?: string }]
    expect(url).toContain('https://api.elevenlabs.io/v1/convai/conversation/token')
    expect(url).toContain('agent_id=agent_0701krp1ta48fswrff17ctb0520m')
    expect((init.headers as Record<string, string>)['xi-api-key']).toBe(REAL_KEY)
    // Mandatory: without this, Next.js's Data Cache would serve one token — and one
    // conversation_id — to every concurrent participant (§6.4).
    expect(init.cache).toBe('no-store')
  })

  it('502s rather than throwing when the outbound call itself fails', async () => {
    await seedConfiguredKey()
    stubFetch(() => Promise.reject(new Error('network down')))

    const { GET } = await import('@/app/api/elevenlabs-token/route')
    const res = await GET()
    expect(res.status).toBe(502)
  })
})

// ═══ C. inngest/partner-session-insights-extractor — the widened branch ═══════════════════════

describe('partner-session-insights-extractor — voice_provider branch (§6.9, AT-7)', () => {
  function seedSession(id: string, voiceProvider: FakePartnerSession['voice_provider']) {
    db.partnerSessionsById[id] = {
      id,
      partner_account_id: 'acct1',
      hume_chat_id: 'conv_provider_assigned_id',
      test_mode: false,
      partner_reference: null,
      end_client_id: null,
      reseller_unique_id: null,
      hume_config_id: null,
      voice_provider: voiceProvider,
      delivery_channel: 'widget',
    }
  }

  it("AT-7: an 'elevenlabs' session takes the Redis live-capture path and NEVER calls Hume's transcript API", async () => {
    seedSession('ps_eleven', 'elevenlabs')
    getStoredTranscriptTurnsMock.mockResolvedValue([
      { source: 'user', text: 'What is a context window?', at: 1 },
      { source: 'ai', text: 'It is the model working memory.', at: 2 },
    ])

    const { extractInsightsForPartnerSession } = await import('@/inngest/partner-session-insights-extractor')
    const result = await extractInsightsForPartnerSession('ps_eleven')

    expect(getStoredTranscriptTurnsMock).toHaveBeenCalledWith('ps_eleven')
    expect(fetchAllTranscriptEventsMock).not.toHaveBeenCalled()
    expect(result.status).not.toBe('failed')
  })

  it("an 'openai_realtime' session still takes the Redis path, unchanged", async () => {
    seedSession('ps_openai', 'openai_realtime')
    getStoredTranscriptTurnsMock.mockResolvedValue([{ source: 'ai', text: 'Hello.', at: 1 }])

    const { extractInsightsForPartnerSession } = await import('@/inngest/partner-session-insights-extractor')
    await extractInsightsForPartnerSession('ps_openai')

    expect(getStoredTranscriptTurnsMock).toHaveBeenCalledWith('ps_openai')
    expect(fetchAllTranscriptEventsMock).not.toHaveBeenCalled()
  })

  it("a 'hume' session still calls Hume's own transcript API, unchanged", async () => {
    seedSession('ps_hume', 'hume')
    fetchAllTranscriptEventsMock.mockResolvedValue([])

    const { extractInsightsForPartnerSession } = await import('@/inngest/partner-session-insights-extractor')
    await extractInsightsForPartnerSession('ps_hume')

    expect(fetchAllTranscriptEventsMock).toHaveBeenCalled()
    expect(getStoredTranscriptTurnsMock).not.toHaveBeenCalled()
  })

  it('a NULL voice_provider session still calls Hume\'s own transcript API, unchanged', async () => {
    seedSession('ps_null', null)
    fetchAllTranscriptEventsMock.mockResolvedValue([])

    const { extractInsightsForPartnerSession } = await import('@/inngest/partner-session-insights-extractor')
    await extractInsightsForPartnerSession('ps_null')

    expect(fetchAllTranscriptEventsMock).toHaveBeenCalled()
    expect(getStoredTranscriptTurnsMock).not.toHaveBeenCalled()
  })

  it("an 'elevenlabs' session with zero captured turns resolves to success_empty rather than throwing", async () => {
    seedSession('ps_eleven_empty', 'elevenlabs')
    getStoredTranscriptTurnsMock.mockResolvedValue([])

    const { extractInsightsForPartnerSession } = await import('@/inngest/partner-session-insights-extractor')
    const result = await extractInsightsForPartnerSession('ps_eleven_empty')

    expect(result.status).toBe('success_empty')
    expect(fetchAllTranscriptEventsMock).not.toHaveBeenCalled()
  })
})
