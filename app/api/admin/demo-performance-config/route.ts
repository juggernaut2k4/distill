import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireSuperAdmin } from '@/lib/internal-admin/auth'
import { createSupabaseAdminClient } from '@/lib/supabase'

/**
 * GET/PATCH /api/admin/demo-performance-config
 *
 * B2B-65 (docs/specs/B2B-65-requirement-document.md §6.5). Reads/writes the single, global
 * `system_demo_performance_config` row that controls whether newly-completed demo session
 * results get appended to the Performance tab's accumulating list. `requireSuperAdmin()`-gated
 * on both verbs, structurally identical to `/api/admin/voice-config/route.ts` (B2B-61 Part B).
 */

const SINGLETON_ID = '00000000-0000-0000-0000-000000000002'

export async function GET() {
  const admin = await requireSuperAdmin()
  if (admin.error) return admin.error

  const supabase = createSupabaseAdminClient()
  const { data, error } = await supabase
    .from('system_demo_performance_config')
    .select('append_enabled, updated_at')
    .eq('id', SINGLETON_ID)
    .maybeSingle()

  if (error || !data) {
    return NextResponse.json({ error: 'Failed to load demo performance settings.' }, { status: 500 })
  }

  return NextResponse.json({
    append_enabled: data.append_enabled as boolean,
    updated_at: data.updated_at as string,
  })
}

const PatchSchema = z.object({ append_enabled: z.boolean() })

export async function PATCH(request: NextRequest) {
  const admin = await requireSuperAdmin()
  if (admin.error) return admin.error

  const body = await request.json().catch(() => null)
  const parsed = PatchSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Validation failed', details: parsed.error.flatten() }, { status: 400 })
  }

  const supabase = createSupabaseAdminClient()
  const { data, error } = await supabase
    .from('system_demo_performance_config')
    .update({ append_enabled: parsed.data.append_enabled })
    .eq('id', SINGLETON_ID)
    .select('append_enabled, updated_at')
    .single()

  if (error || !data) {
    return NextResponse.json({ error: 'Failed to save.' }, { status: 500 })
  }

  return NextResponse.json({
    append_enabled: data.append_enabled as boolean,
    updated_at: data.updated_at as string,
  })
}
