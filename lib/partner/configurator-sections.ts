import type { WizardStep } from './wizard'

/**
 * Client-safe Configurator constants. Split out from `configurator-status.ts`
 * / `wizard.ts` (both of which import `lib/supabase.ts`, which uses
 * `next/headers` and cannot be imported by a 'use client' component). This
 * file has zero server-only dependencies so `ConfiguratorSurface.tsx`,
 * `DashboardPanel.tsx`, and `GoLivePanel.tsx` can import from it directly.
 */

export type ConfiguratorSection =
  | 'questionnaire'
  | 'topics'
  | 'content'
  | 'visualization'
  | 'domain'
  | 'integration'
  | 'payment'

export type ConfiguratorStatus = Record<ConfiguratorSection, boolean>

// B2B-23 WS-1 — the ONLY place that decides which sections are exposed in
// the Configurator nav. Hidden sections' routes, components, and DB tables
// remain fully intact (governance: hide, never delete) — this allowlist is
// the single toggle. Re-enabling a hidden section later is a one-line edit
// here; no other file needs to change.
export const VISIBLE_SECTIONS: ConfiguratorSection[] = ['integration', 'payment']

// B2B-23 §8 / B2B-24 §6.1 — Go-Live's required set for the API-driven
// milestone. Single source of truth for both the server gate
// (`lib/partner/wizard.ts`'s `goLive()`) and any client UI that needs to
// read it (the Dashboard panel).
export const GO_LIVE_REQUIRED_STEPS: WizardStep[] = ['integration', 'payment']
