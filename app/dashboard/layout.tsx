import { auth } from '@clerk/nextjs/server'
import { redirect } from 'next/navigation'
import { headers } from 'next/headers'
import { createSupabaseAdminClient } from '@/lib/supabase'

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  // welcome page is exempt — user arrives here right after Stripe checkout
  // before the webhook has a chance to update subscription_status
  const pathname = headers().get('x-pathname') ?? ''
  if (pathname.startsWith('/dashboard/welcome')) {
    return <>{children}</>
  }

  const { userId } = auth()
  if (!userId) redirect('/sign-in')

  const supabase = createSupabaseAdminClient()
  const { data: user } = await supabase
    .from('users')
    .select('subscription_status, plan_tier')
    .eq('id', userId)
    .single()

  const hasAccess =
    user?.subscription_status === 'active' ||
    user?.subscription_status === 'trialing'

  if (!hasAccess) {
    redirect('/pricing')
  }

  return <>{children}</>
}
