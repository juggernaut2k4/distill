import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requirePartnerAdmin } from '@/lib/partner/auth'
import { createSupabaseAdminClient } from '@/lib/supabase'
import { fetchHybridScopedVisibilityRow } from '@/lib/glitches/partner-known-bugs'
import { resolveCommentAuthors } from '@/lib/glitches/partner-comment-authors'

/**
 * B2B-22 Requirement Doc §6.4 — the partner's own comment thread on one bug.
 *
 *  GET  — read scope matches §6.3's hybrid table scope (currently visible, OR ever-visible-and-now-
 *         Closed). Outside that scope (never visible, or hidden while still open/in-progress) → 404,
 *         never 403 — a partner must never learn whether a bug exists at all (§6.4, §8).
 *  POST — write scope is NARROWER than read scope, deliberately: requires is_visible = true right now
 *         for this exact (issueId, partner_account_id) pair, or 404 (§6.3's read/write split). A
 *         sticky-closed-but-hidden row is viewable but not commentable.
 */

const QuerySchema = z.object({
  partner_account_id: z.string().uuid(),
})

const PostBodySchema = z.object({
  partner_account_id: z.string().uuid(),
  body: z.string().trim().min(1).max(5000),
})

export async function GET(request: NextRequest, { params }: { params: { issueId: string } }) {
  const parsed = QuerySchema.safeParse({
    partner_account_id: request.nextUrl.searchParams.get('partner_account_id') ?? undefined,
  })
  if (!parsed.success) {
    return NextResponse.json({ error: 'Validation failed', details: parsed.error.flatten() }, { status: 400 })
  }
  const { partner_account_id: partnerAccountId } = parsed.data

  const partnerAuth = await requirePartnerAdmin(partnerAccountId)
  if (partnerAuth.error) return partnerAuth.error

  let visibilityRow
  try {
    visibilityRow = await fetchHybridScopedVisibilityRow(params.issueId, partnerAccountId)
  } catch (err) {
    console.error('[partner/known-bugs/comments] Failed to check visibility scope:', err instanceof Error ? err.message : err)
    return NextResponse.json({ error: "Couldn't load comments." }, { status: 500 })
  }

  // Never confirms whether the bug exists at all — silence is the safe default (§6.4, §8).
  if (!visibilityRow) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  const supabase = createSupabaseAdminClient()
  const { data: comments, error: commentsError } = await supabase
    .from('glitch_issue_partner_comments')
    .select('id, body, author_partner_admin_user_id, created_at')
    .eq('issue_id', params.issueId)
    .eq('partner_account_id', partnerAccountId)
    .order('created_at', { ascending: true })

  if (commentsError) {
    console.error('[partner/known-bugs/comments] Failed to load comments:', commentsError.message)
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
    can_comment: visibilityRow.is_visible,
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

export async function POST(request: NextRequest, { params }: { params: { issueId: string } }) {
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Validation failed', details: 'Invalid JSON body' }, { status: 400 })
  }

  const parsed = PostBodySchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Validation failed', details: parsed.error.flatten() }, { status: 400 })
  }
  const { partner_account_id: partnerAccountId, body: commentBody } = parsed.data

  const partnerAuth = await requirePartnerAdmin(partnerAccountId)
  if (partnerAuth.error) return partnerAuth.error

  const supabase = createSupabaseAdminClient()

  // Write scope requires is_visible = true RIGHT NOW — narrower than the read scope (§6.3, §6.4).
  const { data: visibilityRow, error: visibilityError } = await supabase
    .from('glitch_issue_partner_visibility')
    .select('id')
    .eq('issue_id', params.issueId)
    .eq('partner_account_id', partnerAccountId)
    .eq('is_visible', true)
    .maybeSingle()

  if (visibilityError) {
    console.error('[partner/known-bugs/comments] Failed to check comment eligibility:', visibilityError.message)
    return NextResponse.json({ error: "Couldn't post your comment — try again." }, { status: 500 })
  }
  if (!visibilityRow) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  const { data: adminUser, error: adminUserError } = await supabase
    .from('partner_admin_users')
    .select('id')
    .eq('clerk_user_id', partnerAuth.clerkUserId)
    .eq('partner_account_id', partnerAccountId)
    .maybeSingle()

  if (adminUserError || !adminUser) {
    console.error('[partner/known-bugs/comments] Failed to resolve partner admin user:', adminUserError?.message)
    return NextResponse.json({ error: "Couldn't post your comment — try again." }, { status: 500 })
  }

  const { data: created, error: insertError } = await supabase
    .from('glitch_issue_partner_comments')
    .insert({
      issue_id: params.issueId,
      partner_account_id: partnerAccountId,
      body: commentBody,
      author_partner_admin_user_id: adminUser.id,
    })
    .select('id, body, created_at')
    .single()

  if (insertError || !created) {
    console.error('[partner/known-bugs/comments] Failed to insert comment:', insertError?.message)
    return NextResponse.json({ error: "Couldn't post your comment — try again." }, { status: 500 })
  }

  const authors = await resolveCommentAuthors([adminUser.id])

  return NextResponse.json(
    {
      comment: {
        id: created.id,
        body: created.body,
        created_at: created.created_at,
        author: authors.get(adminUser.id) ?? { name: 'Partner user', email: null },
      },
    },
    { status: 201 }
  )
}
