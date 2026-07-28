import { NextResponse } from 'next/server'
import { requireChannelPartnerAdmin } from '@/lib/partner/auth'
import { createSupabaseAdminClient } from '@/lib/supabase'
import { generateDemoPasscode } from '@/lib/demo/passcode-accounts'

/**
 * POST /api/channel-partner/demo-access/regenerate
 *
 * B2B-39 (docs/specs/B2B-39-requirement-document.md §4.A, §6.4, AT-1, AT-2). Handles BOTH first-ever
 * generation (State A -> B) and regeneration (State B -> a new B) — "generate" is simply "regenerate
 * when no active passcode exists yet," per the spec's unified-code-path design. No request body.
 * Revokes any existing active passcode (soft — `revoked_at` set, not deleted, audit trail) then
 * inserts a new one and returns the plaintext EXACTLY ONCE. No route anywhere ever re-displays it —
 * this is the only response that ever contains the plaintext passcode.
 */
export async function POST() {
  const admin = await requireChannelPartnerAdmin()
  if (admin.error) return admin.error

  const supabase = createSupabaseAdminClient()

  // Revoke-then-insert as two statements (not a single atomic RPC) — §9 Edge Case: a rare,
  // low-stakes double-click race with no data-loss consequence. The partial unique index
  // (idx_demo_passcodes_active_per_account) is the actual safety net below.
  await supabase
    .from('demo_passcodes')
    .update({ revoked_at: new Date().toISOString() })
    .eq('partner_account_id', admin.partnerAccountId)
    .is('revoked_at', null)

  const generated = generateDemoPasscode()

  const { data: inserted, error } = await supabase
    .from('demo_passcodes')
    .insert({
      partner_account_id: admin.partnerAccountId,
      passcode_hash: generated.passcodeHash,
      passcode_prefix: generated.passcodePrefix,
      created_by_clerk_user_id: admin.clerkUserId,
    })
    .select('created_at')
    .single()

  if (error || !inserted) {
    console.error('[channel-partner/demo-access/regenerate] Failed to insert demo_passcodes row:', error?.message)
    return NextResponse.json(
      { error: { code: 'internal_error', message: "Couldn't generate a passcode. Try again." } },
      { status: 500 }
    )
  }

  return NextResponse.json({ passcode: generated.passcode, generated_at: inserted.created_at })
}
