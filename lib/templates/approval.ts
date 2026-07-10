/**
 * RTV-04 — Gate B (design-approval) helpers.
 *
 * Fails closed by deliberate design choice (unlike this codebase's
 * `canAccessKB`, which defaults OPEN when KB_ADMIN_ONLY is unset — see
 * lib/kb-access.ts). This gate is Arun's, and only Arun's: a missing or
 * misconfigured TEMPLATE_LIBRARY_APPROVER_EMAIL must never fail open.
 */

import { createSupabaseAdminClient } from '../supabase'

let warnedMissingApproverEnv = false

/**
 * Returns true only if `email` exactly matches the configured
 * TEMPLATE_LIBRARY_APPROVER_EMAIL. If the env var is unset, always returns
 * false — even for an email that would otherwise match — and logs a
 * one-time warning per process lifetime so the misconfiguration is
 * diagnosable, never silent (Section 8).
 */
export function isConfiguredApprover(email: string | null | undefined): boolean {
  const approverEmail = process.env.TEMPLATE_LIBRARY_APPROVER_EMAIL

  if (!approverEmail) {
    if (!warnedMissingApproverEnv) {
      console.warn('[template-approval] TEMPLATE_LIBRARY_APPROVER_EMAIL not configured — all approvals blocked')
      warnedMissingApproverEnv = true
    }
    return false
  }

  return !!email && email === approverEmail
}

/**
 * Test-only reset of the one-time warning flag, so tests can assert the
 * warning is logged exactly once per "cold start" without cross-test leakage.
 */
export function _resetApproverWarningForTests(): void {
  warnedMissingApproverEnv = false
}

/**
 * RTV-05 dependency (Section 12) — the single, unambiguous function future
 * phases must call to check whether a template is safe to use in a real live
 * session. A missing row for a given templateName (e.g. a future 28th
 * template type added without a seeded row) is treated as NOT approved by
 * definition — this fails closed automatically, no special-case code needed
 * (Section 8).
 *
 * NOTE for future maintainers: if a template's `container_spec` is ever
 * edited after it has been approved (e.g. a container width changes), the
 * migration/deploy path making that change MUST also reset that row's
 * `status` back to 'pending_review' — an approval is a sign-off on a
 * specific rendered design, never a standing blank check (Section 9).
 */
export async function isTemplateApprovedForProduction(templateName: string): Promise<boolean> {
  const supabase = createSupabaseAdminClient()
  const { data, error } = await supabase
    .from('template_library')
    .select('status')
    .eq('template_name', templateName)
    .maybeSingle()

  if (error || !data) return false
  return data.status === 'approved'
}
