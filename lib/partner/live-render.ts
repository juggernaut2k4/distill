import { createSupabaseAdminClient } from '@/lib/supabase'
import { pullPartnerContent, pullPartnerProfile } from './render-data'
import { resolvePartnerTheme, getThemeConfig, type CSSCustomProperties } from './theme'
import { getPromptConfig } from './prompt-config'
import { selectPartnerTemplate } from './custom-templates'
import { recordBillableEvent } from './webhooks'
import { assembleHumeNativePrompt } from '@/lib/voice/hume-native/prompt-template'
import { provisionNativeConfig } from '@/lib/voice/hume-native/config-provisioner'
import { getContentSource, resolveContentSourceHeaders } from './content-sources'
import { safeFetchPartnerPage } from './ssrf'
import { inngest } from '@/inngest/client'
import type { TemplateSection } from '@/lib/templates/types'
import type { DraftPayload } from './content-generation'

/**
 * B2B-03 — Live-session render path (Requirement Doc Section 4.C/6.6;
 * architecture.md Section 12.6). Orchestrates the exact sequence: validate
 * ref -> pull content -> pull profile (if enabled) -> resolve theme per
 * section -> select template per section -> provision Hume config -> return
 * everything the render page's client component needs to mount.
 *
 * B2B-10 — this file also backs the Attendee-webhook fallback-completion
 * path (see app/api/attendee/webhook/route.ts's handlePartnerSessionEvent).
 * No new exported functions were added for that; handleSessionEnd() below
 * gained one optional parameter instead — see its doc comment.
 */

/** B2B-19 — one inline content page as stored on partner_sessions.content_pages. */
export interface InlineContentPage {
  url: string
  media_type: 'html' | 'image'
  title: string | null
  subtitle: string | null
  transition_trigger: string
  transition_marker: string
}

export interface PartnerSessionRow {
  id: string
  partnerAccountId: string
  contentRef: string | null
  partnerTopicRef: string | null
  partnerEndUserRef: string | null
  status: string
  testMode: boolean
  // B2B-19 — inline content mode (Option 1). Null on Option 2 template-ref sessions.
  contentSourceId: string | null
  contentPages: InlineContentPage[] | null
  contentToExplain: string | null
  contentTitle: string | null
  contentSubtitle: string | null
}

export async function getPartnerSession(clioSessionRef: string): Promise<PartnerSessionRow | null> {
  const supabase = createSupabaseAdminClient()
  const { data } = await supabase
    .from('partner_sessions')
    .select(
      'id, partner_account_id, content_ref, partner_topic_ref, partner_end_user_ref, status, test_mode, content_source_id, content_pages, content_to_explain, content_title, content_subtitle'
    )
    .eq('id', clioSessionRef)
    .maybeSingle()

  if (!data) return null
  const rawPages = data.content_pages as InlineContentPage[] | null
  return {
    id: data.id as string,
    partnerAccountId: data.partner_account_id as string,
    contentRef: (data.content_ref as string | null) ?? null,
    partnerTopicRef: (data.partner_topic_ref as string | null) ?? null,
    partnerEndUserRef: (data.partner_end_user_ref as string | null) ?? null,
    status: data.status as string,
    testMode: Boolean(data.test_mode),
    contentSourceId: (data.content_source_id as string | null) ?? null,
    contentPages: Array.isArray(rawPages) && rawPages.length > 0 ? rawPages : null,
    contentToExplain: (data.content_to_explain as string | null) ?? null,
    contentTitle: (data.content_title as string | null) ?? null,
    contentSubtitle: (data.content_subtitle as string | null) ?? null,
  }
}

export interface RenderedSection {
  section: TemplateSection
  cssCustomProperties: CSSCustomProperties
}

/** B2B-19 — one inline page prepared for the render client. Page bodies are
 *  fetched server-side (SSRF-guarded, credentials resolved) and passed as an
 *  inline HTML string (rendered in a sandboxed iframe) or an image data URI —
 *  never a raw partner URL in the browser (no credential leak, no client-side
 *  SSRF surface). A page that could not be fetched degrades to `unavailable`. */
export interface RenderedInlinePage {
  mediaType: 'html' | 'image'
  title: string | null
  subtitle: string | null
  transitionMarker: string
  status: 'ok' | 'unavailable'
  contentHtml?: string
  imageDataUri?: string
}

export type LiveRenderResult =
  | { status: 'unavailable' | 'not_configured' }
  | {
      status: 'ok'
      mode: 'template'
      partnerAccountId: string
      sections: RenderedSection[]
      humeConfigId: string | null
      assistantDisplayName: string
    }
  | {
      status: 'ok'
      mode: 'inline'
      partnerAccountId: string
      inlinePages: RenderedInlinePage[]
      humeConfigId: string | null
      assistantDisplayName: string
    }

/** Builds a short, partner-safe text block from a pulled profile payload — mirrors buildProfileContextForClio's style without depending on that Clerk-keyed function. */
function formatPartnerProfileContext(profile: unknown): string {
  if (!profile || typeof profile !== 'object') return ''
  const p = profile as Record<string, unknown>
  const lines: string[] = []
  for (const dimension of ['knowledge', 'intellectual', 'psychological', 'business_lens']) {
    const value = p[dimension]
    if (value && typeof value === 'object' && Object.keys(value).length > 0) {
      lines.push(`${dimension}: ${JSON.stringify(value)}`)
    }
  }
  return lines.length > 0 ? `PARTICIPANT PROFILE (fetched from partner)\n${lines.join('\n')}` : ''
}

/**
 * architecture.md Section 12.6, steps 1-7. Never throws — every failure mode
 * (content pull failure, malformed payload) resolves to a status the render
 * page already has a defined screen state for (Section 4.C Screen state 3).
 */
export async function resolveLiveSessionRender(session: PartnerSessionRow): Promise<LiveRenderResult> {
  // B2B-19 — inline content mode (Option 1) takes a wholly separate render path
  // that bypasses extractSections()/TemplateSection entirely (Requirement Doc
  // Section 4.C-C1). Option 2 (template-ref) falls through unchanged below.
  if (session.contentPages) {
    return resolveInlineSessionRender(session)
  }

  const contentPull = await pullPartnerContent(session.partnerAccountId, {
    contentRef: session.contentRef,
    partnerTopicRef: session.partnerTopicRef,
  })

  if (contentPull.status !== 'ok') {
    return { status: contentPull.status }
  }

  // Step 3 — profile pull, only if profile_sync_enabled (enforced inside pullPartnerProfile itself).
  const profilePull = await pullPartnerProfile(session.partnerAccountId, session.partnerEndUserRef)
  const profileContext = profilePull.status === 'ok' ? formatPartnerProfileContext(profilePull.profile) : ''

  const sections = extractSections(contentPull.payload)
  if (sections.length === 0) return { status: 'unavailable' }

  const theme = await getThemeConfig(session.partnerAccountId)
  const assistantDisplayName = theme.assistantDisplayName ?? 'your AI guide'

  const rendered: RenderedSection[] = []
  for (let index = 0; index < sections.length; index++) {
    const section = sections[index]
    // Step 5 — template selection. Position is 'first' for the first
    // section, 'last' for the final section, 'middle' otherwise — mirrors
    // selectTemplatesForSubtopics()'s own convention (lib/templates/selector.ts).
    const position = index === 0 ? 'first' : index === sections.length - 1 ? 'last' : 'middle'
    const templateHint = (section as { type?: string }).type
    const selection = await selectPartnerTemplate(session.partnerAccountId, sectionTitle(section), position, templateHint)
    const templateName = selection.kind === 'library' ? selection.templateName : selection.template.templateLabel

    const cssCustomProperties = await resolvePartnerTheme(session.partnerAccountId, templateName)
    rendered.push({ section, cssCustomProperties })
  }

  // Step 7 — Hume config, with the partner's own assistant name in place of "Clio".
  // B2B-11 (Requirement Doc Section 5.3) — also reads this partner's
  // prompt-behavior config and threads it through as `promptBehavior`.
  let humeConfigId: string | null = null
  try {
    const sessionContent = sections
      .map((s) => JSON.stringify(s))
      .join('\n\n')
    const promptConfig = await getPromptConfig(session.partnerAccountId)
    const prompt = assembleHumeNativePrompt({
      profileContext,
      intentContext: '',
      sessionContent,
      assistantName: assistantDisplayName,
      promptBehavior: {
        tonePersona: promptConfig.tonePersona,
        deferralPhrasing: promptConfig.deferralPhrasing,
        closingConfirmationQuestion: promptConfig.closingConfirmationQuestion,
        goodbyeLine: promptConfig.goodbyeLine,
        verificationQuestionStyle: promptConfig.verificationQuestionStyle,
        interSectionRecapStyle: promptConfig.interSectionRecapStyle,
      },
    })

    // B2B-11 Section 5.3/6.1a — persist the fully-assembled prompt so the
    // join-greeting route (Section 6.3) can prepend it to any live greeting
    // send, rather than replacing Hume's active prompt with the greeting
    // fragment alone. Best-effort: failure here does not block or fail the
    // render itself — `prompt` below is still sent to Hume at connect time
    // either way; only a *later* join greeting for this session degrades
    // gracefully (Section 8's dedicated error-state row) if this write does
    // not succeed.
    const supabase = createSupabaseAdminClient()
    const { error: snapshotError } = await supabase
      .from('partner_sessions')
      .update({ assembled_prompt_snapshot: prompt })
      .eq('id', session.id)
    if (snapshotError) {
      console.error('[partner/live-render] failed to persist assembled_prompt_snapshot (non-fatal — session proceeds, join-greeting for this session may be unavailable):', { sessionId: session.id, error: snapshotError })
    }

    const provisioned = await provisionNativeConfig({ sessionId: session.id, assembledPrompt: prompt })
    humeConfigId = provisioned.configId
  } catch (err) {
    console.error('[partner/live-render] Hume config provisioning failed (session proceeds without voice):', err instanceof Error ? err.message : err)
  }

  return {
    status: 'ok',
    mode: 'template',
    partnerAccountId: session.partnerAccountId,
    sections: rendered,
    humeConfigId,
    assistantDisplayName,
  }
}

/**
 * B2B-19 — inline-content render path (Requirement Doc Section 1.3 / 4.C).
 * Resolves the content-source credentials, fetches each page URL SSRF-guarded,
 * and returns HTML (for a sandboxed iframe) / image data URIs for the render
 * client — never touching extractSections()/TemplateSection. Injects the
 * system-generated per-page transition marker into the assembled prompt (both
 * as text for the bot to say AND an instruction to call the advance tool — the
 * dual signal, Requirement Doc Section 2.2). Never throws: any per-page fetch
 * failure degrades that page to `unavailable` (mirrors pullPartnerContent).
 */
async function resolveInlineSessionRender(session: PartnerSessionRow): Promise<LiveRenderResult> {
  const pages = session.contentPages ?? []

  // Resolve outbound credentials for the source (if any). A resolution failure
  // is not fatal — public/`none` sources need no headers, and a credentialed
  // source that fails to resolve simply yields per-page `unavailable` fetches.
  let headers: Record<string, string> = {}
  if (session.contentSourceId) {
    const source = await getContentSource(session.contentSourceId, session.partnerAccountId)
    if (source) {
      const resolved = await resolveContentSourceHeaders(source)
      if (resolved.status === 'ok') headers = resolved.headers
      else console.warn('[partner/live-render] content-source headers unavailable:', resolved.reason)
    }
  }

  const rendered: RenderedInlinePage[] = []
  for (const page of pages) {
    const fetched = await safeFetchPartnerPage(page.url, headers, page.media_type)
    if (fetched.status !== 'ok') {
      rendered.push({
        mediaType: page.media_type,
        title: page.title,
        subtitle: page.subtitle,
        transitionMarker: page.transition_marker,
        status: 'unavailable',
      })
      continue
    }

    if (page.media_type === 'image') {
      const dataUri = `data:${fetched.contentType};base64,${fetched.body.toString('base64')}`
      rendered.push({
        mediaType: 'image',
        title: page.title,
        subtitle: page.subtitle,
        transitionMarker: page.transition_marker,
        status: 'ok',
        imageDataUri: dataUri,
      })
    } else {
      rendered.push({
        mediaType: 'html',
        title: page.title,
        subtitle: page.subtitle,
        transitionMarker: page.transition_marker,
        status: 'ok',
        contentHtml: fetched.body.toString('utf8'),
      })
    }
  }

  const theme = await getThemeConfig(session.partnerAccountId)
  const assistantDisplayName = theme.assistantDisplayName ?? 'your AI guide'

  // Assemble the prompt with per-page marker injection. Page BODIES are never
  // sent to the bot (data boundary) — only the partner's narration inputs
  // (content_to_explain + per-page titles/subtitles/triggers).
  let humeConfigId: string | null = null
  try {
    const sessionContent = buildInlineSessionContent(session, pages)
    const promptConfig = await getPromptConfig(session.partnerAccountId)
    const prompt = assembleHumeNativePrompt({
      profileContext: '',
      intentContext: '',
      sessionContent,
      assistantName: assistantDisplayName,
      promptBehavior: {
        tonePersona: promptConfig.tonePersona,
        deferralPhrasing: promptConfig.deferralPhrasing,
        closingConfirmationQuestion: promptConfig.closingConfirmationQuestion,
        goodbyeLine: promptConfig.goodbyeLine,
        verificationQuestionStyle: promptConfig.verificationQuestionStyle,
        interSectionRecapStyle: promptConfig.interSectionRecapStyle,
      },
    })

    // Persist the full assembled prompt so the join-greeting AND wrap-up-nudge
    // routes prepend it (Hume's session_settings.system_prompt fully replaces
    // the active prompt — B2B-11 Technical Decision 6). Best-effort.
    const supabase = createSupabaseAdminClient()
    const { error: snapshotError } = await supabase
      .from('partner_sessions')
      .update({ assembled_prompt_snapshot: prompt })
      .eq('id', session.id)
    if (snapshotError) {
      console.error('[partner/live-render] failed to persist assembled_prompt_snapshot (inline, non-fatal):', { sessionId: session.id, error: snapshotError })
    }

    const provisioned = await provisionNativeConfig({ sessionId: session.id, assembledPrompt: prompt })
    humeConfigId = provisioned.configId
  } catch (err) {
    console.error('[partner/live-render] Hume config provisioning failed (inline session proceeds without voice):', err instanceof Error ? err.message : err)
  }

  return {
    status: 'ok',
    mode: 'inline',
    partnerAccountId: session.partnerAccountId,
    inlinePages: rendered,
    humeConfigId,
    assistantDisplayName,
  }
}

/**
 * Builds the SESSION CONTENT block for an inline session's assembled prompt.
 * Each page gets a stage-direction (leveraging the fixed template's rule 10 —
 * "never speak bracketed labels aloud") instructing the bot to say the page's
 * unique transition marker naturally AND call the advance tool at the
 * transition point — the dual signal (Requirement Doc Sections 2.2, 5.4).
 */
function buildInlineSessionContent(session: PartnerSessionRow, pages: InlineContentPage[]): string {
  const blocks: string[] = []

  if (session.contentTitle) blocks.push(`SESSION TITLE: ${session.contentTitle}`)
  if (session.contentSubtitle) blocks.push(`SESSION SUBTITLE: ${session.contentSubtitle}`)
  if (session.contentToExplain) {
    blocks.push(`WHAT TO EXPLAIN (overall narration guidance for this session):\n${session.contentToExplain}`)
  }

  blocks.push(
    `You will narrate ${pages.length} page(s) in order. The participant sees each page on the shared screen. ` +
      `Cover each page's material, then move to the next at the transition point described for that page.`
  )

  pages.forEach((page, index) => {
    const pageNo = index + 1
    const isLast = index === pages.length - 1
    const lines: string[] = [`[PAGE ${pageNo} of ${pages.length}${page.title ? ` — "${page.title}"` : ''}]`]
    if (page.subtitle) lines.push(`Subtitle: ${page.subtitle}`)
    if (isLast) {
      lines.push(
        `[STAGE DIRECTION — DO NOT SAY THE BRACKETED LABEL] This is the final page (transition intent: "${page.transition_trigger}"). ` +
          `When you have finished covering it and are about to close the session, say this exact phrase naturally as part of your sentence: "${page.transition_marker}". ` +
          `Then follow the closing sequence and call the end_session tool.`
      )
    } else {
      lines.push(
        `[STAGE DIRECTION — DO NOT SAY THE BRACKETED LABEL] When you have finished covering this page (transition intent: "${page.transition_trigger}") and are about to move to page ${pageNo + 1}, ` +
          `say this exact phrase naturally as part of your sentence: "${page.transition_marker}". Then call the advance_tab tool.`
      )
    }
    blocks.push(lines.join('\n'))
  })

  return blocks.join('\n\n')
}

/** Extracts a TemplateSection[] from a pulled content payload. Handles both Clio's own generated shape (DraftPayload, format='json') and a bare array-of-sections shape, so a partner-authored /content response using the simpler shape also renders. */
function extractSections(payload: unknown): TemplateSection[] {
  if (!payload) return []

  // Clio-generated push contract wraps payload as a JSON string (architecture.md
  // Section 6.1: `"payload": "<the actual content>"`). Pulled content may
  // arrive already-parsed (partner echoes JSON back as an object) or as the
  // original string — handle both.
  let candidate: unknown = payload
  if (typeof payload === 'object' && payload !== null && 'payload' in (payload as Record<string, unknown>)) {
    const inner = (payload as Record<string, unknown>).payload
    candidate = typeof inner === 'string' ? safeParseJson(inner) : inner
  } else if (typeof payload === 'string') {
    candidate = safeParseJson(payload)
  }

  if (!candidate || typeof candidate !== 'object') return []

  const draft = candidate as Partial<DraftPayload> & { sections?: TemplateSection[] }
  if (Array.isArray(draft.sections)) return draft.sections
  if (Array.isArray(candidate)) return candidate as TemplateSection[]
  return []
}

function safeParseJson(value: string): unknown {
  try {
    return JSON.parse(value)
  } catch {
    return null
  }
}

function sectionTitle(section: TemplateSection): string {
  return (section.meta as { subtopicTitle?: string } | undefined)?.subtopicTitle ?? section.type
}

/**
 * architecture.md Section 12.6 step 9 — the call-site instrumentation
 * B2B-02's own Section 10 explicitly deferred to this brief. Called once,
 * on session end, from the render page's client component.
 *
 * B2B-08 — `testMode` is a required, in-scope adjacent fix (not a new
 * feature, architecture.md Section 15.6): this function previously never
 * read `partner_sessions.test_mode` and never passed a `testMode` argument
 * to either `recordBillableEvent()` call, meaning `applyWalletDecrement()`'s
 * `test_mode` skip was never actually reachable from this call site. Now
 * threaded through from `getPartnerSession()`'s `test_mode` column, and used
 * to (a) cancel the pending trial-cutoff job on a normal end and (b) consume
 * the actual trial/test-block minutes for a test-mode session.
 *
 * B2B-10 — `targetStatus` (optional, defaults to `'completed'`) lets the
 * Attendee-webhook fallback-completion path (handlePartnerSessionEvent in
 * app/api/attendee/webhook/route.ts) land a session as `'failed'` for a
 * `bot.state_change: fatal_error` event, without changing behavior for the
 * existing call site (app/api/partner/render/end-session/route.ts), which
 * still calls this with 4 arguments and gets identical `'completed'`
 * behavior. Every other side effect (trial-cutoff cancellation, the
 * durationMinutes > 0 gated usage.voice_minute billing, and the
 * unconditional final session.completed billable-event dispatch) is
 * unchanged and fires identically regardless of targetStatus — full reuse,
 * no new billing logic, per docs/specs/B2B-10-requirement-document.md
 * Section 6's Technical Decision.
 */
export async function handleSessionEnd(
  clioSessionRef: string,
  partnerAccountId: string,
  durationMinutes: number,
  testMode: boolean,
  targetStatus: 'completed' | 'failed' = 'completed',
  billedDurationSource: 'attendee' | 'attendee_receipt' | 'client_reported' | 'wall_clock_fallback' = 'client_reported',
): Promise<void> {
  const supabase = createSupabaseAdminClient()
  await supabase
    .from('partner_sessions')
    .update({ status: targetStatus, ended_at: new Date().toISOString(), billed_duration_source: billedDurationSource })
    .eq('id', clioSessionRef)

  // B2B-08 — cancel the trial-cutoff job so a normally-ended test session never triggers a
  // redundant forced cutoff. Mirrors session-timer.ts's own cancelOn pattern. Fire-and-forget.
  if (testMode) {
    inngest.send({ name: 'clio/partner-trial.ended', data: { clioSessionRef } })
      .catch((err) => console.error('[live-render] clio/partner-trial.ended emit failed:', err))
  } else {
    // B2B-19 — cancel the live-wallet mid-session cutoff on a normal live end
    // (mirrors the test-mode cancel above). A cancel for a session that never
    // armed a cutoff (e.g. Option 2 live, or no configured rate) is a harmless no-op.
    inngest.send({ name: 'clio/partner-live.ended', data: { clioSessionRef } })
      .catch((err) => console.error('[live-render] clio/partner-live.ended emit failed:', err))
  }

  if (durationMinutes > 0) {
    await recordBillableEvent({
      partnerAccountId,
      eventType: 'usage.voice_minute',
      clioSessionRef,
      quantity: durationMinutes,
      unit: 'minutes',
      testMode,                     // FIX — previously always omitted/false
      isMeteredTestUsage: testMode, // every test-mode dispatch is now gated by the B2B-08
                                     // trial mechanism (app/api/partner/v1/sessions/route.ts),
                                     // so there is no remaining "ordinary, unmetered" test-mode
                                     // usage path left to distinguish.
    })

    if (testMode) {
      // Consumes the ACTUAL duration used (not availableMinutes — that figure is only for the
      // forced-cutoff path, where the session ran its full allowance). Non-fatal on failure, same
      // discipline recordBillableEvent()'s own wallet-decrement call already uses.
      try {
        const { error } = await supabase.rpc('consume_trial_and_test_minutes', {
          p_partner_account_id: partnerAccountId,
          p_minutes: durationMinutes,
        })
        if (error) console.error('[live-render] consume_trial_and_test_minutes RPC failed (non-fatal):', error.message)
      } catch (err) {
        console.error('[live-render] consume_trial_and_test_minutes failed (non-fatal):', err instanceof Error ? err.message : err)
      }
    }
  }

  await recordBillableEvent({ partnerAccountId, eventType: 'session.completed', clioSessionRef, testMode })
}
