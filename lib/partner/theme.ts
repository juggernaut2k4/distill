import { createSupabaseAdminClient } from '@/lib/supabase'
import { cssCustomPropertiesToStyleBlock, type CSSCustomProperties } from './theme-client-safe'

// Re-exported so existing server-side callers of this module keep working
// unchanged — see theme-client-safe.ts's doc comment for why the
// implementation itself lives there (client-component import safety).
export { cssCustomPropertiesToStyleBlock }
export type { CSSCustomProperties }

/**
 * B2B-03 — Visualization 3-level configuration (Requirement Doc Section 6.4,
 * architecture.md Section 12.1/12.6).
 *
 * Level A (Application/product, `partner_theme_config`) always applies.
 * Level B (Template, `partner_template_config`) applies only if a row exists
 * for the given `templateName`. Level C (Component/container,
 * `partner_component_config`) applies only if rows exist for that
 * `templateName`'s component slots. Any unset level falls back to Clio's own
 * existing default token value — no partner may ever hit a broken render due
 * to missing configuration (Section 8).
 *
 * Isolation mechanism (Section 6.4, the acceptance test in Section 7 this
 * module exists to satisfy): every read here is explicitly scoped
 * `.eq('partner_account_id', partnerAccountId)` — there is no code path that
 * reads a config row without that clause present. `resolvePartnerTheme()` is
 * a pure function of `(partnerAccountId, templateName)` — a change to
 * Partner A's config can never affect the CSS custom properties resolved for
 * Partner B, because Partner B's resolution never queries a row scoped to
 * Partner A's id.
 */

export const CLIO_DEFAULT_THEME = {
  primaryColor: '#7C3AED',
  secondaryColor: '#06B6D4',
  accentColor: '#F59E0B',
  fontFamily: 'Inter',
  cornerStyle: 'soft' as const,
  spacingScale: 'standard' as const,
  assistantDisplayName: null as string | null,
}

export interface PartnerThemeConfig {
  themeLabel: string | null
  primaryColor: string
  secondaryColor: string
  accentColor: string
  fontFamily: string
  cornerStyle: 'sharp' | 'soft' | 'rounded'
  spacingScale: 'compact' | 'standard' | 'spacious'
  assistantDisplayName: string | null
}

export interface PartnerTemplateConfig {
  templateName: string
  titleOverride: string | null
  showSoWhatFooter: boolean
  motionEnabled: boolean
  colorVariant: 'default' | 'lighter' | 'darker'
}

export interface PartnerComponentConfig {
  templateName: string
  componentSlot: string
  styleMode: 'fill' | 'outline' | 'neon'
  motion: 'none' | 'fade' | 'stagger' | 'slide'
}

const HEX_RE = /^#[0-9A-Fa-f]{6}$/
const FONT_FAMILIES = new Set(['Inter', 'Roboto', 'Source Sans Pro', 'IBM Plex Sans', 'system-ui'])
const CORNER_STYLES = new Set(['sharp', 'soft', 'rounded'])
const SPACING_SCALES = new Set(['compact', 'standard', 'spacious'])
const COLOR_VARIANTS = new Set(['default', 'lighter', 'darker'])
const STYLE_MODES = new Set(['fill', 'outline', 'neon'])
const MOTIONS = new Set(['none', 'fade', 'stagger', 'slide'])

export function isValidHexColor(value: unknown): value is string {
  return typeof value === 'string' && HEX_RE.test(value)
}
export function isValidFontFamily(value: unknown): value is string {
  return typeof value === 'string' && FONT_FAMILIES.has(value)
}
export function isValidCornerStyle(value: unknown): value is PartnerThemeConfig['cornerStyle'] {
  return typeof value === 'string' && CORNER_STYLES.has(value)
}
export function isValidSpacingScale(value: unknown): value is PartnerThemeConfig['spacingScale'] {
  return typeof value === 'string' && SPACING_SCALES.has(value)
}
export function isValidColorVariant(value: unknown): value is PartnerTemplateConfig['colorVariant'] {
  return typeof value === 'string' && COLOR_VARIANTS.has(value)
}
export function isValidStyleMode(value: unknown): value is PartnerComponentConfig['styleMode'] {
  return typeof value === 'string' && STYLE_MODES.has(value)
}
export function isValidMotion(value: unknown): value is PartnerComponentConfig['motion'] {
  return typeof value === 'string' && MOTIONS.has(value)
}

/** Level A read. Returns Clio defaults if the partner has never configured a theme (Section 8). */
export async function getThemeConfig(partnerAccountId: string): Promise<PartnerThemeConfig> {
  const supabase = createSupabaseAdminClient()
  const { data } = await supabase
    .from('partner_theme_config')
    .select('theme_label, primary_color, secondary_color, accent_color, font_family, corner_style, spacing_scale, assistant_display_name')
    .eq('partner_account_id', partnerAccountId)
    .maybeSingle()

  if (!data) {
    return {
      themeLabel: null,
      primaryColor: CLIO_DEFAULT_THEME.primaryColor,
      secondaryColor: CLIO_DEFAULT_THEME.secondaryColor,
      accentColor: CLIO_DEFAULT_THEME.accentColor,
      fontFamily: CLIO_DEFAULT_THEME.fontFamily,
      cornerStyle: CLIO_DEFAULT_THEME.cornerStyle,
      spacingScale: CLIO_DEFAULT_THEME.spacingScale,
      assistantDisplayName: null,
    }
  }

  return {
    themeLabel: (data.theme_label as string | null) ?? null,
    primaryColor: data.primary_color as string,
    secondaryColor: data.secondary_color as string,
    accentColor: data.accent_color as string,
    fontFamily: data.font_family as string,
    cornerStyle: data.corner_style as PartnerThemeConfig['cornerStyle'],
    spacingScale: data.spacing_scale as PartnerThemeConfig['spacingScale'],
    assistantDisplayName: (data.assistant_display_name as string | null) ?? null,
  }
}

export interface UpsertThemeInput {
  themeLabel?: string | null
  primaryColor: string
  secondaryColor: string
  accentColor: string
  fontFamily: string
  cornerStyle: string
  spacingScale: string
  assistantDisplayName?: string | null
}

export type UpsertResult<T> = { ok: true; data: T } | { ok: false; error: string }

/** Level A write. Server-side re-validation of every field (never trust the client), per Section 6.4. */
export async function upsertThemeConfig(partnerAccountId: string, input: UpsertThemeInput): Promise<UpsertResult<PartnerThemeConfig>> {
  if (!isValidHexColor(input.primaryColor) || !isValidHexColor(input.secondaryColor) || !isValidHexColor(input.accentColor)) {
    return { ok: false, error: 'invalid_hex_color' }
  }
  if (!isValidFontFamily(input.fontFamily)) return { ok: false, error: 'invalid_font_family' }
  if (!isValidCornerStyle(input.cornerStyle)) return { ok: false, error: 'invalid_corner_style' }
  if (!isValidSpacingScale(input.spacingScale)) return { ok: false, error: 'invalid_spacing_scale' }

  const supabase = createSupabaseAdminClient()
  const { data, error } = await supabase
    .from('partner_theme_config')
    .upsert(
      {
        partner_account_id: partnerAccountId,
        theme_label: input.themeLabel ?? null,
        primary_color: input.primaryColor,
        secondary_color: input.secondaryColor,
        accent_color: input.accentColor,
        font_family: input.fontFamily,
        corner_style: input.cornerStyle,
        spacing_scale: input.spacingScale,
        assistant_display_name: input.assistantDisplayName ?? null,
      },
      { onConflict: 'partner_account_id' }
    )
    .select('theme_label, primary_color, secondary_color, accent_color, font_family, corner_style, spacing_scale, assistant_display_name')
    .single()

  if (error || !data) return { ok: false, error: error?.message ?? 'upsert_failed' }

  return {
    ok: true,
    data: {
      themeLabel: (data.theme_label as string | null) ?? null,
      primaryColor: data.primary_color as string,
      secondaryColor: data.secondary_color as string,
      accentColor: data.accent_color as string,
      fontFamily: data.font_family as string,
      cornerStyle: data.corner_style as PartnerThemeConfig['cornerStyle'],
      spacingScale: data.spacing_scale as PartnerThemeConfig['spacingScale'],
      assistantDisplayName: (data.assistant_display_name as string | null) ?? null,
    },
  }
}

/**
 * RTV-04 interaction, branch (a) (Section 6.4): a template may only be
 * Level-B/C-configured if `template_library.status = 'approved'`. Server-side
 * re-check on every write — never trust a client-cached list.
 */
export async function isTemplateApprovedForConfig(templateName: string): Promise<boolean> {
  const supabase = createSupabaseAdminClient()
  const { data } = await supabase
    .from('template_library')
    .select('status')
    .eq('template_name', templateName)
    .maybeSingle()
  return data?.status === 'approved'
}

export async function getTemplateConfig(partnerAccountId: string, templateName: string): Promise<PartnerTemplateConfig | null> {
  const supabase = createSupabaseAdminClient()
  const { data } = await supabase
    .from('partner_template_config')
    .select('template_name, title_override, show_so_what_footer, motion_enabled, color_variant')
    .eq('partner_account_id', partnerAccountId)
    .eq('template_name', templateName)
    .maybeSingle()

  if (!data) return null
  return {
    templateName: data.template_name as string,
    titleOverride: (data.title_override as string | null) ?? null,
    showSoWhatFooter: Boolean(data.show_so_what_footer),
    motionEnabled: Boolean(data.motion_enabled),
    colorVariant: data.color_variant as PartnerTemplateConfig['colorVariant'],
  }
}

export interface UpsertTemplateConfigInput {
  titleOverride?: string | null
  showSoWhatFooter: boolean
  motionEnabled: boolean
  colorVariant: string
}

export async function upsertTemplateConfig(
  partnerAccountId: string,
  templateName: string,
  input: UpsertTemplateConfigInput
): Promise<UpsertResult<PartnerTemplateConfig>> {
  if (!(await isTemplateApprovedForConfig(templateName))) {
    return { ok: false, error: 'template_not_approved' }
  }
  if (!isValidColorVariant(input.colorVariant)) return { ok: false, error: 'invalid_color_variant' }

  const supabase = createSupabaseAdminClient()
  const { data, error } = await supabase
    .from('partner_template_config')
    .upsert(
      {
        partner_account_id: partnerAccountId,
        template_name: templateName,
        title_override: input.titleOverride ?? null,
        show_so_what_footer: input.showSoWhatFooter,
        motion_enabled: input.motionEnabled,
        color_variant: input.colorVariant,
      },
      { onConflict: 'partner_account_id,template_name' }
    )
    .select('template_name, title_override, show_so_what_footer, motion_enabled, color_variant')
    .single()

  if (error || !data) return { ok: false, error: error?.message ?? 'upsert_failed' }
  return {
    ok: true,
    data: {
      templateName: data.template_name as string,
      titleOverride: (data.title_override as string | null) ?? null,
      showSoWhatFooter: Boolean(data.show_so_what_footer),
      motionEnabled: Boolean(data.motion_enabled),
      colorVariant: data.color_variant as PartnerTemplateConfig['colorVariant'],
    },
  }
}

export async function getComponentConfig(
  partnerAccountId: string,
  templateName: string,
  componentSlot: string
): Promise<PartnerComponentConfig | null> {
  const supabase = createSupabaseAdminClient()
  const { data } = await supabase
    .from('partner_component_config')
    .select('template_name, component_slot, style_mode, motion')
    .eq('partner_account_id', partnerAccountId)
    .eq('template_name', templateName)
    .eq('component_slot', componentSlot)
    .maybeSingle()

  if (!data) return null
  return {
    templateName: data.template_name as string,
    componentSlot: data.component_slot as string,
    styleMode: data.style_mode as PartnerComponentConfig['styleMode'],
    motion: data.motion as PartnerComponentConfig['motion'],
  }
}

export async function listComponentConfigs(partnerAccountId: string, templateName: string): Promise<PartnerComponentConfig[]> {
  const supabase = createSupabaseAdminClient()
  const { data } = await supabase
    .from('partner_component_config')
    .select('template_name, component_slot, style_mode, motion')
    .eq('partner_account_id', partnerAccountId)
    .eq('template_name', templateName)

  return (data ?? []).map((row) => ({
    templateName: row.template_name as string,
    componentSlot: row.component_slot as string,
    styleMode: row.style_mode as PartnerComponentConfig['styleMode'],
    motion: row.motion as PartnerComponentConfig['motion'],
  }))
}

export async function upsertComponentConfig(
  partnerAccountId: string,
  templateName: string,
  componentSlot: string,
  input: { styleMode: string; motion: string }
): Promise<UpsertResult<PartnerComponentConfig>> {
  if (!(await isTemplateApprovedForConfig(templateName))) {
    return { ok: false, error: 'template_not_approved' }
  }
  if (!isValidStyleMode(input.styleMode)) return { ok: false, error: 'invalid_style_mode' }
  if (!isValidMotion(input.motion)) return { ok: false, error: 'invalid_motion' }

  const supabase = createSupabaseAdminClient()
  const { data, error } = await supabase
    .from('partner_component_config')
    .upsert(
      {
        partner_account_id: partnerAccountId,
        template_name: templateName,
        component_slot: componentSlot,
        style_mode: input.styleMode,
        motion: input.motion,
      },
      { onConflict: 'partner_account_id,template_name,component_slot' }
    )
    .select('template_name, component_slot, style_mode, motion')
    .single()

  if (error || !data) return { ok: false, error: error?.message ?? 'upsert_failed' }
  return {
    ok: true,
    data: {
      templateName: data.template_name as string,
      componentSlot: data.component_slot as string,
      styleMode: data.style_mode as PartnerComponentConfig['styleMode'],
      motion: data.motion as PartnerComponentConfig['motion'],
    },
  }
}

/**
 * Render-time theme resolution (architecture.md Section 12.6 step 4). Merges
 * Level A (always) + Level B (if a row exists for `templateName`) + Level C
 * (if rows exist for that template's component slots) into a flat set of CSS
 * custom properties. Every property has a Clio-default fallback baked into
 * its *value* here (not via CSS `var(--x, fallback)` at the property-map
 * level — the fallback syntax is applied where these properties are consumed
 * in a `<style>` block, e.g. `background: var(--partner-primary, #7C3AED)`),
 * so a partner with zero configuration still resolves a complete, valid set.
 *
 * Pure function of (partnerAccountId, templateName) — the isolation
 * mechanism this module's acceptance test (Requirement Doc Section 7,
 * "Isolation proof test") depends on: a config change scoped to Partner A's
 * id can never appear in a resolution scoped to Partner B's id, because
 * every read below carries an explicit `.eq('partner_account_id', ...)`
 * clause bound to whichever id was passed in.
 */
export async function resolvePartnerTheme(partnerAccountId: string, templateName: string): Promise<CSSCustomProperties> {
  const theme = await getThemeConfig(partnerAccountId)
  const templateConfig = await getTemplateConfig(partnerAccountId, templateName)
  const componentConfigs = await listComponentConfigs(partnerAccountId, templateName)

  const props: CSSCustomProperties = {
    '--partner-primary': theme.primaryColor,
    '--partner-secondary': theme.secondaryColor,
    '--partner-accent': theme.accentColor,
    '--partner-font-family': theme.fontFamily,
    '--partner-corner-style': cornerStyleToRadius(theme.cornerStyle),
    '--partner-spacing-scale': spacingScaleToMultiplier(theme.spacingScale),
    '--partner-show-so-what-footer': templateConfig ? String(templateConfig.showSoWhatFooter) : 'true',
    '--partner-motion-enabled': templateConfig ? String(templateConfig.motionEnabled) : 'true',
    '--partner-color-variant': templateConfig?.colorVariant ?? 'default',
  }

  if (templateConfig?.titleOverride) {
    props['--partner-title-override'] = templateConfig.titleOverride
  }

  for (const component of componentConfigs) {
    const slot = component.componentSlot
    props[`--partner-${slot}-style-mode`] = component.styleMode
    props[`--partner-${slot}-motion`] = component.motion
  }

  return props
}

function cornerStyleToRadius(style: PartnerThemeConfig['cornerStyle']): string {
  return style === 'sharp' ? '0px' : style === 'rounded' ? '16px' : '8px'
}

function spacingScaleToMultiplier(scale: PartnerThemeConfig['spacingScale']): string {
  return scale === 'compact' ? '0.75' : scale === 'spacious' ? '1.5' : '1'
}
