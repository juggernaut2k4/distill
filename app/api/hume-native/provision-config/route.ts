import { NextRequest, NextResponse } from 'next/server'
import { clerkClient } from '@clerk/nextjs/server'
import { createSupabaseAdminClient } from '@/lib/supabase'
import { getUserLearningProfile, buildProfileContextForClio } from '@/lib/learning/user-profile'
import { buildTopicContext, buildSessionScript, buildSessionSummary } from '@/lib/clio-context-builder'
import {
  assembleHumeNativePrompt,
  buildIntentContextForHumeNative,
} from '@/lib/voice/hume-native/prompt-template'
import { provisionNativeConfig } from '@/lib/voice/hume-native/config-provisioner'
import type { TemplateSection } from '@/lib/templates/types'
import { generateLiveConductorContent, formatTabContentForPrompt } from '@/lib/content/live-conductor-content'
import type { LiveConductorTab } from '@/lib/content/live-conductor-content'
import type { UserContext } from '@/lib/content/session-content-generator'
// CONTENT-02: single shared source of truth for "is this session's content
// actually ready" — see lib/content/content-readiness.ts for the hard rule
// that every content_status: 'ready' write must call this immediately before writing.
import { verifyContentReadiness } from '@/lib/content/content-readiness'

export const dynamic = 'force-dynamic'

// CONTENT-POP-01 Part B: the self-heal path calls generateLiveConductorContent
// synchronously (whole-topic background + N per-subtopic ContentArticle
// generations). 120s matches the existing precedent in app/api/recall/bot/route.ts
// so the route is not killed by the platform before the 60s internal timeout
// below can fire and be handled gracefully.
export const maxDuration = 120

/**
 * HUME-NATIVE-01 — POST /api/hume-native/provision-config
 *
 * New, isolated route. Only ever called from WalkthroughClient.tsx when
 * NEXT_PUBLIC_HUME_NATIVE_ENABLED is true for the current session (see 4.4).
 * Assembles the upfront Hume-native prompt from existing, untrimmed data
 * (buildProfileContextForClio, the intent sub-block, and the exact
 * whole-topic + per-tab content already produced under LIVE-01's pipeline —
 * read from walkthrough_state, no new content-generation call) and
 * provisions a fresh Hume Config in native/supplemental-LLM mode.
 *
 * Auth: matches the existing userId-keyed pattern used by
 * /api/walkthrough-state/[userId] and /api/generate-visual — this route is
 * invoked from inside the Recall.ai bot's headless browser session, which
 * only knows userId, not a Clerk session. Per BA spec section 6, no Zod
 * schema is needed beyond this implicit session context.
 *
 * On failure, this returns a non-2xx response — the caller (WalkthroughClient)
 * must NOT fall back to Custom-LLM mode silently. HUME_API_KEY is never
 * logged or returned in the response.
 */
export async function POST(request: NextRequest) {
  // SESSCTX-01: server-only toggle for summary-driven session context. Strict
  // equality — anything other than the exact string 'true' (unset, 'false',
  // typos) resolves to OFF, the current, unchanged full-script behavior. This
  // is a deliberate fail-safe default so a misconfigured/missing env var can
  // never accidentally activate the newer, less-tested mode. Read once here;
  // the pre-check (~148) and recheck (~311) completeness-gate call sites
  // below intentionally do NOT read this flag — they always call the
  // unmodified buildSessionScript() regardless of its value (see the real
  // assembly call site below for rationale).
  const summaryModeEnabled = process.env.HUME_NATIVE_SUMMARY_MODE === 'true'

  let userId: string | undefined
  try {
    const body = await request.json() as { userId?: string }
    userId = body.userId
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  if (!userId) {
    return NextResponse.json({ error: 'userId is required' }, { status: 400 })
  }

  const supabase = createSupabaseAdminClient()

  // Resolve the session row for this user. Per BA spec 4.5, hume_chat_id /
  // hume_native_config_id / hume_native_enabled are written on `sessions`,
  // not `walkthrough_state` — so we need the current active session row.
  const { data: sessionRow, error: sessionErr } = await supabase
    .from('sessions')
    .select('id, live_conductor_content')
    .eq('user_id', userId)
    .eq('status', 'active')
    .order('scheduled_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (sessionErr || !sessionRow?.id) {
    console.error('[hume-native/provision-config] No active session found for user:', userId, sessionErr?.message)
    return NextResponse.json({ error: 'No active session found for this user' }, { status: 404 })
  }
  const sessionId = sessionRow.id as string

  // Real per-subtopic content, sourced the same way the old CLM path
  // (lib/voice/live-conductor-bridge.ts) builds its knowledge base: each
  // ContentArticle produced by generateLiveConductorContent already contains
  // overview/key_facts/how_it_works/enterprise_implications/misconceptions/etc,
  // and formatTabContentForPrompt() is the existing formatter the CLM path uses
  // to turn one tab's article into prompt text. Keyed by subtopic_slug so it can
  // be matched 1:1 against `sections` regardless of ordering.
  let liveConductorTabsBySlug = new Map<string, LiveConductorTab>(
    (
      (sessionRow as { live_conductor_content?: { tabs?: LiveConductorTab[] } | null }).live_conductor_content
        ?.tabs ?? []
    ).map((tab) => [tab.subtopic_slug, tab])
  )

  // Existing whole-topic + per-tab content, read from walkthrough_state exactly
  // as LIVE-01 produced it — no new content-generation call (per BA spec 4.2).
  const { data: stateRow, error: stateErr } = await supabase
    .from('walkthrough_state')
    .select('topic_title, sections, training_scripts')
    .eq('user_id', userId)
    .maybeSingle()

  if (stateErr || !stateRow) {
    console.error('[hume-native/provision-config] No walkthrough_state found for user:', userId, stateErr?.message)
    return NextResponse.json({ error: 'No session content available for this user yet' }, { status: 404 })
  }

  let sections = (stateRow.sections ?? []) as TemplateSection[]
  let trainingScripts = (stateRow.training_scripts ?? []) as Parameters<typeof buildSessionScript>[1]
  let topicTitleForContent = stateRow.topic_title as string | null

  // ── CONTENT-POP-01 Part B: self-healing pre-flight completeness check ──────
  // Defensive backstop: if sections/training_scripts/topic_title reach this
  // point empty (a regression, a race condition, a partial write, a new bug —
  // any future cause, not just the one fixed in Part A), don't silently
  // provision Clio with nothing to teach from. Detect it here, attempt one
  // synchronous on-demand regeneration, and only hard-fail if that also comes
  // back empty. See CONTENT-POP-01 requirement doc, Section 6, Part B.
  const isSuspiciouslyEmpty = (
    sects: TemplateSection[],
    scripts: Parameters<typeof buildSessionScript>[1],
    title: string | null,
    content: string
  ): boolean => {
    if (!sects || sects.length === 0) return true

    const hasUsableText = sects.some((section) => {
      const data = (section as unknown as { data?: Record<string, unknown> }).data ?? {}
      const candidate =
        (typeof data.what_it_is === 'string' && data.what_it_is) ||
        (typeof data.overview === 'string' && data.overview) ||
        (typeof data.direct_answer === 'string' && data.direct_answer) ||
        (typeof data.one_line === 'string' && data.one_line) ||
        JSON.stringify(data)
      return typeof candidate === 'string' && candidate.trim().length >= 40
    })
    if (!hasUsableText) return true

    if (!title || title.trim().length === 0) return true

    if (content.trim().length < 200) return true

    return false
  }

  const sessionContentPreCheck = [
    topicTitleForContent ? `# ${topicTitleForContent}` : '',
    buildTopicContext(sections, sections.map(() => null)),
    buildSessionScript(sections, trainingScripts),
  ].filter(Boolean).join('\n\n---\n\n')

  if (isSuspiciouslyEmpty(sections, trainingScripts, topicTitleForContent, sessionContentPreCheck)) {
    console.warn(
      '[hume-native/provision-config] CONTENT-POP-01: empty content detected for session',
      sessionId,
      '— triggering on-demand generation',
      { sectionsCount: sections.length, topicTitle: topicTitleForContent, sessionContentLength: sessionContentPreCheck.length }
    )

    try {
      // Re-derive generation inputs for this sessionId. Priority order and
      // fallback values must match inngest/session-content-pipeline.ts exactly
      // (inferRoleLevel and getSubtopicsForSession are module-private there,
      // so their logic is reimplemented inline here — same behavior, no import).
      const [{ data: sessionForHeal, error: sessionForHealErr }, { data: userForHeal, error: userForHealErr }] = await Promise.all([
        supabase
          .from('sessions')
          .select('session_title, session_plan, sub_sessions, topics')
          .eq('id', sessionId)
          .single(),
        supabase
          .from('users')
          .select('role, industry, ai_maturity, role_level')
          .eq('id', userId)
          .single(),
      ])

      if (sessionForHealErr || !sessionForHeal || userForHealErr) {
        throw new Error(
          `CONTENT-POP-01 re-derivation query failed: ${sessionForHealErr?.message ?? userForHealErr?.message ?? 'session or user row missing'}`
        )
      }

      const topicId = sessionId
      const topicTitle = sessionForHeal.session_title ?? 'AI Strategy Session'

      const planSubtopics = (sessionForHeal.session_plan as { sub_sessions?: Array<{ title: string; skipped?: boolean }> } | null)
        ?.sub_sessions?.filter((s) => !s.skipped)?.map((s) => s.title) ?? []
      const jsonbSubtopics = (sessionForHeal.sub_sessions as Array<{ title: string }> | null)
        ?.map((s) => s.title) ?? []

      const inferRoleLevel = (role?: string | null): string => {
        if (!role) return 'c-suite'
        const lower = role.toLowerCase()
        if (/developer|engineer|architect|specialist|analyst|scientist/.test(lower)) return 'specialist'
        if (/manager|lead|head/.test(lower)) return 'manager'
        if (/vp|svp|evp|director/.test(lower)) return 'vp-dir'
        return 'c-suite'
      }

      const getSubtopicsForSession = (id: string, subtopicsFromDb: string[] | null): string[] => {
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
        return FALLBACK_SUBTOPICS[id] ?? FALLBACK_SUBTOPICS['ai-fundamentals']
      }

      const subtopicTitles = planSubtopics.length > 0
        ? planSubtopics
        : jsonbSubtopics.length > 0
          ? jsonbSubtopics
          : getSubtopicsForSession(topicId, sessionForHeal.topics as string[] | null)

      const userContext: UserContext = {
        role: userForHeal?.role ?? 'executive',
        industry: userForHeal?.industry ?? 'business',
        maturity: userForHeal?.ai_maturity ?? 'beginner',
        roleLevel: userForHeal?.role_level ?? inferRoleLevel(userForHeal?.role),
      }

      console.log('[hume-native/provision-config] CONTENT-POP-01: starting synchronous on-demand generation for session', sessionId)
      const startedAt = Date.now()

      const TIMEOUT_MS = 60_000
      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error('CONTENT-POP-01 self-heal timed out after 60s')), TIMEOUT_MS)
      })

      let healed: Awaited<ReturnType<typeof generateLiveConductorContent>>
      try {
        healed = await Promise.race([
          generateLiveConductorContent(sessionId, topicId, topicTitle, subtopicTitles, userId, userContext),
          timeoutPromise,
        ])
      } catch (genErr) {
        const isTimeout = genErr instanceof Error && genErr.message.includes('timed out')
        if (isTimeout) {
          console.error('[hume-native/provision-config] CONTENT-POP-01: on-demand generation TIMED OUT after 60s for session', sessionId)
        } else {
          console.error('[hume-native/provision-config] CONTENT-POP-01: on-demand generation FAILED for session', sessionId, genErr instanceof Error ? genErr.message : genErr)
        }
        return NextResponse.json({ error: 'Session content unavailable — on-demand generation failed' }, { status: 502 })
      }

      // Re-run Part A's mapping logic inline so provisioning proceeds with the
      // freshly-generated data in this same request — no second round-trip to
      // walkthrough_state is required. Moved BEFORE the sessions write (CONTENT-02):
      // rebuild sections/trainingScripts first, verify readiness against `healed`,
      // and only then write content_status: 'ready' — never write-then-check.
      const tabs = healed.tabs as LiveConductorTab[]
      sections = tabs.map((tab) => {
        const a = tab.article
        const misconceptions = a?.sections?.common_misconceptions ?? []
        return {
          id: tab.subtopic_slug,
          type: 'DefinitionTriptych',
          data: {
            term: a?.subtopic_title ?? tab.subtopic_title ?? '',
            category: 'AI Concept',
            what_it_is: a?.sections?.overview ?? '',
            real_example: {
              company: '',
              what: a?.sections?.illustrative_example ?? '',
              result: '',
            },
            common_myth: misconceptions[0] ?? '',
            so_what: a?.sections?.enterprise_implications ?? '',
          },
          meta: {
            subtopicTitle: a?.subtopic_title ?? tab.subtopic_title ?? '',
            sessionTitle: topicTitle,
            userRole: userContext.role,
            userIndustry: userContext.industry,
          },
          status: 'ready',
        } as TemplateSection
      })
      trainingScripts = tabs.map((tab) => {
        const a = tab.article
        return {
          subtopic_title: a?.subtopic_title ?? tab.subtopic_title ?? '',
          subtopic_slug: a?.subtopic_slug ?? tab.subtopic_slug,
          segments: [
            {
              type: 'TEACH' as const,
              content: [
                a?.sections?.overview ?? '',
                a?.sections?.how_it_works ?? '',
                a?.sections?.enterprise_implications ?? '',
              ].filter(Boolean).join(' '),
            },
          ],
        }
      }) as Parameters<typeof buildSessionScript>[1]
      topicTitleForContent = topicTitle

      // Freshly-healed tabs supersede whatever was read from sessionRow above —
      // rebuild the lookup so the real per-subtopic docs below reflect the
      // content we just generated and persisted, not stale/empty data.
      liveConductorTabsBySlug = new Map(tabs.map((tab) => [tab.subtopic_slug, tab]))

      const recheckContent = [
        topicTitleForContent ? `# ${topicTitleForContent}` : '',
        buildTopicContext(sections, sections.map(() => null)),
        buildSessionScript(sections, trainingScripts),
      ].filter(Boolean).join('\n\n---\n\n')

      if (isSuspiciouslyEmpty(sections, trainingScripts, topicTitleForContent, recheckContent)) {
        console.error('[hume-native/provision-config] CONTENT-POP-01: on-demand generation completed but content is STILL empty for session', sessionId, '— blocking call')
        return NextResponse.json({ error: 'Session content unavailable — on-demand generation failed' }, { status: 502 })
      }

      // CONTENT-02 call site 3 — see lib/content/content-readiness.ts. This is
      // the confirmed root cause fix: verification now runs BEFORE the
      // sessions write, not after. If not ready, content_status is NEVER
      // touched — no write happens at all, so there is nothing to roll back.
      const readiness = await verifyContentReadiness(supabase, sessionId, healed)
      if (!readiness.ready) {
        console.error(
          '[hume-native/provision-config] CONTENT-POP-01: readiness check failed for session',
          sessionId,
          '—',
          readiness.reason
        )
        return NextResponse.json({ error: 'Session content unavailable — on-demand generation failed' }, { status: 502 })
      }

      // Only reached if readiness.ready — persist together, mirroring
      // session-content-pipeline.ts's exact write shape.
      const { error: sessionWriteErr } = await supabase
        .from('sessions')
        .update({
          live_conductor_content: healed,
          content_status: 'ready',
        })
        .eq('id', sessionId)
      if (sessionWriteErr) {
        console.error('[hume-native/provision-config] CONTENT-POP-01: failed to persist self-healed live_conductor_content:', sessionWriteErr.message)
      }

      console.log(
        '[hume-native/provision-config] CONTENT-POP-01: on-demand generation succeeded for session',
        sessionId,
        '— proceeding with fresh content',
        { tabsGenerated: tabs.length, durationMs: Date.now() - startedAt }
      )
    } catch (healErr) {
      console.error('[hume-native/provision-config] CONTENT-POP-01: on-demand generation FAILED for session', sessionId, healErr instanceof Error ? healErr.message : healErr)
      return NextResponse.json({ error: 'Session content unavailable — on-demand generation failed' }, { status: 502 })
    }
  }

  // Real per-subtopic topic-context docs — matched 1:1 against `sections` by
  // subtopic_slug (== section.id, see the DefinitionTriptych mapping above and
  // in app/api/recall/bot/route.ts). Mirrors the old CLM path
  // (lib/voice/live-conductor-bridge.ts buildLiveConductorSystemPrompt), which
  // formats each tab's ContentArticle via formatTabContentForPrompt() rather
  // than issuing a fresh per-section LLM call — no new content-generation call
  // is introduced here, and any tab genuinely missing from
  // live_conductor_content (e.g. a future regression) still falls back to
  // buildTopicContext's existing per-section default via `null`.
  const topicContextDocs: (string | null)[] = sections.map((section) => {
    const tab = liveConductorTabsBySlug.get(section.id)
    return tab ? formatTabContentForPrompt(tab) : null
  })

  // SESSCTX-01: the only toggle-aware call site. Everything else in this
  // step (heading, buildTopicContext call, join logic, downstream
  // assembleHumeNativePrompt call) is identical regardless of the flag — only
  // the session-script vs. session-summary text format changes. The
  // pre-check/recheck completeness gates above intentionally stay
  // unconditional on buildSessionScript(): they exist purely to detect
  // genuinely-empty content, and buildSessionScript()'s output is a strict
  // superset in verbosity of buildSessionSummary()'s, making it the more
  // conservative (harder to false-positive) of the two detectors — using it
  // unconditionally means this toggle can never weaken that existing
  // defensive gate.
  const sessionContent = [
    topicTitleForContent ? `# ${topicTitleForContent}` : '',
    buildTopicContext(sections, topicContextDocs),
    summaryModeEnabled
      ? buildSessionSummary(sections, trainingScripts)
      : buildSessionScript(sections, trainingScripts),
  ].filter(Boolean).join('\n\n---\n\n')

  // HUME-SPEAK-01 / Q2 (2026-07-06): the primary user's first name, sourced
  // via Clerk by userId — the identical mechanism app/dashboard/walkthrough/
  // page.tsx already uses to source `userFirstName` for the ElevenLabs path
  // (clerkClient.users.getUser(userId).firstName). This route only ever
  // receives a userId (see file-level doc comment above — no Clerk session
  // available), so the lookup is done here instead of being passed in.
  // Defensive: a lookup failure or missing name must never block session
  // connect — fall through with an empty name rather than throwing.
  let userFirstName = ''
  try {
    const clerkUser = await clerkClient.users.getUser(userId)
    userFirstName = clerkUser.firstName ?? clerkUser.username ?? ''
  } catch (err) {
    console.warn('[hume-native/provision-config] Failed to fetch first name from Clerk — proceeding without it:', err instanceof Error ? err.message : err)
  }

  // Full user profile (untrimmed) via the existing serializer.
  const profile = await getUserLearningProfile(userId)
  const currentDomain = topicTitleForContent ?? 'general'
  const profileContext = profile ? buildProfileContextForClio(profile, currentDomain, userFirstName || undefined) : ''

  // Full detected-intent sub-block (omitted cleanly if no session_insights row exists yet).
  const intentContext = await buildIntentContextForHumeNative(userId)

  const assembledPrompt = assembleHumeNativePrompt({
    profileContext,
    intentContext,
    sessionContent,
  })

  // Provision the Hume Config. Hard failure on error — no silent fallback to
  // Custom-LLM mode (per BA spec 4.3).
  let configId: string
  try {
    const result = await provisionNativeConfig({ sessionId, assembledPrompt })
    configId = result.configId
  } catch (err) {
    console.error('[hume-native/provision-config] provisionNativeConfig failed:', err instanceof Error ? err.message : err)
    return NextResponse.json({ error: 'Failed to provision Hume native Config' }, { status: 502 })
  }

  // Persist configId + hume_native_enabled on the session row. This is the
  // per-session record of whether native mode ran, independent of the global
  // toggle's live value at query time (per BA spec 4.5, acceptance test 11).
  const { error: updateErr } = await supabase
    .from('sessions')
    .update({
      hume_native_config_id: configId,
      hume_native_enabled: true,
    })
    .eq('id', sessionId)

  if (updateErr) {
    console.error('[hume-native/provision-config] Failed to persist configId on session row:', updateErr.message)
    // Non-fatal to the caller — the configId is still valid and usable this
    // call; a missed persist just means a future re-provision won't be
    // avoided. Do not fail the request over this.
  }

  return NextResponse.json({ configId })
}
