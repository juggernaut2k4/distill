import { clerkMiddleware, createRouteMatcher } from '@clerk/nextjs/server'
import { NextResponse } from 'next/server'

const isPublicRoute = createRouteMatcher([
  '/',
  '/pricing(.*)',
  '/onboarding(.*)',
  '/sign-in(.*)',
  '/sign-up(.*)',
  '/checkout(.*)',
  '/topics(.*)',
  '/dashboard/welcome(.*)',
  '/api/webhooks/(.*)',
  '/api/recall/webhook(.*)',  // Recall.ai webhook — no user auth
  '/api/tts(.*)',             // TTS audio — called by Recall.ai headless browser (no auth)
  '/api/walkthrough-state/(.*)', // Walkthrough state polling — called by headless browser
  '/api/generate-visual(.*)', // Visual generation — triggered by ElevenLabs client tool in headless browser
  '/api/clio/chat/completions', // Custom LLM endpoint — called by ElevenLabs servers (no user auth)
  '/api/admin/seed-topics',    // Admin seed — checked via secret header; Clerk session also accepted
  '/api/admin/seed-topic-cache', // Role topic cache seeder — no user session needed
  '/walkthrough/(.*)',        // Public walkthrough page shared by Recall.ai bot
])

export default clerkMiddleware((auth, request) => {
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
