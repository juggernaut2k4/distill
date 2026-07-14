'use client'

import { useCallback, useMemo } from 'react'
import { ReactFlow, Background, useNodesState, useEdgesState, type Node, type Edge, type NodeProps, Handle, Position, BackgroundVariant } from '@xyflow/react'
import { motion } from 'framer-motion'
import type { StatCalloutData, TemplateMeta } from '@/lib/templates/types'
import '@xyflow/react/dist/style.css'

function HeroStatNode({ data }: NodeProps) {
  const d = data as { stat: string; unit: string; context: string; source?: string }
  return (
    <div className="w-[340px] rounded-2xl bg-gradient-to-br from-[color-mix(in_srgb,var(--partner-primary,#7C3AED)_30%,transparent)] to-[color-mix(in_srgb,var(--partner-secondary,#06B6D4)_10%,transparent)] border border-[color-mix(in_srgb,var(--partner-primary,#7C3AED)_50%,transparent)] p-8 text-center shadow-2xl">
      <Handle type="source" position={Position.Bottom} style={{ background: 'var(--partner-primary, #7C3AED)', border: 'none' }} />
      <div className="text-6xl font-extrabold text-white leading-none mb-1">{d.stat}</div>
      <div className="text-[color-mix(in_srgb,var(--partner-primary,#7C3AED)_75%,white)] font-bold text-lg mb-3">{d.unit}</div>
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
    <div className="w-[340px] rounded-xl border border-[color-mix(in_srgb,var(--partner-secondary,#06B6D4)_30%,transparent)] bg-[color-mix(in_srgb,var(--partner-secondary,#06B6D4)_5%,transparent)] p-5">
      <Handle type="target" position={Position.Top} style={{ background: 'var(--partner-secondary, #06B6D4)', border: 'none' }} />
      <p className="text-xs font-semibold uppercase tracking-widest text-[var(--partner-secondary,#06B6D4)] mb-2">Why it matters</p>
      <p className="text-white text-sm leading-relaxed">{d.text}</p>
    </div>
  )
}

const STAT_COLORS = ['#06B6D4', '#10B981', '#F59E0B', '#EF4444', '#8B5CF6']
const nodeTypes = { heroStat: HeroStatNode, supportStat: SupportStatNode, why: WhyNode }

interface StatCalloutProps {
  data: StatCalloutData
  isActive: boolean
  onReady?: () => void
  headerEnabled?: boolean
  // TMPL-07 (Section 4.5) — this renderer currently only receives `data`, not
  // the full `section`, so `meta` must be threaded in separately to reach
  // `meta.subtopicTitle` for the new title (StatCalloutData has no title-shaped
  // field at all, so this is the one template using the universal
  // TemplateMeta.subtopicTitle fallback).
  meta?: TemplateMeta
}

export default function StatCallout({ data, isActive, onReady, headerEnabled, meta }: StatCalloutProps) {
  const { initialNodes, initialEdges } = useMemo(() => {
    const nodes: Node[] = []
    const edges: Edge[] = []

    nodes.push({ id: 'hero', type: 'heroStat', position: { x: 0, y: 0 }, data: { stat: data.headline_stat, unit: data.unit, context: data.context, source: data.source }, width: 340, height: 180, draggable: false })
    nodes.push({ id: 'why', type: 'why', position: { x: 0, y: 240 }, data: { text: data.why_it_matters }, width: 340, height: 100, draggable: false })
    edges.push({ id: 'e-why', source: 'hero', target: 'why', style: { stroke: 'color-mix(in srgb, var(--partner-primary, #7C3AED) 38%, transparent)', strokeWidth: 2 } })

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
    <div className="relative h-full w-full flex flex-col bg-[#080808] px-8 md:px-16 py-12">
      <motion.div className="flex-1 flex flex-col pb-20" initial={{ opacity: 0, y: 20 }} animate={isActive ? { opacity: 1, y: 0 } : { opacity: 0, y: 20 }} transition={{ duration: 0.5 }} onAnimationComplete={() => { if (isActive) onReady?.() }}>
        {headerEnabled && (
          <div className="mb-4">
            <h2 className="text-3xl font-bold text-white">{meta?.subtopicTitle}</h2>
            <p className="text-[#94A3B8] text-sm mt-1">{data.context}</p>
          </div>
        )}
        <div className="flex-1 rounded-2xl overflow-hidden border border-[#1a1a1a]">
          <ReactFlow nodes={nodes} edges={edges} onNodesChange={onNodesChange} onEdgesChange={onEdgesChange} nodeTypes={nodeTypes} onInit={onInit} fitView fitViewOptions={{ padding: 0.15 }} minZoom={0.85} nodesDraggable={false} nodesConnectable={false} elementsSelectable={false} proOptions={{ hideAttribution: true }} style={{ width: '100%', height: '100%' }}>
            <Background color="#1a1a1a" variant={BackgroundVariant.Dots} gap={20} />
          </ReactFlow>
        </div>
      </motion.div>
      <motion.div initial={{ opacity: 0, y: 20 }} animate={isActive ? { opacity: 1, y: 0 } : { opacity: 0, y: 20 }} transition={{ delay: 0.6, duration: 0.4 }} className="absolute bottom-0 left-0 right-0 h-[72px] bg-[color-mix(in_srgb,var(--partner-primary,#7C3AED)_20%,transparent)] border-t border-[color-mix(in_srgb,var(--partner-primary,#7C3AED)_30%,transparent)] px-8 py-4 flex items-center gap-3 overflow-hidden">
        <span className="text-sm font-semibold text-[color-mix(in_srgb,var(--partner-primary,#7C3AED)_75%,white)] shrink-0">So what?</span>
        <span className="text-sm text-white line-clamp-2">{data.so_what}</span>
      </motion.div>
    </div>
  )
}
