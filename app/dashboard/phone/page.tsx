import { auth } from '@clerk/nextjs/server'
import { redirect } from 'next/navigation'
import { createSupabaseAdminClient } from '@/lib/supabase'
import DashboardShell from '@/components/dashboard/DashboardShell'
import PhoneClient from './PhoneClient'

export default async function PhonePage() {
  const { userId } = auth()
  if (!userId) redirect('/sign-in')

  const supabase = createSupabaseAdminClient()

  const { data: user } = await supabase
    .from('users')
    .select('*')
    .eq('id', userId)
    .single()

  if (!user) redirect('/onboarding')

  return (
    <DashboardShell user={user} activeNav="/dashboard/phone">
      <div className="max-w-xl">
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-white">Phone Setup</h1>
          <p className="text-[#475569] text-sm mt-1">
            Receive insights and session reminders via SMS
          </p>
        </div>
        <PhoneClient currentPhone={user.phone ?? null} />
      </div>
    </DashboardShell>
  )
}
