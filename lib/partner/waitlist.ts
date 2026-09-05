import { createSupabaseAdminClient } from '@/lib/supabase'
import { sendNewWaitlistSignupEmail } from '@/lib/delivery/email'
import { getActiveSuperAdminEmails } from '@/lib/partner/sales-partner-leads'

/**
 * WAITLIST-01 (docs/specs/WAITLIST-01-requirement-document.md §6.2) — CRUD + notification helpers
 * for `waitlist_signups`, the public homepage waitlist's own table. Structurally modeled on
 * `lib/partner/sales-partner-leads.ts`, with one deliberate divergence: `waitlist_signups.email`
 * has a hard UNIQUE constraint rather than B2B-80's 24h soft-duplicate window, so this attempts
 * the insert directly and maps a unique-violation (Postgres error code 23505) to
 * `{ ok: false, code: 'duplicate_email' }` instead of doing a pre-check-then-insert (which would
 * be redundant and race-prone against a hard constraint).
 */

export type SubmitWaitlistResult =
  | { ok: true }
  | { ok: false; code: 'duplicate_email' }
  | { ok: false; code: 'internal_error' }

export async function submitWaitlistSignup(input: {
  name: string
  email: string
  submittedIp?: string
}): Promise<SubmitWaitlistResult> {
  const supabase = createSupabaseAdminClient()

  const { error } = await supabase.from('waitlist_signups').insert({
    name: input.name,
    email: input.email,
    submitted_ip: input.submittedIp ?? null,
  })

  if (error) {
    if (error.code === '23505') {
      return { ok: false, code: 'duplicate_email' }
    }
    console.error('[waitlist] Failed to insert signup:', error.message)
    return { ok: false, code: 'internal_error' }
  }

  const superAdminEmails = await getActiveSuperAdminEmails()
  await Promise.all(
    superAdminEmails.map((email) =>
      sendNewWaitlistSignupEmail(email, input.name, input.email).catch((err) =>
        console.error('[waitlist] sendNewWaitlistSignupEmail failed:', err)
      )
    )
  )

  return { ok: true }
}

export interface WaitlistSignup {
  id: string
  name: string
  email: string
  created_at: string
}

export async function listWaitlistSignups(): Promise<WaitlistSignup[]> {
  const supabase = createSupabaseAdminClient()
  const { data } = await supabase
    .from('waitlist_signups')
    .select('id, name, email, created_at')
    .order('created_at', { ascending: false })

  return (data ?? []).map((row) => ({
    id: row.id as string,
    name: row.name as string,
    email: row.email as string,
    created_at: row.created_at as string,
  }))
}

export async function deleteWaitlistSignup(id: string): Promise<{ success: boolean; found: boolean }> {
  const supabase = createSupabaseAdminClient()

  const { data: existing } = await supabase.from('waitlist_signups').select('id').eq('id', id).maybeSingle()
  if (!existing) {
    return { success: false, found: false }
  }

  const { error } = await supabase.from('waitlist_signups').delete().eq('id', id)
  if (error) {
    console.error('[waitlist] Failed to delete signup:', error.message)
    return { success: false, found: true }
  }

  return { success: true, found: true }
}
