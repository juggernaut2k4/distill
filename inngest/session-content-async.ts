/**
 * Inngest function: runs the full session content pipeline asynchronously.
 * Triggered by POST /api/sessions/[id]/generate-content (which returns { jobId } immediately).
 *
 * Eliminates Vercel 504 timeouts — Inngest has no HTTP timeout ceiling.
 *
 * On completion: updates async_jobs row (status=complete | failed).
 * Progress is also tracked via sessions.content_status for the existing GET polling endpoint.
 */

import { inngest } from './client'
import { createSupabaseAdminClient } from '@/lib/supabase'
import { generateSessionContentOutline } from '@/lib/content/session-content-generator'
import { generateTrainingScript, adaptScriptToDuration } from '@/lib/content/script-generator'
import { selectTemplate } from '@/lib/templates/selector'
import { generateTemplateData } from '@/lib/templates/generator'
import { getCachedSection, setCachedSection } from '@/lib/topic-cache'
import { getUserLearningProfile, buildFullProfileContextForGeneration } from '@/lib/learning/user-profile'
import type { TemplateSection, TemplateMeta } from '@/lib/templates/types'
import type { SessionPlan } from '@/lib/session-plan'
import type { SubSessionOutline } from '@/lib/content/session-content-generator'

interface SessionContentRequestedEvent {
  data: {
    jobId: string
    sessionId: string
    userId: string
  }
}

function getSubtopics(topicId: string, sessionTopics: string[] | null): string[] {
  if (sessionTopics && sessionTopics.length > 0) return sessionTopics
  const FALLBACKS: Record<string, string[]> = {
    'ai-fundamentals': [
      'What generative AI is and why this moment is strategically different',
      'The foundation model landscape: GPT, Claude, Gemini — what they share',
      'What AI can realistically do today vs. what vendors claim',
      'The three decisions every executive must make in the next 12 months',
      'How to frame AI as a capability, not a one-time project',
    ],
  }
  return FALLBACKS[topicId] ?? FALLBACKS['ai-fundamentals']
}

export const sessionContentAsync = inngest.createFunction(
  {
    id: 'session-content-async',
    name: 'Generate Session Content (Async)',
    retries: 2,
    triggers: [{ event: 'clio/session.content.requested' }],
  },
  async ({ event, step }) => {
    const { jobId, sessionId, userId } = (event as unknown as SessionContentRequestedEvent).data
    const supabase = createSupabaseAdminClient()

    // Mark job running
    await step.run('mark-running', async () => {
      await supabase
        .from('async_jobs')
        .update({ status: 'running', progress: 0.05 })
        .eq('id', jobId)
    })

    // Load session + user data
    const { session, userRow, learningProfile } = await step.run('load-data', async () => {
      const [{ data: s }, { data: u }] = await Promise.all([
        supabase
          .from('sessions')
          .select('id, session_title, topic_id, curriculum_session_id, topics, content_status, session_plan, duration_mins, sub_sessions')
          .eq('id', sessionId)
          .eq('user_id', userId)
          .single(),
        supabase
          .from('users')
          .select('role, industry, ai_maturity, role_level')
          .eq('id', userId)
          .single(),
      ])
      const profile = await getUserLearningProfile(userId)
      return { session: s, userRow: u, learningProfile: profile }
    })

    if (!session) {
      await supabase
        .from('async_jobs')
        .update({ status: 'failed', error_message: 'Session not found', completed_at: new Date().toISOString() })
        .eq('id', jobId)
      return { error: 'session_not_found' }
    }

    if (session.content_status === 'ready') {
      await supabase
        .from('async_jobs')
        .update({ status: 'complete', progress: 1, result: { status: 'already_ready' }, completed_at: new Date().toISOString() })
        .eq('id', jobId)
      return { status: 'already_ready' }
    }

    const rawTopics = (session as unknown as { topics?: unknown }).topics
    const topicId: string =
      session.topic_id ??
      (session as unknown as { curriculum_session_id?: string | null }).curriculum_session_id ??
      (Array.isArray(rawTopics) && typeof rawTopics[0] === 'string' ? rawTopics[0] : null) ??
      'ai-fundamentals'

    // Guard: 'ai-fundamentals' is a real topic slug. If a curriculum session falls back to it,
    // content gets stored under the wrong key and recall/bot can't find it at launch time.
    // Fail the job loudly here rather than silently corrupt the cache.
    const curriculumSessionId = (session as unknown as { curriculum_session_id?: string | null }).curriculum_session_id
    if (topicId === 'ai-fundamentals' && curriculumSessionId) {
      const errMsg =
        `topicId resolved to 'ai-fundamentals' for curriculum session ` +
        `(id=${sessionId}, curriculum_session_id=${curriculumSessionId}). ` +
        `Cache key would be wrong — check topicId derivation.`
      await supabase
        .from('async_jobs')
        .update({ status: 'failed', error_message: errMsg, completed_at: new Date().toISOString() })
        .eq('id', jobId)
      throw new Error(errMsg)
    }

    const topicTitle = session.session_title ?? 'AI Strategy Session'
    const sessionDurationMins: number = (session as { duration_mins?: number }).duration_mins ?? 30
    const planSubtopics = (session.session_plan as SessionPlan | null)?.sub_sessions
      ?.filter((s: { skipped?: boolean }) => !s.skipped)
      ?.map((s: { title: string }) => s.title) ?? []
    const rawSubtopics = (session as unknown as { sub_sessions?: unknown }).sub_sessions
    const designedTitles = Array.isArray(rawSubtopics) && rawSubtopics.length > 0
      ? (rawSubtopics as Array<{ title: string }>).map((s) => s.title)
      : null
    const subtopicTitles = planSubtopics.length > 0
      ? planSubtopics
      : (designedTitles ?? getSubtopics(topicId, session.topics as string[] | null))

    const userContext = {
      role: userRow?.role ?? 'executive',
      industry: userRow?.industry ?? 'business',
      maturity: userRow?.ai_maturity ?? 'beginner',
      roleLevel: (userRow?.role_level as string | null) ?? 'c-suite',
    }

    // Build enriched profile context for script + viz generation
    const profileContext = learningProfile
      ? buildFullProfileContextForGeneration(learningProfile, topicId)
      : null

    // Mark generating in sessions table (existing GET poll uses this)
    await step.run('mark-generating', async () => {
      await supabase
        .from('sessions')
        .update({ content_status: 'generating' })
        .eq('id', sessionId)
      await supabase
        .from('async_jobs')
        .update({ progress: 0.1 })
        .eq('id', jobId)
    })

    // Step 1: Generate content outlines
    const outline = await step.run('step-1-outline', async () => {
      return generateSessionContentOutline(
        sessionId,
        topicId,
        topicTitle,
        subtopicTitles,
        userId,
        userContext
      )
    })

    await supabase.from('async_jobs').update({ progress: 0.3 }).eq('id', jobId)

    // Steps 2+3: Process each subtopic (batches of 3)
    const BATCH_SIZE = 3
    const totalSubtopics = outline.subtopics.length

    for (let i = 0; i < outline.subtopics.length; i += BATCH_SIZE) {
      const batch = outline.subtopics.slice(i, i + BATCH_SIZE)
      await step.run(`process-batch-${i}`, async () => {
        await Promise.all(batch.map((subSessionOutline: SubSessionOutline) =>
          processSubtopic(subSessionOutline, {
            sessionId,
            topicId,
            topicTitle,
            subtopicTitles,
            sessionDurationMins,
            userContext,
            profileContext,
            supabase,
          })
        ))
      })
      const progressAfterBatch = 0.3 + 0.65 * Math.min((i + BATCH_SIZE) / totalSubtopics, 1)
      await supabase.from('async_jobs').update({ progress: progressAfterBatch }).eq('id', jobId)
    }

    // Mark complete
    await step.run('mark-complete', async () => {
      await supabase
        .from('sessions')
        .update({ content_status: 'ready' })
        .eq('id', sessionId)
      await supabase
        .from('async_jobs')
        .update({
          status: 'complete',
          progress: 1,
          result: { status: 'ready', subtopicsGenerated: outline.subtopics.length },
          completed_at: new Date().toISOString(),
        })
        .eq('id', jobId)
    })

    return { status: 'ready', subtopicsGenerated: outline.subtopics.length }
  }
)

// ─── HELPERS ─────────────────────────────────────────────────────────────────

interface ProcessSubtopicCtx {
  sessionId: string
  topicId: string
  topicTitle: string
  subtopicTitles: string[]
  sessionDurationMins: number
  userContext: { role: string; industry: string; maturity: string; roleLevel: string }
  profileContext: string | null
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any
}

async function processSubtopic(
  subSessionOutline: SubSessionOutline,
  ctx: ProcessSubtopicCtx
): Promise<void> {
  const { sessionId, topicId, topicTitle, subtopicTitles, sessionDurationMins, userContext, profileContext, supabase } = ctx
  const subtopicTitle = subSessionOutline.subtopic_title
  const subtopicSlug = subSessionOutline.subtopic_slug

  await supabase
    .from('topic_content_cache')
    .upsert(
      { topic_id: topicId, subtopic_slug: subtopicSlug, subtopic_title: subtopicTitle, pipeline_status: 'generating' },
      { onConflict: 'topic_id,subtopic_slug' }
    )

  const templateType = selectTemplate(subtopicTitle, subSessionOutline.position)
  const contentSpec = subSessionOutline.visual_spec
    ? {
        headline: subSessionOutline.visual_spec.headline,
        items: subSessionOutline.visual_spec.items,
        so_what: subSessionOutline.visual_spec.so_what,
        summary: subSessionOutline.content_summary,
      }
    : undefined

  const cachedSection = await getCachedSection(topicId, subtopicSlug, {
    role: userContext.role,
    industry: userContext.industry,
  })

  const meta: TemplateMeta = {
    subtopicTitle,
    sessionTitle: topicTitle,
    userRole: userContext.role,
    userIndustry: userContext.industry,
  }

  const sessionCtx = { allSubtopics: subtopicTitles, nextSessionTopic: undefined as string | undefined }

  // Pass profileContext into script generation (Step 3) — viz (Step 2) gets it via userContext extension
  const userContextWithProfile = profileContext
    ? { ...userContext, profileContext }
    : userContext

  const [section, script] = await Promise.all([
    cachedSection
      ? Promise.resolve(cachedSection)
      : generateTemplateData(templateType, subtopicTitle, topicTitle, userContext, undefined, contentSpec)
          .then((data) => {
            const newSection = { id: subtopicSlug, type: templateType, data, meta, status: 'pending' } as TemplateSection
            setCachedSection(topicId, subtopicSlug, subtopicTitle, newSection).catch(() => {})
            return newSection
          }),
    generateTrainingScript(subSessionOutline, userContextWithProfile, sessionCtx),
  ])

  const adaptedScript = await adaptScriptToDuration(script, sessionDurationMins, subtopicTitles.length)

  const expiresAt = new Date()
  expiresAt.setDate(expiresAt.getDate() + 60)

  await supabase
    .from('topic_content_cache')
    .upsert(
      {
        topic_id: topicId,
        subtopic_slug: subtopicSlug,
        subtopic_title: subtopicTitle,
        template_type: templateType,
        section_data: section,
        content_outline: subSessionOutline,
        training_script: script,
        pipeline_status: 'ready',
        generated_at: new Date().toISOString(),
        expires_at: expiresAt.toISOString(),
        use_count: 1,
      },
      { onConflict: 'topic_id,subtopic_slug' }
    )

  const { data: currentSession } = await supabase
    .from('sessions')
    .select('session_plan')
    .eq('id', sessionId)
    .single()
  if (currentSession?.session_plan) {
    const plan = currentSession.session_plan as SessionPlan
    const updatedSubtopics = plan.sub_sessions?.map((sub: { title: string; adapted_script?: unknown }) =>
      sub.title === subtopicTitle ? { ...sub, adapted_script: adaptedScript } : sub
    )
    await supabase
      .from('sessions')
      .update({ session_plan: { ...plan, sub_sessions: updatedSubtopics } })
      .eq('id', sessionId)
  }
}
