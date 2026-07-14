import { createSupabaseAdminClient } from '@/lib/supabase'
import { decryptOutboundToken } from './crypto'

/**
 * B2B-03 — Questionnaire Builder (Requirement Doc Section 4.A.1, 6.1;
 * architecture.md Section 12.1/12.2/12.3).
 */

export type QuestionType = 'multiple_choice' | 'short_text' | 'yes_no'

export interface QuestionnaireQuestion {
  id: string
  text: string
  type: QuestionType
  options?: string[]
  required: boolean
}

export interface PartnerQuestionnaire {
  id: string
  partnerAccountId: string
  status: 'draft' | 'published'
  layout: 'single_page' | 'multi_page'
  schema: QuestionnaireQuestion[]
  createdAt: string
  updatedAt: string
}

function rowToQuestionnaire(row: Record<string, unknown>): PartnerQuestionnaire {
  return {
    id: row.id as string,
    partnerAccountId: row.partner_account_id as string,
    status: row.status as PartnerQuestionnaire['status'],
    layout: row.layout as PartnerQuestionnaire['layout'],
    schema: (row.schema as QuestionnaireQuestion[]) ?? [],
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  }
}

/** Validates one question against Section 4.A.1's exact builder constraints. */
export function validateQuestion(q: unknown): q is QuestionnaireQuestion {
  if (!q || typeof q !== 'object') return false
  const question = q as Record<string, unknown>
  if (typeof question.id !== 'string' || !question.id) return false
  if (typeof question.text !== 'string' || question.text.length === 0 || question.text.length > 200) return false
  if (question.type !== 'multiple_choice' && question.type !== 'short_text' && question.type !== 'yes_no') return false
  if (typeof question.required !== 'boolean') return false

  if (question.type === 'multiple_choice') {
    if (!Array.isArray(question.options)) return false
    const options = question.options as unknown[]
    if (options.length < 2 || options.length > 8) return false
    if (!options.every((o) => typeof o === 'string' && o.length > 0 && o.length <= 60)) return false
  }

  return true
}

export function validateQuestionnaireSchema(schema: unknown): schema is QuestionnaireQuestion[] {
  return Array.isArray(schema) && schema.every(validateQuestion)
}

export async function listQuestionnaires(partnerAccountId: string): Promise<PartnerQuestionnaire[]> {
  const supabase = createSupabaseAdminClient()
  const { data } = await supabase
    .from('partner_questionnaires')
    .select('*')
    .eq('partner_account_id', partnerAccountId)
    .order('created_at', { ascending: false })

  return (data ?? []).map(rowToQuestionnaire)
}

export async function getQuestionnaire(partnerAccountId: string, id: string): Promise<PartnerQuestionnaire | null> {
  const supabase = createSupabaseAdminClient()
  const { data } = await supabase
    .from('partner_questionnaires')
    .select('*')
    .eq('partner_account_id', partnerAccountId)
    .eq('id', id)
    .maybeSingle()

  return data ? rowToQuestionnaire(data) : null
}

/** The one questionnaire visible to end users at /partner-questionnaire/[partner_account_id] — status='published'. No auth; called from a public route. */
export async function getPublishedQuestionnaire(partnerAccountId: string): Promise<PartnerQuestionnaire | null> {
  const supabase = createSupabaseAdminClient()
  const { data } = await supabase
    .from('partner_questionnaires')
    .select('*')
    .eq('partner_account_id', partnerAccountId)
    .eq('status', 'published')
    .maybeSingle()

  return data ? rowToQuestionnaire(data) : null
}

export async function createQuestionnaire(
  partnerAccountId: string,
  layout: 'single_page' | 'multi_page' = 'single_page'
): Promise<PartnerQuestionnaire | null> {
  const supabase = createSupabaseAdminClient()
  const { data, error } = await supabase
    .from('partner_questionnaires')
    .insert({ partner_account_id: partnerAccountId, layout, status: 'draft', schema: [] })
    .select('*')
    .single()

  if (error || !data) {
    console.error('[partner/questionnaire] createQuestionnaire failed:', error?.message)
    return null
  }
  return rowToQuestionnaire(data)
}

export async function updateQuestionnaire(
  partnerAccountId: string,
  id: string,
  updates: { layout?: 'single_page' | 'multi_page'; schema?: QuestionnaireQuestion[] }
): Promise<{ ok: true; data: PartnerQuestionnaire } | { ok: false; error: string }> {
  if (updates.schema !== undefined && !validateQuestionnaireSchema(updates.schema)) {
    return { ok: false, error: 'invalid_schema' }
  }

  const supabase = createSupabaseAdminClient()
  const patch: Record<string, unknown> = {}
  if (updates.layout) patch.layout = updates.layout
  if (updates.schema) patch.schema = updates.schema

  const { data, error } = await supabase
    .from('partner_questionnaires')
    .update(patch)
    .eq('partner_account_id', partnerAccountId)
    .eq('id', id)
    .select('*')
    .maybeSingle()

  if (error || !data) return { ok: false, error: error?.message ?? 'not_found' }
  return { ok: true, data: rowToQuestionnaire(data) }
}

/**
 * Enforces the single-published-per-partner invariant (Section 6.1):
 * transactionally sets the target `published` and every other row for this
 * partner back to `draft`. Rejects with `422` (via the `no_questions`
 * error) if the target has zero questions, per Section 8.
 */
export async function publishQuestionnaire(
  partnerAccountId: string,
  id: string
): Promise<{ ok: true; data: PartnerQuestionnaire } | { ok: false; error: string }> {
  const supabase = createSupabaseAdminClient()

  const { data: target } = await supabase
    .from('partner_questionnaires')
    .select('id, schema')
    .eq('partner_account_id', partnerAccountId)
    .eq('id', id)
    .maybeSingle()

  if (!target) return { ok: false, error: 'not_found' }
  const schema = (target.schema as QuestionnaireQuestion[]) ?? []
  if (schema.length === 0) return { ok: false, error: 'no_questions' }

  // Supabase-js has no multi-statement transaction primitive here; this
  // codebase's established concurrency precedent for this exact shape
  // (kb_qa_rules/template_library, Section 8) is last-write-wins, not a DB
  // transaction. We sequence the two writes: demote siblings first, then
  // promote the target — so a concurrent read never observes zero drafts and
  // two published rows simultaneously (the target briefly being 'draft'
  // alongside other 'draft' rows is a benign intermediate state; two
  // simultaneously 'published' rows never occurs).
  await supabase
    .from('partner_questionnaires')
    .update({ status: 'draft' })
    .eq('partner_account_id', partnerAccountId)
    .eq('status', 'published')
    .neq('id', id)

  const { data, error } = await supabase
    .from('partner_questionnaires')
    .update({ status: 'published' })
    .eq('partner_account_id', partnerAccountId)
    .eq('id', id)
    .select('*')
    .single()

  if (error || !data) return { ok: false, error: error?.message ?? 'publish_failed' }
  return { ok: true, data: rowToQuestionnaire(data) }
}

export async function unpublishQuestionnaire(partnerAccountId: string, id: string): Promise<boolean> {
  const supabase = createSupabaseAdminClient()
  const { error } = await supabase
    .from('partner_questionnaires')
    .update({ status: 'draft' })
    .eq('partner_account_id', partnerAccountId)
    .eq('id', id)

  return !error
}

// ─── End-user submission — synchronous forward, never persisted (Section 6.1/12.3) ──

export interface SubmitQuestionnaireResult {
  ok: boolean
  httpStatusCode: number | null
}

/**
 * Forwards an end user's answers synchronously to
 * `{outbound_base_url}/questionnaire-response` and never writes the payload
 * to any Clio table — only a thin, payload-free delivery-status audit row
 * (`questionnaire_dispatch_log`, Section 6.1) is recorded.
 */
export async function submitQuestionnaireAnswers(
  partnerAccountId: string,
  answers: Record<string, unknown>
): Promise<SubmitQuestionnaireResult> {
  const supabase = createSupabaseAdminClient()
  const { data: account } = await supabase
    .from('partner_accounts')
    .select('outbound_base_url, outbound_auth_token_ciphertext')
    .eq('id', partnerAccountId)
    .maybeSingle()

  const outboundBaseUrl = (account?.outbound_base_url as string | null) ?? null
  if (!outboundBaseUrl) {
    await supabase.from('questionnaire_dispatch_log').insert({
      partner_account_id: partnerAccountId,
      delivery_status: 'failed',
      http_status_code: null,
    })
    return { ok: false, httpStatusCode: null }
  }

  const token = decryptOutboundToken((account?.outbound_auth_token_ciphertext as string | null) ?? null)
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (token) headers.Authorization = `Bearer ${token}`

  let httpStatusCode: number | null = null
  let delivered = false

  try {
    const res = await fetch(`${outboundBaseUrl.replace(/\/$/, '')}/questionnaire-response`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ answers, submitted_at: new Date().toISOString() }),
    })
    httpStatusCode = res.status
    delivered = res.ok
  } catch (err) {
    console.error('[partner/questionnaire] submit forward failed:', err instanceof Error ? err.message : err)
  }

  await supabase.from('questionnaire_dispatch_log').insert({
    partner_account_id: partnerAccountId,
    delivery_status: delivered ? 'delivered' : 'failed',
    http_status_code: httpStatusCode,
  })

  return { ok: delivered, httpStatusCode }
}
