'use client'

import type { CSSProperties } from 'react'
import {
  Type,
  Image as ImageIcon,
  Code2,
  FileText,
  MessageCircle,
  PenLine,
  MessagesSquare,
  Zap,
  Sparkles,
  ScrollText,
  Layers,
  Bot,
  Pencil,
  ScanSearch,
  RotateCw,
} from 'lucide-react'
import { COLORS } from '../../../_styles'

const HIGHLIGHTS = [
  {
    id: 'constitutional',
    label: 'Constitutional AI',
    desc: 'Claude critiques its own draft answers against a written set of principles, then revises them — training on self-correction, not just human-labeled examples.',
    Icon: ScrollText,
  },
  {
    id: 'multimodal',
    label: 'Multi-modal',
    desc: 'Reads and reasons over text, images, code, and documents in a single request — real, mixed material, not just plain text.',
    Icon: Layers,
  },
  {
    id: 'agentic',
    label: 'Agentic',
    desc: "Doesn't just answer — it can plan a sequence of steps, use tools, and carry out multi-step work on its own.",
    Icon: Bot,
  },
]

const TRAINING_STEPS = [
  { id: 'draft', label: 'Draft', desc: 'Claude generates an initial response to a prompt.', Icon: Pencil },
  { id: 'critique', label: 'Critique', desc: 'Claude checks its own draft against a written "constitution" of principles.', Icon: ScanSearch },
  { id: 'revise', label: 'Revise', desc: 'Claude rewrites the response to better fit those principles.', Icon: RotateCw },
]

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

const sectionHeadingStyle: CSSProperties = {
  fontSize: 16,
  fontWeight: 700,
  color: COLORS.textPrimary,
  margin: '0 0 4px 0',
}

const sectionLeadStyle: CSSProperties = {
  fontSize: 13.5,
  color: COLORS.textMuted,
  margin: '0 0 18px 0',
}

/** Static infographic: overview → highlights → how Claude is trained → what it can do. */
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
        .loop-arrow {
          stroke: ${COLORS.accentBright};
          stroke-width: 2;
          stroke-dasharray: 1 8;
          stroke-linecap: round;
          fill: none;
          animation: dash-flow 0.9s linear infinite;
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

      {/* Overview line */}
      <p style={{ fontSize: 15, color: COLORS.textSecondary, lineHeight: 1.6, margin: '0 0 24px 0', maxWidth: 640 }}>
        Claude is Anthropic&apos;s family of AI models, trained with <strong style={{ color: COLORS.textPrimary }}>Constitutional AI</strong> —
        a method that teaches the model to critique and improve its own answers against a written set of principles — and built to work
        across text, code, images, and documents.
      </p>

      {/* Highlight cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 200px), 1fr))', gap: 14, marginBottom: 32 }}>
        {HIGHLIGHTS.map((h) => (
          <div
            key={h.id}
            style={{
              background: COLORS.surface,
              border: `1px solid ${COLORS.border}`,
              borderRadius: 12,
              padding: 16,
            }}
          >
            <div
              className="item-icon"
              style={{ width: 36, height: 36, borderRadius: 9, display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 10 }}
            >
              <h.Icon size={17} color={COLORS.accentBright} />
            </div>
            <div style={{ fontSize: 14, fontWeight: 700, color: COLORS.textPrimary, marginBottom: 4 }}>{h.label}</div>
            <div style={{ fontSize: 12.5, color: COLORS.textMuted, lineHeight: 1.5 }}>{h.desc}</div>
          </div>
        ))}
      </div>

      {/* How Claude is trained */}
      <h3 style={sectionHeadingStyle}>How Claude is trained</h3>
      <p style={sectionLeadStyle}>Constitutional AI, in three steps — repeated at scale during training.</p>

      <div
        style={{
          background: COLORS.surface,
          border: `1px solid ${COLORS.border}`,
          borderRadius: 14,
          padding: 'clamp(20px, 4vw, 32px)',
          marginBottom: 32,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'center', gap: 0, flexWrap: 'wrap' }}>
          {TRAINING_STEPS.map((step, i) => (
            <div key={step.id} style={{ display: 'flex', alignItems: 'center' }}>
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', width: 140, textAlign: 'center' as const }}>
                <div
                  style={{
                    width: 52,
                    height: 52,
                    borderRadius: '50%',
                    background: `linear-gradient(135deg, ${COLORS.accent}, ${COLORS.accentBright})`,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: '#fff',
                    marginBottom: 10,
                  }}
                >
                  <step.Icon size={22} />
                </div>
                <div style={{ fontSize: 13.5, fontWeight: 700, color: COLORS.textPrimary }}>{step.label}</div>
                <div style={{ fontSize: 11.5, color: COLORS.textMuted, marginTop: 4, lineHeight: 1.4 }}>{step.desc}</div>
              </div>
              {i < TRAINING_STEPS.length - 1 && (
                <svg width="40" height="20" viewBox="0 0 40 20" style={{ marginTop: -40, flexShrink: 0 }} aria-hidden="true">
                  <path className="loop-arrow" d="M2 10 H36" />
                  <path d="M30 5 L37 10 L30 15" fill="none" stroke={COLORS.accentBright} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              )}
            </div>
          ))}
        </div>
        <p style={{ fontSize: 12.5, color: COLORS.textMuted, lineHeight: 1.6, marginTop: 20, paddingTop: 16, borderTop: `1px solid ${COLORS.border}` }}>
          Because an AI model does much of this evaluation, it&apos;s sometimes called{' '}
          <strong style={{ color: COLORS.textSecondary }}>Reinforcement Learning from AI Feedback (RLAIF)</strong> — it keeps human reviewers
          from having to read harmful content just to label it, and makes Claude&apos;s values explicit and inspectable instead of buried in
          scattered examples.
        </p>
      </div>

      {/* What Claude can do */}
      <h3 style={sectionHeadingStyle}>What Claude can do</h3>
      <p style={sectionLeadStyle}>The same model, working with many kinds of input and producing many kinds of output.</p>

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
