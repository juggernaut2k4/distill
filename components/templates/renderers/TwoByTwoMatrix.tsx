'use client'

import { useCallback, useMemo } from 'react'
import { ReactFlow, Background, useNodesState, useEdgesState, type Node, type NodeProps, Handle, Position, BackgroundVariant } from '@xyflow/react'
import { motion } from 'framer-motion'
import type { TwoByTwoMatrixData } from '@/lib/templates/types'
import '@xyflow/react/dist/style.css'

const QUADRANT_STYLES: Record<string, { border: string; bg: string; dot: string }> = {
  'top-left':     { border: '#F59E0B', bg: '#F59E0B10', dot: '#F59E0B' },
  'top-right':    { border: '#10B981', bg: '#10B98110', dot: '#10B981' },
  'bottom-left':  { border: '#EF4444', bg: '#EF444410', dot: '#EF4444' },
  'bottom-right': { border: '#06B6D4', bg: '#06B6D410', dot: '#06B6D4' },
}

function QuadrantNode({ data }: NodeProps) {
  const d = data as { name: string; description: string; examples: string[]; position: string }
  const style = QUADRANT_STYLES[d.position] ?? { border: '#333', bg: '#11111130', dot: '#333' }
  return (
    <div style={{ borderColor: style.border, background: style.bg }} className="w-[260px] rounded-2xl border-2 p-5 shadow-lg">
      <Handle type="target" position={Position.Top} style={{ opacity: 0 }} />
      <Handle type="target" position={Position.Left} style={{ opacity: 0 }} />
      <div className="flex items-center gap-2 mb-2">
        <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: style.dot }} />
        <span className="text-white font-bold text-sm">{d.name}</span>
      </div>
      <p className="text-[#94A3B8] text-xs leading-relaxed mb-3">{d.description}</p>
      {d.examples.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {d.examples.slice(0, 3).map((ex, i) => (
            <span key={i} className="text-xs px-2 py-0.5 rounded-full border border-[#333] text-[#475569] bg-[#0d0d0d]">{ex}</span>
          ))}
        </div>
      )}
    </div>
  )
}

function AxisLabelNode({ data }: NodeProps) {
  const d = data as { label: string; isVertical?: boolean }
  return (
    <div className={`flex items-center justify-center text-xs font-semibold uppercase tracking-widest text-[#475569] ${d.isVertical ? 'rotate-[-90deg] w-[160px]' : 'w-[200px]'}`}>
      {d.label}
    </div>
  )
}

const nodeTypes = { quadrant: QuadrantNode, axisLabel: AxisLabelNode }

interface TwoByTwoProps { data: TwoByTwoMatrixData; isActive: boolean; onReady?: () => void }

export default function TwoByTwoMatrix({ data, isActive, onReady }: TwoByTwoProps) {
  const POSITIONS: Record<string, { x: number; y: number }> = {
    'top-left': { x: 0, y: 0 }, 'top-right': { x: 300, y: 0 },
    'bottom-left': { x: 0, y: 240 }, 'bottom-right': { x: 300, y: 240 },
  }

  const initialNodes: Node[] = useMemo(() => [
    ...data.quadrants.map((q) => ({
      id: q.position, type: 'quadrant', position: POSITIONS[q.position] ?? { x: 0, y: 0 }, data: q, width: 260, height: 200, draggable: false,
    })),
    { id: 'x-low', type: 'axisLabel', position: { x: -20, y: 460 }, data: { label: data.x_axis.low_label }, draggable: false },
    { id: 'x-high', type: 'axisLabel', position: { x: 380, y: 460 }, data: { label: data.x_axis.high_label }, draggable: false },
    { id: 'x-label', type: 'axisLabel', position: { x: 180, y: 500 }, data: { label: data.x_axis.label }, draggable: false },
    { id: 'y-low', type: 'axisLabel', position: { x: -180, y: 380 }, data: { label: data.y_axis.low_label, isVertical: true }, draggable: false },
    { id: 'y-high', type: 'axisLabel', position: { x: -180, y: 40 }, data: { label: data.y_axis.high_label, isVertical: true }, draggable: false },
  ], [data])

  const [nodes, , onNodesChange] = useNodesState(initialNodes)
  const [edges, , onEdgesChange] = useEdgesState([])
  const onInit = useCallback(() => { if (isActive) onReady?.() }, [isActive, onReady])

  return (
    <div className="h-full w-full flex flex-col bg-[#080808] px-8 md:px-16 py-12">
      <motion.div className="flex-1 flex flex-col pb-20" initial={{ opacity: 0, y: 20 }} animate={isActive ? { opacity: 1, y: 0 } : { opacity: 0, y: 20 }} transition={{ duration: 0.5 }} onAnimationComplete={() => { if (isActive) onReady?.() }}>
        <div className="mb-6">
          <h2 className="text-3xl font-bold text-white mb-1">{data.title}</h2>
          <p className="text-[#94A3B8] text-sm">{data.context}</p>
        </div>
        <div className="flex-1 rounded-2xl overflow-hidden border border-[#1a1a1a]">
          <ReactFlow nodes={nodes} edges={edges} onNodesChange={onNodesChange} onEdgesChange={onEdgesChange} nodeTypes={nodeTypes} onInit={onInit} fitView fitViewOptions={{ padding: 0.12 }} nodesDraggable={false} nodesConnectable={false} elementsSelectable={false} proOptions={{ hideAttribution: true }}>
            <Background color="#1a1a1a" variant={BackgroundVariant.Dots} gap={20} />
          </ReactFlow>
        </div>
        {data.where_most_executives_are && (
          <div className="mt-4 rounded-xl border border-[#F59E0B]/30 bg-[#F59E0B]/5 p-4">
            <p className="text-xs font-semibold uppercase tracking-widest text-[#F59E0B] mb-1">Where most executives are</p>
            <p className="text-white text-sm">{data.where_most_executives_are}</p>
          </div>
        )}
      </motion.div>
      <motion.div initial={{ opacity: 0, y: 20 }} animate={isActive ? { opacity: 1, y: 0 } : { opacity: 0, y: 20 }} transition={{ delay: 0.6, duration: 0.4 }} className="absolute bottom-0 left-0 right-0 bg-[#7C3AED]/20 border-t border-[#7C3AED]/30 px-8 py-4 flex items-center gap-3">
        <span className="text-sm font-semibold text-[#A855F7] shrink-0">So what?</span>
        <span className="text-sm text-white">{data.so_what}</span>
      </motion.div>
    </div>
  )
}
