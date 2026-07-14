'use client'

import { useCallback, useMemo } from 'react'
import { ReactFlow, Background, useNodesState, useEdgesState, type Node, type Edge, type NodeProps, Handle, Position, MarkerType, BackgroundVariant } from '@xyflow/react'
import { motion } from 'framer-motion'
import type { ConceptDefinitionData } from '@/lib/templates/types'
import { useFlowLayout } from '@/lib/templates/useFlowLayout'
import '@xyflow/react/dist/style.css'

function TermNode({ data }: NodeProps) {
  const d = data as { term: string; category: string; one_line: string; plain_english: string }
  return (
    <div className="rounded-2xl border-2 border-[var(--partner-primary,#7C3AED)] bg-[color-mix(in_srgb,var(--partner-primary,#7C3AED)_10%,transparent)] p-5 text-center min-w-[300px] max-w-[380px]">
      <Handle type="source" position={Position.Bottom} style={{ background: 'var(--partner-primary, #7C3AED)', border: 'none' }} />
      <div className="text-xs font-semibold text-[color-mix(in_srgb,var(--partner-primary,#7C3AED)_75%,white)] mb-2 tracking-widest uppercase">{d.category}</div>
      <div className="text-white font-extrabold text-2xl mb-2">{d.term}</div>
      <div className="text-[var(--partner-secondary,#06B6D4)] text-sm font-medium mb-2">{d.one_line}</div>
      <div className="text-[#94A3B8] text-sm leading-relaxed">{d.plain_english}</div>
    </div>
  )
}

function ExampleNode({ data }: NodeProps) {
  const d = data as { company: string; what_they_did: string; result: string }
  return (
    <div className="rounded-xl border border-[#10B981]/40 bg-[#10B981]/5 p-5 min-w-[260px] max-w-[340px]">
      <Handle type="target" position={Position.Top} style={{ background: '#10B981', border: 'none' }} />
      <Handle type="source" position={Position.Bottom} style={{ background: '#10B981', border: 'none' }} />
      <div className="text-xs font-semibold text-[#10B981] mb-2 tracking-wide uppercase">Real-World Example</div>
      <div className="text-white font-semibold text-sm mb-1">{d.company}</div>
      <p className="text-[#94A3B8] text-sm leading-relaxed mb-3">{d.what_they_did}</p>
      <div className="inline-flex items-center gap-1.5 rounded-full bg-[#10B981]/10 border border-[#10B981]/30 px-3 py-1 text-xs font-medium text-[#10B981]">
        ✓ {d.result}
      </div>
    </div>
  )
}

function MythNode({ data }: NodeProps) {
  const d = data as { common_misconception: string }
  return (
    <div className="rounded-xl border border-[color-mix(in_srgb,var(--partner-accent,#F59E0B)_40%,transparent)] bg-[color-mix(in_srgb,var(--partner-accent,#F59E0B)_5%,transparent)] p-5 min-w-[260px] max-w-[340px]">
      <Handle type="target" position={Position.Top} style={{ background: 'var(--partner-accent, #F59E0B)', border: 'none' }} />
      <div className="text-xs font-semibold text-[var(--partner-accent,#F59E0B)] mb-2 tracking-wide uppercase">Common Myth</div>
      <p className="text-[#94A3B8] text-sm leading-relaxed">{d.common_misconception}</p>
    </div>
  )
}

const nodeTypes = { term: TermNode, example: ExampleNode, myth: MythNode }

interface ConceptDefinitionProps { data: ConceptDefinitionData; isActive: boolean; onReady?: () => void }

export default function ConceptDefinition({ data, isActive, onReady }: ConceptDefinitionProps) {
  const { rawNodes, rawEdges } = useMemo<{ rawNodes: Node[]; rawEdges: Edge[] }>(() => {
    const nodes: Node[] = [
      { id: 'term', type: 'term', position: { x: 0, y: 0 }, data: { term: data.term, category: data.category, one_line: data.one_line, plain_english: data.plain_english }, width: 360, height: 185, draggable: false },
      { id: 'example', type: 'example', position: { x: 0, y: 0 }, data: { company: data.real_world_example.company, what_they_did: data.real_world_example.what_they_did, result: data.real_world_example.result }, width: 300, height: 150, draggable: false },
      { id: 'myth', type: 'myth', position: { x: 0, y: 0 }, data: { common_misconception: data.common_misconception }, width: 300, height: 115, draggable: false },
    ]
    const edges: Edge[] = [
      { id: 'e1', source: 'term', target: 'example', markerEnd: { type: MarkerType.ArrowClosed, color: '#10B981' }, style: { stroke: '#10B98160', strokeWidth: 2 } },
      { id: 'e2', source: 'example', target: 'myth', markerEnd: { type: MarkerType.ArrowClosed, color: 'var(--partner-accent, #F59E0B)' }, style: { stroke: 'color-mix(in srgb, var(--partner-accent, #F59E0B) 38%, transparent)', strokeWidth: 2 } },
    ]
    return { rawNodes: nodes, rawEdges: edges }
  }, [data])

  const { nodes: layoutNodes, edges: layoutEdges } = useFlowLayout(rawNodes, rawEdges, { direction: 'TB', rankSep: 80, nodeSep: 40 })
  const [nodes, , onNodesChange] = useNodesState(layoutNodes)
  const [edges, , onEdgesChange] = useEdgesState(layoutEdges)
  const onInit = useCallback(() => { if (isActive) onReady?.() }, [isActive, onReady])

  return (
    <div className="relative h-full w-full flex flex-col bg-[#080808] px-8 md:px-16 py-12">
      <motion.div className="flex-1 flex flex-col pb-20" initial={{ opacity: 0, y: 20 }} animate={isActive ? { opacity: 1, y: 0 } : { opacity: 0, y: 20 }} transition={{ duration: 0.5 }} onAnimationComplete={() => { if (isActive) onReady?.() }}>
        <div className="mb-6">
          <h2 className="text-3xl font-bold text-white mb-1">{data.term}</h2>
          <p className="text-[#94A3B8] text-sm">{data.category}</p>
        </div>
        <div className="flex-1 rounded-2xl overflow-hidden border border-[#1a1a1a]">
          <ReactFlow nodes={nodes} edges={edges} onNodesChange={onNodesChange} onEdgesChange={onEdgesChange} nodeTypes={nodeTypes} onInit={onInit} fitView fitViewOptions={{ padding: 0.2 }} minZoom={0.85} nodesDraggable={false} nodesConnectable={false} elementsSelectable={false} proOptions={{ hideAttribution: true }} style={{ width: '100%', height: '100%' }}>
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
