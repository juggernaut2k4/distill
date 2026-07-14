import { getPartnerSession, resolveLiveSessionRender } from '@/lib/partner/live-render'
import { getThemeConfig } from '@/lib/partner/theme'
import PartnerRenderClient from './PartnerRenderClient'

/**
 * /partner-render/[clio_session_ref]
 *
 * B2B-03 — replaces the B2B-02 placeholder stub (architecture.md Section 5,
 * "Why partner_sessions is a new table"; Requirement Doc Section 4.C/6.6).
 * Public, no Clerk session — loaded headlessly by the meeting-bot's browser,
 * exactly as B2B-02 already built (`dispatchMeetingBot()` passes this URL to
 * `createBot()`, unchanged by this document).
 *
 * Zero Clio branding: every screen state below is themed by the partner's
 * own Level A config (falling back to Clio's neutral default tokens only
 * when unconfigured, never to Clio's own brand colors/wordmark).
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

export default async function PartnerRenderPage({
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

  const theme = await getThemeConfig(session.partnerAccountId)
  const result = await resolveLiveSessionRender(session)

  if (result.status !== 'ok') {
    return <ThemedMessage primaryColor={theme.primaryColor} message="This session's content isn't available right now." />
  }

  return (
    <PartnerRenderClient
      clioSessionRef={session.id}
      sections={result.sections}
      humeConfigId={result.humeConfigId}
    />
  )
}
