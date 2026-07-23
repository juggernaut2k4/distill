import { PawPrint } from 'lucide-react'
import { COLORS } from '../../../_styles'
import { overviewStyle, sectionHeadingStyle, codeCardStyle, calloutRowStyle, calloutItemStyle } from '../_visual-styles'

const EXCERPT = `class Animal:
    def describe(self):
        return f"{self.name} is an animal."
    def speak(self):
        raise NotImplementedError

class Dog(Animal):
    def speak(self):
        return f"{self.name} says Woof!"`

const CALLOUTS = [
  { color: COLORS.accentBright, text: 'describe() is written once, in Animal — every subclass gets it for free.' },
  { color: '#f5a524', text: 'speak() is overridden per subclass — each animal responds in its own way.' },
]

/** Static infographic: code excerpt with callouts, plus a tree diagram of shared vs. overridden behavior. */
export default function InheritanceVisual() {
  return (
    <div>
      <p style={overviewStyle}>
        Inheritance lets a subclass reuse and extend a base class, modeling an{' '}
        <strong style={{ color: COLORS.textPrimary }}>&quot;is-a&quot;</strong> relationship — a Dog is an Animal.
      </p>

      <h3 style={sectionHeadingStyle}>Reuse the shared logic, override the rest</h3>
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

      <h3 style={sectionHeadingStyle}>The class tree</h3>
      <div
        style={{
          background: COLORS.surface,
          border: `1px solid ${COLORS.border}`,
          borderRadius: 12,
          padding: 'clamp(12px, 2vh, 22px)',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
        }}
      >
        <div
          style={{
            padding: '6px 16px',
            borderRadius: 8,
            background: COLORS.surfaceRaised,
            border: `1px solid ${COLORS.borderStrong}`,
            fontSize: 'clamp(11px, 1.4vh, 13px)',
            fontWeight: 700,
            color: COLORS.textPrimary,
          }}
        >
          Animal <span style={{ color: COLORS.textMuted, fontWeight: 400 }}>— describe()</span>
        </div>
        <svg width="140" height="24" viewBox="0 0 140 24" aria-hidden="true">
          <path d="M20 0 V10 H120 V0" fill="none" stroke={COLORS.borderStrong} strokeWidth={1.5} />
          <path d="M20 10 V20" fill="none" stroke={COLORS.borderStrong} strokeWidth={1.5} />
          <path d="M120 10 V20" fill="none" stroke={COLORS.borderStrong} strokeWidth={1.5} />
        </svg>
        <div style={{ display: 'flex', gap: 'clamp(10px, 2vw, 20px)' }}>
          {[
            { name: 'Dog', says: 'Woof!' },
            { name: 'Cat', says: 'Meow!' },
          ].map((sub) => (
            <div
              key={sub.name}
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: 4,
                padding: 'clamp(8px, 1.4vh, 12px)',
                borderRadius: 10,
                background: COLORS.surfaceRaised,
                border: `1px solid ${COLORS.accentBright}55`,
              }}
            >
              <PawPrint size={14} color={COLORS.accentBright} />
              <span style={{ fontSize: 'clamp(11px, 1.4vh, 13px)', fontWeight: 700, color: COLORS.textPrimary }}>{sub.name}</span>
              <span style={{ fontSize: 'clamp(9.5px, 1.15vh, 11px)', color: COLORS.textMuted }}>speak() → &quot;{sub.says}&quot;</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
