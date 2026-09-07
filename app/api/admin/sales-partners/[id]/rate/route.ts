import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireSuperAdmin } from '@/lib/internal-admin/auth'
import { createSupabaseAdminClient } from '@/lib/supabase'

/**
 * GET/PUT/DELETE /api/admin/sales-partners/[id]/rate — super-admin-only
 * per-partner voice-minute rate override management.
 * PRICING-01 (docs/specs/PRICING-01-requirement-document.md §6.3).
 *
 * `requireSuperAdmin()` on all three methods — mirrors
 * app/api/admin/sales-partners/[id]/route.ts's exact gate. A rate override
 * is account-financial data, not the scoped-viewing use case
 * `requireInternalAdmin()` exists for, so `internal_staff` is hard-rejected
 * (403), not merely scope-checked.
 *
 * Every write closes the currently-open row (`effective_to = NOW()`) before
 * inserting a new one — `billing_rate_versions`'s own "never mutate in
 * place" discipline, identical to migration 075 and §6.2's own default-rate
 * change.
 */

async function loadChannelPartnerAccount(id: string) {
  const supabase = createSupabaseAdminClient()
  // 2026-08-02 — .maybeSingle() confirmed unreliable on this Supabase project; array fetch + [0].
  const { data } = await supabase
    .from('partner_accounts')
    .select('id, account_kind')
    .eq('id', id)
    .limit(1)
  const account = data?.[0] ?? null

  if (!account || account.account_kind !== 'channel_partner') return null
  return account
}

/** Reads the currently-open platform-default voice_minute rate. Never hardcodes 0.30. */
async function getStandardRateUsd(supabase: ReturnType<typeof createSupabaseAdminClient>): Promise<number | null> {
  const { data } = await supabase
    .from('billing_rate_versions')
    .select('rate_usd')
    .is('partner_account_id', null)
    .eq('event_type', 'voice_minute')
    .is('effective_to', null)
    .limit(1)
  const row = data?.[0] ?? null
  return row ? Number(row.rate_usd) : null
}

/** Reads this partner's currently-open voice_minute override row, if any. */
async function getOpenOverrideRow(supabase: ReturnType<typeof createSupabaseAdminClient>, partnerAccountId: string) {
  const { data } = await supabase
    .from('billing_rate_versions')
    .select('id, rate_usd, effective_from')
    .eq('partner_account_id', partnerAccountId)
    .eq('event_type', 'voice_minute')
    .is('effective_to', null)
    .limit(1)
  return data?.[0] ?? null
}

export async function GET(_request: NextRequest, { params }: { params: { id: string } }) {
  const admin = await requireSuperAdmin()
  if (admin.error) return admin.error

  const account = await loadChannelPartnerAccount(params.id)
  if (!account) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  const supabase = createSupabaseAdminClient()
  const standardRateUsd = await getStandardRateUsd(supabase)
  const overrideRow = await getOpenOverrideRow(supabase, params.id)

  return NextResponse.json({
    standard_rate_usd: standardRateUsd ?? 0,
    override: overrideRow
      ? { rate_usd: Number(overrideRow.rate_usd), effective_from: overrideRow.effective_from as string }
      : null,
  })
}

const SetRateSchema = z.object({
  rate_usd: z.number().gt(0).lt(0.30),
})

export async function PUT(request: NextRequest, { params }: { params: { id: string } }) {
  const admin = await requireSuperAdmin()
  if (admin.error) return admin.error

  const account = await loadChannelPartnerAccount(params.id)
  if (!account) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  const body = await request.json().catch(() => null)
  const parsed = SetRateSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: { code: 'validation_failed', message: 'Validation failed' } }, { status: 422 })
  }

  const supabase = createSupabaseAdminClient()

  // Server-side re-validation independent of the client-side check — rereads
  // the current standard rate at request time so this route stays correct
  // automatically if the standard rate ever changes again in the future.
  const standardRateUsd = await getStandardRateUsd(supabase)
  if (standardRateUsd === null || parsed.data.rate_usd >= standardRateUsd) {
    return NextResponse.json(
      {
        error: {
          code: 'rate_not_below_standard',
          message: `Custom rate must be below the current standard rate ($${(standardRateUsd ?? 0).toFixed(2)}/min).`,
        },
      },
      { status: 422 }
    )
  }

  // Close the currently-open override row for this partner, if one exists.
  const existingOverride = await getOpenOverrideRow(supabase, params.id)
  if (existingOverride) {
    const { error: closeError } = await supabase
      .from('billing_rate_versions')
      .update({ effective_to: new Date().toISOString() })
      .eq('id', existingOverride.id as string)
    if (closeError) {
      console.error('[admin/sales-partners/rate] Failed to close existing override row:', closeError.message)
      return NextResponse.json({ error: { code: 'save_failed', message: "Couldn't save. Try again." } }, { status: 500 })
    }
  }

  const effectiveFrom = new Date().toISOString()
  const { error: insertError } = await supabase.from('billing_rate_versions').insert({
    partner_account_id: params.id,
    event_type: 'voice_minute',
    unit: 'minute',
    rate_usd: parsed.data.rate_usd,
    rate_basis: 'negotiated_override_admin_set',
    effective_from: effectiveFrom,
  })

  if (insertError) {
    console.error('[admin/sales-partners/rate] Failed to insert override row:', insertError.message)
    return NextResponse.json({ error: { code: 'save_failed', message: "Couldn't save. Try again." } }, { status: 500 })
  }

  return NextResponse.json({ rate_usd: parsed.data.rate_usd, effective_from: effectiveFrom })
}

export async function DELETE(_request: NextRequest, { params }: { params: { id: string } }) {
  const admin = await requireSuperAdmin()
  if (admin.error) return admin.error

  const account = await loadChannelPartnerAccount(params.id)
  if (!account) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  const supabase = createSupabaseAdminClient()
  const existingOverride = await getOpenOverrideRow(supabase, params.id)

  if (existingOverride) {
    const { error: closeError } = await supabase
      .from('billing_rate_versions')
      .update({ effective_to: new Date().toISOString() })
      .eq('id', existingOverride.id as string)
    if (closeError) {
      console.error('[admin/sales-partners/rate] Failed to close override row on DELETE:', closeError.message)
      return NextResponse.json({ error: { code: 'save_failed', message: "Couldn't save. Try again." } }, { status: 500 })
    }
  }

  // Idempotent — clearing an already-clear override is not an error.
  return new NextResponse(null, { status: 204 })
}
