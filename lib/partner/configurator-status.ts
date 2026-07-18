import { checkStepComplete } from './wizard'

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

export type ConfiguratorSection =
  | 'questionnaire'
  | 'topics'
  | 'content'
  | 'visualization'
  | 'domain'
  | 'integration'
  | 'payment'

export type ConfiguratorStatus = Record<ConfiguratorSection, boolean>

// B2B-23 WS-1 — the ONLY place that decides which sections are exposed in
// the Configurator nav. Hidden sections' routes, components, and DB tables
// remain fully intact (governance: hide, never delete) — this allowlist is
// the single toggle. Re-enabling a hidden section later is a one-line edit
// here; no other file needs to change.
export const VISIBLE_SECTIONS: ConfiguratorSection[] = ['integration', 'payment']

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
