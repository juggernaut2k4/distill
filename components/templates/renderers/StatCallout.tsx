'use client'

import { useCallback, useMemo } from 'react'
import { ReactFlow, Background, useNodesState, useEdgesState, type Node, type Edge, type NodeProps, Handle, Position, BackgroundVariant } from '@xyflow/react'
import { motion } from 'framer-motion'
import type { StatCalloutData } from '@/lib/templates/types'
import '@xyflow/react/dist/style.css'

function HeroStatNode({ data }: NodeProps) {
  const d = data as { stat: string; unit: string; context: string; source?: string }
  return (
    <div className="w-[340px] rounded-2xl bg-gradient-to-br from-[#7C3AED]/30 to-[#06B6D4]/10 border border-[#7C3AED]/50 p-8 text-center shadow-2xl">
      <Handle type="source" position={Position.Bottom} style={{ background: '#7C3AED', border: 'none' }} />
      <div className="text-6xl font-extrabold text-white leading-none mb-1">{d.stat}</div>
      <div className="text-[#A855F7] font-bold text-lg mb-3">{d.unit}</div>
      <p className="text-[#94A3B8] text-sm leading-relaxed">{d.context}</p>
      {d.source && <p className="text-xs text-[#333] mt-2">Source: {d.source}</p>}
    </div>
  )
}

function SupportStatNode({ data }: NodeProps) {
  const d = data as { stat: string; label: string; color: string }
  return (
    <div style={{ borderColor: d.color + '50' }} className="w-[180px] rounded-xl border bg-[#111111] p-4 text-center shadow-md">
      <Handle type="target" position={Position.Top} style={{ background: d.color, border: 'none' }} />
      <div className="text-2xl font-extrabold mb-1" style={{ color: d.color }}>{d.stat}</div>
      <div className="text-[#94A3B8] text-xs leading-snug">{d.label}</div>
    </div>
  )
}

function WhyNode({ data }: NodeProps) {
  const d = data as { text: string }
  return (
    <div className="w-[340px] rounded-xl border border-[#06B6D4]/30 bg-[#06B6D4]/5 p-5">
      <Handle type="target" position={Position.Top} style={{ background: '#06B6D4', border: 'none' }} />
      <p className="text-xs font-semibold uppercase tracking-widest text-[#06B6D4] mb-2">Why it matters</p>
      <p className="text-white text-sm leading-relaxed">{d.text}</p>
    </div>
  )
}

const STAT_COLORS = ['#06B6D4', '#10B981', '#F59E0B', '#EF4444', '#8B5CF6']
const nodeTypes = { heroStat: HeroStatNode, supportStat: SupportStatNode, why: WhyNode }

interface StatCalloutProps { data: StatCalloutData; isActive: boolean; onReady?: () => void }

export default function StatCallout({ data, isActive, onReady }: StatCalloutProps) {
  const { initialNodes, initialEdges } = useMemo(() => {
    const nodes: Node[] = []
    const edges: Edge[] = []

    nodes.push({ id: 'hero', type: 'heroStat', position: { x: 0, y: 0 }, data: { stat: data.headline_stat, unit: data.unit, context: data.context, source: data.source }, width: 340, height: 180, draggable: false })
    nodes.push({ id: 'why', type: 'why', position: { x: 0, y: 240 }, data: { text: data.why_it_matters }, width: 340, height: 100, draggable: false })
    edges.push({ id: 'e-why', source: 'hero', target: 'why', style: { stroke: '#7C3AED60', strokeWidth: 2 } })

    const cols = Math.min(data.supporting_stats.length, 4)
    const spacingX = 210
    const startX = -((cols - 1) * spacingX) / 2 + (340 - (cols * spacingX - (spacingX - 180))) / 2

    data.supporting_stats.forEach((s, i) => {
      const color = STAT_COLORS[i % STAT_COLORS.length]
      nodes.push({ id: `s${i}`, type: 'supportStat', position: { x: startX + i * spacingX, y: 420 }, data: { ...s, color }, width: 180, height: 100, draggable: false })
      edges.push({ id: `es${i}`, source: 'why', target: `s${i}`, style: { stroke: color + '50', strokeWidth: 1.5, strokeDasharray: '4 3' } })
    })

    return { initialNodes: nodes, initialEdges: edges }
  }, [data])

  const [nodes, , onNodesChange] = useNodesState(initialNodes)
  const [edges, , onEdgesChange] = useEdgesState(initialEdges)
  const onInit = useCallback(() => { if (isActive) onReady?.() }, [isActive, onReady])

  return (
    <div className="h-full w-full flex flex-col bg-[#080808] px-8 md:px-16 py-12">
      <motion.div className="flex-1 flex flex-col pb-20" initial={{ opacity: 0, y: 20 }} animate={isActive ? { opacity: 1, y: 0 } : { opacity: 0, y: 20 }} transition={{ duration: 0.5 }} onAnimationComplete={() => { if (isActive) onReady?.() }}>
        <div className="flex-1 rounded-2xl overflow-hidden border border-[#1a1a1a]">
          <ReactFlow nodes={nodes} edges={edges} onNodesChange={onNodesChange} onEdgesChange={onEdgesChange} nodeTypes={nodeTypes} onInit={onInit} fitView fitViewOptions={{ padding: 0.15 }} nodesDraggable={false} nodesConnectable={false} elementsSelectable={false} proOptions={{ hideAttribution: true }}>
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
