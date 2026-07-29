import type { Metadata } from 'next'
import { Inter } from 'next/font/google'
import '../globals.css'

// B2B-47: This is a root layout for the (demo) route group — deliberately Clerk-free.
// /demo/** content is rendered server-side and embedded via srcDoc into a
// sandbox="allow-scripts" iframe (no allow-same-origin) with an opaque Origin: null and no
// access to storage/cookies. Clerk's client-side init was hypothesized to throw synchronously
// in that context, tripping Next.js's error boundary and showing "Application error" during
// live screen-share demos. This tree has zero Clerk dependency by construction, structurally
// removing that failure mode. Do NOT add <ClerkProvider> or anything Clerk-dependent here.
//
// Navigating between this root layout and the (with-clerk) root layout triggers a full page
// reload rather than a client-side transition (a documented Next.js characteristic) — do not
// add a <Link> from here into a (with-clerk) route (or vice versa) expecting SPA behavior.

const inter = Inter({ subsets: ['latin'] })

export const metadata: Metadata = {
  title: 'Clio — AI Learning for Executives',
  description: 'Personalized AI micro-learning for busy executives. 15 seconds a day. Zero jargon. Total confidence.',
  manifest: '/manifest.webmanifest',
  openGraph: {
    title: 'Clio — AI Learning for Executives',
    description: 'Personalized AI micro-learning for busy executives. 15 seconds a day. Zero jargon. Total confidence.',
    url: 'https://distill-peach.vercel.app',
    siteName: 'Clio',
    locale: 'en_US',
    type: 'website',
  },
}

export default function DemoRootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en" className="dark">
      <body className={`${inter.className} bg-void text-white antialiased`}>
        {children}
      </body>
    </html>
  )
}
