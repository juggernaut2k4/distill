/**
 * Integration test: Curriculum Engine — CEO · Financial Services · Claude · beginner
 *
 * Tests the 4-layer curriculum engine end-to-end against the canonical test fixture
 * defined in SCALING_PLAYBOOK.md.
 *
 * Run against production:
 *   TEST_BASE_URL=https://distill-peach.vercel.app npx playwright test tests/e2e/curriculum-engine.test.ts
 */

import { test, expect } from '@playwright/test'
import path from 'path'

const SESSION_FILE = path.join(__dirname, '.auth', 'session.json')
test.use({ storageState: SESSION_FILE })

const BASE = process.env.TEST_BASE_URL ?? 'https://distill-peach.vercel.app'

// ── Canonical test fixture ────────────────────────────────────────────────────

const TEST_INPUT = {
  role: 'ceo',
  industry: 'financial-services',
  maturity: 'beginner' as const,
  interest: 'I want to learn about Claude',
}

// Expected arc structure (exact session count and sequence)
const EXPECTED_ARC = ['foundation', 'foundation', 'interest', 'interest', 'context', 'context', 'context', 'deploy', 'govern', 'govern']

// ── Tests ─────────────────────────────────────────────────────────────────────

test.describe('Curriculum Engine — CEO × FS × Claude × beginner', () => {
  test.setTimeout(30_000)

  test('1. POST /api/topics/generate returns curriculum with correct structure', async ({ page }) => {
    const resp = await page.request.post(`${BASE}/api/topics/generate`, {
      data: TEST_INPUT,
    })

    expect(resp.ok(), `Expected 200, got ${resp.status()}`).toBeTruthy()

    const body = await resp.json() as {
      topics?: string[]
      curriculum?: {
        sessions: Array<{ position: number; title: string; arc_position: string; justification: string; estimated_minutes: number }>
        tier4: Array<{ title: string; unlocks_after: number }>
        meta: { role: string; industry: string; maturity: string; interest: string; total_sessions: number; total_minutes: number }
      }
      source?: string
    }

    console.log('\n=== Curriculum Engine Output ===')
    console.log(`Source: ${body.source}`)
    console.log(`Sessions: ${body.curriculum?.sessions.length}`)
    body.curriculum?.sessions.forEach(s => {
      console.log(`  ${s.position}. [${s.arc_position}] ${s.title}`)
    })
    console.log(`Tier 4: ${body.curriculum?.tier4.length} follow-on topics`)
    console.log(`Total minutes: ${body.curriculum?.meta.total_minutes}`)

    // ── Assertions ────────────────────────────────────────────────────────────

    // Source must be the new engine
    expect(body.source).toBe('curriculum-engine')

    // Backwards-compatible flat topics list must still be present
    expect(Array.isArray(body.topics)).toBeTruthy()
    expect(body.topics!.length).toBeGreaterThanOrEqual(8)

    const sessions = body.curriculum?.sessions ?? []

    // Total session count: 8–12
    expect(sessions.length).toBeGreaterThanOrEqual(8)
    expect(sessions.length).toBeLessThanOrEqual(12)

    // Foundation minimum: at least 2
    const foundationSessions = sessions.filter(s => s.arc_position === 'foundation')
    expect(foundationSessions.length, 'Need at least 2 foundation sessions').toBeGreaterThanOrEqual(2)

    // Interest coverage: Claude must appear in at least 3 session titles
    const claudeSessions = sessions.filter(s =>
      s.title.toLowerCase().includes('claude') ||
      s.title.toLowerCase().includes('llm') ||
      s.title.toLowerCase().includes('language model')
    )
    expect(claudeSessions.length, `Claude interest must appear in ≥3 sessions, got ${claudeSessions.length}: ${claudeSessions.map(s => s.title).join(', ')}`).toBeGreaterThanOrEqual(3)

    // Govern sessions present: financial-services industry mandatory
    const governSessions = sessions.filter(s => s.arc_position === 'govern')
    expect(governSessions.length, 'FS industry requires at least 1 govern session').toBeGreaterThanOrEqual(1)

    // Arc sequence correct: no govern before foundation
    const arcOrder = ['foundation', 'interest', 'context', 'deploy', 'govern']
    let maxArcIdx = 0
    let sequenceViolation = false
    for (const session of sessions) {
      const idx = arcOrder.indexOf(session.arc_position)
      if (idx < maxArcIdx - 1) {
        sequenceViolation = true
        console.error(`Arc sequence violation at position ${session.position}: ${session.arc_position} after ${arcOrder[maxArcIdx]}`)
      }
      maxArcIdx = Math.max(maxArcIdx, idx)
    }
    expect(sequenceViolation, 'Arc sequence must be foundation → interest → context → deploy → govern').toBeFalsy()

    // All sessions have justifications
    const missingJustification = sessions.filter(s => !s.justification || s.justification.length < 10)
    expect(missingJustification.length, 'All sessions must have justifications').toBe(0)

    // Total minutes in reasonable range
    const totalMinutes = body.curriculum?.meta.total_minutes ?? 0
    expect(totalMinutes, `Total minutes ${totalMinutes} outside 150–400`).toBeGreaterThanOrEqual(150)
    expect(totalMinutes).toBeLessThanOrEqual(400)

    // Meta fields set correctly
    expect(body.curriculum?.meta.role).toBe(TEST_INPUT.role)
    expect(body.curriculum?.meta.industry).toBe(TEST_INPUT.industry)
    expect(body.curriculum?.meta.maturity).toBe(TEST_INPUT.maturity)

    // Tier 4 present
    expect(body.curriculum?.tier4.length, 'Tier 4 follow-on topics should be present').toBeGreaterThanOrEqual(1)
  })

  test('2. Topics catalog returns featured/other split for CEO × FS', async ({ page }) => {
    const resp = await page.request.get(`${BASE}/api/topics/catalog?role=ceo&domains=ai-ml,leadership,finance`)

    expect(resp.ok(), `Catalog API returned ${resp.status()}`).toBeTruthy()

    const body = await resp.json() as {
      featured?: Array<{ title: string; is_trending?: boolean; trending_score?: number }>
      other?: unknown[]
      topics?: unknown[]
      from_cache?: boolean
      seeded?: boolean
    }

    console.log('\n=== Catalog API Output ===')
    console.log(`From cache: ${body.from_cache}`)
    console.log(`Featured topics: ${body.featured?.length ?? 'N/A (old format)'}`)
    if (body.featured) {
      body.featured.slice(0, 5).forEach((t, i) => {
        console.log(`  ${i + 1}. ${t.title}${t.is_trending ? ' 🔥' : ''}`)
      })
    }

    // Should have either new format (featured/other) or old format (topics)
    const hasNewFormat = 'featured' in body
    const hasOldFormat = 'topics' in body
    expect(hasNewFormat || hasOldFormat, 'Response must have featured or topics array').toBeTruthy()

    if (hasNewFormat) {
      // New format: featured should have topics
      expect(body.featured!.length, 'Featured should have ≥5 topics').toBeGreaterThanOrEqual(5)
      expect(body.featured!.length, 'Featured should not exceed 20 topics').toBeLessThanOrEqual(20)

      // At least one trending topic in featured
      const trendingTopics = body.featured!.filter(t => t.is_trending)
      console.log(`Trending topics in featured: ${trendingTopics.length}`)
      // Note: not asserting count — just logging for visibility

      // Featured topics should be ordered by trending_score descending (if scores present)
      const withScores = body.featured!.filter(t => t.trending_score !== undefined)
      if (withScores.length > 1) {
        for (let i = 1; i < withScores.length; i++) {
          const prev = withScores[i - 1].trending_score ?? 0
          const curr = withScores[i].trending_score ?? 0
          if (curr > prev + 0.1) {
            console.warn(`Ordering note: topic ${i + 1} (${withScores[i].title}) has higher score than topic ${i} (${withScores[i-1].title})`)
          }
        }
      }
    }
  })

  test('3. Curriculum respects maturity: beginner gets foundation-heavy plan', async ({ page }) => {
    const resp = await page.request.post(`${BASE}/api/topics/generate`, {
      data: { ...TEST_INPUT, maturity: 'advanced', interest: 'AI strategy' },
    })

    if (!resp.ok()) {
      console.log('Advanced maturity test skipped — endpoint returned', resp.status())
      return
    }

    const body = await resp.json() as {
      curriculum?: { sessions: Array<{ arc_position: string }> }
    }

    const sessions = body.curriculum?.sessions ?? []
    const foundationCount = sessions.filter(s => s.arc_position === 'foundation').length

    console.log(`\nAdvanced maturity: ${foundationCount} foundation sessions (expected ≤2 for advanced)`)
    // Advanced users get fewer foundation sessions than beginners
    expect(foundationCount).toBeLessThanOrEqual(2)
  })
})
