'use client'

import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { X, Zap, CheckCircle } from 'lucide-react'
import { Button } from './Button'

interface TopUpPack {
  minutes: number
  price: number
  label: string
  popular?: boolean
}

const PACKS: TopUpPack[] = [
  { minutes: 60,  price: 15, label: '60 min pack' },
  { minutes: 120, price: 25, label: '2 hour pack', popular: true },
  { minutes: 300, price: 55, label: '5 hour pack' },
]

interface TopUpModalProps {
  open: boolean
  onClose: () => void
  currentBalance: number
}

export function TopUpModal({ open, onClose, currentBalance }: TopUpModalProps) {
  const [selected, setSelected] = useState<number>(120)
  const [loading, setLoading] = useState(false)
  const [done, setDone] = useState(false)

  async function handlePurchase() {
    setLoading(true)
    try {
      const res = await fetch('/api/checkout/topup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ minutes: selected }),
      })
      const { checkoutUrl } = await res.json()
      if (checkoutUrl) {
        window.location.href = checkoutUrl
      } else {
        setDone(true)
      }
    } catch {
      setLoading(false)
    }
  }

  const pack = PACKS.find((p) => p.minutes === selected)!

  return (
    <AnimatePresence>
      {open && (
        <>
          {/* Backdrop */}
          <motion.div
            key="backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 bg-black/70 z-40"
          />

          {/* Modal */}
          <motion.div
            key="modal"
            initial={{ opacity: 0, scale: 0.95, y: 16 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 8 }}
            transition={{ duration: 0.2 }}
            className="fixed inset-0 z-50 flex items-center justify-center p-4"
          >
            <div className="w-full max-w-md bg-[#111111] border border-[#222222] rounded-2xl shadow-2xl overflow-hidden">
              {/* Header */}
              <div className="flex items-center justify-between px-6 pt-6 pb-4 border-b border-[#1A1A1A]">
                <div>
                  <div className="flex items-center gap-2 mb-0.5">
                    <Zap size={16} className="text-[#F59E0B]" />
                    <h2 className="text-lg font-bold text-white">Top up minutes</h2>
                  </div>
                  <p className="text-xs text-[#475569]">Current balance: {currentBalance} min</p>
                </div>
                <button
                  onClick={onClose}
                  className="text-[#475569] hover:text-white transition-colors rounded-lg p-1"
                >
                  <X size={18} />
                </button>
              </div>

              {done ? (
                <div className="p-8 flex flex-col items-center gap-3 text-center">
                  <CheckCircle size={40} className="text-[#10B981]" />
                  <p className="text-lg font-bold text-white">Minutes added!</p>
                  <p className="text-sm text-[#94A3B8]">Your balance has been updated.</p>
                  <Button onClick={onClose} className="mt-2">Close</Button>
                </div>
              ) : (
                <div className="p-6 space-y-4">
                  {/* Pack options */}
                  <div className="space-y-3">
                    {PACKS.map((p) => (
                      <button
                        key={p.minutes}
                        onClick={() => setSelected(p.minutes)}
                        className={`w-full flex items-center justify-between px-4 py-3.5 rounded-xl border text-left transition-all ${
                          selected === p.minutes
                            ? 'bg-purple-950/30 border-[#7C3AED]'
                            : 'bg-[#0D0D0D] border-[#222222] hover:border-[#333]'
                        }`}
                      >
                        <div className="flex items-center gap-3">
                          <div className={`w-4 h-4 rounded-full border-2 flex items-center justify-center flex-shrink-0 ${
                            selected === p.minutes ? 'border-[#7C3AED]' : 'border-[#333]'
                          }`}>
                            {selected === p.minutes && (
                              <div className="w-2 h-2 rounded-full bg-[#7C3AED]" />
                            )}
                          </div>
                          <div>
                            <p className="text-sm font-semibold text-white">{p.label}</p>
                            <p className="text-xs text-[#475569]">{p.minutes} coaching minutes</p>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          {p.popular && (
                            <span className="text-[10px] font-bold text-[#A855F7] uppercase tracking-wider px-2 py-0.5 rounded-full bg-purple-950/40 border border-purple-800/30">
                              Popular
                            </span>
                          )}
                          <span className="text-base font-bold text-white">${p.price}</span>
                        </div>
                      </button>
                    ))}
                  </div>

                  {/* Summary */}
                  <div className="px-4 py-3 rounded-xl bg-[#0D0D0D] border border-[#1A1A1A] flex items-center justify-between">
                    <p className="text-xs text-[#475569]">New balance after top-up</p>
                    <p className="text-sm font-bold text-[#10B981]">
                      {currentBalance + pack.minutes} min
                    </p>
                  </div>

                  {/* CTA */}
                  <Button
                    onClick={handlePurchase}
                    disabled={loading}
                    className="w-full gap-2 justify-center"
                    size="lg"
                  >
                    <Zap size={16} />
                    {loading ? 'Redirecting...' : `Pay $${pack.price} — Add ${pack.minutes} min`}
                  </Button>

                  <p className="text-center text-xs text-[#475569]">
                    Secured by Stripe · Minutes never expire
                  </p>
                </div>
              )}
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  )
}
