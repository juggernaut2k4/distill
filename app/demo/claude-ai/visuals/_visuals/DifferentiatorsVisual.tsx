'use client'

import { useState } from 'react'
import { COLORS } from '../../../_styles'

const CARDS = [
  {
    id: 'safety',
    title: 'Safety-First Training',
    front: 'Careful, honest, transparent.',
    back: 'Claude is trained to decline harmful requests and be upfront about uncertainty rather than confidently making things up.',
  },
  {
    id: 'context',
    title: 'Long Context Windows',
    front: 'Holds huge amounts of text at once.',
    back: 'Entire codebases, long documents, and extended conversations can stay in context — real work rarely fits in a short prompt.',
  },
  {
    id: 'agentic',
    title: 'Strong Agentic Tool Use',
    front: 'Plans and acts across many steps.',
    back: 'Claude reliably uses tools across long task chains — the foundation of products like Claude Code.',
  },
  {
    id: 'artifacts',
    title: 'Artifacts & Structured Output',
    front: 'Builds substantial standalone outputs.',
    back: 'Code, documents, and interactive UIs that can be iterated on directly — not just plain chat replies.',
  },
]

/** Responsive grid of flip cards — click to reveal what each differentiator actually means. */
export default function DifferentiatorsVisual() {
  const [flipped, setFlipped] = useState<Set<string>>(new Set())

  function toggle(id: string) {
    setFlipped((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  return (
    <div>
      <style jsx>{`
        .flip-outer {
          perspective: 1000px;
          cursor: pointer;
        }
        .flip-inner {
          position: relative;
          width: 100%;
          height: 100%;
          transition: transform 500ms cubic-bezier(0.4, 0.2, 0.2, 1);
          transform-style: preserve-3d;
        }
        .flipped .flip-inner {
          transform: rotateY(180deg);
        }
        .flip-face {
          position: absolute;
          inset: 0;
          backface-visibility: hidden;
          border-radius: 12px;
          padding: 20px;
          display: flex;
          flex-direction: column;
          justify-content: center;
        }
        .flip-back {
          transform: rotateY(180deg);
        }
      `}</style>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 240px), 1fr))',
          gap: 16,
        }}
      >
        {CARDS.map((card) => {
          const isFlipped = flipped.has(card.id)
          return (
            <div
              key={card.id}
              className={`flip-outer${isFlipped ? ' flipped' : ''}`}
              onClick={() => toggle(card.id)}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') toggle(card.id)
              }}
              style={{ height: 168 }}
            >
              <div className="flip-inner">
                <div className="flip-face" style={{ background: COLORS.surface, border: `1px solid ${COLORS.border}` }}>
                  <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 8 }}>{card.title}</div>
                  <div style={{ fontSize: 13, color: COLORS.textSecondary }}>{card.front}</div>
                  <div style={{ fontSize: 11, color: COLORS.textMuted, marginTop: 14 }}>Click to flip →</div>
                </div>
                <div className="flip-face flip-back" style={{ background: COLORS.surfaceRaised, border: `1px solid ${COLORS.accentBright}` }}>
                  <div style={{ fontSize: 13.5, color: COLORS.textPrimary, lineHeight: 1.55 }}>{card.back}</div>
                </div>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
