import { createSupabaseAdminClient } from '@/lib/supabase'
import { getDomainSettings } from './domain-settings'

/**
 * B2B-05 v1.1 — Onboarding wizard progress (Requirement Doc Section 13,
 * architecture.md §14.7). Backs `/api/admin/configurator/wizard/*`.
 */

export type WizardStep = 'questionnaire' | 'topics' | 'content' | 'visualization' | 'domain' | 'payment'
export type WizardCurrentStep = WizardStep | 'go_live'
export type StepStatus = 'pending' | 'completed' | 'skipped'

export const STEP_ORDER: WizardStep[] = ['questionnaire', 'topics', 'content', 'visualization', 'domain', 'payment']

export interface WizardProgress {
  currentStep: WizardCurrentStep
  onboardingCompletedAt: string | null
  steps: Record<WizardStep, { status: StepStatus; statusAt: string | null }>
}

interface ProgressRow {
  current_step: WizardCurrentStep
  questionnaire_status: StepStatus
  questionnaire_status_at: string | null
  topics_status: StepStatus
  topics_status_at: string | null
  content_status: StepStatus
  content_status_at: string | null
  visualization_status: StepStatus
  visualization_status_at: string | null
  domain_status: StepStatus
  domain_status_at: string | null
  payment_status: StepStatus
  payment_status_at: string | null
}

const STEP_COLUMN: Record<WizardStep, { status: keyof ProgressRow; statusAt: keyof ProgressRow }> = {
  questionnaire: { status: 'questionnaire_status', statusAt: 'questionnaire_status_at' },
  topics: { status: 'topics_status', statusAt: 'topics_status_at' },
  content: { status: 'content_status', statusAt: 'content_status_at' },
  visualization: { status: 'visualization_status', statusAt: 'visualization_status_at' },
  domain: { status: 'domain_status', statusAt: 'domain_status_at' },
  payment: { status: 'payment_status', statusAt: 'payment_status_at' },
}

function rowToSteps(row: ProgressRow): WizardProgress['steps'] {
  return {
    questionnaire: { status: row.questionnaire_status, statusAt: row.questionnaire_status_at },
    topics: { status: row.topics_status, statusAt: row.topics_status_at },
    content: { status: row.content_status, statusAt: row.content_status_at },
    visualization: { status: row.visualization_status, statusAt: row.visualization_status_at },
    domain: { status: row.domain_status, statusAt: row.domain_status_at },
    payment: { status: row.payment_status, statusAt: row.payment_status_at },
  }
}

/** Snake-case wire format matching the Requirement Doc's exact `GET .../wizard/progress` shape. */
export function serializeWizardProgress(progress: WizardProgress) {
  return {
    current_step: progress.currentStep,
    onboarding_completed_at: progress.onboardingCompletedAt,
    steps: {
      questionnaire: { status: progress.steps.questionnaire.status, status_at: progress.steps.questionnaire.statusAt },
      topics: { status: progress.steps.topics.status, status_at: progress.steps.topics.statusAt },
      content: { status: progress.steps.content.status, status_at: progress.steps.content.statusAt },
      visualization: { status: progress.steps.visualization.status, status_at: progress.steps.visualization.statusAt },
      domain: { status: progress.steps.domain.status, status_at: progress.steps.domain.statusAt },
      payment: { status: progress.steps.payment.status, status_at: progress.steps.payment.statusAt },
    },
  }
}

const PROGRESS_COLUMNS =
  'current_step, questionnaire_status, questionnaire_status_at, topics_status, topics_status_at, ' +
  'content_status, content_status_at, visualization_status, visualization_status_at, ' +
  'domain_status, domain_status_at, payment_status, payment_status_at'

/**
 * Reads (lazily creating) `partner_onboarding_progress` for an account —
 * Requirement Doc Section 13.3, architecture.md §14.7.3.
 */
export async function getOrCreateWizardProgress(partnerAccountId: string): Promise<WizardProgress> {
  const supabase = createSupabaseAdminClient()

  const { data: existing } = await supabase
    .from('partner_onboarding_progress')
    .select(PROGRESS_COLUMNS)
    .eq('partner_account_id', partnerAccountId)
    .maybeSingle()

  let row = existing as ProgressRow | null

  if (!row) {
    const { data: created, error } = await supabase
      .from('partner_onboarding_progress')
      .insert({ partner_account_id: partnerAccountId })
      .select(PROGRESS_COLUMNS)
      .single()

    if (error) {
      // Race: another request created the row first (two tabs mid-first-load).
      const { data: reFetched } = await supabase
        .from('partner_onboarding_progress')
        .select(PROGRESS_COLUMNS)
        .eq('partner_account_id', partnerAccountId)
        .single()
      row = reFetched as unknown as ProgressRow
    } else {
      row = created as unknown as ProgressRow
    }
  }

  const { data: account } = await supabase
    .from('partner_accounts')
    .select('onboarding_completed_at')
    .eq('id', partnerAccountId)
    .maybeSingle()

  return {
    currentStep: row.current_step,
    onboardingCompletedAt: (account?.onboarding_completed_at as string | null) ?? null,
    steps: rowToSteps(row),
  }
}

/**
 * Per-step "complete" condition, exact read paths — architecture.md §14.7.2.
 * Never invents new query logic; each already backs an existing GET endpoint.
 */
export async function checkStepComplete(partnerAccountId: string, step: WizardStep): Promise<boolean> {
  const supabase = createSupabaseAdminClient()

  switch (step) {
    case 'questionnaire': {
      // architecture.md §14.7.2 cites a `questionnaires` table; the live
      // schema (migration 074) names it `partner_questionnaires` — this
      // function targets the real table so the check actually runs.
      const { data } = await supabase
        .from('partner_questionnaires')
        .select('id')
        .eq('partner_account_id', partnerAccountId)
        .eq('status', 'published')
        .limit(1)
        .maybeSingle()
      return !!data
    }
    case 'topics': {
      const { data } = await supabase
        .from('partner_topic_config')
        .select('id')
        .eq('partner_account_id', partnerAccountId)
        .maybeSingle()
      return !!data
    }
    case 'content': {
      const { data } = await supabase
        .from('partner_content_config')
        .select('id')
        .eq('partner_account_id', partnerAccountId)
        .maybeSingle()
      return !!data
    }
    case 'visualization': {
      const { data } = await supabase
        .from('partner_theme_config')
        .select('id')
        .eq('partner_account_id', partnerAccountId)
        .maybeSingle()
      return !!data
    }
    case 'domain': {
      const { data } = await supabase
        .from('partner_accounts')
        .select('subdomain_slug')
        .eq('id', partnerAccountId)
        .maybeSingle()
      return !!data?.subdomain_slug
    }
    case 'payment': {
      const { data } = await supabase
        .from('partner_wallets')
        .select('funding_mechanism')
        .eq('partner_account_id', partnerAccountId)
        .maybeSingle()
      return !!data?.funding_mechanism
    }
  }
}

function nextStepAfter(step: WizardStep): WizardCurrentStep {
  const idx = STEP_ORDER.indexOf(step)
  return idx === STEP_ORDER.length - 1 ? 'go_live' : STEP_ORDER[idx + 1]
}

export type AdvanceResult =
  | { ok: true; data: WizardProgress }
  | { ok: false; code: 'step_not_ready'; status: 422 }
  | { ok: false; code: 'step_mismatch'; status: 409 }

/** `POST /api/admin/configurator/wizard/advance` — Requirement Doc 13.4.C/14.7.3. */
export async function advanceWizardStep(
  partnerAccountId: string,
  step: WizardStep,
  action: 'complete' | 'skip'
): Promise<AdvanceResult> {
  const supabase = createSupabaseAdminClient()
  const progress = await getOrCreateWizardProgress(partnerAccountId)

  // Server re-validates step === current_step — never trusts the client to
  // name an arbitrary step (Requirement Doc 14.7.3).
  if (progress.currentStep !== step) {
    return { ok: false, code: 'step_mismatch', status: 409 }
  }

  if (action === 'complete') {
    const complete = await checkStepComplete(partnerAccountId, step)
    if (!complete) {
      return { ok: false, code: 'step_not_ready', status: 422 }
    }
  }

  const columns = STEP_COLUMN[step]
  const nowIso = new Date().toISOString()
  const nextStep = nextStepAfter(step)

  await supabase
    .from('partner_onboarding_progress')
    .update({
      [columns.status]: action === 'complete' ? 'completed' : 'skipped',
      [columns.statusAt]: nowIso,
      current_step: nextStep,
    })
    .eq('partner_account_id', partnerAccountId)

  const updated = await getOrCreateWizardProgress(partnerAccountId)
  return { ok: true, data: updated }
}

export type GoLiveResult =
  | { ok: true; onboardingCompletedAt: string; liveUrl: string }
  | { ok: false; code: 'steps_incomplete'; pendingSteps: WizardStep[] }

/**
 * `POST /api/admin/configurator/wizard/go-live` — Requirement Doc 13.4.C.
 *
 * B2B-20 §6.3: in the non-linear surface there is no "skip" action, so the old
 * "all six stored statuses non-pending" gate is re-expressed as a LIVE
 * completion check over a defined REQUIRED set — Questionnaire + Payment only.
 * Everything else is optional (working Clio defaults exist). This is a
 * deliberate, CEO-confirmed strengthening (the old gate could pass with
 * everything skipped); it is a single-constant change if the required set ever
 * changes. Validation uses the same `checkStepComplete()` existence checks the
 * nav's completion dots use, so the button-disabled state and the server gate
 * agree.
 */
const GO_LIVE_REQUIRED_STEPS: WizardStep[] = ['questionnaire', 'payment']

export async function goLive(partnerAccountId: string): Promise<GoLiveResult> {
  const supabase = createSupabaseAdminClient()

  const checks = await Promise.all(
    GO_LIVE_REQUIRED_STEPS.map((step) => checkStepComplete(partnerAccountId, step)),
  )
  const pendingSteps = GO_LIVE_REQUIRED_STEPS.filter((_, i) => !checks[i])
  if (pendingSteps.length > 0) {
    return { ok: false, code: 'steps_incomplete', pendingSteps }
  }

  const nowIso = new Date().toISOString()
  await supabase
    .from('partner_accounts')
    .update({ onboarding_completed_at: nowIso })
    .eq('id', partnerAccountId)

  await supabase
    .from('partner_onboarding_progress')
    .update({ current_step: 'go_live' })
    .eq('partner_account_id', partnerAccountId)

  // live_url precedence: verified custom_domain_url > subdomain_url > raw
  // Clio-domain fallback (Requirement Doc 13.4.C, identical to GET .../domain's
  // own display-precedence logic).
  const domainSettings = await getDomainSettings(partnerAccountId)
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'https://distill-peach.vercel.app'
  const liveUrl =
    domainSettings?.customDomainUrl ??
    domainSettings?.subdomainUrl ??
    `${appUrl}/partner-questionnaire/${partnerAccountId}`

  return { ok: true, onboardingCompletedAt: nowIso, liveUrl }
}
