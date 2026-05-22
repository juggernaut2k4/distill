import { test, expect } from '@playwright/test'

// ── Auth Gating & Bypass Protection ──────────────────────────────────────────
// Verifies that protected routes redirect unauthenticated users to sign-in
// and that the public/private route split is correct.

test.describe('Protected routes redirect to sign-in when not authenticated', () => {
  test('/dashboard requires auth', async ({ page }) => {
    const response = await page.goto('/dashboard')
    // Should either redirect (3xx resolved to sign-in page) or show sign-in
    await page.waitForURL(/sign-in|accounts\.clerk\.dev/, { timeout: 10000 })
    expect(page.url()).toMatch(/sign-in|clerk/)
  })

  test('/dashboard/sessions requires auth', async ({ page }) => {
    await page.goto('/dashboard/sessions')
    await page.waitForURL(/sign-in|accounts\.clerk\.dev/, { timeout: 10000 })
    expect(page.url()).toMatch(/sign-in|clerk/)
  })

  test('/dashboard/billing requires auth', async ({ page }) => {
    await page.goto('/dashboard/billing')
    await page.waitForURL(/sign-in|accounts\.clerk\.dev/, { timeout: 10000 })
    expect(page.url()).toMatch(/sign-in|clerk/)
  })

  test('/plan requires auth', async ({ page }) => {
    await page.goto('/plan')
    await page.waitForURL(/sign-in|accounts\.clerk\.dev/, { timeout: 10000 })
    expect(page.url()).toMatch(/sign-in|clerk/)
  })
})

test.describe('Public routes are accessible without authentication', () => {
  test('/ (landing) loads without auth', async ({ page }) => {
    const response = await page.goto('/')
    expect(response?.status()).toBeLessThan(400)
    await expect(page.locator('h1').first()).toBeVisible()
  })

  test('/pricing loads without auth', async ({ page }) => {
    const response = await page.goto('/pricing')
    expect(response?.status()).toBeLessThan(400)
    await expect(page.locator('h1').filter({ hasText: /pricing/i }).first()).toBeVisible()
  })

  test('/onboarding loads without auth', async ({ page }) => {
    const response = await page.goto('/onboarding')
    expect(response?.status()).toBeLessThan(400)
    await expect(page.locator('text=What is your role').first()).toBeVisible()
  })

  test('/checkout loads without auth (shows loading/error for payment form)', async ({ page }) => {
    const response = await page.goto('/checkout')
    // Page should load (public route) — payment API will fail but UI renders
    expect(response?.status()).toBeLessThan(400)
    // Left panel (plan summary) should always render
    await expect(page.locator('text=/starter|pro|executive/i').first()).toBeVisible({ timeout: 10000 })
  })
})

test.describe('Manipulated localStorage is handled gracefully', () => {
  test('invalid plan in localStorage falls back to starter', async ({ page }) => {
    await page.goto('/')
    // Inject an invalid plan value into localStorage
    await page.evaluate(() => localStorage.setItem('clio_selected_plan', 'ultraplan_hacked'))

    await page.goto('/checkout')
    await page.waitForLoadState('networkidle')

    // Should fall back to Starter (the default), not crash
    await expect(page.locator('text=Starter').first()).toBeVisible({ timeout: 10000 })
    // Should not show an unhandled JS crash or 500 error page
    // Note: "Connection error" from the unauthenticated API call is expected and acceptable
    await expect(page.locator('text=/something went wrong|internal server error/i').first()).not.toBeVisible()
  })

  test('invalid billing period in localStorage falls back to monthly', async ({ page }) => {
    await page.goto('/')
    await page.evaluate(() => localStorage.setItem('clio_billing_period', 'weekly_hacked'))

    await page.goto('/checkout')
    await page.waitForLoadState('networkidle')

    // Billing defaults to monthly — $12 Starter price
    await expect(page.locator('text=$12').first()).toBeVisible({ timeout: 10000 })
  })
})

test.describe('Sign-in page', () => {
  test('/sign-in page loads', async ({ page }) => {
    const response = await page.goto('/sign-in')
    expect(response?.status()).toBeLessThan(400)
  })

  test('/sign-up page loads', async ({ page }) => {
    const response = await page.goto('/sign-up')
    expect(response?.status()).toBeLessThan(400)
  })
})

// ── Manual scenarios (require real auth — run these manually) ─────────────────
// These tests document the scenarios that cannot be automated without
// a real Clerk test token. Run them manually after each deployment.

test.describe.skip('Manual — dashboard gating (requires auth)', () => {
  // MANUAL STEP 1: Sign in, do NOT complete checkout.
  // Expected: /dashboard redirects to /plan
  test('signed-in user with no subscription → /plan', async ({ page }) => {
    // Requires: Clerk session with subscription_status = null or 'canceled'
    await page.goto('/dashboard')
    await page.waitForURL(/\/plan/, { timeout: 5000 })
    expect(page.url()).toContain('/plan')
  })

  // MANUAL STEP 2: Complete trial checkout, then let trial expire.
  // Expected: /dashboard still redirects to /plan or shows suspended banner
  test('user with suspended trial → redirected from dashboard', async ({ page }) => {
    // Requires: Clerk session with subscription_status = 'suspended'
    await page.goto('/dashboard')
    await expect(page.url()).toMatch(/plan|suspended/)
  })

  // MANUAL STEP 3: Sign in + active subscription.
  // Expected: /dashboard loads fully
  test('active subscriber can access /dashboard', async ({ page }) => {
    await page.goto('/dashboard')
    await expect(page.locator('text=Dashboard').first()).toBeVisible()
  })
})
