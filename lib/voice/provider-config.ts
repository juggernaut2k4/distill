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
