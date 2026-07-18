import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireInternalAdmin, internalAdminErrorEnvelope } from '@/lib/internal-admin/auth'
import { createSupabaseAdminClient } from '@/lib/supabase'

/**
 * B2B-22 Requirement Doc §6.4 / §4.B — internal management of per-partner bug visibility.
 *
 *  GET   /api/admin/glitches/issues/:id/partner-visibility
 *    Returns one row per ELIGIBLE partner (distinct partner_account_id among this issue's attached
 *    glitch_instances), left-joined to any existing glitch_issue_partner_visibility row (defaults
 *    is_visible: false, eta: null, partner_facing_description: null if no row exists yet — a row is
 *    only actually inserted on first toggle-on). A sales-partner caller only ever sees the subset of
 *    rows whose partner is in their own scope — an out-of-scope partner is omitted entirely, never
 *    flagged/disabled (§4.B State I1), so a sales-partner can never learn an issue also touches a
 *    partner they're not tagged to.
 *
 *  PATCH /api/admin/glitches/issues/:id/partner-visibility
 *    Body: { partner_account_id, is_visible?, eta?, partner_facing_description? }. Upserts the
 *    (issue_id, partner_account_id) row. Enforces the eligibility guard (422 partner_not_eligible),
 *    the description-required-when-visible rule (422 description_required), and sets
 *    first_visible_at exactly once, on the specific write that first sets is_visible: true — never
 *    touched again on any subsequent write, including later toggling off (§6.1/§6.3).
 *
 * This route (and its /comments sub-resource) is the ONLY place this brief adds new filtering
 * alongside the existing /api/admin/glitches* route family — those existing routes are untouched and
 * never gain an is_visible filter (§6.3 non-regression, §7 AT-16).
 */

const PatchSchema = z.object({
  partner_account_id: z.string().uuid(),
  is_visible: z.boolean().optional(),
  eta: z.string().date().nullable().optional(),
  partner_facing_description: z.string().trim().min(1).max(2000).optional(),
})

interface VisibilityRow {
  id: string
  partner_account_id: string
  is_visible: boolean
  eta: string | null
  partner_facing_description: string | null
  toggled_by: string | null
  toggled_at: string | null
  first_visible_at: string | null
  internal_admin_users: { email: string } | { email: string }[] | null
}

export async function GET(_request: NextRequest, { params }: { params: { id: string } }) {
  const admin = await requireInternalAdmin()
  if (admin.error) return admin.error

  const supabase = createSupabaseAdminClient()

  // Eligibility: distinct partner_account_ids among this issue's attached glitch_instances.
  const { data: instanceRows, error: instancesError } = await supabase
    .from('glitch_instances')
    .select('partner_account_id')
    .eq('issue_id', params.id)

  if (instancesError) {
    console.error('[admin/glitches/partner-visibility] Failed to load eligible partners:', instancesError.message)
    return NextResponse.json({ error: "Couldn't load partner visibility." }, { status: 500 })
  }

  let eligiblePartnerIds = Array.from(new Set((instanceRows ?? []).map((r) => r.partner_account_id as string)))

  // A sales-partner caller never learns this issue touches a partner outside their scope — the row
  // is omitted entirely, not disabled (§4.B State I1, §6.4).
  if (admin.role === 'sales_partner') {
    eligiblePartnerIds = eligiblePartnerIds.filter((id) => admin.scopedPartnerAccountIds.includes(id))
  }

  if (eligiblePartnerIds.length === 0) {
    return NextResponse.json({ partners: [] })
  }

  const { data: partnerAccounts, error: partnersError } = await supabase
    .from('partner_accounts')
    .select('id, name')
    .in('id', eligiblePartnerIds)

  if (partnersError) {
    console.error('[admin/glitches/partner-visibility] Failed to load partner names:', partnersError.message)
    return NextResponse.json({ error: "Couldn't load partner visibility." }, { status: 500 })
  }

  const { data: visibilityRows, error: visibilityError } = await supabase
    .from('glitch_issue_partner_visibility')
    .select(
      'id, partner_account_id, is_visible, eta, partner_facing_description, toggled_by, toggled_at, first_visible_at, internal_admin_users(email)'
    )
    .eq('issue_id', params.id)
    .in('partner_account_id', eligiblePartnerIds)

  if (visibilityError) {
    console.error('[admin/glitches/partner-visibility] Failed to load visibility rows:', visibilityError.message)
    return NextResponse.json({ error: "Couldn't load partner visibility." }, { status: 500 })
  }

  // comment counts per eligible partner (for the "View comments (N)" affordance, §4.B State I4)
  const { data: commentRows } = await supabase
    .from('glitch_issue_partner_comments')
    .select('partner_account_id')
    .eq('issue_id', params.id)
    .in('partner_account_id', eligiblePartnerIds)

  const commentCountByPartner = new Map<string, number>()
  for (const row of (commentRows ?? []) as Array<{ partner_account_id: string }>) {
    commentCountByPartner.set(row.partner_account_id, (commentCountByPartner.get(row.partner_account_id) ?? 0) + 1)
  }

  const visibilityByPartner = new Map<string, VisibilityRow>()
  for (const row of (visibilityRows ?? []) as VisibilityRow[]) {
    visibilityByPartner.set(row.partner_account_id, row)
  }

  const partnerNameById = new Map((partnerAccounts ?? []).map((p) => [p.id as string, p.name as string]))

  const partners = eligiblePartnerIds
    .map((partnerAccountId) => {
      const visibility = visibilityByPartner.get(partnerAccountId)
      const togglerRaw = visibility?.internal_admin_users
      const toggler = Array.isArray(togglerRaw) ? togglerRaw[0] : togglerRaw
      return {
        partner_account_id: partnerAccountId,
        partner_name: partnerNameById.get(partnerAccountId) ?? '',
        is_visible: visibility?.is_visible ?? false,
        eta: visibility?.eta ?? null,
        partner_facing_description: visibility?.partner_facing_description ?? null,
        toggled_by: visibility?.toggled_by ?? null,
        toggled_by_email: toggler?.email ?? null,
        toggled_at: visibility?.toggled_at ?? null,
        first_visible_at: visibility?.first_visible_at ?? null,
        comment_count: commentCountByPartner.get(partnerAccountId) ?? 0,
      }
    })
    .sort((a, b) => a.partner_name.localeCompare(b.partner_name))

  return NextResponse.json({ partners })
}

export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Validation failed', details: 'Invalid JSON body' }, { status: 400 })
  }

  const parsed = PatchSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Validation failed', details: parsed.error.flatten() }, { status: 400 })
  }
  const { partner_account_id: partnerAccountId, is_visible, eta, partner_facing_description } = parsed.data

  // requireInternalAdmin(partnerAccountId) — the convenience overload 403s immediately if a
  // sales-partner targets a partner outside their scope (§6.4 AT-4).
  const admin = await requireInternalAdmin(partnerAccountId)
  if (admin.error) return admin.error

  const supabase = createSupabaseAdminClient()

  // Eligibility guard (§6.4, §7 AT-3): the target partner must have ≥1 glitch_instances under this issue.
  const { data: eligibleInstance, error: eligibilityError } = await supabase
    .from('glitch_instances')
    .select('id')
    .eq('issue_id', params.id)
    .eq('partner_account_id', partnerAccountId)
    .limit(1)
    .maybeSingle()

  if (eligibilityError) {
    console.error('[admin/glitches/partner-visibility] Failed to check eligibility:', eligibilityError.message)
    return NextResponse.json(internalAdminErrorEnvelope('internal_error', "Couldn't update visibility."), { status: 500 })
  }
  if (!eligibleInstance) {
    return NextResponse.json(
      internalAdminErrorEnvelope('partner_not_eligible', 'This partner has no glitch instances attached to this issue.'),
      { status: 422 }
    )
  }

  const { data: current, error: currentError } = await supabase
    .from('glitch_issue_partner_visibility')
    .select('id, is_visible, eta, partner_facing_description, first_visible_at')
    .eq('issue_id', params.id)
    .eq('partner_account_id', partnerAccountId)
    .maybeSingle()

  if (currentError) {
    console.error('[admin/glitches/partner-visibility] Failed to load current visibility:', currentError.message)
    return NextResponse.json(internalAdminErrorEnvelope('internal_error', "Couldn't update visibility."), { status: 500 })
  }

  const nextIsVisible = is_visible ?? current?.is_visible ?? false
  const nextDescription =
    partner_facing_description !== undefined ? partner_facing_description : current?.partner_facing_description ?? null

  // Mirrors the DB CHECK constraint — caught here first for a clean error message (§6.4, §8).
  if (nextIsVisible && (!nextDescription || nextDescription.trim().length === 0)) {
    return NextResponse.json(
      internalAdminErrorEnvelope('description_required', 'A partner-facing description is required to make a bug visible.'),
      { status: 422 }
    )
  }

  const now = new Date().toISOString()
  const update: Record<string, unknown> = {
    issue_id: params.id,
    partner_account_id: partnerAccountId,
    is_visible: nextIsVisible,
    toggled_by: admin.internalAdminUserId,
    toggled_at: now,
  }
  if (eta !== undefined) update.eta = eta
  if (partner_facing_description !== undefined) update.partner_facing_description = partner_facing_description

  // first_visible_at is set exactly once — on the specific write that sets is_visible: true while
  // first_visible_at is still NULL — and never touched again on any subsequent write (§6.1, §6.3).
  if (nextIsVisible && !current?.first_visible_at) {
    update.first_visible_at = now
  }

  const { data: saved, error: saveError } = await supabase
    .from('glitch_issue_partner_visibility')
    .upsert(update, { onConflict: 'issue_id,partner_account_id' })
    .select('id, partner_account_id, is_visible, eta, partner_facing_description, toggled_by, toggled_at, first_visible_at')
    .single()

  if (saveError || !saved) {
    console.error('[admin/glitches/partner-visibility] Failed to save visibility:', saveError?.message)
    return NextResponse.json(internalAdminErrorEnvelope('internal_error', "Couldn't update visibility."), { status: 500 })
  }

  return NextResponse.json({ visibility: saved })
}
