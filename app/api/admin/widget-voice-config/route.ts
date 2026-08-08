import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireSuperAdmin } from '@/lib/internal-admin/auth'
import { createSupabaseAdminClient } from '@/lib/supabase'
import { encryptOutboundToken } from '@/lib/partner/crypto'
import { ELEVENLABS_ADAPTER_AVAILABLE, OPENAI_REALTIME_ADAPTER_AVAILABLE } from '@/lib/voice/provider-availability'

/**
 * GET/PATCH /api/admin/widget-voice-config
 *
 * B2B-75 (docs/specs/B2B-75-requirement-document.md §6.2, §6.12) — reads/writes the WIDGET
 * channel's own provider setting plus the platform-level ElevenLabs credentials, on the same
 * `system_voice_config` singleton row.
 *
 * DELIBERATELY A SEPARATE ROUTE FROM /api/admin/voice-config, which is untouched. That route owns
 * `active_provider`, which drives the inline / meeting-bot channel (`partner-render`) and keeps its
 * existing two-value domain. Widening THAT setting to include 'elevenlabs' — the obvious
 * implementation — would route live meeting-bot sessions to a provider with no adapter wiring and
 * no prompt on that path. Two channels, two settings, two routes, two cards (Decision D2).
 *
 * `requireSuperAdmin()`-gated on both verbs, mirroring every other route under `app/api/admin/`.
 *
 * THE API KEY IS WRITE-ONLY FROM THE ADMIN UI'S PERSPECTIVE. GET returns only the boolean
 * `elevenlabs_api_key_set` — the stored key is never decrypted on this path and never leaves the
 * server, exactly mirroring `app/api/admin/configurator/outbound-config/route.ts`'s
 * `outbound_auth_token_set`. A `••••a1b2` last-four hint was considered and rejected: it would
 * require either decrypting the live secret on every admin page load or storing a plaintext
 * fragment of it in a new column, and a boolean carries the same operator information ("is it
 * set?") with zero secret material crossing the boundary.
 */

const SINGLETON_ID = '00000000-0000-0000-0000-000000000001'

type WidgetProvider = 'hume' | 'openai_realtime' | 'elevenlabs'
type BlockedReason = 'flag' | 'api_key' | 'agent_id' | null

interface ConfigRow {
  widget_provider: string
  elevenlabs_agent_id: string | null
  elevenlabs_api_key_ciphertext: string | null
  updated_at: string
}

/**
 * §6.3 — derived availability, computed SERVER-SIDE and never trusted from the client. Order
 * matters: 'flag' outranks both credential reasons, and 'api_key' is checked before 'agent_id'
 * because migration 111 seeds the agent id, making the missing key the overwhelmingly likely cause
 * — the admin's caption should name the credential they actually have to go and fetch.
 */
function deriveAvailability(hasApiKey: boolean, hasAgentId: boolean): {
  available: boolean
  reason: BlockedReason
} {
  if (!ELEVENLABS_ADAPTER_AVAILABLE) return { available: false, reason: 'flag' }
  if (!hasApiKey) return { available: false, reason: 'api_key' }
  if (!hasAgentId) return { available: false, reason: 'agent_id' }
  return { available: true, reason: null }
}

function buildResponseBody(row: ConfigRow) {
  const hasApiKey = Boolean(row.elevenlabs_api_key_ciphertext)
  const hasAgentId = Boolean(row.elevenlabs_agent_id)
  const { available, reason } = deriveAvailability(hasApiKey, hasAgentId)

  return {
    widget_provider: row.widget_provider as WidgetProvider,
    elevenlabs_agent_id: row.elevenlabs_agent_id,
    // Boolean only. The ciphertext and the plaintext key never appear in any response, in any
    // branch (AT-17).
    elevenlabs_api_key_set: hasApiKey,
    openai_realtime_available: OPENAI_REALTIME_ADAPTER_AVAILABLE,
    elevenlabs_available: available,
    elevenlabs_blocked_reason: reason,
    updated_at: row.updated_at,
  }
}

const SELECT_COLUMNS = 'widget_provider, elevenlabs_agent_id, elevenlabs_api_key_ciphertext, updated_at'

export async function GET() {
  const admin = await requireSuperAdmin()
  if (admin.error) return admin.error

  const supabase = createSupabaseAdminClient()
  const { data, error } = await supabase
    .from('system_voice_config')
    .select(SELECT_COLUMNS)
    .eq('id', SINGLETON_ID)
    .maybeSingle()

  if (error || !data) {
    return NextResponse.json({ error: 'Failed to load widget voice settings.' }, { status: 500 })
  }

  return NextResponse.json(buildResponseBody(data as unknown as ConfigRow))
}

const PatchSchema = z
  .object({
    widget_provider: z.enum(['hume', 'openai_realtime', 'elevenlabs']).optional(),
    elevenlabs_agent_id: z.string().trim().min(1).max(200).optional(),
    // `.trim()` matters: a trailing newline from a clipboard paste would otherwise be encrypted
    // along with the key and produce an opaque 401 from ElevenLabs much later.
    elevenlabs_api_key: z.string().trim().min(1).max(500).optional(),
  })
  .refine(
    (v) =>
      v.widget_provider !== undefined ||
      v.elevenlabs_agent_id !== undefined ||
      v.elevenlabs_api_key !== undefined,
    { message: 'No fields to update' }
  )

export async function PATCH(request: NextRequest) {
  const admin = await requireSuperAdmin()
  if (admin.error) return admin.error

  const body = await request.json().catch(() => null)
  const parsed = PatchSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Validation failed', details: parsed.error.flatten() }, { status: 400 })
  }

  const supabase = createSupabaseAdminClient()
  const { data: currentData, error: readError } = await supabase
    .from('system_voice_config')
    .select(SELECT_COLUMNS)
    .eq('id', SINGLETON_ID)
    .maybeSingle()

  if (readError || !currentData) {
    return NextResponse.json({ error: 'Failed to save.' }, { status: 500 })
  }
  const current = currentData as unknown as ConfigRow

  // Server-side gates, all BEFORE any write. A disabled tile is a UI affordance, not a security
  // boundary — a direct API call must be rejected identically. Same defense-in-depth reasoning as
  // voice-config/route.ts's existing OPENAI_REALTIME_ADAPTER_AVAILABLE check.
  if (parsed.data.widget_provider === 'openai_realtime' && !OPENAI_REALTIME_ADAPTER_AVAILABLE) {
    return NextResponse.json({ error: 'openai_realtime_not_available' }, { status: 400 })
  }
  if (parsed.data.widget_provider === 'elevenlabs' && !ELEVENLABS_ADAPTER_AVAILABLE) {
    return NextResponse.json({ error: 'elevenlabs_not_available' }, { status: 400 })
  }
  if (parsed.data.widget_provider === 'elevenlabs') {
    // Evaluated against the POST-WRITE state, so a single request that supplies the key AND selects
    // ElevenLabs in one round trip is accepted.
    const resolvedApiKeySet = parsed.data.elevenlabs_api_key !== undefined || Boolean(current.elevenlabs_api_key_ciphertext)
    const resolvedAgentId = parsed.data.elevenlabs_agent_id ?? current.elevenlabs_agent_id
    if (!resolvedApiKeySet) {
      return NextResponse.json({ error: 'elevenlabs_api_key_missing' }, { status: 400 })
    }
    if (!resolvedAgentId) {
      return NextResponse.json({ error: 'elevenlabs_agent_id_missing' }, { status: 400 })
    }
  }

  const patch: Record<string, string> = {}
  if (parsed.data.widget_provider !== undefined) patch.widget_provider = parsed.data.widget_provider
  if (parsed.data.elevenlabs_agent_id !== undefined) patch.elevenlabs_agent_id = parsed.data.elevenlabs_agent_id
  if (parsed.data.elevenlabs_api_key !== undefined) {
    // Encrypted on the way in — the plaintext key is never logged, never stored, and never echoed.
    patch.elevenlabs_api_key_ciphertext = encryptOutboundToken(parsed.data.elevenlabs_api_key)
  }

  const { data, error } = await supabase
    .from('system_voice_config')
    .update(patch)
    .eq('id', SINGLETON_ID)
    .select(SELECT_COLUMNS)
    .single()

  if (error || !data) {
    // Never leaks DB error detail into the response (CLAUDE.md's secrets/internals rule).
    return NextResponse.json({ error: 'Failed to save.' }, { status: 500 })
  }

  // Same shape as GET, recomputed post-write, so the card can update elevenlabs_available /
  // elevenlabs_blocked_reason without a second request.
  return NextResponse.json(buildResponseBody(data as unknown as ConfigRow))
}
