import Link from 'next/link'
import type { ReactNode } from 'react'
import { pageStyle, navStyle, brandStyle, brandMarkStyle, containerStyle, COLORS } from '../../_styles'
import FitToViewport from './_fit-to-viewport'

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
      <div style={{ ...containerStyle, padding: 'clamp(12px, 2.5vh, 24px) 0' }}>
        <FitToViewport>
          <div style={{ padding: '0 clamp(16px, 4vw, 48px)' }}>
            <div
              style={{
                fontSize: 'clamp(10px, 1.4vh, 12px)',
                fontWeight: 700,
                letterSpacing: '0.1em',
                textTransform: 'uppercase',
                color: COLORS.accentBright,
                marginBottom: 'clamp(4px, 0.8vh, 8px)',
              }}
            >
              Interactive Visual
            </div>
            <h1
              style={{
                fontSize: 'clamp(20px, 3.2vh, 38px)',
                fontWeight: 800,
                letterSpacing: '-0.02em',
                margin: '0 0 clamp(4px, 1vh, 10px) 0',
                textWrap: 'balance',
              }}
            >
              {title}
            </h1>
            <p
              style={{
                fontSize: 'clamp(12px, 1.8vh, 15px)',
                color: COLORS.textSecondary,
                lineHeight: 1.5,
                maxWidth: 640,
                margin: '0 0 clamp(10px, 2vh, 24px) 0',
              }}
            >
              {subtitle}
            </p>
            {children}
          </div>
        </FitToViewport>
      </div>
    </div>
  )
}
