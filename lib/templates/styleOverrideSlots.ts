/**
 * TMPL-01 — Structural enforcement, Layer 1 (requirement doc Section 4.1).
 *
 * Fixed, per-template allowlist of "style override slots" — the exact set of
 * visual parameters an automated fix may ever change. Authored once, directly
 * against the real renderer code (components/templates/renderers/Heatmap.tsx
 * and Overlay.tsx), not invented in the abstract and not derivable by the LLM.
 *
 * Scoped ENTIRELY to Heatmap/Overlay, matching the existing
 * RTV04_VALIDATED_TEMPLATES precedent (lib/templates/generator.ts line 25).
 * Do NOT extend this mechanism to any other template without separate sign-off.
 */

export type FixLoopTemplateName = 'Heatmap' | 'Overlay'

export function isFixLoopTemplate(templateName: string): templateName is FixLoopTemplateName {
  return templateName === 'Heatmap' || templateName === 'Overlay'
}

/**
 * Closed set of colors a color-type slot may resolve to — exactly the accent
 * tokens already defined in CLAUDE.md's design system. Never an arbitrary hex
 * string the LLM invents (Section 4.1).
 */
export const APPROVED_COLOR_TOKENS = [
  '#7C3AED', // accent purple
  '#A855F7', // accent purple bright
  '#06B6D4', // accent cyan
  '#F59E0B', // accent amber
  '#10B981', // accent green
  '#EF4444', // accent red
] as const

export type ApprovedColorToken = (typeof APPROVED_COLOR_TOKENS)[number]

interface ColorSlotSpec {
  kind: 'color'
}

interface RangeSlotSpec {
  kind: 'range'
  min: number
  max: number
  /** Unit shown to the LLM/human, purely descriptive (e.g. "px"). */
  unit: string
}

export type SlotSpec = ColorSlotSpec | RangeSlotSpec

export type StyleOverrideValue = ApprovedColorToken | number
export type StyleOverrides = Record<string, StyleOverrideValue>

/**
 * The fixed slot allowlist. Every key here maps 1:1 to a hardcoded visual
 * parameter that already exists in the corresponding renderer today:
 *
 * Heatmap.tsx  — INTENSITY_STYLES (5-point ramp), the `w-[64px] h-[64px]` cell
 *                sizing, the `m-0.5` inter-cell gap.
 * Overlay.tsx  — COLOR_HEX (4 zone-marker colors), the `w-[220px] h-[96px]`
 *                callout card, the `border-2` base panel border.
 */
export const STYLE_OVERRIDE_SLOTS: Record<FixLoopTemplateName, Record<string, SlotSpec>> = {
  Heatmap: {
    'intensity-0': { kind: 'color' },
    'intensity-1': { kind: 'color' },
    'intensity-2': { kind: 'color' },
    'intensity-3': { kind: 'color' },
    'intensity-4': { kind: 'color' },
    'cell-size': { kind: 'range', min: 48, max: 96, unit: 'px' },
    'cell-gap': { kind: 'range', min: 0, max: 8, unit: 'px' },
  },
  Overlay: {
    'zone-color-purple': { kind: 'color' },
    'zone-color-cyan': { kind: 'color' },
    'zone-color-amber': { kind: 'color' },
    'zone-color-green': { kind: 'color' },
    'callout-width': { kind: 'range', min: 180, max: 280, unit: 'px' },
    'callout-height': { kind: 'range', min: 80, max: 130, unit: 'px' },
    'panel-border-width': { kind: 'range', min: 1, max: 4, unit: 'px' },
  },
}

/**
 * Human/LLM-readable description of a template's slot allowlist — used to
 * spell out constraints verbatim in the fix-generator prompt (requirement doc
 * Section 4.1: "its slot allowlist with per-slot constraints spelled out").
 */
export function describeSlotAllowlist(templateName: FixLoopTemplateName): string {
  const slots = STYLE_OVERRIDE_SLOTS[templateName]
  return Object.entries(slots)
    .map(([key, spec]) => {
      if (spec.kind === 'color') {
        return `- "${key}": one of these exact hex strings only: ${APPROVED_COLOR_TOKENS.join(', ')}`
      }
      return `- "${key}": an integer between ${spec.min} and ${spec.max} (${spec.unit})`
    })
    .join('\n')
}

export type ValidationResult =
  | { valid: true; overrides: StyleOverrides }
  | { valid: false; reason: string }

/**
 * Structural enforcement, Layer 2 (Section 4.1) — mechanical, all-or-nothing
 * validation of a proposed override object against exactly one template's slot
 * allowlist. Any unknown key, or any value failing its slot's specific check,
 * rejects the ENTIRE proposed object — never partially applied.
 */
export function validateStyleOverrides(
  templateName: FixLoopTemplateName,
  proposed: unknown
): ValidationResult {
  const slots = STYLE_OVERRIDE_SLOTS[templateName]
  if (!slots) {
    return { valid: false, reason: `No style-override slots are defined for template "${templateName}".` }
  }

  if (typeof proposed !== 'object' || proposed === null || Array.isArray(proposed)) {
    return { valid: false, reason: 'Proposed style overrides must be a flat JSON object of slot -> value.' }
  }

  const entries = Object.entries(proposed as Record<string, unknown>)
  const validated: StyleOverrides = {}

  for (const [key, value] of entries) {
    const spec = slots[key]
    if (!spec) {
      return {
        valid: false,
        reason: `Unknown key "${key}" is not an allowed style-override slot for ${templateName}.`,
      }
    }

    if (spec.kind === 'color') {
      if (typeof value !== 'string' || !(APPROVED_COLOR_TOKENS as readonly string[]).includes(value)) {
        return {
          valid: false,
          reason: `Value for "${key}" (${JSON.stringify(value)}) is not one of the approved accent color tokens.`,
        }
      }
      validated[key] = value as ApprovedColorToken
    } else {
      if (typeof value !== 'number' || !Number.isInteger(value) || value < spec.min || value > spec.max) {
        return {
          valid: false,
          reason: `Value for "${key}" (${JSON.stringify(value)}) must be an integer between ${spec.min} and ${spec.max} (${spec.unit}).`,
        }
      }
      validated[key] = value
    }
  }

  return { valid: true, overrides: validated }
}
