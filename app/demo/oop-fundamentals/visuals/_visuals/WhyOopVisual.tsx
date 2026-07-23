import { Boxes, ShieldCheck, MessageSquareText, Shuffle, FunctionSquare } from 'lucide-react'
import { COLORS } from '../../../_styles'
import { overviewStyle, sectionHeadingStyle, cardStyle } from '../_visual-styles'

const PAYOFFS = [
  { id: 'reuse', label: 'Code reuse', desc: 'A class you can instantiate many times, instead of copy-pasting logic.', Icon: Boxes },
  { id: 'rules', label: 'Enforced rules', desc: 'A place to enforce how data can be changed — methods, not direct access.', Icon: ShieldCheck },
  { id: 'vocab', label: 'Shared vocabulary', desc: 'Code maps onto how teams talk about a domain — a "Customer," an "Order."', Icon: MessageSquareText },
]

/** Static infographic: procedural sprawl vs. object-oriented structure, then what OOP buys you. */
export default function WhyOopVisual() {
  return (
    <div>
      <p style={overviewStyle}>
        OOP structures code around <strong style={{ color: COLORS.textPrimary }}>data and the behavior that belongs to it</strong> —
        instead of a long sequence of standalone functions reaching into shared, loosely-related state.
      </p>

      <h3 style={sectionHeadingStyle}>Two ways to structure the same problem</h3>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 260px), 1fr))',
          gap: 'clamp(8px, 1.4vh, 14px)',
          marginBottom: 'clamp(10px, 2vh, 20px)',
        }}
      >
        <div style={{ ...cardStyle, borderColor: '#ef444455' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
            <FunctionSquare size={16} color="#f87171" />
            <span style={{ fontSize: 'clamp(12px, 1.5vh, 14px)', fontWeight: 700, color: COLORS.textPrimary }}>Without structure</span>
          </div>
          <div style={{ fontSize: 'clamp(10.5px, 1.3vh, 12px)', color: COLORS.textMuted, lineHeight: 1.5 }}>
            Standalone functions all reach into the same shared state — any one of them can change it in any way, from anywhere in
            the program.
          </div>
        </div>
        <div style={{ ...cardStyle, borderColor: `${COLORS.accentBright}55` }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
            <Shuffle size={16} color={COLORS.accentBright} />
            <span style={{ fontSize: 'clamp(12px, 1.5vh, 14px)', fontWeight: 700, color: COLORS.textPrimary }}>With objects</span>
          </div>
          <div style={{ fontSize: 'clamp(10.5px, 1.3vh, 12px)', color: COLORS.textMuted, lineHeight: 1.5 }}>
            Each object bundles its own data (attributes) with the operations that make sense on that data (methods) — state and
            behavior travel together.
          </div>
        </div>
      </div>

      <h3 style={sectionHeadingStyle}>What it buys you as systems grow</h3>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 200px), 1fr))',
          gap: 'clamp(6px, 1vh, 12px)',
        }}
      >
        {PAYOFFS.map((p) => (
          <div key={p.id} style={cardStyle}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
              <p.Icon size={15} color={COLORS.accentBright} />
              <span style={{ fontSize: 'clamp(11.5px, 1.4vh, 13px)', fontWeight: 700, color: COLORS.textPrimary }}>{p.label}</span>
            </div>
            <div style={{ fontSize: 'clamp(10px, 1.25vh, 11.5px)', color: COLORS.textMuted, lineHeight: 1.4 }}>{p.desc}</div>
          </div>
        ))}
      </div>
    </div>
  )
}
