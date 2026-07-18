import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireSuperAdmin, internalAdminErrorEnvelope } from '@/lib/internal-admin/auth'
import { createSupabaseAdminClient } from '@/lib/supabase'
import { sendSuperAdminAddedEmail } from '@/lib/delivery/email'

/**
 * GET  /api/admin/team/super-admins  — list every internal_admin_users row with role='super_admin'.
 * POST /api/admin/team/super-admins  — add a new super-admin email (creates a 'pending' row).
 *
 * B2B-21 Requirement Doc §6.4 / §4.B State T2. `requireSuperAdmin()` only —
 * team management is never scoped-sales-partner-visible.
 */

const CreateSchema = z.object({
  email: z.string().trim().email(),
})

export async function GET() {
  const admin = await requireSuperAdmin()
  if (admin.error) return admin.error

  const supabase = createSupabaseAdminClient()
  const { data, error } = await supabase
    .from('internal_admin_users')
    .select('id, email, status, invited_by, invited_at, accepted_at')
    .eq('role', 'super_admin')
    .order('invited_at', { ascending: true })

  if (error) {
    console.error('[admin/team/super-admins] Failed to load super-admins:', error.message)
    return NextResponse.json({ error: "Couldn't load super-admins." }, { status: 500 })
  }

  // Resolve invited_by ids to emails for display (small table, application-level join).
  const inviterIds = Array.from(new Set((data ?? []).map((r) => r.invited_by).filter((v): v is string => !!v)))
  const invitersByid = new Map<string, string>()
  if (inviterIds.length > 0) {
    const { data: inviters } = await supabase.from('internal_admin_users').select('id, email').in('id', inviterIds)
    for (const row of inviters ?? []) invitersByid.set(row.id as string, row.email as string)
  }

  const superAdmins = (data ?? []).map((row) => ({
    id: row.id,
    email: row.email,
    status: row.status,
    invited_by_email: row.invited_by ? invitersByid.get(row.invited_by as string) ?? null : null,
    invited_at: row.invited_at,
    accepted_at: row.accepted_at,
  }))

  return NextResponse.json({ super_admins: superAdmins })
}

export async function POST(request: NextRequest) {
  const admin = await requireSuperAdmin()
  if (admin.error) return admin.error

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

  const supabase = createSupabaseAdminClient()

  // §6.4 — 409 already_exists checks across BOTH roles for this email; one
  // email can never hold two internal_admin_users rows (§10 edge case 11).
  const { data: existing } = await supabase
    .from('internal_admin_users')
    .select('id')
    .ilike('email', parsed.data.email)
    .maybeSingle()

  if (existing) {
    return NextResponse.json(internalAdminErrorEnvelope('already_exists', 'This email already has an internal-admin role.'), { status: 409 })
  }

  const { data: created, error: insertError } = await supabase
    .from('internal_admin_users')
    .insert({
      email: parsed.data.email,
      role: 'super_admin',
      status: 'pending',
      invited_by: admin.internalAdminUserId,
    })
    .select('id, email, status, invited_at')
    .single()

  if (insertError || !created) {
    // ON CONFLICT (lower(email)) DO NOTHING semantics — a race with another
    // concurrent add lands here as a DB-level unique violation.
    console.error('[admin/team/super-admins] Failed to create super-admin:', insertError?.message)
    return NextResponse.json(internalAdminErrorEnvelope('already_exists', 'This email already has an internal-admin role.'), { status: 409 })
  }

  const { data: inviterRow } = await supabase.from('internal_admin_users').select('email').eq('id', admin.internalAdminUserId).maybeSingle()
  const emailResult = await sendSuperAdminAddedEmail(parsed.data.email, inviterRow?.email ?? 'A Clio super-admin')
  if (!emailResult.success) {
    console.error('[admin/team/super-admins] Notification email failed (non-blocking):', emailResult.error)
  }

  return NextResponse.json({ super_admin: created, email_sent: emailResult.success }, { status: 201 })
}
