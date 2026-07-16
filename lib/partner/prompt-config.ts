import { createSupabaseAdminClient } from '@/lib/supabase'
import type { DualModePromptField, PromptFieldMode } from '@/lib/voice/hume-native/prompt-template'

/**
 * B2B-11 — Prompt Behavior Configurability (Requirement Doc Section 4/5.2).
 *
 * Mirrors lib/partner/theme.ts's exact four-hop wiring shape (column ->
 * getXConfig() read -> assembly-input field -> template substitution) and
 * its "never trust the client, re-validate server-side" doctrine
 * (isValidHexColor etc. there, isValidDualModeField/isValidInstructionText
 * here). Reads never throw and never block a render — a missing or
 * malformed row resolves to CLIO_DEFAULT_PROMPT_CONFIG (Section 8).
 *
 * Isolation mechanism identical to theme.ts's own: every read/write here is
 * explicitly scoped `.eq('partner_account_id', partnerAccountId)` — there is
 * no code path that reads or writes a config row without that clause.
 */

export interface PartnerPromptConfig {
  tonePersona: DualModePromptField | null
  deferralPhrasing: DualModePromptField | null
  closingConfirmationQuestion: DualModePromptField | null
  goodbyeLine: DualModePromptField | null
  joinGreeting: DualModePromptField | null
  verificationQuestionStyle: string | null
  interSectionRecapStyle: string | null
}

export const CLIO_DEFAULT_PROMPT_CONFIG: PartnerPromptConfig = {
  tonePersona: null,
  deferralPhrasing: null,
  closingConfirmationQuestion: null,
  goodbyeLine: null,
  joinGreeting: null,
  verificationQuestionStyle: null,
  interSectionRecapStyle: null,
}

/**
 * B2B-11 Section 6.4, Technical Decision 5 — default join-greeting wording,
 * used whenever `PartnerPromptConfig.joinGreeting` is null (partner never
 * configured this field). Never persisted to the DB as a "default row" — a
 * future change to this constant applies retroactively to every unconfigured
 * partner with no migration needed. Instruction mode (not literal) so Clio's
 * own LLM phrases the greeting naturally regardless of exactly where in the
 * session flow the join happens. Contains no reference to "Arun," no
 * unprompted literal "Clio," and no B2C-specific framing.
 */
export const DEFAULT_JOIN_GREETING: DualModePromptField = {
  mode: 'instruction',
  text: 'The participant, {firstName}, just joined the call. Greet them warmly by name in one short, natural sentence, then continue exactly where you were before they joined — do not restart, re-introduce yourself, or repeat anything already covered.',
}

const PROMPT_FIELD_MODES: PromptFieldMode[] = ['literal', 'instruction']
const MIN_TEXT_LENGTH = 1
const MAX_TEXT_LENGTH = 500

/** Field-shape validators — mirrors theme.ts's isValidHexColor()-style server-side re-validation (never trust the client, Section 4.7). */
export function isValidDualModeField(value: unknown): value is DualModePromptField {
  if (!value || typeof value !== 'object') return false
  const v = value as Record<string, unknown>
  if (typeof v.mode !== 'string' || !PROMPT_FIELD_MODES.includes(v.mode as PromptFieldMode)) return false
  return isValidInstructionText(v.text)
}

export function isValidInstructionText(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length >= MIN_TEXT_LENGTH && value.length <= MAX_TEXT_LENGTH
}

// Dual-mode fields validate as {mode, text}; instruction-only fields validate
// as a plain string and explicitly reject a {mode, text} object shape
// (Section 4.7 — verification_question_style/inter_section_recap_style have
// no literal mode by design).
const DUAL_MODE_FIELDS = new Set<keyof PartnerPromptConfig>([
  'tonePersona', 'deferralPhrasing', 'closingConfirmationQuestion', 'goodbyeLine', 'joinGreeting',
])
const INSTRUCTION_ONLY_FIELDS = new Set<keyof PartnerPromptConfig>([
  'verificationQuestionStyle', 'interSectionRecapStyle',
])

const COLUMN_BY_FIELD: Record<keyof PartnerPromptConfig, string> = {
  tonePersona: 'tone_persona',
  deferralPhrasing: 'deferral_phrasing',
  closingConfirmationQuestion: 'closing_confirmation_question',
  goodbyeLine: 'goodbye_line',
  joinGreeting: 'join_greeting',
  verificationQuestionStyle: 'verification_question_style',
  interSectionRecapStyle: 'inter_section_recap_style',
}

// Literal (not dynamically built) so the Supabase client's type-level select
// parser can resolve it — a computed `string` (e.g. Object.values(...).join())
// is widened to plain `string` and defeats that parser, per the same
// constraint theme.ts's own literal .select(...) calls already respect.
const SELECT_COLUMNS = 'tone_persona, deferral_phrasing, closing_confirmation_question, goodbye_line, join_greeting, verification_question_style, inter_section_recap_style'

function rowToConfig(data: Record<string, unknown> | null): PartnerPromptConfig {
  if (!data) return { ...CLIO_DEFAULT_PROMPT_CONFIG }

  const config = { ...CLIO_DEFAULT_PROMPT_CONFIG }
  for (const field of Object.keys(COLUMN_BY_FIELD) as (keyof PartnerPromptConfig)[]) {
    const raw = data[COLUMN_BY_FIELD[field]]
    if (raw === null || raw === undefined) continue

    if (DUAL_MODE_FIELDS.has(field)) {
      if (isValidDualModeField(raw)) {
        (config[field] as DualModePromptField | null) = raw as DualModePromptField
      } else {
        // Malformed/hand-edited row — never throws, field treated as unset,
        // every other valid field on the same row still renders (Section 8).
        console.warn(`[partner/prompt-config] Malformed dual-mode field "${field}" — treating as unset.`)
      }
    } else if (INSTRUCTION_ONLY_FIELDS.has(field)) {
      if (isValidInstructionText(raw)) {
        (config[field] as string | null) = raw as string
      } else {
        console.warn(`[partner/prompt-config] Malformed instruction-only field "${field}" — treating as unset.`)
      }
    }
  }
  return config
}

/** Level "Prompt Behavior" read. Returns CLIO_DEFAULT_PROMPT_CONFIG if unconfigured or malformed (never throws, Section 8). */
export async function getPromptConfig(partnerAccountId: string): Promise<PartnerPromptConfig> {
  const supabase = createSupabaseAdminClient()
  const { data } = await supabase
    .from('partner_prompt_config')
    .select(SELECT_COLUMNS)
    .eq('partner_account_id', partnerAccountId)
    .maybeSingle()

  return rowToConfig((data as Record<string, unknown> | null) ?? null)
}

export type UpsertResult<T> = { ok: true; data: T } | { ok: false; error: string }

/**
 * PARTIAL upsert-merge (Section 5.2): any field key ABSENT from `patch`
 * leaves that field's existing stored value unchanged; a field key present
 * with value `null` clears it back to Clio's default; a field key present
 * with a valid value sets it. Fetches the current row first, merges,
 * re-validates every field server-side (never trust the client — mirrors
 * upsertThemeConfig()'s doctrine), then upserts the full merged row. Rejects
 * the ENTIRE call (no partial write) if any single field in `patch` is
 * invalid — mirrors upsertThemeConfig()'s all-or-nothing
 * validate-then-write shape.
 */
export async function upsertPromptConfig(
  partnerAccountId: string,
  patch: Partial<Record<keyof PartnerPromptConfig, DualModePromptField | string | null>>
): Promise<UpsertResult<PartnerPromptConfig>> {
  const supabase = createSupabaseAdminClient()

  const { data: existingRow } = await supabase
    .from('partner_prompt_config')
    .select(SELECT_COLUMNS)
    .eq('partner_account_id', partnerAccountId)
    .maybeSingle()

  const current = rowToConfig((existingRow as Record<string, unknown> | null) ?? null)
  const merged: PartnerPromptConfig = { ...current }

  for (const key of Object.keys(patch) as (keyof PartnerPromptConfig)[]) {
    const value = patch[key]

    if (value === null) {
      // Explicit clear-to-default.
      ;(merged[key] as unknown) = null
      continue
    }
    if (value === undefined) continue // treated as absent — leave unchanged

    if (DUAL_MODE_FIELDS.has(key)) {
      if (!isValidDualModeField(value)) return { ok: false, error: 'invalid_prompt_field' }
      ;(merged[key] as DualModePromptField) = value as DualModePromptField
    } else if (INSTRUCTION_ONLY_FIELDS.has(key)) {
      // Instruction-only fields reject a {mode, text} object shape outright
      // (Section 4.7) — isValidInstructionText already requires a plain string.
      if (!isValidInstructionText(value)) return { ok: false, error: 'invalid_prompt_field' }
      ;(merged[key] as string) = value as string
    } else {
      return { ok: false, error: 'invalid_prompt_field' }
    }
  }

  const { data, error } = await supabase
    .from('partner_prompt_config')
    .upsert(
      {
        partner_account_id: partnerAccountId,
        tone_persona: merged.tonePersona,
        deferral_phrasing: merged.deferralPhrasing,
        closing_confirmation_question: merged.closingConfirmationQuestion,
        goodbye_line: merged.goodbyeLine,
        join_greeting: merged.joinGreeting,
        verification_question_style: merged.verificationQuestionStyle,
        inter_section_recap_style: merged.interSectionRecapStyle,
      },
      { onConflict: 'partner_account_id' }
    )
    .select(SELECT_COLUMNS)
    .single()

  if (error || !data) return { ok: false, error: error?.message ?? 'upsert_failed' }

  return { ok: true, data: rowToConfig(data as Record<string, unknown>) }
}
