import { LockKeyhole, Layers, GitBranch, Repeat } from 'lucide-react'
import { COLORS } from '../../../_styles'
import { overviewStyle, sectionHeadingStyle, cardStyle } from '../_visual-styles'

const PILLARS = [
  { id: 'encapsulation', label: 'Encapsulation', desc: 'Keeps invalid states from leaking in from anywhere in the program.', Icon: LockKeyhole },
  { id: 'abstraction', label: 'Abstraction', desc: "Lets a system's pieces evolve independently as long as interfaces stay stable.", Icon: Layers },
  { id: 'inheritance', label: 'Inheritance', desc: 'Adds new variations of an existing concept without rewriting working code.', Icon: GitBranch },
  { id: 'polymorphism', label: 'Polymorphism', desc: 'Lets that new variation just work everywhere the concept is already used.', Icon: Repeat },
]

const EXAMPLES = [
  { label: 'Web frameworks', detail: 'a Django or Rails "model" is a class' },
  { label: 'Game engines', detail: 'every game object is typically an Entity subclass' },
  { label: 'Enterprise systems', detail: 'Order, LineItem, and PaymentMethod classes' },
]

/** Static infographic: the four pillars recapped together, plus where they show up in real systems. */
export default function OopInTheRealWorldVisual() {
  return (
    <div>
      <p style={overviewStyle}>
        Put together, the four pillars aren&apos;t academic labels — they&apos;re why{' '}
        <strong style={{ color: COLORS.textPrimary }}>large, long-lived codebases stay maintainable</strong>.
      </p>

      <h3 style={sectionHeadingStyle}>The four pillars, together</h3>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 200px), 1fr))',
          gap: 'clamp(6px, 1vh, 12px)',
          marginBottom: 'clamp(10px, 2vh, 20px)',
        }}
      >
        {PILLARS.map((p) => (
          <div key={p.id} style={cardStyle}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
              <p.Icon size={15} color={COLORS.accentBright} />
              <span style={{ fontSize: 'clamp(11.5px, 1.4vh, 13px)', fontWeight: 700, color: COLORS.textPrimary }}>{p.label}</span>
            </div>
            <div style={{ fontSize: 'clamp(10px, 1.25vh, 11.5px)', color: COLORS.textMuted, lineHeight: 1.4 }}>{p.desc}</div>
          </div>
        ))}
      </div>

      <h3 style={sectionHeadingStyle}>Where you&apos;ll see it</h3>
      <div
        style={{
          background: COLORS.surface,
          border: `1px solid ${COLORS.border}`,
          borderRadius: 12,
          padding: 'clamp(10px, 1.8vh, 20px)',
          display: 'flex',
          flexDirection: 'column',
          gap: 'clamp(6px, 1vh, 10px)',
        }}
      >
        {EXAMPLES.map((e) => (
          <div key={e.label} style={{ display: 'flex', gap: 8, alignItems: 'baseline', flexWrap: 'wrap' }}>
            <span
              style={{
                fontSize: 'clamp(10.5px, 1.3vh, 12px)',
                fontWeight: 700,
                color: COLORS.textPrimary,
                background: COLORS.surfaceRaised,
                border: `1px solid ${COLORS.border}`,
                borderRadius: 6,
                padding: '3px 8px',
              }}
            >
              {e.label}
            </span>
            <span style={{ fontSize: 'clamp(10.5px, 1.3vh, 12px)', color: COLORS.textMuted }}>{e.detail}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
