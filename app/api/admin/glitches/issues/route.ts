import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireInternalAdmin } from '@/lib/internal-admin/auth'
import { createSupabaseAdminClient } from '@/lib/supabase'
import { GLITCH_ISSUE_STATUSES } from '@/lib/glitches/issue-status'

/**
 * B2B-17 Requirement Doc §4.C / §6.6 — Tracked Issues (Panel 3).
 *
 *  GET  /api/admin/glitches/issues?status=   — list issues + instance_count + last_activity.
 *  POST /api/admin/glitches/issues           — create an issue (status 'open'), optionally attaching
 *                                              a seed glitch instance.
 *
 * Clerk-authenticated only, same boundary as the other admin glitch routes.
 */

const ListQuerySchema = z.object({
  status: z.enum(GLITCH_ISSUE_STATUSES).optional(),
})

const CreateSchema = z.object({
  title: z.string().trim().min(1).max(200),
  root_cause_summary: z.string().max(20000).optional().nullable(),
  attach_instance_id: z.string().uuid().optional(),
})

interface IssueRow {
  id: string
  title: string
  root_cause_summary: string | null
  status: string
  created_by: string | null
  resolved_at: string | null
  created_at: string
  updated_at: string
}

export async function GET(request: NextRequest) {
  const { error } = await requireInternalAdmin()
  if (error) return error

  const parsed = ListQuerySchema.safeParse({
    status: request.nextUrl.searchParams.get('status') ?? undefined,
  })
  if (!parsed.success) {
    return NextResponse.json({ error: 'Validation failed', details: parsed.error.flatten() }, { status: 400 })
  }

  const supabase = createSupabaseAdminClient()

  let query = supabase
    .from('glitch_issues')
    .select('id, title, root_cause_summary, status, created_by, resolved_at, created_at, updated_at')
    .order('updated_at', { ascending: false })

  if (parsed.data.status) query = query.eq('status', parsed.data.status)

  const { data: issues, error: issuesError } = await query
  if (issuesError) {
    console.error('[admin/glitches/issues] Failed to load issues:', issuesError.message)
    return NextResponse.json({ error: "Couldn't load tracked issues." }, { status: 500 })
  }

  const issueRows = (issues ?? []) as IssueRow[]
  const issueIds = issueRows.map((i) => i.id)

  // Instance counts + latest attached-instance extraction, and latest note — aggregated in
  // application code (internal-scale volume; avoids an extra RPC). last_activity = the most recent of
  // the issue's own updated_at, its latest note, and its latest attached instance's extraction.
  const instanceCount = new Map<string, number>()
  const latestInstanceAt = new Map<string, string>()
  const latestNoteAt = new Map<string, string>()

  if (issueIds.length > 0) {
    const { data: instances } = await supabase
      .from('glitch_instances')
      .select('issue_id, extracted_at')
      .in('issue_id', issueIds)
    for (const row of (instances ?? []) as Array<{ issue_id: string; extracted_at: string }>) {
      instanceCount.set(row.issue_id, (instanceCount.get(row.issue_id) ?? 0) + 1)
      const prev = latestInstanceAt.get(row.issue_id)
      if (!prev || row.extracted_at > prev) latestInstanceAt.set(row.issue_id, row.extracted_at)
    }

    const { data: notes } = await supabase
      .from('glitch_issue_notes')
      .select('issue_id, created_at')
      .in('issue_id', issueIds)
    for (const row of (notes ?? []) as Array<{ issue_id: string; created_at: string }>) {
      const prev = latestNoteAt.get(row.issue_id)
      if (!prev || row.created_at > prev) latestNoteAt.set(row.issue_id, row.created_at)
    }
  }

  const result = issueRows.map((issue) => {
    const candidates = [issue.updated_at, latestNoteAt.get(issue.id), latestInstanceAt.get(issue.id)].filter(
      (v): v is string => Boolean(v)
    )
    const lastActivity = candidates.reduce((max, v) => (v > max ? v : max), issue.updated_at)
    return {
      ...issue,
      instance_count: instanceCount.get(issue.id) ?? 0,
      last_activity: lastActivity,
    }
  })

  result.sort((a, b) => (a.last_activity < b.last_activity ? 1 : a.last_activity > b.last_activity ? -1 : 0))

  return NextResponse.json({ issues: result })
}

export async function POST(request: NextRequest) {
  const { clerkUserId: userId, error } = await requireInternalAdmin()
  if (error) return error

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Validation failed', details: 'Invalid JSON body' }, { status: 400 })
  }

  const parsed = CreateSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Validation failed', details: parsed.error.flatten() }, { status: 400 })
  }
  const { title, root_cause_summary, attach_instance_id } = parsed.data

  const supabase = createSupabaseAdminClient()

  const { data: created, error: insertError } = await supabase
    .from('glitch_issues')
    .insert({
      title,
      root_cause_summary: root_cause_summary ?? null,
      status: 'open',
      created_by: userId,
    })
    .select('id, title, root_cause_summary, status, created_by, resolved_at, created_at, updated_at')
    .single()

  if (insertError || !created) {
    console.error('[admin/glitches/issues] Failed to create issue:', insertError?.message)
    return NextResponse.json({ error: "Couldn't create the issue." }, { status: 500 })
  }

  if (attach_instance_id) {
    const { error: attachError } = await supabase
      .from('glitch_instances')
      .update({ issue_id: created.id })
      .eq('id', attach_instance_id)
    if (attachError) {
      // The issue was created; surface the attach failure but do not fail the whole request —
      // the operator can re-attach from Panel 2. Logged for diagnosis.
      console.error('[admin/glitches/issues] Issue created but seed attach failed:', attachError.message)
    }
  }

  return NextResponse.json({ issue: created }, { status: 201 })
}
