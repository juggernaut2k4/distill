import { getPartnerSession, resolveLiveSessionRender, buildInlineSessionContent } from '@/lib/partner/live-render'
import { getThemeConfig } from '@/lib/partner/theme'
import { getPromptConfig } from '@/lib/partner/prompt-config'
import { createSupabaseAdminClient } from '@/lib/supabase'
import { assembleBotElevenLabsPrompt } from '@/lib/voice/bot-elevenlabs-prompt-rules'
import BotRenderClient from './BotRenderClient'

/**
 * /bot-render/[clio_session_ref]
 *
 * Production bot-sessions render route (2026-08-12) — a fork of `/widget-render/[clio_session_ref]/
 * page.tsx`, per Arun's explicit instruction that production gets its own copy of everything so no
 * production change can ever accidentally impact the demo/widget-sessions path. ElevenLabs-only (no
 * provider toggle at all — production dropped Hume/OpenAI Realtime per Arun's direct instruction),
 * reading the session's own resolved `elevenlabsAgentId` (set at creation by bot-sessions/route.ts's
 * `resolveBotIdToAgentId()`) rather than a global default. The core prompting and tool-calling
 * behavior are unchanged from the demo's proven implementation — only the provider selection is
 * simplified.
 *
 * `/widget-render/page.tsx` and `WidgetRenderClient.tsx` are not touched anywhere by this file or
 * its sibling `BotRenderClient.tsx`.
 *
 * Public, no Clerk session — loaded headlessly by a sales-partner's own iframe.
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

export default async function BotRenderPage({
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

  // Defensive check, same pattern as /widget-render/page.tsx: this route only ever renders an
  // inline-content session created via the bot-dispatch/bot-sessions pipeline.
  const supabase = createSupabaseAdminClient()
  const { data: channelRows } = await supabase.from('partner_sessions').select('delivery_channel').eq('id', session.id).limit(1)
  if (channelRows?.[0]?.delivery_channel !== 'widget') {
    return <ThemedMessage primaryColor="#7C3AED" message="This session reference could not be found." />
  }

  const theme = await getThemeConfig(session.partnerAccountId)

  // Production is ElevenLabs-only — no provider selection, no voice_provider persistence write
  // (that column's purpose is disambiguating which of several providers a session ran on; there's
  // only ever one here).

  const result = await resolveLiveSessionRender(session)

  if (result.status !== 'ok' || result.mode !== 'inline') {
    return <ThemedMessage primaryColor={theme.primaryColor} message="This session's content isn't available right now." />
  }

  const promptConfig = await getPromptConfig(session.partnerAccountId)
  const sessionContent = buildInlineSessionContent(session, session.contentPages ?? [], 'widget')

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

  const elevenlabsVoiceInstructions = assembleBotElevenLabsPrompt(promptInput)

  // This session's own resolved agent (set at creation time by bot-sessions/route.ts's
  // resolveBotIdToAgentId() — the bot_id three-layer resolution, per sales-partner). No global
  // fallback: a session created without a resolvable agent renders with voice disabled rather than
  // silently defaulting to some other partner's configured agent.
  const elevenlabsAgentId = session.elevenlabsAgentId ?? null

  if (!elevenlabsAgentId) {
    console.error('[bot-render] no elevenlabs agent id resolved for this session — rendering without voice', { sessionId: session.id })
  }

  return (
    <BotRenderClient
      clioSessionRef={session.id}
      inlinePages={result.inlinePages}
      elevenlabsAgentId={elevenlabsAgentId}
      elevenlabsVoiceInstructions={elevenlabsVoiceInstructions}
    />
  )
}
