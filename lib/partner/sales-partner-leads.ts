import { createSupabaseAdminClient } from '@/lib/supabase'
import { sendNewSalesPartnerLeadEmail } from '@/lib/delivery/email'

/**
 * B2B-80 (docs/specs/B2B-80-requirement-document.md §6.1/§6.4/§6.5) — CRUD + notification helpers
 * for `sales_partner_leads`, the public `/partner-inquiry` submission's own table.
 */

export interface SalesPartnerLead {
  id: string
  name: string
  company_name: string
  email: string
  phone: string | null
  message: string | null
  status: 'new' | 'contacted' | 'invited' | 'declined'
  created_at: string
  contacted_at: string | null
  invite_id: string | null
}

export type SubmitLeadResult =
  | { ok: true }
  | { ok: false; code: 'duplicate_recent_submission' }
  | { ok: false; code: 'internal_error' }

/**
 * §6.5 — duplicate-submission guard: a row with the same email within the last 24 hours is
 * rejected with a friendly message, not silently merged or duplicated. Also fires the
 * admin-notification email on success (§6.4) — synchronous, single low-volume send, no Inngest
 * job. The honeypot check itself lives in the route handler (a request-shape concern, not a data
 * concern), not here.
 */
export async function submitSalesPartnerLead(input: {
  name: string
  companyName: string
  email: string
  phone?: string
  message?: string
  submittedIp?: string
}): Promise<SubmitLeadResult> {
  const supabase = createSupabaseAdminClient()

  const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
  const { data: recentRows } = await supabase
    .from('sales_partner_leads')
    .select('id')
    .eq('email', input.email)
    .gt('created_at', dayAgo)
    .limit(1)
  if (recentRows?.[0]) {
    return { ok: false, code: 'duplicate_recent_submission' }
  }

  const { error } = await supabase.from('sales_partner_leads').insert({
    name: input.name,
    company_name: input.companyName,
    email: input.email,
    phone: input.phone ?? null,
    message: input.message ?? null,
    submitted_ip: input.submittedIp ?? null,
  })

  if (error) {
    console.error('[sales-partner-leads] Failed to insert lead:', error.message)
    return { ok: false, code: 'internal_error' }
  }

  const superAdminEmails = await getActiveSuperAdminEmails()
  await Promise.all(
    superAdminEmails.map((email) =>
      sendNewSalesPartnerLeadEmail(email, input.name, input.companyName, input.email).catch((err) =>
        console.error('[sales-partner-leads] sendNewSalesPartnerLeadEmail failed:', err)
      )
    )
  )

  return { ok: true }
}

/**
 * §6.4 — the exact set the spec specifies: active super-admins, distinct from
 * `getPartnerAdminEmails()` (a different table, partner-side admins).
 */
export async function getActiveSuperAdminEmails(): Promise<string[]> {
  const supabase = createSupabaseAdminClient()
  const { data } = await supabase
    .from('internal_admin_users')
    .select('email')
    .eq('role', 'super_admin')
    .eq('status', 'active')
  return (data ?? []).map((row) => row.email as string).filter(Boolean)
}

export async function listSalesPartnerLeads(): Promise<SalesPartnerLead[]> {
  const supabase = createSupabaseAdminClient()
  const { data } = await supabase
    .from('sales_partner_leads')
    .select('id, name, company_name, email, phone, message, status, created_at, contacted_at, invite_id')
    .order('created_at', { ascending: false })

  return (data ?? []).map((row) => ({
    id: row.id as string,
    name: row.name as string,
    company_name: row.company_name as string,
    email: row.email as string,
    phone: (row.phone as string | null) ?? null,
    message: (row.message as string | null) ?? null,
    status: row.status as SalesPartnerLead['status'],
    created_at: row.created_at as string,
    contacted_at: (row.contacted_at as string | null) ?? null,
    invite_id: (row.invite_id as string | null) ?? null,
  }))
}

/** §8 — "Mark contacted" is a plain status update, no confirmation. */
export async function markSalesPartnerLeadContacted(leadId: string): Promise<{ success: boolean }> {
  const supabase = createSupabaseAdminClient()
  const { error } = await supabase
    .from('sales_partner_leads')
    .update({ status: 'contacted', contacted_at: new Date().toISOString() })
    .eq('id', leadId)
    .eq('status', 'new')
  return { success: !error }
}

/**
 * §4.B / §8 — "Decline" sets status='declined', no confirmation dialog, reversible only by
 * re-contacting the lead through the "Invite" action later (a soft status, not a delete).
 */
export async function declineSalesPartnerLead(leadId: string): Promise<{ success: boolean }> {
  const supabase = createSupabaseAdminClient()
  const { error } = await supabase.from('sales_partner_leads').update({ status: 'declined' }).eq('id', leadId)
  return { success: !error }
}
