'use client'

import { useState } from 'react'
import { COLORS } from '../../../_styles'

type Complexity = 'simple' | 'moderate' | 'complex'
type Volume = 'few' | 'many'

const RESULT_TABLE: Record<Complexity, Record<Volume, { model: string; color: string; reason: string }>> = {
  simple: {
    few: { model: 'Haiku', color: '#ec4899', reason: 'A quick, simple task — Haiku is fast and inexpensive with plenty of capability to spare.' },
    many: { model: 'Haiku', color: '#ec4899', reason: 'Simple task, high volume — Haiku keeps per-request cost and latency low at scale.' },
  },
  moderate: {
    few: { model: 'Sonnet', color: '#8b5cf6', reason: 'A handful of moderately complex requests — Sonnet is the balanced everyday default.' },
    many: { model: 'Sonnet', color: '#8b5cf6', reason: 'Moderate complexity at volume — Sonnet still balances quality and cost well here.' },
  },
  complex: {
    few: { model: 'Opus', color: '#a78bfa', reason: 'A small number of genuinely hard requests — worth paying for Opus\'s deeper reasoning.' },
    many: { model: 'Sonnet', color: '#8b5cf6', reason: 'Complex work at high volume — Sonnet trades a little depth for cost you can sustain at scale.' },
  },
}

/** A 2-question decision wizard that recommends a model based on task complexity and volume. */
export default function ChoosingModelVisual() {
  const [complexity, setComplexity] = useState<Complexity | null>(null)
  const [volume, setVolume] = useState<Volume | null>(null)

  const result = complexity && volume ? RESULT_TABLE[complexity][volume] : null

  function reset() {
    setComplexity(null)
    setVolume(null)
  }

  return (
    <div>
      <style jsx>{`
        .step {
          animation: fade-in 350ms ease both;
        }
        @keyframes fade-in {
          from {
            opacity: 0;
            transform: translateY(6px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }
        .option {
          transition: border-color 140ms ease, background 140ms ease, transform 140ms ease;
        }
        .option:hover {
          transform: translateY(-2px);
        }
      `}</style>

      <div
        style={{
          background: COLORS.surface,
          border: `1px solid ${COLORS.border}`,
          borderRadius: 12,
          padding: 'clamp(18px, 4vw, 28px)',
        }}
      >
        <div className="step">
          <div style={{ fontSize: 13, fontWeight: 700, color: COLORS.textMuted, marginBottom: 10 }}>
            1. How complex is the task?
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {(['simple', 'moderate', 'complex'] as Complexity[]).map((c) => (
              <button
                key={c}
                type="button"
                className="option"
                onClick={() => setComplexity(c)}
                style={{
                  padding: '9px 16px',
                  borderRadius: 8,
                  border: `1px solid ${complexity === c ? COLORS.accentBright : COLORS.border}`,
                  background: complexity === c ? COLORS.surfaceRaised : 'transparent',
                  color: complexity === c ? COLORS.textPrimary : COLORS.textSecondary,
                  fontSize: 13.5,
                  fontWeight: 600,
                  cursor: 'pointer',
                  textTransform: 'capitalize',
                }}
              >
                {c}
              </button>
            ))}
          </div>
        </div>

        {complexity && (
          <div className="step" style={{ marginTop: 22 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: COLORS.textMuted, marginBottom: 10 }}>
              2. How many requests do you need to handle?
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {([
                { id: 'few' as Volume, label: 'A few, occasionally' },
                { id: 'many' as Volume, label: 'Many, at scale' },
              ]).map((v) => (
                <button
                  key={v.id}
                  type="button"
                  className="option"
                  onClick={() => setVolume(v.id)}
                  style={{
                    padding: '9px 16px',
                    borderRadius: 8,
                    border: `1px solid ${volume === v.id ? COLORS.accentBright : COLORS.border}`,
                    background: volume === v.id ? COLORS.surfaceRaised : 'transparent',
                    color: volume === v.id ? COLORS.textPrimary : COLORS.textSecondary,
                    fontSize: 13.5,
                    fontWeight: 600,
                    cursor: 'pointer',
                  }}
                >
                  {v.label}
                </button>
              ))}
            </div>
          </div>
        )}

        {result && (
          <div
            className="step"
            style={{
              marginTop: 24,
              padding: '18px 20px',
              borderRadius: 10,
              background: COLORS.surfaceRaised,
              border: `1px solid ${result.color}`,
              display: 'flex',
              alignItems: 'center',
              gap: 16,
            }}
          >
            <div
              style={{
                width: 48,
                height: 48,
                borderRadius: '50%',
                background: result.color,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: '#fff',
                fontWeight: 800,
                fontSize: 13,
                flexShrink: 0,
              }}
            >
              {result.model[0]}
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 16, fontWeight: 800 }}>Recommended: {result.model}</div>
              <div style={{ fontSize: 13.5, color: COLORS.textSecondary, marginTop: 4 }}>{result.reason}</div>
            </div>
            <button
              type="button"
              onClick={reset}
              style={{
                background: 'transparent',
                border: `1px solid ${COLORS.borderStrong}`,
                borderRadius: 8,
                padding: '8px 14px',
                color: COLORS.textSecondary,
                fontSize: 12.5,
                fontWeight: 600,
                cursor: 'pointer',
                whiteSpace: 'nowrap',
              }}
            >
              Start over
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
