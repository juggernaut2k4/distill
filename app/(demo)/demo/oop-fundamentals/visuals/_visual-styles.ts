import type { CSSProperties } from 'react'
import { COLORS } from '../../_styles'

/** Shared clamp()-based style tokens for the 7 OOP visual pages — keeps sizing consistent and compact. */

export const sectionHeadingStyle: CSSProperties = {
  fontSize: 'clamp(12px, 1.5vh, 14px)',
  fontWeight: 700,
  color: COLORS.textPrimary,
  margin: '0 0 clamp(6px, 1vh, 10px) 0',
}

export const overviewStyle: CSSProperties = {
  fontSize: 'clamp(12px, 1.8vh, 15px)',
  color: COLORS.textSecondary,
  lineHeight: 1.5,
  margin: '0 0 clamp(8px, 1.5vh, 16px) 0',
  maxWidth: 640,
}

export const cardStyle: CSSProperties = {
  background: COLORS.surface,
  border: `1px solid ${COLORS.border}`,
  borderRadius: 12,
  padding: 'clamp(10px, 1.6vh, 18px)',
}

export const codeCardStyle: CSSProperties = {
  background: '#0a0818',
  border: `1px solid ${COLORS.border}`,
  borderRadius: 10,
  padding: 'clamp(8px, 1.4vh, 14px)',
  overflowX: 'auto',
  fontSize: 'clamp(10px, 1.25vh, 12px)',
  lineHeight: 1.55,
  fontFamily: '"SF Mono", "Fira Code", Menlo, Consolas, monospace',
  color: '#d9d4f5',
  margin: 0,
}

export const calloutRowStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 'clamp(4px, 0.8vh, 8px)',
  marginTop: 'clamp(6px, 1vh, 10px)',
}

export function calloutItemStyle(color: string): CSSProperties {
  return {
    display: 'flex',
    gap: 8,
    fontSize: 'clamp(10.5px, 1.3vh, 12px)',
    color: COLORS.textMuted,
    lineHeight: 1.4,
    borderLeft: `2px solid ${color}`,
    paddingLeft: 8,
  }
}
