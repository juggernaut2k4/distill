'use client'

import { useState, Suspense, useMemo } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { useRouter } from 'next/navigation'
import { useUser } from '@clerk/nextjs'
import { ProgressBar } from '@/components/onboarding/ProgressBar'
import { ArrowRight, ArrowLeft, Plus, X, Search } from 'lucide-react'
import {
  ALL_DOMAINS, PROFICIENCY_LEVELS, LEARNING_GOALS,
  getDomainsForRole, searchDomains,
  type Domain, type Proficiency, type LearningGoal,
} from '@/lib/learning/taxonomy'

// ─── Step definitions ─────────────────────────────────────────────────────────

const TOTAL_STEPS = 6
// 0: Level  1: Department → resolves roleId  2: Domains  3: Proficiency  4: Goal  5: Industry

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
    { label: 'Technology & Engineering', roleId: 'cto' },
    { label: 'Operations',             roleId: 'coo' },
    { label: 'Finance',                roleId: 'cfo' },
    { label: 'Product',                roleId: 'product-manager' },
    { label: 'Data & Analytics',       roleId: 'data-analyst' },
    { label: 'Design & UX',            roleId: 'designer' },
    { label: 'Marketing & Growth',     roleId: 'marketing' },
    { label: 'People & HR',            roleId: 'hr' },
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

// ─── Industry options (kept for so_what personalisation) ─────────────────────

const INDUSTRIES = [
  'Technology / SaaS',
  'Financial Services / Banking',
  'Healthcare / Life Sciences',
  'Retail / E-commerce',
  'Manufacturing / Supply Chain',
  'Consulting / Professional Services',
  'Media / Entertainment',
  'Education',
  'Government / Public Sector',
  'Other',
]

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

// ─── Step 1: Domain selection ─────────────────────────────────────────────────

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
      <div className="grid grid-cols-3 sm:grid-cols-4 gap-2 mb-3">
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

// ─── Step 2: Proficiency per domain ──────────────────────────────────────────

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

// ─── Step 3: Learning goal ────────────────────────────────────────────────────

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

// ─── Step 4: Industry ─────────────────────────────────────────────────────────

function IndustryStep({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div className="w-full max-w-sm mx-auto">
      <StepHeading
        title="What's your industry?"
        subtitle="We use this to make every insight relevant to your world"
      />
      <div className="flex flex-col gap-2">
        {INDUSTRIES.map((ind) => (
          <SingleOptionButton key={ind} label={ind} selected={value === ind} onClick={() => onChange(ind)} />
        ))}
      </div>
    </div>
  )
}

// ─── Main onboarding flow ─────────────────────────────────────────────────────

function OnboardingContent() {
  const router = useRouter()
  const { isLoaded, isSignedIn } = useUser()

  const [step, setStep] = useState(0)
  const [direction, setDirection] = useState<'right' | 'left'>('right')
  const [building, setBuilding] = useState(false)

  // Step answers
  const [roleLevel, setRoleLevel] = useState('')          // step 0: level bucket
  const [role, setRole] = useState('')                    // step 1: resolved roleId
  const [selectedDomains, setSelectedDomains] = useState<string[]>([])
  const [customDomains, setCustomDomains] = useState<string[]>([])
  const [proficiencies, setProficiencies] = useState<Record<string, Proficiency>>({})
  const [learningGoal, setLearningGoal] = useState<LearningGoal | ''>('')
  const [industry, setIndustry] = useState('')

  // ── Can proceed from each step ──────────────────────────────────────────────
  const canProceed = useMemo(() => {
    if (step === 0) return roleLevel !== ''
    if (step === 1) return role !== ''
    if (step === 2) return selectedDomains.length > 0 || customDomains.length > 0
    if (step === 3) {
      const allKeys = [...selectedDomains, ...customDomains]
      return allKeys.length > 0 && allKeys.every((k) => proficiencies[k])
    }
    if (step === 4) return learningGoal !== ''
    if (step === 5) return industry !== ''
    return false
  }, [step, roleLevel, role, selectedDomains, customDomains, proficiencies, learningGoal, industry])

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
    setProficiencies((prev) => { const next = { ...prev }; delete next[label]; return next })
  }

  // ── Navigation ──────────────────────────────────────────────────────────────
  function handleNext() {
    if (!canProceed) return
    if (step < TOTAL_STEPS - 1) {
      setDirection('right')
      setStep((s) => s + 1)
    } else {
      setBuilding(true)
      submitOnboarding()
    }
  }
  function handleBack() {
    if (step === 0) return
    setDirection('left')
    setStep((s) => s - 1)
  }

  // ── Submit ──────────────────────────────────────────────────────────────────
  async function submitOnboarding() {
    const primaryDomain = selectedDomains[0] ?? customDomains[0] ?? 'ai-ml'
    const domainProficiency: Record<string, string> = {}
    ;[...selectedDomains, ...customDomains].forEach((k) => {
      domainProficiency[k] = proficiencies[k] ?? 'intermediate'
    })

    const payload = {
      role,
      industry,
      aiMaturity: proficiencies[primaryDomain] ?? 'intermediate',
      worry: '',
      deliveryPreference: 'email',
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      // new multi-domain fields
      domains: selectedDomains,
      customDomains,
      primaryDomain,
      domainProficiency,
      learningGoal,
    }
    localStorage.setItem('clio_onboarding', JSON.stringify(payload))

    setTimeout(() => {
      router.push(isSignedIn ? '/plan' : '/sign-up')
    }, 2000)
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
              <DomainStep
                roleId={role}
                selected={selectedDomains}
                customDomains={customDomains}
                onToggle={toggleDomain}
                onAddCustom={addCustomDomain}
                onRemoveCustom={removeCustomDomain}
              />
            )}

            {step === 3 && (
              <ProficiencyStep
                selectedDomainIds={selectedDomains}
                customDomains={customDomains}
                proficiencies={proficiencies}
                onChange={(key, level) => setProficiencies((p) => ({ ...p, [key]: level }))}
              />
            )}

            {step === 4 && <GoalStep value={learningGoal} onChange={setLearningGoal} />}

            {step === 5 && <IndustryStep value={industry} onChange={setIndustry} />}
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
          <button
            onClick={handleNext}
            disabled={!canProceed}
            className="flex-1 flex items-center justify-center gap-2 h-12 rounded-xl bg-[#7C3AED] hover:bg-[#6D28D9] disabled:opacity-40 disabled:cursor-not-allowed text-white font-semibold text-sm transition-colors"
          >
            {step === TOTAL_STEPS - 1 ? 'Build my learning plan' : 'Continue'}
            <ArrowRight size={16} />
          </button>
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
        Building your personalised learning paths…
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
