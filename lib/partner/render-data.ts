import { createSupabaseAdminClient } from '@/lib/supabase'
import { decryptOutboundToken } from './crypto'

/**
 * B2B-02 — Content & profile push-pull contracts (architecture.md Section 6).
 *
 * These are the "render-time code path" functions referenced by
 * docs/specs/B2B-02-requirement-document.md Section 7's falsifiable test:
 * "Given profile_sync_enabled = false ... no HTTP call to
 * {outbound_base_url}/profile is made at any point in that session's
 * lifecycle." `pullPartnerProfile()` below enforces that literally — when the
 * toggle is off, the function returns before constructing a URL or calling
 * `fetch` at all; there is no code path that could ever issue that request.
 *
 * IMPORTANT — these functions are intentionally NOT wired into
 * `app/partner-render/[clio_session_ref]/page.tsx` in this brief. Per the
 * B2B-02 task brief: the render route is a deliberate placeholder stub (no
 * real content-pulling, no Hume-driving, no white-labeling) — wiring these
 * functions into an actual rendering experience is explicitly B2B-03's job
 * (see architecture.md Section 5, "Why partner_sessions is a new table").
 * They exist here, independently testable, so B2B-03 can call them directly
 * against an already-built, already-correct contract rather than re-deriving
 * it, and so this brief's own acceptance criteria around the
 * profile_sync_enabled gate are verifiable now via unit tests against this
 * module.
 *
 * Zero Clio-side persistence (architecture.md Section 6.2): every payload
 * here exists only in-memory for the duration of the HTTP call that
 * retrieves/sends it. Nothing in this file writes a content or profile
 * payload to any Supabase table.
 */

interface OutboundConfig {
  outboundBaseUrl: string | null
  outboundToken: string | null
  profileSyncEnabled: boolean
}

async function loadOutboundConfig(partnerAccountId: string): Promise<OutboundConfig | null> {
  const supabase = createSupabaseAdminClient()
  const { data } = await supabase
    .from('partner_accounts')
    .select('outbound_base_url, outbound_auth_token_ciphertext, profile_sync_enabled')
    .eq('id', partnerAccountId)
    .maybeSingle()

  if (!data) return null

  return {
    outboundBaseUrl: (data.outbound_base_url as string | null) ?? null,
    outboundToken: decryptOutboundToken(data.outbound_auth_token_ciphertext as string | null),
    profileSyncEnabled: Boolean(data.profile_sync_enabled),
  }
}

function outboundHeaders(token: string | null): Record<string, string> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (token) headers.Authorization = `Bearer ${token}`
  return headers
}

export interface ContentPullResult {
  status: 'ok' | 'unavailable' | 'not_configured'
  payload?: unknown
}

/**
 * GET {outbound_base_url}/content?content_ref=... or ?partner_topic_ref=...
 * (architecture.md Section 6.2). A partner 404 (or any failure) surfaces as
 * `{ status: 'unavailable' }` — a legitimate, handled state per Section 5.3,
 * never a thrown error.
 */
export async function pullPartnerContent(
  partnerAccountId: string,
  ref: { contentRef?: string | null; partnerTopicRef?: string | null }
): Promise<ContentPullResult> {
  const config = await loadOutboundConfig(partnerAccountId)
  if (!config?.outboundBaseUrl) return { status: 'not_configured' }

  const query = ref.contentRef
    ? `content_ref=${encodeURIComponent(ref.contentRef)}`
    : ref.partnerTopicRef
      ? `partner_topic_ref=${encodeURIComponent(ref.partnerTopicRef)}`
      : null
  if (!query) return { status: 'unavailable' }

  try {
    const res = await fetch(`${config.outboundBaseUrl.replace(/\/$/, '')}/content?${query}`, {
      method: 'GET',
      headers: outboundHeaders(config.outboundToken),
    })
    if (!res.ok) return { status: 'unavailable' }
    return { status: 'ok', payload: await res.json() }
  } catch (err) {
    console.error('[partner/render-data] pullPartnerContent failed:', err instanceof Error ? err.message : err)
    return { status: 'unavailable' }
  }
}

export interface ProfilePullResult {
  status: 'ok' | 'unavailable' | 'disabled' | 'no_ref' | 'not_configured'
  profile?: unknown
}

/**
 * GET {outbound_base_url}/profile?partner_end_user_ref=... — ONLY if
 * `profile_sync_enabled = true`. If false, this function returns
 * `{ status: 'disabled' }` immediately, before any URL is built or `fetch`
 * called — this is what makes Objective 1's falsifiable test
 * ("toggle off ⇒ Clio has no memory of the user") mechanically true, not just
 * documented as a convention.
 */
export async function pullPartnerProfile(
  partnerAccountId: string,
  partnerEndUserRef: string | null | undefined
): Promise<ProfilePullResult> {
  const config = await loadOutboundConfig(partnerAccountId)
  if (!config) return { status: 'not_configured' }
  if (!config.profileSyncEnabled) return { status: 'disabled' }
  if (!partnerEndUserRef) return { status: 'no_ref' }
  if (!config.outboundBaseUrl) return { status: 'not_configured' }

  try {
    const res = await fetch(
      `${config.outboundBaseUrl.replace(/\/$/, '')}/profile?partner_end_user_ref=${encodeURIComponent(partnerEndUserRef)}`,
      { method: 'GET', headers: outboundHeaders(config.outboundToken) }
    )
    // 404 = no profile yet, a fully legitimate first-session state (architecture.md Section 6.3).
    if (res.status === 404) return { status: 'unavailable' }
    if (!res.ok) return { status: 'unavailable' }
    return { status: 'ok', profile: await res.json() }
  } catch (err) {
    console.error('[partner/render-data] pullPartnerProfile failed:', err instanceof Error ? err.message : err)
    return { status: 'unavailable' }
  }
}

export interface PushResult {
  success: boolean
  error?: string
}

/**
 * POST {outbound_base_url}/content — Clio pushes once-generated,
 * partner-approved content. Contract only; the actual trigger (Designer
 * approval) is B2B-03's scope. Failure is surfaced synchronously to whatever
 * caller invokes this — NEVER retried via `webhook_dispatch_log`
 * (architecture.md Section 7.4, "What must never be logged").
 */
export async function pushPartnerContent(
  partnerAccountId: string,
  content: { contentRef: string; partnerTopicRef?: string | null; format: 'html' | 'json'; payload: string; version: number }
): Promise<PushResult> {
  const config = await loadOutboundConfig(partnerAccountId)
  if (!config?.outboundBaseUrl) return { success: false, error: 'outbound_base_url not configured' }

  try {
    const res = await fetch(`${config.outboundBaseUrl.replace(/\/$/, '')}/content`, {
      method: 'POST',
      headers: outboundHeaders(config.outboundToken),
      body: JSON.stringify({
        content_ref: content.contentRef,
        partner_topic_ref: content.partnerTopicRef ?? null,
        format: content.format,
        payload: content.payload,
        version: content.version,
        generated_at: new Date().toISOString(),
      }),
    })
    if (!res.ok) return { success: false, error: `Partner /content push returned ${res.status}` }
    return { success: true }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'unknown error' }
  }
}

/**
 * POST {outbound_base_url}/profile — only called if `profile_sync_enabled`.
 * Same never-retried-via-dispatch-log discipline as `pushPartnerContent`.
 */
export async function pushPartnerProfile(
  partnerAccountId: string,
  profile: { partnerEndUserRef: string; profile: Record<string, unknown> }
): Promise<PushResult> {
  const config = await loadOutboundConfig(partnerAccountId)
  if (!config) return { success: false, error: 'partner account not found' }
  if (!config.profileSyncEnabled) return { success: false, error: 'profile_sync_enabled is false' }
  if (!config.outboundBaseUrl) return { success: false, error: 'outbound_base_url not configured' }

  try {
    const res = await fetch(`${config.outboundBaseUrl.replace(/\/$/, '')}/profile`, {
      method: 'POST',
      headers: outboundHeaders(config.outboundToken),
      body: JSON.stringify({
        partner_end_user_ref: profile.partnerEndUserRef,
        profile: profile.profile,
        computed_at: new Date().toISOString(),
      }),
    })
    if (!res.ok) return { success: false, error: `Partner /profile push returned ${res.status}` }
    return { success: true }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'unknown error' }
  }
}
