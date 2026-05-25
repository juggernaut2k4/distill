'use client'

import { useCallback, useMemo } from 'react'
import { ReactFlow, Background, useNodesState, useEdgesState, type Node, type Edge, type NodeProps, Handle, Position, MarkerType, BackgroundVariant } from '@xyflow/react'
import { motion } from 'framer-motion'
import type { HierarchyData, HierarchyNode } from '@/lib/templates/types'
import { useFlowLayout } from '@/lib/templates/useFlowLayout'
import '@xyflow/react/dist/style.css'

const LEVEL_COLORS = ['#7C3AED', '#06B6D4', '#10B981', '#F59E0B', '#EF4444']

function HierarchyNodeComp({ data }: NodeProps) {
  const d = data as { label: string; detail?: string; level: number }
  const color = LEVEL_COLORS[Math.min(d.level, LEVEL_COLORS.length - 1)]
  return (
    <div style={{ borderColor: color + (d.level === 0 ? 'ff' : '60'), background: d.level === 0 ? color + '20' : '#111111' }} className="rounded-xl border-2 p-3 text-center min-w-[140px] max-w-[200px] shadow-md">
      <Handle type="target" position={Position.Top} style={{ background: color, border: 'none' }} />
      <Handle type="source" position={Position.Bottom} style={{ background: color, border: 'none' }} />
      <div className="text-white font-semibold text-sm leading-tight mb-1">{d.label}</div>
      {d.detail && <div className="text-[#475569] text-xs leading-snug">{d.detail}</div>}
    </div>
  )
}

const nodeTypes = { hierarchyNode: HierarchyNodeComp }

function flattenTree(node: HierarchyNode, parentId: string | null, level: number, nodes: Node[], edges: Edge[], counter: { n: number }) {
  const id = `n${counter.n++}`
  const label = node.label
  nodes.push({ id, type: 'hierarchyNode', position: { x: 0, y: 0 }, data: { label, detail: node.detail, level }, width: 180, height: node.detail ? 80 : 55, draggable: false })
  if (parentId) {
    const color = LEVEL_COLORS[Math.min(level - 1, LEVEL_COLORS.length - 1)]
    edges.push({ id: `e-${parentId}-${id}`, source: parentId, target: id, markerEnd: { type: MarkerType.ArrowClosed, color }, style: { stroke: color + '60', strokeWidth: 2 } })
  }
  node.children?.forEach((child) => flattenTree(child, id, level + 1, nodes, edges, counter))
  return id
}

interface HierarchyProps { data: HierarchyData; isActive: boolean; onReady?: () => void }

export default function Hierarchy({ data, isActive, onReady }: HierarchyProps) {
  const { rawNodes, rawEdges } = useMemo(() => {
    const nodes: Node[] = []
    const edges: Edge[] = []
    flattenTree(data.root, null, 0, nodes, edges, { n: 0 })
    return { rawNodes: nodes, rawEdges: edges }
  }, [data.root])

  const { nodes: layoutNodes, edges: layoutEdges } = useFlowLayout(rawNodes, rawEdges, { direction: 'TB', rankSep: 70, nodeSep: 30 })
  const [nodes, , onNodesChange] = useNodesState(layoutNodes)
  const [edges, , onEdgesChange] = useEdgesState(layoutEdges)
  const onInit = useCallback(() => { if (isActive) onReady?.() }, [isActive, onReady])

  return (
    <div className="h-full w-full flex flex-col bg-[#080808] px-8 md:px-16 py-12">
      <motion.div className="flex-1 flex flex-col pb-20" initial={{ opacity: 0, y: 20 }} animate={isActive ? { opacity: 1, y: 0 } : { opacity: 0, y: 20 }} transition={{ duration: 0.5 }} onAnimationComplete={() => { if (isActive) onReady?.() }}>
        <div className="mb-6">
          <h2 className="text-3xl font-bold text-white mb-1">{data.title}</h2>
          <p className="text-[#94A3B8] text-sm">{data.context}</p>
        </div>
        <div className="flex-1 rounded-2xl overflow-hidden border border-[#1a1a1a]">
          <ReactFlow nodes={nodes} edges={edges} onNodesChange={onNodesChange} onEdgesChange={onEdgesChange} nodeTypes={nodeTypes} onInit={onInit} fitView fitViewOptions={{ padding: 0.15 }} nodesDraggable={false} nodesConnectable={false} elementsSelectable={false} proOptions={{ hideAttribution: true }} style={{ width: '100%', height: '100%' }}>
            <Background color="#1a1a1a" variant={BackgroundVariant.Dots} gap={20} />
          </ReactFlow>
        </div>
      </motion.div>
      <motion.div initial={{ opacity: 0, y: 20 }} animate={isActive ? { opacity: 1, y: 0 } : { opacity: 0, y: 20 }} transition={{ delay: 0.6, duration: 0.4 }} className="absolute bottom-0 left-0 right-0 bg-[#7C3AED]/20 border-t border-[#7C3AED]/30 px-8 py-4 flex items-center gap-3">
        <span className="text-sm font-semibold text-[#A855F7] shrink-0">So what?</span>
        <span className="text-sm text-white">{data.so_what}</span>
      </motion.div>
    </div>
  )
}
