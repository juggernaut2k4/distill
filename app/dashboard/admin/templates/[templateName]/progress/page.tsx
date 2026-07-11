import { currentUser } from '@clerk/nextjs/server'
import { redirect } from 'next/navigation'
import { createSupabaseAdminClient } from '@/lib/supabase'
import DashboardShell from '@/components/dashboard/DashboardShell'
import TemplateFixProgressClient from './TemplateFixProgressClient'

interface Params { params: { templateName: string } }

// TMPL-01 (requirement doc Section 4.3) — per-template Fix Progress view.
// Auth-gated identically to the sibling /dashboard/admin/templates page
// (Clerk sign-in only); the mutating "nudge" actions inside the client
// component are further gated to the configured approver, matching that same
// page's pattern for its own mutating actions.
export default async function TemplateFixProgressPage({ params }: Params) {
  const clerkUser = await currentUser()
  if (!clerkUser) redirect('/sign-in')

  const supabase = createSupabaseAdminClient()
  const { data: user } = await supabase
    .from('users')
    .select('id, email, plan_tier, plan_approved')
    .eq('id', clerkUser.id)
    .single()

  return (
    <DashboardShell
      user={user ?? { email: clerkUser.emailAddresses[0]?.emailAddress }}
    >
      <TemplateFixProgressClient templateName={params.templateName} />
    </DashboardShell>
  )
}
