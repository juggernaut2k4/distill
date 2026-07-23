import { ShieldCheck, ScrollText, Bot, LayoutTemplate } from 'lucide-react'
import { COLORS } from '../../../_styles'

const DIFFERENTIATORS = [
  {
    id: 'safety',
    title: 'Safety-first training',
    desc: 'Trained to decline harmful requests and be upfront about uncertainty rather than confidently making things up.',
    Icon: ShieldCheck,
  },
  {
    id: 'context',
    title: 'Long context windows',
    desc: 'Entire codebases, long documents, and extended conversations can stay in context — real work rarely fits in a short prompt.',
    Icon: ScrollText,
  },
  {
    id: 'agentic',
    title: 'Strong agentic tool use',
    desc: "Reliably uses tools across long task chains — the foundation of products like Claude Code.",
    Icon: Bot,
  },
  {
    id: 'artifacts',
    title: 'Artifacts & structured output',
    desc: 'Produces and iterates on substantial standalone outputs — code, documents, interactive UIs — not just plain chat replies.',
    Icon: LayoutTemplate,
  },
]

/** Static infographic: 4 differentiator cards, always fully visible. */
export default function DifferentiatorsVisual() {
  return (
    <div>
      <p style={{ fontSize: 'clamp(12px, 1.8vh, 15px)', color: COLORS.textSecondary, lineHeight: 1.5, margin: '0 0 clamp(10px, 2vh, 20px) 0', maxWidth: 640 }}>
        A few things consistently show up as differentiators when people compare Claude to other AI models.
      </p>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 280px), 1fr))',
          gap: 'clamp(8px, 1.4vh, 14px)',
        }}
      >
        {DIFFERENTIATORS.map((d) => (
          <div
            key={d.id}
            style={{
              background: COLORS.surface,
              border: `1px solid ${COLORS.border}`,
              borderRadius: 12,
              padding: 'clamp(10px, 1.6vh, 18px)',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
              <div
                style={{
                  width: 30,
                  height: 30,
                  borderRadius: 8,
                  background: COLORS.surfaceRaised,
                  border: `1px solid ${COLORS.border}`,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexShrink: 0,
                }}
              >
                <d.Icon size={15} color={COLORS.accentBright} />
              </div>
              <span style={{ fontSize: 'clamp(12.5px, 1.6vh, 15px)', fontWeight: 700, color: COLORS.textPrimary }}>{d.title}</span>
            </div>
            <div style={{ fontSize: 'clamp(11px, 1.4vh, 13px)', color: COLORS.textMuted, lineHeight: 1.5 }}>{d.desc}</div>
          </div>
        ))}
      </div>
    </div>
  )
}
