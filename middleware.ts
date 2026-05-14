import { clerkMiddleware, createRouteMatcher } from '@clerk/nextjs/server'

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
  '/walkthrough/(.*)',        // Public walkthrough page shared by Recall.ai bot
])

export default clerkMiddleware((auth, request) => {
  if (!isPublicRoute(request)) {
    auth().protect()
  }
})

export const config = {
  matcher: [
    // Skip Next.js internals and all static files, unless found in search params
    '/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)',
    // Always run for API routes
    '/(api|trpc)(.*)',
  ],
}
