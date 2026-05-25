'use client'

import { useCallback, useMemo } from 'react'
import { ReactFlow, Background, useNodesState, useEdgesState, type Node, type Edge, type NodeProps, Handle, Position, MarkerType, BackgroundVariant } from '@xyflow/react'
import { motion } from 'framer-motion'
import type { ComparisonTableData } from '@/lib/templates/types'
import '@xyflow/react/dist/style.css'

const CRIT_W = 180
const OPT_W = 200
const COL_GAP = 16
const ROW_H = 80
const ROW_GAP = 12
const HEADER_H = 106

function CriterionNode({ data }: NodeProps) {
  const d = data as { label: string; description?: string }
  return (
    <div className="rounded-lg border border-[#333333] bg-[#1A1A1A] p-3 min-w-[160px] max-w-[180px]">
      <Handle type="source" position={Position.Right} style={{ background: '#475569', border: 'none' }} />
      <div className="text-white font-medium text-xs">{d.label}</div>
      {d.description && <div className="text-[#475569] text-xs mt-0.5 leading-tight">{d.description}</div>}
    </div>
  )
}

function OptionHeaderNode({ data }: NodeProps) {
  const d = data as { name: string; tagline: string; best_for: string }
  return (
    <div className="rounded-xl border-2 border-[#7C3AED]/60 bg-[#7C3AED]/10 p-3 text-center min-w-[180px] max-w-[200px]">
      <Handle type="source" position={Position.Bottom} style={{ background: '#7C3AED', border: 'none' }} />
      <div className="text-white font-bold text-sm">{d.name}</div>
      <div className="text-[#94A3B8] text-xs mt-0.5">{d.tagline}</div>
      <div className="text-[#06B6D4] text-xs mt-1">Best for: {d.best_for}</div>
    </div>
  )
}

function ValueNode({ data }: NodeProps) {
  const d = data as { value: string; isWinner: boolean }
  return (
    <div className={`rounded-lg border p-3 text-center min-w-[180px] max-w-[200px] ${d.isWinner ? 'border-[#10B981]/60 bg-[#10B981]/10' : 'border-[#222222] bg-[#111111]'}`}>
      <Handle type="target" position={Position.Top} style={{ background: d.isWinner ? '#10B981' : '#475569', border: 'none' }} />
      <Handle type="target" position={Position.Left} style={{ background: d.isWinner ? '#10B981' : '#475569', border: 'none' }} />
      <div className={`text-xs leading-snug flex items-center justify-center gap-1 ${d.isWinner ? 'text-[#10B981] font-medium' : 'text-[#94A3B8]'}`}>
        {d.isWinner && <span>✓</span>}
        {d.value}
      </div>
    </div>
  )
}

function VerdictNode({ data }: NodeProps) {
  const d = data as { verdict: string }
  return (
    <div className="rounded-xl border border-[#333333] bg-[#111111] p-4 min-w-[400px] max-w-[600px]">
      <div className="text-xs font-semibold text-[#A855F7] mb-1 tracking-wide uppercase">Verdict</div>
      <p className="text-white text-sm">{d.verdict}</p>
    </div>
  )
}

const nodeTypes = { criterion: CriterionNode, optionHeader: OptionHeaderNode, value: ValueNode, verdict: VerdictNode }

interface ComparisonTableProps { data: ComparisonTableData; isActive: boolean; onReady?: () => void }

export default function ComparisonTable({ data, isActive, onReady }: ComparisonTableProps) {
  const { nodes: initialNodes, edges: initialEdges } = useMemo<{ nodes: Node[]; edges: Edge[] }>(() => {
    const numOpts = data.options.length
    const numCrit = data.criteria.length
    const headerY = 0
    const headerH = HEADER_H
    const gridStartY = headerY + headerH + 40

    const optHeaderNodes: Node[] = data.options.map((opt, i) => ({
      id: `opt-${i}`,
      type: 'optionHeader',
      position: { x: CRIT_W + COL_GAP + i * (OPT_W + COL_GAP), y: headerY },
      data: opt,
      width: OPT_W,
      height: headerH,
      draggable: false,
    }))

    const critNodes: Node[] = data.criteria.map((crit, ri) => ({
      id: `crit-${ri}`,
      type: 'criterion',
      position: { x: 0, y: gridStartY + ri * (ROW_H + ROW_GAP) },
      data: { label: crit.label, description: crit.description },
      width: CRIT_W,
      height: ROW_H,
      draggable: false,
    }))

    const valueNodes: Node[] = []
    data.criteria.forEach((crit, ri) => {
      crit.values.forEach((val, ci) => {
        valueNodes.push({
          id: `val-${ri}-${ci}`,
          type: 'value',
          position: { x: CRIT_W + COL_GAP + ci * (OPT_W + COL_GAP), y: gridStartY + ri * (ROW_H + ROW_GAP) },
          data: { value: val, isWinner: crit.winner_index === ci },
          width: OPT_W,
          height: ROW_H,
          draggable: false,
        })
      })
    })

    const totalGridH = numCrit * ROW_H + (numCrit - 1) * ROW_GAP
    const verdictX = 0
    const verdictY = gridStartY + totalGridH + 40
    const verdictW = CRIT_W + COL_GAP + numOpts * (OPT_W + COL_GAP)
    const verdictNode: Node = {
      id: 'verdict',
      type: 'verdict',
      position: { x: verdictX, y: verdictY },
      data: { verdict: data.verdict },
      width: Math.min(verdictW, 700),
      height: 85,
      draggable: false,
    }

    const nodes = [...optHeaderNodes, ...critNodes, ...valueNodes, verdictNode]

    const edges: Edge[] = [
      ...data.options.map((_, i) => ({
        id: `e-opt-${i}-val-0-${i}`,
        source: `opt-${i}`,
        target: `val-0-${i}`,
        markerEnd: { type: MarkerType.ArrowClosed, color: '#7C3AED' },
        style: { stroke: '#7C3AED40', strokeWidth: 1.5 },
      })),
      ...data.criteria.flatMap((_, ri) => data.options.map((__, ci) => ({
        id: `e-crit-${ri}-val-${ri}-${ci}`,
        source: `crit-${ri}`,
        target: `val-${ri}-${ci}`,
        markerEnd: { type: MarkerType.ArrowClosed, color: '#475569' },
        style: { stroke: '#47556940', strokeWidth: 1 },
      }))),
    ]

    return { nodes, edges }
  }, [data])

  const [nodes, , onNodesChange] = useNodesState(initialNodes)
  const [edges, , onEdgesChange] = useEdgesState(initialEdges)
  const onInit = useCallback(() => { if (isActive) onReady?.() }, [isActive, onReady])

  return (
    <div className="h-full w-full flex flex-col bg-[#080808] px-8 md:px-16 py-12">
      <motion.div className="flex-1 flex flex-col pb-20" initial={{ opacity: 0, y: 20 }} animate={isActive ? { opacity: 1, y: 0 } : { opacity: 0, y: 20 }} transition={{ duration: 0.5 }} onAnimationComplete={() => { if (isActive) onReady?.() }}>
        <div className="mb-6">
          <h2 className="text-3xl font-bold text-white mb-1">{data.title}</h2>
          <p className="text-[#94A3B8] text-sm">{data.context}</p>
        </div>
        <div className="flex-1 rounded-2xl overflow-hidden border border-[#1a1a1a]">
          <ReactFlow nodes={nodes} edges={edges} onNodesChange={onNodesChange} onEdgesChange={onEdgesChange} nodeTypes={nodeTypes} onInit={onInit} fitView fitViewOptions={{ padding: 0.12 }} nodesDraggable={false} nodesConnectable={false} elementsSelectable={false} proOptions={{ hideAttribution: true }} style={{ width: '100%', height: '100%' }}>
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
