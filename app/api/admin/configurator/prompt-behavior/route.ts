import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requirePartnerAdmin } from '@/lib/partner/auth'
import { getPromptConfig, upsertPromptConfig, type PartnerPromptConfig } from '@/lib/partner/prompt-config'
import type { DualModePromptField } from '@/lib/voice/hume-native/prompt-template'

/**
 * GET/PATCH /api/admin/configurator/prompt-behavior — B2B-11 (Requirement
 * Doc Section 5.4). Mirrors /api/admin/configurator/theme's exact
 * auth/validation shape: requirePartnerAdmin() gates every access, Zod
 * validates every write before it ever reaches upsertPromptConfig().
 *
 * No Configurator UI screen ships for this route in this pass (Section 10,
 * "Out of Scope") — it is fully usable today via direct API call, matching
 * how B2B-10 shipped backend webhook plumbing ahead of any UI.
 */

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const partnerAccountId = searchParams.get('partner_account_id')
  if (!partnerAccountId) return NextResponse.json({ error: 'partner_account_id query param is required' }, { status: 400 })

  const admin = await requirePartnerAdmin(partnerAccountId)
  if (admin.error) return admin.error

  const config = await getPromptConfig(partnerAccountId)
  return NextResponse.json({ config })
}

const DualModeSchema = z.object({
  mode: z.enum(['literal', 'instruction']),
  text: z.string().min(1).max(500),
})

const PatchSchema = z.object({
  partner_account_id: z.string().uuid(),
  tone_persona: DualModeSchema.nullable().optional(),
  deferral_phrasing: DualModeSchema.nullable().optional(),
  closing_confirmation_question: DualModeSchema.nullable().optional(),
  goodbye_line: DualModeSchema.nullable().optional(),
  join_greeting: DualModeSchema.nullable().optional(),
  verification_question_style: z.string().min(1).max(500).nullable().optional(),
  inter_section_recap_style: z.string().min(1).max(500).nullable().optional(),
})

export async function PATCH(request: NextRequest) {
  const body = await request.json().catch(() => null)
  const parsed = PatchSchema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: 'Validation failed', details: parsed.error.flatten() }, { status: 400 })

  const admin = await requirePartnerAdmin(parsed.data.partner_account_id)
  if (admin.error) return admin.error

  // Only keys genuinely PRESENT in the parsed body become patch entries — a
  // key entirely absent from the JSON body is "leave unchanged" (undefined
  // after Zod parse); a key present with value `null` is "clear to default".
  // This is upsertPromptConfig()'s own partial-merge contract (Section 5.2).
  const patch: Partial<Record<keyof PartnerPromptConfig, unknown>> = {}
  if (parsed.data.tone_persona !== undefined) patch.tonePersona = parsed.data.tone_persona
  if (parsed.data.deferral_phrasing !== undefined) patch.deferralPhrasing = parsed.data.deferral_phrasing
  if (parsed.data.closing_confirmation_question !== undefined) patch.closingConfirmationQuestion = parsed.data.closing_confirmation_question
  if (parsed.data.goodbye_line !== undefined) patch.goodbyeLine = parsed.data.goodbye_line
  if (parsed.data.join_greeting !== undefined) patch.joinGreeting = parsed.data.join_greeting
  if (parsed.data.verification_question_style !== undefined) patch.verificationQuestionStyle = parsed.data.verification_question_style
  if (parsed.data.inter_section_recap_style !== undefined) patch.interSectionRecapStyle = parsed.data.inter_section_recap_style

  const result = await upsertPromptConfig(
    parsed.data.partner_account_id,
    patch as Partial<Record<keyof PartnerPromptConfig, DualModePromptField | string | null>>
  )
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 422 })

  return NextResponse.json({ config: result.data })
}
