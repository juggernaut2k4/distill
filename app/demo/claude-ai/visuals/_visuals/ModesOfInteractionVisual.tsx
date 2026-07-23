'use client'

import { useState } from 'react'
import { COLORS } from '../../../_styles'

const MODES = [
  { id: 'chat', label: 'Chat' },
  { id: 'thinking', label: 'Extended Thinking' },
  { id: 'agentic', label: 'Agentic' },
  { id: 'embedded', label: 'Embedded' },
] as const

type ModeId = (typeof MODES)[number]['id']

/** Segmented mode selector — each mode plays a distinct small animation illustrating how it works. */
export default function ModesOfInteractionVisual() {
  const [mode, setMode] = useState<ModeId>('chat')

  return (
    <div>
      <style jsx>{`
        @keyframes bubble-in {
          from {
            opacity: 0;
            transform: translateY(6px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }
        .bubble {
          animation: bubble-in 500ms ease both;
        }
        @keyframes dot-pulse {
          0%, 80%, 100% {
            opacity: 0.25;
          }
          40% {
            opacity: 1;
          }
        }
        .think-dot {
          animation: dot-pulse 1.4s ease-in-out infinite;
        }
        @keyframes orbit {
          from {
            transform: rotate(0deg);
          }
          to {
            transform: rotate(360deg);
          }
        }
        .orbit-group {
          animation: orbit 4s linear infinite;
          transform-origin: 100px 100px;
        }
        @keyframes embed-pulse {
          0%, 100% {
            box-shadow: 0 0 0 0 rgba(139, 92, 246, 0.45);
          }
          50% {
            box-shadow: 0 0 0 10px rgba(139, 92, 246, 0);
          }
        }
        .embed-pulse {
          animation: embed-pulse 2s ease-out infinite;
        }
      `}</style>

      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 20 }}>
        {MODES.map((m) => (
          <button
            key={m.id}
            type="button"
            onClick={() => setMode(m.id)}
            style={{
              padding: '9px 16px',
              borderRadius: 999,
              border: `1px solid ${m.id === mode ? COLORS.accentBright : COLORS.border}`,
              background: m.id === mode ? COLORS.surfaceRaised : 'transparent',
              color: m.id === mode ? COLORS.textPrimary : COLORS.textMuted,
              fontSize: 13,
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            {m.label}
          </button>
        ))}
      </div>

      <div
        style={{
          background: COLORS.surface,
          border: `1px solid ${COLORS.border}`,
          borderRadius: 12,
          padding: 'clamp(20px, 4vw, 32px)',
          minHeight: 220,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        {mode === 'chat' && (
          <div key="chat" style={{ display: 'flex', flexDirection: 'column', gap: 10, width: '100%', maxWidth: 320 }}>
            <div className="bubble" style={{ alignSelf: 'flex-end', background: COLORS.accent, color: '#fff', padding: '10px 14px', borderRadius: '14px 14px 4px 14px', fontSize: 13.5 }}>
              What&apos;s the difference between Sonnet and Haiku?
            </div>
            <div className="bubble" style={{ animationDelay: '300ms', alignSelf: 'flex-start', background: COLORS.surfaceRaised, color: COLORS.textPrimary, padding: '10px 14px', borderRadius: '14px 14px 14px 4px', fontSize: 13.5 }}>
              Sonnet balances capability and cost; Haiku trades some depth for speed.
            </div>
          </div>
        )}

        {mode === 'thinking' && (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16 }}>
            <div style={{ display: 'flex', gap: 8 }}>
              {[0, 1, 2].map((i) => (
                <span
                  key={i}
                  className="think-dot"
                  style={{ width: 10, height: 10, borderRadius: '50%', background: COLORS.accentBright, animationDelay: `${i * 0.2}s` }}
                />
              ))}
            </div>
            <span style={{ fontSize: 13, color: COLORS.textMuted }}>Reasoning step by step before answering…</span>
          </div>
        )}

        {mode === 'agentic' && (
          <svg viewBox="0 0 200 200" style={{ width: 200, height: 200 }} aria-label="Agentic loop: plan, act, observe, adjust">
            <circle cx={100} cy={100} r={70} fill="none" stroke={COLORS.border} strokeWidth={2} />
            {['Plan', 'Act', 'Observe', 'Adjust'].map((label, i) => {
              const angle = (i / 4) * 2 * Math.PI - Math.PI / 2
              const cx = 100 + 70 * Math.cos(angle)
              const cy = 100 + 70 * Math.sin(angle)
              return (
                <g key={label}>
                  <circle cx={cx} cy={cy} r={5} fill={COLORS.accentBright} />
                  <text x={cx} y={cy + (cy > 100 ? 18 : -12)} fill={COLORS.textSecondary} fontSize={11} textAnchor="middle">
                    {label}
                  </text>
                </g>
              )
            })}
            <g className="orbit-group">
              <circle cx={100} cy={30} r={5} fill="#fff" />
            </g>
          </svg>
        )}

        {mode === 'embedded' && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            <div style={{ width: 64, height: 64, borderRadius: 14, background: COLORS.surfaceRaised, border: `1px solid ${COLORS.border}`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, color: COLORS.textMuted }}>
              Your App
            </div>
            <span style={{ color: COLORS.textMuted, fontSize: 20 }}>+</span>
            <div
              className="embed-pulse"
              style={{
                width: 48,
                height: 48,
                borderRadius: '50%',
                background: `linear-gradient(135deg, ${COLORS.accent}, ${COLORS.accentBright})`,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: '#fff',
                fontSize: 10,
                fontWeight: 800,
              }}
            >
              AI
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
