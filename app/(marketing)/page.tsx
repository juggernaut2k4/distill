'use client'

import { motion, useInView } from 'framer-motion'
import { useRef, useState } from 'react'
import Link from 'next/link'
import {
  ArrowRight, BrainCircuit, TrendingUp, Search, Zap,
  MessageSquare, CheckCircle, Mail, Smartphone, XCircle
} from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import MarketingNav from '@/components/marketing/MarketingNav'

// ─── Hero ────────────────────────────────────────────────────────────────────

function Hero() {
  return (
    <section className="relative min-h-screen flex items-center overflow-hidden">
      {/* Animated radial gradient background */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          background:
            'radial-gradient(ellipse 80% 60% at 50% -10%, rgba(124,58,237,0.25) 0%, transparent 70%)',
        }}
      />
      {/* Subtle grid */}
      <div
        className="absolute inset-0 pointer-events-none opacity-[0.03]"
        style={{
          backgroundImage:
            'linear-gradient(#ffffff 1px, transparent 1px), linear-gradient(90deg, #ffffff 1px, transparent 1px)',
          backgroundSize: '60px 60px',
        }}
      />

      <div className="relative max-w-7xl mx-auto px-6 py-32 w-full">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-16 items-center">
          {/* Left: copy */}
          <motion.div
            initial={{ opacity: 0, y: 40 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, ease: 'easeOut' }}
          >
            <div className="mb-6">
              <Badge variant="purple">AI Readiness Platform</Badge>
            </div>

            <h1 className="text-7xl lg:text-8xl font-extrabold tracking-tight text-white leading-[0.9] mb-6">
              Meet{' '}
              <span className="bg-gradient-to-r from-[#7C3AED] to-[#06B6D4] bg-clip-text text-transparent">
                Clio.
              </span>
            </h1>

            <p className="text-2xl text-[#94A3B8] mb-10 leading-relaxed">
              15 seconds a day. Zero jargon. Total confidence.
            </p>

            <div className="flex flex-col sm:flex-row gap-4 mb-10">
              <Link href="/onboarding?plan=free">
                <Button size="lg" className="gap-2">
                  Start free — 3-day trial
                  <ArrowRight size={20} />
                </Button>
              </Link>
              <a
                href="#how-it-works"
                className="inline-flex items-center justify-center px-6 py-4 text-base text-[#94A3B8] hover:text-white transition-colors"
              >
                See how it works ↓
              </a>
            </div>

            {/* Trust signals */}
            <div className="flex flex-wrap gap-6 text-sm text-[#475569]">
              {[
                { icon: Zap, text: '5-question onboarding' },
                { icon: Mail, text: 'Daily in your inbox' },
                { icon: XCircle, text: 'Cancel anytime' },
              ].map(({ icon: Icon, text }) => (
                <div key={text} className="flex items-center gap-2">
                  <Icon size={16} className="text-[#7C3AED]" />
                  <span>{text}</span>
                </div>
              ))}
            </div>
          </motion.div>

          {/* Right: phone mockup */}
          <motion.div
            initial={{ opacity: 0, x: 40 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.8, delay: 0.2, ease: 'easeOut' }}
            className="flex justify-center lg:justify-end"
          >
            <PhoneMockup />
          </motion.div>
        </div>
      </div>
    </section>
  )
}

function PhoneMockup() {
  return (
    <div
      className="relative w-64 rounded-[2.5rem] border border-[#333333] overflow-hidden shadow-2xl shadow-purple-900/20"
      style={{ background: '#111111' }}
    >
      {/* Status bar */}
      <div className="bg-[#080808] px-6 py-3 flex justify-between items-center">
        <span className="text-xs text-[#475569]">9:41</span>
        <div className="w-20 h-1.5 bg-[#1A1A1A] rounded-full" />
        <span className="text-xs text-[#475569]">●●●</span>
      </div>

      {/* Message thread */}
      <div className="px-4 py-5 space-y-3">
        <div className="flex items-center gap-2 mb-4">
          <div className="w-8 h-8 rounded-full bg-[#7C3AED] flex items-center justify-center">
            <span className="text-xs font-bold text-white">C</span>
          </div>
          <div>
            <p className="text-xs font-semibold text-white">Clio</p>
            <p className="text-xs text-[#475569]">Today 7:02 AM</p>
          </div>
        </div>

        <div className="bg-[#1A1A1A] rounded-xl rounded-tl-sm p-3">
          <p className="text-xs text-[#7C3AED] font-bold uppercase mb-1.5 tracking-wide">TIP</p>
          <p className="text-xs text-white leading-relaxed">
            Before your next AI vendor meeting, ask: &quot;Show me a before-and-after metric from a real deployment.&quot;
          </p>
          <p className="text-xs text-[#94A3B8] mt-2 leading-relaxed">
            So what? You&apos;ll cut through the hype in the first 5 minutes.
          </p>
        </div>

        <p className="text-xs text-[#475569] text-center">Reply Y if useful, N if not</p>

        <div className="flex gap-2 mt-3">
          <div className="flex-1 bg-[#10B981]/20 border border-[#10B981]/30 rounded-lg py-2 text-center">
            <span className="text-xs font-bold text-[#10B981]">Y</span>
          </div>
          <div className="flex-1 bg-[#1A1A1A] border border-[#333333] rounded-lg py-2 text-center">
            <span className="text-xs text-[#475569]">N</span>
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── Problem section ──────────────────────────────────────────────────────────

function ProblemSection() {
  const ref = useRef(null)
  const inView = useInView(ref, { once: true, margin: '-100px' })

  const problems = [
    {
      icon: BrainCircuit,
      headline: 'You can\'t separate signal from hype',
      body: 'Every AI meeting feels like a foreign language. You nod along, but can\'t tell if what\'s being proposed is brilliant or buzzword.',
    },
    {
      icon: TrendingUp,
      headline: 'Your team moves faster than you do',
      body: 'Developers and analysts are shipping AI experiments. You\'re expected to evaluate and approve them — without the context to judge.',
    },
    {
      icon: Search,
      headline: 'Vendor pitches are impossible to evaluate',
      body: 'Every AI vendor says they\'re different. Without the vocabulary, you can\'t ask the right questions or spot the right red flags.',
    },
  ]

  return (
    <section className="py-28 bg-[#080808]" ref={ref}>
      <div className="max-w-7xl mx-auto px-6">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={inView ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.6 }}
          className="text-center mb-16"
        >
          <h2 className="text-5xl font-bold text-white mb-4">Sound familiar?</h2>
          <p className="text-xl text-[#475569]">
            You didn&apos;t become a senior leader to be confused by technology.
          </p>
        </motion.div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {problems.map((problem, i) => (
            <motion.div
              key={problem.headline}
              initial={{ opacity: 0, y: 30 }}
              animate={inView ? { opacity: 1, y: 0 } : {}}
              transition={{ duration: 0.6, delay: i * 0.15 }}
            >
              <Card className="p-6 border-l-2 border-l-[#7C3AED] h-full">
                <problem.icon size={28} className="text-[#7C3AED] mb-4" />
                <h3 className="text-lg font-bold text-white mb-3">
                  {problem.headline}
                </h3>
                <p className="text-[#94A3B8] text-sm leading-relaxed">
                  {problem.body}
                </p>
              </Card>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  )
}

// ─── How it works ─────────────────────────────────────────────────────────────

function HowItWorks() {
  const ref = useRef(null)
  const inView = useInView(ref, { once: true, margin: '-100px' })

  const steps = [
    {
      icon: Zap,
      number: '1',
      title: 'Answer 5 questions',
      body: 'Tell us your role, industry, and biggest AI worry. Takes 15 seconds. Zero typing.',
    },
    {
      icon: MessageSquare,
      number: '2',
      title: 'Receive one insight daily',
      body: 'Personalized to your exact role and industry. Email or SMS. 15–20 seconds to read.',
    },
    {
      icon: TrendingUp,
      number: '3',
      title: 'Watch your score climb',
      body: 'Your AI Readiness Score grows as you engage. See measurable progress over time.',
    },
  ]

  return (
    <section id="how-it-works" className="py-32 bg-[#080808]" ref={ref}>
      <div className="max-w-7xl mx-auto px-6">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={inView ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.6 }}
          className="text-center mb-20"
        >
          <h2 className="text-5xl font-bold text-white mb-4">
            Three steps to AI confidence
          </h2>
          <p className="text-xl text-[#475569]">
            No courses. No commitment. Just one signal, every morning.
          </p>
        </motion.div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-8 relative">
          {/* Connecting line */}
          <div className="hidden md:block absolute top-10 left-1/3 right-1/3 h-px border-t border-dashed border-[#333333] -z-10" />

          {steps.map((step, i) => (
            <motion.div
              key={step.number}
              initial={{ opacity: 0, y: 30 }}
              animate={inView ? { opacity: 1, y: 0 } : {}}
              transition={{ duration: 0.6, delay: i * 0.2 }}
              className="flex flex-col items-center text-center"
            >
              <div className="w-20 h-20 rounded-full bg-[#7C3AED] flex items-center justify-center mb-6 text-2xl font-bold text-white shadow-lg shadow-purple-900/40">
                {step.number}
              </div>
              <step.icon size={24} className="text-[#06B6D4] mb-4" />
              <h3 className="text-xl font-bold text-white mb-3">{step.title}</h3>
              <p className="text-[#94A3B8] leading-relaxed">{step.body}</p>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  )
}

// ─── Testimonials ─────────────────────────────────────────────────────────────

function Testimonials() {
  const ref = useRef(null)
  const inView = useInView(ref, { once: true, margin: '-100px' })

  const testimonials = [
    {
      initials: 'A',
      color: '#7C3AED',
      quote: 'I went from dreading AI conversations to leading them. Clio gave me the vocabulary and confidence I was missing.',
      name: 'CEO, Fortune 500 Retail',
    },
    {
      initials: 'B',
      color: '#06B6D4',
      quote: 'The 15-second format is exactly right. I read it with my morning coffee. Three months in, my AI Readiness Score is 78.',
      name: 'VP Technology, Global Bank',
    },
    {
      initials: 'C',
      color: '#F59E0B',
      quote: 'The vendor evaluation frameworks alone are worth every penny. I\'ve used them in 4 different AI procurement decisions.',
      name: 'CU Lead, Consulting Firm',
    },
  ]

  return (
    <section className="py-28 bg-[#080808]" ref={ref}>
      <div className="max-w-7xl mx-auto px-6">
        <motion.h2
          initial={{ opacity: 0, y: 20 }}
          animate={inView ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.6 }}
          className="text-5xl font-bold text-white text-center mb-16"
        >
          Trusted by leaders who move fast
        </motion.h2>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {testimonials.map((t, i) => (
            <motion.div
              key={t.name}
              initial={{ opacity: 0, y: 30 }}
              animate={inView ? { opacity: 1, y: 0 } : {}}
              transition={{ duration: 0.6, delay: i * 0.15 }}
            >
              <Card className="p-6 h-full">
                <p className="text-[#94A3B8] leading-relaxed mb-6 italic">
                  &ldquo;{t.quote}&rdquo;
                </p>
                <div className="flex items-center gap-3">
                  <div
                    className="w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold text-white"
                    style={{ background: t.color }}
                  >
                    {t.initials}
                  </div>
                  <p className="text-sm font-semibold text-white">{t.name}</p>
                </div>
              </Card>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  )
}

// ─── Pricing ──────────────────────────────────────────────────────────────────

function Pricing() {
  const [annual, setAnnual] = useState(false)
  const ref = useRef(null)
  const inView = useInView(ref, { once: true, margin: '-100px' })

  const plans = [
    {
      name: 'Free',
      price: { monthly: 0, annual: 0 },
      period: 'forever',
      features: [
        '1 email insight per day',
        'Personalized onboarding plan',
        'Basic dashboard',
        '3-day free trial included',
      ],
      cta: 'Start free',
      href: '/onboarding?plan=free',
      highlight: false,
    },
    {
      name: 'Starter',
      price: { monthly: 12, annual: 99 },
      period: annual ? '/year' : '/month',
      features: [
        'Email + SMS daily insights',
        '30 coaching mins/month',
        'Weekly digest (Sundays)',
        'Feedback adaptation',
        '$0.40/min extra',
      ],
      cta: 'Get Starter',
      href: '/onboarding?plan=starter',
      highlight: false,
      trial: '3-day free trial',
    },
    {
      name: 'Pro',
      price: { monthly: 25, annual: 199 },
      period: annual ? '/year' : '/month',
      features: [
        'Everything in Starter',
        '70 coaching mins/month',
        'AI Readiness Score',
        'Ask Anything SMS',
        '$0.39/min extra',
      ],
      cta: 'Get Pro',
      href: '/onboarding?plan=pro',
      highlight: true,
      trial: '3-day free trial',
    },
    {
      name: 'Executive',
      price: { monthly: 49, annual: 399 },
      period: annual ? '/year' : '/month',
      features: [
        'Everything in Pro',
        '150 coaching mins/month',
        'Dedicated phone number',
        'Priority scheduling',
        '$0.38/min extra',
      ],
      cta: 'Get Executive',
      href: '/onboarding?plan=executive',
      highlight: false,
      trial: '3-day free trial',
    },
  ]

  return (
    <section id="pricing" className="py-32 bg-[#080808]" ref={ref}>
      <div className="max-w-7xl mx-auto px-6">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={inView ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.6 }}
          className="text-center mb-12"
        >
          <h2 className="text-5xl font-bold text-white mb-4">
            Simple, transparent pricing
          </h2>
          <p className="text-xl text-[#475569] mb-8">
            Start free. Upgrade when you see the value.
          </p>

          {/* Monthly/Annual toggle */}
          <div className="inline-flex items-center bg-[#111111] border border-[#222222] rounded-xl p-1">
            {['Monthly', 'Annual'].map((label) => {
              const isActive = (label === 'Annual') === annual
              return (
                <button
                  key={label}
                  onClick={() => setAnnual(label === 'Annual')}
                  className={`px-5 py-2 rounded-lg text-sm font-medium transition-colors ${
                    isActive
                      ? 'bg-[#7C3AED] text-white'
                      : 'text-[#475569] hover:text-white'
                  }`}
                >
                  {label}
                  {label === 'Annual' && (
                    <span className="ml-2 text-xs text-[#F59E0B]">Save 30%</span>
                  )}
                </button>
              )
            })}
          </div>
        </motion.div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-5">
          {plans.map((plan, i) => (
            <motion.div
              key={plan.name}
              initial={{ opacity: 0, y: 30 }}
              animate={inView ? { opacity: 1, y: 0 } : {}}
              transition={{ duration: 0.6, delay: i * 0.1 }}
              className="relative"
            >
              <Card
                className={`p-6 h-full flex flex-col ${
                  plan.highlight ? 'border-[#7C3AED] border-2' : ''
                }`}
              >
                {plan.highlight && (
                  <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                    <Badge variant="purple">Most popular</Badge>
                  </div>
                )}

                <div className="mb-6">
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-sm font-semibold text-[#94A3B8]">{plan.name}</p>
                    {annual && plan.price.monthly > 0 && (
                      <span className="text-[10px] font-bold text-[#10B981] uppercase tracking-wide px-2 py-0.5 rounded-full bg-green-950/40 border border-green-800/30">
                        Save ${plan.price.monthly * 12 - plan.price.annual}
                      </span>
                    )}
                  </div>
                  <div className="flex items-baseline gap-1">
                    <span className="text-4xl font-bold text-white">
                      {plan.price[annual ? 'annual' : 'monthly'] === 0
                        ? 'Free'
                        : `$${plan.price[annual ? 'annual' : 'monthly']}`}
                    </span>
                    {plan.price[annual ? 'annual' : 'monthly'] > 0 && (
                      <span className="text-[#475569] text-sm">{plan.period}</span>
                    )}
                  </div>
                  {annual && plan.price.monthly > 0 && (
                    <p className="text-xs text-[#475569] mt-1">
                      ≈ ${Math.round(plan.price.annual / 12)}/month
                    </p>
                  )}
                </div>

                <ul className="space-y-2.5 mb-8 flex-1">
                  {plan.features.map((feature) => (
                    <li key={feature} className="flex items-start gap-2 text-sm">
                      <CheckCircle size={16} className="text-[#7C3AED] mt-0.5 flex-shrink-0" />
                      <span className="text-[#94A3B8]">{feature}</span>
                    </li>
                  ))}
                </ul>

                <Link href={plan.href}>
                  <Button
                    variant={plan.highlight ? 'primary' : 'secondary'}
                    className="w-full"
                  >
                    {plan.cta}
                  </Button>
                </Link>
              </Card>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  )
}

// ─── Bottom CTA ───────────────────────────────────────────────────────────────

function BottomCTA() {
  return (
    <section
      className="py-32"
      style={{
        background:
          'linear-gradient(135deg, rgba(124,58,237,0.3) 0%, rgba(6,182,212,0.1) 100%), #080808',
      }}
    >
      <div className="max-w-4xl mx-auto px-6 text-center">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.7 }}
        >
          <h2 className="text-5xl lg:text-6xl font-bold text-white mb-6">
            Your competitors are already learning.
          </h2>
          <p className="text-xl text-[#94A3B8] mb-10">
            Are you?
          </p>
          <Link href="/onboarding?plan=free">
            <Button size="lg" className="gap-2">
              Get started — 15 seconds to set up
              <ArrowRight size={20} />
            </Button>
          </Link>
        </motion.div>
      </div>
    </section>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function LandingPage() {
  return (
    <main className="bg-[#080808]">
      <MarketingNav />
      <Hero />
      <ProblemSection />
      <HowItWorks />
      <Testimonials />
      <Pricing />
      <BottomCTA />
    </main>
  )
}
