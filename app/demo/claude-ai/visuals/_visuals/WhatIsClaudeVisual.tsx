'use client'

import { useState } from 'react'
import { COLORS } from '../../../_styles'

const INPUTS = [
  { id: 'text', label: 'Text', desc: 'Questions, instructions, long documents.' },
  { id: 'images', label: 'Images', desc: 'Screenshots, diagrams, photos.' },
  { id: 'code', label: 'Code', desc: 'Whole files or codebases for context.' },
  { id: 'docs', label: 'Documents', desc: 'PDFs, spreadsheets, reports.' },
]

const OUTPUTS = [
  { id: 'answers', label: 'Answers', desc: 'Direct responses to questions.' },
  { id: 'writing', label: 'Writing & Code', desc: 'Drafts, edits, working code.' },
  { id: 'conversation', label: 'Conversation', desc: 'Back-and-forth dialogue.' },
  { id: 'actions', label: 'Actions', desc: 'Tool calls that get real work done.' },
]

/** Input → Claude → Output flow, with a continuously-animated "current" running through the wires. */
export default function WhatIsClaudeVisual() {
  const [hovered, setHovered] = useState<string | null>(null)
  const active = INPUTS.find((i) => i.id === hovered) ?? OUTPUTS.find((o) => o.id === hovered) ?? null

  return (
    <div>
      <style jsx>{`
        @keyframes dash-flow {
          to {
            stroke-dashoffset: -24;
          }
        }
        .wire {
          stroke: ${COLORS.borderStrong};
          stroke-width: 2;
          stroke-dasharray: 6 6;
          fill: none;
          animation: dash-flow 1.4s linear infinite;
        }
        .pill {
          transition: transform 160ms ease, border-color 160ms ease, background 160ms ease;
          cursor: default;
        }
        .pill:hover {
          transform: translateY(-2px);
          border-color: ${COLORS.accentBright};
          background: ${COLORS.surfaceRaised};
        }
        @keyframes pulse {
          0%, 100% {
            box-shadow: 0 0 0 0 rgba(139, 92, 246, 0.5);
          }
          50% {
            box-shadow: 0 0 0 16px rgba(139, 92, 246, 0);
          }
        }
        .core {
          animation: pulse 2.2s ease-out infinite;
        }
      `}</style>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'minmax(140px, 1fr) minmax(80px, 0.6fr) minmax(140px, 1fr)',
          gap: 'clamp(12px, 3vw, 32px)',
          alignItems: 'center',
        }}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {INPUTS.map((item) => (
            <div
              key={item.id}
              className="pill"
              onMouseEnter={() => setHovered(item.id)}
              onMouseLeave={() => setHovered(null)}
              style={{
                padding: '10px 14px',
                borderRadius: 8,
                border: `1px solid ${COLORS.border}`,
                background: COLORS.surface,
                fontSize: 13.5,
                fontWeight: 600,
                textAlign: 'center' as const,
              }}
            >
              {item.label}
            </div>
          ))}
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
          <svg viewBox="0 0 100 160" style={{ width: '100%', height: 160 }} aria-hidden="true">
            <path className="wire" d="M0 20 C 40 20, 40 80, 50 80" />
            <path className="wire" d="M0 60 C 40 60, 40 80, 50 80" />
            <path className="wire" d="M0 100 C 40 100, 40 80, 50 80" />
            <path className="wire" d="M0 140 C 40 140, 40 80, 50 80" />
            <path className="wire" d="M50 80 C 60 80, 60 20, 100 20" />
            <path className="wire" d="M50 80 C 60 80, 60 60, 100 60" />
            <path className="wire" d="M50 80 C 60 80, 60 100, 100 100" />
            <path className="wire" d="M50 80 C 60 80, 60 140, 100 140" />
          </svg>
          <div
            className="core"
            style={{
              width: 64,
              height: 64,
              borderRadius: '50%',
              background: `linear-gradient(135deg, ${COLORS.accent}, ${COLORS.accentBright})`,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#fff',
              fontWeight: 800,
              fontSize: 13,
              marginTop: -80,
              position: 'relative',
              zIndex: 1,
            }}
          >
            Claude
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {OUTPUTS.map((item) => (
            <div
              key={item.id}
              className="pill"
              onMouseEnter={() => setHovered(item.id)}
              onMouseLeave={() => setHovered(null)}
              style={{
                padding: '10px 14px',
                borderRadius: 8,
                border: `1px solid ${COLORS.border}`,
                background: COLORS.surface,
                fontSize: 13.5,
                fontWeight: 600,
                textAlign: 'center' as const,
              }}
            >
              {item.label}
            </div>
          ))}
        </div>
      </div>

      <div
        style={{
          marginTop: 24,
          minHeight: 46,
          padding: '12px 16px',
          borderRadius: 8,
          background: COLORS.surfaceRaised,
          border: `1px solid ${COLORS.border}`,
          fontSize: 14,
          color: COLORS.textSecondary,
        }}
      >
        {active ? (
          <>
            <strong style={{ color: COLORS.textPrimary }}>{active.label}:</strong> {active.desc}
          </>
        ) : (
          'Hover an input or output to see what it means.'
        )}
      </div>
    </div>
  )
}
