'use client'

import { useCallback, useMemo } from 'react'
import { ReactFlow, Background, useNodesState, useEdgesState, type Node, type Edge, type NodeProps, Handle, Position, BackgroundVariant } from '@xyflow/react'
import { motion } from 'framer-motion'
import type { FunnelData } from '@/lib/templates/types'
import '@xyflow/react/dist/style.css'

const STAGE_COLORS = ['#7C3AED', '#8B5CF6', '#06B6D4', '#10B981', '#F59E0B']

function FunnelStageNode({ data }: NodeProps) {
  const d = data as { name: string; description: string; what_gets_filtered_out: string; decision_criteria: string; color: string; stageIndex: number; totalStages: number }
  const widthPct = 100 - d.stageIndex * (60 / d.totalStages)
  return (
    <div style={{ borderColor: d.color + '60', width: `${widthPct}%`, minWidth: 280, margin: '0 auto' }} className="rounded-xl border-2 bg-[#111111] p-5 shadow-md">
      <Handle type="target" position={Position.Top} style={{ background: d.color, border: 'none' }} />
      <Handle type="source" position={Position.Bottom} style={{ background: d.color, border: 'none' }} />
      <div className="flex items-center gap-3 mb-2">
        <div className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold text-white shrink-0" style={{ background: d.color }}>
          {d.stageIndex + 1}
        </div>
        <h3 className="text-white font-bold text-sm">{d.name}</h3>
      </div>
      <p className="text-[#94A3B8] text-sm leading-relaxed mb-3">{d.description}</p>
      <div className="grid grid-cols-2 gap-2">
        <div className="rounded-lg bg-[#EF4444]/10 border border-[#EF4444]/20 p-2">
          <p className="text-xs font-semibold text-[#EF4444] mb-0.5">Filtered out</p>
          <p className="text-sm text-[#94A3B8]">{d.what_gets_filtered_out}</p>
        </div>
        <div className="rounded-lg bg-[#10B981]/10 border border-[#10B981]/20 p-2">
          <p className="text-xs font-semibold text-[#10B981] mb-0.5">Criteria</p>
          <p className="text-sm text-[#94A3B8]">{d.decision_criteria}</p>
        </div>
      </div>
    </div>
  )
}

function ResultNode({ data }: NodeProps) {
  const d = data as { text: string }
  return (
    <div className="w-[320px] rounded-2xl border-2 border-[#10B981]/60 bg-[#10B981]/10 p-5 text-center shadow-xl">
      <Handle type="target" position={Position.Top} style={{ background: '#10B981', border: 'none' }} />
      <div className="text-2xl mb-2">✓</div>
      <p className="text-white font-semibold text-sm leading-relaxed">{d.text}</p>
    </div>
  )
}

const nodeTypes = { funnelStage: FunnelStageNode, result: ResultNode }

interface FunnelProps { data: FunnelData; isActive: boolean; onReady?: () => void }

export default function Funnel({ data, isActive, onReady }: FunnelProps) {
  const { initialNodes, initialEdges } = useMemo(() => {
    const nodes: Node[] = []
    const edges: Edge[] = []
    const ySpacing = 220

    data.stages.forEach((s, i) => {
      nodes.push({
        id: `stage${i}`, type: 'funnelStage',
        position: { x: -160, y: i * ySpacing },
        data: { ...s, color: STAGE_COLORS[i % STAGE_COLORS.length], stageIndex: i, totalStages: data.stages.length },
        width: 500, height: 205, draggable: false,
      })
      if (i > 0) edges.push({ id: `e${i}`, source: `stage${i - 1}`, target: `stage${i}`, style: { stroke: STAGE_COLORS[i % STAGE_COLORS.length] + '60', strokeWidth: 2 }, animated: true })
    })

    nodes.push({ id: 'result', type: 'result', position: { x: -10, y: data.stages.length * ySpacing }, data: { text: data.what_makes_it_through }, width: 320, height: 100, draggable: false })
    edges.push({ id: 'e-result', source: `stage${data.stages.length - 1}`, target: 'result', style: { stroke: '#10B98160', strokeWidth: 2 }, animated: true })

    return { initialNodes: nodes, initialEdges: edges }
  }, [data])

  const [nodes, , onNodesChange] = useNodesState(initialNodes)
  const [edges, , onEdgesChange] = useEdgesState(initialEdges)
  const onInit = useCallback(() => { if (isActive) onReady?.() }, [isActive, onReady])

  return (
    <div className="relative h-full w-full flex flex-col bg-[#080808] px-8 md:px-16 py-12">
      <motion.div className="flex-1 flex flex-col pb-20" initial={{ opacity: 0, y: 20 }} animate={isActive ? { opacity: 1, y: 0 } : { opacity: 0, y: 20 }} transition={{ duration: 0.5 }} onAnimationComplete={() => { if (isActive) onReady?.() }}>
        <div className="mb-6">
          <h2 className="text-3xl font-bold text-white mb-1">{data.title}</h2>
          <p className="text-[#94A3B8] text-sm">{data.context}</p>
        </div>
        <div className="flex-1 rounded-2xl overflow-hidden border border-[#1a1a1a]">
          <ReactFlow nodes={nodes} edges={edges} onNodesChange={onNodesChange} onEdgesChange={onEdgesChange} nodeTypes={nodeTypes} onInit={onInit} fitView fitViewOptions={{ padding: 0.1 }} minZoom={0.85} nodesDraggable={false} nodesConnectable={false} elementsSelectable={false} proOptions={{ hideAttribution: true }} style={{ width: '100%', height: '100%' }}>
            <Background color="#1a1a1a" variant={BackgroundVariant.Dots} gap={20} />
          </ReactFlow>
        </div>
      </motion.div>
      <motion.div initial={{ opacity: 0, y: 20 }} animate={isActive ? { opacity: 1, y: 0 } : { opacity: 0, y: 20 }} transition={{ delay: 0.6, duration: 0.4 }} className="absolute bottom-0 left-0 right-0 h-[72px] bg-[#7C3AED]/20 border-t border-[#7C3AED]/30 px-8 py-4 flex items-center gap-3 overflow-hidden">
        <span className="text-sm font-semibold text-[#A855F7] shrink-0">So what?</span>
        <span className="text-sm text-white line-clamp-2">{data.so_what}</span>
      </motion.div>
    </div>
  )
}
