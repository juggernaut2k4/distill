import { getPartnerSession, resolveLiveSessionRender, buildInlineSessionContent } from '@/lib/partner/live-render'
import { getThemeConfig } from '@/lib/partner/theme'
import { getPromptConfig } from '@/lib/partner/prompt-config'
import { getWidgetVoiceProvider, getElevenLabsAgentId } from '@/lib/voice/provider-config'
import { createSupabaseAdminClient } from '@/lib/supabase'
import { assembleWidgetOpenAIPrompt } from '@/lib/voice/widget-prompt-rules'
import { assembleWidgetElevenLabsPrompt } from '@/lib/voice/widget-elevenlabs-prompt-rules'
import WidgetRenderClient from './WidgetRenderClient'

/**
 * /widget-render/[clio_session_ref]
 *
 * B2B-71 (docs/specs/B2B-71-requirement-document.md §6.2) — a new, dedicated render route for the
 * widget delivery channel, structurally mirroring `/partner-render/[clio_session_ref]/page.tsx`
 * (same `UUID_RE` validation, same `ThemedMessage` fallback pattern, same `getPartnerSession`/
 * `getThemeConfig`/`getActiveVoiceProvider`/`resolveLiveSessionRender` calls, all reused unmodified)
 * with exactly one addition: a `delivery_channel === 'widget'` guard, closing the loophole of a
 * meeting-bot session ref being loaded through this path by URL substitution.
 *
 * Built as a genuinely separate route — not a branch inside `/partner-render` — per Arun's explicit,
 * risk-driven decision to protect the just-stabilized meeting-bot render path from any risk during
 * this new capability's proving-out period. `PartnerRenderClient.tsx` and
 * `lib/voice/openai-realtime-prompt-template.ts` are not touched anywhere by this file or its sibling
 * `WidgetRenderClient.tsx`.
 *
 * Public, no Clerk session — loaded headlessly by a reseller's own iframe, exactly as
 * `/partner-render` is loaded by the meeting-bot's headless browser today.
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function ThemedMessage({ primaryColor, message }: { primaryColor: string; message: string }) {
  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: '#0a0a0a',
        color: '#ffffff',
        fontFamily: 'system-ui, sans-serif',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        textAlign: 'center',
        padding: 24,
      }}
    >
      <div>
        <div
          aria-hidden
          style={{
            width: 32,
            height: 32,
            margin: '0 auto 16px',
            borderRadius: '50%',
            border: `3px solid ${primaryColor}`,
            borderTopColor: 'transparent',
          }}
        />
        <p style={{ fontSize: 14, lineHeight: 1.6, maxWidth: 420 }}>{message}</p>
      </div>
    </div>
  )
}

export default async function WidgetRenderPage({
  params,
}: {
  params: { clio_session_ref: string }
}) {
  const ref = params.clio_session_ref

  if (!UUID_RE.test(ref)) {
    return <ThemedMessage primaryColor="#7C3AED" message="This session reference could not be found." />
  }

  const session = await getPartnerSession(ref)
  if (!session) {
    return <ThemedMessage primaryColor="#7C3AED" message="This session reference could not be found." />
  }

  // B2B-71 §6.2 — defensive check: this route only ever renders a widget-channel session. A
  // meeting-bot session ref loaded here (by URL substitution) gets the same not-found fallback as
  // any other invalid ref — a data-integrity guard, not a participant-facing error state that needs
  // its own explanation.
  const supabase = createSupabaseAdminClient()
  const { data: channelRows } = await supabase.from('partner_sessions').select('delivery_channel').eq('id', session.id).limit(1)
  if (channelRows?.[0]?.delivery_channel !== 'widget') {
    return <ThemedMessage primaryColor="#7C3AED" message="This session reference could not be found." />
  }

  const theme = await getThemeConfig(session.partnerAccountId)
  // B2B-75 (docs/specs/B2B-75-requirement-document.md §6.8) — the widget channel reads its OWN
  // provider setting. `getActiveVoiceProvider()` is deliberately untouched and now has exactly one
  // caller left: partner-render/page.tsx, the inline / meeting-bot channel, which keeps running on
  // `active_provider` with its existing two-value domain. This is the whole point of Decision D2 —
  // selecting ElevenLabs here can never route a meeting-bot session to a provider it has no wiring
  // for.
  const voiceProvider = await getWidgetVoiceProvider()

  // Same load-bearing persistence write /partner-render/page.tsx already performs (§6.1) — read
  // back later by inngest/partner-session-insights-extractor.ts. Copied here explicitly since this
  // is a new file, not something resolveLiveSessionRender() itself does.
  const { error: voiceProviderWriteError } = await supabase
    .from('partner_sessions')
    .update({ voice_provider: voiceProvider })
    .eq('id', session.id)
  if (voiceProviderWriteError) {
    console.error('[widget-render] failed to persist voice_provider (non-fatal):', { sessionId: session.id, error: voiceProviderWriteError })
  }

  const result = await resolveLiveSessionRender(session)

  if (result.status !== 'ok' || result.mode !== 'inline') {
    // Widget sessions are exclusively inline-content (widget-sessions/route.ts never sets
    // template-mode fields) — a non-'ok' or non-'inline' result is treated identically to the
    // existing /partner-render page's own "content isn't available" fallback.
    return <ThemedMessage primaryColor={theme.primaryColor} message="This session's content isn't available right now." />
  }

  // Per Arun's direct instruction (2026-08-03): "bring all the prompt from shared file and merge
  // to this file" — the widget channel's OpenAI Realtime prompt is now assembled entirely from
  // lib/voice/widget-prompt-rules.ts's own self-contained template, not from
  // resolveLiveSessionRender()'s result.assembledOpenAIPrompt (which is still computed above for
  // Hume's sake, via the shared, do-not-touch lib/voice/openai-realtime-prompt-template.ts, and
  // simply discarded here). sessionContent is plain narration-text formatting
  // (buildInlineSessionContent), not "the prompt" itself, so it stays reused as-is.
  const promptConfig = await getPromptConfig(session.partnerAccountId)
  // 2026-08-07 — 'widget' variant: this channel's own widget-prompt-rules.ts v21 owns all speaking
  // and tool-calling instructions now; the shared per-page stage direction states only page facts.
  // See buildInlineSessionContent's own doc comment. Meeting-bot's PartnerRenderClient.tsx call site
  // is untouched and keeps the 'meeting_bot' default.
  const sessionContent = buildInlineSessionContent(session, session.contentPages ?? [], 'widget')

  // B2B-75 §6.8 — both assemblers take the IDENTICAL input object, so this is a provider switch,
  // not two different data pipelines. `promptConfig` and `sessionContent` above are computed once
  // and shared. `buildInlineSessionContent(..., 'widget')` keeps its variant argument unchanged —
  // its stage direction states per-page facts only, with no provider-specific content, so it is
  // correct for ElevenLabs as-is, and the 'meeting_bot' default stays untouched.
  const promptInput = {
    profileContext: '',
    intentContext: '',
    sessionContent,
    assistantName: theme.assistantDisplayName ?? undefined,
    audienceDescription: session.endUserRole?.trim() || undefined,
    participantName: session.endUserName ?? undefined,
    endUserIndustry: session.endUserIndustry ?? undefined,
    promptBehavior: {
      tonePersona: promptConfig.tonePersona,
      deferralPhrasing: promptConfig.deferralPhrasing,
      closingConfirmationQuestion: promptConfig.closingConfirmationQuestion,
      goodbyeLine: promptConfig.goodbyeLine,
      verificationQuestionStyle: promptConfig.verificationQuestionStyle,
      interSectionRecapStyle: promptConfig.interSectionRecapStyle,
    },
    conversationLanguage: session.conversationLanguage ?? undefined,
  }

  const openaiVoiceInstructions =
    voiceProvider === 'openai_realtime' ? assembleWidgetOpenAIPrompt(promptInput) : null

  const elevenlabsVoiceInstructions =
    voiceProvider === 'elevenlabs' ? assembleWidgetElevenLabsPrompt(promptInput) : null

  const elevenlabsAgentId = voiceProvider === 'elevenlabs' ? await getElevenLabsAgentId() : null

  // B2B-75 §6.8.4 — FAIL CLOSED, never fall back to a different provider. A session quietly running
  // on Hume while the admin believes it is on ElevenLabs is exactly the ambiguity this governance
  // model exists to prevent. With a null agent id the client's `voiceEnabled` resolves false, so the
  // page renders its content with no voice — the same degradation a missing humeConfigId already
  // produces today.
  if (voiceProvider === 'elevenlabs' && !elevenlabsAgentId) {
    console.error('[widget-render] widget provider is elevenlabs but no agent id is configured — rendering without voice')
  }

  return (
    <WidgetRenderClient
      clioSessionRef={session.id}
      inlinePages={result.inlinePages}
      humeConfigId={result.humeConfigId}
      voiceProvider={voiceProvider}
      openaiVoiceInstructions={openaiVoiceInstructions}
      elevenlabsAgentId={elevenlabsAgentId}
      elevenlabsVoiceInstructions={elevenlabsVoiceInstructions}
    />
  )
}
