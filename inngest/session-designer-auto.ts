import { inngest } from './client'
import { createSupabaseAdminClient } from '@/lib/supabase'
import {
  designSessionsForTopic,
  getSessionDuration,
  type CurriculumTopicInput,
  type DesignedSession,
} from '@/lib/curriculum/session-designer'

interface PlanGeneratedEvent {
  data: { planId: string; userId: string; cached: boolean }
}
type Step = {
  run: <T>(name: string, fn: () => Promise<T>) => Promise<T>
  sendEvent: (id: string, event: { name: string; data: object }) => Promise<void>
}

// v1 session shape — from lib/curriculum/planner.ts SessionSchema
interface V1Session {
  session_id:        string
  title:             string
  focus:             string
  depth_level:       string
  estimated_minutes: number
  arc_position:      number
  arc_length:        number
  arc_name?:         string
  arc_type?:         string
  is_visible?:       boolean
  queue_rationale?:  string | null
  subtopics?:        string[]
  db_session_id?:    string
  [key: string]: unknown
}

// v2 arc shape — from inngest/curriculum-generator.ts ArcSchema
interface V2Arc {
  arc_name:                string
  arc_type:                string
  arc_description:         string
  comprehensive_subtopics: string[]
  is_visible?:             boolean
  queue_rationale?:        string | null
  db_session_id?:          string
  [key: string]: unknown
}

type VisibleItem = V1Session | V2Arc

interface DesignItem {
  arcIndex:    number   // index in original visible_sessions array
  chunkIndex:  number   // 1-based position of this chunk within its arc
  totalChunks: number   // total chunks produced for this arc
  isV2:        boolean
  topicInput:  CurriculumTopicInput
  designed:    DesignedSession[]
}

// Subtopics-per-session matrix: maturity × learning_goal → chunk size
// Controls how many comprehensive_subtopics go into a single session.
// Beginners get more sessions with narrower scope; experts can absorb larger chunks.
const SUBTOPICS_PER_SESSION: Record<string, Record<string, number>> = {
  beginner:     { quick_wins: 2, steady_progress: 3, deep_dive: 4 },
  intermediate: { quick_wins: 3, steady_progress: 4, deep_dive: 6 },
  advanced:     { quick_wins: 4, steady_progress: 5, deep_dive: 8 },
  expert:       { quick_wins: 5, steady_progress: 6, deep_dive: 10 },
}

function slugify(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
}

function isV2Arc(item: VisibleItem): item is V2Arc {
  const arc = item as V2Arc
  return Array.isArray(arc.comprehensive_subtopics) && arc.comprehensive_subtopics.length > 0
}

// Splits comprehensive_subtopics into chunks driven by user maturity + learning_goal.
// Merges the final chunk into the previous one if it would have fewer than 2 items.
function splitSubtopics(subtopics: string[], maturity: string, learningGoal: string): string[][] {
  const maturityKey = SUBTOPICS_PER_SESSION[maturity] ? maturity : 'intermediate'
  const goalKey = ['quick_wins', 'steady_progress', 'deep_dive'].includes(learningGoal)
    ? learningGoal : 'steady_progress'
  const chunkSize = Math.min(SUBTOPICS_PER_SESSION[maturityKey][goalKey], 10)

  if (subtopics.length <= chunkSize) return [subtopics]

  const chunks: string[][] = []
  for (let i = 0; i < subtopics.length; i += chunkSize) {
    chunks.push(subtopics.slice(i, i + chunkSize))
  }

  // Merge the tail into the previous chunk rather than creating a 1-item session
  if (chunks.length > 1 && chunks[chunks.length - 1].length < 2) {
    const tail = chunks.pop()!
    chunks[chunks.length - 1].push(...tail)
  }

  return chunks
}

/**
 * Inngest background job: designs all sessions for a newly generated curriculum plan.
 * Detects v2 arc objects (comprehensive_subtopics[]) and splits them into sessions
 * based on the user's maturity + learning_goal. Falls back to v1 session objects unchanged.
 * Inserts sessions as status='draft' — invisible until user approves.
 * Triggered by: curriculum-generator → fires "clio/plan.generated"
 */
export const sessionDesignerAuto = inngest.createFunction(
  {
    id: 'session-designer-auto',
    retries: 3,
    triggers: [{ event: 'clio/plan.generated' }],
  },
  async ({ event, step }: { event: PlanGeneratedEvent; step: Step }) => {
    const { planId, userId } = event.data
    const supabase = createSupabaseAdminClient()

    // ── Load plan + user ──────────────────────────────────────────────────────
    const { plan, user } = await step.run('load-plan-and-user', async () => {
      const [p, u] = await Promise.all([
        supabase.from('curriculum_plans').select('id, visible_sessions').eq('id', planId).single(),
        supabase.from('users').select('role, industry, ai_maturity, learning_goal').eq('id', userId).single(),
      ])
      return { plan: p.data, user: u.data }
    })

    if (!plan || !user) {
      console.error('[session-designer-auto] Plan or user not found', { planId, userId })
      return { error: 'not_found' }
    }

    // ── Idempotency guard: skip if draft sessions already exist ───────────────
    const alreadyDesigned = await step.run('check-existing-sessions', async () => {
      const { count } = await supabase
        .from('sessions')
        .select('id', { count: 'exact', head: true })
        .eq('curriculum_plan_id', planId)
        .eq('status', 'draft')
      return (count ?? 0) > 0
    })

    if (alreadyDesigned) {
      console.log('[session-designer-auto] Sessions already exist for plan:', planId)
      return { skipped: true, reason: 'sessions_already_exist' }
    }

    const visibleItems = (
      Array.isArray(plan.visible_sessions) ? plan.visible_sessions : []
    ) as VisibleItem[]

    const learningGoal = (user as { learning_goal?: string }).learning_goal ?? 'steady_progress'
    const maturity     = (user as { ai_maturity?: string }).ai_maturity ?? 'intermediate'
    const maxMins      = getSessionDuration(learningGoal)
    const profile = {
      role:     (user as { role?: string }).role     ?? 'executive',
      industry: (user as { industry?: string }).industry ?? 'general',
      maturity,
    }

    // ── Detect v2 vs v1, split v2 arcs, design one session per chunk ─────────
    const designResults = await step.run('design-all-sessions', async () => {
      const items: DesignItem[] = []

      for (let arcIndex = 0; arcIndex < visibleItems.length; arcIndex++) {
        const item = visibleItems[arcIndex]

        if (isV2Arc(item)) {
          if (item.comprehensive_subtopics.length === 0) {
            console.warn(`[session-designer-auto] WARNING: v2 arc "${item.arc_name}" has empty comprehensive_subtopics — skipping`)
            continue
          }

          const chunks  = splitSubtopics(item.comprehensive_subtopics, maturity, learningGoal)
          const arcSlug = slugify(item.arc_name)

          for (let chunkIdx = 0; chunkIdx < chunks.length; chunkIdx++) {
            const topicInput: CurriculumTopicInput = {
              session_id:        `${arcSlug}-part-${chunkIdx + 1}`,
              title:             item.arc_name,
              focus:             item.arc_description,
              depth_level:       'intermediate',
              estimated_minutes: maxMins,
              subtopics:         chunks[chunkIdx],
            }
            const designed = await designSessionsForTopic(topicInput, profile, maxMins)
            items.push({
              arcIndex,
              chunkIndex:  chunkIdx + 1,
              totalChunks: chunks.length,
              isV2:        true,
              topicInput,
              designed,
            })
          }
        } else {
          // v1 session: pass all existing fields through unchanged
          const v1 = item as V1Session
          const topicInput: CurriculumTopicInput = {
            session_id:        v1.session_id,
            title:             v1.title,
            focus:             v1.focus,
            depth_level:       v1.depth_level ?? 'intermediate',
            estimated_minutes: v1.estimated_minutes ?? maxMins,
            subtopics:         v1.subtopics,
          }
          const designed = await designSessionsForTopic(topicInput, profile, maxMins)
          items.push({
            arcIndex,
            chunkIndex:  1,
            totalChunks: 1,
            isV2:        false,
            topicInput,
            designed,
          })
        }
      }

      return items
    })

    // ── Insert sessions as draft, collect first db_session_id per arc ─────────
    const updatedVisible = await step.run('insert-draft-sessions', async () => {
      let globalOrder = 0
      const firstSessionIdByArc = new Map<number, string>()

      for (const di of designResults) {
        for (const ds of di.designed) {
          globalOrder++
          const { data: inserted, error } = await supabase
            .from('sessions')
            .insert({
              user_id:               userId,
              session_title:         ds.session_title,
              topic_id:              di.topicInput.session_id,
              topics:                [di.topicInput.session_id],
              curriculum_plan_id:    planId,
              curriculum_session_id: di.topicInput.session_id,
              sub_sessions:          ds.subtopics,
              duration_mins:         ds.duration_mins,
              session_index:         globalOrder,
              status:                'draft',
            })
            .select('id')
            .single()

          if (error) {
            console.error(
              `[session-designer-auto] ERROR: failed to insert session for "${di.topicInput.title}" chunk ${di.chunkIndex}:`,
              error.message,
            )
            continue
          }

          if (inserted && !firstSessionIdByArc.has(di.arcIndex)) {
            firstSessionIdByArc.set(di.arcIndex, inserted.id)
          }
        }
      }

      // Rebuild visible_sessions: one entry per original arc, enriched with display fields
      // so the plan page can render SessionCard without crashing.
      return visibleItems.map((item, idx) => {
        const dbSessionId = firstSessionIdByArc.get(idx)
        if (isV2Arc(item)) {
          return {
            ...item,
            // v1-compatible display fields used by PlanClient / SessionCard
            session_id:        slugify(item.arc_name),
            title:             item.arc_name,
            focus:             item.arc_description,
            depth_level:       'intermediate',
            estimated_minutes: maxMins,
            arc_position:      idx + 1,
            arc_length:        visibleItems.length,
            db_session_id:     dbSessionId,
          }
        }
        return { ...(item as V1Session), db_session_id: dbSessionId }
      })
    })

    // ── Write enriched visible_sessions back to plan ───────────────────────────
    await step.run('update-plan-with-session-ids', async () => {
      await supabase
        .from('curriculum_plans')
        .update({ visible_sessions: updatedVisible })
        .eq('id', planId)
    })

    // ── Kick off Session 1 content generation immediately ────────────────────
    const session1Id = (updatedVisible[0] as { db_session_id?: string } | undefined)?.db_session_id
    if (session1Id) {
      await step.sendEvent('kickoff-session-1-content', {
        name: 'distill/session.content.generate',
        data: { sessionId: session1Id, userId },
      })
      console.log(`[session-designer-auto] Kicked off Session 1 content: ${session1Id}`)
    }

    const totalSessions = designResults.length
    console.log(`[session-designer-auto] ${visibleItems.length} arcs → ${totalSessions} sessions drafted for plan ${planId}`)
    return { success: true, planId, arcsProcessed: visibleItems.length, sessionsCreated: totalSessions }
  }
)
