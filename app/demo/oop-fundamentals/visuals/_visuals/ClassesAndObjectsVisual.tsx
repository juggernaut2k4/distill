import { Car } from 'lucide-react'
import { COLORS } from '../../../_styles'
import { overviewStyle, sectionHeadingStyle, cardStyle, codeCardStyle, calloutRowStyle, calloutItemStyle } from '../_visual-styles'

const EXCERPT = `class Car:
    def __init__(self, make, model):
        self.make = make
        self.model = model
        self.odometer = 0

    def drive(self, miles):
        self.odometer += miles`

const CALLOUTS = [
  { color: COLORS.accentBright, text: '__init__ is the constructor — it runs once, when the object is created, and sets up its starting state.' },
  { color: '#f5a524', text: 'self refers to "this specific instance" — it\'s how each object keeps its own odometer without affecting any other Car.' },
]

/** Static infographic: class-as-blueprint, code excerpt with callouts, and two independent instances. */
export default function ClassesAndObjectsVisual() {
  return (
    <div>
      <p style={overviewStyle}>
        A <strong style={{ color: COLORS.textPrimary }}>class</strong> is a blueprint; an{' '}
        <strong style={{ color: COLORS.textPrimary }}>object</strong> is a specific instance built from it — each instance gets its
        own copy of the attribute values.
      </p>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 320px), 1fr))',
          gap: 'clamp(8px, 1.4vh, 14px)',
          marginBottom: 'clamp(10px, 2vh, 20px)',
        }}
      >
        <div>
          <h3 style={sectionHeadingStyle}>The blueprint</h3>
          <pre style={codeCardStyle}>
            <code>{EXCERPT}</code>
          </pre>
          <div style={calloutRowStyle}>
            {CALLOUTS.map((c, i) => (
              <div key={i} style={calloutItemStyle(c.color)}>
                {c.text}
              </div>
            ))}
          </div>
        </div>

        <div>
          <h3 style={sectionHeadingStyle}>Two instances, separate state</h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'clamp(6px, 1vh, 10px)' }}>
            {[
              { name: 'my_car', model: 'Toyota Corolla', odometer: 120 },
              { name: 'your_car', model: 'Honda Civic', odometer: 0 },
            ].map((c) => (
              <div key={c.name} style={{ ...cardStyle, display: 'flex', alignItems: 'center', gap: 10 }}>
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
                  <Car size={15} color={COLORS.accentBright} />
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 'clamp(11.5px, 1.4vh, 13px)', fontWeight: 700, color: COLORS.textPrimary }}>
                    {c.name} <span style={{ color: COLORS.textMuted, fontWeight: 400 }}>— {c.model}</span>
                  </div>
                </div>
                <div style={{ fontSize: 'clamp(10.5px, 1.3vh, 12px)', color: COLORS.textSecondary, whiteSpace: 'nowrap' }}>
                  odometer = <strong style={{ color: COLORS.textPrimary }}>{c.odometer}</strong>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
