import type { CSSProperties } from 'react'
import { COLORS } from '../../../_styles'

interface ModelPoint {
  id: string
  name: string
  speed: number // 0-100
  capability: number // 0-100
  color: string
  desc: string
  /** Sonnet and Fable sit close together on the chart — Fable's label renders below its dot instead of above so the two never collide. */
  labelBelow?: boolean
}

const MODELS: ModelPoint[] = [
  { id: 'opus', name: 'Opus', speed: 30, capability: 95, color: '#a78bfa', desc: 'The most capable model — hardest reasoning, research, and creative work.' },
  { id: 'sonnet', name: 'Sonnet', speed: 65, capability: 80, color: '#8b5cf6', desc: 'The balanced default — strong at everyday coding, writing, and agentic work.' },
  { id: 'haiku', name: 'Haiku', speed: 92, capability: 55, color: '#ec4899', desc: 'The fastest and most cost-efficient — built for high-volume, latency-sensitive use.' },
  { id: 'fable', name: 'Fable', speed: 52, capability: 66, color: '#f5a524', desc: 'Tuned for narrative and creative-writing use cases within the same family.', labelBelow: true },
]

const sectionHeadingStyle: CSSProperties = {
  fontSize: 'clamp(13px, 1.8vh, 16px)',
  fontWeight: 700,
  color: COLORS.textPrimary,
  margin: '0 0 2px 0',
}

const sectionLeadStyle: CSSProperties = {
  fontSize: 'clamp(11px, 1.4vh, 13px)',
  color: COLORS.textMuted,
  margin: '0 0 clamp(6px, 1vh, 10px) 0',
}

/** Static infographic: overview → capability/speed chart (all 4 models always labeled) → per-model cards. */
export default function ModelFamilyVisual() {
  // chart area in viewBox units
  const W = 400
  const H = 220
  const padding = 34

  function x(speed: number) {
    return padding + (speed / 100) * (W - padding * 2)
  }
  function y(capability: number) {
    return H - padding - (capability / 100) * (H - padding * 2)
  }

  return (
    <div>
      {/* Overview line */}
      <p style={{ fontSize: 'clamp(12px, 1.8vh, 15px)', color: COLORS.textSecondary, lineHeight: 1.5, margin: '0 0 clamp(8px, 1.5vh, 16px) 0', maxWidth: 640 }}>
        Claude 5 ships as a family, not one model — each size is tuned for a different point on the{' '}
        <strong style={{ color: COLORS.textPrimary }}>capability-versus-speed</strong> tradeoff, so you can match cost and latency to the job.
      </p>

      {/* Chart */}
      <h3 style={sectionHeadingStyle}>Capability vs. speed</h3>
      <p style={sectionLeadStyle}>Every model trades one for the other differently.</p>

      <div
        style={{
          background: COLORS.surface,
          border: `1px solid ${COLORS.border}`,
          borderRadius: 12,
          padding: 'clamp(10px, 1.8vh, 20px)',
          marginBottom: 'clamp(10px, 2vh, 20px)',
        }}
      >
        <svg
          viewBox={`0 0 ${W} ${H}`}
          style={{ width: '100%', height: 'auto', maxHeight: '24vh', display: 'block' }}
          role="img"
          aria-label="Capability versus speed chart for the four Claude models"
        >
          <line x1={padding} y1={H - padding} x2={W - padding} y2={H - padding} stroke={COLORS.border} strokeWidth={1} />
          <line x1={padding} y1={padding} x2={padding} y2={H - padding} stroke={COLORS.border} strokeWidth={1} />
          <text x={W / 2} y={H - 6} fill={COLORS.textMuted} fontSize={11} textAnchor="middle">
            Speed →
          </text>
          <text x={12} y={H / 2} fill={COLORS.textMuted} fontSize={11} textAnchor="middle" transform={`rotate(-90 12 ${H / 2})`}>
            Capability →
          </text>

          {MODELS.map((m) => (
            <g key={m.id}>
              <circle cx={x(m.speed)} cy={y(m.capability)} r={11} fill={m.color} />
              <text
                x={x(m.speed)}
                y={y(m.capability) + (m.labelBelow ? 22 : -16)}
                fill={COLORS.textPrimary}
                fontSize={12}
                fontWeight={700}
                textAnchor="middle"
              >
                {m.name}
              </text>
            </g>
          ))}
        </svg>

        <p
          style={{
            fontSize: 'clamp(10.5px, 1.3vh, 12.5px)',
            color: COLORS.textMuted,
            lineHeight: 1.5,
            margin: 0,
            marginTop: 10,
            paddingTop: 8,
            borderTop: `1px solid ${COLORS.border}`,
          }}
        >
          Generation matters too — each new generation (Claude 3 → 4 → 5) generally improves capability at every size tier, so a{' '}
          <strong style={{ color: COLORS.textSecondary }}>current-generation Haiku can often outperform an older-generation Opus</strong>.
        </p>
      </div>

      {/* Per-model cards */}
      <h3 style={sectionHeadingStyle}>The four models</h3>
      <p style={sectionLeadStyle}>Same colors as the chart above — match a dot to a card.</p>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 220px), 1fr))',
          gap: 'clamp(6px, 1vh, 12px)',
        }}
      >
        {MODELS.map((m) => (
          <div
            key={m.id}
            style={{
              background: COLORS.surface,
              border: `1px solid ${COLORS.border}`,
              borderRadius: 10,
              padding: 'clamp(8px, 1.2vh, 14px)',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
              <span style={{ width: 12, height: 12, borderRadius: '50%', background: m.color, flexShrink: 0 }} aria-hidden="true" />
              <span style={{ fontSize: 'clamp(12px, 1.5vh, 14px)', fontWeight: 700, color: COLORS.textPrimary }}>{m.name}</span>
            </div>
            <div style={{ fontSize: 'clamp(10.5px, 1.3vh, 12px)', color: COLORS.textMuted, lineHeight: 1.4 }}>{m.desc}</div>
          </div>
        ))}
      </div>
    </div>
  )
}
