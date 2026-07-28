import { NextResponse } from 'next/server'
import { requireSuperAdmin } from '@/lib/internal-admin/auth'
import { createSupabaseAdminClient } from '@/lib/supabase'
import { generateDemoPasscode, DEMO_ADMIN_PARTNER_ACCOUNT_ID } from '@/lib/demo/passcode-accounts'

/**
 * POST /api/admin/demo-access/regenerate
 *
 * B2B-39 (docs/specs/B2B-39-requirement-document.md §4.B, §6.4, AT-1, AT-2). Admin equivalent of
 * `/api/channel-partner/demo-access/regenerate` — same unified generate-or-regenerate mechanics,
 * same shown-exactly-once discipline, `requireSuperAdmin()`-gated, always targeting the fixed
 * "Clio Internal — Public Demo" sentinel account (no discovery step — see Open Item 2).
 */
export async function POST() {
  const admin = await requireSuperAdmin()
  if (admin.error) return admin.error

  const supabase = createSupabaseAdminClient()

  await supabase
    .from('demo_passcodes')
    .update({ revoked_at: new Date().toISOString() })
    .eq('partner_account_id', DEMO_ADMIN_PARTNER_ACCOUNT_ID)
    .is('revoked_at', null)

  const generated = generateDemoPasscode()

  const { data: inserted, error } = await supabase
    .from('demo_passcodes')
    .insert({
      partner_account_id: DEMO_ADMIN_PARTNER_ACCOUNT_ID,
      passcode_hash: generated.passcodeHash,
      passcode_prefix: generated.passcodePrefix,
      created_by_clerk_user_id: admin.clerkUserId,
    })
    .select('created_at')
    .single()

  if (error || !inserted) {
    console.error('[admin/demo-access/regenerate] Failed to insert demo_passcodes row:', error?.message)
    return NextResponse.json(
      { error: { code: 'internal_error', message: "Couldn't generate a passcode. Try again." } },
      { status: 500 }
    )
  }

  return NextResponse.json({ passcode: generated.passcode, generated_at: inserted.created_at })
}
