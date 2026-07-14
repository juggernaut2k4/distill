import { clerkMiddleware, createRouteMatcher } from '@clerk/nextjs/server'
import { NextResponse } from 'next/server'
import { resolveTenantFromHost, isVerifiedCustomDomain } from '@/lib/partner/domain-resolution'

const isPublicRoute = createRouteMatcher([
  '/',
  '/pricing(.*)',
  '/onboarding(.*)',
  '/sign-in(.*)',
  '/sign-up(.*)',
  '/plan(.*)',
  '/checkout(.*)',
  '/topics(.*)',
  '/questionnaire',            // B2B-05: exact string, no wildcard — see middleware.ts note below
  '/dashboard/welcome(.*)',
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
// architecture.md §14.5). Applies only to these 4 tenant-scoped path
// patterns; every other path on a resolved tenant host gets a neutral 404
// (Section 6/7 — the Clerk-gated Configurator never becomes reachable via a
// partner's own branded domain).
const TENANT_SCOPED_PATTERNS = [
  /^\/$/,
  /^\/questionnaire$/,
  /^\/partner-questionnaire\/.+/,
  /^\/partner-render\/.+/,
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
