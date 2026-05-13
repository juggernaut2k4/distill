'use client'

import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { CheckCircle, Phone, ShieldCheck } from 'lucide-react'

type Step = 'entry' | 'verify' | 'success'

interface PhoneClientProps {
  currentPhone: string | null
}

function maskPhone(phone: string): string {
  // Show last 4 digits only: +1 •••-•••-1234
  const digits = phone.replace(/\D/g, '')
  const last4 = digits.slice(-4)
  const countryCode = phone.startsWith('+') ? phone.slice(0, phone.indexOf(digits.charAt(0))) : '+'
  return `${countryCode}•••-•••-${last4}`
}

export default function PhoneClient({ currentPhone }: PhoneClientProps) {
  const [step, setStep] = useState<Step>('entry')
  const [phone, setPhone] = useState('')
  const [code, setCode] = useState('')
  const [loading, setLoading] = useState(false)
  const [errorMsg, setErrorMsg] = useState('')
  const [showUpdate, setShowUpdate] = useState(false)

  // Already-verified state
  if (currentPhone && !showUpdate) {
    return (
      <div className="bg-[#111111] border border-[#222222] rounded-xl p-8">
        <div className="flex items-center gap-4 mb-6">
          <div className="w-12 h-12 rounded-full bg-[#10B981]/15 border border-[#10B981] flex items-center justify-center flex-shrink-0">
            <CheckCircle size={22} className="text-[#10B981]" />
          </div>
          <div>
            <p className="text-white font-semibold">Phone verified</p>
            <p className="text-[#94A3B8] text-sm">{maskPhone(currentPhone)}</p>
          </div>
        </div>
        <p className="text-[#475569] text-sm mb-6">
          SMS delivery is active. You&apos;ll receive insights and session reminders via text.
        </p>
        <button
          onClick={() => setShowUpdate(true)}
          className="text-[#7C3AED] text-sm font-medium hover:underline"
        >
          Update phone number
        </button>
      </div>
    )
  }

  async function handleSendOTP(e: React.FormEvent) {
    e.preventDefault()
    setErrorMsg('')
    setLoading(true)

    try {
      const res = await fetch('/api/phone/send-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone }),
      })

      const data = await res.json() as { success?: boolean; error?: string }

      if (!res.ok) {
        setErrorMsg(data.error ?? 'Failed to send code. Please try again.')
        return
      }

      setStep('verify')
    } catch {
      setErrorMsg('Network error. Please check your connection.')
    } finally {
      setLoading(false)
    }
  }

  async function handleVerify(e: React.FormEvent) {
    e.preventDefault()
    setErrorMsg('')
    setLoading(true)

    try {
      const res = await fetch('/api/phone/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone, code }),
      })

      const data = await res.json() as { success?: boolean; error?: string }

      if (!res.ok) {
        setErrorMsg(data.error ?? 'Invalid or expired code. Please try again.')
        return
      }

      setStep('success')
    } catch {
      setErrorMsg('Network error. Please check your connection.')
    } finally {
      setLoading(false)
    }
  }

  async function handleResend() {
    setErrorMsg('')
    setLoading(true)
    try {
      await fetch('/api/phone/send-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone }),
      })
    } finally {
      setLoading(false)
    }
  }

  return (
    <AnimatePresence mode="wait">
      {step === 'entry' && (
        <motion.div
          key="entry"
          initial={{ opacity: 0, x: 24 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: -24 }}
          transition={{ duration: 0.2 }}
        >
          <div className="bg-[#111111] border border-[#222222] rounded-xl p-8">
            <div className="flex items-center gap-3 mb-6">
              <Phone size={20} className="text-[#7C3AED]" />
              <h2 className="text-white font-semibold text-lg">Set Up SMS Delivery</h2>
            </div>
            <p className="text-[#94A3B8] text-sm mb-8 leading-relaxed">
              Add your mobile number to receive insights and session reminders via SMS.
            </p>

            <form onSubmit={handleSendOTP} className="space-y-4">
              <div>
                <label htmlFor="phone" className="block text-sm font-medium text-[#94A3B8] mb-2">
                  Mobile number
                </label>
                <input
                  id="phone"
                  type="tel"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="+1 555 000 0000"
                  required
                  className="w-full bg-[#1A1A1A] border border-[#333333] text-white rounded-lg px-4 py-3 text-sm placeholder-[#475569] focus:outline-none focus:border-[#7C3AED] transition-colors"
                />
                <p className="text-[#475569] text-xs mt-1">International format: +1 555 000 0000</p>
              </div>

              {errorMsg && (
                <p className="text-[#EF4444] text-sm">{errorMsg}</p>
              )}

              <button
                type="submit"
                disabled={loading || !phone}
                className="w-full bg-[#7C3AED] text-white font-semibold py-3 rounded-lg text-sm transition-opacity disabled:opacity-50 hover:opacity-90"
              >
                {loading ? 'Sending...' : 'Send verification code'}
              </button>
            </form>
          </div>
        </motion.div>
      )}

      {step === 'verify' && (
        <motion.div
          key="verify"
          initial={{ opacity: 0, x: 24 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: -24 }}
          transition={{ duration: 0.2 }}
        >
          <div className="bg-[#111111] border border-[#222222] rounded-xl p-8">
            <div className="flex items-center gap-3 mb-6">
              <ShieldCheck size={20} className="text-[#7C3AED]" />
              <h2 className="text-white font-semibold text-lg">Enter verification code</h2>
            </div>
            <p className="text-[#94A3B8] text-sm mb-8">
              We sent a 6-digit code to{' '}
              <span className="text-white font-medium">{phone}</span>.
            </p>

            <form onSubmit={handleVerify} className="space-y-4">
              <div>
                <label htmlFor="code" className="block text-sm font-medium text-[#94A3B8] mb-2">
                  Verification code
                </label>
                <input
                  id="code"
                  type="text"
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  placeholder="000000"
                  maxLength={6}
                  required
                  className="w-full bg-[#1A1A1A] border border-[#333333] text-white rounded-lg px-4 py-3 text-sm placeholder-[#475569] focus:outline-none focus:border-[#7C3AED] transition-colors text-center text-2xl tracking-[0.4em] font-mono"
                />
              </div>

              {errorMsg && (
                <p className="text-[#EF4444] text-sm">{errorMsg}</p>
              )}

              <button
                type="submit"
                disabled={loading || code.length !== 6}
                className="w-full bg-[#7C3AED] text-white font-semibold py-3 rounded-lg text-sm transition-opacity disabled:opacity-50 hover:opacity-90"
              >
                {loading ? 'Verifying...' : 'Verify'}
              </button>

              <button
                type="button"
                onClick={handleResend}
                disabled={loading}
                className="w-full text-[#475569] text-sm hover:text-[#94A3B8] transition-colors py-2"
              >
                Resend code
              </button>
            </form>
          </div>
        </motion.div>
      )}

      {step === 'success' && (
        <motion.div
          key="success"
          initial={{ opacity: 0, scale: 0.96 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.25 }}
        >
          <div className="bg-[#111111] border border-[#10B981]/30 rounded-xl p-8 text-center">
            <motion.div
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              transition={{ type: 'spring', stiffness: 200, damping: 15, delay: 0.1 }}
              className="w-16 h-16 rounded-full bg-[#10B981]/15 border-2 border-[#10B981] flex items-center justify-center mx-auto mb-6"
            >
              <CheckCircle size={28} className="text-[#10B981]" />
            </motion.div>

            <h2 className="text-white font-bold text-xl mb-3">Phone verified!</h2>
            <p className="text-[#94A3B8] text-sm leading-relaxed mb-8">
              SMS delivery is now active. You&apos;ll receive insights and session reminders via SMS.
            </p>

            <a
              href="/dashboard"
              className="inline-block bg-[#7C3AED] text-white font-semibold px-8 py-3 rounded-lg text-sm hover:opacity-90 transition-opacity"
            >
              Back to Dashboard →
            </a>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
