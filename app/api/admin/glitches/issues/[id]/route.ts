import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireAuth } from '@/lib/clerk'
import { createSupabaseAdminClient } from '@/lib/supabase'
import {
  GLITCH_ISSUE_STATUSES,
  TERMINAL_STATUSES,
  isValidTransition,
  type GlitchIssueStatus,
} from '@/lib/glitches/issue-status'

/**
 * B2B-17 Requirement Doc §4.E / §4.F / §6.6 — Issue Detail + update.
 *
 *  GET   /api/admin/glitches/issues/:id  — issue + append-only notes (newest first) + attached
 *                                          glitch instances (with partner name + purge-aware description).
 *  PATCH /api/admin/glitches/issues/:id  — update status/title/root_cause_summary. Status transitions
 *                                          validated against Section 5; invalid → 400. Sets/clears
 *                                          resolved_at on entering/leaving a terminal status.
 *
 * Clerk-authenticated only.
 */

const UpdateSchema = z
  .object({
    status: z.enum(GLITCH_ISSUE_STATUSES).optional(),
    title: z.string().trim().min(1).max(200).optional(),
    root_cause_summary: z.string().max(20000).optional().nullable(),
  })
  .refine((v) => v.status !== undefined || v.title !== undefined || v.root_cause_summary !== undefined, {
    message: 'At least one field (status, title, root_cause_summary) must be provided.',
  })

interface AttachedInstanceRow {
  id: string
  partner_session_id: string
  partner_account_id: string
  glitch_type: string
  description: string | null
  full_detail_purged_at: string | null
  extracted_at: string
  partner_accounts: { name: string } | { name: string }[] | null
}

export async function GET(_request: NextRequest, { params }: { params: { id: string } }) {
  const { error } = requireAuth()
  if (error) return error

  const supabase = createSupabaseAdminClient()

  const { data: issue, error: issueError } = await supabase
    .from('glitch_issues')
    .select('id, title, root_cause_summary, status, created_by, resolved_at, created_at, updated_at')
    .eq('id', params.id)
    .maybeSingle()

  if (issueError) {
    console.error('[admin/glitches/issues/:id] Failed to load issue:', issueError.message)
    return NextResponse.json({ error: "Couldn't load the issue." }, { status: 500 })
  }
  if (!issue) {
    return NextResponse.json({ error: 'Issue not found.' }, { status: 404 })
  }

  const { data: notes, error: notesError } = await supabase
    .from('glitch_issue_notes')
    .select('id, body, author_clerk_user_id, created_at')
    .eq('issue_id', params.id)
    .order('created_at', { ascending: false })

  if (notesError) {
    console.error('[admin/glitches/issues/:id] Failed to load notes:', notesError.message)
    return NextResponse.json({ error: "Couldn't load the issue." }, { status: 500 })
  }

  const { data: instances, error: instancesError } = await supabase
    .from('glitch_instances')
    .select(
      'id, partner_session_id, partner_account_id, glitch_type, description, full_detail_purged_at, extracted_at, partner_accounts!inner(name)'
    )
    .eq('issue_id', params.id)
    .order('extracted_at', { ascending: false })

  if (instancesError) {
    console.error('[admin/glitches/issues/:id] Failed to load attached instances:', instancesError.message)
    return NextResponse.json({ error: "Couldn't load the issue." }, { status: 500 })
  }

  const attachedInstances = ((instances ?? []) as unknown as AttachedInstanceRow[]).map((row) => {
    const partnerAccount = Array.isArray(row.partner_accounts) ? row.partner_accounts[0] : row.partner_accounts
    return {
      id: row.id,
      partner_session_id: row.partner_session_id,
      partner_account_id: row.partner_account_id,
      partner_name: partnerAccount?.name ?? '',
      glitch_type: row.glitch_type,
      description: row.description ?? null,
      full_detail_purged: row.full_detail_purged_at !== null,
      extracted_at: row.extracted_at,
    }
  })

  return NextResponse.json({ issue, notes: notes ?? [], instances: attachedInstances })
}

export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
  const { error } = requireAuth()
  if (error) return error

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Validation failed', details: 'Invalid JSON body' }, { status: 400 })
  }

  const parsed = UpdateSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Validation failed', details: parsed.error.flatten() }, { status: 400 })
  }
  const { status, title, root_cause_summary } = parsed.data

  const supabase = createSupabaseAdminClient()

  const { data: current, error: currentError } = await supabase
    .from('glitch_issues')
    .select('id, status')
    .eq('id', params.id)
    .maybeSingle()

  if (currentError) {
    console.error('[admin/glitches/issues/:id] Failed to load issue for update:', currentError.message)
    return NextResponse.json({ error: "Couldn't update the issue." }, { status: 500 })
  }
  if (!current) {
    return NextResponse.json({ error: 'Issue not found.' }, { status: 404 })
  }

  const update: Record<string, unknown> = {}
  if (title !== undefined) update.title = title
  if (root_cause_summary !== undefined) update.root_cause_summary = root_cause_summary

  if (status !== undefined) {
    const from = current.status as GlitchIssueStatus
    if (!isValidTransition(from, status)) {
      return NextResponse.json(
        { error: `Invalid status transition: ${from} → ${status}.` },
        { status: 400 }
      )
    }
    update.status = status
    // Section 4.F: set resolved_at on entering a terminal status, clear it on leaving.
    if (TERMINAL_STATUSES.includes(status)) {
      update.resolved_at = new Date().toISOString()
    } else {
      update.resolved_at = null
    }
  }

  const { data: updated, error: updateError } = await supabase
    .from('glitch_issues')
    .update(update)
    .eq('id', params.id)
    .select('id, title, root_cause_summary, status, created_by, resolved_at, created_at, updated_at')
    .single()

  if (updateError || !updated) {
    console.error('[admin/glitches/issues/:id] Failed to update issue:', updateError?.message)
    return NextResponse.json({ error: "Couldn't update the issue." }, { status: 500 })
  }

  return NextResponse.json({ issue: updated })
}
