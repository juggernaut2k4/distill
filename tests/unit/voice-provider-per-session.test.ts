import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'

/**
 * 2026-08-01 — persists which voice provider actually ran each session, so
 * inngest/partner-session-insights-extractor.ts (covered separately in
 * tests/unit/b2b37-partner-session-insights-guard-and-backstop.test.ts) can tell Hume sessions
 * from OpenAI ones instead of blindly calling Hume's transcript API for every session regardless
 * of provider — the bug Arun found live after a real OpenAI session's extraction failed with a
 * confusing wrong-vendor error.
 *
 * Source-text assertions for page.tsx, which cannot be live-imported under this repo's
 * node-environment vitest config (same convention as tests/unit/b2b61-partb-wiring.test.ts).
 */

const pageSource = fs.readFileSync(
  path.resolve(__dirname, '../../app/(with-clerk)/partner-render/[clio_session_ref]/page.tsx'),
  'utf8'
)
const migrationSource = fs.readFileSync(
  path.resolve(__dirname, '../../supabase/migrations/106_voice_provider_per_session.sql'),
  'utf8'
)

describe('page.tsx persists voice_provider per session at render time', () => {
  it('writes voice_provider to partner_sessions using the resolved voiceProvider value', () => {
    expect(pageSource).toContain("from('partner_sessions')")
    expect(pageSource).toContain('.update({ voice_provider: voiceProvider })')
  })

  it('runs after getActiveVoiceProvider() resolves, before resolveLiveSessionRender()', () => {
    const providerIndex = pageSource.indexOf('const voiceProvider = await getActiveVoiceProvider()')
    const writeIndex = pageSource.indexOf('.update({ voice_provider: voiceProvider })')
    const resolveIndex = pageSource.indexOf('const result = await resolveLiveSessionRender(session)')
    expect(providerIndex).toBeGreaterThan(-1)
    expect(writeIndex).toBeGreaterThan(providerIndex)
    expect(resolveIndex).toBeGreaterThan(writeIndex)
  })

  it('is best-effort — logs rather than throws if the write fails', () => {
    expect(pageSource).toContain('voiceProviderWriteError')
    expect(pageSource).toContain('non-fatal')
  })
})

describe('migration 106 — partner_sessions.voice_provider', () => {
  it('adds a nullable column constrained to hume | openai_realtime', () => {
    expect(migrationSource).toContain('ADD COLUMN IF NOT EXISTS voice_provider TEXT NULL')
    expect(migrationSource).toContain("CHECK (voice_provider IS NULL OR voice_provider IN ('hume', 'openai_realtime'))")
  })
})
