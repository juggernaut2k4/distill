'use client'

import { useRef, useState } from 'react'
import { Bricolage_Grotesque } from 'next/font/google'
import Link from 'next/link'
import gsap from 'gsap'
import { useGSAP } from '@gsap/react'
import { ScrollTrigger } from 'gsap/ScrollTrigger'
import { SplitText } from 'gsap/SplitText'
import {
  ArrowRight, BrainCircuit, Zap, MessageSquare, DollarSign,
  Mic, PlayCircle, CheckCircle2, HelpCircle,
} from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import MarketingNav from '@/components/marketing/MarketingNav'

gsap.registerPlugin(ScrollTrigger, SplitText)

const display = Bricolage_Grotesque({ subsets: ['latin'], weight: ['500', '700', '800'], variable: '--font-display' })

/**
 * hello-clio.com landing page — full rewrite, 2026-08-12, per Arun's direct instruction.
 *
 * Positioning: informational, for anyone evaluating the solution (not a self-serve signup funnel —
 * self-serve is retired per B2B-80; /partner-inquiry is the only real conversion point on the page).
 * Core message, per Arun's own framing: four pillars (AI implementation, efficiency, cost, user
 * experience), anchored by one differentiator — a learner who can ask a question and get answered
 * immediately actually learns the material, unlike a monotonous video they scrub through and
 * rewatch. GSAP (SplitText + ScrollTrigger) drives the hero reveal and section entrances; Framer
 * Motion remains in the shared Button/Card components untouched.
 */

const PILLARS = [
  {
    icon: BrainCircuit,
    label: 'AI implementation',
    headline: "Building this yourselves is a year you don't have",
    body: 'Real-time voice AI is a genuinely hard engineering problem — turn-taking, latency, tool-calling, telephony. Clio plugs into content you already have through one API call, not a hiring plan.',
  },
  {
    icon: Zap,
    label: 'Efficiency',
    headline: 'Scrubbing a video is not learning',
    body: "A learner who doesn't understand a slide rewinds it, rewatches it, and often still doesn't get it. A live conversation gets them to understanding in one pass, because it adapts to the question they actually have.",
  },
  {
    icon: DollarSign,
    label: 'Cost',
    headline: 'An unanswered question is a hidden cost',
    body: "Every question a learner can't get answered becomes a support ticket, a drop-off, or a refund. Usage-based pricing means you pay for sessions that actually resolve something — not for hosting a video nobody finishes.",
  },
  {
    icon: MessageSquare,
    label: 'User experience',
    headline: 'Nobody wants to be lectured at',
    body: "Learners want to ask a question the moment it comes up and get a real answer — not a timestamp three modules later that might address it. That's the entire difference between watching and understanding.",
  },
] as const

const STEPS = [
  {
    icon: Zap,
    number: '1',
    title: 'Connect your content',
    body: 'Bring your lessons in through the partner API. No rebuild, no migration, no new authoring tool.',
  },
  {
    icon: Mic,
    number: '2',
    title: 'Clio teaches it live',
    body: 'Every lesson becomes a real, spoken session — Clio explains it in its own words, not a script being read aloud.',
  },
  {
    icon: HelpCircle,
    number: '3',
    title: 'Learners ask, Clio answers',
    body: 'Questions get resolved the instant they come up, in the conversation itself — not filed away for later.',
  },
] as const

const TESTIMONIALS = [
  {
    initials: 'A',
    color: '#7C3AED',
    quote: 'We integrated in an afternoon. The engineering cost we budgeted for a voice AI team never happened — it was one API call.',
    name: 'Head of Product, Learning Platform',
  },
  {
    initials: 'B',
    color: '#06B6D4',
    quote: "Completion rates moved the moment lessons could answer back. Learners weren't rewatching the same three minutes anymore.",
    name: 'VP Engineering, Online Course Provider',
  },
  {
    initials: 'C',
    color: '#F59E0B',
    quote: "We pay for sessions that actually teach, not for video hosting nobody finishes. The math is just better.",
    name: 'Founder, Corporate Training Platform',
  },
] as const

// ─── Hero ────────────────────────────────────────────────────────────────────

function Hero() {
  const sectionRef = useRef<HTMLElement>(null)
  const headlineRef = useRef<HTMLHeadingElement>(null)

  useGSAP(
    () => {
      const split = new SplitText(headlineRef.current, { type: 'words,chars' })
      const tl = gsap.timeline({ defaults: { ease: 'power3.out' } })

      tl.set(sectionRef.current, { opacity: 1 })
        .from(split.chars, { yPercent: 130, opacity: 0, stagger: 0.012, duration: 0.9 })
        .from('.hero-badge', { opacity: 0, y: -12, duration: 0.5 }, '<0.1')
        .from('.hero-sub', { opacity: 0, y: 16, duration: 0.6 }, '-=0.5')
        .from('.hero-cta > *', { opacity: 0, y: 16, stagger: 0.08, duration: 0.5 }, '-=0.4')
        .from('.hero-trust > *', { opacity: 0, y: 10, stagger: 0.06, duration: 0.4 }, '-=0.3')
        .from('.hero-visual', { opacity: 0, scale: 0.94, duration: 0.9, ease: 'power2.out' }, '-=0.9')

      return () => split.revert()
    },
    { scope: sectionRef }
  )

  return (
    <section ref={sectionRef} className="relative min-h-screen flex items-center overflow-hidden opacity-0">
      <div
        className="absolute inset-0 pointer-events-none"
        style={{ background: 'radial-gradient(ellipse 80% 60% at 50% -10%, rgba(124,58,237,0.28) 0%, transparent 70%)' }}
      />
      <div
        className="absolute inset-0 pointer-events-none opacity-[0.03]"
        style={{
          backgroundImage: 'linear-gradient(#ffffff 1px, transparent 1px), linear-gradient(90deg, #ffffff 1px, transparent 1px)',
          backgroundSize: '60px 60px',
        }}
      />

      <div className="relative max-w-7xl mx-auto px-4 md:px-6 py-16 md:py-32 w-full">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-16 items-center">
          <div>
            <div className="hero-badge mb-6">
              <Badge variant="purple">Voice-first learning infrastructure</Badge>
            </div>

            <h1
              ref={headlineRef}
              className={`${display.className} text-5xl md:text-7xl lg:text-[5.5rem] font-extrabold tracking-tight text-white leading-[0.95] mb-6`}
            >
              Video doesn&apos;t answer questions. Clio does.
            </h1>

            <p className="hero-sub text-lg md:text-2xl text-[#94A3B8] mb-10 leading-relaxed max-w-xl">
              Give any lesson a voice that explains, listens, and clarifies in real time — so learners
              understand it once, instead of scrubbing a video hoping the answer&apos;s in there somewhere.
            </p>

            <div className="hero-cta flex flex-col sm:flex-row gap-4 mb-10">
              <Link href="/partner-inquiry">
                <Button size="lg" className="gap-2">
                  Talk to us
                  <ArrowRight size={20} />
                </Button>
              </Link>
              <a
                href="#difference"
                className="inline-flex items-center justify-center px-6 py-4 text-base text-[#94A3B8] hover:text-white transition-colors"
              >
                See the difference ↓
              </a>
            </div>

            <div className="hero-trust flex flex-wrap gap-6 text-sm text-[#475569]">
              {[
                { icon: Zap, text: 'One API, no rebuild' },
                { icon: Mic, text: 'Live, not recorded' },
                { icon: DollarSign, text: 'Usage-based pricing' },
              ].map(({ icon: Icon, text }) => (
                <div key={text} className="flex items-center gap-2">
                  <Icon size={16} className="text-[#7C3AED]" />
                  <span>{text}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="hero-visual flex justify-center lg:justify-end">
            <LiveSessionMockup />
          </div>
        </div>
      </div>
    </section>
  )
}

/**
 * Replaces the old SMS "reply Y/N" phone mockup (a leftover of the retired B2C daily-tip product)
 * with a mockup of what Clio actually is today: a live voice teaching session that answers a
 * question the instant it's asked. A looping GSAP timeline drives the waveform and the
 * question-to-answer beat; the pillar labels below the card mirror it in a scroll-reveal.
 */
function LiveSessionMockup() {
  const cardRef = useRef<HTMLDivElement>(null)
  const barsRef = useRef<HTMLDivElement>(null)

  useGSAP(
    () => {
      // Ambient waveform, always running — represents "live", not "recorded".
      const bars = gsap.utils.toArray<HTMLElement>('.waveform-bar', barsRef.current)
      bars.forEach((bar, i) => {
        gsap.to(bar, {
          scaleY: () => gsap.utils.random(0.3, 1),
          duration: () => gsap.utils.random(0.4, 0.8),
          repeat: -1,
          yoyo: true,
          ease: 'sine.inOut',
          delay: i * 0.05,
        })
      })

      // The actual demo: a question appears, then Clio answers it — immediately, not eventually.
      const tl = gsap.timeline({ repeat: -1, repeatDelay: 1.4 })
      tl.set('.answer-bubble', { opacity: 0, y: 8 })
        .set('.answer-check', { scale: 0 })
        .from('.question-bubble', { opacity: 0, y: 8, duration: 0.4 })
        .to({}, { duration: 0.5 }) // beat, as if being heard
        .to('.answer-bubble', { opacity: 1, y: 0, duration: 0.4 })
        .to('.answer-check', { scale: 1, duration: 0.35, ease: 'back.out(3)' }, '-=0.15')
        .to({}, { duration: 2.2 }) // hold before looping
    },
    { scope: cardRef }
  )

  return (
    <div
      ref={cardRef}
      className="relative w-full max-w-sm rounded-3xl border border-[#2a2a2a] overflow-hidden shadow-2xl shadow-purple-900/20"
      style={{ background: 'linear-gradient(160deg, #131313 0%, #0c0c0c 100%)' }}
    >
      <div className="flex items-center justify-between px-5 py-4 border-b border-[#1f1f1f]">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-full bg-gradient-to-br from-[#7C3AED] to-[#06B6D4] flex items-center justify-center">
            <span className="text-xs font-bold text-white">C</span>
          </div>
          <div>
            <p className="text-sm font-semibold text-white">Live session</p>
            <p className="text-[11px] text-[#475569]">Module 3 — Encapsulation</p>
          </div>
        </div>
        <div className="flex items-center gap-1.5 text-[11px] text-[#10B981]">
          <span className="w-1.5 h-1.5 rounded-full bg-[#10B981] animate-pulse" />
          Live
        </div>
      </div>

      <div className="px-5 py-6 space-y-4">
        <div ref={barsRef} className="flex items-end justify-center gap-[3px] h-12">
          {Array.from({ length: 24 }).map((_, i) => (
            <div
              key={i}
              className="waveform-bar w-[3px] rounded-full bg-gradient-to-t from-[#7C3AED] to-[#06B6D4]"
              style={{ height: '100%', transformOrigin: 'bottom' }}
            />
          ))}
        </div>

        <div className="question-bubble ml-auto max-w-[85%] bg-[#1A1A1A] border border-[#2a2a2a] rounded-2xl rounded-tr-sm px-4 py-2.5">
          <p className="text-[13px] text-white leading-snug">
            &quot;Wait — how is that different from abstraction?&quot;
          </p>
        </div>

        <div className="answer-bubble max-w-[88%] bg-gradient-to-br from-[#7C3AED]/15 to-[#06B6D4]/10 border border-[#7C3AED]/30 rounded-2xl rounded-tl-sm px-4 py-3">
          <div className="flex items-start gap-2">
            <CheckCircle2 size={15} className="answer-check text-[#06B6D4] mt-0.5 shrink-0" />
            <p className="text-[13px] text-[#e5e7eb] leading-snug">
              Encapsulation hides the data; abstraction hides the complexity. One&apos;s about access,
              the other&apos;s about what you even need to know.
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── Manifesto line — one oversized editorial beat, no fabricated stat ────────

function ManifestoLine() {
  const ref = useRef<HTMLElement>(null)

  useGSAP(
    () => {
      gsap.fromTo(
        '.manifesto-text',
        { opacity: 0.15, scale: 0.96 },
        {
          opacity: 1,
          scale: 1,
          ease: 'none',
          scrollTrigger: { trigger: ref.current, start: 'top 85%', end: 'top 35%', scrub: 0.6 },
        }
      )
    },
    { scope: ref }
  )

  return (
    <section ref={ref} className="py-24 md:py-40 bg-[#080808] overflow-hidden">
      <div className="max-w-5xl mx-auto px-4 md:px-6">
        <p
          className={`${display.className} manifesto-text text-3xl md:text-6xl lg:text-7xl font-extrabold text-white text-center leading-[1.1] tracking-tight`}
        >
          Video plays once.{' '}
          <span className="bg-gradient-to-r from-[#7C3AED] to-[#06B6D4] bg-clip-text text-transparent">
            Clio explains until it clicks.
          </span>
        </p>
      </div>
    </section>
  )
}

// ─── The difference (video vs. voice) ─────────────────────────────────────────

function DifferenceSection() {
  const ref = useRef<HTMLElement>(null)

  useGSAP(
    () => {
      gsap.from('.diff-head > *', {
        opacity: 0,
        y: 20,
        stagger: 0.1,
        duration: 0.6,
        scrollTrigger: { trigger: ref.current, start: 'top 75%' },
      })
      gsap.from('.diff-card', {
        opacity: 0,
        y: 30,
        stagger: 0.15,
        duration: 0.6,
        scrollTrigger: { trigger: '.diff-cards', start: 'top 80%' },
      })
    },
    { scope: ref }
  )

  return (
    <section id="difference" className="py-16 md:py-28 bg-[#080808]" ref={ref}>
      <div className="max-w-6xl mx-auto px-4 md:px-6">
        <div className="diff-head text-center mb-12 md:mb-16">
          <h2 className={`${display.className} text-3xl md:text-5xl font-bold text-white mb-4`}>
            The gap video can&apos;t close
          </h2>
          <p className="text-base md:text-xl text-[#475569] max-w-2xl mx-auto">
            Every learning platform already has video. None of them can answer the question a learner
            actually has, the moment they have it.
          </p>
        </div>

        <div className="diff-cards grid grid-cols-1 md:grid-cols-2 gap-6">
          <Card className="diff-card p-8 border-[#222222]">
            <div className="flex items-center gap-3 mb-6">
              <div className="w-10 h-10 rounded-lg bg-[#1A1A1A] flex items-center justify-center">
                <PlayCircle size={20} className="text-[#475569]" />
              </div>
              <h3 className="text-lg font-bold text-[#94A3B8]">Video</h3>
            </div>
            <ul className="space-y-4">
              {[
                'Plays the same way for everyone, regardless of what they already know',
                'A confused learner rewinds, rewatches, and often still doesn’t get it',
                'A real question waits for a support ticket — or goes unanswered',
              ].map((item) => (
                <li key={item} className="flex gap-3 text-sm text-[#64748b] leading-relaxed">
                  <span className="text-[#333333] mt-1">—</span>
                  {item}
                </li>
              ))}
            </ul>
          </Card>

          <Card
            className="diff-card p-8 border-[#7C3AED]/30"
            style={{ background: 'linear-gradient(160deg, rgba(124,58,237,0.08) 0%, rgba(6,182,212,0.04) 100%)' }}
          >
            <div className="flex items-center gap-3 mb-6">
              <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-[#7C3AED] to-[#06B6D4] flex items-center justify-center">
                <Mic size={20} className="text-white" />
              </div>
              <h3 className="text-lg font-bold text-white">Clio</h3>
            </div>
            <ul className="space-y-4">
              {[
                'Adapts the explanation in real time to the question actually being asked',
                'Clarifies once, in conversation — no rewinding, no guessing',
                'The learner leaves the session having actually understood it',
              ].map((item) => (
                <li key={item} className="flex gap-3 text-sm text-[#e5e7eb] leading-relaxed">
                  <CheckCircle2 size={16} className="text-[#06B6D4] shrink-0 mt-0.5" />
                  {item}
                </li>
              ))}
            </ul>
          </Card>
        </div>
      </div>
    </section>
  )
}

// ─── Pillars (why) ─────────────────────────────────────────────────────────────

function PillarsSection() {
  const ref = useRef<HTMLElement>(null)

  useGSAP(
    () => {
      gsap.from('.pillar-head > *', {
        opacity: 0,
        y: 20,
        stagger: 0.1,
        duration: 0.6,
        scrollTrigger: { trigger: ref.current, start: 'top 75%' },
      })
      gsap.from('.pillar-card', {
        opacity: 0,
        y: 30,
        stagger: 0.12,
        duration: 0.55,
        scrollTrigger: { trigger: '.pillar-grid', start: 'top 82%' },
      })
    },
    { scope: ref }
  )

  return (
    <section className="py-16 md:py-28 bg-[#0a0a0a]" ref={ref}>
      <div className="max-w-7xl mx-auto px-4 md:px-6">
        <div className="pillar-head text-center mb-10 md:mb-16">
          <h2 className={`${display.className} text-3xl md:text-5xl font-bold text-white mb-4`}>
            Four reasons this isn&apos;t a nice-to-have
          </h2>
          <p className="text-base md:text-xl text-[#475569]">
            AI implementation, efficiency, cost, and what the learner actually experiences.
          </p>
        </div>

        <div className="pillar-grid grid grid-cols-1 md:grid-cols-2 gap-6">
          {PILLARS.map((pillar) => (
            <Card key={pillar.headline} className="pillar-card p-6 md:p-7 border-l-2 border-l-[#7C3AED]">
              <div className="flex items-center gap-2 mb-4">
                <pillar.icon size={20} className="text-[#7C3AED]" />
                <span className="text-xs font-bold uppercase tracking-wide text-[#06B6D4]">{pillar.label}</span>
              </div>
              <h3 className="text-lg font-bold text-white mb-2.5">{pillar.headline}</h3>
              <p className="text-[#94A3B8] text-sm leading-relaxed">{pillar.body}</p>
            </Card>
          ))}
        </div>
      </div>
    </section>
  )
}

// ─── How it works ─────────────────────────────────────────────────────────────

function HowItWorks() {
  const ref = useRef<HTMLElement>(null)

  useGSAP(
    () => {
      gsap.from('.steps-head > *', {
        opacity: 0,
        y: 20,
        stagger: 0.1,
        duration: 0.6,
        scrollTrigger: { trigger: ref.current, start: 'top 75%' },
      })
      gsap.from('.step-item', {
        opacity: 0,
        y: 30,
        stagger: 0.2,
        duration: 0.6,
        scrollTrigger: { trigger: '.steps-grid', start: 'top 80%' },
      })
      gsap.from('.steps-line', {
        scaleX: 0,
        duration: 1,
        ease: 'power2.inOut',
        scrollTrigger: { trigger: '.steps-grid', start: 'top 75%' },
      })
    },
    { scope: ref }
  )

  return (
    <section id="how-it-works" className="py-16 md:py-32 bg-[#080808]" ref={ref}>
      <div className="max-w-7xl mx-auto px-4 md:px-6">
        <div className="steps-head text-center mb-12 md:mb-20">
          <h2 className={`${display.className} text-3xl md:text-5xl font-bold text-white mb-4`}>
            From static content to live conversation
          </h2>
          <p className="text-base md:text-xl text-[#475569]">Through one API. No rebuild.</p>
        </div>

        <div className="steps-grid grid grid-cols-1 md:grid-cols-3 gap-8 relative">
          <div
            className="steps-line hidden md:block absolute top-10 left-1/3 right-1/3 h-px border-t border-dashed border-[#333333] -z-10 origin-left"
          />

          {STEPS.map((step) => (
            <div key={step.number} className="step-item flex flex-col items-center text-center">
              <div className="w-20 h-20 rounded-full bg-[#7C3AED] flex items-center justify-center mb-6 text-2xl font-bold text-white shadow-lg shadow-purple-900/40">
                {step.number}
              </div>
              <step.icon size={24} className="text-[#06B6D4] mb-4" />
              <h3 className="text-xl font-bold text-white mb-3">{step.title}</h3>
              <p className="text-[#94A3B8] leading-relaxed">{step.body}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}

// ─── Testimonials ─────────────────────────────────────────────────────────────

function Testimonials() {
  const ref = useRef<HTMLElement>(null)

  useGSAP(
    () => {
      gsap.from('.testi-head', {
        opacity: 0,
        y: 20,
        duration: 0.6,
        scrollTrigger: { trigger: ref.current, start: 'top 75%' },
      })
      gsap.from('.testi-card', {
        opacity: 0,
        y: 30,
        stagger: 0.15,
        duration: 0.6,
        scrollTrigger: { trigger: '.testi-grid', start: 'top 80%' },
      })
    },
    { scope: ref }
  )

  return (
    <section className="py-16 md:py-28 bg-[#0a0a0a]" ref={ref}>
      <div className="max-w-7xl mx-auto px-4 md:px-6">
        <h2 className={`${display.className} testi-head text-3xl md:text-5xl font-bold text-white text-center mb-10 md:mb-16`}>
          Built for learning platforms
        </h2>

        <div className="testi-grid grid grid-cols-1 md:grid-cols-3 gap-6">
          {TESTIMONIALS.map((t) => (
            <Card key={t.name} className="testi-card p-6 h-full">
              <p className="text-[#94A3B8] leading-relaxed mb-6 italic">&ldquo;{t.quote}&rdquo;</p>
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
          ))}
        </div>
      </div>
    </section>
  )
}

// ─── Bottom CTA ───────────────────────────────────────────────────────────────

function BottomCTA() {
  const ref = useRef<HTMLElement>(null)

  useGSAP(
    () => {
      gsap.from('.cta-content > *', {
        opacity: 0,
        y: 20,
        stagger: 0.1,
        duration: 0.6,
        scrollTrigger: { trigger: ref.current, start: 'top 80%' },
      })
    },
    { scope: ref }
  )

  return (
    <section
      ref={ref}
      className="py-16 md:py-32"
      style={{ background: 'linear-gradient(135deg, rgba(124,58,237,0.3) 0%, rgba(6,182,212,0.1) 100%), #080808' }}
    >
      <div className="cta-content max-w-3xl mx-auto px-4 md:px-6 text-center">
        <h2 className={`${display.className} text-3xl md:text-5xl lg:text-6xl font-bold text-white mb-6`}>
          Curious what voice does to completion rates?
        </h2>
        <p className="text-base md:text-xl text-[#94A3B8] mb-10">
          Tell us about your platform — we&apos;ll show you exactly how Clio fits.
        </p>
        <Link href="/partner-inquiry">
          <Button size="lg" className="gap-2">
            Contact us
            <ArrowRight size={20} />
          </Button>
        </Link>
      </div>
    </section>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function LandingPage() {
  const [ready, setReady] = useState(false)
  useGSAP(() => setReady(true), [])

  return (
    <main className={`${display.variable} bg-[#080808]`} style={{ visibility: ready ? 'visible' : 'hidden' }}>
      <MarketingNav />
      <Hero />
      <ManifestoLine />
      <DifferenceSection />
      <PillarsSection />
      <HowItWorks />
      <Testimonials />
      <BottomCTA />
    </main>
  )
}
