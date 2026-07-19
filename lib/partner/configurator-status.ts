import { checkStepComplete } from './wizard'
import { VISIBLE_SECTIONS, type ConfiguratorSection, type ConfiguratorStatus } from './configurator-sections'
import { createSupabaseAdminClient } from '@/lib/supabase'

export { VISIBLE_SECTIONS }
export type { ConfiguratorSection, ConfiguratorStatus }

/**
 * B2B-20 §6.1 — thin aggregator for the Configurator left-nav completion dots.
 *
 * Composes the SEVEN existing per-section existence checks from
 * `checkStepComplete()` (`lib/partner/wizard.ts`). This invents NO new query
 * logic — it is exactly the same lightweight `select('id')` existence reads
 * the wizard already performs one step at a time, returned as one map for the
 * nav's dots.
 *
 * B2B-23 §6.1/§6.3 — the standalone `checkIntegrationComplete()` helper (OAuth
 * clients count > 0) is removed as dead code: `integration` now reads through
 * `checkStepComplete(partnerAccountId, 'integration')`, the exact same
 * definition the Go-Live gate uses, so the nav dot and the server gate can
 * never drift apart. Behavior consequence (deliberate, not a bug): the
 * Integration dot now reflects outbound reachability/auth (`outbound_base_url`
 * set, or a registered content source) rather than inbound OAuth-credential
 * issuance.
 */

/**
 * Returns the live completion map for all seven configurable sections
 * (visible and hidden alike — hidden sections' dots are simply never
 * rendered, per `VISIBLE_SECTIONS`).
 */
export async function getConfiguratorStatus(partnerAccountId: string): Promise<ConfiguratorStatus> {
  const [questionnaire, topics, content, visualization, domain, payment, integration] = await Promise.all([
    checkStepComplete(partnerAccountId, 'questionnaire'),
    checkStepComplete(partnerAccountId, 'topics'),
    checkStepComplete(partnerAccountId, 'content'),
    checkStepComplete(partnerAccountId, 'visualization'),
    checkStepComplete(partnerAccountId, 'domain'),
    checkStepComplete(partnerAccountId, 'payment'),
    checkStepComplete(partnerAccountId, 'integration'),
  ])

  return { questionnaire, topics, content, visualization, domain, integration, payment }
}

/**
 * B2B-27 — true when a verified card is on file for this account
 * (partner_wallets.stripe_default_payment_method_id IS NOT NULL). This is
 * NOT the same signal as checkStepComplete('payment') (which reads
 * funding_mechanism, a committed funding path) — see Section 3 of the
 * Requirement Document for why these two signals are deliberately kept
 * separate. Deliberately not part of ConfiguratorStatus/ConfiguratorSection —
 * this is not a nav section or a Go-Live requirement, just a status flag the
 * Payment screen's new card-verification block reads directly.
 */
export async function checkCardOnFile(partnerAccountId: string): Promise<boolean> {
  const supabase = createSupabaseAdminClient()
  const { data } = await supabase
    .from('partner_wallets')
    .select('stripe_default_payment_method_id')
    .eq('partner_account_id', partnerAccountId)
    .maybeSingle()
  return !!data?.stripe_default_payment_method_id
}
