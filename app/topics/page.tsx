'use client'

import { useState, useEffect, useMemo, useRef, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { useUser } from '@clerk/nextjs'
import { motion, AnimatePresence } from 'framer-motion'
import Link from 'next/link'
import {
  TrendingUp, Briefcase, Wrench, Target, Code2, Users, Plus, ArrowRight, BookOpen, ChevronRight, Lightbulb,
} from 'lucide-react'
import { inferRoleLevel } from '@/lib/curriculum/role-utils'

// TOPIC-01 feature flag — gates the new viewport-driven section expand/collapse and
// score-based section ordering. Defaults to OFF (pre-TOPIC01 behavior: all returned
// sections render fully expanded, only the beginner-technical "Advanced topics" block
// collapses) unless explicitly enabled — same convention as NEXT_PUBLIC_VOICE_PROVIDER
// (see lib/elevenlabs-pool.ts / app/dashboard/walkthrough/WalkthroughClient.tsx).
const TOPIC01_ENABLED = process.env.NEXT_PUBLIC_TOPIC01_ENABLED === 'true'

// ── Types ──────────────────────────────────────────────────────────────────────

interface RecommendedTopic {
  id: string
  title: string
  description: string
  /** true for custom user-added topics */
  isCustom?: boolean
  /** TOPIC-01 (Q1): 0-100 relevance score from the four-factor rubric. Absent for
   *  legacy cached responses and custom user-added topics. */
  score?: number
}

interface RecommendationSection {
  id: string
  label: string
  icon: string
  topics: RecommendedTopic[]
}

interface RecommendationsApiResponse {
  sections?: RecommendationSection[]
  fallback?: boolean
  maturity?: string
  advancedSections?: RecommendationSection[]
}

interface StoredProfile {
  role?: string
  roleLevel?: string
  primaryDomain?: string
  subDomain?: string
  learningGoal?: string
  aiMaturity?: string
  domainProficiency?: Record<string, string>
}

type PageState = 'loading' | 'loaded' | 'empty'

// ── Constants ──────────────────────────────────────────────────────────────────

// Use LucideIcon type to match the actual Lucide component type
type LucideIconComponent = React.ForwardRefExoticComponent<
  Omit<React.SVGProps<SVGSVGElement>, 'ref'> & {
    size?: string | number;
    strokeWidth?: string | number;
  } & React.RefAttributes<SVGSVGElement>
>

const SECTION_ICON_MAP: Record<string, LucideIconComponent> = {
  TrendingUp,
  Briefcase,
  Wrench,
  Target,
  Code2,
  Users,
  BookOpen,
  Lightbulb,
}

const FALLBACK_SECTION_ICONS: Record<string, string> = {
  trending:     'TrendingUp',
  skills:       'Code2',
  decisions:    'Briefcase',
  team:         'Users',
  tools:        'Wrench',
  how_it_works: 'Lightbulb',
  // legacy
  role: 'Briefcase',
  goal: 'Target',
}

// ── Skeleton card ──────────────────────────────────────────────────────────────

function SkeletonCard() {
  return (
    <div className="h-24 rounded-xl bg-[#111111] border border-[#222222] animate-pulse" />
  )
}

// ── Topic card ─────────────────────────────────────────────────────────────────

interface TopicCardProps {
  topic: RecommendedTopic
  isSelected: boolean
  onToggle: (id: string) => void
}

function TopicCard({ topic, isSelected, onToggle }: TopicCardProps) {
  return (
    <motion.button
      onClick={() => onToggle(topic.id)}
      whileHover={{ scale: 1.02 }}
      whileTap={{ scale: 0.98 }}
      transition={{ duration: 0.3, ease: 'easeOut' }}
      className={`relative w-full text-left rounded-xl p-4 border transition-colors focus:outline-none ${
        isSelected
          ? 'border-[#7C3AED] bg-[rgba(124,58,237,0.12)]'
          : 'border-[#222222] bg-[#111111] hover:border-[#333333] hover:bg-[#1A1A1A]'
      }`}
    >
      {topic.isCustom && (
        <div className="absolute top-2.5 right-2.5 flex items-center gap-1">
          <span className="text-[10px] font-semibold text-[#F59E0B] border border-[#F59E0B]/40 rounded px-1.5 py-0.5 uppercase tracking-wide">
            Custom
          </span>
          <button
            onClick={(e) => {
              e.stopPropagation()
              onToggle(topic.id)
            }}
            className="ml-1 text-[#475569] hover:text-white transition-colors"
            aria-label="Remove custom topic"
          >
            <Plus size={12} className="rotate-45" />
          </button>
        </div>
      )}
      <p className="text-sm font-bold text-white leading-snug pr-12 sm:pr-0">
        {topic.title}
      </p>
      {topic.description && (
        <p className="text-xs text-[#94A3B8] mt-1 leading-relaxed line-clamp-2">
          {topic.description}
        </p>
      )}
    </motion.button>
  )
}

// ── Section component ──────────────────────────────────────────────────────────

interface SectionProps {
  section: RecommendationSection
  selectedIds: Set<string>
  onToggle: (id: string) => void
  colorClass: string
}

function Section({ section, selectedIds, onToggle, colorClass }: SectionProps) {
  const IconComponent = SECTION_ICON_MAP[section.icon] ?? TrendingUp

  return (
    <div>
      <div className="flex items-center gap-2 mb-3">
        <IconComponent size={16} className={colorClass} />
        <h2 className="text-sm font-semibold text-white">{section.label}</h2>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {section.topics.map((topic) => (
          <TopicCard
            key={topic.id}
            topic={topic}
            isSelected={selectedIds.has(topic.id)}
            onToggle={onToggle}
          />
        ))}
      </div>
    </div>
  )
}

// ── Collapsible section (TOPIC-01: generalized viewport-driven collapse) ───────
// Same visual treatment as the pre-TOPIC01 one-off "Advanced topics" block, but
// applicable to any section, not just the beginner-technical special case.

interface CollapsibleSectionProps {
  section: RecommendationSection
  selectedIds: Set<string>
  onToggle: (id: string) => void
  colorClass: string
  isExpanded: boolean
  onToggleExpanded: () => void
}

function CollapsibleSection({ section, selectedIds, onToggle, colorClass, isExpanded, onToggleExpanded }: CollapsibleSectionProps) {
  const IconComponent = SECTION_ICON_MAP[section.icon] ?? TrendingUp

  return (
    <div className="border border-[#222222] rounded-2xl overflow-hidden">
      <button
        onClick={onToggleExpanded}
        className="w-full flex items-center gap-3 px-5 py-4 text-left hover:bg-[#111111] transition-colors"
      >
        <motion.div animate={{ rotate: isExpanded ? 90 : 0 }} transition={{ duration: 0.2 }}>
          <ChevronRight size={16} className="text-[#475569]" />
        </motion.div>
        <IconComponent size={16} className={colorClass} />
        <p className="text-sm font-semibold text-white">{section.label}</p>
      </button>
      <AnimatePresence>
        {isExpanded && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.25 }}
            className="overflow-hidden"
          >
            <div className="px-5 pb-5">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {section.topics.map((topic) => (
                  <TopicCard
                    key={topic.id}
                    topic={topic}
                    isSelected={selectedIds.has(topic.id)}
                    onToggle={onToggle}
                  />
                ))}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

const SECTION_COLORS = [
  'text-[#06B6D4]',   // trending — cyan
  'text-[#7C3AED]',   // role — purple
  'text-[#F59E0B]',   // tools — amber
  'text-[#10B981]',   // goal — green
]

// ── Main page ──────────────────────────────────────────────────────────────────

export default function TopicsPage() {
  const router = useRouter()
  const { isSignedIn } = useUser()

  const [pageState, setPageState] = useState<PageState>('loading')
  const [sections, setSections] = useState<RecommendationSection[]>([])
  const [advancedSections, setAdvancedSections] = useState<RecommendationSection[]>([])
  const [maturity, setMaturity] = useState<string>('intermediate')
  const [isAdvancedExpanded, setIsAdvancedExpanded] = useState(false)
  const [customTopics, setCustomTopics] = useState<RecommendedTopic[]>([])
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [customInput, setCustomInput] = useState('')
  const [domainLabel, setDomainLabel] = useState('')

  // TOPIC-01 (viewport-driven expand/collapse) — only used when TOPIC01_ENABLED
  const [autoExpandedCount, setAutoExpandedCount] = useState(1)
  const [manuallyExpanded, setManuallyExpanded] = useState<Set<string>>(new Set())

  const customInputRef = useRef<HTMLInputElement>(null)

  // ── TOPIC-01: score-ranked section order (Q1) ─────────────────────────────────
  // Combines sections + advancedSections into one ranked pool — under the new flag
  // there is no separate "advanced" special case, every section is ranked and
  // rendered expanded/collapsed purely by score + viewport fit (Q2).
  const orderedSections = useMemo(() => {
    if (!TOPIC01_ENABLED) return sections
    const pool = [...sections, ...advancedSections]
    const scored = pool.map((section) => {
      const topicScores = section.topics.map((t) => t.score ?? 50)
      const avgScore = topicScores.length
        ? topicScores.reduce((a, b) => a + b, 0) / topicScores.length
        : 0
      return { section, avgScore }
    })
    scored.sort((a, b) => b.avgScore - a.avgScore)
    return scored.map((s) => s.section)
  }, [sections, advancedSections])

  // ── TOPIC-01: measure above-the-fold viewport height, decide expand count (Q2) ─
  // Display rule only — ranking (order) comes from orderedSections above; this
  // effect only decides HOW MANY of that ordered list render expanded before the
  // rest collapse to tappable headers. Re-runs on resize so short mobile vs tall
  // desktop viewports genuinely produce different expand counts.
  useEffect(() => {
    if (!TOPIC01_ENABLED) return
    if (typeof window === 'undefined') return

    function computeExpandedCount() {
      // Rough above-the-fold budget: viewport height minus page header / custom-topics
      // area chrome and the fixed bottom action bar.
      const HEADER_CHROME_PX = 260
      const STICKY_BAR_PX = 88
      const SECTION_HEADER_PX = 32
      const CARD_ROW_PX = 108 // card height (~96px) + grid gap (12px)
      const cardsPerRow = window.innerWidth >= 640 ? 2 : 1

      const available = window.innerHeight - HEADER_CHROME_PX - STICKY_BAR_PX

      let used = 0
      let count = 0
      for (const section of orderedSections) {
        const rows = Math.ceil(section.topics.length / cardsPerRow)
        const height = SECTION_HEADER_PX + rows * CARD_ROW_PX
        // Minimum of 1 section always expanded, even on a degenerate short viewport.
        if (count === 0 || used + height <= available) {
          used += height
          count += 1
        } else {
          break
        }
      }
      setAutoExpandedCount(Math.max(1, Math.min(count, orderedSections.length)))
    }

    computeExpandedCount()
    window.addEventListener('resize', computeExpandedCount)
    return () => window.removeEventListener('resize', computeExpandedCount)
  }, [orderedSections])

  const toggleSectionExpanded = useCallback((id: string) => {
    setManuallyExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  // ── Helpers ──────────────────────────────────────────────────────────────────

  const toggleTopic = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) {
        next.delete(id)
        // If removing a custom topic, also remove it from customTopics
        setCustomTopics((ct) => ct.filter((t) => t.id !== id))
      } else {
        next.add(id)
      }
      return next
    })
  }, [])

  const removeCustomTopic = useCallback((id: string) => {
    setCustomTopics((prev) => prev.filter((t) => t.id !== id))
    setSelectedIds((prev) => {
      const next = new Set(prev)
      next.delete(id)
      return next
    })
  }, [])

  const addCustomTopic = useCallback(() => {
    const raw = customInput.trim()
    if (!raw) return

    // Trim to 60 chars
    const title = raw.length > 60 ? raw.substring(0, 60) : raw

    // Duplicate check (case-insensitive) across all topics
    const allTitles = [
      ...sections.flatMap((s) => s.topics.map((t) => t.title.toLowerCase())),
      ...customTopics.map((t) => t.title.toLowerCase()),
    ]
    if (allTitles.includes(title.toLowerCase())) {
      setCustomInput('')
      return
    }

    const newTopic: RecommendedTopic = {
      id: `custom-${Date.now()}`,
      title,
      description: '',
      isCustom: true,
    }

    setCustomTopics((prev) => [newTopic, ...prev])
    setSelectedIds((prev) => new Set(Array.from(prev).concat(newTopic.id)))
    setCustomInput('')
  }, [customInput, sections, customTopics])

  // ── Load recommendations on mount ─────────────────────────────────────────────

  useEffect(() => {
    // Read profile from localStorage first so we can derive roleLevel for the cache key
    let profile: StoredProfile = {}
    let rawDomain = ''
    try {
      const raw = localStorage.getItem('clio_onboarding')
      if (raw) {
        profile = JSON.parse(raw) as StoredProfile
        rawDomain = profile.primaryDomain ?? ''
      }
    } catch { /* ignore */ }

    // Use explicitly selected roleLevel from onboarding step 0 if available;
    // fall back to inference from free-text role string for anonymous/legacy flows.
    // Use || (not ??) so an empty string also falls through to inferRoleLevel.
    const roleLevel = profile.roleLevel || inferRoleLevel(profile.role ?? '')

    // Derive per-domain proficiency string for the sessionStorage cache key.
    const VALID_PROFICIENCIES = ['beginner', 'intermediate', 'advanced', 'expert']
    const rawProficiency = (profile.domainProficiency && rawDomain)
      ? (profile.domainProficiency[rawDomain] ?? 'intermediate')
      : 'intermediate'
    const domainProficiencyStr = VALID_PROFICIENCIES.includes(rawProficiency) ? rawProficiency : 'intermediate'

    // Check sessionStorage cache first (avoid re-calling Claude on re-visit).
    // v4: includes proficiency in key so beginner/expert get separate caches.
    const cacheKey = `clio_topic_recs_v5_${roleLevel}_${rawDomain}_${domainProficiencyStr}`
    const cached = sessionStorage.getItem(cacheKey)
    if (cached) {
      try {
        const parsed = JSON.parse(cached) as RecommendationSection[]
        if (Array.isArray(parsed) && parsed.length > 0) {
          setSections(parsed)
          setPageState('loaded')
          return
        }
      } catch { /* ignore */ }
    }

    // Derive a human-readable domain label for empty state
    setDomainLabel(
      rawDomain
        .replace(/-/g, ' ')
        .replace(/\b\w/g, (c) => c.toUpperCase()) || 'your domain'
    )

    // Determine aiMaturity from domainProficiency if not directly set
    const aiMaturity =
      profile.aiMaturity ??
      (profile.domainProficiency && rawDomain
        ? profile.domainProficiency[rawDomain] ?? 'intermediate'
        : 'intermediate')

    // Truncate learningGoal to 200 chars
    const learningGoal = (profile.learningGoal ?? '').substring(0, 200)

    async function fetchRecommendations() {
      try {
        const res = await fetch('/api/topics/recommendations', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            role: profile.role ?? '',
            primaryDomain: rawDomain,
            subDomain: profile.subDomain ?? '',
            learningGoal,
            aiMaturity,
            domainProficiency: profile.domainProficiency ?? {},
            roleLevel,
          }),
        })

        const data = await res.json() as RecommendationsApiResponse

        // If Claude returned sections (either real or mock)
        if (!data.fallback && data.sections && data.sections.length > 0) {
          sessionStorage.setItem(cacheKey, JSON.stringify(data.sections))
          setSections(data.sections)
          if (data.maturity) setMaturity(data.maturity)
          if (data.advancedSections) setAdvancedSections(data.advancedSections)
          setPageState('loaded')
          return
        }

        // Fallback: try to use sections from fallback response.
        if (data.fallback && data.sections && data.sections.length > 0) {
          setSections(data.sections)
          if (data.maturity) setMaturity(data.maturity)
          if (data.advancedSections) setAdvancedSections(data.advancedSections)
          setPageState('loaded')
          return
        }

        // Empty state
        setPageState('empty')
      } catch {
        // Network error — silent empty state
        setPageState('empty')
      }
    }

    fetchRecommendations()
  }, [])

  // Pre-select existing topic_interests from the API once recommendations are loaded.
  // This ensures users see their previous choices when they return to the topics page.
  useEffect(() => {
    if (pageState !== 'loaded' || sections.length === 0 || !isSignedIn) return

    async function preSelectExisting() {
      try {
        const res = await fetch('/api/topics')
        if (!res.ok) return
        const data = await res.json() as { topics: string[] }
        if (!data.topics?.length) return

        // Build title→id map from all recommendation sections
        const titleToId = new Map<string, string>()
        sections.flatMap((s) => s.topics).forEach((t) => {
          titleToId.set(t.title.toLowerCase(), t.id)
        })

        const idsToSelect = new Set<string>()
        const customToAdd: RecommendedTopic[] = []

        for (const title of data.topics) {
          const id = titleToId.get(title.toLowerCase())
          if (id) {
            idsToSelect.add(id)
          } else {
            // Previously selected topic not in current recommendations — restore as custom
            const customId = `custom-preselect-${title.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}`
            customToAdd.push({ id: customId, title, description: '', isCustom: true })
            idsToSelect.add(customId)
          }
        }

        if (idsToSelect.size > 0) setSelectedIds(idsToSelect)
        if (customToAdd.length > 0) setCustomTopics((prev) => [...customToAdd, ...prev])
      } catch { /* non-fatal */ }
    }

    preSelectExisting()
  }, [pageState, sections, isSignedIn])

  const selectedCount = selectedIds.size
  const canContinue = selectedCount >= 1

  // ── Auth-aware continue handler ───────────────────────────────────────────────

  const handleContinue = useCallback(async () => {
    if (!canContinue) return

    // Collect all topic titles (AI-recommended + custom)
    const allTopics: RecommendedTopic[] = [
      ...sections.flatMap((s) => s.topics),
      ...customTopics,
    ]
    const selectedTitles = Array.from(selectedIds)
      .map((id) => allTopics.find((t) => t.id === id)?.title)
      .filter((title): title is string => Boolean(title))

    // Merge into existing localStorage profile
    let existing: Record<string, unknown> = {}
    try {
      const raw = localStorage.getItem('clio_onboarding')
      if (raw) existing = JSON.parse(raw) as Record<string, unknown>
    } catch { /* ignore */ }

    const profile = existing as { role?: string; aiMaturity?: string; domainProficiency?: Record<string, string>; primaryDomain?: string; learningGoal?: string }
    localStorage.setItem('clio_onboarding', JSON.stringify({
      ...existing,
      selectedTopics: selectedTitles,
    }))

    const role = profile.role ?? 'executive'
    const maturity = profile.aiMaturity ??
      (profile.domainProficiency && profile.primaryDomain
        ? (profile.domainProficiency[profile.primaryDomain] ?? 'intermediate')
        : 'intermediate')

    // Compute profile_hash client-side using Web Crypto API — same algorithm as
    // buildProfileHash on the server: SHA256(`role::maturity::sorted_topics`).slice(0,16).
    // We write it to localStorage BEFORE router.push() because browsers do not execute
    // .then() callbacks after page navigation, even with keepalive:true.
    try {
      const sorted = [...selectedTitles].sort().join(',')
      const hashBuffer = await crypto.subtle.digest(
        'SHA-256',
        new TextEncoder().encode(`${role}::${maturity}::${sorted}`)
      )
      const profileHash = Array.from(new Uint8Array(hashBuffer))
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('')
        .slice(0, 16)

      localStorage.setItem('clio_plan_preview', JSON.stringify({
        profile_hash: profileHash,
        cached_at:    Date.now(),
      }))
    } catch { /* Web Crypto unavailable — dashboard falls back to normal Inngest flow */ }

    // Fire plan generation on the server in background so the template is ready
    // by the time the user finishes signup + payment (60–120s of natural wait time).
    fetch('/api/curriculum/generate-preview', {
      method:    'POST',
      headers:   { 'Content-Type': 'application/json' },
      body:      JSON.stringify({ role, maturity, topics: selectedTitles }),
      keepalive: true,
    }).catch(() => { /* non-fatal */ })

    // Save topics to the server (triggers curriculum generator via Inngest).
    // Only possible for signed-in users — unauthenticated users aren't in the DB yet.
    if (isSignedIn) {
      try {
        await fetch('/api/topics', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            topics: selectedTitles,
            profile: {
              role: profile.role,
              primaryDomain: profile.primaryDomain,
              domainProficiency: profile.domainProficiency,
              learningGoal: profile.learningGoal,
            },
          }),
        })
      } catch { /* non-fatal — curriculum-generator has auto-select fallback */ }

      router.push('/plan')
    } else {
      router.push('/sign-up')
    }
  }, [canContinue, sections, customTopics, selectedIds, isSignedIn, router])

  // ── Selected count pill ───────────────────────────────────────────────────────

  const selectedPill = (
    <span className="text-xs font-semibold text-[#06B6D4] bg-[#111111] border border-[#222222] rounded-full px-3 py-1">
      {selectedCount} selected
    </span>
  )

  // ── Render ─────────────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-[#080808]">
      <AnimatePresence mode="wait">

        {/* ── Loading ──────────────────────────────────────────────────────── */}
        {pageState === 'loading' && (
          <motion.div
            key="loading"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.3 }}
            className="flex flex-col items-center justify-center min-h-screen px-6 py-16"
          >
            <h1 className="text-xl font-semibold text-white text-center mb-2">
              Curating your learning plan...
            </h1>
            <p className="text-sm text-[#94A3B8] text-center mb-10">
              Analysing your role, domain, and goals
            </p>
            <div className="w-full max-w-2xl grid grid-cols-2 gap-3">
              {Array.from({ length: 12 }).map((_, i) => (
                <SkeletonCard key={i} />
              ))}
            </div>
          </motion.div>
        )}

        {/* ── Loaded ───────────────────────────────────────────────────────── */}
        {pageState === 'loaded' && (
          <motion.div
            key="loaded"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.35 }}
          >
            <div className="max-w-2xl mx-auto px-6 pt-12 pb-36 space-y-10">

              {/* Page header */}
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h1 className="text-2xl font-bold text-white">Your AI Learning Plan</h1>
                  <p className="text-sm text-[#94A3B8] mt-1">
                    Select the topics you want to master. Pick at least 1 to get started.
                  </p>
                  <Link href="/onboarding?edit=1" className="inline-block mt-2 text-xs text-[#475569] hover:text-[#94A3B8] underline underline-offset-2 transition-colors">
                    Edit my answers
                  </Link>
                </div>
                {selectedPill}
              </div>

              {/* Custom topics section (appears above AI sections when there are custom topics) */}
              <AnimatePresence>
                {customTopics.length > 0 && (
                  <motion.div
                    key="custom-section"
                    initial={{ opacity: 0, y: -8 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -8 }}
                    transition={{ duration: 0.3, ease: 'easeOut' }}
                  >
                    <div className="flex items-center gap-2 mb-3">
                      <Plus size={16} className="text-[#F59E0B]" />
                      <h2 className="text-sm font-semibold text-white">Your topics</h2>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      {customTopics.map((topic) => (
                        <motion.div
                          key={topic.id}
                          initial={{ opacity: 0, scale: 0.95 }}
                          animate={{ opacity: 1, scale: 1 }}
                          exit={{ opacity: 0, scale: 0.95 }}
                          transition={{ duration: 0.2 }}
                        >
                          <div
                            className="relative w-full text-left rounded-xl p-4 border border-[#333333] bg-[#111111]"
                          >
                            {/* Custom badge + remove button */}
                            <div className="absolute top-2.5 right-2.5 flex items-center gap-1.5">
                              <span className="text-[10px] font-semibold text-[#F59E0B] border border-[#F59E0B]/40 rounded px-1.5 py-0.5 uppercase tracking-wide">
                                Custom
                              </span>
                              <button
                                onClick={() => removeCustomTopic(topic.id)}
                                className="text-[#475569] hover:text-white transition-colors"
                                aria-label="Remove custom topic"
                              >
                                <Plus size={12} className="rotate-45" />
                              </button>
                            </div>
                            <p className="text-sm font-bold text-white leading-snug pr-24">
                              {topic.title}
                            </p>
                          </div>
                        </motion.div>
                      ))}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>

              {/* AI sections */}
              {TOPIC01_ENABLED ? (
                // TOPIC-01: sections ordered by score (Q1); top N render expanded based
                // on measured above-the-fold viewport height (Q2), remainder collapsed.
                orderedSections.map((section, idx) => {
                  const iconKey = section.icon in SECTION_ICON_MAP
                    ? section.icon
                    : (FALLBACK_SECTION_ICONS[section.id] ?? 'TrendingUp')
                  const sectionWithIcon = { ...section, icon: iconKey }
                  const isAutoExpanded = idx < autoExpandedCount

                  if (isAutoExpanded) {
                    return (
                      <Section
                        key={section.id}
                        section={sectionWithIcon}
                        selectedIds={selectedIds}
                        onToggle={toggleTopic}
                        colorClass={SECTION_COLORS[idx % SECTION_COLORS.length]}
                      />
                    )
                  }

                  return (
                    <CollapsibleSection
                      key={section.id}
                      section={sectionWithIcon}
                      selectedIds={selectedIds}
                      onToggle={toggleTopic}
                      colorClass={SECTION_COLORS[idx % SECTION_COLORS.length]}
                      isExpanded={manuallyExpanded.has(section.id)}
                      onToggleExpanded={() => toggleSectionExpanded(section.id)}
                    />
                  )
                })
              ) : (
                <>
                  {sections.map((section, idx) => {
                    // Ensure icon falls back gracefully
                    const iconKey = section.icon in SECTION_ICON_MAP
                      ? section.icon
                      : (FALLBACK_SECTION_ICONS[section.id] ?? 'TrendingUp')
                    const sectionWithIcon = { ...section, icon: iconKey }
                    return (
                      <Section
                        key={section.id}
                        section={sectionWithIcon}
                        selectedIds={selectedIds}
                        onToggle={toggleTopic}
                        colorClass={SECTION_COLORS[idx % SECTION_COLORS.length]}
                      />
                    )
                  })}

                  {/* Collapsed advanced topics — shown only for beginner technical users */}
                  {maturity === 'beginner' && advancedSections.length > 0 && (
                    <div className="border border-[#222222] rounded-2xl overflow-hidden">
                      <button
                        onClick={() => setIsAdvancedExpanded((v) => !v)}
                        className="w-full flex items-center gap-3 px-5 py-4 text-left hover:bg-[#111111] transition-colors"
                      >
                        <motion.div animate={{ rotate: isAdvancedExpanded ? 90 : 0 }} transition={{ duration: 0.2 }}>
                          <ChevronRight size={16} className="text-[#475569]" />
                        </motion.div>
                        <div>
                          <p className="text-sm font-semibold text-[#475569]">Advanced topics — unlock when you&apos;re ready</p>
                          <p className="text-xs text-[#334155] mt-0.5">These will make more sense after you&apos;ve built the fundamentals.</p>
                        </div>
                      </button>
                      <AnimatePresence>
                        {isAdvancedExpanded && (
                          <motion.div
                            initial={{ opacity: 0, height: 0 }}
                            animate={{ opacity: 1, height: 'auto' }}
                            exit={{ opacity: 0, height: 0 }}
                            transition={{ duration: 0.25 }}
                            className="overflow-hidden"
                          >
                            <div className="px-5 pb-5 space-y-6">
                              {advancedSections.map((section, idx) => {
                                const iconKey = section.icon in SECTION_ICON_MAP
                                  ? section.icon
                                  : (FALLBACK_SECTION_ICONS[section.id] ?? 'TrendingUp')
                                return (
                                  <Section
                                    key={`adv-${section.id}`}
                                    section={{ ...section, icon: iconKey }}
                                    selectedIds={selectedIds}
                                    onToggle={toggleTopic}
                                    colorClass={SECTION_COLORS[(sections.length + idx) % SECTION_COLORS.length]}
                                  />
                                )
                              })}
                            </div>
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </div>
                  )}
                </>
              )}

              {/* Add your own topic input */}
              <div>
                <div className="flex gap-2">
                  <input
                    ref={customInputRef}
                    type="text"
                    value={customInput}
                    onChange={(e) => setCustomInput(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && addCustomTopic()}
                    placeholder="Add your own topic..."
                    maxLength={80}
                    className="flex-1 bg-[#111111] border border-[#333333] rounded-xl px-4 py-3 text-sm text-white placeholder-[#475569] focus:outline-none focus:border-[#7C3AED] transition-colors"
                  />
                  <button
                    onClick={addCustomTopic}
                    className="px-4 py-3 rounded-xl border border-[#333333] text-[#94A3B8] hover:border-[#7C3AED] hover:text-white text-sm font-medium transition-colors"
                  >
                    Add
                  </button>
                </div>
              </div>

            </div>

            {/* ── Sticky bottom bar ───────────────────────────────────────── */}
            <div className="fixed bottom-0 left-0 right-0 bg-[#111111] border-t border-[#222222] px-6 py-4">
              <div className="max-w-2xl mx-auto flex items-center justify-between gap-4">
                <p className="text-sm text-[#94A3B8]">
                  {selectedCount} topic{selectedCount !== 1 ? 's' : ''} selected
                </p>
                <div className="relative group">
                  <button
                    onClick={handleContinue}
                    disabled={!canContinue}
                    className={`flex items-center gap-2 px-5 py-3 rounded-xl text-sm font-semibold transition-colors ${
                      canContinue
                        ? 'bg-[#7C3AED] hover:bg-[#A855F7] text-white'
                        : 'bg-[#1A1A1A] text-[#475569] cursor-not-allowed pointer-events-none'
                    }`}
                  >
                    Build my learning plan
                    <ArrowRight size={16} />
                  </button>
                  {/* Tooltip when disabled */}
                  {!canContinue && (
                    <div className="absolute bottom-full mb-2 right-0 hidden group-hover:block whitespace-nowrap bg-[#1A1A1A] border border-[#333333] text-xs text-[#94A3B8] rounded-lg px-3 py-2 pointer-events-none">
                      Select at least 1 topic to continue
                    </div>
                  )}
                </div>
              </div>
            </div>
          </motion.div>
        )}

        {/* ── Empty ────────────────────────────────────────────────────────── */}
        {pageState === 'empty' && (
          <motion.div
            key="empty"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.3 }}
            className="flex flex-col items-center justify-center min-h-screen px-6 py-16 text-center"
          >
            <p className="text-[#94A3B8] text-base mb-6">
              We&apos;re still building your topic library for{' '}
              <span className="text-white font-medium">{domainLabel}</span>.
              Check back tomorrow.
            </p>
            <button
              onClick={() => router.push('/dashboard')}
              className="px-6 py-3 rounded-xl border border-[#333333] text-[#94A3B8] hover:border-[#7C3AED] hover:text-white text-sm font-medium transition-colors"
            >
              Go to dashboard →
            </button>
          </motion.div>
        )}

      </AnimatePresence>
    </div>
  )
}
