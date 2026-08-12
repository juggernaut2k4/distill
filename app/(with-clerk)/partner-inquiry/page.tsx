'use client'

import { useState, type FormEvent } from 'react'
import Link from 'next/link'
import { Bricolage_Grotesque } from 'next/font/google'
import { Loader2, Zap, Mic, DollarSign, ArrowRight, CheckCircle2 } from 'lucide-react'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'

/**
 * B2B-80 (docs/specs/B2B-80-requirement-document.md §4.A) — public, unauthenticated
 * "Interested in becoming a sales partner?" lead-capture form. Replaces `/partner-signup`
 * as the only way a prospective sales-partner reaches Clio pre-invite. This form must
 * never touch Clerk in any way — submitting it never creates an account of any kind, it
 * only writes a row to `sales_partner_leads` (via POST /api/partner-inquiry) for a
 * super-admin to follow up on manually.
 *
 * Visual pass (2026-08-12, presentation-only per Arun's direct instruction — same fields,
 * same validation, same submit behavior as the original B2B-80 build): reframed as a
 * two-column sell-then-ask layout matching the rewritten homepage's dark/voice-first design
 * language, instead of a single small generic card. The left column reuses homepage copy
 * verbatim (hero trust row, one real testimonial) rather than inventing new claims.
 */

const display = Bricolage_Grotesque({ subsets: ['latin'], weight: ['500', '700', '800'], variable: '--font-display' })

type Status = 'form' | 'submitting' | 'success' | 'error'

interface FieldErrors {
  name?: string
  company_name?: string
  email?: string
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

const TRUST_ROW = [
  { icon: Zap, text: 'One API, no rebuild' },
  { icon: Mic, text: 'Live, not recorded' },
  { icon: DollarSign, text: 'Usage-based pricing' },
] as const

export default function PartnerInquiryPage() {
  const [status, setStatus] = useState<Status>('form')
  const [errors, setErrors] = useState<FieldErrors>({})
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  function validate(formData: FormData): FieldErrors {
    const next: FieldErrors = {}
    const name = String(formData.get('name') ?? '').trim()
    const companyName = String(formData.get('company_name') ?? '').trim()
    const email = String(formData.get('email') ?? '').trim()

    if (!name) next.name = 'Your name is required'
    if (!companyName) next.company_name = 'Company name is required'
    if (!email) next.email = 'Email is required'
    else if (!EMAIL_RE.test(email)) next.email = 'Enter a valid email address'

    return next
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = event.currentTarget
    const formData = new FormData(form)

    const fieldErrors = validate(formData)
    if (Object.keys(fieldErrors).length > 0) {
      setErrors(fieldErrors)
      return
    }
    setErrors({})
    setStatus('submitting')

    try {
      const res = await fetch('/api/partner-inquiry', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: formData.get('name'),
          company_name: formData.get('company_name'),
          email: formData.get('email'),
          phone: formData.get('phone') || undefined,
          message: formData.get('message') || undefined,
          website: formData.get('website') || undefined,
        }),
      })

      if (res.ok) {
        setStatus('success')
        return
      }

      const data = await res.json().catch(() => null)
      setErrorMessage(data?.error?.message ?? 'Something went wrong. Please try again.')
      setStatus('error')
    } catch {
      setErrorMessage('Something went wrong. Please try again.')
      setStatus('error')
    }
  }

  return (
    <div className="relative min-h-screen bg-[#080808] overflow-hidden">
      <div
        className="absolute inset-0 pointer-events-none"
        style={{ background: 'radial-gradient(ellipse 80% 50% at 50% -10%, rgba(124,58,237,0.24) 0%, transparent 70%)' }}
      />
      <div
        className="absolute inset-0 pointer-events-none opacity-[0.03]"
        style={{
          backgroundImage: 'linear-gradient(#ffffff 1px, transparent 1px), linear-gradient(90deg, #ffffff 1px, transparent 1px)',
          backgroundSize: '60px 60px',
        }}
      />

      <div className="relative max-w-6xl mx-auto" style={{ padding: 'clamp(1.5rem, 5vw, 3rem)' }}>
        <Link href="/" className={`${display.className} inline-flex items-center gap-1.5 text-white text-lg font-extrabold mb-12 md:mb-16`}>
          Clio <span className="text-[#A855F7]">AI</span>
        </Link>

        <div className="grid grid-cols-1 lg:grid-cols-[1.1fr_1fr] gap-12 lg:gap-16 items-start">
          {/* Sell column */}
          <div className="lg:pt-4">
            <Badge variant="purple">Voice-first learning infrastructure</Badge>

            <h1
              className={`${display.className} mt-6 text-4xl md:text-5xl font-extrabold tracking-tight text-white leading-[1.05]`}
            >
              Let&apos;s put your platform on voice.
            </h1>

            <p className="mt-5 text-lg text-[#94A3B8] leading-relaxed max-w-md">
              Clio turns the lessons you already have into live, spoken sessions that actually
              answer questions — no rebuild, no new authoring tool. Tell us about your platform
              and we&apos;ll show you exactly how it fits.
            </p>

            <div className="mt-8 flex flex-wrap gap-6 text-sm text-[#475569]">
              {TRUST_ROW.map(({ icon: Icon, text }) => (
                <div key={text} className="flex items-center gap-2">
                  <Icon size={16} className="text-[#7C3AED]" />
                  <span>{text}</span>
                </div>
              ))}
            </div>

            <div className="mt-10 bg-[#111111] border border-[#222222] rounded-xl p-5 max-w-md">
              <p className="text-[#94A3B8] text-sm leading-relaxed italic">
                &ldquo;We integrated in an afternoon. The engineering cost we budgeted for a voice
                AI team never happened — it was one API call.&rdquo;
              </p>
              <div className="mt-3 flex items-center gap-2.5">
                <div
                  className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold text-white"
                  style={{ backgroundColor: '#7C3AED' }}
                >
                  A
                </div>
                <span className="text-xs text-[#475569]">Head of Product, Learning Platform</span>
              </div>
            </div>
          </div>

          {/* Form column */}
          <div className="relative">
            <div
              className="absolute -inset-x-8 -top-8 h-40 pointer-events-none opacity-60"
              style={{ background: 'radial-gradient(ellipse 60% 100% at 50% 0%, rgba(124,58,237,0.25) 0%, transparent 70%)' }}
            />
            <div className="relative bg-[#111111] border border-[#333333] rounded-2xl p-6 md:p-9 shadow-2xl shadow-black/40">
              {status === 'success' ? (
                <div className="py-4">
                  <div className="w-12 h-12 rounded-full bg-green-950/50 border border-green-800/30 flex items-center justify-center">
                    <CheckCircle2 size={24} className="text-[#10B981]" />
                  </div>
                  <h2 className={`${display.className} mt-5 text-2xl font-bold text-white`}>Thanks for reaching out</h2>
                  <p className="mt-2 text-sm text-[#94A3B8] leading-relaxed">
                    We&apos;ve received your details and will be in touch by email or phone soon.
                  </p>
                  <Link
                    href="/"
                    className="mt-6 inline-flex items-center gap-1.5 text-sm text-[#A855F7] hover:text-white transition-colors"
                  >
                    Back to homepage
                  </Link>
                </div>
              ) : (
                <form onSubmit={handleSubmit} noValidate>
                  <h2 className={`${display.className} text-2xl font-bold text-white`}>Become a Clio sales partner</h2>
                  <p className="mt-1.5 text-sm text-[#94A3B8]">
                    Tell us a bit about you and your company, and we&apos;ll reach out.
                  </p>

                  <div className="mt-7 flex flex-col gap-5">
                    <Field label="Your name" name="name" error={errors.name} autoComplete="name" />
                    <Field label="Company name" name="company_name" error={errors.company_name} autoComplete="organization" />
                    <Field label="Email" name="email" type="email" error={errors.email} autoComplete="email" />
                    <Field label="Phone (optional)" name="phone" type="tel" autoComplete="tel" />
                    <div>
                      <label htmlFor="message" className="block text-xs font-semibold uppercase tracking-wide text-[#94A3B8] mb-1.5">
                        Message (optional)
                      </label>
                      <textarea
                        id="message"
                        name="message"
                        rows={3}
                        placeholder="What does your platform teach, and what are you hoping voice does for it?"
                        className="w-full bg-[#1A1A1A] border border-[#333333] rounded-lg px-4 py-3 text-sm text-white placeholder:text-[#475569] focus:outline-none focus:ring-2 focus:ring-[#7C3AED]/30 focus:border-[#7C3AED] resize-none transition-colors"
                      />
                    </div>

                    {/* Honeypot — visually hidden, real visitors never fill this in. */}
                    <input
                      type="text"
                      name="website"
                      tabIndex={-1}
                      autoComplete="off"
                      className="absolute -left-[9999px] w-px h-px opacity-0"
                      aria-hidden="true"
                    />
                  </div>

                  {status === 'error' && <p className="mt-4 text-sm text-[#EF4444]">{errorMessage}</p>}

                  <Button
                    type="submit"
                    size="lg"
                    disabled={status === 'submitting'}
                    className="mt-7 w-full gap-2"
                  >
                    {status === 'submitting' ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin" />
                        Sending...
                      </>
                    ) : (
                      <>
                        Send inquiry
                        <ArrowRight size={18} />
                      </>
                    )}
                  </Button>
                  <p className="mt-3 text-center text-xs text-[#475569]">No commitment — we&apos;ll just talk you through fit.</p>
                </form>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

function Field({
  label,
  name,
  error,
  type = 'text',
  autoComplete,
}: {
  label: string
  name: string
  error?: string
  type?: string
  autoComplete?: string
}) {
  return (
    <div>
      <label htmlFor={name} className="block text-xs font-semibold uppercase tracking-wide text-[#94A3B8] mb-1.5">
        {label}
      </label>
      <input
        id={name}
        name={name}
        type={type}
        autoComplete={autoComplete}
        className={`w-full bg-[#1A1A1A] border rounded-lg px-4 py-3 text-sm text-white placeholder:text-[#475569] focus:outline-none focus:ring-2 focus:ring-[#7C3AED]/30 focus:border-[#7C3AED] transition-colors ${
          error ? 'border-[#EF4444]' : 'border-[#333333]'
        }`}
      />
      {error && <p className="mt-1 text-xs text-[#EF4444]">{error}</p>}
    </div>
  )
}
