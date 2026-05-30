'use client'

import { useState, useRef, useEffect, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { motion, AnimatePresence } from 'framer-motion'
import {
  ArrowRight, Check, Plus, X, RefreshCw, Sparkles, PenLine,
  ChevronDown, ChevronUp, TrendingUp,
} from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { ALL_DOMAINS } from '@/lib/learning/taxonomy'

// ── Types ──────────────────────────────────────────────────────────────────────

type View = 'loading' | 'selection' | 'input' | 'generating' | 'manual'

/** Topic shape returned by the current catalog API format */
interface CatalogTopic {
  id: string
  title: string
  description: string
  domain_id: string
  relevant_maturity: string[]
  tags: string[]
}

/** Extended topic shape returned by the new catalog API format */
interface FeaturedTopic extends CatalogTopic {
  trending_score?: number
  popularity_rank?: number
  is_trending?: boolean
}

/** Old catalog API response: { topics, role, domains } */
interface OldCatalogResponse {
  topics: CatalogTopic[]
  domains?: string[]
  role?: string | null
  seeded?: boolean
  error?: string
}

/** New catalog API response: { featured, other, role, industry, maturity, from_cache } */
interface NewCatalogResponse {
  featured: FeaturedTopic[]
  other: FeaturedTopic[]
  role?: string | null
  industry?: string | null
  maturity?: string | null
  from_cache?: boolean
  error?: string
}

type CatalogResponse = OldCatalogResponse | NewCatalogResponse

/** Group for the "Other topics" collapsed section */
interface ExploreGroup {
  domainId: string
  label: string
  icon: string
  topics: FeaturedTopic[]
}

interface StoredProfile {
  role?: string
  domains?: string[]
  primaryDomain?: string
  domainProficiency?: Record<string, string>
  learningGoal?: string
}

// ── Constants ──────────────────────────────────────────────────────────────────

const DOMAIN_COLORS = ['#7C3AED', '#06B6D4', '#10B981', '#F59E0B', '#A855F7', '#EF4444', '#3B82F6', '#EC4899']
const MAX_SELECTIONS = 10

// ── Helpers ────────────────────────────────────────────────────────────────────

function isNewFormat(data: CatalogResponse): data is NewCatalogResponse {
  return 'featured' in data
}

function domainLabel(domainId: string): string {
  const d = ALL_DOMAINS.find((d) => d.id === domainId)
  return d?.label ?? domainId.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
}

function domainIcon(domainId: string): string {
  return ALL_DOMAINS.find((d) => d.id === domainId)?.icon ?? '📚'
}

function groupByDomain(topics: FeaturedTopic[]): ExploreGroup[] {
  const map = new Map<string, FeaturedTopic[]>()
  for (const t of topics) {
    const bucket = map.get(t.domain_id) ?? []
    bucket.push(t)
    map.set(t.domain_id, bucket)
  }
  return Array.from(map.entries()).map(([domainId, items]) => ({
    domainId,
    label: domainLabel(domainId),
    icon: domainIcon(domainId),
    topics: items,
  }))
}

/** Convert old-format catalog topics to FeaturedTopic (no extra fields) */
function toFeaturedTopics(topics: CatalogTopic[]): FeaturedTopic[] {
  return topics.map((t) => ({ ...t }))
}

/** Friendly role title for the section heading */
function roleTitle(role: string | null | undefined): string {
  if (!role) return 'You'
  const r = role.toLowerCase()
  if (r === 'ceo' || r === 'cto' || r === 'coo' || r === 'cfo' || r === 'cso') return `${role.toUpperCase()}s`
  return role.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()) + 's'
}

// ── Skeleton card ─────────────────────────────────────────────────────────────

function SkeletonCard() {
  return (
    <div className="bg-[#111111] border border-[#222222] rounded-2xl p-5 animate-pulse">
      <div className="h-4 bg-[#1A1A1A] rounded w-3/4 mb-3" />
      <div className="h-3 bg-[#1A1A1A] rounded w-full mb-1.5" />
      <div className="h-3 bg-[#1A1A1A] rounded w-2/3" />
    </div>
  )
}

// ── Featured topic card ────────────────────────────────────────────────────────

interface FeaturedCardProps {
  topic: FeaturedTopic
  isSelected: boolean
  onToggle: (title: string) => void
  atMax: boolean
  colorIdx: number
}

function FeaturedCard({ topic, isSelected, onToggle, atMax, colorIdx }: FeaturedCardProps) {
  const color = DOMAIN_COLORS[colorIdx % DOMAIN_COLORS.length]

  return (
    <motion.button
      onClick={() => onToggle(topic.title)}
      disabled={!isSelected && atMax}
      whileHover={!isSelected && !atMax ? { scale: 1.02, y: -2 } : {}}
      whileTap={{ scale: 0.98 }}
      transition={{ type: 'spring', stiffness: 400, damping: 25 }}
      className={`relative w-full text-left rounded-2xl border p-5 transition-all duration-150 focus:outline-none
        ${isSelected
          ? 'border-[#7C3AED] bg-[#1a0f2e]'
          : atMax
            ? 'border-[#222222] bg-[#111111] opacity-50 cursor-not-allowed'
            : 'border-[#222222] bg-[#111111] hover:border-[#333333]'
        }`}
    >
      {/* Selected checkmark */}
      {isSelected && (
        <div className="absolute top-3.5 right-3.5 w-5 h-5 rounded-full bg-[#7C3AED] flex items-center justify-center">
          <Check size={11} className="text-white" strokeWidth={3} />
        </div>
      )}

      {/* Trending badge */}
      {topic.is_trending && (
        <div className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-[#7C3AED] text-white text-[10px] font-semibold uppercase tracking-wide mb-2.5">
          <TrendingUp size={9} />
          Trending
        </div>
      )}

      {/* Domain colour dot + title */}
      <div className="flex items-start gap-2.5 mb-2">
        <div className="w-2 h-2 rounded-full mt-1.5 flex-shrink-0" style={{ backgroundColor: color }} />
        <p className="text-sm font-bold text-white leading-snug pr-5">{topic.title}</p>
      </div>

      {/* Description */}
      {topic.description && (
        <p className="text-xs text-[#94A3B8] leading-relaxed line-clamp-2 ml-4.5 pl-0.5">
          {topic.description}
        </p>
      )}
    </motion.button>
  )
}

// ── Main page component ────────────────────────────────────────────────────────

export default function TopicsPage() {
  const router = useRouter()
  const [view, setView] = useState<View>('loading')
  const [objectives, setObjectives] = useState('')
  const [generateError, setGenerateError] = useState<string | null>(null)

  // Featured = role-curated topics shown prominently
  const [featuredTopics, setFeaturedTopics] = useState<FeaturedTopic[]>([])
  // Other = remaining catalog topics, collapsed by default
  const [otherTopics, setOtherTopics] = useState<FeaturedTopic[]>([])
  const [otherOpen, setOtherOpen] = useState(false)

  // Manual / custom topics
  const [manualTopics, setManualTopics] = useState<string[]>([])
  const [customOpen, setCustomOpen] = useState(false)
  const [customInput, setCustomInput] = useState('')
  const customInputRef = useRef<HTMLInputElement>(null)

  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [saving, setSaving] = useState(false)
  const [storedProfile, setStoredProfile] = useState<StoredProfile | null>(null)
  const [catalogRole, setCatalogRole] = useState<string | null>(null)

  // Group "other" topics by domain for the collapsed section
  const otherByDomain = useMemo<ExploreGroup[]>(() => groupByDomain(otherTopics), [otherTopics])

  // Domain colour index lookup for featured cards (stable across re-renders)
  const domainColorMap = useMemo<Map<string, number>>(() => {
    const map = new Map<string, number>()
    let idx = 0
    for (const t of featuredTopics) {
      if (!map.has(t.domain_id)) map.set(t.domain_id, idx++)
    }
    return map
  }, [featuredTopics])

  const atMax = selected.size >= MAX_SELECTIONS

  // ── Load topics on mount ───────────────────────────────────────────────────

  useEffect(() => {
    let profile: StoredProfile | null = null
    try {
      const raw = localStorage.getItem('clio_onboarding')
      if (raw) profile = JSON.parse(raw) as StoredProfile
    } catch { /* ignore */ }
    setStoredProfile(profile)

    async function loadTopics() {
      // 1. Try catalog API (handles both old and new response shapes)
      try {
        const params = new URLSearchParams()
        if (profile?.role) params.set('role', profile.role)
        if (profile?.domains?.length) params.set('domains', profile.domains.join(','))

        const res = await fetch(`/api/topics/catalog?${params}`)
        const data = await res.json() as CatalogResponse

        if (isNewFormat(data)) {
          // New API format: { featured, other }
          const featured = data.featured ?? []
          const other = data.other ?? []

          if (featured.length > 0 || other.length > 0) {
            setCatalogRole(data.role ?? null)
            setFeaturedTopics(featured)
            setOtherTopics(other)
            // Pre-select all featured topics
            setSelected(new Set(featured.map((t) => t.title)))
            setView('selection')
            return
          }
        } else {
          // Old API format: { topics, domains }
          const topics = data.topics ?? []
          const userDomains: string[] = data.domains ?? profile?.domains ?? []

          if (topics.length > 0) {
            setCatalogRole(data.role ?? null)

            // Simulate featured/other split from old format:
            //   featured = topics from user's selected domains (up to 18)
            //   other    = the rest
            const featured: FeaturedTopic[] = userDomains.length > 0
              ? toFeaturedTopics(topics.filter((t) => userDomains.includes(t.domain_id))).slice(0, 18)
              : toFeaturedTopics(topics.slice(0, 14))

            const featuredIds = new Set(featured.map((t) => t.id))
            const other = toFeaturedTopics(topics.filter((t) => !featuredIds.has(t.id)))

            setFeaturedTopics(featured)
            setOtherTopics(other)
            setSelected(new Set(featured.map((t) => t.title)))
            setView('selection')
            return
          }
        }
      } catch {
        // catalog failed — fall through to generate
      }

      // 2. Fallback: AI-generated topics
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
          // Wrap plain strings as minimal FeaturedTopic objects
          const wrapped: FeaturedTopic[] = genData.topics.map((title, i) => ({
            id: `generated-${i}`,
            title,
            description: '',
            domain_id: 'generated',
            relevant_maturity: [],
            tags: [],
          }))
          setFeaturedTopics(wrapped)
          setOtherTopics([])
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

      const wrapped: FeaturedTopic[] = data.topics.map((title, i) => ({
        id: `generated-${i}`,
        title,
        description: '',
        domain_id: 'generated',
        relevant_maturity: [],
        tags: [],
      }))
      setFeaturedTopics(wrapped)
      setOtherTopics([])
      setManualTopics([])
      setSelected(new Set(data.topics))
      setView('selection')
    } catch {
      setGenerateError('Network error — please try again or enter topics manually.')
      setView('input')
    }
  }

  function toggleTopic(title: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(title)) {
        next.delete(title)
      } else {
        if (next.size < MAX_SELECTIONS) next.add(title)
      }
      return next
    })
  }

  function addCustomTopic() {
    const trimmed = customInput.trim()
    if (!trimmed) return
    const allTitles = [...featuredTopics.map((t) => t.title), ...otherTopics.map((t) => t.title), ...manualTopics]
    if (allTitles.some((t) => t.toLowerCase() === trimmed.toLowerCase())) {
      setCustomInput('')
      return
    }
    setManualTopics((prev) => [...prev, trimmed])
    setSelected((prev) => {
      if (prev.size >= MAX_SELECTIONS) return prev
      return new Set(Array.from(prev).concat(trimmed))
    })
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
        body: JSON.stringify({
          topics: Array.from(selected),
          profile: storedProfile
            ? {
                role: storedProfile.role,
                domains: storedProfile.domains,
                primaryDomain: storedProfile.primaryDomain,
                domainProficiency: storedProfile.domainProficiency,
                learningGoal: storedProfile.learningGoal,
              }
            : undefined,
        }),
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

      <div className="max-w-3xl mx-auto px-6 py-12 pb-32">
        <AnimatePresence mode="wait">

          {/* ── LOADING ─────────────────────────────────────────────────── */}
          {view === 'loading' && (
            <motion.div
              key="loading"
              initial={{ opacity: 0, scale: 0.97 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.3 }}
              className="space-y-8"
            >
              {/* Header skeleton */}
              <div className="animate-pulse space-y-3">
                <div className="h-3 bg-[#1A1A1A] rounded w-40" />
                <div className="h-8 bg-[#1A1A1A] rounded w-72" />
                <div className="h-4 bg-[#1A1A1A] rounded w-52" />
              </div>

              {/* Skeleton cards */}
              <div>
                <div className="h-4 bg-[#1A1A1A] rounded w-48 mb-4 animate-pulse" />
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                  {Array.from({ length: 9 }).map((_, i) => <SkeletonCard key={i} />)}
                </div>
              </div>
            </motion.div>
          )}

          {/* ── SELECTION ───────────────────────────────────────────────── */}
          {view === 'selection' && (
            <motion.div
              key="selection"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -16 }}
              transition={{ duration: 0.35 }}
              className="space-y-10"
            >
              {/* Page header */}
              <div>
                <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-purple-950/40 border border-purple-800/30 text-[#A855F7] text-sm font-medium mb-4">
                  <Sparkles size={14} />
                  Personalised for your profile
                </div>
                <h1 className="text-3xl font-extrabold text-white">What do you want to focus on?</h1>
                <p className="text-[#94A3B8] mt-1.5 text-sm">
                  Select the topics you want to learn. You can change these later.
                </p>
              </div>

              {/* ── Featured section ──────────────────────────────────── */}
              <section>
                <div className="mb-4">
                  <h2 className="text-base font-bold text-white">
                    Recommended for {roleTitle(catalogRole)}
                  </h2>
                  <p className="text-xs text-[#475569] mt-0.5">
                    {featuredTopics.length} topic{featuredTopics.length !== 1 ? 's' : ''} curated for your role and industry
                  </p>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                  {featuredTopics.map((topic, i) => (
                    <motion.div
                      key={topic.id}
                      initial={{ opacity: 0, y: 12 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: i * 0.04, duration: 0.25 }}
                    >
                      <FeaturedCard
                        topic={topic}
                        isSelected={selected.has(topic.title)}
                        onToggle={toggleTopic}
                        atMax={atMax}
                        colorIdx={domainColorMap.get(topic.domain_id) ?? i}
                      />
                    </motion.div>
                  ))}
                </div>
              </section>

              {/* Max selections warning */}
              <AnimatePresence>
                {atMax && (
                  <motion.div
                    initial={{ opacity: 0, y: -6 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0 }}
                    className="flex items-center gap-2 px-4 py-3 rounded-xl bg-amber-950/30 border border-amber-800/40 text-amber-400 text-sm"
                  >
                    <span className="font-semibold">Maximum {MAX_SELECTIONS} topics selected.</span>
                    <span className="text-amber-500/80">Deselect one to add another.</span>
                  </motion.div>
                )}
              </AnimatePresence>

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

              {/* ── Other topics (collapsed) ──────────────────────────── */}
              {otherByDomain.length > 0 && (
                <div className="border border-[#222222] rounded-2xl overflow-hidden">
                  <button
                    onClick={() => setOtherOpen((o) => !o)}
                    className="w-full flex items-center justify-between px-5 py-4 text-left hover:bg-[#1A1A1A] transition-colors"
                  >
                    <div className="flex items-center gap-2.5">
                      <span className="text-sm font-bold text-white">More topics</span>
                      <span className="text-xs text-[#475569]">{otherTopics.length} available</span>
                    </div>
                    {otherOpen
                      ? <ChevronUp size={16} className="text-[#475569]" />
                      : <ChevronDown size={16} className="text-[#475569]" />}
                  </button>

                  <AnimatePresence>
                    {otherOpen && (
                      <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: 'auto', opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: 0.25 }}
                        className="overflow-hidden border-t border-[#222222]"
                      >
                        <div className="p-4 space-y-5">
                          {otherByDomain.map((group) => (
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
                                      onClick={() => toggleTopic(topic.title)}
                                      disabled={!isSelected && atMax}
                                      className={`flex items-center gap-3 px-4 py-3 rounded-xl border text-left text-sm font-medium transition-all duration-150 ${
                                        isSelected
                                          ? 'bg-purple-950/30 border-[#7C3AED] text-white'
                                          : atMax
                                            ? 'bg-[#1A1A1A] border-[#2A2A2A] text-[#475569] opacity-50 cursor-not-allowed'
                                            : 'bg-[#1A1A1A] border-[#2A2A2A] text-[#94A3B8] hover:border-[#333] hover:text-white'
                                      }`}
                                    >
                                      <div className={`w-4 h-4 rounded flex items-center justify-center flex-shrink-0 border transition-all ${isSelected ? 'bg-[#7C3AED] border-[#7C3AED]' : 'border-[#444] bg-transparent'}`}>
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

              {/* ── Custom topic (last resort) ────────────────────────── */}
              <div>
                <p className="text-xs text-[#475569] text-center mb-2">Don&apos;t see what you&apos;re looking for?</p>
                {!customOpen ? (
                  <button
                    onClick={() => {
                      setCustomOpen(true)
                      setTimeout(() => customInputRef.current?.focus(), 50)
                    }}
                    className="w-full text-center text-sm text-[#475569] hover:text-[#94A3B8] transition-colors py-2 flex items-center justify-center gap-1.5"
                  >
                    <PenLine size={13} />
                    Add a custom topic →
                  </button>
                ) : (
                  <motion.div
                    initial={{ opacity: 0, y: -6 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="flex gap-2"
                  >
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
                      disabled={!customInput.trim() || atMax}
                      className="w-10 h-10 flex items-center justify-center rounded-xl border border-[#333] text-[#475569] hover:text-white hover:border-[#7C3AED] disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                    >
                      <Plus size={16} />
                    </button>
                    <button
                      onClick={() => { setCustomOpen(false); setCustomInput('') }}
                      className="w-10 h-10 flex items-center justify-center rounded-xl border border-[#333] text-[#475569] hover:text-[#94A3B8] transition-colors"
                    >
                      <X size={14} />
                    </button>
                  </motion.div>
                )}
              </div>

              {/* Escape hatches */}
              <div className="flex items-center gap-5 pt-2">
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
                {featuredTopics.length > 0 && (
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
                  onClick={() => featuredTopics.length > 0 ? setView('selection') : setView('input')}
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
                  disabled={!customInput.trim() || atMax}
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

      {/* ── Sticky bottom bar (selection view only) ───────────────────────── */}
      <AnimatePresence>
        {view === 'selection' && (
          <motion.div
            initial={{ y: 80, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 80, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 300, damping: 30 }}
            className="fixed bottom-0 left-0 right-0 border-t border-[#222222] bg-[#080808]/95 backdrop-blur-sm px-6 py-4"
          >
            <div className="max-w-3xl mx-auto flex items-center justify-between gap-4">
              <div>
                <p className="text-sm font-semibold text-white">
                  {selected.size} topic{selected.size !== 1 ? 's' : ''} selected
                  {selected.size >= MAX_SELECTIONS && (
                    <span className="ml-2 text-xs text-amber-400 font-normal">(maximum reached)</span>
                  )}
                </p>
                {selected.size === 0 && (
                  <p className="text-xs text-[#475569]">Select at least one topic to continue</p>
                )}
              </div>
              <Button
                onClick={handleContinue}
                disabled={saving || selected.size === 0}
                size="lg"
                className="gap-2 flex-shrink-0"
              >
                {saving ? 'Building your plan...' : 'Continue'}
                <ArrowRight size={16} />
              </Button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
