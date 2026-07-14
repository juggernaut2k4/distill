import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requirePartnerAdmin } from '@/lib/partner/auth'
import { getThemeConfig, upsertThemeConfig } from '@/lib/partner/theme'
import { recordPreferenceSignal } from '@/lib/partner/preference'

/** GET/PATCH /api/admin/configurator/theme — Level A (Section 4.A.4 Screen state 1). */

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const partnerAccountId = searchParams.get('partner_account_id')
  if (!partnerAccountId) return NextResponse.json({ error: 'partner_account_id query param is required' }, { status: 400 })

  const admin = await requirePartnerAdmin(partnerAccountId)
  if (admin.error) return admin.error

  const theme = await getThemeConfig(partnerAccountId)
  return NextResponse.json({ theme })
}

const HEX = /^#[0-9A-Fa-f]{6}$/
const PatchSchema = z.object({
  partner_account_id: z.string().uuid(),
  theme_label: z.string().max(100).nullable().optional(),
  primary_color: z.string().regex(HEX),
  secondary_color: z.string().regex(HEX),
  accent_color: z.string().regex(HEX),
  font_family: z.enum(['Inter', 'Roboto', 'Source Sans Pro', 'IBM Plex Sans', 'system-ui']),
  corner_style: z.enum(['sharp', 'soft', 'rounded']),
  spacing_scale: z.enum(['compact', 'standard', 'spacious']),
  assistant_display_name: z.string().max(80).nullable().optional(),
})

export async function PATCH(request: NextRequest) {
  const body = await request.json().catch(() => null)
  const parsed = PatchSchema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: 'Validation failed', details: parsed.error.flatten() }, { status: 400 })

  const admin = await requirePartnerAdmin(parsed.data.partner_account_id)
  if (admin.error) return admin.error

  const result = await upsertThemeConfig(parsed.data.partner_account_id, {
    themeLabel: parsed.data.theme_label ?? null,
    primaryColor: parsed.data.primary_color,
    secondaryColor: parsed.data.secondary_color,
    accentColor: parsed.data.accent_color,
    fontFamily: parsed.data.font_family,
    cornerStyle: parsed.data.corner_style,
    spacingScale: parsed.data.spacing_scale,
    assistantDisplayName: parsed.data.assistant_display_name ?? null,
  })
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 422 })

  // Section 6.5 — +1 signal per touched domain, applied via the delayed
  // unreverted-for->=24h job in a full implementation; recorded eagerly here
  // as the "save" half of that mechanism (see lib/partner/preference.ts doc
  // comment — the delayed job is not built in this pass, flagged in the
  // final report).
  await recordPreferenceSignal(parsed.data.partner_account_id, { kind: 'theme_property_unreverted', domain: 'color' })

  return NextResponse.json({ theme: result.data })
}
