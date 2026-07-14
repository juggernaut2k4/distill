import { createSupabaseAdminClient } from '@/lib/supabase'

/**
 * B2B-03 — Design-preference meter (Requirement Doc Section 6.5).
 *
 * Concrete, testable mechanics per Section 6.5:
 *   +2  a component/template-level style property change saved and unreverted ≥24h
 *   +5  [Use this template] / [Approve & push] on an AI suggestion, no change requested first
 *   +1  a Level A theme property saved and unreverted ≥24h (also records its domain)
 *   -3  [Not quite — see other options] / explicit rejection of a confident AI suggestion
 *   -1  a saved property change reverted within 24h of being set
 * Score clamped [0, 100]. "Full" = score >= 70 AND domains_touched has >= 3
 * of the 4 domains {'color','font','spacing','motion'}.
 *
 * The +2/+1 "unreverted for >=24h" rules are NOT applied synchronously here —
 * per Section 6.5 ("checked by a delayed Inngest job scheduled at save time,
 * not at read time, so this cannot be gamed by never reloading the page"),
 * they are scheduled via inngest/partner-preference-signal.ts (new, this
 * brief) at save time and only actually apply the signal when the delayed
 * job runs and confirms the value is still what was saved. The -1 "reverted
 * within 24h" signal is applied synchronously here, at the moment a revert is
 * detected (see recordPropertyRevert below), which is what makes the delayed
 * job's later application correctly a no-op for anything already reverted.
 */

export type PreferenceDomain = 'color' | 'font' | 'spacing' | 'motion'
const ALL_DOMAINS: PreferenceDomain[] = ['color', 'font', 'spacing', 'motion']

export interface PreferenceMeter {
  score: number
  domainsTouched: PreferenceDomain[]
  isFull: boolean
}

export async function getPreferenceMeter(partnerAccountId: string): Promise<PreferenceMeter> {
  const supabase = createSupabaseAdminClient()
  const { data } = await supabase
    .from('partner_design_preference')
    .select('score, domains_touched')
    .eq('partner_account_id', partnerAccountId)
    .maybeSingle()

  const score = (data?.score as number | undefined) ?? 0
  const domainsTouched = ((data?.domains_touched as string[] | undefined) ?? []).filter(
    (d): d is PreferenceDomain => (ALL_DOMAINS as string[]).includes(d)
  )

  return {
    score,
    domainsTouched,
    isFull: score >= 70 && domainsTouched.length >= 3,
  }
}

export type SignalDelta =
  | { kind: 'style_change_unreverted' } // +2
  | { kind: 'ai_accepted_without_change' } // +5
  | { kind: 'theme_property_unreverted'; domain: PreferenceDomain } // +1
  | { kind: 'ai_rejected' } // -3
  | { kind: 'property_reverted' } // -1

const DELTA_FOR_SIGNAL: Record<SignalDelta['kind'], number> = {
  style_change_unreverted: 2,
  ai_accepted_without_change: 5,
  theme_property_unreverted: 1,
  ai_rejected: -3,
  property_reverted: -1,
}

/**
 * Applies one preference signal, clamping the resulting score to [0, 100].
 * For `theme_property_unreverted`, also adds the property's domain to
 * `domains_touched` if not already present.
 */
export async function recordPreferenceSignal(partnerAccountId: string, signal: SignalDelta): Promise<PreferenceMeter> {
  const supabase = createSupabaseAdminClient()
  const current = await getPreferenceMeter(partnerAccountId)

  const delta = DELTA_FOR_SIGNAL[signal.kind]
  const nextScore = Math.max(0, Math.min(100, current.score + delta))

  const nextDomains = new Set(current.domainsTouched)
  if (signal.kind === 'theme_property_unreverted') {
    nextDomains.add(signal.domain)
  }

  const { data, error } = await supabase
    .from('partner_design_preference')
    .upsert(
      {
        partner_account_id: partnerAccountId,
        score: nextScore,
        domains_touched: Array.from(nextDomains),
      },
      { onConflict: 'partner_account_id' }
    )
    .select('score, domains_touched')
    .single()

  if (error || !data) {
    console.error('[partner/preference] recordPreferenceSignal upsert failed:', error?.message)
    return current
  }

  const domainsTouched = ((data.domains_touched as string[]) ?? []).filter(
    (d): d is PreferenceDomain => (ALL_DOMAINS as string[]).includes(d)
  )
  return {
    score: data.score as number,
    domainsTouched,
    isFull: (data.score as number) >= 70 && domainsTouched.length >= 3,
  }
}
