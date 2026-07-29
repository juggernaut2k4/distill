import { GitBranch, Repeat } from 'lucide-react'
import { COLORS } from '../../../_styles'
import { overviewStyle, sectionHeadingStyle, cardStyle, codeCardStyle, calloutRowStyle, calloutItemStyle } from '../_visual-styles'

const EXCERPT = `shapes = [Rectangle(4, 5), Circle(3)]

total = sum(shape.area() for shape in shapes)
# works without a single if/elif checking the type`

const CALLOUTS = [
  { color: COLORS.accentBright, text: 'Every Shape responds to .area() with its own correct behavior.' },
  { color: '#f5a524', text: 'The caller never checks which concrete type it\'s dealing with.' },
]

/** Static infographic: code excerpt with callouts, plus a before/after contrast of type-checking vs polymorphic calls. */
export default function PolymorphismVisual() {
  return (
    <div>
      <p style={overviewStyle}>
        Polymorphism means the same method call gets the right behavior no matter which concrete type it&apos;s called on.
      </p>

      <h3 style={sectionHeadingStyle}>One call, correct behavior per type</h3>
      <pre style={{ ...codeCardStyle, marginBottom: 'clamp(8px, 1.4vh, 14px)' }}>
        <code>{EXCERPT}</code>
      </pre>
      <div style={{ ...calloutRowStyle, marginBottom: 'clamp(10px, 2vh, 20px)' }}>
        {CALLOUTS.map((c, i) => (
          <div key={i} style={calloutItemStyle(c.color)}>
            {c.text}
          </div>
        ))}
      </div>

      <h3 style={sectionHeadingStyle}>What happens when a new shape is added</h3>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 260px), 1fr))',
          gap: 'clamp(8px, 1.4vh, 14px)',
        }}
      >
        <div style={{ ...cardStyle, borderColor: '#ef444455' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
            <GitBranch size={16} color="#f87171" />
            <span style={{ fontSize: 'clamp(12px, 1.5vh, 14px)', fontWeight: 700, color: COLORS.textPrimary }}>Without polymorphism</span>
          </div>
          <div style={{ fontSize: 'clamp(10.5px, 1.3vh, 12px)', color: COLORS.textMuted, lineHeight: 1.5 }}>
            Code fills with if isinstance(shape, Rectangle) ... elif ... branches — every new shape means updating every branch
            across the codebase.
          </div>
        </div>
        <div style={{ ...cardStyle, borderColor: `${COLORS.accentBright}55` }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
            <Repeat size={16} color={COLORS.accentBright} />
            <span style={{ fontSize: 'clamp(12px, 1.5vh, 14px)', fontWeight: 700, color: COLORS.textPrimary }}>With polymorphism</span>
          </div>
          <div style={{ fontSize: 'clamp(10.5px, 1.3vh, 12px)', color: COLORS.textMuted, lineHeight: 1.5 }}>
            Adding a new Shape subclass is enough — every existing loop calling .area() automatically handles it, zero changes.
          </div>
        </div>
      </div>
    </div>
  )
}
