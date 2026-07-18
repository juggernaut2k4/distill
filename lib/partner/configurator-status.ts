import { createSupabaseAdminClient } from '@/lib/supabase'
import { checkStepComplete } from './wizard'

/**
 * B2B-20 §6.1 — thin aggregator for the Configurator left-nav completion dots.
 *
 * Composes the SIX existing per-section existence checks from
 * `checkStepComplete()` (`lib/partner/wizard.ts`) plus the Integration rule
 * reused from the Configurator Home ("OAuth clients count > 0"). This invents
 * NO new query logic — it is exactly the same lightweight `select('id')`
 * existence reads the wizard already performs one step at a time, returned as
 * one map for the nav's dots.
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

/**
 * Integration completeness — reuses Home's existing "OAuth clients count > 0"
 * rule against the same `partner_oauth_clients` table the
 * `GET /api/admin/configurator/oauth-clients` endpoint reads.
 */
async function checkIntegrationComplete(partnerAccountId: string): Promise<boolean> {
  const supabase = createSupabaseAdminClient()
  const { data } = await supabase
    .from('partner_oauth_clients')
    .select('id')
    .eq('partner_account_id', partnerAccountId)
    .limit(1)
    .maybeSingle()
  return !!data
}

/**
 * Returns the live completion map for all seven configurable sections.
 * `checkStepComplete` covers six; Integration is added via the OAuth-count rule.
 */
export async function getConfiguratorStatus(partnerAccountId: string): Promise<ConfiguratorStatus> {
  const [questionnaire, topics, content, visualization, domain, payment, integration] = await Promise.all([
    checkStepComplete(partnerAccountId, 'questionnaire'),
    checkStepComplete(partnerAccountId, 'topics'),
    checkStepComplete(partnerAccountId, 'content'),
    checkStepComplete(partnerAccountId, 'visualization'),
    checkStepComplete(partnerAccountId, 'domain'),
    checkStepComplete(partnerAccountId, 'payment'),
    checkIntegrationComplete(partnerAccountId),
  ])

  return { questionnaire, topics, content, visualization, domain, integration, payment }
}
