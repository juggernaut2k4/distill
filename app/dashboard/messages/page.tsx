import { auth } from '@clerk/nextjs/server'
import { redirect } from 'next/navigation'
import { createSupabaseAdminClient } from '@/lib/supabase'
import DashboardShell from '@/components/dashboard/DashboardShell'
import MessagesClient from './MessagesClient'
import type { MessageItem } from '@/app/api/messages/route'

export default async function MessagesPage() {
  const { userId } = auth()
  if (!userId) redirect('/sign-in')

  const supabase = createSupabaseAdminClient()

  // Fetch user record (needed for DashboardShell)
  const { data: user } = await supabase
    .from('users')
    .select('id, email, plan_tier, plan_approved')
    .eq('id', userId)
    .single()

  if (!user) redirect('/onboarding')

  // Fetch last 30 delivery_log entries with joined content_items
  const { data: deliveries } = await supabase
    .from('delivery_log')
    .select(
      `
      id,
      sent_at,
      channel,
      feedback,
      content_items (
        body_text,
        type
      )
    `
    )
    .eq('user_id', userId)
    .order('sent_at', { ascending: false })
    .limit(30)

  // Supabase infers content_items as an array type, but a FK join from the many side
  // (delivery_log) to the one side (content_items) returns a single object at runtime.
  const messages: MessageItem[] = (deliveries ?? []).map((row) => {
    const ci = row.content_items as unknown as { body_text: string; type: string } | null
    return {
      id: row.id as string,
      sent_at: row.sent_at as string,
      channel: row.channel as 'email' | 'sms',
      feedback: (row.feedback as 'positive' | 'negative' | null) ?? null,
      content: ci ? { body_text: ci.body_text, type: ci.type } : null,
    }
  })

  return (
    <DashboardShell user={user} activeNav="/dashboard/messages">
      <MessagesClient initialMessages={messages} />
    </DashboardShell>
  )
}
