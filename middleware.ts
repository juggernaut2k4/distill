import { clerkMiddleware, createRouteMatcher } from '@clerk/nextjs/server'
import { NextResponse } from 'next/server'
import { resolveTenantFromHost, isVerifiedCustomDomain } from '@/lib/partner/domain-resolution'

const isPublicRoute = createRouteMatcher([
  '/',
  '/sign-in(.*)',
  '/sign-up(.*)',
  '/partner-signup(.*)', // B2B-25: self-serve partner signup wrapper (Clio company-name step + Clerk <SignUp/>, no Clerk Organizations)
  '/invite/accept(.*)', // B2B-21: internal-admin invite acceptance — renders its own sign-in prompt (mirrors /partner-signup precedent)
  '/team-invite/accept(.*)', // B2B-26: sales-partner team invite acceptance — same pattern as /invite/accept
  '/partner-invite/accept(.*)', // B2B-28: direct-partner invite acceptance — same pattern as /invite/accept and /team-invite/accept
  '/questionnaire',            // B2B-05: exact string, no wildcard — see middleware.ts note below
  '/api/webhooks/(.*)',
  '/api/recall/webhook(.*)',  // Recall.ai webhook — no user auth
  '/api/walkthrough-state/(.*)', // Walkthrough state polling — called by headless browser
  '/api/generate-visual(.*)', // Visual generation — triggered by Clio's show_visual client tool in headless browser
  '/api/clio/chat/completions', // Custom LLM endpoint — called by Hume's Custom-LLM bridge (no user auth)
  '/api/admin/seed-topics',    // Admin seed — checked via secret header; Clerk session also accepted
  '/api/admin/seed-topic-cache', // Role topic cache seeder — no user session needed
  '/walkthrough/(.*)',        // Public walkthrough page shared by Recall.ai bot
  '/partner-render/(.*)',     // B2B-02: placeholder render stub, loaded headlessly by the meeting bot on a partner's behalf — no Clerk session available
  '/partner-questionnaire/(.*)', // B2B-05 fix: pre-existing gap — this end-user-facing, no-auth route (B2B-03) was missing from this list; see build report
])

// B2B-05 — Host-header tenant resolution (Requirement Doc Section 5.B.5,
// architecture.md §14.5). Applies only to these tenant-scoped path
// patterns; every other path on a resolved tenant host gets a neutral 404
// (Section 6/7 — the Clerk-gated Configurator never becomes reachable via a
// partner's own branded domain).
//
// The two /api/* patterns below are additive (found during the 2026-07-14
// overnight audit, not part of B2B-05's original scope): /partner-render/*
// is currently only ever loaded on NEXT_PUBLIC_APP_URL by the meeting-bot
// dispatcher (app/api/partner/v1/sessions/route.ts), never on a tenant host,
// so this gap was dormant — but PartnerRenderClient.tsx's own same-origin
// calls to these two routes would 404 under neutralNotFoundResponse() if
// that page were ever loaded on a resolved tenant host, silently breaking
// voice connection and end-of-session wallet accounting. Listed here so the
// gap can't resurface if a future change starts serving partner-render URLs
// under a partner's own domain.
const TENANT_SCOPED_PATTERNS = [
  /^\/$/,
  /^\/questionnaire$/,
  /^\/partner-questionnaire\/.+/,
  /^\/partner-render\/.+/,
  /^\/api\/hume-token$/,
  /^\/api\/partner\/render\/end-session$/,
]

function neutralNotFoundResponse() {
  return new NextResponse(
    '<!doctype html><html><head><meta charset="utf-8"></head><body style="min-height:100vh;width:100vw;display:flex;align-items:center;justify-content:center;background:#ffffff;color:#111111;font-family:system-ui,sans-serif;margin:0"><p style="font-size:14px">This page could not be found.</p></body></html>',
    { status: 404, headers: { 'Content-Type': 'text/html; charset=utf-8' } }
  )
}

export default clerkMiddleware(async (auth, request) => {
  const host = (request.headers.get('host') ?? '').toLowerCase().split(':')[0]
  const pathname = request.nextUrl.pathname
  const rootDomain = process.env.CLIO_ROOT_DOMAIN ?? ''

  const isTenantHost =
    rootDomain.length > 0 &&
    host !== rootDomain &&
    (host.endsWith(`.${rootDomain}`) || (await isVerifiedCustomDomain(host)))

  if (isTenantHost) {
    const tenant = await resolveTenantFromHost(host, rootDomain)
    const isTenantScopedPath = TENANT_SCOPED_PATTERNS.some((re) => re.test(pathname))

    if (!tenant || tenant.status !== 'active') {
      return neutralNotFoundResponse() // reuses the existing NeutralMessage copy, Requirement Doc 5.B.5
    }
    if (!isTenantScopedPath) {
      return neutralNotFoundResponse() // /dashboard, /api/admin/*, /sign-in, etc. never resolve on a partner domain
    }
    if (pathname === '/' || pathname === '/questionnaire') {
      const rewritten = request.nextUrl.clone()
      rewritten.pathname = `/partner-questionnaire/${tenant.partnerAccountId}`
      const requestHeaders = new Headers(request.headers)
      requestHeaders.set('x-clio-resolved-partner-account-id', tenant.partnerAccountId)
      requestHeaders.set('x-pathname', rewritten.pathname)
      return NextResponse.rewrite(rewritten, { request: { headers: requestHeaders } })
    }
    // /partner-questionnaire/(.*) or /partner-render/(.*) with the correct id/ref already in the path —
    // pass through unchanged, existing behavior.
  }

  // Existing, completely unmodified from here down:
  // API routes handle auth via requireAuth() in the route handler itself.
  // Only apply Clerk's redirect-to-sign-in gate on page routes.
  const isApiRoute = request.nextUrl.pathname.startsWith('/api/')
  if (!isApiRoute && !isPublicRoute(request)) {
    auth().protect()
  }
  // Forward pathname so server layouts can gate by route without restructuring
  const requestHeaders = new Headers(request.headers)
  requestHeaders.set('x-pathname', request.nextUrl.pathname)
  return NextResponse.next({ request: { headers: requestHeaders } })
})

export const config = {
  matcher: [
    // Skip Next.js internals and all static files, unless found in search params
    '/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)',
    // Always run for API routes
    '/(api|trpc)(.*)',
  ],
}
