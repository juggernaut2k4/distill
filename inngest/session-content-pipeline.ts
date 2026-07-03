/**
 * Inngest background function: runs the full atomic content pipeline for a session.
 * Triggered when a user approves their session plan.
 *
 * Step A — Fetch session + user profile
 * Step B — Mark session as 'generating'
 * Step C — generateContentArticles: one LLM call → ContentArticle[] (source of truth)
 * Step D — Per subtopic: generateScriptAndVisualization (atomic: script + viz in one call)
 * Step E — Per subtopic: selectTemplate
 * Step F — Per subtopic: generateTemplateData (receives visualization_spec from Step D)
 * Step G — Per subtopic: upsert to topic_content_cache
 * Step H — Guard: verify rows exist, mark session content_status = 'ready'
 */

import { inngest } from './client'
import { createSupabaseAdminClient } from '@/lib/supabase'
import { generateContentArticles } from '@/lib/content/session-content-generator'
import { generateScriptAndVisualization, adaptScriptToDuration } from '@/lib/content/script-generator'
import { generateSessionContentOutline } from '@/lib/content/session-content-generator'
import { generateTrainingScript } from '@/lib/content/script-generator'
import { selectTemplate } from '@/lib/templates/selector'
import { generateTemplateData } from '@/lib/templates/generator'
import { sendAdminAlert } from '@/lib/delivery/email'
import { runAutomatedQA } from '@/lib/kb-qa-agent'
import type { TemplateSection, TemplateMeta, TabManifest, VisualizationTab } from '@/lib/templates/types'

// ─── ROLE LEVEL INFERENCE ─────────────────────────────────────────────────────

function inferRoleLevel(role?: string | null): string {
  if (!role) return 'c-suite'
  const lower = role.toLowerCase()
  if (/developer|engineer|architect|specialist|analyst|scientist/.test(lower)) return 'specialist'
  if (/manager|lead|head/.test(lower)) return 'manager'
  if (/vp|svp|evp|director/.test(lower)) return 'vp-dir'
  return 'c-suite'
}

// ─── TAB MANIFEST BUILDER ─────────────────────────────────────────────────────

/**
 * Builds a TabManifest for a single subtopic from its rendered TemplateSection.
 *
 * Each TemplateSection is a single visual card — it represents one "tab" in the
 * WalkthroughClient's tab panel. `mapped_segments` is left empty: runtime tab
 * navigation is driven by [NAV:tab_N] directives embedded in the TEACH script,
 * not by segment mapping (which was aspirational).
 *
 * @param subtopicSlug  - Identifies the subtopic this manifest belongs to
 * @param section       - The rendered TemplateSection produced by generateTemplateData
 * @param sectionIndex  - 0-based position of this subtopic in the session
 */
export function buildTabManifest(
  subtopicSlug: string,
  section: TemplateSection,
  sectionIndex: number
): TabManifest {
  const tab: VisualizationTab = {
    tab_id: section.id,
    tab_index: sectionIndex + 1,   // 1-based
    tab_name: section.type,
    section,
    mapped_segments: [],           // NAV directives handle runtime navigation
  }
  return {
    subtopic_slug: subtopicSlug,
    tabs: [tab],
  }
}

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
    triggers: [
      { event: 'distill/session.content.generate' },
      // SESS-02: also fire when session designer finalises a session's subtopics.
      // Both events carry the same { sessionId, userId } payload shape.
      { event: 'distill/session.designer.completed' },
    ],
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

    // ── Step A: Fetch session + user profile ───────────────────────────────────
    const { session, userProfile } = await step.run('fetch-session-data', async () => {
      const [{ data: sessionRow }, { data: userRow }] = await Promise.all([
        supabase
          .from('sessions')
          .select('id, session_title, topic_id, topics, session_plan, curriculum_session_id, sub_sessions, duration_mins')
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
    const sessionDurationMins: number | null = (session as unknown as { duration_mins?: number | null }).duration_mins ?? null

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
      roleLevel: userProfile?.role_level ?? inferRoleLevel(userProfile?.role),
    }

    // ── Step B: Mark session as generating ────────────────────────────────────
    await step.run('mark-generating', async () => {
      await supabase
        .from('sessions')
        .update({ content_status: 'generating' })
        .eq('id', sessionId)
    })

    // ── Step C: Generate ContentArticles — one LLM call, all subtopics ────────
    // This is the single source of truth: script + visualization both derive from here.
    const articles = await step.run('generate-content-articles', async () => {
      return generateContentArticles(
        sessionId,
        topicId,
        topicTitle,
        subtopicTitles,
        userId,
        userContext
      )
    })

    // ── Steps D–G: Per subtopic — atomic script+viz, template, cache upsert ───
    for (let i = 0; i < articles.length; i++) {
      const article = articles[i]
      const subtopicSlug = article.subtopic_slug
      const subtopicTitle = article.subtopic_title
      const isLast = i === articles.length - 1

      // AUTOGEN-01 Part B / Part C parity: write a placeholder row with
      // pipeline_status: 'generating' before starting the heavy LLM work for this
      // subtopic, so the per-subtopic progress UI (Part C) can distinguish
      // "pending" (no row yet) from "generating" (row exists, not ready yet) rather
      // than only ever seeing a row once it's fully 'ready'. Mirrors the granularity
      // the legacy session-content-async.ts pipeline used to provide.
      await step.run(`mark-subtopic-generating-${subtopicSlug}`, async () => {
        await supabase
          .from('topic_content_cache')
          .upsert(
            {
              topic_id: topicId,
              subtopic_slug: subtopicSlug,
              subtopic_title: subtopicTitle,
              industry: userContext.industry ?? '',
              role: userContext.role ?? '',
              pipeline_status: 'generating',
            },
            { onConflict: 'topic_id,subtopic_slug,industry,role' }
          )
      })

      await step.run(`process-subtopic-${subtopicSlug}`, async () => {
        // Step D: Single atomic LLM call → script segments + visualization spec.
        // durationMins drives proactive word-budget in the prompt so generation
        // targets the right density upfront — not a post-hoc truncation.
        const rawScriptAndViz = await generateScriptAndVisualization(
          article,
          userContext,
          isLast,
          i,
          articles.length,
          sessionDurationMins ?? 30
        )

        // Step D.5: Adapt script to session duration if duration_mins is set.
        // adaptScriptToDuration handles BOTH compression (short session) and expansion
        // (long session). With the 2-minute canonical TEACH, expansion is the common case
        // for 30-min sessions with 3 subtopics (~10 min/subtopic vs 2-min canonical).
        const scriptAndViz = sessionDurationMins
          ? {
              ...rawScriptAndViz,
              segments: (await adaptScriptToDuration(
                {
                  subtopic_title: article.subtopic_title,
                  subtopic_slug: article.subtopic_slug,
                  segments: rawScriptAndViz.segments,
                  total_duration_seconds: rawScriptAndViz.total_duration_seconds,
                },
                sessionDurationMins,
                articles.length
              )).segments,
            }
          : rawScriptAndViz

        // Step E: Select template type.
        // KB-VIZ-01: position 'first' (TopicHero) is now reserved for the synthetic
        // SessionOverview card injected by the KB UI. Real subtopics are always 'middle'
        // or 'last', which enables comparison-topic detection in selector.ts.
        const templateType = selectTemplate(subtopicTitle, isLast ? 'last' : 'middle')

        // Step F: Generate template data — always regenerated in sync with Step D script.
        // getCachedSection is NOT called here: the cache is the DESTINATION (Step G), not the
        // source. Using a prior cached section would desync the visual items from what TEACH names.
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
          userContext,
          undefined,
          {
            headline: scriptAndViz.visualization_spec.headline,
            items: [...scriptAndViz.visualization_spec.items],
            so_what: scriptAndViz.visualization_spec.so_what,
            summary: '',
          }
        )
        const section: TemplateSection = { id: subtopicSlug, type: templateType, data, meta, status: 'pending' } as TemplateSection

        // Step F.5: Run automated QA (non-blocking)
        // QA checks the content ARTICLE body — the cached, long-form source-of-truth text
        // for this subtopic. Articles have NO word-count ceiling (they are cached, not
        // regenerated per request). The TEACH script is NOT checked here — its quality is
        // controlled by the generation prompt, and its word budget varies by session duration.
        // We concatenate the three primary prose sections: overview, how_it_works, and
        // enterprise_implications. These are the substantive fields that must contain a
        // "So what?" orientation and have minimum substance (≥ 3 sentences combined).
        const textToQA: string = [
          article.sections.overview,
          article.sections.how_it_works,
          article.sections.enterprise_implications,
        ]
          .filter(Boolean)
          .join(' ')

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

        // Step G: Upsert to topic_content_cache
        // onConflict key must match the unique index: (topic_id, subtopic_slug, industry, role)
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
              // content_outline stores the source ContentArticle for reference and KB display
              content_outline: { content_article: article },
              // training_script now comes from the atomic generateScriptAndVisualization call
              training_script: {
                subtopic_title: subtopicTitle,
                subtopic_slug: subtopicSlug,
                segments: scriptAndViz.segments,
                total_duration_seconds: scriptAndViz.total_duration_seconds,
                // Store viz spec inline so callers can always reconstruct what's on screen
                visualization_spec: scriptAndViz.visualization_spec,
              },
              pipeline_status: 'ready',
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

    // ── Step H: Guard + mark session ready ────────────────────────────────────
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

    // ── Step I: Build tab manifests + write to walkthrough_state ─────────────
    // Read back the section_data rows we just upserted (ordered by subtopic position)
    // and build a Record<string, TabManifest> keyed by string subtopic index ("0", "1", …).
    // This step runs after the loop so it never races with per-subtopic upserts.
    await step.run('write-tab-manifests', async () => {
      const { data: cacheRows, error: fetchErr } = await supabase
        .from('topic_content_cache')
        .select('subtopic_slug, section_data')
        .eq('topic_id', topicId)

      if (fetchErr || !cacheRows || cacheRows.length === 0) {
        console.warn('[session-content-pipeline] write-tab-manifests: no cache rows found for topic:', topicId, fetchErr?.message)
        return
      }

      // Order by the article array so indexes match the subtopic sequence.
      const slugOrder = articles.map((a) => a.subtopic_slug)
      const tabManifests: Record<string, TabManifest> = {}

      for (const row of cacheRows) {
        const idx = slugOrder.indexOf(row.subtopic_slug)
        if (idx === -1) continue
        const section = row.section_data as TemplateSection | null
        if (!section) continue
        tabManifests[String(idx)] = buildTabManifest(row.subtopic_slug, section, idx)
      }

      if (Object.keys(tabManifests).length === 0) {
        console.warn('[session-content-pipeline] write-tab-manifests: no manifests built for topic:', topicId)
        return
      }

      // Write into walkthrough_state for this user. The row is keyed by user_id and
      // created when the Recall.ai bot is launched; we update only tab_manifests here
      // so we don't disturb any live session state.
      const { error: wsErr } = await supabase
        .from('walkthrough_state')
        .update({ tab_manifests: tabManifests })
        .eq('user_id', userId)

      if (wsErr) {
        // Non-fatal: log and continue. The pipeline result (content_status=ready) is
        // already committed in Step H. Missing tab_manifests degrades tab navigation
        // but does not break the session.
        console.warn('[session-content-pipeline] write-tab-manifests: walkthrough_state update failed:', wsErr.message)
      } else {
        console.log(`[session-content-pipeline] wrote ${Object.keys(tabManifests).length} tab manifest(s) to walkthrough_state for user:`, userId)
      }
    })

    return { sessionId, subtopicsProcessed: articles.length }
  }
)

// ─── BACKWARD COMPATIBILITY EXPORTS ──────────────────────────────────────────
// These re-export the old functions so any other files importing from this module
// continue to compile. The old pipeline functions still exist in their own files.
export { generateSessionContentOutline, generateTrainingScript }
