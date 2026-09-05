import { createSupabaseAdminClient } from '@/lib/supabase'

/**
 * DEMO-PASSCODE-01 (docs/specs/DEMO-PASSCODE-01-requirement-document.md §6.8). Admin read helper
 * for the public $10 demo-passcode purchase/redemption audit trail. Two queries against a shared
 * admin client, mirroring listWaitlistSignups()'s own simplicity.
 */

export interface PublicDemoPasscodeRow {
  id: string
  buyer_email: string
  purchased_at: string
  uses_remaining: number
  uses_total: 2
}

export interface PublicDemoPasscodeRedemptionRow {
  id: string
  buyer_email: string
  redeemed_name: string
  slug: string
  redeemed_at: string
}

export async function listPublicDemoPasscodesAndRedemptions(): Promise<{
  passcodes: PublicDemoPasscodeRow[]
  redemptions: PublicDemoPasscodeRedemptionRow[]
}> {
  const supabase = createSupabaseAdminClient()

  const { data: passcodeRows } = await supabase
    .from('public_demo_passcodes')
    .select('id, buyer_email, created_at, uses_remaining')
    .order('created_at', { ascending: false })

  const passcodes: PublicDemoPasscodeRow[] = (passcodeRows ?? []).map((row) => ({
    id: row.id as string,
    buyer_email: row.buyer_email as string,
    purchased_at: row.created_at as string,
    uses_remaining: row.uses_remaining as number,
    uses_total: 2,
  }))

  const { data: redemptionRows } = await supabase
    .from('public_demo_passcode_redemptions')
    .select('id, redeemed_name, slug, created_at, public_demo_passcodes(buyer_email)')
    .order('created_at', { ascending: false })

  const redemptions: PublicDemoPasscodeRedemptionRow[] = (redemptionRows ?? []).map((row) => {
    const joined = row.public_demo_passcodes as { buyer_email?: string } | { buyer_email?: string }[] | null
    const buyerEmail = Array.isArray(joined) ? joined[0]?.buyer_email : joined?.buyer_email
    return {
      id: row.id as string,
      buyer_email: buyerEmail ?? '',
      redeemed_name: row.redeemed_name as string,
      slug: row.slug as string,
      redeemed_at: row.created_at as string,
    }
  })

  return { passcodes, redemptions }
}
