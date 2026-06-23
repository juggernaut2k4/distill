/**
 * Inngest function: adaptPlan
 * Triggered by 'distill/session.plan.adapt' after analyzeIceBreakerResponse completes.
 *
 * Reads the extracted signals from session_insights, scores all pending sessions against
 * those signals using a deterministic keyword-matching algorithm, reorders pending sessions
 * by assigning new session_index values, writes an audit record to plan_adaptations, and
 * marks the user for a notification banner on /dashboard/sessions.
 *
 * SCR-01 — Adaptive Plan Reordering
 *
 * Step 1 — load-signals-and-sessions
 * Step 2 — score-sessions
 * Step 3 — check-reorder-needed
 * Step 4 — reassign-session-indexes
 * Step 5 — write-adaptation-record
 * Step 6 — mark-notification
 *
 * Non-fatal on retry exhaustion: logs error with [adapt-plan][ERROR] prefix.
 * Adaptation failure does not affect the user's session experience.
 */

import { inngest } from './client'
import { createSupabaseAdminClient } from '@/lib/supabase'

// ─── TYPES ────────────────────────────────────────────────────────────────────

interface ExtractedSignals {
  learning_intent: string
  knowledge_level: string
  organizational_context: string
  urgency: 'low' | 'medium' | 'high'
  primary_driver: 'compliance' | 'competitive' | 'cost' | 'curiosity' | 'other'
}

interface PendingSession {
  id: string
  session_title: string | null
  session_index: number
  curriculum_session_id: string | null
  status: string
}

interface ScoredSession {
  sessionId: string
  currentIndex: number
  newScore: number
}

interface VisibleSessionEntry {
  session_id: string
  arc_name?: string
  arc_type?: string
  role_hint?: string
}

// ─── SCORING CONSTANTS ────────────────────────────────────────────────────────

const DRIVER_KEYWORDS: Record<string, { keywords: string[]; points: number }> = {
  compliance:  { keywords: ['compliance', 'regulatory', 'governance', 'regulation', 'legal', 'audit', 'risk', 'policy', 'gdpr', 'hipaa'], points: 50 },
  competitive: { keywords: ['competitive', 'vendor', 'evaluation', 'procurement', 'comparison', 'benchmark', 'market', 'differentiat'], points: 50 },
  cost:        { keywords: ['cost', 'roi', 'budget', 'efficiency', 'spend', 'savings', 'investment'], points: 30 },
  curiosity:   { keywords: ['strategy', 'overview', 'fundamentals', 'landscape', 'introduction'], points: 30 },
  other:       { keywords: [], points: 0 },
}

// ─── SCORING ALGORITHM ────────────────────────────────────────────────────────

function scoreSession(
  session: PendingSession,
  pendingRank: number,
  totalPending: number,
  primaryDriver: ExtractedSignals['primary_driver'],
  urgency: ExtractedSignals['urgency'],
  learningMotivation: string | null,
  visibleSessionEntry: VisibleSessionEntry | null,
): number {
  const searchText = [
    session.session_title ?? '',
    visibleSessionEntry?.arc_name ?? '',
    visibleSessionEntry?.role_hint ?? '',
  ].join(' ').toLowerCase()

  // Component 1 — Driver keyword match (0, 30, or 50 pts)
  const driverConfig = DRIVER_KEYWORDS[primaryDriver] ?? DRIVER_KEYWORDS.other
  const keywordHit = driverConfig.keywords.some((kw) => searchText.includes(kw.toLowerCase()))
  const comp1Raw = keywordHit ? driverConfig.points : 0

  // Component 2 — Urgency multiplier applied to Component 1
  const urgencyMultiplier = urgency === 'high' ? 1.0 : urgency === 'medium' ? 0.7 : 0.4
  const comp1Adjusted = Math.round(comp1Raw * urgencyMultiplier)

  // Component 3 — Position bonus (0–30 pts)
  // Sessions already near the front get a bonus to prevent unnecessary churn.
  const comp3 = Math.round(30 * (1 - pendingRank / totalPending))

  // Component 4 — Learning motivation alignment (0 or 10 pts)
  let comp4 = 0
  if (
    (learningMotivation === 'compliance_driven' && primaryDriver === 'compliance') ||
    (learningMotivation === 'opportunity_driven' && (primaryDriver === 'competitive' || primaryDriver === 'curiosity')) ||
    (learningMotivation === 'fear_driven' && (primaryDriver === 'compliance' || primaryDriver === 'cost'))
  ) {
    comp4 = 10
  }

  // Minimum threshold: if comp1 + comp4 < 5, signals have no opinion — rank by current position only.
  if (comp1Raw + comp4 < 5) {
    // Return position-only score to preserve current relative ordering for tie-breaking
    return comp3
  }

  return Math.min(100, comp1Adjusted + comp3 + comp4)
}

// ─── MAIN FUNCTION ────────────────────────────────────────────────────────────

export const adaptPlan = inngest.createFunction(
  {
    id: 'adapt-plan',
    retries: 2,
    triggers: [{ event: 'distill/session.plan.adapt' }],
    onFailure: async ({ error, event }: { error: Error; event: { data: { userId?: string; insightId?: string } } }) => {
      console.error(
        `[adapt-plan][ERROR] userId: ${event.data.userId} insightId: ${event.data.insightId}`,
        error.message,
      )
    },
  },
  async ({
    event,
    step,
  }: {
    event: {
      data: {
        userId: string
        sessionId: string
        insightId: string
        primaryDriver: string
        urgency: string
      }
    }
    step: {
      run: <T>(name: string, fn: () => Promise<T>) => Promise<T>
    }
  }) => {
    const { userId, sessionId, insightId, primaryDriver, urgency } = event.data
    const supabase = createSupabaseAdminClient()

    // ── Step 1: Load signals and sessions ─────────────────────────────────────
    const loadResult = await step.run('load-signals-and-sessions', async () => {
      // Read session_insights row
      const { data: insight } = await supabase
        .from('session_insights')
        .select('extracted_signals, session_id')
        .eq('id', insightId)
        .maybeSingle()

      if (!insight) {
        console.log(`[adapt-plan] insightId not found — skipping (insightId: ${insightId})`)
        return null
      }

      // Check for active curriculum plan
      const { data: plan } = await supabase
        .from('curriculum_plans')
        .select('visible_sessions')
        .eq('user_id', userId)
        .is('superseded_at', null)
        .order('generated_at', { ascending: false })
        .limit(1)
        .maybeSingle()

      if (!plan) {
        console.log(`[adapt-plan] no active plan found for userId — skipping (userId: ${userId})`)
        return null
      }

      // Read all pending sessions for this user
      const { data: pendingSessions } = await supabase
        .from('sessions')
        .select('id, session_title, session_index, curriculum_session_id, status')
        .eq('user_id', userId)
        .eq('status', 'pending')
        .order('session_index', { ascending: true })

      if (!pendingSessions || pendingSessions.length < 2) {
        console.log(`[adapt-plan] fewer than 2 pending sessions — skipping (userId: ${userId})`)
        return null
      }

      // Read user learning profile
      const { data: profile } = await supabase
        .from('user_learning_profiles')
        .select('profile_confidence, learning_motivation')
        .eq('user_id', userId)
        .maybeSingle()

      if (profile?.profile_confidence === 'low') {
        console.log(`[adapt-plan] profile_confidence is low — skipping (userId: ${userId})`)
        return null
      }

      // Edge case 1 guard: check if we already adapted for this session in the last 60 minutes
      const sixtyMinsAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString()
      const { data: recentAdaptation } = await supabase
        .from('plan_adaptations')
        .select('id')
        .eq('trigger_session_id', sessionId)
        .gte('created_at', sixtyMinsAgo)
        .limit(1)
        .maybeSingle()

      if (recentAdaptation) {
        console.log(`[adapt-plan] already adapted for this session recently — skipping (sessionId: ${sessionId})`)
        return null
      }

      const visibleSessions = (plan.visible_sessions ?? []) as VisibleSessionEntry[]
      const learningMotivation = profile?.learning_motivation ?? null

      return {
        pendingSessions: pendingSessions as PendingSession[],
        visibleSessions,
        learningMotivation,
      }
    })

    // Early exits from Step 1
    if (!loadResult) return { status: 'skipped' }

    const { pendingSessions, visibleSessions, learningMotivation } = loadResult

    // Build lookup: curriculum_session_id → VisibleSessionEntry
    const visibleMap = new Map<string, VisibleSessionEntry>()
    for (const vs of visibleSessions) {
      visibleMap.set(vs.session_id, vs)
    }

    // ── Step 2: Score sessions ─────────────────────────────────────────────────
    const scoredSessions = await step.run('score-sessions', async (): Promise<ScoredSession[]> => {
      const totalPending = pendingSessions.length

      return pendingSessions.map((session, idx) => {
        const pendingRank = idx + 1 // 1-indexed
        const visibleEntry = session.curriculum_session_id
          ? (visibleMap.get(session.curriculum_session_id) ?? null)
          : null

        const newScore = scoreSession(
          session,
          pendingRank,
          totalPending,
          primaryDriver as ExtractedSignals['primary_driver'],
          urgency as ExtractedSignals['urgency'],
          learningMotivation,
          visibleEntry,
        )

        return {
          sessionId: session.id,
          currentIndex: session.session_index,
          newScore,
        }
      })
    })

    // ── Step 3: Check if reorder is needed ────────────────────────────────────
    const reorderDecision = await step.run('check-reorder-needed', async () => {
      // Sort by score DESC, tie-break by lower currentIndex (already-earlier sessions win)
      const sorted = [...scoredSessions].sort((a, b) => {
        if (b.newScore !== a.newScore) return b.newScore - a.newScore
        return a.currentIndex - b.currentIndex
      })

      // Check if all sessions scored 0
      if (sorted.every((s) => s.newScore === 0)) {
        console.log(`[adapt-plan] all sessions scored 0 — plan unchanged (userId: ${userId})`)
        return { shouldReorder: false, sorted }
      }

      // Compare top 3 against current index order
      const top3Sorted = sorted.slice(0, 3).map((s) => s.sessionId)
      const top3Current = [...scoredSessions]
        .sort((a, b) => a.currentIndex - b.currentIndex)
        .slice(0, 3)
        .map((s) => s.sessionId)

      const alreadyOptimal = top3Sorted.every((id, i) => id === top3Current[i])
      if (alreadyOptimal) {
        console.log(`[adapt-plan] no reorder needed — plan already optimal (userId: ${userId})`)
        return { shouldReorder: false, sorted }
      }

      return { shouldReorder: true, sorted }
    })

    if (!reorderDecision.shouldReorder) return { status: 'no_reorder_needed' }

    const { sorted: sortedSessions } = reorderDecision

    // ── Step 4: Reassign session indexes ──────────────────────────────────────
    const reorderResult = await step.run('reassign-session-indexes', async () => {
      // Determine the base index: last completed session's index + 1
      // We use the lowest currentIndex in our pending set as the starting point
      // (completed sessions occupy everything below that)
      const minPendingIndex = Math.min(...pendingSessions.map((s) => s.session_index))

      const previousOrder = pendingSessions.map((s) => ({
        sessionId: s.id,
        oldIndex: s.session_index,
      }))

      // Assign new indexes in score-descending order (highest score = lowest index number)
      const newOrder: Array<{ sessionId: string; newIndex: number }> = []
      let changedCount = 0

      for (let i = 0; i < sortedSessions.length; i++) {
        const newIndex = minPendingIndex + i
        newOrder.push({ sessionId: sortedSessions[i].sessionId, newIndex })

        if (sortedSessions[i].currentIndex !== newIndex) {
          changedCount++
        }
      }

      // Bulk UPDATE: all pending sessions get new session_index values
      for (const { sessionId: sid, newIndex } of newOrder) {
        const { error } = await supabase
          .from('sessions')
          .update({ session_index: newIndex })
          .eq('id', sid)

        if (error) {
          throw new Error(`[adapt-plan] Failed to update session_index for ${sid}: ${error.message}`)
        }
      }

      return { previousOrder, newOrder, changedCount }
    })

    const { previousOrder, newOrder, changedCount } = reorderResult

    // ── Step 5: Write adaptation record ───────────────────────────────────────
    await step.run('write-adaptation-record', async () => {
      const { error } = await supabase
        .from('plan_adaptations')
        .insert({
          user_id: userId,
          trigger_session_id: sessionId,
          insight_id: insightId,
          primary_driver: primaryDriver,
          urgency: urgency,
          signal_summary: `User expressed ${urgency} urgency with primary concern: ${primaryDriver}`,
          sessions_reordered: changedCount,
          previous_order: previousOrder,
          new_order: newOrder,
        })

      if (error) {
        throw new Error(`[adapt-plan] Failed to insert plan_adaptations: ${error.message}`)
      }
    })

    // ── Step 6: Mark notification ──────────────────────────────────────────────
    await step.run('mark-notification', async () => {
      const { error } = await supabase
        .from('users')
        .update({ plan_adapted_at: new Date().toISOString() })
        .eq('id', userId)

      if (error) {
        throw new Error(`[adapt-plan] Failed to update plan_adapted_at: ${error.message}`)
      }
    })

    return { status: 'completed', sessionsReordered: changedCount }
  },
)
