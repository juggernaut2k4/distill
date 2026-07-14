import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * B2B-03 Requirement Doc Section 7 — "Isolation proof test (the single most
 * important test in this document)": given Partner A changes a
 * component-level style and saves, a Partner B render using the same
 * template (with Partner B's own unrelated config, or no row at all) must be
 * byte-for-byte identical to a snapshot taken before Partner A's change —
 * proving the change is structurally inert for Partner B.
 *
 * Verified here directly against `resolvePartnerTheme()`
 * (lib/partner/theme.ts), the render-time function this guarantee actually
 * depends on, using two independent partner_account_id-keyed row stores so a
 * bug that leaked Partner A's row into Partner B's read would fail this test.
 */

interface Row {
  partner_account_id: string
  template_name?: string
  component_slot?: string
  [key: string]: unknown
}

const themeRows: Row[] = []
const templateConfigRows: Row[] = []
const componentConfigRows: Row[] = []
const templateLibraryRows = [{ template_name: 'Heatmap', status: 'approved' }]

function scopedSelect(rows: Row[], filters: Partial<Row>) {
  return rows.find((r) => Object.entries(filters).every(([k, v]) => r[k] === v)) ?? null
}

vi.mock('@/lib/supabase', () => ({
  createSupabaseAdminClient: vi.fn(() => ({
    from: vi.fn((table: string) => {
      if (table === 'partner_theme_config') {
        return {
          select: () => ({
            eq: (_col: string, partnerAccountId: string) => ({
              maybeSingle: async () => ({ data: scopedSelect(themeRows, { partner_account_id: partnerAccountId }) }),
            }),
          }),
        }
      }
      if (table === 'partner_template_config') {
        return {
          select: () => ({
            eq: (_col1: string, partnerAccountId: string) => ({
              eq: (_col2: string, templateName: string) => ({
                maybeSingle: async () => ({
                  data: scopedSelect(templateConfigRows, { partner_account_id: partnerAccountId, template_name: templateName }),
                }),
              }),
            }),
          }),
        }
      }
      if (table === 'partner_component_config') {
        return {
          select: () => ({
            eq: (_col1: string, partnerAccountId: string) => ({
              eq: (_col2: string, templateName: string) => ({
                async then(resolve: (v: { data: Row[] }) => void) {
                  resolve({
                    data: componentConfigRows.filter(
                      (r) => r.partner_account_id === partnerAccountId && r.template_name === templateName
                    ),
                  })
                },
              }),
            }),
          }),
        }
      }
      if (table === 'template_library') {
        return {
          select: () => ({
            eq: (_col: string, templateName: string) => ({
              maybeSingle: async () => ({ data: templateLibraryRows.find((r) => r.template_name === templateName) ?? null }),
            }),
          }),
        }
      }
      throw new Error(`Unexpected table in test mock: ${table}`)
    }),
  })),
}))

import { resolvePartnerTheme, cssCustomPropertiesToStyleBlock } from '@/lib/partner/theme'

describe('resolvePartnerTheme — cross-partner isolation (Requirement Doc Section 7)', () => {
  beforeEach(() => {
    themeRows.length = 0
    templateConfigRows.length = 0
    componentConfigRows.length = 0
  })

  it('a component-level change scoped to Partner A never appears in Partner B\'s resolution, even for the same template', async () => {
    // Partner B has its own, unrelated theme + component config.
    themeRows.push({ partner_account_id: 'partner-b', primary_color: '#111111', secondary_color: '#222222', accent_color: '#333333', font_family: 'Roboto', corner_style: 'sharp', spacing_scale: 'compact' })
    componentConfigRows.push({ partner_account_id: 'partner-b', template_name: 'Heatmap', component_slot: 'cell', style_mode: 'fill', motion: 'none' })

    const snapshotBefore = await resolvePartnerTheme('partner-b', 'Heatmap')

    // Partner A changes Heatmap's Cell component from 'fill' to 'neon' and saves.
    componentConfigRows.push({ partner_account_id: 'partner-a', template_name: 'Heatmap', component_slot: 'cell', style_mode: 'neon', motion: 'stagger' })
    themeRows.push({ partner_account_id: 'partner-a', primary_color: '#ABCDEF', secondary_color: '#FEDCBA', accent_color: '#123456', font_family: 'IBM Plex Sans', corner_style: 'rounded', spacing_scale: 'spacious' })

    const snapshotAfter = await resolvePartnerTheme('partner-b', 'Heatmap')

    expect(snapshotAfter).toEqual(snapshotBefore)
    expect(snapshotAfter['--partner-cell-style-mode']).toBe('fill') // never picks up Partner A's 'neon'
    expect(snapshotAfter['--partner-primary']).toBe('#111111') // never picks up Partner A's theme
  })

  it('a partner with zero configuration falls back fully to Clio defaults, never errors', async () => {
    const result = await resolvePartnerTheme('partner-with-nothing-configured', 'Heatmap')

    expect(result['--partner-primary']).toBe('#7C3AED')
    expect(result['--partner-secondary']).toBe('#06B6D4')
    expect(result['--partner-accent']).toBe('#F59E0B')
    expect(result['--partner-font-family']).toBe('Inter')
  })

  it('strips brace/semicolon/angle-bracket characters from a value before it reaches the style block (defense in depth)', () => {
    const block = cssCustomPropertiesToStyleBlock('[data-x="1"]', { '--partner-title-override': 'Evil}; body{background:red' })
    const declarationLine = block.split('\n').find((line) => line.includes('--partner-title-override'))
    expect(declarationLine).toBeDefined()
    // The only "{"/"}"/";" characters allowed on this line are the CSS
    // syntax the block generator itself adds (the trailing ";"), never ones
    // originating from the injected value — so the value's own content
    // (everything after ": " up to the trailing ";") must be clean.
    const valuePart = declarationLine!.split(': ')[1]?.replace(/;$/, '')
    expect(valuePart).toBe('Evil bodybackground:red')
    expect(valuePart).not.toMatch(/[{}<>]/)
  })
})
