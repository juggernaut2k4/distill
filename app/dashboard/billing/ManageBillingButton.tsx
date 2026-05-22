'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/Button'
import { Loader2 } from 'lucide-react'

export default function ManageBillingButton() {
  const [loading, setLoading] = useState(false)

  async function handleClick() {
    setLoading(true)
    try {
      const res = await fetch('/api/portal', { method: 'POST' })
      const data = await res.json()
      if (data.portalUrl) {
        window.location.href = data.portalUrl
      }
    } catch {
      setLoading(false)
    }
  }

  return (
    <Button
      variant="secondary"
      size="md"
      onClick={handleClick}
      disabled={loading}
      className="w-full sm:w-auto gap-2"
    >
      {loading && <Loader2 size={14} className="animate-spin" />}
      Manage billing
    </Button>
  )
}
