import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireSuperAdmin } from '@/lib/internal-admin/auth'
import { createSupabaseAdminClient } from '@/lib/supabase'
import { OPENAI_REALTIME_ADAPTER_AVAILABLE } from '@/lib/voice/provider-availability'

/**
 * GET/PATCH /api/admin/voice-config
 *
 * B2B-61 Part B (docs/specs/B2B-61-requirement-document.md §6). Reads/writes the single, global
 * `system_voice_config` row that controls which live-voice provider new partner sessions use
 * platform-wide. `requireSuperAdmin()`-gated on both verbs, mirroring every other route under
 * `app/api/admin/`. Mirrors `app/api/admin/configurator/theme/route.ts`'s GET+PATCH-in-one-file
 * shape and `PatchSchema`/error-envelope conventions — the closer precedent for a plain
 * single-resource read/write than `demo-access`'s split GET/regenerate-POST shape.
 */

const SINGLETON_ID = '00000000-0000-0000-0000-000000000001'

export async function GET() {
  const admin = await requireSuperAdmin()
  if (admin.error) return admin.error

  const supabase = createSupabaseAdminClient()
  const { data, error } = await supabase
    .from('system_voice_config')
    .select('active_provider, updated_at')
    .eq('id', SINGLETON_ID)
    .maybeSingle()

  if (error || !data) {
    return NextResponse.json({ error: 'Failed to load voice provider settings.' }, { status: 500 })
  }

  return NextResponse.json({
    active_provider: data.active_provider as 'hume' | 'openai_realtime',
    updated_at: data.updated_at as string,
    openai_realtime_available: OPENAI_REALTIME_ADAPTER_AVAILABLE,
  })
}

const PatchSchema = z.object({ active_provider: z.enum(['hume', 'openai_realtime']) })

export async function PATCH(request: NextRequest) {
  const admin = await requireSuperAdmin()
  if (admin.error) return admin.error

  const body = await request.json().catch(() => null)
  const parsed = PatchSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Validation failed', details: parsed.error.flatten() }, { status: 400 })
  }

  // Defense-in-depth: the UI never lets an admin select 'openai_realtime' while the adapter isn't
  // available (disabled tile), but a direct API call must be rejected the same way — the disabled
  // tile is not itself a security boundary (§6, §11).
  if (parsed.data.active_provider === 'openai_realtime' && !OPENAI_REALTIME_ADAPTER_AVAILABLE) {
    return NextResponse.json({ error: 'OpenAI Realtime is not yet available.' }, { status: 400 })
  }

  const supabase = createSupabaseAdminClient()
  const { data, error } = await supabase
    .from('system_voice_config')
    .update({ active_provider: parsed.data.active_provider })
    .eq('id', SINGLETON_ID)
    .select('active_provider, updated_at')
    .single()

  if (error || !data) {
    // Never leaks DB error detail into the response (CLAUDE.md's secrets/internals rule).
    return NextResponse.json({ error: 'Failed to save.' }, { status: 500 })
  }

  return NextResponse.json({
    active_provider: data.active_provider as 'hume' | 'openai_realtime',
    updated_at: data.updated_at as string,
  })
}
