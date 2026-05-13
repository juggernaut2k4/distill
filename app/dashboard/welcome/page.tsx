'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { motion, AnimatePresence } from 'framer-motion'
import { CheckCircle } from 'lucide-react'

const STEPS = [
  'Activating your plan...',
  'Setting up your profile...',
  'Preparing your learning engine...',
  'Almost ready...',
]

export default function WelcomePage() {
  const router = useRouter()
  const [stepIndex, setStepIndex] = useState(0)
  const [done, setDone] = useState(false)

  useEffect(() => {
    let i = 0
    const interval = setInterval(() => {
      i++
      if (i < STEPS.length) {
        setStepIndex(i)
      } else {
        clearInterval(interval)
        setDone(true)
        setTimeout(() => router.push('/topics'), 1200)
      }
    }, 900)

    return () => clearInterval(interval)
  }, [router])

  return (
    <div className="min-h-screen bg-[#080808] flex flex-col items-center justify-center px-6">
      {/* Pulsing logo */}
      <div className="relative w-24 h-24 mb-10">
        <motion.div
          animate={{ scale: [1, 1.5, 1], opacity: [0.5, 0, 0.5] }}
          transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut' }}
          className="absolute inset-0 rounded-full bg-[#7C3AED]"
        />
        <div className="relative w-24 h-24 rounded-full bg-[#7C3AED] flex items-center justify-center shadow-lg shadow-purple-900/50">
          <span className="text-3xl font-extrabold text-white tracking-tight">C</span>
        </div>
      </div>

      <AnimatePresence mode="wait">
        {!done ? (
          <motion.div
            key="steps"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className="text-center"
          >
            <h2 className="text-3xl font-bold text-white mb-3">Setting up Clio for you</h2>
            <AnimatePresence mode="wait">
              <motion.p
                key={stepIndex}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -6 }}
                transition={{ duration: 0.3 }}
                className="text-[#94A3B8] text-lg"
              >
                {STEPS[stepIndex]}
              </motion.p>
            </AnimatePresence>

            {/* Progress dots */}
            <div className="mt-8 flex gap-2 justify-center">
              {STEPS.map((_, i) => (
                <motion.div
                  key={i}
                  animate={{
                    backgroundColor: i <= stepIndex ? '#7C3AED' : '#222222',
                    scale: i === stepIndex ? 1.3 : 1,
                  }}
                  transition={{ duration: 0.3 }}
                  className="w-2 h-2 rounded-full"
                />
              ))}
            </div>
          </motion.div>
        ) : (
          <motion.div
            key="done"
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            className="text-center"
          >
            <motion.div
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              transition={{ type: 'spring', stiffness: 300 }}
              className="flex justify-center mb-4"
            >
              <CheckCircle size={48} className="text-[#10B981]" />
            </motion.div>
            <h2 className="text-3xl font-bold text-white mb-2">You&apos;re all set!</h2>
            <p className="text-[#94A3B8]">Let&apos;s build your learning plan...</p>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
