import Link from 'next/link'
import type { ReactNode } from 'react'
import { pageStyle, navStyle, brandStyle, brandMarkStyle, containerStyle, COLORS } from '../../_styles'

/**
 * Shared page chrome for the 5 "Claude AI" interactive visuals — nav, back link, and title, so each
 * individual visual component only needs to render its own diagram.
 */
export default function VisualPageShell({
  title,
  subtitle,
  children,
}: {
  title: string
  subtitle: string
  children: ReactNode
}) {
  return (
    <div style={pageStyle}>
      <nav style={navStyle}>
        <Link href="/demo" style={brandStyle}>
          <span style={brandMarkStyle} aria-hidden="true" />
          Learn with AI
        </Link>
        <Link href="/demo/claude-ai" style={{ color: COLORS.textMuted, fontSize: 13, textDecoration: 'none' }}>
          ← Back to course
        </Link>
      </nav>
      <div style={containerStyle}>
        <div style={{ padding: '0 clamp(16px, 4vw, 48px)' }}>
          <div
            style={{
              fontSize: 12,
              fontWeight: 700,
              letterSpacing: '0.1em',
              textTransform: 'uppercase',
              color: COLORS.accentBright,
              marginBottom: 8,
            }}
          >
            Interactive Visual
          </div>
          <h1
            style={{
              fontSize: 'clamp(26px, 4vw, 38px)',
              fontWeight: 800,
              letterSpacing: '-0.02em',
              margin: '0 0 10px 0',
              textWrap: 'balance',
            }}
          >
            {title}
          </h1>
          <p style={{ fontSize: 15, color: COLORS.textSecondary, lineHeight: 1.6, maxWidth: 640, margin: '0 0 32px 0' }}>
            {subtitle}
          </p>
          {children}
        </div>
      </div>
    </div>
  )
}
