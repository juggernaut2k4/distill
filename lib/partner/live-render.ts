import { createSupabaseAdminClient } from '@/lib/supabase'
import { pullPartnerContent, pullPartnerProfile } from './render-data'
import { resolvePartnerTheme, getThemeConfig, type CSSCustomProperties } from './theme'
import { selectPartnerTemplate } from './custom-templates'
import { recordBillableEvent } from './webhooks'
import { assembleHumeNativePrompt } from '@/lib/voice/hume-native/prompt-template'
import { provisionNativeConfig } from '@/lib/voice/hume-native/config-provisioner'
import type { TemplateSection } from '@/lib/templates/types'
import type { DraftPayload } from './content-generation'

/**
 * B2B-03 — Live-session render path (Requirement Doc Section 4.C/6.6;
 * architecture.md Section 12.6). Orchestrates the exact sequence: validate
 * ref -> pull content -> pull profile (if enabled) -> resolve theme per
 * section -> select template per section -> provision Hume config -> return
 * everything the render page's client component needs to mount.
 */

export interface PartnerSessionRow {
  id: string
  partnerAccountId: string
  contentRef: string | null
  partnerTopicRef: string | null
  partnerEndUserRef: string | null
  status: string
}

export async function getPartnerSession(clioSessionRef: string): Promise<PartnerSessionRow | null> {
  const supabase = createSupabaseAdminClient()
  const { data } = await supabase
    .from('partner_sessions')
    .select('id, partner_account_id, content_ref, partner_topic_ref, partner_end_user_ref, status')
    .eq('id', clioSessionRef)
    .maybeSingle()

  if (!data) return null
  return {
    id: data.id as string,
    partnerAccountId: data.partner_account_id as string,
    contentRef: (data.content_ref as string | null) ?? null,
    partnerTopicRef: (data.partner_topic_ref as string | null) ?? null,
    partnerEndUserRef: (data.partner_end_user_ref as string | null) ?? null,
    status: data.status as string,
  }
}

export interface RenderedSection {
  section: TemplateSection
  cssCustomProperties: CSSCustomProperties
}

export type LiveRenderResult =
  | { status: 'unavailable' | 'not_configured' }
  | {
      status: 'ok'
      partnerAccountId: string
      sections: RenderedSection[]
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
  let humeConfigId: string | null = null
  try {
    const sessionContent = sections
      .map((s) => JSON.stringify(s))
      .join('\n\n')
    const prompt = assembleHumeNativePrompt({
      profileContext,
      intentContext: '',
      sessionContent,
      assistantName: assistantDisplayName,
    })
    const provisioned = await provisionNativeConfig({ sessionId: session.id, assembledPrompt: prompt })
    humeConfigId = provisioned.configId
  } catch (err) {
    console.error('[partner/live-render] Hume config provisioning failed (session proceeds without voice):', err instanceof Error ? err.message : err)
  }

  return {
    status: 'ok',
    partnerAccountId: session.partnerAccountId,
    sections: rendered,
    humeConfigId,
    assistantDisplayName,
  }
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
 */
export async function handleSessionEnd(clioSessionRef: string, partnerAccountId: string, durationMinutes: number): Promise<void> {
  const supabase = createSupabaseAdminClient()
  await supabase
    .from('partner_sessions')
    .update({ status: 'completed', ended_at: new Date().toISOString() })
    .eq('id', clioSessionRef)

  if (durationMinutes > 0) {
    await recordBillableEvent({
      partnerAccountId,
      eventType: 'usage.voice_minute',
      clioSessionRef,
      quantity: durationMinutes,
      unit: 'minutes',
    })
  }

  await recordBillableEvent({
    partnerAccountId,
    eventType: 'session.completed',
    clioSessionRef,
  })
}
