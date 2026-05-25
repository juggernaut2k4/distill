/**
 * User learning profile — cross-domain, updated after every session.
 * Drives proactive Clio personalisation and cross-domain connections.
 */

import Anthropic from '@anthropic-ai/sdk'
import { createSupabaseAdminClient } from '@/lib/supabase'

// ─── TYPES ────────────────────────────────────────────────────────────────────

export interface UserLearningProfile {
  userId: string
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
  }
}

// ─── UPDATE AFTER SESSION ─────────────────────────────────────────────────────

export interface SessionCompletedPayload {
  userId: string
  sessionId: string
  domain: string
  topicTitle: string
  questionsAsked: string[]     // from unresolved_questions for this session
  sessionSentiment: string     // 'positive' | 'neutral' | 'confused'
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

  // Upsert the profile
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
      },
      { onConflict: 'user_id' }
    )
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
