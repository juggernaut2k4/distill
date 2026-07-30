import { describe, it, expect } from 'vitest'
import { resolveDeliveryStatus, resolveReference, formatAmount } from '@/lib/partner/usage-log'

/**
 * B2B-57b Requirement Doc §13 — unit coverage for the pure delivery-status resolution table (§6.4),
 * Reference-field precedence (§6.1), and Amount-string formatting (§4/§9) that back the Usage log
 * screen (`GET /api/partner/dashboard/usage-log`, `UsageLogClient.tsx`).
 */

describe('resolveDeliveryStatus — §6.4 five-state resolution table', () => {
  it('delivered -> Delivered, regardless of retry_count/delivery_configured', () => {
    expect(resolveDeliveryStatus('delivered', 0, true)).toBe('delivered')
    expect(resolveDeliveryStatus('delivered', 3, false)).toBe('delivered')
  })

  it('exhausted -> Failed, regardless of retry_count/delivery_configured', () => {
    expect(resolveDeliveryStatus('exhausted', 5, true)).toBe('failed')
    expect(resolveDeliveryStatus('exhausted', 0, false)).toBe('failed')
  })

  it('legacy/unused "failed" DB value -> Failed (handled defensively, same bucket as exhausted, §0)', () => {
    expect(resolveDeliveryStatus('failed', 0, true)).toBe('failed')
  })

  it('pending, retry_count=0, delivery_configured=false -> Delivery not configured', () => {
    expect(resolveDeliveryStatus('pending', 0, false)).toBe('not_configured')
  })

  it('pending, retry_count=0, delivery_configured=true -> Pending', () => {
    expect(resolveDeliveryStatus('pending', 0, true)).toBe('pending')
  })

  it('pending, retry_count > 0 -> Retrying, regardless of delivery_configured', () => {
    expect(resolveDeliveryStatus('pending', 1, true)).toBe('retrying')
    expect(resolveDeliveryStatus('pending', 4, false)).toBe('retrying')
  })
})

describe('resolveReference — §9 edge case, partner_reference takes priority', () => {
  it('returns partner_reference when both partner_reference and reseller_unique_id are populated', () => {
    expect(resolveReference('order-48213', 'other-ref')).toBe('order-48213')
  })

  it('falls back to reseller_unique_id when partner_reference is null', () => {
    expect(resolveReference(null, 'order-48213')).toBe('order-48213')
  })

  it('returns null when both are null', () => {
    expect(resolveReference(null, null)).toBeNull()
  })
})

describe('formatAmount — §4 point 4 / §9 edge cases', () => {
  it('session.completed always renders an em dash, even with a stray quantity', () => {
    expect(formatAmount('session.completed', null, null, null)).toBe('—')
    expect(formatAmount('session.completed', 1, 'calls', null)).toBe('—')
  })

  it('session.insights_ready always renders an em dash', () => {
    expect(formatAmount('session.insights_ready', null, null, null)).toBe('—')
  })

  it('usage.voice_minute renders "{quantity} {unit}" for a non-1 quantity', () => {
    expect(formatAmount('usage.voice_minute', 14.2, 'minutes', null)).toBe('14.2 minutes')
    expect(formatAmount('usage.voice_minute', 8.5, 'minutes', null)).toBe('8.5 minutes')
  })

  it('usage.llm_generation_call renders "{quantity} {unit} (generation_type)" — singularizing "calls" at quantity 1', () => {
    expect(formatAmount('usage.llm_generation_call', 1, 'calls', 'topic')).toBe('1 call (topic)')
  })

  it('usage.llm_generation_call with quantity > 1 stays plural', () => {
    expect(formatAmount('usage.llm_generation_call', 3, 'calls', 'content')).toBe('3 calls (content)')
  })

  it('§9 edge case — generation_type null renders no parenthetical, never "(null)"', () => {
    expect(formatAmount('usage.llm_generation_call', 2, 'calls', null)).toBe('2 calls')
  })

  it('null quantity renders an em dash even for a usage.* type', () => {
    expect(formatAmount('usage.voice_minute', null, 'minutes', null)).toBe('—')
  })
})
