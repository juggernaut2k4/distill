/**
 * GET /api/admin/qa-role-checks?userId=<id>
 *
 * QA-ROLE-01 — Stage 2A of the mandatory QA validation playbook.
 *
 * Runs three automated role-differentiation checks against a user's active
 * curriculum plan and sessions:
 *
 *   5A — Role Differentiation: ≥60% of arc names contain role-tier keywords
 *   5B — Content Orientation:  ≥50% of subtopic titles contain role-tier keywords
 *   5C — Topic Coverage:       at least 1 arc covers foundational AI tooling
 *                              (technical) or user's topic_interests (exec/manager)
 *
 * Returns ok:true only when all three checks pass.
 * Read-only — no writes, no external API calls.
 */

import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { createSupabaseAdminClient } from '@/lib/supabase'
import { getRoleTier, type RoleTier } from '@/lib/curriculum/role-utils'

export const maxDuration = 30

// ─── Keyword lists (fixed per spec QA-ROLE-01 §5.1) ──────────────────────────

const KEYWORDS: Record<RoleTier, string[]> = {
  executive: [
    'govern', 'governance', 'strategy', 'strategic', 'roi', 'cost', 'vendor',
    'risk', 'board', 'compliance', 'budget', 'oversight', 'policy', 'evaluate',
    'investment', 'stakeholder', 'executive',
  ],
  technical: [
    'implement', 'build', 'code', 'api', 'deploy', 'debug', 'architect',
    'framework', 'integrate', 'prompt engineering', 'llm', 'model', 'pipeline',
    'engineer', 'developer', 'sdk', 'token', 'fine-tun',
  ],
  manager: [
    'team', 'workflow', 'process', 'adoption', 'productivity', 'collaboration',
    'onboard', 'training', 'manage', 'operational', 'rollout', 'change management',
  ],
}

// Keywords that must appear in at least one arc name for technical users (5C)
const TECH_COVERAGE_KEYWORDS = ['claude', 'gpt', 'llm', 'llms', 'prompt engineering']

// ─── Types ────────────────────────────────────────────────────────────────────

interface ArcObject {
  arc_name: string
  arc_type?: string
  arc_description?: string
  comprehensive_subtopics?: string[]
  is_visible?: boolean
}

interface CheckResult {
  ok: boolean
  score: number
  threshold: number
  detail: string
  signals_found: string[]
  signals_missing: string[]
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function containsAnyKeyword(text: string, keywords: string[]): { matched: boolean; found: string[] } {
  const lower = text.toLowerCase()
  const found = keywords.filter((kw) => lower.includes(kw.toLowerCase()))
  return { matched: found.length > 0, found }
}

function runCheck5A(arcs: ArcObject[], keywords: string[], tier: RoleTier): CheckResult {
  if (arcs.length === 0) {
    return {
      ok: false,
      score: 0,
      threshold: 0.6,
      detail: 'Check 5A: no arcs found in visible_sessions — cannot evaluate role differentiation',
      signals_found: [],
      signals_missing: [],
    }
  }

  const allFound = new Set<string>()
  let matchedCount = 0

  for (const arc of arcs) {
    const { matched, found } = containsAnyKeyword(arc.arc_name ?? '', keywords)
    if (matched) {
      matchedCount++
      found.forEach((kw) => allFound.add(kw))
    }
  }

  const score = matchedCount / arcs.length
  const ok = score >= 0.6
  const pct = Math.round(score * 100)

  return {
    ok,
    score: Math.round(score * 100) / 100,
    threshold: 0.6,
    detail: ok
      ? `${matchedCount} of ${arcs.length} arcs (${pct}%) contain ${tier}-tier keywords — above 60% threshold`
      : `Check 5A: only ${matchedCount} of ${arcs.length} arcs (${pct}%) contain ${tier}-tier keywords — below 60% threshold`,
    signals_found: Array.from(allFound),
    signals_missing: [],
  }
}

function runCheck5B(subtopicTitles: string[], keywords: string[], tier: RoleTier): CheckResult {
  if (subtopicTitles.length === 0) {
    return {
      ok: false,
      score: 0,
      threshold: 0.5,
      detail: 'Check 5B: no subtopic titles found across any session — sub_sessions may be null for all sessions',
      signals_found: [],
      signals_missing: [],
    }
  }

  const allFound = new Set<string>()
  let matchedCount = 0

  for (const title of subtopicTitles) {
    const { matched, found } = containsAnyKeyword(title, keywords)
    if (matched) {
      matchedCount++
      found.forEach((kw) => allFound.add(kw))
    }
  }

  const score = matchedCount / subtopicTitles.length
  const ok = score >= 0.5
  const pct = Math.round(score * 100)

  return {
    ok,
    score: Math.round(score * 100) / 100,
    threshold: 0.5,
    detail: ok
      ? `${matchedCount} of ${subtopicTitles.length} subtopic titles (${pct}%) contain ${tier}-tier keywords — above 50% threshold`
      : `Check 5B: only ${matchedCount} of ${subtopicTitles.length} subtopic titles (${pct}%) contain ${tier}-tier keywords — below 50% threshold`,
    signals_found: Array.from(allFound),
    signals_missing: [],
  }
}

function runCheck5C(
  arcs: ArcObject[],
  tier: RoleTier,
  topicInterests: string[] | null,
): CheckResult {
  if (arcs.length === 0) {
    return {
      ok: false,
      score: 0,
      threshold: 1,
      detail: 'Check 5C: no arcs to evaluate',
      signals_found: [],
      signals_missing: [],
    }
  }

  const arcNames = arcs.map((a) => a.arc_name ?? '')

  if (tier === 'technical') {
    const found: string[] = []
    for (const arcName of arcNames) {
      const { found: hits } = containsAnyKeyword(arcName, TECH_COVERAGE_KEYWORDS)
      hits.forEach((kw) => found.push(kw))
    }
    const uniqueFound = Array.from(new Set(found))
    const ok = uniqueFound.length > 0
    const missing = ok ? [] : TECH_COVERAGE_KEYWORDS

    return {
      ok,
      score: ok ? 1 : 0,
      threshold: 1,
      detail: ok
        ? `At least one arc covers foundational AI tooling (matched: ${uniqueFound.join(', ')})`
        : 'Check 5C: no arc covers foundational AI tooling — plan missing Claude/GPT/LLM/prompt engineering topics',
      signals_found: uniqueFound,
      signals_missing: missing,
    }
  }

  // Executive / manager: match topic_interests against arc names
  if (!topicInterests || topicInterests.length === 0) {
    return {
      ok: false,
      score: 0,
      threshold: 1,
      detail: 'Check 5C: topic_interests not set for this user — cannot verify topic coverage',
      signals_found: [],
      signals_missing: [],
    }
  }

  const found: string[] = []
  for (const interest of topicInterests) {
    if (!interest || interest.trim().length === 0) continue
    for (const arcName of arcNames) {
      if (arcName.toLowerCase().includes(interest.toLowerCase().trim())) {
        found.push(interest)
        break
      }
    }
  }

  const uniqueFound = Array.from(new Set(found))
  const ok = uniqueFound.length > 0

  return {
    ok,
    score: ok ? 1 : 0,
    threshold: 1,
    detail: ok
      ? `At least one arc name matches user topic_interests (matched: ${uniqueFound.join(', ')})`
      : `Check 5C: no arc name matches any of the user's topic_interests (${topicInterests.join(', ')})`,
    signals_found: uniqueFound,
    signals_missing: ok ? [] : topicInterests,
  }
}

// ─── Handler ──────────────────────────────────────────────────────────────────

export async function GET(request: NextRequest) {
  const { userId: authUserId } = auth()
  if (!authUserId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const supabase = createSupabaseAdminClient()
  const targetUserId = request.nextUrl.searchParams.get('userId') ?? authUserId

  // ── Load user profile ──────────────────────────────────────────────────────
  const { data: userRow } = await supabase
    .from('users')
    .select('role_level, topic_interests')
    .eq('id', targetUserId)
    .single()

  const roleLevel = (userRow?.role_level as string | null) ?? ''
  const topicInterests = (userRow?.topic_interests as string[] | null) ?? null
  const tier = getRoleTier(roleLevel)
  const keywords = KEYWORDS[tier]

  // ── Load active curriculum plan ────────────────────────────────────────────
  const { data: plan } = await supabase
    .from('curriculum_plans')
    .select('id, visible_sessions')
    .eq('user_id', targetUserId)
    .is('superseded_at', null)
    .order('generated_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (!plan) {
    return NextResponse.json(
      { ok: false, error: 'No active curriculum plan found for this user.' },
      { status: 404 },
    )
  }

  const arcs: ArcObject[] = Array.isArray(plan.visible_sessions)
    ? (plan.visible_sessions as ArcObject[])
    : []

  // ── Load sessions and extract subtopic titles ──────────────────────────────
  const { data: sessions } = await supabase
    .from('sessions')
    .select('id, sub_sessions')
    .eq('user_id', targetUserId)
    .neq('status', 'cancelled')

  const subtopicTitles: string[] = []
  for (const session of sessions ?? []) {
    if (Array.isArray(session.sub_sessions)) {
      for (const item of session.sub_sessions as unknown[]) {
        if (typeof item === 'string') {
          subtopicTitles.push(item)
        } else if (item && typeof item === 'object' && 'title' in item) {
          subtopicTitles.push(String((item as Record<string, unknown>).title ?? ''))
        }
      }
    }
  }

  // ── Run all three checks ───────────────────────────────────────────────────
  const check5A = runCheck5A(arcs, keywords, tier)
  const check5B = runCheck5B(subtopicTitles, keywords, tier)
  const check5C = runCheck5C(arcs, tier, topicInterests)

  const allOk = check5A.ok && check5B.ok && check5C.ok

  const issues: string[] = []
  if (!check5A.ok) issues.push(check5A.detail)
  if (!check5B.ok) issues.push(check5B.detail)
  if (!check5C.ok) issues.push(check5C.detail)

  return NextResponse.json({
    ok: allOk,
    user_id: targetUserId,
    plan_id: plan.id as string,
    role_level: roleLevel || '(not set)',
    role_tier: tier,
    keyword_list_used: keywords,
    total_arcs: arcs.length,
    total_subtopic_titles: subtopicTitles.length,
    checks: {
      '5a': check5A,
      '5b': check5B,
      '5c': check5C,
    },
    issues: allOk ? ['None — all checks passed'] : issues,
  })
}
