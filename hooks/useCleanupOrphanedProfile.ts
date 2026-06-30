'use client'

import { useEffect } from 'react'
import { useAuth } from '@clerk/nextjs'

export function useCleanupOrphanedProfile() {
  const { isSignedIn, isLoaded } = useAuth()

  useEffect(() => {
    if (!isLoaded) return
    if (isSignedIn !== false) return
    try {
      if (localStorage.getItem('clio_onboarding') !== null) {
        localStorage.removeItem('clio_onboarding')
      }
    } catch {
      // localStorage unavailable (SSR or restricted context)
    }
  }, [isLoaded, isSignedIn])
}
