import { auth } from '@clerk/nextjs/server'
import { redirect } from 'next/navigation'
import { createSupabaseAdminClient } from '@/lib/supabase'
import { getTotalMinutesConsumed } from '@/lib/session-billing'
import { Card } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { ArrowRight, CheckCircle, Clock } from 'lucide-react'
import Link from 'next/link'
import ManageBillingButton from './ManageBillingButton'
import TopUpButton from './TopUpButton'

const PLAN_FEATURES: Record<string, string[]> = {
  free: ['1 email insight/day', 'Basic dashboard', '3-day trial — upgrade to unlock sessions'],
  starter: ['Email + SMS daily', '30 coaching mins/month', 'Weekly digest', 'Feedback adaptation', '$0.40/min extra'],
  pro: ['Everything in Starter', '70 coaching mins/month', 'AI Readiness Score', 'Ask Anything SMS', '$0.39/min extra'],
  executive: ['Everything in Pro', '150 coaching mins/month', 'Dedicated phone number', 'Priority scheduling', '$0.38/min extra'],
}

export default async function BillingPage() {
  const { userId } = auth()
  if (!userId) redirect('/sign-in')

  const supabase = createSupabaseAdminClient()

  // BILLING-LEDGER-01 Section 4.2 — all-time total is a secondary stat, not
  // load-bearing: if it fails, the page falls back to rendering exactly as it
  // does today, without the new line at all (fail silent, not fail loud).
  const [{ data: user }, totalMinutesConsumed] = await Promise.all([
    supabase
      .from('users')
      .select('plan_tier, subscription_status, stripe_customer_id, email, minutes_balance')
      .eq('id', userId)
      .single(),
    getTotalMinutesConsumed(userId).catch((err) => {
      console.error('[billing-page] getTotalMinutesConsumed failed (non-fatal):', err)
      return null
    }),
  ])

  if (!user) redirect('/onboarding')

  const planTier = user.plan_tier ?? 'free'
  const isActive = user.subscription_status === 'active' || user.subscription_status === 'trialing'
  const features = PLAN_FEATURES[planTier] ?? PLAN_FEATURES.free
  const minutesBalance = user.minutes_balance ?? 0

  return (
    <div className="min-h-screen bg-[#080808] p-8">
      <div className="max-w-2xl mx-auto">
        <h1 className="text-2xl font-bold text-white mb-2">Billing</h1>
        <p className="text-[#475569] mb-8">Manage your subscription and payment method.</p>

        {/* Current plan */}
        <Card className="p-6 mb-5">
          <div className="flex items-start justify-between mb-5">
            <div>
              <p className="text-sm text-[#475569] mb-1">Current plan</p>
              <p className="text-2xl font-bold text-white capitalize">{planTier}</p>
            </div>
            <Badge variant={isActive ? 'green' : 'amber'}>
              {user.subscription_status === 'trialing' ? 'Trial' : isActive ? 'Active' : 'Inactive'}
            </Badge>
          </div>

          <ul className="space-y-2 mb-6">
            {features.map((feature) => (
              <li key={feature} className="flex items-center gap-2 text-sm text-[#94A3B8]">
                <CheckCircle size={15} className="text-[#7C3AED]" />
                {feature}
              </li>
            ))}
          </ul>

          <div className="flex flex-col sm:flex-row gap-3">
            {user.stripe_customer_id && <ManageBillingButton />}
            {(planTier === 'free' || planTier === 'starter') && (
              <Link href="/dashboard/upgrade" className="w-full sm:w-auto">
                <Button size="md" className="w-full gap-1">
                  Upgrade plan <ArrowRight size={14} />
                </Button>
              </Link>
            )}
          </div>
        </Card>

        {/* Coaching minutes */}
        {planTier !== 'free' && (
          <Card className="p-6 mb-5">
            <div className="flex items-center justify-between mb-4">
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <Clock size={16} className="text-[#06B6D4]" />
                  <p className="text-sm font-semibold text-white">Coaching Minutes</p>
                </div>
                <p className="text-3xl font-bold text-[#06B6D4]">
                  {minutesBalance}
                  <span className="text-base font-normal text-[#475569] ml-1">min remaining</span>
                </p>
              </div>
              <TopUpButton currentBalance={minutesBalance} />
            </div>
            <div className="text-xs text-[#475569]">
              Minutes are deducted at the end of each coaching session. They never expire.
            </div>

            {/* BILLING-LEDGER-01 Section 4.2 — all-time total consumed */}
            {totalMinutesConsumed !== null && (
              <div className="mt-3 pt-3 border-t border-[#222222]">
                <p className="text-[13px] text-[#94A3B8]">
                  {totalMinutesConsumed === 0 ? (
                    <span className="text-[#475569]">
                      Total consumed to date: 0 min — you haven&apos;t started a coaching session yet.
                    </span>
                  ) : (
                    <>Total consumed to date: {totalMinutesConsumed} min</>
                  )}
                </p>
              </div>
            )}
          </Card>
        )}

        {/* Invoice note */}
        <p className="text-xs text-[#475569] text-center">
          Billing is managed securely through Stripe. Clio does not store payment details.
        </p>
      </div>
    </div>
  )
}

