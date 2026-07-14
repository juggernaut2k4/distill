'use client'

import { useCallback, useMemo } from 'react'
import { ReactFlow, Background, useNodesState, useEdgesState, type Node, type Edge, type NodeProps, Handle, Position, BackgroundVariant } from '@xyflow/react'
import { motion } from 'framer-motion'
import type { FrameworkCardData } from '@/lib/templates/types'
import '@xyflow/react/dist/style.css'

const COMPONENT_COLORS = ['#7C3AED', '#06B6D4', '#10B981', '#F59E0B', '#EF4444', '#8B5CF6', '#EC4899']

function HeaderNode({ data }: NodeProps) {
  const d = data as { name: string; coined_by?: string; purpose: string }
  return (
    <div className="w-[400px] rounded-2xl bg-gradient-to-br from-[color-mix(in_srgb,var(--partner-primary,#7C3AED)_30%,transparent)] to-[color-mix(in_srgb,var(--partner-secondary,#06B6D4)_10%,transparent)] border border-[color-mix(in_srgb,var(--partner-primary,#7C3AED)_40%,transparent)] p-6 shadow-xl">
      <Handle type="source" position={Position.Bottom} style={{ background: 'var(--partner-primary, #7C3AED)', border: 'none' }} />
      <div className="text-2xl font-extrabold text-white mb-1">{d.name}</div>
      {d.coined_by && <div className="text-xs text-[#475569] mb-3">by {d.coined_by}</div>}
      <p className="text-[#94A3B8] text-sm leading-relaxed">{d.purpose}</p>
    </div>
  )
}

function ComponentNode({ data }: NodeProps) {
  const d = data as { letter?: string; name: string; description: string; executive_question: string; color: string }
  return (
    <div style={{ borderColor: d.color + '60' }} className="w-[220px] rounded-xl border bg-[#111111] p-4 shadow-md">
      <Handle type="target" position={Position.Top} style={{ background: d.color, border: 'none' }} />
      <div className="flex items-center gap-2 mb-2">
        {d.letter && (
          <div className="w-8 h-8 rounded-lg flex items-center justify-center font-bold text-white text-base shrink-0" style={{ background: d.color }}>
            {d.letter}
          </div>
        )}
        <span className="text-white font-semibold text-sm leading-tight">{d.name}</span>
      </div>
      <p className="text-[#94A3B8] text-sm leading-relaxed mb-2">{d.description}</p>
      <div className="rounded-lg bg-[#0d0d0d] border border-[#222] p-2">
        <p className="text-sm italic text-[#475569]">&ldquo;{d.executive_question}&rdquo;</p>
      </div>
    </div>
  )
}

const nodeTypes = { header: HeaderNode, component: ComponentNode }

interface FrameworkProps { data: FrameworkCardData; isActive: boolean; onReady?: () => void; headerEnabled?: boolean }

export default function FrameworkCard({ data, isActive, onReady, headerEnabled }: FrameworkProps) {
  const { initialNodes, initialEdges } = useMemo(() => {
    const nodes: Node[] = [{ id: 'header', type: 'header', position: { x: 0, y: 0 }, data: { name: data.framework_name, coined_by: data.coined_by, purpose: data.purpose }, width: 400, height: 120, draggable: false }]
    const edges: Edge[] = []
    // Cap components at 8 (4 columns × 2 rows)
    const components = data.components.slice(0, 8)
    const cols = Math.min(components.length, 4)
    const spacingX = 250
    const startX = -((cols - 1) * spacingX) / 2

    components.forEach((c, i) => {
      const col = i % cols
      const row = Math.floor(i / cols)
      nodes.push({ id: `c${i}`, type: 'component', position: { x: startX + col * spacingX, y: 180 + row * 245 }, data: { ...c, color: COMPONENT_COLORS[i % COMPONENT_COLORS.length] }, width: 220, height: 215, draggable: false })
      edges.push({ id: `e${i}`, source: 'header', target: `c${i}`, style: { stroke: COMPONENT_COLORS[i % COMPONENT_COLORS.length] + '60', strokeWidth: 2 }, animated: false })
    })
    return { initialNodes: nodes, initialEdges: edges }
  }, [data])

  const [nodes, , onNodesChange] = useNodesState(initialNodes)
  const [edges, , onEdgesChange] = useEdgesState(initialEdges)
  const onInit = useCallback(() => { if (isActive) onReady?.() }, [isActive, onReady])

  return (
    <div className="relative h-full w-full flex flex-col bg-[#080808] px-8 md:px-16 py-12">
      <motion.div className="flex-1 flex flex-col pb-20" initial={{ opacity: 0, y: 20 }} animate={isActive ? { opacity: 1, y: 0 } : { opacity: 0, y: 20 }} transition={{ duration: 0.5 }} onAnimationComplete={() => { if (isActive) onReady?.() }}>
        {headerEnabled && (
          <div className="mb-4">
            <h2 className="text-3xl font-bold text-white">{data.framework_name}</h2>
            {data.coined_by && <p className="text-[#94A3B8] text-sm mt-1">by {data.coined_by}</p>}
          </div>
        )}
        <div className="flex-1 rounded-2xl overflow-hidden border border-[#1a1a1a]">
          <ReactFlow nodes={nodes} edges={edges} onNodesChange={onNodesChange} onEdgesChange={onEdgesChange} nodeTypes={nodeTypes} onInit={onInit} fitView fitViewOptions={{ padding: 0.12 }} minZoom={0.85} nodesDraggable={false} nodesConnectable={false} elementsSelectable={false} proOptions={{ hideAttribution: true }} style={{ width: '100%', height: '100%' }}>
            <Background color="#1a1a1a" variant={BackgroundVariant.Dots} gap={22} />
          </ReactFlow>
        </div>
        <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="rounded-xl border border-[#10B981]/30 bg-[#10B981]/5 p-4">
            <p className="text-xs font-semibold uppercase tracking-widest text-[#10B981] mb-1">When to use</p>
            <p className="text-white text-sm">{data.when_to_use}</p>
          </div>
          <div className="rounded-xl border border-[#EF4444]/30 bg-[#EF4444]/5 p-4">
            <p className="text-xs font-semibold uppercase tracking-widest text-[#EF4444] mb-1">When NOT to use</p>
            <p className="text-white text-sm">{data.when_not_to_use}</p>
          </div>
        </div>
      </motion.div>
      <motion.div initial={{ opacity: 0, y: 20 }} animate={isActive ? { opacity: 1, y: 0 } : { opacity: 0, y: 20 }} transition={{ delay: 0.6, duration: 0.4 }} className="absolute bottom-0 left-0 right-0 h-[72px] bg-[color-mix(in_srgb,var(--partner-primary,#7C3AED)_20%,transparent)] border-t border-[color-mix(in_srgb,var(--partner-primary,#7C3AED)_30%,transparent)] px-8 py-4 flex items-center gap-3 overflow-hidden">
        <span className="text-sm font-semibold text-[color-mix(in_srgb,var(--partner-primary,#7C3AED)_75%,white)] shrink-0">So what?</span>
        <span className="text-sm text-white line-clamp-2">{data.so_what}</span>
      </motion.div>
    </div>
  )
}
