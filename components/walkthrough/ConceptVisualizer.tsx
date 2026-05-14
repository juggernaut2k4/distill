'use client'

import { useMemo } from 'react'
import { motion } from 'framer-motion'
import type { VisualSpec, VisualNode, VisualEdge, VisualScenario } from '@/lib/session-ai'

interface ConceptVisualizerProps {
  spec: VisualSpec
  containerWidth: number
  containerHeight: number
  animationPhase: 'intro' | 'explaining' | 'static'
}

// ─── TYPOGRAPHY SCALING ────────────────────────────────────────────────────────

function getScale(containerWidth: number) {
  if (containerWidth > 1200) {
    return { title: 64, subtitle: 20, nodeLabel: 14, nodeSublabel: 11, summary: 20, badge: 13, caption: 13, summaryLine: 14 }
  }
  if (containerWidth >= 768) {
    return { title: 48, subtitle: 16, nodeLabel: 12, nodeSublabel: 10, summary: 16, badge: 11, caption: 11, summaryLine: 12 }
  }
  return { title: 32, subtitle: 13, nodeLabel: 10, nodeSublabel: 9, summary: 13, badge: 10, caption: 10, summaryLine: 11 }
}

// ─── BADGE COLOR MAP ──────────────────────────────────────────────────────────

const BADGE_COLORS: Record<string, { bg: string; text: string; border: string }> = {
  red:    { bg: 'rgba(239,68,68,0.15)',   text: '#EF4444', border: 'rgba(239,68,68,0.4)' },
  green:  { bg: 'rgba(16,185,129,0.15)',  text: '#10B981', border: 'rgba(16,185,129,0.4)' },
  cyan:   { bg: 'rgba(6,182,212,0.15)',   text: '#06B6D4', border: 'rgba(6,182,212,0.4)' },
  amber:  { bg: 'rgba(245,158,11,0.15)',  text: '#F59E0B', border: 'rgba(245,158,11,0.4)' },
  purple: { bg: 'rgba(124,58,237,0.15)',  text: '#A855F7', border: 'rgba(124,58,237,0.4)' },
}

// ─── NODE TYPE COLORS ─────────────────────────────────────────────────────────

const NODE_COLORS: Record<string, { border: string; glow: string; icon: string }> = {
  source:      { border: '#7C3AED', glow: 'rgba(124,58,237,0.3)',  icon: '#A855F7' },
  processor:   { border: '#06B6D4', glow: 'rgba(6,182,212,0.3)',   icon: '#67E8F9' },
  destination: { border: '#10B981', glow: 'rgba(16,185,129,0.3)',  icon: '#34D399' },
  store:       { border: '#F59E0B', glow: 'rgba(245,158,11,0.3)',  icon: '#FCD34D' },
  outcome:     { border: '#A855F7', glow: 'rgba(168,85,247,0.3)',  icon: '#C084FC' },
}

// ─── FLOW NODE ────────────────────────────────────────────────────────────────

interface NodeProps {
  node: VisualNode
  x: number
  y: number
  scale: ReturnType<typeof getScale>
  delay: number
}

function FlowNode({ node, x, y, scale, delay }: NodeProps) {
  const colors = NODE_COLORS[node.type] ?? NODE_COLORS.processor
  const isHighlighted = node.highlight ?? false

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.7 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ delay, duration: 0.4, ease: 'backOut' }}
      style={{
        position: 'absolute',
        left: x,
        top: y,
        transform: 'translate(-50%, -50%)',
        zIndex: 10,
      }}
    >
      <div
        style={{
          minWidth: scale.nodeLabel < 12 ? 72 : 96,
          padding: '10px 16px',
          background: '#111111',
          border: `2px solid ${colors.border}`,
          borderRadius: 12,
          boxShadow: isHighlighted
            ? `0 0 0 3px ${colors.glow}, 0 0 20px ${colors.glow}`
            : `0 0 12px ${colors.glow}`,
          textAlign: 'center',
        }}
      >
        <div
          style={{
            fontSize: scale.nodeLabel,
            fontWeight: 600,
            color: '#FFFFFF',
            lineHeight: 1.2,
          }}
        >
          {node.label}
        </div>
        {node.sublabel && (
          <div
            style={{
              fontSize: scale.nodeSublabel,
              color: colors.icon,
              marginTop: 2,
              lineHeight: 1.2,
            }}
          >
            {node.sublabel}
          </div>
        )}
      </div>
    </motion.div>
  )
}

// ─── ANIMATED EDGE (SVG) ──────────────────────────────────────────────────────

interface EdgeProps {
  edge: VisualEdge
  fromPos: { x: number; y: number }
  toPos: { x: number; y: number }
  delay: number
}

function AnimatedEdge({ edge, fromPos, toPos, delay }: EdgeProps) {
  const color = edge.color ?? '#7C3AED'

  // Straight path between centers
  const dx = toPos.x - fromPos.x
  const dy = toPos.y - fromPos.y
  const length = Math.sqrt(dx * dx + dy * dy)

  // Offset so arrow starts/ends at node edge (approximate 50px half-width)
  const offset = 54
  const ratio = offset / length
  const sx = fromPos.x + dx * ratio
  const sy = fromPos.y + dy * ratio
  const ex = toPos.x - dx * ratio
  const ey = toPos.y - dy * ratio

  const pathD = `M ${sx} ${sy} L ${ex} ${ey}`

  // Midpoint for label
  const mx = (sx + ex) / 2
  const my = (sy + ey) / 2

  return (
    <g>
      {/* Base line */}
      <motion.path
        d={pathD}
        stroke={color}
        strokeWidth={edge.style === 'dashed' ? 1.5 : 2}
        strokeDasharray={edge.style === 'dashed' ? '6 4' : undefined}
        fill="none"
        opacity={0.6}
        initial={{ pathLength: 0, opacity: 0 }}
        animate={{ pathLength: 1, opacity: 0.6 }}
        transition={{ delay, duration: 0.6, ease: 'easeInOut' }}
      />

      {/* Arrow head */}
      <motion.path
        d={`M ${ex - 8 * (dx / length) + 5 * (dy / length)} ${ey - 8 * (dy / length) - 5 * (dx / length)}
            L ${ex} ${ey}
            L ${ex - 8 * (dx / length) - 5 * (dy / length)} ${ey - 8 * (dy / length) + 5 * (dx / length)}`}
        stroke={color}
        strokeWidth={2}
        fill="none"
        opacity={0.8}
        initial={{ opacity: 0 }}
        animate={{ opacity: 0.8 }}
        transition={{ delay: delay + 0.5 }}
      />

      {/* Animated traveling dot */}
      {edge.animated && (
        <motion.circle
          r={4}
          fill={color}
          filter="url(#dot-glow)"
          initial={{ offsetDistance: '0%', opacity: 0 }}
          animate={{ offsetDistance: ['0%', '100%'], opacity: [0, 1, 1, 0] }}
          transition={{
            offsetDistance: { delay: delay + 0.8, duration: 1.8, repeat: Infinity, ease: 'linear' },
            opacity: { delay: delay + 0.8, duration: 1.8, repeat: Infinity },
          }}
          style={{ offsetPath: `path("${pathD}")` } as React.CSSProperties}
        />
      )}

      {/* Edge label */}
      {edge.label && (
        <motion.text
          x={mx}
          y={my - 8}
          textAnchor="middle"
          fill={color}
          fontSize={10}
          opacity={0}
          animate={{ opacity: 0.7 }}
          transition={{ delay: delay + 0.7 }}
        >
          {edge.label}
        </motion.text>
      )}
    </g>
  )
}

// ─── SCENARIO BLOCK ───────────────────────────────────────────────────────────

interface ScenarioProps {
  scenario: VisualScenario
  containerWidth: number
  diagramHeight: number
  scale: ReturnType<typeof getScale>
  globalDelay: number
}

function ScenarioBlock({ scenario, containerWidth, diagramHeight, scale, globalDelay }: ScenarioProps) {
  const badge = BADGE_COLORS[scenario.badgeColor] ?? BADGE_COLORS.cyan

  // Compute absolute pixel positions from percentage positions
  const nodePositions = useMemo(() => {
    const map: Record<string, { x: number; y: number }> = {}
    for (const node of scenario.nodes) {
      map[node.id] = {
        x: (node.position.x / 100) * containerWidth,
        y: (node.position.y / 100) * diagramHeight,
      }
    }
    return map
  }, [scenario.nodes, containerWidth, diagramHeight])

  return (
    <div style={{ width: '100%', marginBottom: 8 }}>
      {/* Badge pill */}
      <motion.div
        initial={{ opacity: 0, y: -8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: globalDelay, duration: 0.3 }}
        style={{ display: 'flex', justifyContent: 'center', marginBottom: 12 }}
      >
        <div
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            padding: '4px 16px',
            borderRadius: 9999,
            background: badge.bg,
            border: `1px solid ${badge.border}`,
            color: badge.text,
            fontSize: scale.badge,
            fontWeight: 700,
            letterSpacing: '0.04em',
            textTransform: 'uppercase',
          }}
        >
          {scenario.badge}
        </div>
      </motion.div>

      {/* Flow diagram area */}
      <div style={{ position: 'relative', height: diagramHeight, width: '100%', overflow: 'hidden' }}>
        {/* SVG layer for edges */}
        <svg
          style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', overflow: 'visible', zIndex: 1 }}
        >
          <defs>
            <filter id="dot-glow" x="-50%" y="-50%" width="200%" height="200%">
              <feGaussianBlur stdDeviation="2" result="blur" />
              <feMerge>
                <feMergeNode in="blur" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
          </defs>
          {scenario.edges.map((edge, i) => {
            const fromPos = nodePositions[edge.from]
            const toPos = nodePositions[edge.to]
            if (!fromPos || !toPos) return null
            return (
              <AnimatedEdge
                key={`${edge.from}-${edge.to}`}
                edge={edge}
                fromPos={fromPos}
                toPos={toPos}
                delay={globalDelay + 0.3 + i * 0.15}
              />
            )
          })}
        </svg>

        {/* Node layer */}
        {scenario.nodes.map((node, i) => {
          const pos = nodePositions[node.id]
          if (!pos) return null
          return (
            <FlowNode
              key={node.id}
              node={node}
              x={pos.x}
              y={pos.y}
              scale={scale}
              delay={globalDelay + 0.15 + i * 0.12}
            />
          )
        })}
      </div>

      {/* Caption */}
      {scenario.caption && (
        <motion.p
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: globalDelay + 0.6 }}
          style={{
            textAlign: 'center',
            color: '#475569',
            fontSize: scale.caption,
            marginBottom: 12,
            fontStyle: 'italic',
          }}
        >
          {scenario.caption}
        </motion.p>
      )}

      {/* Summary cards */}
      <div style={{ display: 'flex', gap: 12, justifyContent: 'center', marginBottom: 10 }}>
        {scenario.summaryCards.map((card, i) => (
          <motion.div
            key={card.heading}
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: globalDelay + 0.8 + i * 0.1, duration: 0.4 }}
            style={{
              flex: 1,
              maxWidth: 200,
              background: '#111111',
              border: '1px solid #222222',
              borderRadius: 10,
              padding: '10px 14px',
            }}
          >
            <div
              style={{
                fontSize: scale.caption,
                fontWeight: 700,
                color: card.headingColor,
                letterSpacing: '0.06em',
                textTransform: 'uppercase',
                marginBottom: 4,
              }}
            >
              {card.heading}
            </div>
            <div style={{ fontSize: scale.summary, fontWeight: 600, color: '#FFFFFF', lineHeight: 1.3 }}>
              {card.value}
            </div>
          </motion.div>
        ))}
      </div>

      {/* Summary line */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: globalDelay + 1.1 }}
        style={{
          background: '#0D0D0D',
          border: '1px solid #1E1E1E',
          borderRadius: 8,
          padding: '8px 16px',
          textAlign: 'center',
        }}
      >
        <span style={{ color: '#94A3B8', fontSize: scale.summaryLine, lineHeight: 1.5 }}>
          {scenario.summaryLine}
        </span>
      </motion.div>
    </div>
  )
}

// ─── MAIN COMPONENT ───────────────────────────────────────────────────────────

export default function ConceptVisualizer({
  spec,
  containerWidth,
  containerHeight,
  animationPhase,
}: ConceptVisualizerProps) {
  const scale = getScale(containerWidth)
  const scenarios = spec.scenarios ?? []

  // Calculate how to split vertical space
  const headerHeight = Math.round(containerHeight * 0.14)
  const remainingHeight = containerHeight - headerHeight - 16
  const scenarioCount = Math.max(1, Math.min(scenarios.length, 2))
  // Each scenario gets: badge + diagram + caption + summary cards + summary line
  // Diagram gets ~40% of each scenario's vertical slice
  const scenarioSliceHeight = Math.floor(remainingHeight / scenarioCount)
  const diagramHeight = Math.floor(scenarioSliceHeight * 0.38)

  // Highlight the titleHighlight word in the title
  function renderTitle(title: string, highlight: string) {
    if (!highlight) return <span>{title}</span>
    const idx = title.toLowerCase().indexOf(highlight.toLowerCase())
    if (idx === -1) return <span>{title}</span>
    return (
      <>
        {title.slice(0, idx)}
        <span
          style={{
            background: 'linear-gradient(135deg, #7C3AED 0%, #06B6D4 100%)',
            WebkitBackgroundClip: 'text',
            WebkitTextFillColor: 'transparent',
            backgroundClip: 'text',
          }}
        >
          {title.slice(idx, idx + highlight.length)}
        </span>
        {title.slice(idx + highlight.length)}
      </>
    )
  }

  return (
    <div
      style={{
        width: containerWidth,
        height: containerHeight,
        background: '#080808',
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'column',
        padding: '20px 40px 16px',
        boxSizing: 'border-box',
        fontFamily: 'Inter, system-ui, -apple-system, sans-serif',
      }}
    >
      {/* Header: title + subtitle */}
      <div
        style={{
          flexShrink: 0,
          height: headerHeight,
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          textAlign: 'center',
          marginBottom: 8,
        }}
      >
        <motion.h1
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
          style={{
            fontSize: scale.title,
            fontWeight: 800,
            color: '#FFFFFF',
            letterSpacing: '-0.02em',
            lineHeight: 1.1,
            margin: 0,
          }}
        >
          {renderTitle(spec.title, spec.titleHighlight)}
        </motion.h1>
        <motion.p
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.3, duration: 0.4 }}
          style={{
            fontSize: scale.subtitle,
            color: '#94A3B8',
            marginTop: 6,
            margin: '6px 0 0',
          }}
        >
          {spec.subtitle}
        </motion.p>
      </div>

      {/* Scenarios */}
      <div
        style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          gap: 8,
          overflow: 'hidden',
          minHeight: 0,
        }}
      >
        {scenarios.slice(0, 2).map((scenario, idx) => (
          <div
            key={scenario.id}
            style={{
              flex: 1,
              minHeight: 0,
              overflow: 'hidden',
              display: 'flex',
              flexDirection: 'column',
            }}
          >
            <ScenarioBlock
              scenario={scenario}
              containerWidth={containerWidth - 80} // account for padding
              diagramHeight={diagramHeight}
              scale={scale}
              globalDelay={animationPhase === 'static' ? 0 : idx * 1.4}
            />
          </div>
        ))}
      </div>
    </div>
  )
}
