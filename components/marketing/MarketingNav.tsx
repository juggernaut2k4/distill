'use client'

import Link from 'next/link'
import { motion } from 'framer-motion'
import { ArrowRight } from 'lucide-react'

export default function MarketingNav() {
  return (
    <motion.header
      initial={{ opacity: 0, y: -8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4 }}
      className="fixed top-0 left-0 right-0 z-50 border-b border-[#111111]"
      style={{ background: 'rgba(8,8,8,0.85)', backdropFilter: 'blur(12px)' }}
    >
      <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
        {/* Logo */}
        <Link href="/" className="flex items-center gap-1.5 flex-shrink-0">
          <span className="text-lg font-extrabold tracking-tight text-white">Clio</span>
          <span className="text-xs text-[#7C3AED] font-bold uppercase tracking-widest">AI</span>
        </Link>

        {/* Center nav */}
        <nav className="hidden md:flex items-center gap-8">
          <Link
            href="/#how-it-works"
            className="text-sm text-[#475569] hover:text-white transition-colors"
          >
            How it works
          </Link>
        </nav>

        {/* Right actions */}
        <div className="flex items-center gap-3">
          <Link
            href="/sign-in"
            className="text-sm text-[#94A3B8] hover:text-white transition-colors px-3 py-2"
          >
            Log in
          </Link>
          <Link
            href="/partner-signup"
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-[#7C3AED] hover:bg-[#6D28D9] text-white text-sm font-semibold transition-colors"
          >
            Get started
            <ArrowRight size={14} />
          </Link>
        </div>
      </div>
    </motion.header>
  )
}
