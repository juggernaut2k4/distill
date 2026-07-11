'use client'

import { useCallback } from 'react'
import { ReactFlow, Background, useNodesState, useEdgesState, type Node, type Edge, type NodeProps, Handle, Position, MarkerType, BackgroundVariant } from '@xyflow/react'
import { motion } from 'framer-motion'
import type { FlowchartData } from '@/lib/templates/types'
import { useFlowLayout } from '@/lib/templates/useFlowLayout'
import '@xyflow/react/dist/style.css'

function StartNode({ data }: NodeProps) {
  const d = data as { label: string }
  return (
    <div className="w-[160px] rounded-full bg-[#10B981] px-6 py-3 text-center shadow-lg shadow-green-900/30">
      <Handle type="source" position={Position.Bottom} style={{ background: '#10B981', border: 'none' }} />
      <span className="text-white font-bold text-sm">{d.label}</span>
    </div>
  )
}

function DecisionNode({ data }: NodeProps) {
  const d = data as { label: string; detail?: string }
  return (
    <div className="w-[200px] bg-[#F59E0B] rotate-0 rounded-xl border-2 border-[#F59E0B] p-4 text-center shadow-lg" style={{ clipPath: 'polygon(50% 0%, 100% 50%, 50% 100%, 0% 50%)' }}>
      <Handle type="target" position={Position.Top} style={{ background: '#F59E0B', border: 'none' }} />
      <Handle type="source" position={Position.Bottom} style={{ background: '#F59E0B', border: 'none' }} />
      <Handle type="source" position={Position.Right} id="right" style={{ background: '#F59E0B', border: 'none' }} />
      <span className="text-white font-bold text-xs leading-tight">{d.label}</span>
    </div>
  )
}

function ActionNodeComp({ data }: NodeProps) {
  const d = data as { label: string; detail?: string }
  return (
    <div className="w-[200px] rounded-xl border-2 border-[#7C3AED]/60 bg-[#111111] p-4 text-center shadow-md">
      <Handle type="target" position={Position.Top} style={{ background: '#7C3AED', border: 'none' }} />
      <Handle type="source" position={Position.Bottom} style={{ background: '#7C3AED', border: 'none' }} />
      <Handle type="target" position={Position.Left} style={{ background: '#7C3AED', border: 'none' }} />
      <div className="text-white font-semibold text-sm mb-1">{d.label}</div>
      {d.detail && <div className="text-[#475569] text-xs">{d.detail}</div>}
    </div>
  )
}

function EndNode({ data }: NodeProps) {
  const d = data as { label: string }
  return (
    <div className="w-[160px] rounded-full bg-[#EF4444] px-6 py-3 text-center shadow-lg shadow-red-900/30">
      <Handle type="target" position={Position.Top} style={{ background: '#EF4444', border: 'none' }} />
      <span className="text-white font-bold text-sm">{d.label}</span>
    </div>
  )
}

const nodeTypes = { start: StartNode, decision: DecisionNode, action: ActionNodeComp, end: EndNode }

const NODE_DIMS: Record<string, { w: number; h: number }> = {
  start: { w: 160, h: 48 }, decision: { w: 200, h: 100 }, action: { w: 200, h: 80 }, end: { w: 160, h: 48 },
}

interface FlowchartProps { data: FlowchartData; isActive: boolean; onReady?: () => void }

export default function FlowchartRenderer({ data, isActive, onReady }: FlowchartProps) {
  const rawNodes: Node[] = data.nodes.map((n) => ({
    id: n.id, type: n.type, position: { x: 0, y: 0 }, data: n,
    width: NODE_DIMS[n.type]?.w ?? 200, height: NODE_DIMS[n.type]?.h ?? 80, draggable: false,
  }))

  const rawEdges: Edge[] = data.edges.map((e, i) => ({
    id: `e${i}`, source: e.from, target: e.to, label: e.label,
    labelStyle: { fill: '#94A3B8', fontSize: 11 },
    labelBgStyle: { fill: '#080808', fillOpacity: 0.8 },
    markerEnd: { type: MarkerType.ArrowClosed, color: '#444' },
    style: { stroke: '#444', strokeWidth: 2 },
    animated: false,
  }))

  const { nodes: layoutNodes, edges: layoutEdges } = useFlowLayout(rawNodes, rawEdges, { direction: 'TB', rankSep: 80, nodeSep: 60 })
  const [nodes, , onNodesChange] = useNodesState(layoutNodes)
  const [edges, , onEdgesChange] = useEdgesState(layoutEdges)
  const onInit = useCallback(() => { if (isActive) onReady?.() }, [isActive, onReady])

  return (
    <div className="relative h-full w-full flex flex-col bg-[#080808] px-8 md:px-16 py-12">
      <motion.div className="flex-1 flex flex-col pb-20" initial={{ opacity: 0, y: 20 }} animate={isActive ? { opacity: 1, y: 0 } : { opacity: 0, y: 20 }} transition={{ duration: 0.5 }} onAnimationComplete={() => { if (isActive) onReady?.() }}>
        <div className="mb-6">
          <h2 className="text-3xl font-bold text-white mb-1">{data.title}</h2>
          <p className="text-[#94A3B8] text-sm">{data.context}</p>
        </div>
        <div className="flex gap-3 mb-4">
          {[['#10B981', 'Start'], ['#F59E0B', 'Decision'], ['#7C3AED', 'Action'], ['#EF4444', 'End']].map(([color, label]) => (
            <div key={label} className="flex items-center gap-1.5">
              <div className="w-2.5 h-2.5 rounded-full" style={{ background: color }} />
              <span className="text-xs text-[#475569]">{label}</span>
            </div>
          ))}
        </div>
        <div className="flex-1 rounded-2xl overflow-hidden border border-[#1a1a1a]">
          <ReactFlow nodes={nodes} edges={edges} onNodesChange={onNodesChange} onEdgesChange={onEdgesChange} nodeTypes={nodeTypes} onInit={onInit} fitView fitViewOptions={{ padding: 0.15 }} minZoom={0.85} nodesDraggable={false} nodesConnectable={false} elementsSelectable={false} proOptions={{ hideAttribution: true }} style={{ width: '100%', height: '100%' }}>
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
