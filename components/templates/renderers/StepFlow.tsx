'use client'

import { useCallback, useMemo } from 'react'
import { ReactFlow, Background, useNodesState, useEdgesState, type Node, type Edge, type NodeProps, Handle, Position, MarkerType, BackgroundVariant } from '@xyflow/react'
import { motion } from 'framer-motion'
import type { StepFlowData } from '@/lib/templates/types'
import { useFlowLayout } from '@/lib/templates/useFlowLayout'
import '@xyflow/react/dist/style.css'

function StepNode({ data }: NodeProps) {
  const d = data as { number: number; title: string; description: string; what_to_watch_for?: string; time_estimate?: string }
  return (
    <div className="rounded-xl border border-[#7C3AED]/40 bg-[#111111] p-4 min-w-[260px] max-w-[340px]">
      <Handle type="target" position={Position.Left} style={{ background: '#7C3AED', border: 'none' }} />
      <Handle type="source" position={Position.Right} style={{ background: '#7C3AED', border: 'none' }} />
      <div className="flex items-start gap-3">
        <div className="shrink-0 w-8 h-8 rounded-full bg-[#7C3AED] flex items-center justify-center text-white font-bold text-sm">{d.number}</div>
        <div className="flex-1">
          <div className="flex items-baseline gap-2 mb-1">
            <span className="text-white font-semibold text-sm">{d.title}</span>
            {d.time_estimate && <span className="text-xs text-[#475569]">{d.time_estimate}</span>}
          </div>
          <p className="text-[#94A3B8] text-sm leading-relaxed">{d.description}</p>
          {d.what_to_watch_for && (
            <div className="mt-2 text-sm text-[#F59E0B] bg-[#F59E0B]/10 rounded px-2 py-1">
              ⚠ {d.what_to_watch_for}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function OutcomeNode({ data }: NodeProps) {
  const d = data as { outcome: string }
  return (
    <div className="rounded-xl border border-[#10B981]/40 bg-[#10B981]/5 p-4 text-center min-w-[260px] max-w-[340px]">
      <Handle type="target" position={Position.Left} style={{ background: '#10B981', border: 'none' }} />
      <div className="text-xs font-semibold text-[#10B981] mb-2 tracking-wide uppercase">✓ Outcome</div>
      <p className="text-white text-sm">{d.outcome}</p>
    </div>
  )
}

const nodeTypes = { step: StepNode, outcome: OutcomeNode }

interface StepFlowProps { data: StepFlowData; isActive: boolean; onReady?: () => void }

export default function StepFlow({ data, isActive, onReady }: StepFlowProps) {
  const { rawNodes, rawEdges } = useMemo<{ rawNodes: Node[]; rawEdges: Edge[] }>(() => {
    // Cap steps at 4 to prevent visual overflow
    const steps = data.steps.slice(0, 4)
    const nodes: Node[] = [
      ...steps.map((step) => ({
        id: `step-${step.number}`,
        type: 'step',
        position: { x: 0, y: 0 },
        data: step,
        width: 300,
        height: step.what_to_watch_for ? 172 : 138,
        draggable: false,
      })),
      { id: 'outcome', type: 'outcome', position: { x: 0, y: 0 }, data: { outcome: data.outcome }, width: 300, height: 92, draggable: false },
    ]
    const edges: Edge[] = [
      ...steps.slice(0, -1).map((step) => ({
        id: `e-${step.number}-${step.number + 1}`,
        source: `step-${step.number}`,
        target: `step-${step.number + 1}`,
        animated: true,
        markerEnd: { type: MarkerType.ArrowClosed, color: '#7C3AED' },
        style: { stroke: '#7C3AED60', strokeWidth: 2 },
      })),
      {
        id: 'e-last-outcome',
        source: `step-${steps[steps.length - 1].number}`,
        target: 'outcome',
        animated: true,
        markerEnd: { type: MarkerType.ArrowClosed, color: '#10B981' },
        style: { stroke: '#10B98160', strokeWidth: 2 },
      },
    ]
    return { rawNodes: nodes, rawEdges: edges }
  }, [data])

  const { nodes: layoutNodes, edges: layoutEdges } = useFlowLayout(rawNodes, rawEdges, { direction: 'LR', rankSep: 60, nodeSep: 30 })
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
