import type { Metadata } from 'next'
import { Inter } from 'next/font/google'
import { ClerkProvider } from '@clerk/nextjs'
import { CleanupOrphanedProfile } from '@/components/CleanupOrphanedProfile'
import '../globals.css'

// B2B-47: This is a root layout for the (with-clerk) route group, sitting alongside the
// Clerk-free (demo) root layout. Route groups never appear in the URL, but navigating between
// two different root layouts triggers a full page reload rather than a client-side transition
// (a documented Next.js characteristic) — do not add a <Link> from a (demo) page into this tree
// (or vice versa) expecting SPA behavior.

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

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <ClerkProvider>
      <html lang="en" className="dark">
        <body className={`${inter.className} bg-void text-white antialiased`}>
          <CleanupOrphanedProfile />
          {children}
        </body>
      </html>
    </ClerkProvider>
  )
}
