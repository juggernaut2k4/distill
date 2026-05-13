'use client'

import { motion } from 'framer-motion'
import { MessageSquare, Mail, Smartphone, Bell } from 'lucide-react'

export default function MessagesComingSoon() {
  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] text-center px-4">
      <motion.div
        initial={{ opacity: 0, y: 24 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        className="max-w-md"
      >
        {/* Icon cluster */}
        <div className="relative w-20 h-20 mx-auto mb-8">
          <div className="w-20 h-20 rounded-2xl bg-purple-950/40 border border-purple-800/30 flex items-center justify-center">
            <MessageSquare size={36} className="text-[#7C3AED]" />
          </div>
          <div className="absolute -top-2 -right-2 w-7 h-7 rounded-full bg-[#111111] border border-[#222] flex items-center justify-center">
            <Mail size={12} className="text-[#06B6D4]" />
          </div>
          <div className="absolute -bottom-2 -left-2 w-7 h-7 rounded-full bg-[#111111] border border-[#222] flex items-center justify-center">
            <Smartphone size={12} className="text-[#F59E0B]" />
          </div>
        </div>

        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-cyan-950/30 border border-cyan-800/30 mb-5">
          <Bell size={12} className="text-[#06B6D4]" />
          <span className="text-xs font-semibold text-[#67E8F9] uppercase tracking-wider">Coming soon</span>
        </div>

        <h1 className="text-3xl font-bold text-white mb-3">Message history</h1>
        <p className="text-[#94A3B8] leading-relaxed mb-6">
          All your daily insights, weekly digests, and session reminders in one place.
          Your AI readiness journey, fully searchable.
        </p>

        <div className="grid grid-cols-3 gap-3 text-left">
          {[
            { icon: Mail, label: 'Daily insights', desc: 'Every email ever sent' },
            { icon: Smartphone, label: 'SMS threads', desc: 'Your feedback history' },
            { icon: Bell, label: 'Reminders', desc: 'Session notifications' },
          ].map(({ icon: Icon, label, desc }) => (
            <div
              key={label}
              className="p-3 rounded-xl bg-[#111111] border border-[#1A1A1A]"
            >
              <Icon size={16} className="text-[#475569] mb-2" />
              <p className="text-xs font-semibold text-white mb-0.5">{label}</p>
              <p className="text-[10px] text-[#475569]">{desc}</p>
            </div>
          ))}
        </div>

        <p className="text-xs text-[#333] mt-8">
          Your insights are being delivered daily — check your email or SMS.
        </p>
      </motion.div>
    </div>
  )
}
