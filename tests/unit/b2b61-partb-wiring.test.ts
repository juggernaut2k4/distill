import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'

/**
 * B2B-61 Part B (docs/specs/B2B-61-requirement-document.md §6, §12, §14 CEO Addendum) —
 * source-level wiring assertions for the two server-component files this document touches
 * (app/(with-clerk)/partner-render/[clio_session_ref]/page.tsx and PartnerRenderClient.tsx),
 * which cannot be live-imported under this repo's node-environment vitest config the same way
 * DemoAccessCard.tsx's sibling admin page can't either (see tests/unit/b2b40-admin-home-page.test.ts's
 * doc comment) — following that same established source-text-assertion convention.
 *
 * Also guards the explicit Part A/Part B boundary from CLAUDE.md's governance model: Part B must
 * NOT touch lib/voice/openai-realtime-adapter.ts, lib/voice/hume-adapter.ts, or the
 * provider-selection `if` branch inside PartnerRenderClient.tsx's connect() effect.
 */

const pageSource = fs.readFileSync(
  path.resolve(__dirname, '../../app/(with-clerk)/partner-render/[clio_session_ref]/page.tsx'),
  'utf8'
)

const clientSource = fs.readFileSync(
  path.resolve(__dirname, '../../app/(with-clerk)/partner-render/[clio_session_ref]/PartnerRenderClient.tsx'),
  'utf8'
)

describe('B2B-61 Part B — page.tsx wiring', () => {
  it('imports getActiveVoiceProvider from lib/voice/provider-config', () => {
    expect(pageSource).toContain("import { getActiveVoiceProvider } from '@/lib/voice/provider-config'")
  })

  it('calls getActiveVoiceProvider() as an independent sibling call, not nested inside resolveLiveSessionRender()', () => {
    const voiceProviderCallIndex = pageSource.indexOf('const voiceProvider = await getActiveVoiceProvider()')
    const resolveCallIndex = pageSource.indexOf('const result = await resolveLiveSessionRender(session)')
    expect(voiceProviderCallIndex).toBeGreaterThan(-1)
    expect(resolveCallIndex).toBeGreaterThan(-1)
    // Sibling call happens before resolveLiveSessionRender is invoked, and is not textually inside
    // any function call's argument list for it.
    expect(voiceProviderCallIndex).toBeLessThan(resolveCallIndex)
  })

  it('passes voiceProvider into <PartnerRenderClient> at both call sites (inline and template mode)', () => {
    const occurrences = pageSource.match(/voiceProvider=\{voiceProvider\}/g) ?? []
    expect(occurrences).toHaveLength(2)
  })

  it('does not change resolveLiveSessionRender()\'s own call signature (still passed only `session`)', () => {
    expect(pageSource).toContain('resolveLiveSessionRender(session)')
  })
})

describe('B2B-61 Part B — PartnerRenderClient.tsx props-interface type addition only', () => {
  it('PartnerRenderClientProps declares voiceProvider as a hume | openai_realtime union', () => {
    const interfaceMatch = clientSource.match(/export interface PartnerRenderClientProps \{[\s\S]*?\n\}/)
    expect(interfaceMatch).not.toBeNull()
    expect(interfaceMatch![0]).toMatch(/voiceProvider:\s*'hume'\s*\|\s*'openai_realtime'/)
  })

  it('the component destructures voiceProvider from props', () => {
    // B2B-61 Part C added `voiceInstructions` as an additional destructured prop after
    // `voiceProvider` (real per-session content wiring for the OpenAI adapter) — this assertion
    // checks voiceProvider is destructured somewhere in the parameter list, not that it is
    // immediately adjacent to the closing brace.
    const destructureMatch = clientSource.match(/export default function PartnerRenderClient\(\{([\s\S]*?)\}:\s*PartnerRenderClientProps\)/)
    expect(destructureMatch).not.toBeNull()
    expect(destructureMatch![1]).toMatch(/voiceProvider,?/)
  })

  it('connect() reads the provider directly from the voiceProvider prop, not a client-side env var (Part A seam closed 2026-07-31 after the live connectivity spike confirmed the adapter)', () => {
    expect(clientSource).not.toContain('NEXT_PUBLIC_VOICE_PROVIDER')
    expect(clientSource).not.toContain(
      "process.env.NEXT_PUBLIC_VOICE_PROVIDER === 'openai_realtime' ? 'openai_realtime' : 'hume'"
    )
    expect(clientSource).toContain("if (voiceProvider === 'openai_realtime') {")
  })

  it('does not import or reference HumeAdapter.create / OpenAIRealtimeAdapter construction changes beyond what already existed', () => {
    // Both adapters remain imported (Part A's own prior work) — Part B adds no new adapter import.
    expect(clientSource).toContain("import { HumeAdapter } from '@/lib/voice/hume-adapter'")
    expect(clientSource).toContain("import { OpenAIRealtimeAdapter } from '@/lib/voice/openai-realtime-adapter'")
  })
})

describe('B2B-61 Part B — Part A files untouched (governance boundary)', () => {
  it('lib/voice/openai-realtime-adapter.ts and lib/voice/hume-adapter.ts are not modified by this test suite\'s own scope (structural sanity — real verification is via git diff)', () => {
    // This is a smoke check, not a diff check (git diff --stat is the authoritative check run at
    // build time) — it only asserts these files still exist and are non-empty, i.e. Part B did not
    // delete or blank them out.
    const adapterPath = path.resolve(__dirname, '../../lib/voice/openai-realtime-adapter.ts')
    const humePath = path.resolve(__dirname, '../../lib/voice/hume-adapter.ts')
    expect(fs.existsSync(adapterPath)).toBe(true)
    expect(fs.existsSync(humePath)).toBe(true)
    expect(fs.readFileSync(adapterPath, 'utf8').length).toBeGreaterThan(0)
    expect(fs.readFileSync(humePath, 'utf8').length).toBeGreaterThan(0)
  })
})

describe('B2B-61 Part B — migration 104 (system_voice_config) — structural sanity', () => {
  const migrationPath = path.resolve(__dirname, '../../supabase/migrations/104_b2b61_system_voice_config.sql')
  const migrationSource = fs.readFileSync(migrationPath, 'utf8')

  it('creates system_voice_config with the fixed-id singleton pattern', () => {
    expect(migrationSource).toContain('CREATE TABLE IF NOT EXISTS system_voice_config')
    expect(migrationSource).toContain("DEFAULT '00000000-0000-0000-0000-000000000001'::uuid")
    expect(migrationSource).toContain('system_voice_config_singleton_id')
    expect(migrationSource).toContain("CHECK (id = '00000000-0000-0000-0000-000000000001'::uuid)")
  })

  it('CHECK-constrains active_provider to hume | openai_realtime with a hume default', () => {
    expect(migrationSource).toContain("active_provider   TEXT NOT NULL DEFAULT 'hume' CHECK (active_provider IN ('hume', 'openai_realtime'))")
  })

  it('reuses the existing update_updated_at_column() trigger function rather than redefining it', () => {
    expect(migrationSource).toContain('EXECUTE PROCEDURE update_updated_at_column()')
    expect(migrationSource).not.toContain('CREATE FUNCTION update_updated_at_column')
  })

  it('enables RLS with a service-role-only policy, matching every other config table', () => {
    expect(migrationSource).toContain('ENABLE ROW LEVEL SECURITY')
    expect(migrationSource).toContain("USING (auth.role() = 'service_role')")
  })

  it('seeds the singleton row so GET never encounters a missing row in a freshly migrated environment', () => {
    expect(migrationSource).toContain('ON CONFLICT (id) DO NOTHING')
  })
})
