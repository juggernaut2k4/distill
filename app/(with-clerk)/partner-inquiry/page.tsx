'use client'

import { useState, type FormEvent } from 'react'
import { Loader2 } from 'lucide-react'

/**
 * B2B-80 (docs/specs/B2B-80-requirement-document.md §4.A) — public, unauthenticated
 * "Interested in becoming a sales partner?" lead-capture form. Replaces `/partner-signup`
 * as the only way a prospective sales-partner reaches Clio pre-invite. This form must
 * never touch Clerk in any way — submitting it never creates an account of any kind, it
 * only writes a row to `sales_partner_leads` (via POST /api/partner-inquiry) for a
 * super-admin to follow up on manually.
 *
 * Reuses /partner-signup's dark-card visual language (max-w-sm, #111111 card,
 * #222222 border) per §4.A, but is a genuinely different, Clerk-free component tree.
 */

type Status = 'form' | 'submitting' | 'success' | 'error'

interface FieldErrors {
  name?: string
  company_name?: string
  email?: string
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

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
    <div className="min-h-screen bg-void flex items-center justify-center" style={{ padding: 'clamp(1rem, 5vw, 2rem)' }}>
      <div className="max-w-sm w-full bg-[#111111] border border-[#222222] rounded-xl p-6">
        {status === 'success' ? (
          <div>
            <h1 className="text-xl font-semibold text-white">Thanks for reaching out</h1>
            <p className="mt-2 text-sm text-[#94A3B8]">
              We&apos;ve received your details and will be in touch by email or phone soon.
            </p>
          </div>
        ) : (
          <form onSubmit={handleSubmit} noValidate>
            <h1 className="text-xl font-semibold text-white">Become a Clio sales partner</h1>
            <p className="mt-1 text-sm text-[#94A3B8]">Tell us a bit about you and your company, and we&apos;ll reach out.</p>

            <div className="mt-5 flex flex-col gap-4">
              <Field label="Your name" name="name" error={errors.name} autoComplete="name" />
              <Field label="Company name" name="company_name" error={errors.company_name} autoComplete="organization" />
              <Field label="Email" name="email" type="email" error={errors.email} autoComplete="email" />
              <Field label="Phone (optional)" name="phone" type="tel" autoComplete="tel" />
              <div>
                <label htmlFor="message" className="block text-xs font-medium text-[#94A3B8] mb-1">
                  Message (optional)
                </label>
                <textarea
                  id="message"
                  name="message"
                  rows={3}
                  className="w-full bg-[#1A1A1A] border border-[#333333] rounded-lg px-3 py-2 text-sm text-white placeholder:text-[#475569] focus:outline-none focus:border-[#7C3AED] resize-none"
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

            <button
              type="submit"
              disabled={status === 'submitting'}
              className="mt-5 w-full inline-flex items-center justify-center gap-1.5 text-sm font-semibold px-4 py-2 rounded-lg bg-[#7C3AED] text-white hover:bg-[#A855F7] transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {status === 'submitting' && <Loader2 className="w-4 h-4 animate-spin" />}
              {status === 'submitting' ? 'Sending...' : 'Send inquiry'}
            </button>
          </form>
        )}
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
      <label htmlFor={name} className="block text-xs font-medium text-[#94A3B8] mb-1">
        {label}
      </label>
      <input
        id={name}
        name={name}
        type={type}
        autoComplete={autoComplete}
        className={`w-full bg-[#1A1A1A] border rounded-lg px-3 py-2 text-sm text-white placeholder:text-[#475569] focus:outline-none focus:border-[#7C3AED] ${
          error ? 'border-[#EF4444]' : 'border-[#333333]'
        }`}
      />
      {error && <p className="mt-1 text-xs text-[#EF4444]">{error}</p>}
    </div>
  )
}
