import type { CSSProperties } from 'react'

/**
 * B2B-32 (docs/specs/B2B-32-requirement-document.md §4 Screen A). "No design system exists yet for
 * this internal tool per CLAUDE.md's current state, so this brief uses simple, legible defaults:
 * #0a0a0a background, white text, system-ui font stack, matching the plain utilitarian style
 * already used for /showcase-render's own NotFoundMessage — not the partner-facing Configurator's
 * visual language, since this is explicitly not a partner-facing surface."
 *
 * Fluid/responsive per the standing policy (CLAUDE.md) — no hardcoded pixel-width caps; layout
 * containers use `clamp()`/percentage widths, and this is genuinely new UI so it must not break on
 * mobile even though a desktop-authoring workflow is the primary target (§9 edge case).
 */

export const COLORS = {
  bg: '#0a0a0a',
  surface: '#141414',
  border: '#2a2a2a',
  borderStrong: '#3a3a3a',
  textPrimary: '#ffffff',
  textSecondary: '#9a9a9a',
  textMuted: '#666666',
  accent: '#7c3aed',
  green: '#22c55e',
  red: '#ef4444',
}

export const pageStyle: CSSProperties = {
  minHeight: '100vh',
  background: COLORS.bg,
  color: COLORS.textPrimary,
  fontFamily: 'system-ui, -apple-system, sans-serif',
  padding: 'clamp(16px, 4vw, 40px)',
}

export const containerStyle: CSSProperties = {
  width: '100%',
  maxWidth: 'min(960px, 90vw)',
  margin: '0 auto',
}

export const cardStyle: CSSProperties = {
  background: COLORS.surface,
  border: `1px solid ${COLORS.border}`,
  borderRadius: 10,
  padding: 'clamp(16px, 3vw, 24px)',
  marginBottom: 20,
}

export const labelStyle: CSSProperties = {
  display: 'block',
  color: COLORS.textSecondary,
  fontSize: 13,
  fontWeight: 500,
  marginBottom: 6,
  marginTop: 16,
}

export const fieldStyle: CSSProperties = {
  width: '100%',
  boxSizing: 'border-box',
  background: '#1a1a1a',
  border: `1px solid ${COLORS.borderStrong}`,
  borderRadius: 8,
  padding: 10,
  color: COLORS.textPrimary,
  fontSize: 14,
  fontFamily: 'inherit',
}

export const buttonBaseStyle: CSSProperties = {
  border: 'none',
  borderRadius: 8,
  padding: '10px 18px',
  fontSize: 14,
  fontWeight: 600,
  cursor: 'pointer',
  fontFamily: 'inherit',
}

export const primaryButtonStyle: CSSProperties = {
  ...buttonBaseStyle,
  background: COLORS.accent,
  color: '#ffffff',
}

export const secondaryButtonStyle: CSSProperties = {
  ...buttonBaseStyle,
  background: 'transparent',
  color: COLORS.textPrimary,
  border: `1px solid ${COLORS.borderStrong}`,
}

export const linkButtonStyle: CSSProperties = {
  ...buttonBaseStyle,
  background: 'transparent',
  color: COLORS.textSecondary,
  padding: '4px 8px',
  fontWeight: 500,
  fontSize: 13,
}

export function disabledStyle(disabled: boolean): CSSProperties {
  return disabled ? { opacity: 0.45, cursor: 'not-allowed' } : {}
}
