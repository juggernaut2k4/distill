'use client'

import { useState, type FormEvent } from 'react'
import Link from 'next/link'
import { Loader2, ArrowRight, CheckCircle2 } from 'lucide-react'
import { Button } from '@/components/ui/Button'

/**
 * WAITLIST-01 (docs/specs/WAITLIST-01-requirement-document.md §4.B) — the client-side homepage
 * waitlist form. Idle/submitting/success/duplicate/error states, structural twin of
 * app/(with-clerk)/partner-inquiry/page.tsx's form (same Field markup, same honeypot pattern, same
 * submit-state swap), adapted to this feature's narrower two-field shape and its "duplicate is a
 * success-styled state, not an error" behavior (§4.B).
 */

type Status = 'idle' | 'submitting' | 'success' | 'duplicate' | 'error'

interface FieldErrors {
  name?: string
  email?: string
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export default function WaitlistForm() {
  const [status, setStatus] = useState<Status>('idle')
  const [errors, setErrors] = useState<FieldErrors>({})

  function validate(formData: FormData): FieldErrors {
    const next: FieldErrors = {}
    const name = String(formData.get('name') ?? '').trim()
    const email = String(formData.get('email') ?? '').trim()

    if (!name) next.name = 'Your name is required'
    if (!email) next.email = 'Enter a valid email address'
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
      const res = await fetch('/api/waitlist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: formData.get('name'),
          email: formData.get('email'),
          website: formData.get('website') || undefined,
        }),
      })

      if (!res.ok) {
        setStatus('error')
        return
      }

      const data = await res.json().catch(() => null)
      setStatus(data?.duplicate ? 'duplicate' : 'success')
    } catch {
      setStatus('error')
    }
  }

  if (status === 'success' || status === 'duplicate') {
    return (
      <div className="py-4">
        <div className="w-12 h-12 rounded-full bg-green-950/50 border border-green-800/30 flex items-center justify-center">
          <CheckCircle2 size={24} className="text-[#10B981]" />
        </div>
        <h3 className="mt-5 text-2xl font-bold text-white">
          {status === 'success' ? "You're on the list." : "You're already on the list."}
        </h3>
        <p className="mt-2 text-sm text-[#94A3B8] leading-relaxed">
          {status === 'success'
            ? "We'll email you the moment Clio's ready to bring on new partners."
            : "We've got your email — we'll be in touch when Clio's ready."}
        </p>
      </div>
    )
  }

  return (
    <form onSubmit={handleSubmit} noValidate>
      <div className="flex flex-col gap-5">
        <Field label="Your name" name="name" error={errors.name} autoComplete="name" placeholder="Jane Doe" />
        <Field
          label="Email"
          name="email"
          type="email"
          error={errors.email}
          autoComplete="email"
          placeholder="jane@company.com"
        />

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

      {status === 'error' && <p className="mt-4 text-sm text-[#EF4444]">Something went wrong. Please try again.</p>}

      <Button type="submit" size="lg" disabled={status === 'submitting'} className="mt-7 w-full gap-2">
        {status === 'submitting' ? (
          <>
            <Loader2 className="w-4 h-4 animate-spin" />
            Joining...
          </>
        ) : (
          <>
            Join the waitlist
            <ArrowRight size={18} />
          </>
        )}
      </Button>

      <p className="mt-4 text-center">
        <Link href="/partner-inquiry" className="text-sm text-[#475569] hover:text-white transition-colors">
          Want to talk to us directly instead? Contact us →
        </Link>
      </p>
    </form>
  )
}

function Field({
  label,
  name,
  error,
  type = 'text',
  autoComplete,
  placeholder,
}: {
  label: string
  name: string
  error?: string
  type?: string
  autoComplete?: string
  placeholder?: string
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
        placeholder={placeholder}
        className={`w-full bg-[#1A1A1A] border rounded-lg px-4 py-3 text-sm text-white placeholder:text-[#475569] focus:outline-none focus:ring-2 focus:ring-[#7C3AED]/30 focus:border-[#7C3AED] transition-colors ${
          error ? 'border-[#EF4444]' : 'border-[#333333]'
        }`}
      />
      {error && <p className="mt-1 text-xs text-[#EF4444]">{error}</p>}
    </div>
  )
}
