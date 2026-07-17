import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireAuth } from '@/lib/clerk'
import { createSupabaseAdminClient } from '@/lib/supabase'

/**
 * GET /api/admin/glitches?partner_account_id=&type=&status=
 *
 * B2B-17 Requirement Doc §4.B / §6.6 — backs Panel 2 ("All Glitches"). REPOINTED from the JSONB
 * unnest (B2B-09) to the durable `glitch_instances` table so each row has a stable id and an
 * inherited issue status. Clerk-authenticated only, same boundary as `/api/admin/glitches/summary`
 * and the `/api/admin/billing/clients` precedent.
 *
 * One row per glitch instance. Each row's Status is INHERITED from its linked issue (or 'untriaged'
 * if unattached) — instances have no independent status. Partner + type filters run in SQL (indexed);
 * the inherited-status filter runs in application code because it depends on the left-joined issue.
 */

const QuerySchema = z.object({
  partner_account_id: z.string().uuid().optional(),
  type: z.enum(['misunderstanding', 'repetition', 'confusion_about_clio', 'derailment', 'other']).optional(),
  status: z.enum(['untriaged', 'open', 'investigating', 'resolved', 'wont_fix']).optional(),
})

interface InstanceRow {
  id: string
  partner_session_id: string
  partner_account_id: string
  glitch_type: string
  description: string | null
  full_detail_purged_at: string | null
  extracted_at: string
  issue_id: string | null
  partner_accounts: { name: string } | { name: string }[] | null
  glitch_issues: { title: string; status: string } | { title: string; status: string }[] | null
}

export async function GET(request: NextRequest) {
  const { error } = requireAuth()
  if (error) return error

  const parsed = QuerySchema.safeParse({
    partner_account_id: request.nextUrl.searchParams.get('partner_account_id') ?? undefined,
    type: request.nextUrl.searchParams.get('type') ?? undefined,
    status: request.nextUrl.searchParams.get('status') ?? undefined,
  })
  if (!parsed.success) {
    return NextResponse.json({ error: 'Validation failed', details: parsed.error.flatten() }, { status: 400 })
  }
  const { partner_account_id: partnerAccountId, type: typeFilter, status: statusFilter } = parsed.data

  const supabase = createSupabaseAdminClient()

  let query = supabase
    .from('glitch_instances')
    .select(
      'id, partner_session_id, partner_account_id, glitch_type, description, full_detail_purged_at, extracted_at, issue_id, partner_accounts!inner(name), glitch_issues(title, status)'
    )
    .order('extracted_at', { ascending: false })

  if (partnerAccountId) query = query.eq('partner_account_id', partnerAccountId)
  if (typeFilter) query = query.eq('glitch_type', typeFilter)

  const { data, error: queryError } = await query

  if (queryError) {
    console.error('[admin/glitches] Failed to load glitch drill-down data:', queryError.message)
    return NextResponse.json({ error: "Couldn't load glitch data." }, { status: 500 })
  }

  const glitches = ((data ?? []) as unknown as InstanceRow[])
    .map((row) => {
      const partnerAccount = Array.isArray(row.partner_accounts) ? row.partner_accounts[0] : row.partner_accounts
      const issue = Array.isArray(row.glitch_issues) ? row.glitch_issues[0] : row.glitch_issues
      const inheritedStatus = issue ? issue.status : 'untriaged'
      return {
        id: row.id,
        partner_session_id: row.partner_session_id,
        partner_account_id: row.partner_account_id,
        partner_name: partnerAccount?.name ?? '',
        glitch_type: row.glitch_type,
        description: row.description ?? null,
        full_detail_purged: row.full_detail_purged_at !== null,
        extracted_at: row.extracted_at,
        issue_id: row.issue_id,
        issue_title: issue?.title ?? null,
        status: inheritedStatus,
      }
    })
    .filter((g) => !statusFilter || g.status === statusFilter)

  return NextResponse.json({ glitches })
}
