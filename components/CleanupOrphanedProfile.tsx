'use client'

import { useCleanupOrphanedProfile } from '@/hooks/useCleanupOrphanedProfile'

export function CleanupOrphanedProfile() {
  useCleanupOrphanedProfile()
  return null
}
