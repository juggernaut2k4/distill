'use client'

import { MessageSquare, Brain, Bot, Puzzle, Terminal, Globe, Code2, Webhook } from 'lucide-react'
import { COLORS } from '../../../_styles'

const MODES = [
  {
    id: 'chat',
    label: 'Conversational chat',
    desc: 'A back-and-forth dialogue — the most familiar way people interact with Claude, on claude.ai or in apps built on the API.',
    Icon: MessageSquare,
  },
  {
    id: 'thinking',
    label: 'Extended thinking',
    desc: 'For hard problems, Claude reasons step by step before answering — trading extra time for better answers on complex tasks.',
    Icon: Brain,
  },
  {
    id: 'agentic',
    label: 'Agentic use',
    desc: 'Given tools — a terminal, a browser, a codebase, an API — Claude can plan and execute a multi-step task on its own, checking its work along the way.',
    Icon: Bot,
  },
  {
    id: 'embedded',
    label: 'Embedded / integrated',
    desc: 'Claude also shows up inside other products — like Claude in Slack — answering questions or taking action right where people already work.',
    Icon: Puzzle,
  },
] as const

const TOOLS = [
  { id: 'terminal', label: 'Terminal', Icon: Terminal },
  { id: 'browser', label: 'Browser', Icon: Globe },
  { id: 'codebase', label: 'Codebase', Icon: Code2 },
  { id: 'api', label: 'API', Icon: Webhook },
]

/** Static infographic: overview → 4 mode cards, each with a small ambient visual illustrating how it works. */
export default function ModesOfInteractionVisual() {
  return (
    <div>
      <style jsx>{`
        @keyframes dot-pulse {
          0%,
          80%,
          100% {
            opacity: 0.25;
          }
          40% {
            opacity: 1;
          }
        }
        .think-dot {
          animation: dot-pulse 1.4s ease-in-out infinite;
        }
        @keyframes embed-pulse {
          0%,
          100% {
            box-shadow: 0 0 0 0 rgba(139, 92, 246, 0.45);
          }
          50% {
            box-shadow: 0 0 0 8px rgba(139, 92, 246, 0);
          }
        }
        .embed-pulse {
          animation: embed-pulse 2s ease-out infinite;
        }
        @keyframes dash-flow {
          to {
            stroke-dashoffset: -32;
          }
        }
        .tool-wire {
          stroke: ${COLORS.accentBright};
          stroke-width: 2;
          stroke-dasharray: 1 8;
          stroke-linecap: round;
          fill: none;
          animation: dash-flow 1s linear infinite;
        }
      `}</style>

      {/* Overview line */}
      <p style={{ fontSize: 'clamp(12px, 1.8vh, 15px)', color: COLORS.textSecondary, lineHeight: 1.5, margin: '0 0 clamp(8px, 1.5vh, 16px) 0', maxWidth: 640 }}>
        The same underlying models show up in different <strong style={{ color: COLORS.textPrimary }}>modes</strong> depending on how you use them —
        the model doesn&apos;t change, the way you engage with it does.
      </p>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 280px), 1fr))',
          gap: 'clamp(8px, 1.4vh, 14px)',
        }}
      >
        {MODES.map((m) => (
          <div
            key={m.id}
            style={{
              background: COLORS.surface,
              border: `1px solid ${COLORS.border}`,
              borderRadius: 12,
              padding: 'clamp(10px, 1.6vh, 16px)',
              display: 'flex',
              flexDirection: 'column',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
              <div
                style={{
                  width: 26,
                  height: 26,
                  borderRadius: 7,
                  background: COLORS.surfaceRaised,
                  border: `1px solid ${COLORS.border}`,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexShrink: 0,
                }}
              >
                <m.Icon size={14} color={COLORS.accentBright} />
              </div>
              <span style={{ fontSize: 'clamp(12px, 1.5vh, 14px)', fontWeight: 700, color: COLORS.textPrimary }}>{m.label}</span>
            </div>
            <p style={{ fontSize: 'clamp(10.5px, 1.3vh, 12px)', color: COLORS.textMuted, lineHeight: 1.4, margin: '0 0 clamp(8px, 1.2vh, 12px) 0' }}>
              {m.desc}
            </p>

            {/* Per-mode ambient visual */}
            <div style={{ marginTop: 'auto' }}>
              {m.id === 'chat' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <div style={{ alignSelf: 'flex-end', background: COLORS.accent, color: '#fff', padding: '5px 9px', borderRadius: '10px 10px 2px 10px', fontSize: 10 }}>
                    Sonnet vs Haiku?
                  </div>
                  <div style={{ alignSelf: 'flex-start', background: COLORS.surfaceRaised, color: COLORS.textSecondary, padding: '5px 9px', borderRadius: '10px 10px 10px 2px', fontSize: 10 }}>
                    Capability vs. speed.
                  </div>
                </div>
              )}

              {m.id === 'thinking' && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  {[0, 1, 2].map((i) => (
                    <span
                      key={i}
                      className="think-dot"
                      style={{ width: 7, height: 7, borderRadius: '50%', background: COLORS.accentBright, animationDelay: `${i * 0.2}s` }}
                    />
                  ))}
                  <span style={{ fontSize: 10, color: COLORS.textMuted }}>reasoning…</span>
                </div>
              )}

              {m.id === 'agentic' && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  {TOOLS.map((t, i) => (
                    <div key={t.id} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                      <div
                        style={{
                          width: 22,
                          height: 22,
                          borderRadius: 6,
                          background: COLORS.surfaceRaised,
                          border: `1px solid ${COLORS.border}`,
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                        }}
                        title={t.label}
                      >
                        <t.Icon size={11} color={COLORS.accentBright} />
                      </div>
                      {i < TOOLS.length - 1 && (
                        <svg width="12" height="6" viewBox="0 0 14 8" aria-hidden="true">
                          <path className="tool-wire" d="M0 4 H14" />
                        </svg>
                      )}
                    </div>
                  ))}
                </div>
              )}

              {m.id === 'embedded' && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <div
                    style={{
                      padding: '4px 8px',
                      borderRadius: 6,
                      background: COLORS.surfaceRaised,
                      border: `1px solid ${COLORS.border}`,
                      fontSize: 9.5,
                      color: COLORS.textMuted,
                    }}
                  >
                    Your app
                  </div>
                  <span style={{ color: COLORS.textMuted, fontSize: 12 }}>+</span>
                  <div
                    className="embed-pulse"
                    style={{
                      width: 22,
                      height: 22,
                      borderRadius: '50%',
                      background: `linear-gradient(135deg, ${COLORS.accent}, ${COLORS.accentBright})`,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      color: '#fff',
                      fontSize: 8,
                      fontWeight: 800,
                    }}
                  >
                    AI
                  </div>
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
