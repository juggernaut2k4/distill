import type { CSSProperties } from 'react'

/**
 * "Learn with AI" demo pages — styling inspired by a course-catalog product's dark, purple-accented
 * look (deep navy background, pill badges, expandable chapter list, tabbed course-detail page).
 * Colors and component shapes only — no third-party logo/wordmark; "Learn with AI" is the brand
 * shown in the nav and page titles. Fluid/responsive per the standing policy — no hardcoded
 * pixel-width caps, clamp()-based spacing/typography.
 */

export const COLORS = {
  bg: '#0e0c22',
  bgGradientTop: '#151030',
  surface: '#181530',
  surfaceRaised: '#221d44',
  border: '#2f2a54',
  borderStrong: '#463d7a',
  textPrimary: '#ffffff',
  textSecondary: '#b3ace0',
  textMuted: '#8078ad',
  accent: '#8b5cf6',
  accentBright: '#a78bfa',
  amber: '#f5a524',
  green: '#22c55e',
}

export const navStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  padding: 'clamp(12px, 2vw, 20px) clamp(16px, 4vw, 48px)',
  borderBottom: `1px solid ${COLORS.border}`,
  background: COLORS.bgGradientTop,
  position: 'sticky',
  top: 0,
  zIndex: 10,
}

export const brandStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 10,
  fontWeight: 800,
  fontSize: 'clamp(16px, 2vw, 19px)',
  color: COLORS.textPrimary,
  letterSpacing: '-0.01em',
  textDecoration: 'none',
}

export const brandMarkStyle: CSSProperties = {
  width: 28,
  height: 28,
  borderRadius: 8,
  background: `linear-gradient(135deg, ${COLORS.accent}, ${COLORS.accentBright})`,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  flexShrink: 0,
}

export const pageStyle: CSSProperties = {
  minHeight: '100vh',
  background: COLORS.bg,
  color: COLORS.textPrimary,
  fontFamily:
    '"Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif',
}

export const containerStyle: CSSProperties = {
  width: '100%',
  maxWidth: 'min(1180px, 92vw)',
  margin: '0 auto',
  padding: 'clamp(24px, 5vw, 56px) 0',
}

export const eyebrowStyle: CSSProperties = {
  textTransform: 'uppercase',
  letterSpacing: '0.14em',
  fontSize: 12,
  fontWeight: 700,
  color: COLORS.accentBright,
  marginBottom: 10,
}

export const heroTitleStyle: CSSProperties = {
  fontSize: 'clamp(32px, 5vw, 52px)',
  fontWeight: 800,
  letterSpacing: '-0.02em',
  lineHeight: 1.08,
  margin: '0 0 14px 0',
  textWrap: 'balance' as CSSProperties['textWrap'],
}

export const heroSubtitleStyle: CSSProperties = {
  fontSize: 'clamp(15px, 1.6vw, 18px)',
  color: COLORS.textSecondary,
  lineHeight: 1.6,
  maxWidth: 640,
  margin: 0,
}

export const pillRowStyle: CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  gap: 10,
  margin: '20px 0 0 0',
}

export const pillStyle: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  padding: '6px 14px',
  borderRadius: 999,
  background: COLORS.surfaceRaised,
  border: `1px solid ${COLORS.border}`,
  fontSize: 13,
  fontWeight: 600,
  color: COLORS.textSecondary,
  whiteSpace: 'nowrap',
}

export const cardGridStyle: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 320px), 1fr))',
  gap: 'clamp(16px, 2.5vw, 28px)',
  marginTop: 'clamp(24px, 4vw, 40px)',
}

export const demoCardStyle: CSSProperties = {
  display: 'block',
  background: COLORS.surface,
  border: `1px solid ${COLORS.border}`,
  borderRadius: 14,
  overflow: 'hidden',
  textDecoration: 'none',
  color: COLORS.textPrimary,
  transition: 'transform 160ms ease, border-color 160ms ease, box-shadow 160ms ease',
}

export function thumbnailStyle(gradient: string): CSSProperties {
  return {
    width: '100%',
    aspectRatio: '16 / 9',
    background: gradient,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
  }
}

export const demoCardBodyStyle: CSSProperties = {
  padding: 'clamp(16px, 2.5vw, 22px)',
}

export const demoLabelStyle: CSSProperties = {
  display: 'inline-block',
  fontSize: 12,
  fontWeight: 700,
  letterSpacing: '0.06em',
  textTransform: 'uppercase',
  color: COLORS.accentBright,
  marginBottom: 8,
}

export const cardTitleStyle: CSSProperties = {
  fontSize: 18,
  fontWeight: 700,
  lineHeight: 1.35,
  margin: '0 0 8px 0',
  textWrap: 'balance' as CSSProperties['textWrap'],
}

export const cardMetaStyle: CSSProperties = {
  fontSize: 13,
  color: COLORS.textMuted,
  display: 'flex',
  gap: 10,
  flexWrap: 'wrap',
  marginTop: 12,
}

export const actionBarStyle: CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  gap: 12,
  alignItems: 'center',
  marginTop: 'clamp(20px, 3vw, 28px)',
}

export const primaryButtonStyle: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 8,
  padding: '12px 22px',
  borderRadius: 8,
  background: COLORS.accent,
  color: '#ffffff',
  fontWeight: 700,
  fontSize: 14,
  border: 'none',
  cursor: 'pointer',
  textDecoration: 'none',
}

export const secondaryButtonStyle: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 8,
  padding: '12px 22px',
  borderRadius: 8,
  background: 'transparent',
  color: COLORS.textPrimary,
  fontWeight: 700,
  fontSize: 14,
  border: `1px solid ${COLORS.borderStrong}`,
  cursor: 'pointer',
  textDecoration: 'none',
}

export const aiButtonStyle: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 8,
  padding: '12px 22px',
  borderRadius: 8,
  background: `linear-gradient(135deg, ${COLORS.accent}, #ec4899)`,
  color: '#ffffff',
  fontWeight: 700,
  fontSize: 14,
  border: 'none',
  cursor: 'pointer',
}

export const tabRowStyle: CSSProperties = {
  display: 'flex',
  gap: 'clamp(16px, 3vw, 32px)',
  borderBottom: `1px solid ${COLORS.border}`,
  marginTop: 'clamp(24px, 4vw, 36px)',
  overflowX: 'auto',
}

export function tabStyle(active: boolean): CSSProperties {
  return {
    padding: '12px 2px',
    fontSize: 14,
    fontWeight: 600,
    color: active ? COLORS.textPrimary : COLORS.textMuted,
    borderBottom: active ? `2px solid ${COLORS.accent}` : '2px solid transparent',
    whiteSpace: 'nowrap',
  }
}

export const chapterListStyle: CSSProperties = {
  marginTop: 'clamp(20px, 3vw, 28px)',
}

export const chapterRowStyle: CSSProperties = {
  display: 'flex',
  gap: 16,
  padding: 'clamp(14px, 2vw, 18px) 0',
  borderBottom: `1px solid ${COLORS.border}`,
}

export const chapterMarkerStyle: CSSProperties = {
  width: 30,
  height: 30,
  borderRadius: '50%',
  border: `1px solid ${COLORS.borderStrong}`,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  fontSize: 13,
  fontWeight: 700,
  color: COLORS.textSecondary,
  flexShrink: 0,
}

export const chapterTitleStyle: CSSProperties = {
  fontSize: 15,
  fontWeight: 700,
  margin: '0 0 6px 0',
}

export const chapterBodyStyle: CSSProperties = {
  fontSize: 14.5,
  lineHeight: 1.75,
  color: COLORS.textSecondary,
  marginBottom: 14,
}

export const codeBlockStyle: CSSProperties = {
  background: '#0a0818',
  border: `1px solid ${COLORS.border}`,
  borderRadius: 10,
  padding: 'clamp(14px, 2vw, 18px)',
  overflowX: 'auto',
  fontSize: 13,
  lineHeight: 1.65,
  fontFamily: '"SF Mono", "Fira Code", Menlo, Consolas, monospace',
  color: '#d9d4f5',
  marginBottom: 14,
}

export const listStyle: CSSProperties = {
  margin: '0 0 14px 0',
  paddingLeft: 20,
  color: COLORS.textSecondary,
  fontSize: 14.5,
  lineHeight: 1.75,
}
