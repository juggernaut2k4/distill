'use client'

import { Component } from 'react'
import type { ReactNode } from 'react'
import { COLORS } from './_styles'

/**
 * B2B-47 follow-up (2026-07-29) — live-verified the demo route's Clerk exclusion did NOT stop the
 * screen-share "Application error" crash (three distinct visual pages crashed in one session,
 * post-fix), ruling out the Clerk hypothesis. The only diagnostic that's ever fired is
 * lib/partner/live-render.ts's MutationObserver-based error-boundary detector — it can only see that
 * Next.js's OWN error-boundary fallback text appeared in the document, never the real error/stack,
 * because that fallback UI only renders once React's own internal error boundary has already caught
 * and swallowed the exception. This component is a REAL error boundary placed above the fetched
 * page's own content — it sees the actual Error object first (React error boundaries catch nearest-
 * ancestor-first), so it can finally report the true message + stack trace.
 *
 * `window.__CLIO_REPORT_REACT_ERROR__` is defined by the injected diagnostic shim
 * (buildIframeDiagnosticShim() in lib/partner/live-render.ts) BEFORE this page's own React bundle
 * ever runs — it posts to the same, already-working (post-B2B-45) /api/partner/render/client-error
 * sink, tagged source: 'react-error-boundary' to distinguish it from the DOM-text-detection report.
 * Guarded as optional (`typeof window !== 'undefined' && window.__CLIO_REPORT_REACT_ERROR__`) so this
 * component also renders safely standalone (e.g. direct navigation, outside the sandboxed iframe),
 * where that global is never defined.
 *
 * B2B-48 (2026-07-29) — the injected shim above only runs when this page is fetched server-side and
 * reinjected as opaque `srcDoc` (genuine partner-content transport). This page's OWN visuals are now
 * embedded via a real `<iframe src="...">` navigation instead (see lib/partner/live-render.ts's
 * isFirstPartyDemoPageUrl()) — no server-side fetch happens for them, so nothing ever injects
 * `window.__CLIO_REPORT_REACT_ERROR__` and this boundary's componentDidCatch() below is a silent
 * no-op for these pages: the fallback UI still renders correctly (this.state.hasError still works,
 * it's purely React-local state), only the /api/partner/render/client-error report is lost.
 * Deliberately not replaced with a lightweight fallback: the shim's report needs a clio_session_ref
 * to be useful, and this component has no route-level access to one (it's a static, session-agnostic
 * page — the ref lives only in the render session that happens to be iframing it) — wiring one
 * through would mean threading a session identifier into this page's own URL/query string, which is
 * out of scope for a crash fix and not justified by the residual risk: this exact crash class is
 * eliminated by construction by the real-navigation fix, and other errors here still degrade to the
 * same visible "This visual couldn't be displayed." fallback either way, they just stop short of
 * being reported to that specific sink.
 */

declare global {
  interface Window {
    __CLIO_REPORT_REACT_ERROR__?: (message: string, stack?: string) => void
  }
}

interface Props {
  children: ReactNode
}

interface State {
  hasError: boolean
}

export default class DiagnosticErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false }

  static getDerivedStateFromError(): State {
    return { hasError: true }
  }

  componentDidCatch(error: Error) {
    if (typeof window !== 'undefined' && window.__CLIO_REPORT_REACT_ERROR__) {
      window.__CLIO_REPORT_REACT_ERROR__(error.message, error.stack)
    }
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: COLORS.bg, color: COLORS.textSecondary, fontFamily: 'system-ui, sans-serif', padding: 24, textAlign: 'center' }}>
          <p style={{ fontSize: 14 }}>This visual couldn&apos;t be displayed.</p>
        </div>
      )
    }
    return this.props.children
  }
}
