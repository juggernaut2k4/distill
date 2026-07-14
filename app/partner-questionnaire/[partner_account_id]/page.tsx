import { z } from 'zod'
import { getPublishedQuestionnaire } from '@/lib/partner/questionnaire'
import { getThemeConfig } from '@/lib/partner/theme'
import QuestionnaireClient from './QuestionnaireClient'

/**
 * GET /partner-questionnaire/[partner_account_id]
 *
 * Requirement Doc Section 4.B/3 — end-user questionnaire render. No auth
 * (Clio has no end-user-identity model). Renders the partner's `published`
 * questionnaire exactly as authored, styled entirely by the partner's Level
 * A theme config.
 */
export default async function PartnerQuestionnairePage({
  params,
}: {
  params: { partner_account_id: string }
}) {
  const partnerAccountId = params.partner_account_id

  if (!z.string().uuid().safeParse(partnerAccountId).success) {
    return <NeutralMessage message="This page could not be found." />
  }

  const [questionnaire, theme] = await Promise.all([
    getPublishedQuestionnaire(partnerAccountId),
    getThemeConfig(partnerAccountId),
  ])

  if (!questionnaire) {
    return <NeutralMessage message="This form isn't available right now." />
  }

  return <QuestionnaireClient partnerAccountId={partnerAccountId} questionnaire={questionnaire} theme={theme} />
}

function NeutralMessage({ message }: { message: string }) {
  return (
    <div
      style={{
        minHeight: '100vh',
        width: '100vw',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: '#ffffff',
        color: '#111111',
        fontFamily: 'system-ui, sans-serif',
      }}
    >
      <p style={{ fontSize: 14 }}>{message}</p>
    </div>
  )
}
