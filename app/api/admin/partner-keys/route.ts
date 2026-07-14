import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createSupabaseAdminClient } from '@/lib/supabase'
import { requirePartnerAdmin } from '@/lib/partner/auth'
import { generateApiKey } from '@/lib/partner/api-keys'

/**
 * POST /api/admin/partner-keys — issue a new partner API key.
 * GET  /api/admin/partner-keys?partner_account_id=... — list keys (prefix +
 *      label + last_used_at only, never the full key after issuance).
 *
 * Clerk-authenticated only (docs/specs/B2B-02-requirement-document.md
 * Section 4.4, architecture.md Section 3.2) — never valid via a partner API
 * key. No UI is built for these in this brief (B2B-03's Configurator); they
 * exist as API endpoints only, per Objective 6.
 */

const CreateKeySchema = z.object({
  partner_account_id: z.string().uuid(),
  mode: z.enum(['test', 'live']),
  label: z.string().min(1).max(200).optional(),
})

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null)
  const parsed = CreateKeySchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Validation failed', details: parsed.error.flatten() }, { status: 400 })
  }

  const admin = await requirePartnerAdmin(parsed.data.partner_account_id)
  if (admin.error) return admin.error

  const generated = generateApiKey(parsed.data.mode)
  const supabase = createSupabaseAdminClient()

  const { data: inserted, error } = await supabase
    .from('partner_api_keys')
    .insert({
      partner_account_id: parsed.data.partner_account_id,
      mode: parsed.data.mode,
      key_prefix: generated.keyPrefix,
      key_hash: generated.keyHash,
      label: parsed.data.label ?? null,
    })
    .select('id, mode, label')
    .single()

  if (error || !inserted) {
    console.error('[admin/partner-keys] Insert failed:', error?.message)
    return NextResponse.json({ error: 'Failed to create key' }, { status: 500 })
  }

  // The full key is returned exactly once, in this response only — never retrievable again.
  return NextResponse.json(
    {
      id: inserted.id,
      key: generated.key,
      key_prefix: generated.keyPrefix,
      mode: inserted.mode,
      label: inserted.label,
    },
    { status: 201 }
  )
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const partnerAccountId = searchParams.get('partner_account_id')

  if (!partnerAccountId) {
    return NextResponse.json({ error: 'partner_account_id query param is required' }, { status: 400 })
  }

  const admin = await requirePartnerAdmin(partnerAccountId)
  if (admin.error) return admin.error

  const supabase = createSupabaseAdminClient()
  const { data } = await supabase
    .from('partner_api_keys')
    .select('id, mode, key_prefix, label, status, last_used_at, created_at, revoked_at')
    .eq('partner_account_id', partnerAccountId)
    .order('created_at', { ascending: false })

  return NextResponse.json({ keys: data ?? [] })
}
