'use client'

import { Search, Zap, Gauge, Feather } from 'lucide-react'
import { COLORS } from '../../../_styles'

const RECOMMENDATIONS = [
  {
    id: 'opus',
    name: 'Opus',
    color: '#a78bfa',
    Icon: Search,
    when: 'Deep research, hard math and reasoning, high-stakes writing — worth paying for the strongest reasoning available.',
  },
  {
    id: 'sonnet',
    name: 'Sonnet',
    color: '#8b5cf6',
    Icon: Gauge,
    when: 'Day-to-day coding, agents, document analysis, most product features — the usual default.',
  },
  {
    id: 'haiku',
    name: 'Haiku',
    color: '#ec4899',
    Icon: Zap,
    when: 'High-volume classification, simple chat, real-time features — thousands or millions of calls where speed and cost matter most.',
  },
  {
    id: 'fable',
    name: 'Fable',
    color: '#f5a524',
    Icon: Feather,
    when: 'Creative or narrative generation — when the task is specifically storytelling rather than technical work.',
  },
]

/** Static infographic: 4 model recommendations + a common production triage pattern. */
export default function ChoosingModelVisual() {
  return (
    <div>
      <style jsx>{`
        @keyframes dash-flow {
          to {
            stroke-dashoffset: -32;
          }
        }
        .flow-wire {
          stroke: ${COLORS.accentBright};
          stroke-width: 2;
          stroke-dasharray: 1 8;
          stroke-linecap: round;
          fill: none;
          animation: dash-flow 1s linear infinite;
        }
      `}</style>

      <p style={{ fontSize: 'clamp(12px, 1.8vh, 15px)', color: COLORS.textSecondary, lineHeight: 1.5, margin: '0 0 clamp(8px, 1.5vh, 16px) 0', maxWidth: 640 }}>
        There&apos;s no single &quot;best&quot; model — the right choice depends on what you&apos;re{' '}
        <strong style={{ color: COLORS.textPrimary }}>optimizing for</strong>.
      </p>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 260px), 1fr))',
          gap: 'clamp(6px, 1vh, 12px)',
          marginBottom: 'clamp(10px, 2vh, 20px)',
        }}
      >
        {RECOMMENDATIONS.map((r) => (
          <div
            key={r.id}
            style={{
              background: COLORS.surface,
              border: `1px solid ${COLORS.border}`,
              borderRadius: 10,
              padding: 'clamp(8px, 1.2vh, 14px)',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
              <div
                style={{
                  width: 26,
                  height: 26,
                  borderRadius: 7,
                  background: `${r.color}22`,
                  border: `1px solid ${r.color}`,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexShrink: 0,
                }}
              >
                <r.Icon size={14} color={r.color} />
              </div>
              <span style={{ fontSize: 'clamp(12px, 1.5vh, 14px)', fontWeight: 700, color: COLORS.textPrimary }}>{r.name}</span>
            </div>
            <div style={{ fontSize: 'clamp(10.5px, 1.3vh, 12px)', color: COLORS.textMuted, lineHeight: 1.4 }}>{r.when}</div>
          </div>
        ))}
      </div>

      <h3 style={{ fontSize: 'clamp(12px, 1.5vh, 14px)', fontWeight: 700, color: COLORS.textPrimary, margin: '0 0 clamp(6px, 1vh, 10px) 0' }}>
        A common production pattern
      </h3>
      <div
        style={{
          background: COLORS.surface,
          border: `1px solid ${COLORS.border}`,
          borderRadius: 12,
          padding: 'clamp(10px, 1.8vh, 20px)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', flexWrap: 'wrap', gap: 4 }}>
          <FlowStep label="Request" color={COLORS.textMuted} />
          <Arrow />
          <FlowStep label="Haiku triage" color="#ec4899" />
          <Arrow />
          <FlowStep label="Simple? Done." color={COLORS.textMuted} sub />
          <div style={{ width: '100%', display: 'flex', justifyContent: 'center' }} />
          <Arrow rotated />
          <FlowStep label="Escalate to Sonnet / Opus" color="#8b5cf6" sub />
        </div>
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
          Use a fast, cheap model like Haiku to triage or pre-process, and only escalate to Sonnet or Opus for the subset of requests
          that actually need deeper reasoning.
        </p>
      </div>
    </div>
  )
}

function FlowStep({ label, color, sub }: { label: string; color: string; sub?: boolean }) {
  return (
    <div
      style={{
        padding: sub ? '6px 12px' : '8px 14px',
        borderRadius: 8,
        background: COLORS.surfaceRaised,
        border: `1px solid ${color}`,
        fontSize: sub ? 11 : 12,
        fontWeight: 600,
        color: COLORS.textPrimary,
        whiteSpace: 'nowrap',
      }}
    >
      {label}
    </div>
  )
}

function Arrow({ rotated }: { rotated?: boolean }) {
  return (
    <svg width={rotated ? 16 : 28} height={rotated ? 20 : 16} viewBox={rotated ? '0 0 16 20' : '0 0 28 16'} aria-hidden="true">
      {rotated ? (
        <>
          <path className="flow-wire" d="M8 2 V16" />
          <path d="M3 12 L8 18 L13 12" fill="none" stroke={COLORS.accentBright} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
        </>
      ) : (
        <>
          <path className="flow-wire" d="M2 8 H24" />
          <path d="M19 3 L26 8 L19 13" fill="none" stroke={COLORS.accentBright} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
        </>
      )}
    </svg>
  )
}
