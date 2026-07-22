import { clerkMiddleware, createRouteMatcher } from '@clerk/nextjs/server'
import { NextResponse } from 'next/server'
import { resolveTenantFromHost, isVerifiedCustomDomain } from '@/lib/partner/domain-resolution'
import { checkTestHarnessBasicAuth } from '@/lib/test-harness/basic-auth'
import { isTestHarnessAuthoringPath, isDemoPath } from '@/lib/test-harness/paths'

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
  '/test-harness-render/(.*)', // B2B-32: public, unauthenticated — fetched by the real safeFetchPartnerPage() pipeline, mirrors /partner-render and /showcase-render
  '/demo', // "Learn with AI" demo catalog on test.hello-clio.com — public, no sign-in, per Arun's direct instruction
  '/demo/(.*)',
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

  // B2B-32 — static, single-host routing for the internal test harness (test.hello-clio.com).
  // Inserted BEFORE the isTenantHost check below so B2B-05's dynamic per-partner subdomain
  // resolution never runs for this host — "test" is not a partner's subdomain_slug, so without
  // this early branch it would fall into B2B-05's tenant-resolution logic, find no matching
  // account, and 404 before ever reaching this brief's own routes. See
  // docs/specs/B2B-32-requirement-document.md §0 point 4/§6.6.
  const testHarnessHost = process.env.TEST_HARNESS_HOST ?? ''
  if (testHarnessHost.length > 0 && host === testHarnessHost) {
    // "Learn with AI" demo catalog — fully public, no Basic Auth, no Clerk session. Separate from
    // the harness's own Basic-Auth-gated authoring surface below; checked first so it's never
    // accidentally swept into that gate.
    if (isDemoPath(pathname)) {
      return NextResponse.next()
    }
    if (pathname === '/' || isTestHarnessAuthoringPath(pathname)) {
      const authResult = checkTestHarnessBasicAuth(request)
      if (!authResult.ok) return authResult.challengeResponse
      if (pathname === '/') {
        const rewritten = request.nextUrl.clone()
        rewritten.pathname = '/test-harness'
        return NextResponse.rewrite(rewritten)
      }
      return NextResponse.next()
    }
    // Any other path on this host — never leaks the rest of the app.
    return neutralNotFoundResponse()
  }

  // Defense in depth (Known Constraint 2, AT-1): the harness's authoring pages/APIs never resolve
  // on any OTHER host, including the main hello-clio.com/distill-peach.vercel.app origin —
  // regardless of Basic Auth headers supplied. /test-harness-render/* is deliberately excluded by
  // isTestHarnessAuthoringPath (must stay public on the main app origin, §0 point 2, added to
  // isPublicRoute above).
  if (isTestHarnessAuthoringPath(pathname)) {
    return neutralNotFoundResponse()
  }

  // Same defense-in-depth for the "Learn with AI" demo catalog: it's in the global
  // `isPublicRoute` list (so Clerk never redirects it to sign-in), but per Arun's own framing
  // ("separately not part of hello-clio... build the page in test.hello-clio.com") it must not
  // actually render anywhere except the test-harness host.
  if (isDemoPath(pathname)) {
    return neutralNotFoundResponse()
  }

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
