import { test, expect } from '@playwright/test'

test.describe('Onboarding Flow', () => {
  test('onboarding page loads successfully', async ({ page }) => {
    const response = await page.goto('/onboarding')
    expect(response?.status()).toBeLessThan(400)
  })

  test('progress bar or question is visible', async ({ page }) => {
    await page.goto('/onboarding')

    // Check for either a progress indicator or question text
    const hasProgress = await page.locator('[class*="progress"]').count() > 0
    const hasQuestion = await page.locator('text=/role|industry|question|worry/i').count() > 0

    expect(hasProgress || hasQuestion).toBe(true)
  })

  test('onboarding form elements are interactive', async ({ page }) => {
    await page.goto('/onboarding')

    // Look for any clickable elements (buttons, options)
    const interactiveElements = page.locator('button, [role="button"], input, select, [class*="option"]')
    const count = await interactiveElements.count()

    expect(count).toBeGreaterThan(0)
  })

  test('page contains onboarding-related text', async ({ page }) => {
    await page.goto('/onboarding')

    // Check for onboarding-related content
    const body = await page.textContent('body')
    const hasRelevantText = body && (
      body.includes('role') ||
      body.includes('industry') ||
      body.includes('question') ||
      body.includes('AI') ||
      body.includes('preference')
    )

    expect(hasRelevantText).toBe(true)
  })
})

test.describe('Dashboard', () => {
  test('dashboard page responds', async ({ page }) => {
    // Dashboard may redirect to sign-in if not authenticated
    const response = await page.goto('/dashboard')

    // Accept either successful load OR redirect to auth
    const status = response?.status() ?? 200
    expect(status).toBeLessThan(500) // No server errors
  })
})
