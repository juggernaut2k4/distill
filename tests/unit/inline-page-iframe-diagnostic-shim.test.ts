import { describe, it, expect } from 'vitest'
import { injectIframeDiagnosticShim } from '@/lib/partner/live-render'

/**
 * 2026-07-27 — found live twice: an inline page's screen share crashed with Next.js's generic
 * "Application error" text, and the parent-page client-error diagnostics added earlier that same
 * night never received a report — conclusive that the failure lives inside the sandboxed iframe's
 * own opaque-origin browsing context, invisible to the parent page. This covers
 * injectIframeDiagnosticShim() (lib/partner/live-render.ts), the server-side fix: a storage-access
 * shim + in-iframe diagnostic reporting, injected into the fetched HTML before it's ever set as
 * `contentHtml`.
 */

describe('injectIframeDiagnosticShim', () => {
  it('injects the shim script immediately after an existing <head> tag', () => {
    const html = '<!doctype html><html><head><title>Page</title></head><body>hi</body></html>'
    const result = injectIframeDiagnosticShim(html, 'session-ref-123', 'What Is Claude?')
    const headIndex = result.indexOf('<head>')
    const scriptIndex = result.indexOf('<script>')
    const titleIndex = result.indexOf('<title>')
    expect(headIndex).toBeGreaterThanOrEqual(0)
    expect(scriptIndex).toBeGreaterThan(headIndex)
    expect(scriptIndex).toBeLessThan(titleIndex)
  })

  it('is case-insensitive and tolerant of attributes on the <head> tag', () => {
    const html = '<HTML><HEAD lang="en"><title>Page</title></HEAD><body>hi</body></HTML>'
    const result = injectIframeDiagnosticShim(html, 'session-ref-123', 'Page')
    expect(result.indexOf('<script>')).toBeGreaterThan(result.indexOf('<HEAD'))
  })

  it('prepends the shim when no <head> tag exists at all', () => {
    const html = '<div>just a fragment</div>'
    const result = injectIframeDiagnosticShim(html, 'session-ref-123', 'Fragment page')
    expect(result.startsWith('<script>')).toBe(true)
    expect(result).toContain('<div>just a fragment</div>')
  })

  it('embeds the clio_session_ref and page label as JSON-escaped literals, not raw interpolation', () => {
    const html = '<head></head>'
    const result = injectIframeDiagnosticShim(html, 'ref-with-"quote', 'Label with \'quote')
    expect(result).toContain(JSON.stringify('ref-with-"quote'))
    expect(result).toContain(JSON.stringify("Label with 'quote"))
  })

  it('replaces window.sessionStorage/localStorage with an in-memory stub only when a bare read throws', () => {
    const html = '<head></head>'
    const result = injectIframeDiagnosticShim(html, 'ref', 'label')
    expect(result).toContain("stubStorage('sessionStorage')")
    expect(result).toContain("stubStorage('localStorage')")
    expect(result).toContain('try { window[name]; } catch (e) {')
  })

  it('posts errors to /api/partner/render/client-error with the source and an [iframe:...] -prefixed message', () => {
    const html = '<head></head>'
    const result = injectIframeDiagnosticShim(html, 'ref', 'My Page')
    expect(result).toContain("fetch('/api/partner/render/client-error'")
    expect(result).toContain("'[iframe:' + ")
    expect(result).toContain("addEventListener('error'")
    expect(result).toContain("addEventListener('unhandledrejection'")
  })

  /**
   * B2B-43 Fix 4b — React error boundaries catch render-time exceptions internally
   * (componentDidCatch/getDerivedStateFromError), so a caught render error never reaches
   * window.onerror/unhandledrejection. Next.js's own App Router error boundary renders a generic
   * "Application error" fallback INSIDE this iframe's document in that case, invisible to the two
   * listeners above. This closes that blind spot: a MutationObserver watches document.body for that
   * known fallback text and reports it once, tagged distinctly from a raw uncaught JS error.
   */
  it('watches document.body with a MutationObserver for the Next.js error-boundary fallback signature', () => {
    const html = '<head></head>'
    const result = injectIframeDiagnosticShim(html, 'ref', 'My Page')
    expect(result).toContain('MutationObserver')
    expect(result).toContain('Application error: a client-side exception has occurred')
    expect(result).toContain('observe(document.body')
  })

  it('reports a detected error-boundary fallback via the same postReport sink, tagged [iframe:error-boundary] distinctly from the pageLabel-tagged report() helper', () => {
    const html = '<head></head>'
    const result = injectIframeDiagnosticShim(html, 'ref-123', 'My Page')
    expect(result).toContain("source: 'error-boundary'")
    expect(result).toContain("'[iframe:error-boundary] '")
    // Reuses the same low-level fetch sink as window.onerror/unhandledrejection reporting —
    // exactly one fetch(...) call site to /api/partner/render/client-error in the whole shim.
    const fetchCallCount = (result.match(/fetch\('\/api\/partner\/render\/client-error'/g) ?? []).length
    expect(fetchCallCount).toBe(1)
  })

  it('only reports the error-boundary fallback once per page (guards against repeated MutationObserver callbacks)', () => {
    const html = '<head></head>'
    const result = injectIframeDiagnosticShim(html, 'ref', 'My Page')
    expect(result).toContain('errorBoundaryReported')
    expect(result).toContain('if (errorBoundaryReported) return;')
  })
})
