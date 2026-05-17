'use client'

import { useState } from 'react'
import { useClerk } from '@clerk/nextjs'
import { useRouter } from 'next/navigation'
import { motion } from 'framer-motion'
import { LogOut, AlertTriangle, CheckCircle, Loader, ShieldOff, User } from 'lucide-react'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'

interface Props {
  email: string
  planTier: string
  subscriptionStatus: string
  hasSubscription: boolean
}

const PLAN_LABEL: Record<string, string> = {
  free: 'Free',
  starter: 'Starter',
  pro: 'Pro',
  executive: 'Executive',
}

export default function SettingsClient({ email, planTier, subscriptionStatus, hasSubscription }: Props) {
  const { signOut } = useClerk()
  const router = useRouter()

  const [cancelState, setCancelState] = useState<'idle' | 'confirm' | 'loading' | 'done'>('idle')
  const [cancelError, setCancelError] = useState<string | null>(null)

  const isCanceling = subscriptionStatus === 'canceling'
  const isActive = subscriptionStatus === 'active' || subscriptionStatus === 'trialing'
  const canUnsubscribe = hasSubscription && isActive && planTier !== 'free'

  async function handleCancelSubscription() {
    setCancelState('loading')
    setCancelError(null)
    try {
      const res = await fetch('/api/subscription/cancel', { method: 'POST' })
      const data = await res.json() as { ok?: boolean; error?: string }
      if (!res.ok || !data.ok) {
        setCancelError(data.error ?? 'Something went wrong. Please try again.')
        setCancelState('confirm')
        return
      }
      setCancelState('done')
    } catch {
      setCancelError('Network error — please try again.')
      setCancelState('confirm')
    }
  }

  async function handleSignOut() {
    await signOut()
    router.push('/')
  }

  return (
    <div className="max-w-xl space-y-6">
      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}>
        <h1 className="text-2xl font-bold text-white mb-1">Settings</h1>
        <p className="text-sm text-[#475569]">Manage your account and subscription</p>
      </motion.div>

      {/* Account */}
      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 }}>
        <h2 className="text-xs font-semibold text-[#475569] uppercase tracking-wider mb-3">Account</h2>
        <Card>
          <div className="divide-y divide-[#1A1A1A]">
            <div className="flex items-center gap-3 p-4">
              <User size={16} className="text-[#7C3AED] flex-shrink-0" />
              <div>
                <p className="text-xs text-[#475569] mb-0.5">Email</p>
                <p className="text-sm font-semibold text-white">{email}</p>
              </div>
            </div>
            <div className="flex items-center justify-between p-4">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-lg bg-purple-950/40 border border-purple-800/30 flex items-center justify-center">
                  <span className="text-xs font-bold text-[#A855F7]">{PLAN_LABEL[planTier]?.[0] ?? 'F'}</span>
                </div>
                <div>
                  <p className="text-xs text-[#475569] mb-0.5">Current plan</p>
                  <p className="text-sm font-semibold text-white">
                    {PLAN_LABEL[planTier] ?? planTier}
                    {isCanceling && (
                      <span className="ml-2 text-xs text-[#F59E0B] font-normal">· cancels at period end</span>
                    )}
                  </p>
                </div>
              </div>
            </div>
          </div>
        </Card>
      </motion.div>

      {/* Sign out */}
      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}>
        <h2 className="text-xs font-semibold text-[#475569] uppercase tracking-wider mb-3">Session</h2>
        <Card className="p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-semibold text-white">Sign out</p>
              <p className="text-xs text-[#475569] mt-0.5">You'll be returned to the home page</p>
            </div>
            <Button variant="secondary" className="gap-2" onClick={handleSignOut}>
              <LogOut size={14} />
              Sign out
            </Button>
          </div>
        </Card>
      </motion.div>

      {/* Subscription / Unsubscribe */}
      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15 }}>
        <h2 className="text-xs font-semibold text-[#475569] uppercase tracking-wider mb-3">Subscription</h2>

        {cancelState === 'done' ? (
          <Card className="p-4">
            <div className="flex items-start gap-3">
              <CheckCircle size={16} className="text-[#10B981] flex-shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-semibold text-white">Subscription cancelled</p>
                <p className="text-xs text-[#475569] mt-1">
                  You'll keep full access until your current billing period ends. No further charges will be made.
                </p>
              </div>
            </div>
          </Card>
        ) : isCanceling ? (
          <Card className="p-4">
            <div className="flex items-start gap-3">
              <AlertTriangle size={16} className="text-[#F59E0B] flex-shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-semibold text-white">Cancellation scheduled</p>
                <p className="text-xs text-[#475569] mt-1">
                  Your subscription will end at the current billing period. No further charges will be made.
                </p>
              </div>
            </div>
          </Card>
        ) : !canUnsubscribe ? (
          <Card className="p-4">
            <p className="text-sm text-[#475569]">
              {planTier === 'free'
                ? "You're on the free plan — no subscription to cancel."
                : 'No active subscription found.'}
            </p>
          </Card>
        ) : cancelState === 'idle' ? (
          <Card className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-semibold text-white">Cancel subscription</p>
                <p className="text-xs text-[#475569] mt-0.5">
                  You'll keep access until the end of your billing period
                </p>
              </div>
              <Button variant="danger" className="gap-2" onClick={() => setCancelState('confirm')}>
                <ShieldOff size={14} />
                Unsubscribe
              </Button>
            </div>
          </Card>
        ) : cancelState === 'confirm' ? (
          <Card className="p-4 space-y-4">
            <div className="flex items-start gap-3">
              <AlertTriangle size={16} className="text-[#EF4444] flex-shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-semibold text-white">Are you sure?</p>
                <p className="text-xs text-[#475569] mt-1">
                  Your subscription will be cancelled and Stripe will stop all future charges.
                  You'll keep full access until your current billing period ends.
                </p>
                {cancelError && (
                  <p className="text-xs text-red-400 mt-2">{cancelError}</p>
                )}
              </div>
            </div>
            <div className="flex items-center gap-3">
              <Button variant="danger" className="gap-2" onClick={handleCancelSubscription}>
                Yes, cancel my subscription
              </Button>
              <Button variant="ghost" onClick={() => { setCancelState('idle'); setCancelError(null) }}>
                Keep my plan
              </Button>
            </div>
          </Card>
        ) : (
          <Card className="p-4 flex items-center gap-3">
            <Loader size={15} className="text-[#475569] animate-spin flex-shrink-0" />
            <p className="text-sm text-[#475569]">Cancelling subscription...</p>
          </Card>
        )}
      </motion.div>
    </div>
  )
}
