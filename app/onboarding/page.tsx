'use client'

import { useState, useRef, Suspense, useMemo, useEffect } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { useRouter } from 'next/navigation'
import { useUser, useAuth } from '@clerk/nextjs'
import { ProgressBar } from '@/components/onboarding/ProgressBar'
import { ArrowRight, ArrowLeft, Plus, X, Search } from 'lucide-react'
import {
  ALL_DOMAINS, PROFICIENCY_LEVELS, LEARNING_GOALS,
  getDomainsForRole, searchDomains,
  type Domain, type Proficiency, type LearningGoal,
} from '@/lib/learning/taxonomy'

// ─── Step definitions ─────────────────────────────────────────────────────────

const TOTAL_STEPS = 6
// 0: Level  1: Department → resolves roleId  2: Industry  3: AI Engagement  4: Domains  5: Goal (auto-advance)

// ─── Sub-domain lists per primary domain ──────────────────────────────────────

// Industry sectors — used for all technical, AI, data, product, leadership, and
// marketing domains where the most useful personalisation signal is "which
// industry are you applying this in?" rather than a technical sub-type.
const INDUSTRY_SECTORS = [
  'Financial Services',
  'Healthcare & Life Sciences',
  'Retail & E-commerce',
  'Technology & Software',
  'Manufacturing & Industrial',
  'Professional Services',
  'Media & Entertainment',
  'Government & Public Sector',
]

// Industry-specific domains get their own focused sub-domain lists.
// All other taxonomy domain IDs (ai-ml, devops, cloud, leadership, etc.)
// fall through to INDUSTRY_SECTORS above.
const SUB_DOMAIN_MAP: Record<string, string[]> = {
  finance: ['Banking', 'Insurance', 'Investment Management', 'FinTech', 'Private Equity', 'Corporate Finance'],
  healthcare: ['Clinical Operations', 'Pharma & Life Sciences', 'Health Insurance', 'MedTech & Devices', 'Digital Health'],
  retail: ['E-commerce', 'Physical Retail', 'Consumer Goods', 'Supply Chain & Logistics', 'Retail Technology'],
  manufacturing: ['Industrial Operations', 'Automotive', 'Aerospace & Defence', 'Consumer Manufacturing', 'Supply Chain'],
  legal: ['Corporate Law', 'Regulatory & Compliance', 'Legal Tech', 'Litigation', 'Financial Services Law'],
  consulting: ['Strategy Consulting', 'Technology Consulting', 'Management Consulting', 'HR & Organisational Change', 'Financial Advisory'],
}

/**
 * Given a domain ID from the taxonomy (e.g. "ai-ml", "finance", "devops"),
 * return the appropriate sub-domain list.
 * Industry-specific domains get targeted sub-lists; all others get industry sectors.
 */
function getSubDomains(primaryDomainId: string): string[] {
  const lower = primaryDomainId.toLowerCase()
  for (const [key, list] of Object.entries(SUB_DOMAIN_MAP)) {
    if (lower === key || lower.includes(key) || key.includes(lower)) {
      return list
    }
  }
  return INDUSTRY_SECTORS
}

/**
 * Get a human-readable domain label in title case for use in Q6 text.
 */
function getDomainDisplayName(primaryDomainId: string): string {
  const found = ALL_DOMAINS.find((d) => d.id === primaryDomainId)
  if (found) return found.label
  // Fallback: title-case the id
  return primaryDomainId
    .replace(/-/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase())
}

// ─── Role level + department mapping ─────────────────────────────────────────

const ROLE_LEVELS = [
  { id: 'c-suite',    label: 'Executive / C-Suite',               subtitle: 'CEO, CTO, COO, CFO, CMO and similar' },
  { id: 'vp-dir',    label: 'VP / Director',                      subtitle: 'Senior leader managing a function or business unit' },
  { id: 'manager',   label: 'Manager / Team Lead',                subtitle: 'Leading a team or specialist function' },
  { id: 'specialist',label: 'Specialist / Individual Contributor', subtitle: 'Expert practitioner or senior specialist' },
]

const DEPARTMENTS: Record<string, { label: string; roleId: string }[]> = {
  'c-suite': [
    { label: 'General Management',     roleId: 'ceo' },
    { label: 'Technology & Engineering', roleId: 'cto' },
    { label: 'Operations',             roleId: 'coo' },
    { label: 'Finance',                roleId: 'cfo' },
    { label: 'Product',                roleId: 'product-manager' },
    { label: 'People & HR',            roleId: 'hr' },
    { label: 'Marketing & Growth',     roleId: 'marketing' },
  ],
  'vp-dir': [
    { label: 'Technology & Engineering', roleId: 'vp-technology' },
    { label: 'Operations',             roleId: 'vp-operations' },
    { label: 'Finance',                roleId: 'vp-finance' },
    { label: 'Product',                roleId: 'vp-product' },
    { label: 'Data & Analytics',       roleId: 'vp-data' },
    { label: 'Design & UX',            roleId: 'vp-design' },
    { label: 'Marketing & Growth',     roleId: 'vp-marketing' },
    { label: 'People & HR',            roleId: 'vp-hr' },
  ],
  'manager': [
    { label: 'Engineering',            roleId: 'developer' },
    { label: 'Data & Analytics',       roleId: 'data-analyst' },
    { label: 'Product',                roleId: 'product-manager' },
    { label: 'Design & UX',            roleId: 'designer' },
    { label: 'Marketing & Growth',     roleId: 'marketing' },
    { label: 'People & HR',            roleId: 'hr' },
    { label: 'Operations',             roleId: 'director' },
  ],
  'specialist': [
    { label: 'Software Engineer / Developer', roleId: 'developer' },
    { label: 'Data Scientist / ML Engineer',  roleId: 'data-scientist' },
    { label: 'Data / Business Analyst',       roleId: 'data-analyst' },
    { label: 'Designer / UX',                 roleId: 'designer' },
    { label: 'Marketing / Growth',            roleId: 'marketing' },
    { label: 'People & HR',                   roleId: 'hr' },
    { label: 'Product Manager',               roleId: 'product-manager' },
  ],
}

// ─── Slide animation variants ─────────────────────────────────────────────────

const slideVariants = {
  enter: (dir: 'right' | 'left') => ({ x: dir === 'right' ? 60 : -60, opacity: 0 }),
  center: { x: 0, opacity: 1 },
  exit: (dir: 'right' | 'left') => ({ x: dir === 'right' ? -60 : 60, opacity: 0 }),
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function StepHeading({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div className="text-center mb-8">
      <h2 className="text-3xl md:text-4xl font-bold text-white mb-2 leading-tight">{title}</h2>
      {subtitle && <p className="text-[#94A3B8] text-sm">{subtitle}</p>}
    </div>
  )
}

function SingleOptionButton({ label, selected, onClick }: { label: string; selected: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`w-full min-h-[60px] px-4 py-3.5 rounded-xl border text-left text-sm font-medium transition-all ${
        selected
          ? 'border-[#7C3AED] bg-[#7C3AED]/15 text-white'
          : 'border-[#222222] bg-[#111111] text-[#94A3B8] hover:border-[#444] hover:text-white'
      }`}
    >
      {label}
    </button>
  )
}

function DomainCard({ domain, selected, onClick }: { domain: Domain; selected: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`relative flex flex-col gap-1.5 p-3 rounded-xl border text-left transition-all ${
        selected
          ? 'border-[#7C3AED] bg-[#7C3AED]/15'
          : 'border-[#222222] bg-[#111111] hover:border-[#444]'
      }`}
    >
      {selected && (
        <div className="absolute top-2 right-2 w-4 h-4 rounded-full bg-[#7C3AED] flex items-center justify-center">
          <span className="text-white text-[9px] font-bold">✓</span>
        </div>
      )}
      <span className="text-xl leading-none">{domain.icon}</span>
      <span className={`text-xs font-semibold leading-tight pr-4 ${selected ? 'text-white' : 'text-[#94A3B8]'}`}>
        {domain.label}
      </span>
    </button>
  )
}

// ─── Step 0: Level ───────────────────────────────────────────────────────────

function LevelStep({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div className="w-full max-w-sm mx-auto">
      <StepHeading title="What's your level?" subtitle="We'll calibrate depth and framing to match your perspective" />
      <div className="flex flex-col gap-3">
        {ROLE_LEVELS.map((l) => (
          <button
            key={l.id}
            onClick={() => onChange(l.id)}
            className={`w-full p-4 rounded-xl border text-left transition-all ${
              value === l.id
                ? 'border-[#7C3AED] bg-[#7C3AED]/15'
                : 'border-[#222222] bg-[#111111] hover:border-[#444]'
            }`}
          >
            <div className={`text-sm font-semibold ${value === l.id ? 'text-white' : 'text-[#94A3B8]'}`}>{l.label}</div>
            <div className="text-xs text-[#475569] mt-0.5">{l.subtitle}</div>
          </button>
        ))}
      </div>
    </div>
  )
}

// ─── Step 1: Department → resolves to roleId ─────────────────────────────────

function DepartmentStep({ levelId, value, onChange }: { levelId: string; value: string; onChange: (roleId: string) => void }) {
  const options = DEPARTMENTS[levelId] ?? []
  return (
    <div className="w-full max-w-sm mx-auto">
      <StepHeading title="Select your functional area" subtitle="This shapes the framing, depth, and examples in every session" />
      <div className="flex flex-col gap-2">
        {options.map((o) => (
          <SingleOptionButton key={o.label} label={o.label} selected={value === o.roleId} onClick={() => onChange(o.roleId)} />
        ))}
      </div>
    </div>
  )
}

// ─── Step 2: Domain selection ─────────────────────────────────────────────────

function DomainStep({
  roleId,
  selected,
  customDomains,
  onToggle,
  onAddCustom,
  onRemoveCustom,
}: {
  roleId: string
  selected: string[]
  customDomains: string[]
  onToggle: (id: string) => void
  onAddCustom: (label: string) => void
  onRemoveCustom: (label: string) => void
}) {
  const [search, setSearch] = useState('')
  const [customInput, setCustomInput] = useState('')
  const [showAll, setShowAll] = useState(false)

  const roleDomains = useMemo(() => getDomainsForRole(roleId), [roleId])
  const primaryDomains = roleDomains.slice(0, 7)
  const secondaryDomains = roleDomains.slice(7)

  const searchResults = useMemo(
    () => (search.trim().length > 1 ? searchDomains(search) : []),
    [search]
  )

  const displayDomains = search.trim().length > 1
    ? searchResults
    : showAll
    ? roleDomains
    : primaryDomains

  function handleAddCustom() {
    const label = customInput.trim()
    if (label && !customDomains.includes(label)) {
      onAddCustom(label)
      setCustomInput('')
    }
  }

  return (
    <div className="w-full max-w-2xl mx-auto">
      <StepHeading
        title="What do you want to learn?"
        subtitle="Pick everything that interests you — we'll build paths for each"
      />

      {/* Search */}
      <div className="relative mb-4">
        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#475569]" />
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search any domain or technology..."
          className="w-full bg-[#111111] border border-[#222222] text-white text-sm rounded-xl pl-9 pr-4 py-2.5 focus:outline-none focus:border-[#7C3AED] placeholder-[#475569] transition-colors"
        />
      </div>

      {/* Domain grid */}
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2 mb-3">
        {displayDomains.map((d) => (
          <DomainCard
            key={d.id}
            domain={d}
            selected={selected.includes(d.id)}
            onClick={() => onToggle(d.id)}
          />
        ))}
      </div>

      {/* Show more */}
      {!search && secondaryDomains.length > 0 && (
        <button
          onClick={() => setShowAll((v) => !v)}
          className="text-xs text-[#475569] hover:text-[#94A3B8] transition-colors mb-4"
        >
          {showAll ? '↑ Show fewer' : `↓ Show ${secondaryDomains.length} more domains`}
        </button>
      )}

      {/* Custom domain input */}
      <div className="mt-2 flex gap-2">
        <input
          type="text"
          value={customInput}
          onChange={(e) => setCustomInput(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleAddCustom()}
          placeholder="Don't see your topic? Type it here..."
          className="flex-1 bg-[#111111] border border-[#222222] text-white text-sm rounded-xl px-4 py-2.5 focus:outline-none focus:border-[#7C3AED] placeholder-[#475569] transition-colors"
        />
        <button
          onClick={handleAddCustom}
          disabled={!customInput.trim()}
          className="px-3 py-2.5 rounded-xl border border-[#333] text-[#94A3B8] hover:border-[#7C3AED] hover:text-white disabled:opacity-30 transition-colors"
        >
          <Plus size={16} />
        </button>
      </div>

      {/* Custom domain chips */}
      {customDomains.length > 0 && (
        <div className="flex flex-wrap gap-2 mt-3">
          {customDomains.map((label) => (
            <div key={label} className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-[#7C3AED]/20 border border-[#7C3AED]/40 text-[#A855F7] text-xs">
              {label}
              <button onClick={() => onRemoveCustom(label)} className="hover:text-white transition-colors">
                <X size={11} />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Selection count */}
      {(selected.length > 0 || customDomains.length > 0) && (
        <p className="mt-4 text-xs text-[#475569] text-center">
          {selected.length + customDomains.length} domain{selected.length + customDomains.length !== 1 ? 's' : ''} selected
        </p>
      )}
    </div>
  )
}

// ─── Step 3: Proficiency per domain ──────────────────────────────────────────

function ProficiencyStep({
  selectedDomainIds,
  customDomains,
  proficiencies,
  onChange,
}: {
  selectedDomainIds: string[]
  customDomains: string[]
  proficiencies: Record<string, Proficiency>
  onChange: (domainKey: string, level: Proficiency) => void
}) {
  const allDomains = useMemo(() => {
    const fromTaxonomy = selectedDomainIds.map((id) => {
      const d = ALL_DOMAINS.find((x) => x.id === id)
      return d ? { key: d.id, label: d.label, icon: d.icon } : null
    }).filter(Boolean) as { key: string; label: string; icon: string }[]

    const fromCustom = customDomains.map((label) => ({ key: label, label, icon: '📌' }))
    return [...fromTaxonomy, ...fromCustom]
  }, [selectedDomainIds, customDomains])

  return (
    <div className="w-full max-w-lg mx-auto">
      <StepHeading
        title="What's your current level?"
        subtitle="Be honest — we calibrate the depth of every session to match"
      />
      <div className="flex flex-col gap-4">
        {allDomains.map(({ key, label, icon }) => (
          <div key={key} className="bg-[#111111] border border-[#1A1A1A] rounded-xl p-4">
            <p className="text-white text-sm font-medium mb-3">
              <span className="mr-2">{icon}</span>{label}
            </p>
            <div className="grid grid-cols-2 gap-2">
              {PROFICIENCY_LEVELS.map((p) => (
                <button
                  key={p.value}
                  onClick={() => onChange(key, p.value)}
                  className={`px-3 py-2.5 rounded-lg border text-left transition-all ${
                    proficiencies[key] === p.value
                      ? 'border-[#7C3AED] bg-[#7C3AED]/15 text-white'
                      : 'border-[#222] text-[#475569] hover:border-[#444] hover:text-[#94A3B8]'
                  }`}
                >
                  <div className="text-xs font-semibold leading-tight">{p.label}</div>
                  <div className="text-[10px] text-[#475569] mt-0.5 leading-tight">{p.description}</div>
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

// ─── Step 4: Learning goal ────────────────────────────────────────────────────

function GoalStep({ value, onChange }: { value: LearningGoal | ''; onChange: (v: LearningGoal) => void }) {
  return (
    <div className="w-full max-w-sm mx-auto">
      <StepHeading
        title="How much time can you commit?"
        subtitle="We'll pace your sessions to match your schedule"
      />
      <div className="flex flex-col gap-3">
        {LEARNING_GOALS.map((g) => (
          <button
            key={g.value}
            onClick={() => onChange(g.value)}
            className={`w-full p-4 rounded-xl border text-left transition-all ${
              value === g.value
                ? 'border-[#7C3AED] bg-[#7C3AED]/15'
                : 'border-[#222222] bg-[#111111] hover:border-[#444]'
            }`}
          >
            <div className={`text-sm font-semibold ${value === g.value ? 'text-white' : 'text-[#94A3B8]'}`}>
              {g.label}
            </div>
            <div className="text-xs text-[#475569] mt-0.5">{g.description}</div>
          </button>
        ))}
      </div>
    </div>
  )
}

// ─── Step 5: Sub-domain ───────────────────────────────────────────────────────

function SubDomainStep({
  primaryDomainId,
  value,
  onChange,
}: {
  primaryDomainId: string
  value: string
  onChange: (v: string) => void
}) {
  const domainName = getDomainDisplayName(primaryDomainId)
  const subDomains = getSubDomains(primaryDomainId)

  return (
    <div className="w-full max-w-sm mx-auto">
      <StepHeading
        title={`Which area of ${domainName} describes your work best?`}
      />
      <div className="flex flex-col gap-2">
        {subDomains.map((sd) => (
          <SingleOptionButton
            key={sd}
            label={sd}
            selected={value === sd}
            onClick={() => onChange(sd)}
          />
        ))}
      </div>
    </div>
  )
}

// ─── Main onboarding flow ─────────────────────────────────────────────────────

function OnboardingContent() {
  const router = useRouter()
  const { isLoaded: clerkLoaded, isSignedIn } = useUser()
  const { getToken } = useAuth()
  // Ref so the setTimeout async loop always sees the latest isSignedIn value
  const isSignedInRef = useRef(false)
  isSignedInRef.current = !!(clerkLoaded && isSignedIn)

  const [step, setStep] = useState(0)
  const [direction, setDirection] = useState<'right' | 'left'>('right')
  const [building, setBuilding] = useState(false)

  // Step answers
  const [roleLevel, setRoleLevel] = useState('')          // step 0: level bucket
  const [role, setRole] = useState('')                    // step 1: resolved roleId
  const [industry, setIndustry] = useState('')            // step 2: industry sector
  const [aiEngagement, setAiEngagement] = useState<'observer' | 'emerging' | 'practitioner' | 'leader' | ''>('')  // step 3
  const [selectedDomains, setSelectedDomains] = useState<string[]>([])
  const [customDomains, setCustomDomains] = useState<string[]>([])
  const [learningGoal, setLearningGoal] = useState<LearningGoal | ''>('')
  const goalTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [submitError, setSubmitError] = useState<string | null>(null)

  // ── Auto-submit after sign-up return ─────────────────────────────────────────
  // When the user returns from Google sign-up, they land back on /onboarding.
  // If localStorage has their answers from the anonymous flow, auto-submit them
  // now that they're authenticated — no need to re-fill the form.
  useEffect(() => {
    if (!clerkLoaded || !isSignedIn) return
    const saved = localStorage.getItem('clio_onboarding')
    if (!saved) return
    try {
      const parsed = JSON.parse(saved) as {
        role?: string; roleLevel?: string; industry?: string; aiMaturity?: string
        domains?: string[]; customDomains?: string[]; primaryDomain?: string
        domainProficiency?: Record<string, string>; learningGoal?: string; subDomain?: string
      }
      if (!parsed.role || !parsed.learningGoal) return
      setBuilding(true)
      localStorage.removeItem('clio_onboarding')
      // Re-use the snapshot path — pass values directly to avoid stale closure
      const snapshot = {
        role: parsed.role ?? '',
        roleLevel: parsed.roleLevel ?? '',
        industry: parsed.industry ?? '',
        aiEngagement: (parsed.aiMaturity ?? '') as 'observer' | 'emerging' | 'practitioner' | 'leader' | '',
        selectedDomains: parsed.domains ?? [],
        customDomains: parsed.customDomains ?? [],
      }
      submitOnboarding(parsed.learningGoal as LearningGoal, snapshot)
    } catch {
      // Malformed data — just clear it and show the form normally
      localStorage.removeItem('clio_onboarding')
    }
  }, [clerkLoaded, isSignedIn]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Can proceed from each step ──────────────────────────────────────────────
  const canProceed = useMemo(() => {
    if (step === 0) return roleLevel !== ''
    if (step === 1) return role !== ''
    if (step === 2) return industry !== ''
    if (step === 3) return aiEngagement !== ''
    if (step === 4) return selectedDomains.length > 0 || customDomains.length > 0
    // Step 5 (GoalStep) auto-advances on selection — no Continue button shown
    return false
  }, [step, roleLevel, role, industry, aiEngagement, selectedDomains, customDomains])

  // ── Domain handlers ─────────────────────────────────────────────────────────
  function toggleDomain(id: string) {
    setSelectedDomains((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    )
  }
  function addCustomDomain(label: string) {
    setCustomDomains((prev) => [...prev, label])
  }
  function removeCustomDomain(label: string) {
    setCustomDomains((prev) => prev.filter((x) => x !== label))
  }

  // ── Auto-advance handler for step 5 goal selection ─────────────────────────
  // Snapshot all state synchronously at click time to avoid stale closure issues.
  // Waits for Clerk's isSignedIn before submitting — handles the brief window
  // after OAuth sign-up where the session cookie exists but isSignedIn is still false.
  function handleGoalSelect(value: LearningGoal) {
    setLearningGoal(value)
    if (goalTimerRef.current) clearTimeout(goalTimerRef.current)
    const snapshot = { role, roleLevel, industry, aiEngagement, selectedDomains, customDomains }
    goalTimerRef.current = setTimeout(async () => {
      // Try Clerk SDK getToken() first, then fall back to reading the JWT cookie
      // directly. The fallback handles Clerk dev instances where __client_uat=0
      // prevents SDK session hydration but the raw JWT cookie is still valid.
      let authToken: string | null = null
      let waited = 0
      while (!authToken && waited < 4000) {
        try { authToken = await getToken() } catch { /* not ready yet */ }
        if (!authToken) {
          await new Promise((resolve) => setTimeout(resolve, 500))
          waited += 500
        }
      }
      // SDK fallback: read __clerk_db_jwt directly from document.cookie
      if (!authToken && typeof document !== 'undefined') {
        const m = document.cookie.match(/(?:^|;\s*)__clerk_db_jwt=([^;]+)/)
        authToken = m ? m[1] : null
      }
      setBuilding(true)
      submitOnboarding(value, snapshot, 0, authToken ?? undefined)
    }, 400)
  }

  // ── Navigation ──────────────────────────────────────────────────────────────
  function handleNext() {
    if (!canProceed) return
    setDirection('right')
    setStep((s) => s + 1)
  }
  function handleBack() {
    if (step === 0) return
    setDirection('left')
    setStep((s) => s - 1)
  }

  // ── Submit ──────────────────────────────────────────────────────────────────
  // Accepts an explicit snapshot to prevent stale closure when called from setTimeout.
  // Retries up to 3 times on session_not_ready (Clerk session propagation delay).
  async function submitOnboarding(
    finalGoal: LearningGoal | '',
    snapshot?: { role: string; roleLevel: string; industry: string; aiEngagement: string; selectedDomains: string[]; customDomains: string[] },
    retryCount = 0,
    authToken?: string
  ) {
    const r = snapshot?.role ?? role
    const rl = snapshot?.roleLevel ?? roleLevel
    const ind = snapshot?.industry ?? industry
    const eng = snapshot?.aiEngagement ?? aiEngagement
    const domains = snapshot?.selectedDomains ?? selectedDomains
    const custom = snapshot?.customDomains ?? customDomains
    const primaryDomain = domains[0] ?? custom[0] ?? 'ai-ml'

    const payload = {
      role: r,
      roleLevel: rl,
      industry: ind,
      aiMaturity: eng,
      worry: '',
      deliveryPreference: 'email',
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      domains,
      customDomains: custom,
      primaryDomain,
      domainProficiency: {},
      learningGoal: finalGoal,
      subDomain: ind,  // backward compat: same value as industry
    }
    localStorage.setItem('clio_onboarding', JSON.stringify(payload))

    try {
      const res = await fetch('/api/onboarding', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          // Pass Bearer token to bypass __client_uat=0 cookie issue after OAuth sign-up
          ...(authToken ? { 'Authorization': `Bearer ${authToken}` } : {}),
        },
        body: JSON.stringify(payload),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        // Clerk session not yet propagated — retry up to 3 times with 1s delay
        if (res.status === 401 && data?.error === 'session_not_ready' && retryCount < 3) {
          console.log(`[onboarding] Session not ready, retrying (${retryCount + 1}/3)...`)
          await new Promise((resolve) => setTimeout(resolve, 1000))
          return submitOnboarding(finalGoal, snapshot, retryCount + 1, authToken)
        }
        // After retries exhausted on 401 — user needs to sign up / sign in first
        if (res.status === 401) {
          setBuilding(false)
          setSubmitError('__needs_auth__')
          return
        }
        console.error('[onboarding] API error:', data)
        setBuilding(false)
        setSubmitError("Something went wrong. We couldn't save your profile. Please try again — your answers are still here.")
        return
      }
      router.push('/topics')
    } catch {
      setBuilding(false)
      setSubmitError("Something went wrong. We couldn't save your profile. Please try again — your answers are still here.")
    }
  }

  if (submitError === '__needs_auth__') {
    return (
      <div className="min-h-screen bg-[#080808] flex flex-col items-center justify-center px-6">
        <div className="max-w-sm w-full text-center space-y-5">
          <div className="w-16 h-16 rounded-full bg-[#7C3AED]/20 border border-[#7C3AED]/40 flex items-center justify-center mx-auto">
            <span className="text-2xl font-extrabold text-white">C</span>
          </div>
          <h2 className="text-2xl font-bold text-white">Your plan is ready.</h2>
          <p className="text-[#94A3B8] text-sm">Create your account to save your personalised AI learning plan and start your 3-day free trial.</p>
          <a
            href="/sign-up?redirect_url=/onboarding"
            className="flex items-center justify-center w-full h-12 rounded-xl bg-[#7C3AED] hover:bg-[#6D28D9] text-white font-semibold text-sm transition-colors"
          >
            Create account — it&apos;s free
          </a>
          <p className="text-[#475569] text-xs">Already have an account? <a href="/sign-in?redirect_url=/onboarding" className="text-[#7C3AED] hover:text-[#A855F7]">Sign in</a></p>
        </div>
      </div>
    )
  }

  if (submitError) {
    return (
      <div className="min-h-screen bg-[#080808] flex flex-col items-center justify-center px-6">
        <div className="max-w-sm w-full text-center space-y-4">
          <h2 className="text-2xl font-bold text-white">Something went wrong.</h2>
          <p className="text-[#94A3B8] text-sm">{submitError}</p>
          <button
            onClick={() => {
              setSubmitError(null)
              submitOnboarding(learningGoal as LearningGoal)
            }}
            className="w-full h-12 rounded-xl bg-[#7C3AED] hover:bg-[#6D28D9] text-white font-semibold text-sm transition-colors"
          >
            Try Again
          </button>
        </div>
      </div>
    )
  }

  if (building) return <BuildingScreen />

  return (
    <div className="min-h-screen bg-[#080808] flex flex-col">
      <ProgressBar current={step + 1} total={TOTAL_STEPS} />

      <div className="flex-1 flex flex-col items-center justify-center px-4 py-12 overflow-y-auto">
        <AnimatePresence mode="wait" custom={direction}>
          <motion.div
            key={step}
            custom={direction}
            variants={slideVariants}
            initial="enter"
            animate="center"
            exit="exit"
            transition={{ duration: 0.3, ease: 'easeInOut' }}
            className="w-full"
          >
            {step === 0 && (
              <LevelStep value={roleLevel} onChange={(v) => { setRoleLevel(v); setRole('') }} />
            )}

            {step === 1 && (
              <DepartmentStep levelId={roleLevel} value={role} onChange={setRole} />
            )}

            {step === 2 && (
              <div className="w-full max-w-sm mx-auto">
                <StepHeading title="Which industry or area describes your work best?" />
                <div className="flex flex-col gap-2">
                  {INDUSTRY_SECTORS.map((sector) => (
                    <SingleOptionButton
                      key={sector}
                      label={sector}
                      selected={industry === sector}
                      onClick={() => setIndustry(sector)}
                    />
                  ))}
                </div>
              </div>
            )}

            {step === 3 && (
              <div className="w-full max-w-sm mx-auto">
                <StepHeading title="When it comes to AI in your work, which best describes where you are right now?" />
                <div className="flex flex-col gap-3">
                  {[
                    { label: "I'm exploring what AI can do for my business", value: 'observer' as const },
                    { label: "I'm seeing AI initiatives start and want to understand them", value: 'emerging' as const },
                    { label: "I'm being asked to lead or approve AI decisions and need to be ready", value: 'practitioner' as const },
                    { label: "I'm already using AI tools and want to go deeper", value: 'leader' as const },
                  ].map((opt) => (
                    <SingleOptionButton
                      key={opt.value}
                      label={opt.label}
                      selected={aiEngagement === opt.value}
                      onClick={() => setAiEngagement(opt.value)}
                    />
                  ))}
                </div>
              </div>
            )}

            {step === 4 && (
              <DomainStep
                roleId={role}
                selected={selectedDomains}
                customDomains={customDomains}
                onToggle={toggleDomain}
                onAddCustom={addCustomDomain}
                onRemoveCustom={removeCustomDomain}
              />
            )}

            {step === 5 && <GoalStep value={learningGoal} onChange={handleGoalSelect} />}
          </motion.div>
        </AnimatePresence>

        {/* Navigation */}
        <div className="mt-8 w-full max-w-sm flex items-center gap-3">
          {step > 0 && (
            <button
              onClick={handleBack}
              className="flex items-center justify-center w-12 h-12 rounded-xl border border-[#333333] text-[#94A3B8] hover:text-white hover:border-[#555] transition-colors shrink-0"
            >
              <ArrowLeft size={18} />
            </button>
          )}
          {/* Step 5 (goal) auto-advances on selection — no Continue button needed */}
          {step < TOTAL_STEPS - 1 && (
            <button
              onClick={handleNext}
              disabled={!canProceed}
              className="flex-1 flex items-center justify-center gap-2 h-12 rounded-xl bg-[#7C3AED] hover:bg-[#6D28D9] disabled:opacity-40 disabled:cursor-not-allowed text-white font-semibold text-sm transition-colors"
            >
              Continue
              <ArrowRight size={16} />
            </button>
          )}
        </div>

        <p className="mt-5 text-xs text-[#333333]">{step + 1} of {TOTAL_STEPS}</p>
      </div>
    </div>
  )
}

// ─── Exports ──────────────────────────────────────────────────────────────────

export default function OnboardingPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-[#080808]" />}>
      <OnboardingContent />
    </Suspense>
  )
}

function BuildingScreen() {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="min-h-screen bg-[#080808] flex flex-col items-center justify-center px-6"
    >
      <div className="relative w-24 h-24 mb-8">
        <motion.div
          animate={{ scale: [1, 1.4, 1], opacity: [0.6, 0, 0.6] }}
          transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut' }}
          className="absolute inset-0 rounded-full bg-[#7C3AED]"
        />
        <div className="relative w-24 h-24 rounded-full bg-[#7C3AED] flex items-center justify-center">
          <span className="text-2xl font-extrabold text-white tracking-tight">C</span>
        </div>
      </div>
      <h2 className="text-3xl font-bold text-white mb-3">Got it.</h2>
      <motion.p
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.5 }}
        className="text-[#94A3B8] text-center"
      >
        Calibrating your AI learning path...
      </motion.p>
      <div className="mt-8 flex gap-2">
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
  )
}
