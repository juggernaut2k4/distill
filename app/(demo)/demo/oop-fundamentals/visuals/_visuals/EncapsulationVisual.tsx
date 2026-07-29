import { LockKeyhole, Unlock } from 'lucide-react'
import { COLORS } from '../../../_styles'
import { overviewStyle, sectionHeadingStyle, cardStyle, codeCardStyle, calloutRowStyle, calloutItemStyle } from '../_visual-styles'

const EXCERPT = `class BankAccount:
    def __init__(self, owner, balance=0):
        self._balance = balance   # internal, not public

    def deposit(self, amount):
        if amount <= 0:
            raise ValueError("must be positive")
        self._balance += amount`

const CALLOUTS = [
  { color: COLORS.accentBright, text: '_balance is internal by convention — not part of the public API other code is meant to touch.' },
  { color: '#f5a524', text: 'deposit() validates before changing state — invalid values never make it into the account.' },
]

/** Static infographic: code excerpt with callouts, plus a before/after contrast of what encapsulation prevents. */
export default function EncapsulationVisual() {
  return (
    <div>
      <p style={overviewStyle}>
        Encapsulation bundles data with the methods that operate on it, and controls access so it can{' '}
        <strong style={{ color: COLORS.textPrimary }}>only change in valid ways</strong>.
      </p>

      <h3 style={sectionHeadingStyle}>Validating on the way in</h3>
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

      <h3 style={sectionHeadingStyle}>Why it matters in a large codebase</h3>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 260px), 1fr))',
          gap: 'clamp(8px, 1.4vh, 14px)',
        }}
      >
        <div style={{ ...cardStyle, borderColor: '#ef444455' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
            <Unlock size={16} color="#f87171" />
            <span style={{ fontSize: 'clamp(12px, 1.5vh, 14px)', fontWeight: 700, color: COLORS.textPrimary }}>Without encapsulation</span>
          </div>
          <div style={{ fontSize: 'clamp(10.5px, 1.3vh, 12px)', color: COLORS.textMuted, lineHeight: 1.5 }}>
            Any code anywhere in the system can set balance to an invalid value — negative, wrong currency, out of sync — because
            no single place enforces the rules.
          </div>
        </div>
        <div style={{ ...cardStyle, borderColor: `${COLORS.accentBright}55` }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
            <LockKeyhole size={16} color={COLORS.accentBright} />
            <span style={{ fontSize: 'clamp(12px, 1.5vh, 14px)', fontWeight: 700, color: COLORS.textPrimary }}>With encapsulation</span>
          </div>
          <div style={{ fontSize: 'clamp(10.5px, 1.3vh, 12px)', color: COLORS.textMuted, lineHeight: 1.5 }}>
            deposit() and withdraw() are the only doors in — validation and business rules live in exactly one place.
          </div>
        </div>
      </div>
    </div>
  )
}
