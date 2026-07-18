import { checkStepComplete } from './wizard'
import { VISIBLE_SECTIONS, type ConfiguratorSection, type ConfiguratorStatus } from './configurator-sections'

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
