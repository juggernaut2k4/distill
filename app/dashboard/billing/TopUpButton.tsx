'use client'

import { useState } from 'react'
import { Zap } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { TopUpModal } from '@/components/ui/TopUpModal'

export default function TopUpButton({ currentBalance }: { currentBalance: number }) {
  const [open, setOpen] = useState(false)

  return (
    <>
      <Button variant="secondary" size="md" className="gap-1.5" onClick={() => setOpen(true)}>
        <Zap size={14} className="text-[#F59E0B]" />
        Top up minutes
      </Button>
      <TopUpModal open={open} onClose={() => setOpen(false)} currentBalance={currentBalance} />
    </>
  )
}
