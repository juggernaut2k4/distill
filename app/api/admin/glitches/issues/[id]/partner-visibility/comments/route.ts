import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireInternalAdmin } from '@/lib/internal-admin/auth'
import { createSupabaseAdminClient } from '@/lib/supabase'
import { resolveCommentAuthors } from '@/lib/glitches/partner-comment-authors'

/**
 * GET /api/admin/glitches/issues/:id/partner-visibility/comments?partner_account_id=
 *
 * B2B-22 Requirement Doc §6.4 / §4.B State I4 — internal, READ-ONLY view of one partner's comment
 * thread on this issue (the operator sees what the partner has written; no reply route in v1, §10).
 * Same sales-partner scope check as the sibling GET (§6.4) via requireInternalAdmin(partner_account_id).
 */

const QuerySchema = z.object({
  partner_account_id: z.string().uuid(),
})

export async function GET(request: NextRequest, { params }: { params: { id: string } }) {
  const parsed = QuerySchema.safeParse({
    partner_account_id: request.nextUrl.searchParams.get('partner_account_id') ?? undefined,
  })
  if (!parsed.success) {
    return NextResponse.json({ error: 'Validation failed', details: parsed.error.flatten() }, { status: 400 })
  }
  const { partner_account_id: partnerAccountId } = parsed.data

  const admin = await requireInternalAdmin(partnerAccountId)
  if (admin.error) return admin.error

  const supabase = createSupabaseAdminClient()

  const { data: comments, error: commentsError } = await supabase
    .from('glitch_issue_partner_comments')
    .select('id, body, author_partner_admin_user_id, created_at')
    .eq('issue_id', params.id)
    .eq('partner_account_id', partnerAccountId)
    .order('created_at', { ascending: true })

  if (commentsError) {
    console.error('[admin/glitches/partner-visibility/comments] Failed to load comments:', commentsError.message)
    return NextResponse.json({ error: "Couldn't load comments." }, { status: 500 })
  }

  const rows = (comments ?? []) as Array<{
    id: string
    body: string
    author_partner_admin_user_id: string | null
    created_at: string
  }>

  const authors = await resolveCommentAuthors(rows.map((r) => r.author_partner_admin_user_id))

  return NextResponse.json({
    comments: rows.map((row) => ({
      id: row.id,
      body: row.body,
      created_at: row.created_at,
      author: row.author_partner_admin_user_id
        ? authors.get(row.author_partner_admin_user_id) ?? { name: 'Partner user', email: null }
        : { name: 'Partner user', email: null },
    })),
  })
}
