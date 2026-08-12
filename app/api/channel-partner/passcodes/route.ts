import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createSupabaseAdminClient } from '@/lib/supabase'
import { requireChannelPartnerAdmin, requireChannelPartnerClientAccess } from '@/lib/partner/auth'
import { generateDispatchPasscode } from '@/lib/partner/dispatch-passcodes'

/**
 * POST /api/channel-partner/passcodes — generate or regenerate the active dispatch passcode for
 * one of the sales-partner's own clients.
 * GET  /api/channel-partner/passcodes — list every client's passcode status (prefix + status only,
 *      never the plaintext after issuance).
 *
 * B2B-78 (docs/specs/B2B-78-requirement-document.md §4.B "Passcodes tab"). Unified generate/
 * regenerate code path, mirroring the existing `POST /api/channel-partner/demo-access/regenerate`
 * pattern — the only difference is this is scoped per (partner_account_id, client_id) pairing,
 * not per whole account.
 */

const GenerateSchema = z.object({ client_id: z.string().uuid() })

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null)
  const parsed = GenerateSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Validation failed', details: parsed.error.flatten() }, { status: 422 })
  }

  const access = await requireChannelPartnerClientAccess(parsed.data.client_id)
  if (access.error) return access.error

  const supabase = createSupabaseAdminClient()

  // Revoke-then-insert, same two-statement approach and same reasoning as the demo-access
  // regenerate route — the partial unique index (idx_dispatch_passcodes_active_per_pairing) is the
  // actual safety net against a double-click race.
  await supabase
    .from('dispatch_passcodes')
    .update({ revoked_at: new Date().toISOString() })
    .eq('partner_account_id', access.channelPartnerAccountId)
    .eq('client_id', parsed.data.client_id)
    .is('revoked_at', null)

  const generated = generateDispatchPasscode()

  const { data: inserted, error } = await supabase
    .from('dispatch_passcodes')
    .insert({
      partner_account_id: access.channelPartnerAccountId,
      client_id: parsed.data.client_id,
      passcode_hash: generated.passcodeHash,
      passcode_prefix: generated.passcodePrefix,
      created_by_clerk_user_id: access.clerkUserId,
    })
    .select('created_at')
    .single()

  if (error || !inserted) {
    console.error('[channel-partner/passcodes] Failed to insert dispatch_passcodes row:', error?.message)
    return NextResponse.json({ error: { code: 'internal_error', message: "Couldn't generate a passcode. Try again." } }, { status: 500 })
  }

  return NextResponse.json({ passcode: generated.passcode, generated_at: inserted.created_at })
}

export async function GET() {
  const admin = await requireChannelPartnerAdmin()
  if (admin.error) return admin.error

  const supabase = createSupabaseAdminClient()
  const { data } = await supabase
    .from('dispatch_passcodes')
    .select('id, client_id, passcode_prefix, revoked_at, created_at')
    .eq('partner_account_id', admin.partnerAccountId)
    .is('revoked_at', null)
    .order('created_at', { ascending: false })

  return NextResponse.json({ passcodes: data ?? [] })
}
