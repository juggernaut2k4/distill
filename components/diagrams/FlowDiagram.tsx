'use client'

import { useEffect, useRef, useState } from 'react'
import { motion } from 'framer-motion'

export type NodeType = 'action' | 'data' | 'decision' | 'success' | 'error' | 'pending'
export type NodeShape = 'circle' | 'rect' | 'diamond'

export interface FlowNode {
  id: string
  label: string
  sublabel?: string
  type: NodeType
  shape?: NodeShape
  status?: 'pending' | 'active' | 'complete' | 'locked'
}

export interface FlowEdge {
  from: string
  to: string
  label?: string
  animated?: boolean
}

export interface FlowGroup {
  id: string
  label: string
  nodeIds: string[]
  color?: string
}

export interface FlowDiagramProps {
  nodes: FlowNode[]
  edges: FlowEdge[]
  groups?: FlowGroup[]
  layout?: 'horizontal' | 'vertical'
  className?: string
}

const NODE_COLORS: Record<NodeType, { bg: string; border: string; text: string; glow: string }> = {
  action:   { bg: 'rgba(124,58,237,0.15)',  border: '#7C3AED', text: '#C4B5FD', glow: 'rgba(124,58,237,0.4)' },
  data:     { bg: 'rgba(6,182,212,0.12)',   border: '#06B6D4', text: '#67E8F9', glow: 'rgba(6,182,212,0.35)' },
  decision: { bg: 'rgba(245,158,11,0.12)',  border: '#F59E0B', text: '#FCD34D', glow: 'rgba(245,158,11,0.35)' },
  success:  { bg: 'rgba(16,185,129,0.12)',  border: '#10B981', text: '#6EE7B7', glow: 'rgba(16,185,129,0.35)' },
  error:    { bg: 'rgba(239,68,68,0.12)',   border: '#EF4444', text: '#FCA5A5', glow: 'rgba(239,68,68,0.35)' },
  pending:  { bg: 'rgba(30,30,30,0.8)',     border: '#333333', text: '#475569', glow: 'transparent' },
}

const STATUS_OVERRIDES: Record<string, Partial<typeof NODE_COLORS['action']>> = {
  active:   { bg: 'rgba(6,182,212,0.2)', border: '#06B6D4' },
  complete: { bg: 'rgba(16,185,129,0.15)', border: '#10B981' },
  locked:   { bg: 'rgba(15,15,15,0.9)', border: '#222222' },
}

// Node dimensions
const NODE_W = 220
const NODE_H = 64
const H_GAP = 280
const V_GAP = 110
const GROUP_PAD = 20

export function FlowDiagram({
  nodes,
  edges,
  groups = [],
  layout = 'vertical',
  className = '',
}: FlowDiagramProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [mounted, setMounted] = useState(false)

  useEffect(() => setMounted(true), [])

  // Build position map
  const positions = computePositions(nodes, edges, layout)
  const positionValues = Object.values(positions)
  const svgWidth = positionValues.length > 0
    ? Math.max(...positionValues.map((p) => p.x + NODE_W)) + 60
    : 400
  const svgHeight = positionValues.length > 0
    ? Math.max(...positionValues.map((p) => p.y + NODE_H)) + 60
    : 300

  if (!mounted) return <div className={`w-full h-64 bg-[#080808] rounded-xl ${className}`} />

  return (
    <div
      ref={containerRef}
      className={`relative bg-[#080808] rounded-xl overflow-x-auto overflow-y-auto border border-[#1A1A1A] ${className}`}
    >
      <svg
        width={svgWidth}
        height={svgHeight}
        className="min-w-full"
        style={{ display: 'block' }}
      >
        {/* Grid dots background */}
        <defs>
          <pattern id="grid" width="32" height="32" patternUnits="userSpaceOnUse">
            <circle cx="1" cy="1" r="0.8" fill="#1A1A1A" />
          </pattern>
          {/* Animated dash pattern */}
          <marker id="arrow" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto">
            <path d="M0,0 L0,6 L8,3 z" fill="#333333" />
          </marker>
          <marker id="arrow-active" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto">
            <path d="M0,0 L0,6 L8,3 z" fill="#7C3AED" />
          </marker>
        </defs>
        <rect width="100%" height="100%" fill="url(#grid)" />

        {/* Group boxes */}
        {groups.map((group) => {
          const groupPositions = group.nodeIds
            .map((id) => positions[id])
            .filter(Boolean)
          if (groupPositions.length === 0) return null

          const minX = Math.min(...groupPositions.map((p) => p.x)) - GROUP_PAD
          const minY = Math.max(4, Math.min(...groupPositions.map((p) => p.y)) - GROUP_PAD - 24)
          const maxX = Math.max(...groupPositions.map((p) => p.x + NODE_W)) + GROUP_PAD
          const maxY = Math.max(...groupPositions.map((p) => p.y + NODE_H)) + GROUP_PAD

          return (
            <g key={group.id}>
              <rect
                x={minX}
                y={minY}
                width={maxX - minX}
                height={maxY - minY}
                rx={12}
                fill="rgba(124,58,237,0.04)"
                stroke={group.color ?? '#2D2D2D'}
                strokeWidth={1}
                strokeDasharray="4 4"
              />
              <text
                x={minX + 12}
                y={minY + 16}
                fill="#475569"
                fontSize={11}
                fontWeight={600}
                fontFamily="Inter, system-ui, sans-serif"
              >
                {group.label}
              </text>
            </g>
          )
        })}

        {/* Edges */}
        {edges.map((edge, i) => {
          const from = positions[edge.from]
          const to = positions[edge.to]
          if (!from || !to) return null

          const x1 = from.x + NODE_W / 2
          const y1 = from.y + NODE_H
          const x2 = to.x + NODE_W / 2
          const y2 = to.y
          const midY = (y1 + y2) / 2

          return (
            <g key={i}>
              <path
                d={`M ${x1} ${y1} C ${x1} ${midY}, ${x2} ${midY}, ${x2} ${y2}`}
                fill="none"
                stroke="#2D2D2D"
                strokeWidth={1.5}
                markerEnd="url(#arrow)"
              />
              {edge.animated && (
                <path
                  d={`M ${x1} ${y1} C ${x1} ${midY}, ${x2} ${midY}, ${x2} ${y2}`}
                  fill="none"
                  stroke="#7C3AED"
                  strokeWidth={2}
                  strokeDasharray="6 10"
                  markerEnd="url(#arrow-active)"
                  opacity={0.6}
                >
                  <animate
                    attributeName="stroke-dashoffset"
                    from="0"
                    to="-32"
                    dur="1.2s"
                    repeatCount="indefinite"
                  />
                </path>
              )}
              {edge.label && (
                <text
                  x={(x1 + x2) / 2 + 6}
                  y={midY}
                  fill="#475569"
                  fontSize={10}
                  fontFamily="Inter, system-ui, sans-serif"
                >
                  {edge.label}
                </text>
              )}
            </g>
          )
        })}

        {/* Nodes */}
        {nodes.map((node, idx) => {
          const pos = positions[node.id]
          if (!pos) return null

          const colors = { ...NODE_COLORS[node.type] }
          if (node.status && STATUS_OVERRIDES[node.status]) {
            Object.assign(colors, STATUS_OVERRIDES[node.status])
          }

          const cx = pos.x + NODE_W / 2
          const cy = pos.y + NODE_H / 2

          return (
            <motion.g
              key={node.id}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.4, delay: idx * 0.06 }}
            >
              {/* Glow effect for active nodes */}
              {node.status === 'active' && (
                <ellipse
                  cx={cx}
                  cy={cy}
                  rx={NODE_W / 2 + 8}
                  ry={NODE_H / 2 + 8}
                  fill={colors.glow}
                  opacity={0.4}
                >
                  <animate
                    attributeName="opacity"
                    values="0.2;0.5;0.2"
                    dur="2s"
                    repeatCount="indefinite"
                  />
                </ellipse>
              )}

              {/* Node body */}
              <rect
                x={pos.x}
                y={pos.y}
                width={NODE_W}
                height={NODE_H}
                rx={node.shape === 'circle' ? NODE_H / 2 : 10}
                fill={colors.bg}
                stroke={colors.border}
                strokeWidth={node.status === 'active' ? 2 : 1}
              />

              {/* Label — 2-line wrap if > 22 chars */}
              {(() => {
                const lines = wrapLabel(node.label, 22)
                const hasTwo = lines.length === 2
                const hasSublabel = !!node.sublabel
                // vertical centering: shift text block up when multiple lines
                const baseY = hasSublabel
                  ? cy - (hasTwo ? 14 : 8)
                  : cy + (hasTwo ? -6 : 5)
                return (
                  <text
                    x={cx}
                    textAnchor="middle"
                    fill={colors.text}
                    fontSize={12}
                    fontWeight={600}
                    fontFamily="Inter, system-ui, sans-serif"
                  >
                    {lines.map((line, li) => (
                      <tspan key={li} x={cx} dy={li === 0 ? baseY - cy + 'px' : '1.3em'} y={li === 0 ? baseY : undefined}>
                        {line}
                      </tspan>
                    ))}
                  </text>
                )
              })()}

              {/* Sublabel */}
              {node.sublabel && (
                <text
                  x={cx}
                  y={cy + (wrapLabel(node.label, 22).length === 2 ? 18 : 10)}
                  textAnchor="middle"
                  fill="#475569"
                  fontSize={10}
                  fontFamily="Inter, system-ui, sans-serif"
                >
                  {node.sublabel.length > 22 ? node.sublabel.slice(0, 21) + '…' : node.sublabel}
                </text>
              )}

              {/* Status dot */}
              {node.status && (
                <circle
                  cx={pos.x + NODE_W - 10}
                  cy={pos.y + 10}
                  r={5}
                  fill={
                    node.status === 'complete' ? '#10B981'
                    : node.status === 'active' ? '#06B6D4'
                    : node.status === 'locked' ? '#333'
                    : '#F59E0B'
                  }
                />
              )}
            </motion.g>
          )
        })}
      </svg>
    </div>
  )
}

// ─── Layout engine ─────────────────────────────────────────────────────────────

function computePositions(
  nodes: FlowNode[],
  edges: FlowEdge[],
  layout: 'horizontal' | 'vertical'
): Record<string, { x: number; y: number }> {
  // Build adjacency for topological level assignment
  const inDegree: Record<string, number> = {}
  const adj: Record<string, string[]> = {}

  for (const n of nodes) {
    inDegree[n.id] = 0
    adj[n.id] = []
  }

  for (const e of edges) {
    if (adj[e.from]) adj[e.from].push(e.to)
    if (e.to in inDegree) inDegree[e.to]++
  }

  // Kahn's algorithm for level assignment
  const levels: string[][] = []
  const queue = nodes.filter((n) => inDegree[n.id] === 0).map((n) => n.id)

  while (queue.length > 0) {
    const level: string[] = []
    const next: string[] = []

    for (const id of queue) {
      level.push(id)
      for (const child of (adj[id] ?? [])) {
        inDegree[child]--
        if (inDegree[child] === 0) next.push(child)
      }
    }

    if (level.length > 0) levels.push(level)
    queue.length = 0
    queue.push(...next)
  }

  // Assign any remaining nodes (cycles)
  const placed = new Set(levels.flat())
  const remaining = nodes.filter((n) => !placed.has(n.id)).map((n) => n.id)
  if (remaining.length > 0) levels.push(remaining)

  const positions: Record<string, { x: number; y: number }> = {}
  const MARGIN = 70

  if (layout === 'vertical') {
    // Compute max level width for centering
    const maxLevelWidth = Math.max(...levels.map(
      (l) => l.length * NODE_W + (l.length - 1) * (H_GAP - NODE_W)
    ))

    for (let li = 0; li < levels.length; li++) {
      const level = levels[li]
      const totalWidth = level.length * NODE_W + (level.length - 1) * (H_GAP - NODE_W)
      const startX = MARGIN + Math.max(0, (maxLevelWidth - totalWidth) / 2)

      for (let ni = 0; ni < level.length; ni++) {
        positions[level[ni]] = {
          x: startX + ni * H_GAP,
          y: MARGIN + li * (NODE_H + V_GAP),
        }
      }
    }
  } else {
    for (let li = 0; li < levels.length; li++) {
      const level = levels[li]
      const totalHeight = level.length * NODE_H + (level.length - 1) * (V_GAP - NODE_H)
      const startY = MARGIN + Math.max(0, (400 - totalHeight) / 2)

      for (let ni = 0; ni < level.length; ni++) {
        positions[level[ni]] = {
          x: MARGIN + li * H_GAP,
          y: startY + ni * (NODE_H + V_GAP / 2),
        }
      }
    }
  }

  return positions
}

/**
 * Wraps a label into 1 or 2 lines at word boundaries.
 * If label fits within maxChars, returns single-element array.
 * Otherwise splits at last word boundary ≤ maxChars.
 */
function wrapLabel(str: string, maxChars: number): [string] | [string, string] {
  if (str.length <= maxChars) return [str]

  // Find last space at or before maxChars
  const breakAt = str.lastIndexOf(' ', maxChars)
  if (breakAt <= 0) {
    // No space found — hard-split
    return [str.slice(0, maxChars), str.slice(maxChars)]
  }
  const line1 = str.slice(0, breakAt)
  const line2 = str.slice(breakAt + 1).slice(0, maxChars)
  return [line1, line2]
}
