/**
 * Inngest background function: runs the full 6-step content pipeline for a session.
 * Triggered when a user approves their session plan.
 *
 * Step 1 — Generate content outlines (referencing previous sessions)
 * Step 2 — Generate training scripts (TEACH/CHECKPOINT/PROBE/CONTINUE)
 * Step 3 — Select the right template type per subtopic
 * Step 4 — Generate template data (Claude fills in the visual schema)
 * Step 5 — Save everything to topic_content_cache
 * Step 6 — Mark session content_status = 'ready'
 */

import { inngest } from './client'
import { createSupabaseAdminClient } from '@/lib/supabase'
import { generateSessionContentOutline } from '@/lib/content/session-content-generator'
import { generateTrainingScript } from '@/lib/content/script-generator'
import { selectTemplate } from '@/lib/templates/selector'
import { generateTemplateData } from '@/lib/templates/generator'
import { getCachedSection } from '@/lib/topic-cache'
import { sendAdminAlert } from '@/lib/delivery/email'
import { runAutomatedQA } from '@/lib/kb-qa-agent'
import type { TemplateSection, TemplateMeta } from '@/lib/templates/types'

// Re-use the same catalog lookup as generate-plan to get subtopics
function getSubtopicsForSession(topicId: string, subtopicsFromDb: string[] | null): string[] {
  if (subtopicsFromDb && subtopicsFromDb.length > 0) return subtopicsFromDb

  const FALLBACK_SUBTOPICS: Record<string, string[]> = {
    'ai-fundamentals': [
      'What generative AI is and why this moment is strategically different',
      'The foundation model landscape: GPT, Claude, Gemini — what they share',
      'What AI can realistically do today vs. what vendors claim',
      'The three decisions every executive must make in the next 12 months',
      'How to frame AI as a capability, not a one-time project',
    ],
  }
  return FALLBACK_SUBTOPICS[topicId] ?? FALLBACK_SUBTOPICS['ai-fundamentals']
}

export const sessionContentPipeline = inngest.createFunction(
  {
    id: 'session-content-pipeline',
    retries: 2,
    triggers: [{ event: 'distill/session.content.generate' }],
    onFailure: async ({
      error,
      event,
    }: {
      error: Error
      event: { data: { sessionId?: string; userId?: string } }
    }) => {
      try {
        const { sessionId, userId } = event.data
        await sendAdminAlert({
          subject: `session-content-pipeline failed — session ${sessionId ?? 'unknown'}`,
          body: `The session content pipeline Inngest job has exhausted all retries and failed.\n\nSession ID: ${sessionId ?? 'unknown'}\nError: ${error.message}`,
          context: { sessionId, userId, errorStack: error.stack },
        })
      } catch (alertErr) {
        // Never let alert failure mask the original error
        console.error('[session-content-pipeline:onFailure] Failed to send admin alert:', alertErr)
      }
    },
  },
  async ({
    event,
    step,
  }: {
    event: { data: { sessionId: string; userId: string } }
    step: {
      run: <T>(name: string, fn: () => Promise<T>) => Promise<T>
    }
  }) => {
    const { sessionId, userId } = event.data
    const supabase = createSupabaseAdminClient()

    // ── Fetch session + user profile ────────────────────────────────────────
    const { session, userProfile } = await step.run('fetch-session-data', async () => {
      const [{ data: sessionRow }, { data: userRow }] = await Promise.all([
        supabase
          .from('sessions')
          .select('id, session_title, topic_id, topics, session_plan, curriculum_session_id, sub_sessions')
          .eq('id', sessionId)
          .single(),
        supabase
          .from('users')
          .select('role, industry, ai_maturity, role_level')
          .eq('id', userId)
          .single(),
      ])
      return {
        session: sessionRow,
        userProfile: userRow as { role?: string | null; industry?: string | null; ai_maturity?: string | null; role_level?: string | null } | null,
      }
    })

    if (!session) throw new Error(`Session ${sessionId} not found`)

    // Always key content by DB session UUID — each DB session owns its own scoped content.
    const topicId = sessionId
    const topicTitle = session.session_title ?? 'AI Strategy Session'

    // Priority 1: session_plan.sub_sessions (TERM-01 complete)
    const planSubtopics = (session.session_plan as { sub_sessions?: Array<{ title: string; skipped?: boolean }> } | null)
      ?.sub_sessions?.filter((s) => !s.skipped)?.map((s) => s.title) ?? []

    // Priority 2: session.sub_sessions JSONB (curriculum sessions — [{title, type, ...}])
    const jsonbSubtopics = (session.sub_sessions as Array<{ title: string }> | null)
      ?.map((s) => s.title) ?? []

    const subtopicTitles = planSubtopics.length > 0
      ? planSubtopics
      : jsonbSubtopics.length > 0
        ? jsonbSubtopics
        : getSubtopicsForSession(topicId, session.topics)
    const userContext = {
      role: userProfile?.role ?? 'executive',
      industry: userProfile?.industry ?? 'business',
      maturity: userProfile?.ai_maturity ?? 'beginner',
      roleLevel: userProfile?.role_level ?? 'c-suite',
    }

    // Mark session as generating immediately so UI shows progress
    await step.run('mark-generating', async () => {
      await supabase
        .from('sessions')
        .update({ content_status: 'generating' })
        .eq('id', sessionId)
    })

    // ── Step 1: Generate content outlines for ALL subtopics in one Claude call ──
    const outline = await step.run('generate-content-outlines', async () => {
      return generateSessionContentOutline(
        sessionId,
        topicId,
        topicTitle,
        subtopicTitles,
        userId,
        userContext
      )
    })

    // ── Steps 2-5: For each sub-session — script + template + cache ────────────
    // subSessionOutline: content outline for one tab (stored as sessions.subtopics in DB — column rename pending TERM-01)
    for (const subSessionOutline of outline.subtopics) {
      const subtopicTitle = subSessionOutline.subtopic_title
      const subtopicSlug = subSessionOutline.subtopic_slug

      await step.run(`process-subtopic-${subtopicSlug}`, async () => {
        // Step 2: Generate training script
        const script = await generateTrainingScript(subSessionOutline, userContext)

        // Step 3: Select template
        const templateType = selectTemplate(subtopicTitle, subSessionOutline.position)

        // Step 4: Generate template data (use cache if available)
        let section: TemplateSection | null = await getCachedSection(topicId, subtopicSlug, {
          role: userContext.role,
          industry: userContext.industry,
        })

        if (!section) {
          const meta: TemplateMeta = {
            subtopicTitle,
            sessionTitle: topicTitle,
            userRole: userContext.role,
            userIndustry: userContext.industry,
          }
          const data = await generateTemplateData(
            templateType,
            subtopicTitle,
            topicTitle,
            userContext
          )
          section = { id: subtopicSlug, type: templateType, data, meta, status: 'pending' } as TemplateSection
        }

        // Step 4.5: Run automated QA rules (word count, So what?, jargon, sentence count)
        // Logs issues but does NOT block the pipeline — content still saves.
        const sectionData = section.data as unknown as Record<string, unknown>
        const textToQA: string =
          (typeof sectionData?.body === 'string' ? sectionData.body : '') ||
          (typeof sectionData?.bodyText === 'string' ? sectionData.bodyText : '') ||
          (typeof sectionData?.summary === 'string' ? sectionData.summary : '') ||
          (typeof sectionData?.description === 'string' ? sectionData.description : '') ||
          ''

        const qaResult = runAutomatedQA(textToQA)
        if (!qaResult.passed) {
          console.warn(
            '[session-content-pipeline][QA] Content quality issues detected:',
            JSON.stringify({
              subtopic: subtopicSlug,
              wordCount: qaResult.wordCount,
              sentenceCount: qaResult.sentenceCount,
              hasSoWhat: qaResult.hasSoWhat,
              errors: qaResult.errors,
              warnings: qaResult.warnings,
            })
          )
        } else if (qaResult.warnings.length > 0) {
          console.warn(
            '[session-content-pipeline][QA] Content warnings:',
            JSON.stringify({ subtopic: subtopicSlug, warnings: qaResult.warnings })
          )
        }

        // Step 5: Save script + outline + template data to topic_content_cache
        const ttlDays = 60
        const expiresAt = new Date()
        expiresAt.setDate(expiresAt.getDate() + ttlDays)

        const { error: upsertError } = await supabase
          .from('topic_content_cache')
          .upsert(
            {
              topic_id: topicId,
              subtopic_slug: subtopicSlug,
              subtopic_title: subtopicTitle,
              industry: userContext.industry ?? '',
              role: userContext.role ?? '',
              template_type: templateType,
              section_data: section,
              content_outline: subSessionOutline,
              training_script: script,
              pipeline_status: 'ready',
              // Automated QA: store pass/fail flag alongside content.
              // qa_passed=false means the content saved but has quality issues to fix.
              qa_passed: qaResult.passed,
              generated_at: new Date().toISOString(),
              expires_at: expiresAt.toISOString(),
              use_count: 1,
            },
            { onConflict: 'topic_id,subtopic_slug,industry,role' }
          )

        if (upsertError) {
          console.error('[session-content-pipeline] upsert failed for subtopic:', subtopicSlug, upsertError.message)
          throw new Error(`Cache upsert failed for ${subtopicSlug}: ${upsertError.message}`)
        }
      })
    }

    // ── Step 6: Mark session as ready ───────────────────────────────────────
    await step.run('mark-session-ready', async () => {
      // Guard: verify the DB actually has rows for this topic before marking ready.
      // This prevents silent-failure loops where all upserts fail but the session
      // gets marked ready with 0 content, triggering stale-ready recovery → repeat.
      const { count, error: countError } = await supabase
        .from('topic_content_cache')
        .select('id', { count: 'exact', head: true })
        .eq('topic_id', topicId)

      if (countError) {
        console.error('[session-content-pipeline] count check failed for topic:', topicId, countError.message)
        throw new Error(`Cache count check failed for topic ${topicId}: ${countError.message}`)
      }

      if (!count || count === 0) {
        console.error('[session-content-pipeline] topic_content_cache has 0 rows for topic:', topicId, '— not marking ready')
        throw new Error(`topic_content_cache has 0 rows for topic ${topicId} — not marking ready`)
      }

      console.log(`[session-content-pipeline] verified ${count} cache row(s) for topic ${topicId} — marking session ready`)

      await supabase
        .from('sessions')
        .update({ content_status: 'ready' })
        .eq('id', sessionId)
    })

    return { sessionId, subtopicsProcessed: outline.subtopics.length }
  }
)
