'use client'

import { useState } from 'react'
import { COLORS } from '../../../_styles'

interface ModelPoint {
  id: string
  name: string
  speed: number // 0-100
  capability: number // 0-100
  color: string
  desc: string
}

const MODELS: ModelPoint[] = [
  { id: 'opus', name: 'Opus', speed: 30, capability: 95, color: '#a78bfa', desc: 'The most capable model — hardest reasoning, research, and creative work.' },
  { id: 'sonnet', name: 'Sonnet', speed: 65, capability: 80, color: '#8b5cf6', desc: 'The balanced default — strong at everyday coding, writing, and agentic work.' },
  { id: 'haiku', name: 'Haiku', speed: 92, capability: 55, color: '#ec4899', desc: 'The fastest and most cost-efficient — built for high-volume, latency-sensitive use.' },
  { id: 'fable', name: 'Fable', speed: 60, capability: 72, color: '#f5a524', desc: 'Tuned for narrative and creative-writing use cases within the same family.' },
]

/** Interactive capability-vs-speed scatter chart across the four Claude 5 models. */
export default function ModelFamilyVisual() {
  const [selected, setSelected] = useState<string>('sonnet')
  const active = MODELS.find((m) => m.id === selected)!

  // chart area in viewBox units
  const W = 400
  const H = 260
  const padding = 34

  function x(speed: number) {
    return padding + (speed / 100) * (W - padding * 2)
  }
  function y(capability: number) {
    return H - padding - (capability / 100) * (H - padding * 2)
  }

  return (
    <div>
      <style jsx>{`
        .dot {
          cursor: pointer;
          transition: r 160ms ease, opacity 160ms ease;
        }
        .dot:hover {
          opacity: 0.85;
        }
      `}</style>
      <div
        style={{
          background: COLORS.surface,
          border: `1px solid ${COLORS.border}`,
          borderRadius: 12,
          padding: 'clamp(12px, 3vw, 24px)',
        }}
      >
        <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 'auto', display: 'block' }} role="img" aria-label="Capability versus speed chart for the four Claude models">
          <line x1={padding} y1={H - padding} x2={W - padding} y2={H - padding} stroke={COLORS.border} strokeWidth={1} />
          <line x1={padding} y1={padding} x2={padding} y2={H - padding} stroke={COLORS.border} strokeWidth={1} />
          <text x={W / 2} y={H - 6} fill={COLORS.textMuted} fontSize={11} textAnchor="middle">
            Speed →
          </text>
          <text x={12} y={H / 2} fill={COLORS.textMuted} fontSize={11} textAnchor="middle" transform={`rotate(-90 12 ${H / 2})`}>
            Capability →
          </text>

          {MODELS.map((m) => {
            const isActive = m.id === selected
            return (
              <g key={m.id} onClick={() => setSelected(m.id)}>
                <circle
                  className="dot"
                  cx={x(m.speed)}
                  cy={y(m.capability)}
                  r={isActive ? 14 : 10}
                  fill={m.color}
                  opacity={isActive ? 1 : 0.55}
                  stroke={isActive ? '#ffffff' : 'none'}
                  strokeWidth={isActive ? 2 : 0}
                />
                <text
                  x={x(m.speed)}
                  y={y(m.capability) - (isActive ? 20 : 16)}
                  fill={isActive ? COLORS.textPrimary : COLORS.textMuted}
                  fontSize={isActive ? 13 : 11}
                  fontWeight={isActive ? 700 : 500}
                  textAnchor="middle"
                >
                  {m.name}
                </text>
              </g>
            )
          })}
        </svg>
      </div>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 16 }}>
        {MODELS.map((m) => (
          <button
            key={m.id}
            type="button"
            onClick={() => setSelected(m.id)}
            style={{
              padding: '8px 16px',
              borderRadius: 999,
              border: `1px solid ${m.id === selected ? m.color : COLORS.border}`,
              background: m.id === selected ? COLORS.surfaceRaised : 'transparent',
              color: m.id === selected ? COLORS.textPrimary : COLORS.textMuted,
              fontSize: 13,
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            {m.name}
          </button>
        ))}
      </div>

      <div
        style={{
          marginTop: 16,
          padding: '14px 16px',
          borderRadius: 8,
          background: COLORS.surfaceRaised,
          border: `1px solid ${COLORS.border}`,
          fontSize: 14,
          color: COLORS.textSecondary,
        }}
      >
        <strong style={{ color: COLORS.textPrimary }}>{active.name}:</strong> {active.desc}
      </div>
    </div>
  )
}
