import { CreditCard, Plus } from 'lucide-react'
import { COLORS } from '../../../_styles'
import { overviewStyle, sectionHeadingStyle, codeCardStyle, calloutRowStyle, calloutItemStyle } from '../_visual-styles'

const EXCERPT = `class PaymentProcessor(ABC):
    @abstractmethod
    def charge(self, amount): ...

def checkout(processor: PaymentProcessor, amount):
    processor.charge(amount)  # doesn't know which provider`

const CALLOUTS = [
  { color: COLORS.accentBright, text: 'checkout() depends only on the abstract charge() interface — never a specific provider.' },
  { color: '#f5a524', text: 'Callers depend on a stable interface; the implementation behind it is free to change.' },
]

const PROCESSORS = [
  { id: 'stripe', label: 'Stripe' },
  { id: 'paypal', label: 'PayPal' },
  { id: 'applepay', label: 'Apple Pay', added: true },
]

/** Static infographic: code excerpt with callouts, plus a diagram showing a new implementation added without touching checkout(). */
export default function AbstractionVisual() {
  return (
    <div>
      <p style={overviewStyle}>
        Abstraction exposes <strong style={{ color: COLORS.textPrimary }}>what</strong> an object does, while hiding{' '}
        <strong style={{ color: COLORS.textPrimary }}>how</strong> it does it.
      </p>

      <h3 style={sectionHeadingStyle}>One interface, swappable implementations</h3>
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

      <h3 style={sectionHeadingStyle}>Adding a provider without touching checkout()</h3>
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
            marginBottom: 10,
          }}
        >
          checkout()
        </div>
        <div style={{ width: 1, height: 14, background: COLORS.borderStrong }} />
        <div
          style={{
            padding: '5px 14px',
            borderRadius: 999,
            border: `1px dashed ${COLORS.accentBright}`,
            fontSize: 'clamp(10px, 1.25vh, 11.5px)',
            color: COLORS.accentBright,
            marginBottom: 10,
          }}
        >
          PaymentProcessor interface
        </div>
        <div style={{ display: 'flex', gap: 'clamp(6px, 1.2vw, 12px)', flexWrap: 'wrap', justifyContent: 'center' }}>
          {PROCESSORS.map((p) => (
            <div
              key={p.id}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                padding: '7px 12px',
                borderRadius: 8,
                background: p.added ? `${COLORS.accentBright}18` : COLORS.surfaceRaised,
                border: `1px solid ${p.added ? COLORS.accentBright : COLORS.border}`,
                fontSize: 'clamp(10.5px, 1.3vh, 12px)',
                fontWeight: 600,
                color: p.added ? COLORS.accentBright : COLORS.textSecondary,
              }}
            >
              {p.added ? <Plus size={12} /> : <CreditCard size={12} />}
              {p.label}
            </div>
          ))}
        </div>
        <div style={{ fontSize: 'clamp(9.5px, 1.15vh, 11px)', color: COLORS.textMuted, marginTop: 10, textAlign: 'center' }}>
          Apple Pay was added as one new class — every existing caller keeps working unchanged.
        </div>
      </div>
    </div>
  )
}
