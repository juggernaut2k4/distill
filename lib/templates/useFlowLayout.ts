'use client'

import { useMemo } from 'react'
import type { Node, Edge } from '@xyflow/react'
import dagre from '@dagrejs/dagre'

export type Direction = 'TB' | 'LR' | 'BT' | 'RL'

interface LayoutOptions {
  direction?: Direction
  nodeWidth?: number
  nodeHeight?: number
  rankSep?: number
  nodeSep?: number
}

/**
 * Applies dagre auto-layout to React Flow nodes and edges.
 * Guarantees no overlap and consistent spacing.
 */
export function useFlowLayout(
  nodes: Node[],
  edges: Edge[],
  options: LayoutOptions = {}
): { nodes: Node[]; edges: Edge[] } {
  return useMemo(() => {
    const {
      direction = 'TB',
      nodeWidth = 220,
      nodeHeight = 80,
      rankSep = 60,
      nodeSep = 40,
    } = options

    const g = new dagre.graphlib.Graph()
    g.setDefaultEdgeLabel(() => ({}))
    g.setGraph({ rankdir: direction, ranksep: rankSep, nodesep: nodeSep })

    nodes.forEach((n) => {
      g.setNode(n.id, { width: n.width ?? nodeWidth, height: n.height ?? nodeHeight })
    })
    edges.forEach((e) => g.setEdge(e.source, e.target))

    dagre.layout(g)

    const laid = nodes.map((n) => {
      const pos = g.node(n.id)
      const w = n.width ?? nodeWidth
      const h = n.height ?? nodeHeight
      return { ...n, position: { x: pos.x - w / 2, y: pos.y - h / 2 } }
    })

    return { nodes: laid, edges }
  }, [nodes, edges, options])
}
