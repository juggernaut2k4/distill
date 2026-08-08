import { createSupabaseAdminClient } from '@/lib/supabase'

/**
 * B2B-61 Part B (docs/specs/B2B-61-requirement-document.md §6).
 *
 * Server-side read of the single, global `system_voice_config` row — the
 * live-voice provider new partner sessions should use platform-wide. Called
 * from app/(with-clerk)/partner-render/[clio_session_ref]/page.tsx as a
 * sibling call alongside the existing `getThemeConfig(...)` call, not from
 * inside `resolveLiveSessionRender()` (Requirement Doc §0, §6 — that
 * function's own signature/return type is intentionally untouched by this
 * document).
 *
 * Fail-open to 'hume': a missing row (should not happen once migration 104
 * has run — it seeds the row itself — but is defensively handled anyway) or
 * any unexpected read error never blocks session render. This mirrors
 * `humeConfigId`'s own fail-open-to-`null` posture elsewhere in
 * `resolveLiveSessionRender` — a config-read hiccup should degrade to the
 * documented default provider, not break a live session.
 */
export async function getActiveVoiceProvider(): Promise<'hume' | 'openai_realtime'> {
  try {
    const supabase = createSupabaseAdminClient()
    const { data, error } = await supabase
      .from('system_voice_config')
      .select('active_provider')
      .eq('id', '00000000-0000-0000-0000-000000000001')
      .maybeSingle()

    if (error || !data) return 'hume'

    const value = (data as { active_provider: string }).active_provider
    return value === 'openai_realtime' ? 'openai_realtime' : 'hume'
  } catch (err) {
    console.error('[voice/provider-config] getActiveVoiceProvider failed, falling back to hume:', err)
    return 'hume'
  }
}

/**
 * B2B-75 (docs/specs/B2B-75-requirement-document.md §6.2).
 *
 * The WIDGET channel's own provider setting — a genuinely separate column from `active_provider`
 * above, read ONLY by app/(with-clerk)/widget-render/[clio_session_ref]/page.tsx.
 *
 * WHY SEPARATE, AND WHY `getActiveVoiceProvider()` ABOVE IS NOT MODIFIED (Decision D2): that
 * function has two call sites — the widget render page and
 * app/(with-clerk)/partner-render/[clio_session_ref]/page.tsx, the inline / meeting-bot channel,
 * which is explicitly out of scope for B2B-75 and must not change. Simply widening
 * `active_provider`'s domain to include 'elevenlabs' would mean selecting ElevenLabs in the admin
 * card ALSO routed live meeting-bot sessions to a provider with no adapter wiring and no prompt on
 * that path. Two channels, two settings.
 *
 * Fail-open to 'hume' on a missing row, a read error, or an unrecognised stored value — identical
 * posture and reasoning to `getActiveVoiceProvider()`: a config-read hiccup must degrade to the
 * documented default provider, never break a live session render.
 */
export type WidgetVoiceProvider = 'hume' | 'openai_realtime' | 'elevenlabs'

export async function getWidgetVoiceProvider(): Promise<WidgetVoiceProvider> {
  try {
    const supabase = createSupabaseAdminClient()
    const { data, error } = await supabase
      .from('system_voice_config')
      .select('widget_provider')
      .eq('id', '00000000-0000-0000-0000-000000000001')
      .maybeSingle()

    if (error || !data) return 'hume'

    const value = (data as { widget_provider: string }).widget_provider
    if (value === 'openai_realtime' || value === 'elevenlabs') return value
    return 'hume'
  } catch (err) {
    console.error('[voice/provider-config] getWidgetVoiceProvider failed, falling back to hume:', err)
    return 'hume'
  }
}

/**
 * B2B-75 (§6.2). The ElevenLabs agent id for the widget channel — a plain identifier, NOT a secret
 * (Known Constraint C5), so it is stored and returned in plaintext and passed to the browser as a
 * prop.
 *
 * There is deliberately NO sibling helper returning the decrypted API key to a page component. The
 * key is decrypted in exactly one place, server-side: app/api/elevenlabs-token/route.ts.
 */
export async function getElevenLabsAgentId(): Promise<string | null> {
  try {
    const supabase = createSupabaseAdminClient()
    const { data, error } = await supabase
      .from('system_voice_config')
      .select('elevenlabs_agent_id')
      .eq('id', '00000000-0000-0000-0000-000000000001')
      .maybeSingle()

    if (error || !data) return null
    return (data as { elevenlabs_agent_id: string | null }).elevenlabs_agent_id ?? null
  } catch (err) {
    console.error('[voice/provider-config] getElevenLabsAgentId failed:', err)
    return null
  }
}
