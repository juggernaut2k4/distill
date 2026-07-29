import { createSupabaseAdminClient } from '@/lib/supabase'
import TemplateRenderer from '@/components/templates/TemplateRenderer'
import type { TemplateSection } from '@/lib/templates/types'

/**
 * /showcase-render/[visualizationId]
 *
 * B2B-31 (docs/specs/B2B-31-requirement-document.md §6.5). Public, zero
 * Clerk import anywhere in this file — mirrors
 * `app/partner-render/[clio_session_ref]/page.tsx`'s own "public, no Clerk
 * session — loaded headlessly by the meeting-bot's browser" precedent
 * exactly. Structurally read-only: no POST/write capability of any kind.
 * Malformed UUID and "no matching row" render the identical
 * `NotFoundMessage`, matching this codebase's existing no-info-leak
 * convention (same shape `partner-render`'s own `ThemedMessage` uses for its
 * not-found states).
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function NotFoundMessage() {
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
            border: '3px solid #7C3AED',
            borderTopColor: 'transparent',
          }}
        />
        <p style={{ fontSize: 14, lineHeight: 1.6, maxWidth: 420 }}>This visualization could not be found.</p>
      </div>
    </div>
  )
}

export default async function ShowcaseRenderPage({ params }: { params: { visualizationId: string } }) {
  if (!UUID_RE.test(params.visualizationId)) {
    return <NotFoundMessage />
  }

  const supabase = createSupabaseAdminClient()
  const { data } = await supabase
    .from('partner_showcase_visualizations')
    .select('template_section')
    .eq('id', params.visualizationId)
    .maybeSingle()

  if (!data?.template_section) {
    return <NotFoundMessage />
  }

  const section = data.template_section as TemplateSection
  return (
    <div style={{ position: 'fixed', inset: 0, background: '#080808' }}>
      <TemplateRenderer section={section} isActive={true} />
    </div>
  )
}
