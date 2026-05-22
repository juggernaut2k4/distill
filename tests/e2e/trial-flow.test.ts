import { test, expect } from '@playwright/test'

// ── Trial opt-in UI (/checkout) ───────────────────────────────────────────────
// Tests the S5 trial checkbox behavior on the public /checkout page.
// The PaymentElement (right panel) requires auth + Stripe; those flows are
// documented in the skip block below as manual tests.

test.describe('Trial checkbox — UI state (no auth required)', () => {
  // Note: The trial checkbox lives inside the PaymentElement wrapper which
  // only renders once clientSecret is available (requires auth).
  // Without auth, we test what IS visible: the left panel trial callout,
  // which reflects trialOptIn state passed from CheckoutContent.

  test('left panel shows "3-day free trial selected" by default', async ({ page }) => {
    await page.goto('/checkout?plan=starter')
    await page.waitForLoadState('networkidle')

    // Default state: trialOptIn = true
    await expect(page.locator('text=/3-day free trial/i').first()).toBeVisible({ timeout: 10000 })
  })

  test('left panel trial callout mentions card is not charged until trial ends', async ({ page }) => {
    await page.goto('/checkout?plan=starter')
    await page.waitForLoadState('networkidle')

    await expect(page.locator('text=/nothing is charged/i').first()).toBeVisible({ timeout: 10000 })
  })
})

test.describe('Trial banner — dashboard (requires auth, see manual block)', () => {
  // These run only when a valid session with subscription_status='trialing' exists.
  // Automated via Playwright only after setting up Clerk test tokens.
})

// ── Manual trial scenarios ────────────────────────────────────────────────────

test.describe.skip('Manual — trial lifecycle (requires auth + Stripe test mode)', () => {
  test('trial opt-in checked: 5 min balance shown in dashboard', async ({ page }) => {
    // After completing trial checkout:
    // 1. Dashboard Minutes card should show "5 / 30 min" (Starter) or similar
    // 2. Trial banner shows "3 days left in your free trial"
    // 3. "Activate plan" CTA links to /checkout
    await page.goto('/dashboard')
    await expect(page.locator('text=/days left in your free trial/i').first()).toBeVisible()
    await expect(page.locator('text=Activate plan').first()).toBeVisible()
  })

  test('trial warning turns red at T-24h', async ({ page }) => {
    // Requires manually setting trial_ends_at to < 24h from now in Supabase:
    //   UPDATE users SET trial_ends_at = NOW() + INTERVAL '20 hours' WHERE email = 'test@example.com';
    // Then reload dashboard — banner should be red with urgency message
    await page.goto('/dashboard')
    await expect(page.locator('text=/ending in.*hours|hours left/i').first()).toBeVisible()
  })

  test('trial expired — account suspended, /dashboard redirects to /plan', async ({ page }) => {
    // Requires: subscription_status = 'suspended' (set via Inngest trial-expiry job
    // or manually in Supabase)
    await page.goto('/dashboard')
    await page.waitForURL(/\/plan/, { timeout: 5000 })
    expect(page.url()).toContain('/plan')
  })

  test('paying during trial: full minutes unlocked, banner disappears', async ({ page }) => {
    // While trialing, click "Activate plan" → /checkout
    // Complete payment → webhook sets subscription_status = 'active', minutes_balance = full
    // Return to dashboard → no trial banner, full minutes shown
    await page.goto('/dashboard')
    await expect(page.locator('text=/days left/i').first()).not.toBeVisible()
  })
})

// ── Manual session timer scenarios ───────────────────────────────────────────

test.describe.skip('Manual — S6 session timer (requires auth + Recall.ai + Google Meet)', () => {
  test('timer countdown appears when bot joins meeting', async ({ page }) => {
    // 1. Schedule a session (30-min Starter plan)
    // 2. Open session detail page
    // 3. Enter a Google Meet URL and click "Launch AI Coach"
    // 4. Within 10s: timer should appear showing MM:SS countdown
    // 5. Timer starts from session.duration_mins (e.g., 30:00)
    await page.goto('/dashboard/sessions')
    // Navigate to a session detail
  })

  test('warning banner appears at T-2 minutes', async ({ page }) => {
    // Requires: session running with 2 min left (set started_at to 28 min ago for a 30-min session)
    // Dashboard session detail should show red warning: "2 minutes remaining — Clio will begin wrapping up"
    const warning = page.locator('text=/2 minutes remaining|wrapping up/i').first()
    await expect(warning).toBeVisible()
  })

  test('trial user timer capped at 5 minutes', async ({ page }) => {
    // Trial user with 5 min balance and 30-min session:
    // effectiveDurationMins = min(30, 5) = 5
    // Timer should start at 05:00, not 30:00
    const timer = page.locator('[class*="font-mono"]').filter({ hasText: /^\d{2}:\d{2}$/ }).first()
    const timerText = await timer.textContent()
    expect(timerText).toBe('05:00')
  })

  test('timer auto-ends session and deducts minutes at T-0', async ({ page }) => {
    // After timer reaches 00:00:
    // 1. Bot is removed from meeting automatically
    // 2. /api/sessions/[id]/end is called
    // 3. minutes_balance decremented by actual time used
    // 4. Session status = 'completed'
    // 5. Refresh dashboard → updated minutes shown
    await page.goto('/dashboard')
    // Check minutes_balance decreased
  })
})
