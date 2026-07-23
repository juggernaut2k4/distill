'use client'

import { Type, Image as ImageIcon, Code2, FileText, MessageCircle, PenLine, MessagesSquare, Zap, Sparkles } from 'lucide-react'
import { COLORS } from '../../../_styles'

const INPUTS = [
  { id: 'text', label: 'Text', desc: 'Questions & instructions', Icon: Type },
  { id: 'images', label: 'Images', desc: 'Screenshots & photos', Icon: ImageIcon },
  { id: 'code', label: 'Code', desc: 'Whole files or projects', Icon: Code2 },
  { id: 'docs', label: 'Documents', desc: 'PDFs & reports', Icon: FileText },
]

const OUTPUTS = [
  { id: 'answers', label: 'Answers', desc: 'Direct responses', Icon: MessageCircle },
  { id: 'writing', label: 'Writing & Code', desc: 'Drafts & working code', Icon: PenLine },
  { id: 'conversation', label: 'Conversation', desc: 'Back-and-forth dialogue', Icon: MessagesSquare },
  { id: 'actions', label: 'Actions', desc: 'Real tool-driven work', Icon: Zap },
]

/** Static infographic: input → Claude → output, all labels always visible, animated flow lines. */
export default function WhatIsClaudeVisual() {
  return (
    <div>
      <style jsx>{`
        @keyframes dash-flow {
          to {
            stroke-dashoffset: -32;
          }
        }
        .wire {
          stroke: ${COLORS.accent};
          stroke-width: 2.5;
          stroke-dasharray: 1 11;
          stroke-linecap: round;
          fill: none;
          opacity: 0.85;
          animation: dash-flow 1.1s linear infinite;
        }
        @keyframes glow {
          0%, 100% {
            box-shadow: 0 0 0 0 rgba(139, 92, 246, 0.45);
          }
          50% {
            box-shadow: 0 0 0 18px rgba(139, 92, 246, 0);
          }
        }
        .core {
          animation: glow 2.4s ease-out infinite;
        }
        .item-icon {
          background: ${COLORS.surfaceRaised};
          border: 1px solid ${COLORS.border};
        }
      `}</style>

      <div
        style={{
          background: COLORS.surface,
          border: `1px solid ${COLORS.border}`,
          borderRadius: 14,
          padding: 'clamp(20px, 4vw, 36px)',
        }}
      >
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'minmax(160px, 1fr) minmax(60px, 0.5fr) minmax(160px, 1fr)',
            gap: 'clamp(12px, 3vw, 28px)',
            alignItems: 'center',
          }}
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            {INPUTS.map((item) => (
              <div key={item.id} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <div
                  className="item-icon"
                  style={{ width: 40, height: 40, borderRadius: 10, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}
                >
                  <item.Icon size={18} color={COLORS.accentBright} />
                </div>
                <div>
                  <div style={{ fontSize: 14, fontWeight: 700, color: COLORS.textPrimary }}>{item.label}</div>
                  <div style={{ fontSize: 12, color: COLORS.textMuted }}>{item.desc}</div>
                </div>
              </div>
            ))}
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', position: 'relative', minHeight: 260 }}>
            <svg viewBox="0 0 100 260" style={{ width: '100%', height: 260, position: 'absolute', inset: 0 }} aria-hidden="true">
              <path className="wire" d="M0 33 C 45 33, 45 130, 50 130" />
              <path className="wire" d="M0 98 C 45 98, 45 130, 50 130" />
              <path className="wire" d="M0 163 C 45 163, 45 130, 50 130" />
              <path className="wire" d="M0 228 C 45 228, 45 130, 50 130" />
              <path className="wire" d="M50 130 C 55 130, 55 33, 100 33" />
              <path className="wire" d="M50 130 C 55 130, 55 98, 100 98" />
              <path className="wire" d="M50 130 C 55 130, 55 163, 100 163" />
              <path className="wire" d="M50 130 C 55 130, 55 228, 100 228" />
            </svg>
            <div
              className="core"
              style={{
                width: 78,
                height: 78,
                borderRadius: '50%',
                background: `linear-gradient(135deg, ${COLORS.accent}, ${COLORS.accentBright})`,
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                color: '#fff',
                position: 'relative',
                zIndex: 1,
              }}
            >
              <Sparkles size={20} />
              <span style={{ fontWeight: 800, fontSize: 12.5, marginTop: 2 }}>Claude</span>
            </div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            {OUTPUTS.map((item) => (
              <div key={item.id} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <div
                  className="item-icon"
                  style={{ width: 40, height: 40, borderRadius: 10, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}
                >
                  <item.Icon size={18} color={COLORS.accentBright} />
                </div>
                <div>
                  <div style={{ fontSize: 14, fontWeight: 700, color: COLORS.textPrimary }}>{item.label}</div>
                  <div style={{ fontSize: 12, color: COLORS.textMuted }}>{item.desc}</div>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 20, paddingTop: 16, borderTop: `1px solid ${COLORS.border}` }}>
          <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: COLORS.textMuted }}>
            Input
          </span>
          <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: COLORS.textMuted }}>
            Output
          </span>
        </div>
      </div>
    </div>
  )
}
