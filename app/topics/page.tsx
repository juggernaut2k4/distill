'use client'

import { useState, useRef, useEffect, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { motion, AnimatePresence } from 'framer-motion'
import {
  ArrowRight, Check, Plus, X, RefreshCw, Sparkles, PenLine, CheckSquare, Square, ChevronDown, ChevronUp,
} from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { ALL_DOMAINS } from '@/lib/learning/taxonomy'

type View = 'loading' | 'selection' | 'input' | 'generating' | 'manual'

interface TopicCategory {
  category: string
  color: string
  topics: string[]
}

interface CatalogTopic {
  id: string
  title: string
  description: string
  domain_id: string
  relevant_maturity: string[]
  tags: string[]
}

const CATEGORIES: Array<{ name: string; color: string; keywords: string[] }> = [
  {
    name: 'AI Strategy & Leadership',
    color: '#7C3AED',
    keywords: ['strategy', 'leadership', 'governance', 'roi', 'vendor', 'culture', 'risk', 'executive', 'board', 'roadmap', 'ambition', 'posture', 'framework', 'maturity', 'invest', 'decision', 'oversight', 'committee'],
  },
  {
    name: 'Technology Foundations',
    color: '#06B6D4',
    keywords: ['language model', 'llm', 'generative', 'machine learning', 'foundation model', 'neural', 'gpt', 'claude', 'gemini', 'data strateg', 'data infrastructure', 'data readiness', 'security', 'privacy', 'technical', 'how ai', 'what ai', 'token', 'training', 'model'],
  },
  {
    name: 'Operational AI',
    color: '#10B981',
    keywords: ['operation', 'supply chain', 'customer experience', 'cx', 'process automation', 'finance', 'forecast', 'hr ', 'talent', 'marketing', 'sales', 'revenue', 'automation', 'workflow', 'procurement', 'logistics', 'demand'],
  },
  {
    name: 'Team & Organisation',
    color: '#F59E0B',
    keywords: ['team', 'upskill', 'change management', 'people', 'hiring', 'recruit', 'organisation', 'organization', 'culture', 'mindset', 'adoption', 'champion', 'ethics', 'responsible', 'bias', 'fairness', 'interdisciplinary', 'center of excellence'],
  },
  {
    name: 'Competitive Edge',
    color: '#A855F7',
    keywords: ['competitive', 'intelligence', 'industry', 'product development', 'emerging', 'trend', 'regulation', 'compliance', 'future', 'disruption', 'market', 'first mover', 'agentic', 'multi-modal', 'frontier'],
  },
]

const DOMAIN_COLORS = ['#7C3AED', '#06B6D4', '#10B981', '#F59E0B', '#A855F7', '#EF4444', '#3B82F6', '#EC4899']

function catalogTopicsToGroups(topics: CatalogTopic[], userDomains: string[]): TopicCategory[] {
  const map = new Map<string, CatalogTopic[]>()
  for (const t of topics) {
    const bucket = map.get(t.domain_id) ?? []
    bucket.push(t)
    map.set(t.domain_id, bucket)
  }

  const orderedIds: string[] = [...userDomains]
  for (const id of Array.from(map.keys())) {
    if (!orderedIds.includes(id)) orderedIds.push(id)
  }

  return orderedIds
    .filter((id) => map.has(id))
    .map((domainId, idx) => {
      const domainDef = ALL_DOMAINS.find((d) => d.id === domainId)
      const label = domainDef?.label ?? domainId.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
      return {
        category: label,
        color: DOMAIN_COLORS[idx % DOMAIN_COLORS.length],
        topics: (map.get(domainId) ?? []).map((t) => t.title),
      }
    })
}

function categorizeTopics(topics: string[]): TopicCategory[] {
  const buckets: Record<string, string[]> = {}
  const uncategorized: string[] = []

  for (const cat of CATEGORIES) buckets[cat.name] = []

  for (const topic of topics) {
    const lower = topic.toLowerCase()
    let bestCategory: string | null = null
    let bestScore = 0

    for (const cat of CATEGORIES) {
      const score = cat.keywords.filter((kw) => lower.includes(kw)).length
      if (score > bestScore) {
        bestScore = score
        bestCategory = cat.name
      }
    }

    if (bestCategory) {
      buckets[bestCategory].push(topic)
    } else {
      uncategorized.push(topic)
    }
  }

  // Distribute uncategorized round-robin across non-empty categories first,
  // then fill any empty category, then fallback to first category
  const order = CATEGORIES.map((c) => c.name)
  let idx = 0
  for (const topic of uncategorized) {
    buckets[order[idx % order.length]].push(topic)
    idx++
  }

  return CATEGORIES
    .map((cat) => ({ category: cat.name, color: cat.color, topics: buckets[cat.name] }))
    .filter((g) => g.topics.length > 0)
}

interface StoredProfile {
  role?: string
  domains?: string[]
  primaryDomain?: string
}

interface ExploreGroup {
  domainId: string
  label: string
  icon: string
  topics: CatalogTopic[]
}

export default function TopicsPage() {
  const router = useRouter()
  const [view, setView] = useState<View>('loading')
  const [objectives, setObjectives] = useState('')
  const [generateError, setGenerateError] = useState<string | null>(null)
  const [topicGroups, setTopicGroups] = useState<TopicCategory[]>([])
  const [exploreCatalog, setExploreCatalog] = useState<CatalogTopic[]>([])
  const [exploreOpen, setExploreOpen] = useState(false)
  const [manualTopics, setManualTopics] = useState<string[]>([])
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [customInput, setCustomInput] = useState('')
  const [saving, setSaving] = useState(false)
  const [storedProfile, setStoredProfile] = useState<StoredProfile | null>(null)
  const customInputRef = useRef<HTMLInputElement>(null)

  const allGeneratedTopics = topicGroups.flatMap((g) => g.topics)
  const allTopics = [...allGeneratedTopics, ...manualTopics]
  const allSelected = allTopics.length > 0 && selected.size === allTopics.length

  const curriculumTitle = useMemo(() => {
    const domains = storedProfile?.domains ?? []
    if (domains.length === 1) {
      const label = ALL_DOMAINS.find((d) => d.id === domains[0])?.label
        ?? domains[0].replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
      return `Your ${label} curriculum`
    }
    if (domains.length > 1) {
      return 'Your personalised curriculum'
    }
    return 'Your learning curriculum'
  }, [storedProfile])

  // Group explore catalog topics by domain
  const exploreByDomain = useMemo<ExploreGroup[]>(() => {
    const map = new Map<string, CatalogTopic[]>()
    for (const t of exploreCatalog) {
      const bucket = map.get(t.domain_id) ?? []
      bucket.push(t)
      map.set(t.domain_id, bucket)
    }
    return Array.from(map.entries()).map(([domainId, topics]) => {
      const domainDef = ALL_DOMAINS.find((d) => d.id === domainId)
      return {
        domainId,
        label: domainDef?.label ?? domainId.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()),
        icon: domainDef?.icon ?? '📚',
        topics,
      }
    })
  }, [exploreCatalog])

  // Load topics on mount
  useEffect(() => {
    // Read onboarding profile from localStorage — covers brand-new users before DB profile is saved
    let profile: StoredProfile | null = null
    try {
      const raw = localStorage.getItem('clio_onboarding')
      if (raw) profile = JSON.parse(raw) as StoredProfile
    } catch { /* ignore */ }
    setStoredProfile(profile)

    async function loadTopics() {
      // 1. Try catalog — pass localStorage profile as query params so new users get the right results
      try {
        const params = new URLSearchParams()
        if (profile?.role) params.set('role', profile.role)
        if (profile?.domains?.length) params.set('domains', profile.domains.join(','))

        const catalogRes = await fetch(`/api/topics/catalog?${params}`)
        const catalogData = await catalogRes.json() as {
          topics?: CatalogTopic[]
          domains?: string[]
          seeded?: boolean
          error?: string
        }

        if (catalogData.topics && catalogData.topics.length > 0) {
          const userDomains: string[] = catalogData.domains ?? profile?.domains ?? []

          // Curated = topics from the user's explicitly selected domains
          const curated = userDomains.length > 0
            ? catalogData.topics.filter((t) => userDomains.includes(t.domain_id))
            : catalogData.topics.slice(0, 14)

          // Explore = the rest, de-duped from curated
          const curatedIds = new Set(curated.map((t) => t.id))
          const explore = catalogData.topics.filter((t) => !curatedIds.has(t.id))

          if (curated.length > 0) {
            setTopicGroups(catalogTopicsToGroups(curated, userDomains))
            setSelected(new Set(curated.map((t) => t.title)))
            setExploreCatalog(explore)
            setView('selection')
            return
          }
        }
      } catch {
        // catalog failed — fall through
      }

      // 2. Fallback: generate using actual domain names from localStorage (not the static AI curriculum)
      try {
        const domainLabels = (profile?.domains ?? [])
          .map((id) => ALL_DOMAINS.find((d) => d.id === id)?.label ?? id)
          .join(', ')

        const objectivesText = domainLabels
          ? `I am a ${profile?.role ?? 'professional'} focused on ${domainLabels}. Generate practical learning topics for these domains.`
          : `I am a ${profile?.role ?? 'business professional'}. Generate practical learning topics relevant to my role.`

        const genRes = await fetch('/api/topics/generate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ objectives: objectivesText }),
        })
        const genData = await genRes.json() as { topics?: string[]; error?: string }
        if (genData.topics && genData.topics.length > 0) {
          setTopicGroups(categorizeTopics(genData.topics))
          setSelected(new Set(genData.topics))
          setView('selection')
          return
        }
      } catch { /* ignore */ }

      setView('input')
    }

    loadTopics()
  }, [])

  // ── Actions ────────────────────────────────────────────────────────────────

  async function handleGenerate() {
    const trimmed = objectives.trim()
    if (trimmed.length < 5) return
    setView('generating')
    setGenerateError(null)

    try {
      const res = await fetch('/api/topics/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ objectives: trimmed }),
      })
      const data = await res.json() as { topics?: string[]; error?: string }

      if (!res.ok || !data.topics || data.topics.length === 0) {
        setGenerateError(data.error ?? 'Could not generate topics. You can enter them manually below.')
        setView('input')
        return
      }

      setTopicGroups(categorizeTopics(data.topics))
      setManualTopics([])
      setSelected(new Set(data.topics))
      setView('selection')
    } catch {
      setGenerateError('Network error — please try again or enter topics manually.')
      setView('input')
    }
  }

  function toggleTopic(topic: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(topic)) next.delete(topic)
      else next.add(topic)
      return next
    })
  }

  function toggleCategory(topics: string[]) {
    const allIn = topics.every((t) => selected.has(t))
    setSelected((prev) => {
      const next = new Set(prev)
      if (allIn) {
        topics.forEach((t) => next.delete(t))
      } else {
        topics.forEach((t) => next.add(t))
      }
      return next
    })
  }

  function toggleAll() {
    if (allSelected) {
      setSelected(new Set())
    } else {
      setSelected(new Set(allTopics))
    }
  }

  function addCustomTopic() {
    const trimmed = customInput.trim()
    if (!trimmed) return
    if (allTopics.some((t) => t.toLowerCase() === trimmed.toLowerCase())) {
      setCustomInput('')
      return
    }
    setManualTopics((prev) => [...prev, trimmed])
    setSelected((prev) => new Set(Array.from(prev).concat(trimmed)))
    setCustomInput('')
    customInputRef.current?.focus()

    // Fire-and-forget: persist custom topic to catalog for future users
    fetch('/api/topics/catalog/add', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: trimmed,
        role: storedProfile?.role,
        domains: storedProfile?.domains,
      }),
    }).catch(() => { /* non-fatal */ })
  }

  function addExploreTopic(title: string) {
    if (manualTopics.includes(title)) {
      removeManualTopic(title)
      return
    }
    setManualTopics((prev) => [...prev, title])
    setSelected((prev) => new Set(Array.from(prev).concat(title)))
  }

  function removeManualTopic(topic: string) {
    setManualTopics((prev) => prev.filter((t) => t !== topic))
    setSelected((prev) => {
      const next = new Set(prev)
      next.delete(topic)
      return next
    })
  }

  function handleEnterManual() {
    setManualTopics([])
    setSelected(new Set())
    setView('manual')
  }

  async function handleContinue() {
    setSaving(true)
    try {
      await fetch('/api/topics', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ topics: Array.from(selected) }),
      })
    } catch {
      // non-fatal
    }
    router.push('/dashboard/plan')
  }

  function handleSkip() {
    router.push('/dashboard/plan')
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-[#080808]">
      {/* Header */}
      <div className="border-b border-[#222222] px-6 py-4 flex items-center justify-between">
        <span className="text-lg font-extrabold text-white tracking-tight">
          Clio <span className="text-[#7C3AED] text-xs font-semibold uppercase tracking-widest ml-1">AI</span>
        </span>
        <button onClick={handleSkip} className="text-sm text-[#475569] hover:text-[#94A3B8] transition-colors">
          Skip for now →
        </button>
      </div>

      <div className="max-w-3xl mx-auto px-6 py-12">
        <AnimatePresence mode="wait">

          {/* ── LOADING ─────────────────────────────────────────────────── */}
          {view === 'loading' && (
            <motion.div
              key="loading"
              initial={{ opacity: 0, scale: 0.97 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.3 }}
              className="flex flex-col items-center justify-center py-24 text-center"
            >
              <div className="relative w-20 h-20 mb-8">
                <motion.div
                  animate={{ scale: [1, 1.35, 1], opacity: [0.5, 0, 0.5] }}
                  transition={{ duration: 1.8, repeat: Infinity, ease: 'easeInOut' }}
                  className="absolute inset-0 rounded-full bg-[#7C3AED]"
                />
                <div className="relative w-20 h-20 rounded-full bg-[#7C3AED] flex items-center justify-center">
                  <Sparkles size={28} className="text-white" />
                </div>
              </div>
              <h2 className="text-2xl font-bold text-white mb-2">Building your topic list...</h2>
              <p className="text-[#475569] text-sm">Personalising based on your profile</p>
              <div className="mt-6 flex gap-2">
                {[0, 1, 2].map((i) => (
                  <motion.div
                    key={i}
                    animate={{ opacity: [0.2, 1, 0.2] }}
                    transition={{ duration: 1.2, repeat: Infinity, delay: i * 0.2 }}
                    className="w-2 h-2 rounded-full bg-[#7C3AED]"
                  />
                ))}
              </div>
            </motion.div>
          )}

          {/* ── SELECTION (categorized) ──────────────────────────────────── */}
          {view === 'selection' && (
            <motion.div
              key="selection"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -16 }}
              transition={{ duration: 0.35 }}
              className="space-y-8"
            >
              {/* Header */}
              <div>
                <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-purple-950/40 border border-purple-800/30 text-[#A855F7] text-sm font-medium mb-4">
                  <Sparkles size={14} />
                  Personalised for your profile
                </div>
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <h1 className="text-3xl font-extrabold text-white">{curriculumTitle}</h1>
                    <p className="text-[#94A3B8] mt-1 text-sm">
                      {selected.size} of {allTopics.length} topics selected — deselect any you&apos;d like to skip
                    </p>
                  </div>
                  <button
                    onClick={toggleAll}
                    className="flex items-center gap-2 text-sm font-medium text-[#475569] hover:text-[#94A3B8] transition-colors mt-1 whitespace-nowrap"
                  >
                    {allSelected
                      ? <CheckSquare size={15} className="text-[#7C3AED]" />
                      : <Square size={15} />}
                    {allSelected ? 'Deselect all' : 'Select all'}
                  </button>
                </div>
              </div>

              {/* Category groups */}
              <div className="space-y-6">
                {topicGroups.map((group, gi) => {
                  const groupSelected = group.topics.filter((t) => selected.has(t)).length
                  const allGroupSelected = groupSelected === group.topics.length
                  return (
                    <motion.div
                      key={group.category}
                      initial={{ opacity: 0, y: 12 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: gi * 0.07 }}
                      className="bg-[#111111] border border-[#222222] rounded-2xl overflow-hidden"
                    >
                      {/* Category header */}
                      <div
                        className="flex items-center justify-between px-5 py-3.5 border-b border-[#222222]"
                        style={{ borderLeftWidth: 3, borderLeftColor: group.color }}
                      >
                        <div className="flex items-center gap-2.5">
                          <div className="w-2 h-2 rounded-full" style={{ backgroundColor: group.color }} />
                          <span className="text-sm font-bold text-white tracking-tight">{group.category}</span>
                          <span className="text-xs text-[#475569]">{groupSelected}/{group.topics.length}</span>
                        </div>
                        <button
                          onClick={() => toggleCategory(group.topics)}
                          className="text-xs text-[#475569] hover:text-[#94A3B8] transition-colors flex items-center gap-1"
                        >
                          {allGroupSelected
                            ? <><CheckSquare size={12} style={{ color: group.color }} /> Deselect all</>
                            : <><Square size={12} /> Select all</>}
                        </button>
                      </div>

                      {/* Topics in this category */}
                      <div className="p-3 grid grid-cols-1 sm:grid-cols-2 gap-2">
                        {group.topics.map((topic) => {
                          const isSelected = selected.has(topic)
                          return (
                            <button
                              key={topic}
                              onClick={() => toggleTopic(topic)}
                              className={`flex items-center gap-3 px-4 py-3 rounded-xl border text-left text-sm font-medium transition-all duration-150 ${
                                isSelected
                                  ? 'border-[#7C3AED] text-white'
                                  : 'bg-[#1A1A1A] border-[#2A2A2A] text-[#94A3B8] hover:border-[#333] hover:text-white'
                              }`}
                              style={isSelected ? { backgroundColor: `${group.color}18`, borderColor: group.color } : {}}
                            >
                              <div
                                className="w-4 h-4 rounded flex items-center justify-center flex-shrink-0 border transition-all"
                                style={isSelected
                                  ? { backgroundColor: group.color, borderColor: group.color }
                                  : { borderColor: '#444', backgroundColor: 'transparent' }}
                              >
                                {isSelected && <Check size={9} className="text-white" strokeWidth={3} />}
                              </div>
                              <span className="leading-snug">{topic}</span>
                            </button>
                          )
                        })}
                      </div>
                    </motion.div>
                  )
                })}

                {/* Custom / manually added topics */}
                {manualTopics.length > 0 && (
                  <div className="bg-[#111111] border border-[#222222] rounded-2xl overflow-hidden">
                    <div className="flex items-center gap-2.5 px-5 py-3.5 border-b border-[#222222]" style={{ borderLeftWidth: 3, borderLeftColor: '#475569' }}>
                      <div className="w-2 h-2 rounded-full bg-[#475569]" />
                      <span className="text-sm font-bold text-white tracking-tight">Your Custom Topics</span>
                    </div>
                    <div className="p-3 space-y-2">
                      {manualTopics.map((topic) => {
                        const isSelected = selected.has(topic)
                        return (
                          <div key={topic} className="flex items-center gap-2">
                            <button
                              onClick={() => toggleTopic(topic)}
                              className={`flex-1 flex items-center gap-3 px-4 py-3 rounded-xl border text-left text-sm font-medium transition-all duration-150 ${
                                isSelected
                                  ? 'bg-purple-950/30 border-[#7C3AED] text-white'
                                  : 'bg-[#1A1A1A] border-[#2A2A2A] text-[#94A3B8] hover:border-[#333] hover:text-white'
                              }`}
                            >
                              <div className={`w-4 h-4 rounded flex items-center justify-center flex-shrink-0 border transition-all ${isSelected ? 'bg-[#7C3AED] border-[#7C3AED]' : 'border-[#444] bg-transparent'}`}>
                                {isSelected && <Check size={9} className="text-white" strokeWidth={3} />}
                              </div>
                              {topic}
                            </button>
                            <button
                              onClick={() => removeManualTopic(topic)}
                              className="w-9 h-9 flex items-center justify-center rounded-xl border border-[#222] text-[#475569] hover:text-red-400 hover:border-red-900/50 transition-colors flex-shrink-0"
                            >
                              <X size={13} />
                            </button>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                )}
              </div>

              {/* Explore more topics */}
              {exploreByDomain.length > 0 && (
                <div className="border border-[#222222] rounded-2xl overflow-hidden">
                  <button
                    onClick={() => setExploreOpen((o) => !o)}
                    className="w-full flex items-center justify-between px-5 py-4 text-left hover:bg-[#1A1A1A] transition-colors"
                  >
                    <div className="flex items-center gap-2.5">
                      <span className="text-sm font-bold text-white">Explore more topics</span>
                      <span className="text-xs text-[#475569] ml-2">{exploreCatalog.length} available</span>
                    </div>
                    {exploreOpen
                      ? <ChevronUp size={16} className="text-[#475569]" />
                      : <ChevronDown size={16} className="text-[#475569]" />}
                  </button>
                  <AnimatePresence>
                    {exploreOpen && (
                      <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: 'auto', opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: 0.25 }}
                        className="overflow-hidden border-t border-[#222222]"
                      >
                        <div className="p-4 space-y-5">
                          {exploreByDomain.map((group) => (
                            <div key={group.domainId}>
                              <p className="text-xs font-semibold text-[#475569] uppercase tracking-wider mb-2">
                                {group.icon} {group.label}
                              </p>
                              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                                {group.topics.map((topic) => {
                                  const isSelected = selected.has(topic.title)
                                  return (
                                    <button
                                      key={topic.id}
                                      onClick={() => addExploreTopic(topic.title)}
                                      className={`flex items-center gap-3 px-4 py-3 rounded-xl border text-left text-sm font-medium transition-all duration-150 ${
                                        isSelected
                                          ? 'bg-purple-950/30 border-[#7C3AED] text-white'
                                          : 'bg-[#1A1A1A] border-[#2A2A2A] text-[#94A3B8] hover:border-[#333] hover:text-white'
                                      }`}
                                    >
                                      <div
                                        className={`w-4 h-4 rounded flex items-center justify-center flex-shrink-0 border transition-all ${
                                          isSelected ? 'bg-[#7C3AED] border-[#7C3AED]' : 'border-[#444] bg-transparent'
                                        }`}
                                      >
                                        {isSelected && <Check size={9} className="text-white" strokeWidth={3} />}
                                      </div>
                                      <span className="leading-snug">{topic.title}</span>
                                    </button>
                                  )
                                })}
                              </div>
                            </div>
                          ))}
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              )}

              {/* Add custom topic */}
              <div>
                <p className="text-xs text-[#475569] mb-2 uppercase tracking-wider font-semibold">Add a topic</p>
                <div className="flex gap-2">
                  <input
                    ref={customInputRef}
                    type="text"
                    value={customInput}
                    onChange={(e) => setCustomInput(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && addCustomTopic()}
                    placeholder="Type a topic and press Enter..."
                    className="flex-1 bg-[#111111] border border-[#222222] focus:border-[#7C3AED] text-white rounded-xl px-4 py-2.5 text-sm placeholder-[#333] focus:outline-none transition-colors"
                  />
                  <button
                    onClick={addCustomTopic}
                    disabled={!customInput.trim()}
                    className="w-10 h-10 flex items-center justify-center rounded-xl border border-[#333] text-[#475569] hover:text-white hover:border-[#7C3AED] disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                  >
                    <Plus size={16} />
                  </button>
                </div>
              </div>

              {/* Continue + escape hatch */}
              <div className="space-y-4">
                <div className="flex items-center gap-4 flex-wrap">
                  <Button
                    onClick={handleContinue}
                    disabled={saving || selected.size === 0}
                    size="lg"
                    className="gap-2"
                  >
                    {saving
                      ? 'Building your plan...'
                      : `Continue with ${selected.size} topic${selected.size !== 1 ? 's' : ''}`}
                    <ArrowRight size={16} />
                  </Button>
                  {selected.size === 0 && (
                    <p className="text-xs text-[#475569]">Select at least one topic to continue</p>
                  )}
                </div>
                <div className="flex items-center gap-5">
                  <button
                    onClick={() => setView('input')}
                    className="inline-flex items-center gap-1.5 text-sm text-[#475569] hover:text-[#94A3B8] transition-colors"
                  >
                    <RefreshCw size={13} />
                    These don&apos;t match — describe what I want
                  </button>
                  <span className="text-[#333] text-xs">·</span>
                  <button
                    onClick={handleEnterManual}
                    className="inline-flex items-center gap-1.5 text-sm text-[#475569] hover:text-[#94A3B8] transition-colors"
                  >
                    <PenLine size={13} />
                    Enter topics manually
                  </button>
                </div>
              </div>
            </motion.div>
          )}

          {/* ── INPUT ───────────────────────────────────────────────────── */}
          {view === 'input' && (
            <motion.div
              key="input"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -16 }}
              transition={{ duration: 0.35 }}
              className="space-y-8"
            >
              <div>
                {topicGroups.length > 0 && (
                  <button
                    onClick={() => setView('selection')}
                    className="text-xs text-[#475569] hover:text-[#94A3B8] transition-colors mb-4 block"
                  >
                    ← Back to your topic list
                  </button>
                )}
                <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-purple-950/40 border border-purple-800/30 text-[#A855F7] text-sm font-medium mb-5">
                  <Sparkles size={14} />
                  AI-personalised curriculum
                </div>
                <h1 className="text-4xl font-extrabold text-white mb-3 leading-tight">
                  What do you want to learn?
                </h1>
                <p className="text-[#94A3B8] text-lg">
                  Describe your goals and Clio will build a new topic list tailored to you.
                </p>
              </div>

              <div className="space-y-3">
                <textarea
                  value={objectives}
                  onChange={(e) => setObjectives(e.target.value)}
                  rows={5}
                  placeholder="e.g. I want to understand how AI can help my sales and marketing team, evaluate AI vendors without being misled, and know enough to lead an AI transformation at my company without relying on my tech team to explain everything."
                  className="w-full bg-[#111111] border border-[#222222] focus:border-[#7C3AED] text-white rounded-2xl px-5 py-4 text-sm leading-relaxed placeholder-[#333] resize-none focus:outline-none transition-colors"
                />
                {generateError && (
                  <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="text-sm text-red-400 px-1">
                    {generateError}
                  </motion.p>
                )}
                <Button
                  onClick={handleGenerate}
                  disabled={objectives.trim().length < 5}
                  size="lg"
                  className="w-full gap-2 justify-center"
                >
                  <Sparkles size={16} />
                  Generate my topic list
                  <ArrowRight size={16} />
                </Button>
              </div>

              <div className="text-center">
                <button
                  onClick={handleEnterManual}
                  className="inline-flex items-center gap-1.5 text-sm text-[#475569] hover:text-[#94A3B8] transition-colors"
                >
                  <PenLine size={13} />
                  I know what I want — enter topics directly
                </button>
              </div>
            </motion.div>
          )}

          {/* ── GENERATING ──────────────────────────────────────────────── */}
          {view === 'generating' && (
            <motion.div
              key="generating"
              initial={{ opacity: 0, scale: 0.97 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.3 }}
              className="flex flex-col items-center justify-center py-24 text-center"
            >
              <div className="relative w-20 h-20 mb-8">
                <motion.div
                  animate={{ scale: [1, 1.35, 1], opacity: [0.5, 0, 0.5] }}
                  transition={{ duration: 1.8, repeat: Infinity, ease: 'easeInOut' }}
                  className="absolute inset-0 rounded-full bg-[#7C3AED]"
                />
                <div className="relative w-20 h-20 rounded-full bg-[#7C3AED] flex items-center justify-center">
                  <Sparkles size={28} className="text-white" />
                </div>
              </div>
              <h2 className="text-2xl font-bold text-white mb-2">Building your topic list...</h2>
              <p className="text-[#475569] text-sm">Clio is analysing your objectives</p>
              <div className="mt-6 flex gap-2">
                {[0, 1, 2].map((i) => (
                  <motion.div
                    key={i}
                    animate={{ opacity: [0.2, 1, 0.2] }}
                    transition={{ duration: 1.2, repeat: Infinity, delay: i * 0.2 }}
                    className="w-2 h-2 rounded-full bg-[#7C3AED]"
                  />
                ))}
              </div>
            </motion.div>
          )}

          {/* ── MANUAL ENTRY ────────────────────────────────────────────── */}
          {view === 'manual' && (
            <motion.div
              key="manual"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -16 }}
              transition={{ duration: 0.35 }}
              className="space-y-6"
            >
              <div>
                <button
                  onClick={() => topicGroups.length > 0 ? setView('selection') : setView('input')}
                  className="text-xs text-[#475569] hover:text-[#94A3B8] transition-colors mb-4 block"
                >
                  ← Back
                </button>
                <h1 className="text-3xl font-extrabold text-white mt-3">Enter your topics</h1>
                <p className="text-[#94A3B8] mt-1 text-sm">
                  Add each topic you want to learn. Press Enter or the + button after each one.
                </p>
              </div>

              <div className="flex gap-2">
                <input
                  ref={customInputRef}
                  type="text"
                  value={customInput}
                  onChange={(e) => setCustomInput(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && addCustomTopic()}
                  placeholder="e.g. AI for procurement teams..."
                  className="flex-1 bg-[#111111] border border-[#222222] focus:border-[#7C3AED] text-white rounded-xl px-4 py-3 text-sm placeholder-[#333] focus:outline-none transition-colors"
                  autoFocus
                />
                <button
                  onClick={addCustomTopic}
                  disabled={!customInput.trim()}
                  className="w-11 h-11 flex items-center justify-center rounded-xl border border-[#333] text-[#475569] hover:text-white hover:border-[#7C3AED] disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                >
                  <Plus size={16} />
                </button>
              </div>

              <AnimatePresence>
                {manualTopics.length > 0 && (
                  <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-2">
                    {manualTopics.map((topic, i) => (
                      <motion.div
                        key={topic}
                        initial={{ opacity: 0, x: -10 }}
                        animate={{ opacity: 1, x: 0 }}
                        exit={{ opacity: 0, x: 10 }}
                        transition={{ delay: i * 0.03 }}
                        className="flex items-center gap-3 px-4 py-3 rounded-xl bg-[#111111] border border-[#222222]"
                      >
                        <div className="w-5 h-5 rounded bg-[#7C3AED] border border-[#7C3AED] flex items-center justify-center flex-shrink-0">
                          <Check size={11} className="text-white" strokeWidth={3} />
                        </div>
                        <span className="flex-1 text-sm text-white">{topic}</span>
                        <button onClick={() => removeManualTopic(topic)} className="text-[#475569] hover:text-red-400 transition-colors">
                          <X size={14} />
                        </button>
                      </motion.div>
                    ))}
                  </motion.div>
                )}
              </AnimatePresence>

              {manualTopics.length === 0 && (
                <p className="text-sm text-[#333] text-center py-8">
                  No topics added yet — type one above and press Enter
                </p>
              )}

              <div className="flex items-center gap-4 flex-wrap">
                <Button
                  onClick={handleContinue}
                  disabled={saving || manualTopics.length === 0}
                  size="lg"
                  className="gap-2"
                >
                  {saving
                    ? 'Building your plan...'
                    : `Continue with ${manualTopics.length} topic${manualTopics.length !== 1 ? 's' : ''}`}
                  <ArrowRight size={16} />
                </Button>
                <button
                  onClick={() => setView('input')}
                  className="text-sm text-[#475569] hover:text-[#94A3B8] transition-colors"
                >
                  Or generate topics with AI →
                </button>
              </div>
            </motion.div>
          )}

        </AnimatePresence>
      </div>
    </div>
  )
}
