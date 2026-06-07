/**
 * User learning profile — cross-domain, updated after every session.
 * Drives proactive Clio personalisation and cross-domain connections.
 */

import Anthropic from '@anthropic-ai/sdk'
import { createSupabaseAdminClient } from '@/lib/supabase'

// ─── TYPES ────────────────────────────────────────────────────────────────────

export interface VocabFingerprint {
  domain_terms: string[]
  detected_register: 'finance' | 'technical' | 'operations' | 'legal' | 'general'
  example_preference: 'quantitative' | 'narrative' | 'mixed'
}

export interface UserLearningProfile {
  userId: string
  // Existing cross-domain dimensions
  domainsActive: string[]
  perDomainLevels: Record<string, string>
  perDomainInterests: Record<string, string[]>
  perDomainGaps: Record<string, string[]>
  questionsHistory: QuestionRecord[]
  sessionHistory: SessionRecord[]
  overallGoal: string | null
  profileSummary: string | null
  crossDomainBridges: string[]
  updatedAt: string
  // Intellectual dimensions (migration 031)
  reasoningStyle: 'systems' | 'sequential' | 'analogical'
  abstractionComfort: 'abstract' | 'concrete' | 'mixed'
  questionDepthPattern: 'basic' | 'intermediate' | 'advanced'
  sessionsEndedEarly: number
  sessionsRanLong: number
  sessionsOnTime: number
  // Psychological dimensions
  learningMotivation: 'fear_driven' | 'opportunity_driven' | 'compliance_driven'
  riskTolerance: 'conservative' | 'aggressive' | 'balanced'
  // Business focus
  businessFocusLens: 'cost_reduction' | 'productivity' | 'capability_building' | 'risk_compliance' | 'competitive_edge' | 'team_enablement'
  // Vocabulary
  vocabFingerprint: VocabFingerprint
  // Confidence
  profileConfidence: 'low' | 'medium' | 'high'
  sessionsUsedForProfile: number
}

export interface QuestionRecord {
  question: string
  domain: string
  sessionId: string
  askedAt: string
}

export interface SessionRecord {
  sessionId: string
  domain: string
  topicTitle: string
  keyInsights: string[]
  completedAt: string
}

// ─── READ ─────────────────────────────────────────────────────────────────────

export async function getUserLearningProfile(userId: string): Promise<UserLearningProfile | null> {
  const supabase = createSupabaseAdminClient()
  const { data } = await supabase
    .from('user_learning_profiles')
    .select('*')
    .eq('user_id', userId)
    .maybeSingle()

  if (!data) return null

  const defaultVocab: VocabFingerprint = { domain_terms: [], detected_register: 'general', example_preference: 'mixed' }

  return {
    userId: data.user_id,
    domainsActive: data.domains_active ?? [],
    perDomainLevels: data.per_domain_levels ?? {},
    perDomainInterests: data.per_domain_interests ?? {},
    perDomainGaps: data.per_domain_gaps ?? {},
    questionsHistory: data.questions_history ?? [],
    sessionHistory: data.session_history ?? [],
    overallGoal: data.overall_goal ?? null,
    profileSummary: data.profile_summary ?? null,
    crossDomainBridges: data.cross_domain_bridges ?? [],
    updatedAt: data.updated_at,
    // Intellectual
    reasoningStyle: (data.reasoning_style as UserLearningProfile['reasoningStyle']) ?? 'sequential',
    abstractionComfort: (data.abstraction_comfort as UserLearningProfile['abstractionComfort']) ?? 'mixed',
    questionDepthPattern: (data.question_depth_pattern as UserLearningProfile['questionDepthPattern']) ?? 'basic',
    sessionsEndedEarly: data.sessions_ended_early ?? 0,
    sessionsRanLong: data.sessions_ran_long ?? 0,
    sessionsOnTime: data.sessions_on_time ?? 0,
    // Psychological
    learningMotivation: (data.learning_motivation as UserLearningProfile['learningMotivation']) ?? 'opportunity_driven',
    riskTolerance: (data.risk_tolerance as UserLearningProfile['riskTolerance']) ?? 'balanced',
    // Business
    businessFocusLens: (data.business_focus_lens as UserLearningProfile['businessFocusLens']) ?? 'capability_building',
    // Vocab
    vocabFingerprint: (data.vocab_fingerprint as VocabFingerprint | null) ?? defaultVocab,
    // Confidence
    profileConfidence: (data.profile_confidence as UserLearningProfile['profileConfidence']) ?? 'low',
    sessionsUsedForProfile: data.sessions_used_for_profile ?? 0,
  }
}

// ─── UPDATE AFTER SESSION ─────────────────────────────────────────────────────

export interface SessionCompletedPayload {
  userId: string
  sessionId: string
  domain: string
  topicTitle: string
  questionsAsked: string[]
  sessionSentiment: string         // 'positive' | 'neutral' | 'confused'
  sessionDurationMins?: number     // actual duration for attention proxy
  plannedDurationMins?: number     // planned duration for attention proxy
}

/**
 * Called by the Inngest job after a session ends.
 * Fetches the current profile, calls Claude to update it, saves the result.
 */
export async function updateProfileAfterSession(payload: SessionCompletedPayload): Promise<void> {
  const supabase = createSupabaseAdminClient()

  // Fetch current profile (or bootstrap empty one)
  const existing = await getUserLearningProfile(payload.userId)

  // Fetch user's role/industry for context
  const { data: user } = await supabase
    .from('users')
    .select('role, industry, domains, domain_proficiency, primary_domain')
    .eq('id', payload.userId)
    .maybeSingle()

  const currentProfile = existing ?? {
    domainsActive: user?.domains ?? [],
    perDomainLevels: user?.domain_proficiency ?? {},
    perDomainInterests: {},
    perDomainGaps: {},
    questionsHistory: [],
    sessionHistory: [],
    overallGoal: null,
    profileSummary: null,
    crossDomainBridges: [],
  }

  // Build new question records
  const now = new Date().toISOString()
  const newQuestions: QuestionRecord[] = payload.questionsAsked.map((q) => ({
    question: q,
    domain: payload.domain,
    sessionId: payload.sessionId,
    askedAt: now,
  }))

  // Build new session record
  const newSessionRecord: SessionRecord = {
    sessionId: payload.sessionId,
    domain: payload.domain,
    topicTitle: payload.topicTitle,
    keyInsights: [],
    completedAt: now,
  }

  // Append new data
  const allQuestions = [...currentProfile.questionsHistory, ...newQuestions].slice(-50)
  const allSessions = [...currentProfile.sessionHistory, newSessionRecord].slice(-100)

  // Ensure domain is tracked
  const domainsActive = Array.from(new Set([...currentProfile.domainsActive, payload.domain]))

  // Ask Claude to update the profile narrative
  const updatedProfile = await generateUpdatedProfile({
    userId: payload.userId,
    role: user?.role ?? 'executive',
    industry: user?.industry ?? 'business',
    domain: payload.domain,
    topicTitle: payload.topicTitle,
    questionsAsked: payload.questionsAsked,
    sessionSentiment: payload.sessionSentiment,
    currentSummary: currentProfile.profileSummary,
    currentGaps: currentProfile.perDomainGaps,
    currentInterests: currentProfile.perDomainInterests,
    domainsActive,
  })

  // Merge gaps and interests
  const updatedGaps = {
    ...currentProfile.perDomainGaps,
    [payload.domain]: updatedProfile.domainGaps,
  }
  const updatedInterests = {
    ...currentProfile.perDomainInterests,
    [payload.domain]: updatedProfile.domainInterests,
  }

  // Classify new profile dimensions from questions asked this session
  const newDimensions = await classifyProfileDimensions({
    userId: payload.userId,
    questionsAsked: payload.questionsAsked,
    role: user?.role ?? 'executive',
    industry: user?.industry ?? 'business',
    currentProfile: currentProfile as Partial<UserLearningProfile>,
  })

  // Compute updated session attention proxy
  const attentionUpdate = payload.sessionDurationMins !== undefined && payload.plannedDurationMins !== undefined
    ? computeAttentionProxy(payload.sessionDurationMins, payload.plannedDurationMins, currentProfile as Partial<UserLearningProfile>)
    : {}

  const newSessionCount = (currentProfile as Partial<UserLearningProfile>).sessionsUsedForProfile ?? 0
  const nextSessionCount = newSessionCount + 1
  const nextConfidence = computeProfileConfidence(nextSessionCount)

  // Upsert the profile — merge existing + new dimensions
  await supabase
    .from('user_learning_profiles')
    .upsert(
      {
        user_id: payload.userId,
        domains_active: domainsActive,
        per_domain_levels: currentProfile.perDomainLevels,
        per_domain_interests: updatedInterests,
        per_domain_gaps: updatedGaps,
        questions_history: allQuestions,
        session_history: allSessions,
        overall_goal: currentProfile.overallGoal,
        profile_summary: updatedProfile.profileSummary,
        cross_domain_bridges: updatedProfile.crossDomainBridges,
        // New dimension fields (migration 031)
        reasoning_style: newDimensions.reasoningStyle ?? (currentProfile as Partial<UserLearningProfile>).reasoningStyle ?? 'sequential',
        abstraction_comfort: newDimensions.abstractionComfort ?? (currentProfile as Partial<UserLearningProfile>).abstractionComfort ?? 'mixed',
        question_depth_pattern: newDimensions.questionDepthPattern ?? (currentProfile as Partial<UserLearningProfile>).questionDepthPattern ?? 'basic',
        learning_motivation: newDimensions.learningMotivation ?? (currentProfile as Partial<UserLearningProfile>).learningMotivation ?? 'opportunity_driven',
        risk_tolerance: newDimensions.riskTolerance ?? (currentProfile as Partial<UserLearningProfile>).riskTolerance ?? 'balanced',
        business_focus_lens: newDimensions.businessFocusLens ?? (currentProfile as Partial<UserLearningProfile>).businessFocusLens ?? 'capability_building',
        vocab_fingerprint: newDimensions.vocabFingerprint ?? (currentProfile as Partial<UserLearningProfile>).vocabFingerprint ?? { domain_terms: [], detected_register: 'general', example_preference: 'mixed' },
        sessions_used_for_profile: nextSessionCount,
        profile_confidence: nextConfidence,
        ...attentionUpdate,
      },
      { onConflict: 'user_id' }
    )
}

// ─── ATTENTION PROXY ──────────────────────────────────────────────────────────

function computeAttentionProxy(
  actualMins: number,
  plannedMins: number,
  current: Partial<UserLearningProfile>
): Record<string, number> {
  const ratio = actualMins / plannedMins
  if (ratio < 0.75) return { sessions_ended_early: (current.sessionsEndedEarly ?? 0) + 1 }
  if (ratio > 1.2) return { sessions_ran_long: (current.sessionsRanLong ?? 0) + 1 }
  return { sessions_on_time: (current.sessionsOnTime ?? 0) + 1 }
}

// ─── CLAUDE: DIMENSION CLASSIFIER ────────────────────────────────────────────

interface DimensionClassificationInput {
  userId: string
  questionsAsked: string[]
  role: string
  industry: string
  currentProfile: Partial<UserLearningProfile>
}

interface DimensionClassificationOutput {
  reasoningStyle?: UserLearningProfile['reasoningStyle']
  abstractionComfort?: UserLearningProfile['abstractionComfort']
  questionDepthPattern?: UserLearningProfile['questionDepthPattern']
  learningMotivation?: UserLearningProfile['learningMotivation']
  riskTolerance?: UserLearningProfile['riskTolerance']
  businessFocusLens?: UserLearningProfile['businessFocusLens']
  vocabFingerprint?: VocabFingerprint
}

async function classifyProfileDimensions(
  input: DimensionClassificationInput
): Promise<DimensionClassificationOutput> {
  // No questions to classify — return empty (keep existing values)
  if (input.questionsAsked.length === 0) return {}

  const isPlaceholder = !process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_API_KEY.startsWith('PLACEHOLDER')

  if (isPlaceholder) {
    // Deterministic mock: infer from keywords in questions
    const combined = input.questionsAsked.join(' ').toLowerCase()
    const focusLens = combined.includes('cost') || combined.includes('saving')
      ? 'cost_reduction'
      : combined.includes('risk') || combined.includes('compliance') || combined.includes('regulation')
      ? 'risk_compliance'
      : combined.includes('team') || combined.includes('staff')
      ? 'team_enablement'
      : 'capability_building'
    return {
      questionDepthPattern: combined.includes('how') && combined.includes('why') ? 'intermediate' : 'basic',
      businessFocusLens: focusLens,
    }
  }

  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

  const prompt = `You are a learning analytics classifier. Analyse the questions a senior executive asked during an AI coaching session and classify their learning profile dimensions.

EXECUTIVE CONTEXT:
- Role: ${input.role}
- Industry: ${input.industry}

QUESTIONS THEY ASKED:
${input.questionsAsked.map((q, i) => `${i + 1}. "${q}"`).join('\n')}

TASK: Return ONLY valid JSON. Classify each dimension based on the questions. If you cannot confidently classify a dimension from the available data, omit it from the response.

{
  "reasoningStyle": "systems" | "sequential" | "analogical",
  "abstractionComfort": "abstract" | "concrete" | "mixed",
  "questionDepthPattern": "basic" | "intermediate" | "advanced",
  "learningMotivation": "fear_driven" | "opportunity_driven" | "compliance_driven",
  "riskTolerance": "conservative" | "aggressive" | "balanced",
  "businessFocusLens": "cost_reduction" | "productivity" | "capability_building" | "risk_compliance" | "competitive_edge" | "team_enablement",
  "vocabFingerprint": {
    "domain_terms": ["specific technical or domain terms the person used — max 10"],
    "detected_register": "finance" | "technical" | "operations" | "legal" | "general",
    "example_preference": "quantitative" | "narrative" | "mixed"
  }
}

CLASSIFICATION RULES:
- reasoningStyle: "systems" if questions show interest in interconnections/second-order effects; "sequential" if step-by-step; "analogical" if they use comparisons
- abstractionComfort: "abstract" if questions stay at principle level; "concrete" if always asking for examples; "mixed" if both
- questionDepthPattern: "basic" if definitional; "intermediate" if application; "advanced" if trade-offs/critique
- learningMotivation: "fear_driven" if questions focus on risks/threats; "opportunity_driven" if focus on gains; "compliance_driven" if focus on rules/governance
- riskTolerance: "conservative" if cautious framing; "aggressive" if bias toward action; "balanced" if both
- businessFocusLens: the primary business outcome lens in their questions`

  try {
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 400,
      messages: [{ role: 'user', content: prompt }],
    })
    const raw = response.content[0].type === 'text' ? response.content[0].text : '{}'
    const cleaned = raw.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '').trim()
    return JSON.parse(cleaned) as DimensionClassificationOutput
  } catch (err) {
    console.error('[user-profile] Dimension classification failed:', err)
    return {}
  }
}

// ─── CLAUDE: PROFILE UPDATE ───────────────────────────────────────────────────

interface ProfileUpdateInput {
  userId: string
  role: string
  industry: string
  domain: string
  topicTitle: string
  questionsAsked: string[]
  sessionSentiment: string
  currentSummary: string | null
  currentGaps: Record<string, string[]>
  currentInterests: Record<string, string[]>
  domainsActive: string[]
}

interface ProfileUpdateOutput {
  profileSummary: string
  domainGaps: string[]
  domainInterests: string[]
  crossDomainBridges: string[]
}

async function generateUpdatedProfile(input: ProfileUpdateInput): Promise<ProfileUpdateOutput> {
  const isPlaceholder =
    !process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_API_KEY.startsWith('PLACEHOLDER')

  if (isPlaceholder) {
    return {
      profileSummary: `${input.role} learning about ${input.domain}. Completed session on "${input.topicTitle}".`,
      domainGaps: input.questionsAsked.slice(0, 3),
      domainInterests: [input.topicTitle],
      crossDomainBridges: [],
    }
  }

  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

  const prompt = `You are a learning analytics engine. Update a learner's profile based on a completed session.

LEARNER:
- Role: ${input.role}
- Industry: ${input.industry}
- Active learning domains: ${input.domainsActive.join(', ')}

TODAY'S SESSION:
- Domain: ${input.domain}
- Topic: "${input.topicTitle}"
- Session sentiment: ${input.sessionSentiment}
- Questions the learner asked during the session:
${input.questionsAsked.length > 0 ? input.questionsAsked.map((q) => `  • ${q}`).join('\n') : '  (no questions asked — they were engaged and followed along)'}

CURRENT PROFILE SNAPSHOT:
${input.currentSummary ?? '(first session — no prior profile)'}

Current knowledge gaps in ${input.domain}: ${(input.currentGaps[input.domain] ?? []).join(', ') || 'none recorded yet'}
Current interests in ${input.domain}: ${(input.currentInterests[input.domain] ?? []).join(', ') || 'none recorded yet'}

TASK: Return ONLY valid JSON with these fields:
{
  "profileSummary": "2-3 sentence paragraph describing this learner's journey, focus, and patterns. Write in third person. Be specific — mention domains, topics, and real questions they asked. This gets injected into the AI coach's context.",
  "domainGaps": ["specific topic or concept they are still unclear on", "..."],
  "domainInterests": ["topics and themes they engaged with most", "..."],
  "crossDomainBridges": ["One sentence connecting ${input.domain} to another domain they're learning — only if genuinely relevant", "..."]
}

Keep domainGaps and domainInterests to max 5 items each. crossDomainBridges max 3.`

  try {
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 600,
      messages: [{ role: 'user', content: prompt }],
    })

    const raw = response.content[0].type === 'text' ? response.content[0].text : '{}'
    const cleaned = raw.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '').trim()
    return JSON.parse(cleaned) as ProfileUpdateOutput
  } catch (err) {
    console.error('[user-profile] Claude update failed:', err)
    return {
      profileSummary: input.currentSummary ?? `${input.role} learning ${input.domain}.`,
      domainGaps: input.questionsAsked.slice(0, 3),
      domainInterests: [input.topicTitle],
      crossDomainBridges: [],
    }
  }
}

// ─── BUILD PROFILE CONTEXT FOR CLIO ───────────────────────────────────────────

/**
 * Returns a compact text block injected into Clio's system prompt.
 * Tells Clio what the learner cares about, what they've struggled with,
 * and any cross-domain connections to make.
 */
export function buildProfileContextForClio(profile: UserLearningProfile, currentDomain: string): string {
  const gaps = profile.perDomainGaps[currentDomain] ?? []
  const interests = profile.perDomainInterests[currentDomain] ?? []
  const recentSessions = profile.sessionHistory.slice(-5)
  const recentQuestions = profile.questionsHistory
    .filter((q) => q.domain === currentDomain)
    .slice(-5)

  const lines: string[] = [
    `=== LEARNER PROFILE ===`,
    ``,
  ]

  if (profile.profileSummary) {
    lines.push(profile.profileSummary)
    lines.push(``)
  }

  if (gaps.length > 0) {
    lines.push(`KNOWN GAPS IN THIS DOMAIN (address these proactively before they ask):`)
    gaps.forEach((g) => lines.push(`  • ${g}`))
    lines.push(``)
  }

  if (interests.length > 0) {
    lines.push(`TOPICS THEY ENGAGE WITH MOST:`)
    interests.forEach((t) => lines.push(`  • ${t}`))
    lines.push(``)
  }

  if (recentQuestions.length > 0) {
    lines.push(`RECENT QUESTIONS THEY'VE ASKED:`)
    recentQuestions.forEach((q) => lines.push(`  • "${q.question}"`))
    lines.push(``)
  }

  if (profile.crossDomainBridges.length > 0) {
    lines.push(`CROSS-DOMAIN CONNECTIONS TO MAKE (mention naturally if relevant):`)
    profile.crossDomainBridges.forEach((b) => lines.push(`  • ${b}`))
    lines.push(``)
  }

  if (recentSessions.length > 0) {
    lines.push(`RECENT SESSIONS: ${recentSessions.map((s) => `"${s.topicTitle}"`).join(', ')}`)
  }

  return lines.join('\n')
}

// ─── PROFILE CONTEXT FOR SCRIPT + VIZ GENERATION ─────────────────────────────

/**
 * Returns a compact block injected into Step 2 (viz) and Step 3 (script) generation prompts.
 * This is the core of Objective 2: "Speak the user's language."
 */
export function buildFullProfileContextForGeneration(
  profile: UserLearningProfile,
  currentDomain: string
): string {
  const confidence = profile.profileConfidence
  const gaps = profile.perDomainGaps[currentDomain] ?? []
  const terms = profile.vocabFingerprint.domain_terms.slice(0, 10)

  const lines: string[] = ['=== LEARNER PROFILE FOR GENERATION ===']

  // Confidence guard — tells the LLM how much to trust signals
  if (confidence === 'low') {
    lines.push('PROFILE CONFIDENCE: low. Treat all profile signals as provisional. Prioritise maturity-level calibration over profile-inferred style signals.')
  } else if (confidence === 'medium') {
    lines.push('PROFILE CONFIDENCE: medium. Use profile signals with moderate weight — one or two targeted adjustments per session.')
  } else {
    lines.push('PROFILE CONFIDENCE: high. Full profile in use. Apply all signals actively.')
  }
  lines.push('')

  if (profile.profileSummary) {
    lines.push(`LEARNER SUMMARY: ${profile.profileSummary}`)
    lines.push('')
  }

  lines.push(`BUSINESS LENS: ${profile.businessFocusLens.replace(/_/g, ' ')} — every "So what?" moment should connect to this outcome.`)
  lines.push(`REASONING STYLE: ${profile.reasoningStyle} — structure explanations accordingly (systems = show interconnections; sequential = one step at a time; analogical = use domain analogies).`)
  lines.push(`ABSTRACTION COMFORT: ${profile.abstractionComfort} — ${
    profile.abstractionComfort === 'abstract' ? 'lean into frameworks and principles'
    : profile.abstractionComfort === 'concrete' ? 'anchor every concept in a specific real-world example'
    : 'balance principle with example'
  }.`)
  lines.push(`QUESTION DEPTH: ${profile.questionDepthPattern} — calibrate complexity to this level.`)

  if (terms.length > 0) {
    lines.push(`VOCABULARY TO USE: ${terms.join(', ')} — use these terms naturally when relevant; do not define them.`)
  }
  lines.push(`REGISTER: ${profile.vocabFingerprint.detected_register} — match this domain register in examples and analogies.`)
  lines.push(`EXAMPLE FORMAT: ${profile.vocabFingerprint.example_preference} — prefer ${profile.vocabFingerprint.example_preference} examples where possible.`)

  if (gaps.length > 0) {
    lines.push('')
    lines.push(`KNOWN GAPS (address proactively): ${gaps.slice(0, 3).join('; ')}.`)
  }

  const recentTopics = profile.sessionHistory.slice(-3).map(s => s.topicTitle)
  if (recentTopics.length > 0) {
    lines.push(`PRIOR SESSIONS: ${recentTopics.join(', ')} — build on this, do not repeat it.`)
  }

  return lines.join('\n')
}

// ─── COMPUTE PROFILE CONFIDENCE ───────────────────────────────────────────────

export function computeProfileConfidence(sessionsUsed: number): UserLearningProfile['profileConfidence'] {
  if (sessionsUsed >= 7) return 'high'
  if (sessionsUsed >= 3) return 'medium'
  return 'low'
}
