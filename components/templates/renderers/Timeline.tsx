'use client'

import { useCallback, useMemo } from 'react'
import { ReactFlow, Background, useNodesState, useEdgesState, type Node, type Edge, type NodeProps, Handle, Position, BackgroundVariant } from '@xyflow/react'
import { motion } from 'framer-motion'
import type { TimelineData } from '@/lib/templates/types'
import '@xyflow/react/dist/style.css'

const SIG_COLOR = { low: '#475569', medium: '#F59E0B', high: '#7C3AED' }

function TimelineNode({ data }: NodeProps) {
  const d = data as { year: string; title: string; description: string; significance: 'low' | 'medium' | 'high' }
  const color = SIG_COLOR[d.significance]
  return (
    <div
      style={{ borderColor: color }}
      className="w-[220px] rounded-xl border-2 bg-[#111111] p-4 shadow-lg"
    >
      <Handle type="target" position={Position.Left} style={{ background: color, border: 'none' }} />
      <div className="text-xs font-bold uppercase tracking-widest mb-1" style={{ color }}>{d.year}</div>
      <div className="text-white font-semibold text-sm mb-1 leading-tight">{d.title}</div>
      <div className="text-[#94A3B8] text-sm leading-relaxed line-clamp-3">{d.description}</div>
      <Handle type="source" position={Position.Right} style={{ background: color, border: 'none' }} />
    </div>
  )
}

const nodeTypes = { timeline: TimelineNode }

interface TimelineProps { data: TimelineData; isActive: boolean; onReady?: () => void }

export default function Timeline({ data, isActive, onReady }: TimelineProps) {
  const initialNodes: Node[] = useMemo(() => {
    // Cap events at 4 to prevent visual overflow
    const events = data.events.slice(0, 4)
    return events.map((e, i) => ({
    id: `e${i}`,
    type: 'timeline',
    position: { x: i * 280, y: 0 },
    data: e,
    draggable: false,
    width: 220,
    height: 130,
  }))
  }, [data.events])

  const initialEdges: Edge[] = useMemo(() => {
    // Cap events at 4 to match initialNodes
    const events = data.events.slice(0, 4)
    return events.slice(1).map((_, i) => ({
    id: `edge-${i}`,
    source: `e${i}`,
    target: `e${i + 1}`,
    animated: true,
    style: { stroke: '#333333', strokeWidth: 2 },
  }))
  }, [data.events])

  const [nodes, , onNodesChange] = useNodesState(initialNodes)
  const [edges, , onEdgesChange] = useEdgesState(initialEdges)

  const onInit = useCallback(() => { if (isActive) onReady?.() }, [isActive, onReady])

  return (
    <div className="relative h-full w-full flex flex-col bg-[#080808] px-8 md:px-16 py-12">
      <motion.div
        className="flex-1 flex flex-col pb-20"
        initial={{ opacity: 0, y: 20 }}
        animate={isActive ? { opacity: 1, y: 0 } : { opacity: 0, y: 20 }}
        transition={{ duration: 0.5 }}
        onAnimationComplete={() => { if (isActive) onReady?.() }}
      >
        <div className="mb-6">
          <h2 className="text-3xl font-bold text-white mb-1">{data.title}</h2>
          <p className="text-[#94A3B8] text-sm">{data.context}</p>
        </div>
        <div className="flex-1 rounded-2xl overflow-hidden border border-[#1a1a1a]">
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            nodeTypes={nodeTypes}
            onInit={onInit}
            fitView
            fitViewOptions={{ padding: 0.2 }}
            minZoom={0.85}
            nodesDraggable={false}
            nodesConnectable={false}
            elementsSelectable={false}
            proOptions={{ hideAttribution: true }}
            style={{ width: '100%', height: '100%' }}
          >
            <Background color="#1a1a1a" variant={BackgroundVariant.Dots} gap={20} />
          </ReactFlow>
        </div>
        <div className="mt-4 rounded-xl border border-[#10B981]/30 bg-[#10B981]/5 p-4">
          <p className="text-xs font-semibold uppercase tracking-widest text-[#10B981] mb-1">Where we are now</p>
          <p className="text-white text-sm">{data.where_we_are_now}</p>
        </div>
      </motion.div>
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={isActive ? { opacity: 1, y: 0 } : { opacity: 0, y: 20 }}
        transition={{ delay: 0.6, duration: 0.4 }}
        className="absolute bottom-0 left-0 right-0 h-[72px] bg-[#7C3AED]/20 border-t border-[#7C3AED]/30 px-8 py-4 flex items-center gap-3 overflow-hidden"
      >
        <span className="text-sm font-semibold text-[#A855F7] shrink-0">So what?</span>
        <span className="text-sm text-white line-clamp-2">{data.so_what}</span>
      </motion.div>
    </div>
  )
}
