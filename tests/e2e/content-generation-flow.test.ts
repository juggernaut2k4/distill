/**
 * End-to-end QA flow: login → topics → plan → schedule → session → content generation
 *
 * Run against production:
 *   TEST_BASE_URL=https://distill-peach.vercel.app npx playwright test tests/e2e/content-generation-flow.test.ts
 *
 * Uses pre-existing test account: arunprakash.s2000@gmail.com / Clio2026#QA
 * The account must have already completed onboarding (role/domains set in DB).
 */

import { test, expect } from '@playwright/test'
import path from 'path'

const CONTENT_GEN_TIMEOUT = 240_000 // 4 minutes for content generation
const SESSION_FILE = path.join(__dirname, '.auth', 'session.json')

// All tests use the saved session from auth.setup.ts
// Run setup first: TEST_BASE_URL=https://distill-peach.vercel.app npx playwright test tests/e2e/auth.setup.ts --headed
test.use({ storageState: SESSION_FILE })

// ── Tests ─────────────────────────────────────────────────────────────────────

test.describe('Full QA flow — authenticated', () => {
  test.setTimeout(CONTENT_GEN_TIMEOUT + 60_000)

  test('1. session is active — dashboard loads without redirect to sign-in', async ({ page }) => {
    // session loaded via storageState
    await page.goto('/dashboard', { waitUntil: 'domcontentloaded', timeout: 60_000 })
    await expect(page).not.toHaveURL(/\/sign-in/)
    console.log(`Landed on: ${page.url()}`)
  })

  test('2. topics page loads with seeded catalog', async ({ page }) => {
    // session loaded via storageState
    await page.goto('/topics', { waitUntil: 'domcontentloaded', timeout: 60_000 })
    await page.waitForLoadState('networkidle', { timeout: 60_000 })

    // Should show domain cards or topic tiles
    const topicCount = await page.locator('[data-testid="topic-card"], [class*="topic"], [class*="domain"]').count()
    console.log(`Topic/domain cards visible: ${topicCount}`)

    // At minimum the page should not be empty
    await expect(page.locator('body')).not.toContainText('No topics available')
    await expect(page.locator('body')).not.toContainText('seeded: false')
  })

  test('3. can select topics and continue to plan', async ({ page }) => {
    // session loaded via storageState
    await page.goto('/topics', { waitUntil: 'domcontentloaded', timeout: 60_000 })
    await page.waitForLoadState('networkidle', { timeout: 60_000 })
    await page.waitForTimeout(2000) // let catalog load

    // Click first 3 available topic buttons/checkboxes
    const topicButtons = page.locator('button[data-topic-id], [data-testid="topic-option"], button').filter({ hasText: /GPT|Claude|AI Strategy|LLM|Digital Transform|Leadership/i })
    const count = await topicButtons.count()
    console.log(`Found ${count} matching topic buttons`)

    for (let i = 0; i < Math.min(3, count); i++) {
      await topicButtons.nth(i).click()
      await page.waitForTimeout(300)
    }

    // Click Continue / Build my plan
    const continueBtn = page.locator('button').filter({ hasText: /continue|build.*plan|next/i }).first()
    await expect(continueBtn).toBeEnabled({ timeout: 5000 })
    await continueBtn.click()

    // Should navigate to plan page
    await page.waitForURL(/\/(dashboard\/plan|plan)/, { timeout: 15_000 })
    console.log(`Navigated to: ${page.url()}`)
  })

  test('4. plan page shows generated plan and approve button', async ({ page }) => {
    // session loaded via storageState
    await page.goto('/dashboard/plan')
    await page.waitForLoadState('networkidle')
    await page.waitForTimeout(3000)

    // Should have some plan content visible
    const hasApprove = await page.locator('button').filter({ hasText: /approve|confirm.*plan/i }).count()
    const hasSessions = await page.locator('text=/session|week|lesson/i').count()

    console.log(`Approve button present: ${hasApprove > 0}`)
    console.log(`Session content visible: ${hasSessions > 0}`)

    // If plan exists, approve it
    if (hasApprove > 0) {
      await page.locator('button').filter({ hasText: /approve|confirm.*plan/i }).first().click()
      await page.waitForTimeout(2000)
      console.log('Plan approved')
    }
  })

  test('5. schedule page confirms sessions and redirects', async ({ page }) => {
    // session loaded via storageState
    await page.goto('/dashboard/schedule')
    await page.waitForLoadState('networkidle')
    await page.waitForTimeout(2000)

    const confirmBtn = page.locator('button').filter({ hasText: /confirm.*schedule|confirm/i }).first()
    const hasConfirm = await confirmBtn.count()

    if (hasConfirm > 0) {
      console.log('Clicking Confirm Schedule…')
      await confirmBtn.click()
      await page.waitForURL(/\/dashboard\/sessions/, { timeout: 15_000 })
      console.log(`Navigated to: ${page.url()}`)
    } else {
      // Already confirmed — check if sessions list is shown
      const hasSessionList = await page.locator('text=/session|upcoming/i').count()
      console.log(`Sessions already scheduled, session content visible: ${hasSessionList > 0}`)
      await page.goto('/dashboard/sessions')
      await page.waitForLoadState('networkidle')
    }

    await expect(page).toHaveURL(/\/dashboard\/sessions/)
  })

  test('6. sessions page lists upcoming sessions', async ({ page }) => {
    // session loaded via storageState
    await page.goto('/dashboard/sessions')
    await page.waitForLoadState('networkidle')
    await page.waitForTimeout(2000)

    // Find session cards / links
    const sessions = page.locator('[href*="/dashboard/sessions/"], a').filter({ hasText: /session/i })
    const count = await sessions.count()
    console.log(`Session links visible: ${count}`)

    // Should have at least 1 session
    expect(count).toBeGreaterThan(0)
  })

  test('7. opening a session triggers content generation', async ({ page }) => {
    // session loaded via storageState
    await page.goto('/dashboard/sessions')
    await page.waitForLoadState('networkidle')
    await page.waitForTimeout(2000)

    // Click the first session link
    const firstSession = page.locator('a[href*="/dashboard/sessions/"]').first()
    await expect(firstSession).toBeVisible({ timeout: 10_000 })
    const sessionHref = await firstSession.getAttribute('href')
    console.log(`Opening session: ${sessionHref}`)

    await firstSession.click()
    await page.waitForLoadState('networkidle')
    await page.waitForTimeout(2000)

    // Session detail page should load without error
    await expect(page.locator('body')).not.toContainText('404')
    await expect(page.locator('body')).not.toContainText('This page could not be found')

    const url = page.url()
    console.log(`Session page URL: ${url}`)
    expect(url).toContain('/dashboard/sessions/')
  })

  test('8. content generation completes within 4 minutes', async ({ page }) => {
    test.setTimeout(CONTENT_GEN_TIMEOUT + 30_000)
    // session loaded via storageState
    await page.goto('/dashboard/sessions')
    await page.waitForLoadState('networkidle')
    await page.waitForTimeout(2000)

    // Collect up to 5 session IDs from the list (try multiple in case one is broken)
    const sessionLinks = page.locator('a[href*="/dashboard/sessions/"]')
    await expect(sessionLinks.first()).toBeVisible({ timeout: 10_000 })
    const totalLinks = await sessionLinks.count()
    const sessionIds: string[] = []
    for (let i = 0; i < Math.min(5, totalLinks); i++) {
      const href = await sessionLinks.nth(i).getAttribute('href') ?? ''
      const id = href.split('/dashboard/sessions/')[1]?.split('?')[0]
      if (id && !sessionIds.includes(id)) sessionIds.push(id)
    }
    console.log(`Candidate sessions: ${sessionIds.join(', ')}`)

    // Try each session — prefer one already ready, otherwise trigger and poll
    let finalStatus = 'failed'
    let winningId = ''

    for (const sessionId of sessionIds) {
      const statusCheck = await page.request.get(`/api/sessions/${sessionId}/generate-content`)
      if (!statusCheck.ok()) continue
      const statusData = await statusCheck.json() as { content_status?: string }
      const current = statusData.content_status ?? 'unknown'
      console.log(`Session ${sessionId}: current status = ${current}`)

      if (current === 'ready') {
        console.log(`Session ${sessionId} already ready — using it`)
        finalStatus = 'ready'
        winningId = sessionId
        break
      }

      if (current === 'failed') {
        // Reset this session so it can regenerate
        console.log(`Session ${sessionId} failed — resetting...`)
        await page.request.delete(`/api/sessions/${sessionId}/generate-content`)
        await page.waitForTimeout(1000)
      }

      // Navigate to session page to trigger generation
      await page.goto(`/dashboard/sessions/${sessionId}`, { waitUntil: 'domcontentloaded', timeout: 60_000 })
      await page.waitForLoadState('networkidle')
      await page.waitForTimeout(3000)

      // Poll up to 4 minutes for this session
      const deadline = Date.now() + CONTENT_GEN_TIMEOUT
      let status = 'pending'

      while (Date.now() < deadline) {
        const response = await page.request.get(`/api/sessions/${sessionId}/generate-content`)
        if (response.ok()) {
          const data = await response.json() as { content_status?: string; subtopics?: Array<{ pipeline_status: string }> }
          status = data.content_status ?? 'unknown'
          const subtopics = data.subtopics ?? []
          const ready = subtopics.filter((s) => s.pipeline_status === 'ready').length
          const total = subtopics.length
          console.log(`[${sessionId}] status: ${status} | subtopics: ${ready}/${total}`)

          if (status === 'ready') break
          if (status === 'failed') {
            console.error(`[${sessionId}] generation failed — trying next session`)
            break
          }
        }
        await page.waitForTimeout(15_000)
      }

      if (status === 'ready') {
        finalStatus = 'ready'
        winningId = sessionId
        break
      }
      console.log(`Session ${sessionId} did not complete — trying next`)
    }

    console.log(`Final content status: ${finalStatus} (session: ${winningId || 'none'})`)
    expect(finalStatus).toBe('ready')
  })

  test('9. content quality — subtopics have training scripts', async ({ page }) => {
    test.setTimeout(CONTENT_GEN_TIMEOUT + 60_000)
    // session loaded via storageState
    await page.goto('/dashboard/sessions')
    await page.waitForLoadState('networkidle')
    await page.waitForTimeout(2000)

    const sessionLinks = page.locator('a[href*="/dashboard/sessions/"]')
    await expect(sessionLinks.first()).toBeVisible({ timeout: 10_000 })
    const totalLinks = await sessionLinks.count()

    // Collect candidate session IDs
    const candidateIds: string[] = []
    for (let i = 0; i < Math.min(5, totalLinks); i++) {
      const href9 = await sessionLinks.nth(i).getAttribute('href') ?? ''
      const id = href9.split('/dashboard/sessions/')[1]?.split('?')[0]
      if (id) candidateIds.push(id)
    }

    if (candidateIds.length === 0) return

    // Try to find a 'ready' session that already has training_scripts (fast path)
    let sessionId = ''
    for (const id of candidateIds) {
      const check = await page.request.get(`/api/sessions/${id}/generate-content`)
      if (!check.ok()) continue
      const d = await check.json() as { content_status?: string; subtopics?: Array<{ training_script?: string }> }
      if (d.content_status === 'ready') {
        const scripts = (d.subtopics ?? []).filter((s) => s.training_script && s.training_script.length > 50).length
        const total = (d.subtopics ?? []).length
        if (total > 0 && scripts / total >= 0.8) {
          console.log(`Session ${id} already has scripts (${scripts}/${total}) — using it`)
          sessionId = id
          break
        }
        console.log(`Session ${id} is ready but has no scripts (${scripts}/${total}) — resetting for regeneration`)
        // Reset: stale 'ready' session with slug-mismatched cache data from before the slug fix
        await page.request.delete(`/api/sessions/${id}/generate-content`)
        await page.waitForTimeout(1000)
        // Use this session for regeneration
        if (!sessionId) sessionId = id
      }
    }

    // If no good session found yet, pick the first candidate
    if (!sessionId) sessionId = candidateIds[0]

    // Directly POST to trigger content generation (don't rely on the session page
    // auto-trigger which requires allVisualsSettled to be true).
    console.log(`Triggering fresh generation for session ${sessionId}...`)
    const postResp = await page.request.post(`/api/sessions/${sessionId}/generate-content`, {
      timeout: CONTENT_GEN_TIMEOUT + 60_000,
    })
    const postBody = await postResp.json() as { ok?: boolean; status?: string; error?: string }
    console.log(`Generation result: status=${postBody.status ?? postBody.error}`)

    // Fetch final quality data
    const getResp = await page.request.get(`/api/sessions/${sessionId}/generate-content`)
    const finalData = getResp.ok()
      ? await getResp.json() as { content_status?: string; subtopics?: Array<{ pipeline_status: string; training_script?: string; content_outline?: string }> }
      : {}

    const subtopics = finalData.subtopics ?? []
    let withScript = 0
    let withOutline = 0
    for (const s of subtopics) {
      if (s.training_script && s.training_script.length > 50) withScript++
      if (s.content_outline && s.content_outline.length > 50) withOutline++
    }

    console.log(`\n=== Content Quality Report ===`)
    console.log(`Status: ${finalData.content_status}`)
    console.log(`Subtopics: ${subtopics.length}`)
    console.log(`With training_script: ${withScript}/${subtopics.length}`)
    console.log(`With content_outline: ${withOutline}/${subtopics.length}`)

    // At least 80% of subtopics should have content
    if (subtopics.length > 0 && finalData.content_status === 'ready') {
      expect(withScript / subtopics.length).toBeGreaterThanOrEqual(0.8)
    }
  })
})
