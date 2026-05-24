'use client'

import { useCallback, useMemo } from 'react'
import { ReactFlow, Background, useNodesState, useEdgesState, type Node, type Edge, type NodeProps, Handle, Position, BackgroundVariant } from '@xyflow/react'
import { motion } from 'framer-motion'
import type { ConceptMapData } from '@/lib/templates/types'
import '@xyflow/react/dist/style.css'

function CentralNode({ data }: NodeProps) {
  const d = data as { label: string }
  return (
    <div className="w-[180px] h-[180px] rounded-full bg-[#7C3AED] flex items-center justify-center shadow-2xl shadow-purple-900/40">
      <Handle type="source" position={Position.Right} style={{ opacity: 0 }} />
      <Handle type="source" position={Position.Left} style={{ opacity: 0 }} />
      <Handle type="source" position={Position.Top} style={{ opacity: 0 }} />
      <Handle type="source" position={Position.Bottom} style={{ opacity: 0 }} />
      <span className="text-white font-bold text-sm text-center px-4 leading-snug">{d.label}</span>
    </div>
  )
}

function BranchNode({ data }: NodeProps) {
  const d = data as { label: string; relationship: string; color: string }
  return (
    <div style={{ borderColor: d.color }} className="w-[180px] rounded-xl border-2 bg-[#111111] p-3 shadow-md">
      <Handle type="target" position={Position.Left} style={{ background: d.color, border: 'none' }} />
      <Handle type="target" position={Position.Right} style={{ background: d.color, border: 'none' }} />
      <Handle type="target" position={Position.Top} style={{ background: d.color, border: 'none' }} />
      <Handle type="target" position={Position.Bottom} style={{ background: d.color, border: 'none' }} />
      <Handle type="source" position={Position.Right} style={{ opacity: 0 }} />
      <div className="text-xs font-semibold uppercase tracking-widest mb-1" style={{ color: d.color }}>{d.relationship}</div>
      <div className="text-white text-sm font-medium leading-tight">{d.label}</div>
    </div>
  )
}

function LeafNode({ data }: NodeProps) {
  const d = data as { label: string; note?: string; color: string }
  return (
    <div style={{ borderColor: d.color + '60' }} className="w-[160px] rounded-lg border bg-[#0d0d0d] p-3">
      <Handle type="target" position={Position.Left} style={{ background: d.color, border: 'none' }} />
      <Handle type="target" position={Position.Top} style={{ background: d.color, border: 'none' }} />
      <div className="text-white text-xs font-medium mb-1">{d.label}</div>
      {d.note && <div className="text-[#475569] text-xs leading-relaxed">{d.note}</div>}
    </div>
  )
}

const BRANCH_COLORS = ['#7C3AED', '#06B6D4', '#F59E0B', '#10B981', '#EF4444', '#8B5CF6']
const nodeTypes = { central: CentralNode, branch: BranchNode, leaf: LeafNode }

interface ConceptMapProps { data: ConceptMapData; isActive: boolean; onReady?: () => void }

export default function ConceptMap({ data, isActive, onReady }: ConceptMapProps) {
  const { nodes: initialNodes, edges: initialEdges } = useMemo(() => {
    const nodes: Node[] = []
    const edges: Edge[] = []

    nodes.push({ id: 'center', type: 'central', position: { x: 0, y: 0 }, data: { label: data.central_concept }, width: 180, height: 180, draggable: false })

    const count = data.nodes.length
    data.nodes.forEach((n, i) => {
      const angle = (2 * Math.PI * i) / count - Math.PI / 2
      const radius = 320
      const color = BRANCH_COLORS[i % BRANCH_COLORS.length]
      const x = Math.cos(angle) * radius
      const y = Math.sin(angle) * radius

      nodes.push({ id: n.id, type: 'branch', position: { x: x - 90, y: y - 40 }, data: { ...n, color }, width: 180, height: 80, draggable: false })
      edges.push({ id: `c-${n.id}`, source: 'center', target: n.id, style: { stroke: color + '80', strokeWidth: 2 }, animated: false })
    })

    data.edges.forEach((e, i) => {
      edges.push({ id: `e-${i}`, source: e.from, target: e.to, label: e.relationship, labelStyle: { fill: '#475569', fontSize: 10 }, style: { stroke: '#333', strokeWidth: 1, strokeDasharray: '4 3' } })
    })

    return { nodes, edges }
  }, [data])

  const [nodes, , onNodesChange] = useNodesState(initialNodes)
  const [edges, , onEdgesChange] = useEdgesState(initialEdges)
  const onInit = useCallback(() => { if (isActive) onReady?.() }, [isActive, onReady])

  return (
    <div className="h-full w-full flex flex-col bg-[#080808] px-8 md:px-16 py-12">
      <motion.div className="flex-1 flex flex-col pb-20" initial={{ opacity: 0, y: 20 }} animate={isActive ? { opacity: 1, y: 0 } : { opacity: 0, y: 20 }} transition={{ duration: 0.5 }} onAnimationComplete={() => { if (isActive) onReady?.() }}>
        <h2 className="text-3xl font-bold text-white mb-6">{data.title}</h2>
        <div className="flex-1 rounded-2xl overflow-hidden border border-[#1a1a1a]">
          <ReactFlow nodes={nodes} edges={edges} onNodesChange={onNodesChange} onEdgesChange={onEdgesChange} nodeTypes={nodeTypes} onInit={onInit} fitView fitViewOptions={{ padding: 0.15 }} nodesDraggable={false} nodesConnectable={false} elementsSelectable={false} proOptions={{ hideAttribution: true }}>
            <Background color="#111111" variant={BackgroundVariant.Dots} gap={24} />
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
