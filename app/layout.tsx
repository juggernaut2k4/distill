import type { Metadata } from 'next'
import { Inter } from 'next/font/google'
import { ClerkProvider } from '@clerk/nextjs'
import './globals.css'

const inter = Inter({ subsets: ['latin'] })

export const metadata: Metadata = {
  title: 'Clio — AI Learning for Executives',
  description: 'Personalized AI micro-learning for busy executives. 15 seconds a day. Zero jargon. Total confidence.',
  openGraph: {
    title: 'Clio — AI Learning for Executives',
    description: 'Personalized AI micro-learning for busy executives. 15 seconds a day. Zero jargon. Total confidence.',
    url: 'https://hello-clio.com',
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
          {children}
        </body>
      </html>
    </ClerkProvider>
  )
}
