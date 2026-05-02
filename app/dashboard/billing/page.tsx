import { auth } from '@clerk/nextjs/server'
import { redirect } from 'next/navigation'
import { createSupabaseAdminClient } from '@/lib/supabase'
import { Card } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { ArrowRight, CheckCircle } from 'lucide-react'
import Link from 'next/link'

const PLAN_FEATURES: Record<string, string[]> = {
  free: ['7-day free trial', '1 email/day', 'Onboarding plan'],
  starter: ['1 email/day', 'Personalized plan', 'Weekly digest', 'Feedback adaptation'],
  pro: ['Email + SMS daily', 'AI Readiness Score', 'Ask Anything SMS', 'Adaptive content'],
  executive: ['Everything in Pro', 'Dedicated Twilio number', 'Meeting Prep Mode', 'Progress Dashboard'],
}

export default async function BillingPage() {
  const { userId } = auth()
  if (!userId) redirect('/sign-in')

  const supabase = createSupabaseAdminClient()
  const { data: user } = await supabase
    .from('users')
    .select('plan_tier, subscription_status, stripe_customer_id, email')
    .eq('id', userId)
    .single()

  if (!user) redirect('/onboarding')

  const planTier = user.plan_tier ?? 'free'
  const isActive = user.subscription_status === 'active'
  const features = PLAN_FEATURES[planTier] ?? PLAN_FEATURES.free

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
              {isActive ? 'Active' : 'Inactive'}
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
            {user.stripe_customer_id && (
              <ManageBillingButton />
            )}
            {(planTier === 'free' || planTier === 'starter') && (
              <Link href="/pricing" className="w-full sm:w-auto">
                <Button size="md" className="w-full gap-1">
                  Upgrade plan <ArrowRight size={14} />
                </Button>
              </Link>
            )}
          </div>
        </Card>

        {/* Invoice note */}
        <p className="text-xs text-[#475569] text-center">
          Billing is managed securely through Stripe. Distill does not store payment details.
        </p>
      </div>
    </div>
  )
}

function ManageBillingButton() {
  async function handleManageBilling() {
    'use server'
    // This is handled client-side via portal route
  }

  return (
    <form action="/api/portal" method="POST">
      <Button type="submit" variant="secondary" size="md">
        Manage billing
      </Button>
    </form>
  )
}
