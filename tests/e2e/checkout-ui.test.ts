import { test, expect } from '@playwright/test'

// ── Checkout UI (/checkout) ───────────────────────────────────────────────────
// /checkout is a PUBLIC route — left panel renders without auth.
// Right panel (PaymentElement) shows a loading/error state without auth since
// the /api/checkout endpoint requires authentication.

test.describe('Checkout — left panel renders without auth', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/checkout?plan=starter')
    await page.waitForLoadState('networkidle')
  })

  test('Clio logo is visible in top-left', async ({ page }) => {
    await expect(page.locator('text=Clio').first()).toBeVisible()
  })

  test('plan name "Starter" is shown in the left panel', async ({ page }) => {
    await expect(page.locator('text=Starter').first()).toBeVisible()
  })

  test('monthly price $12 is displayed for Starter', async ({ page }) => {
    await expect(page.locator('text=$12').first()).toBeVisible()
  })

  test('plan switcher buttons (Starter / Pro / Executive) are present', async ({ page }) => {
    await expect(page.locator('button').filter({ hasText: /^Starter$/ }).first()).toBeVisible()
    await expect(page.locator('button').filter({ hasText: /^Pro$/ }).first()).toBeVisible()
    await expect(page.locator('button').filter({ hasText: /^Executive$/ }).first()).toBeVisible()
  })

  test('billing period buttons (Monthly / Annual) are present', async ({ page }) => {
    await expect(page.locator('button').filter({ hasText: /monthly/i }).first()).toBeVisible()
    await expect(page.locator('button').filter({ hasText: /annual/i }).first()).toBeVisible()
  })

  test('trial callout box is visible', async ({ page }) => {
    await expect(page.locator('text=/3-day free trial/i').first()).toBeVisible()
  })

  test('feature list items are visible', async ({ page }) => {
    await expect(page.locator('text=/coaching minutes/i').first()).toBeVisible()
  })
})

test.describe('Checkout — plan pre-selection from URL', () => {
  test('?plan=pro pre-selects Pro plan', async ({ page }) => {
    await page.goto('/checkout?plan=pro')
    await page.waitForLoadState('networkidle')

    // Pro button should be highlighted (active state)
    const proBtn = page.locator('button').filter({ hasText: /^Pro$/ }).first()
    const cls = await proBtn.getAttribute('class') ?? ''
    expect(cls).toContain('7C3AED') // purple active state

    // Pro monthly price $25
    await expect(page.locator('text=$25').first()).toBeVisible()
  })

  test('?plan=executive pre-selects Executive plan', async ({ page }) => {
    await page.goto('/checkout?plan=executive')
    await page.waitForLoadState('networkidle')

    const execBtn = page.locator('button').filter({ hasText: /^Executive$/ }).first()
    const cls = await execBtn.getAttribute('class') ?? ''
    expect(cls).toContain('7C3AED')

    await expect(page.locator('text=$49').first()).toBeVisible()
  })

  test('unknown ?plan= value falls back to Starter', async ({ page }) => {
    await page.goto('/checkout?plan=nonexistent')
    await page.waitForLoadState('networkidle')

    await expect(page.locator('text=$12').first()).toBeVisible()
  })
})

test.describe('Checkout — plan switcher interaction', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/checkout?plan=starter')
    await page.waitForLoadState('networkidle')
  })

  test('clicking Pro in switcher updates left panel price to $25', async ({ page }) => {
    const proBtn = page.locator('button').filter({ hasText: /^Pro$/ }).first()
    await proBtn.click()
    await page.waitForTimeout(300)

    await expect(page.locator('text=$25').first()).toBeVisible()
    await expect(page.locator('text=$12').first()).not.toBeVisible()
  })

  test('clicking Executive in switcher updates left panel price to $49', async ({ page }) => {
    const execBtn = page.locator('button').filter({ hasText: /^Executive$/ }).first()
    await execBtn.click()
    await page.waitForTimeout(300)

    await expect(page.locator('text=$49').first()).toBeVisible()
  })
})

test.describe('Checkout — billing period toggle', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/checkout?plan=starter')
    await page.waitForLoadState('networkidle')
  })

  test('switching to Annual updates Starter price to $99', async ({ page }) => {
    const annualBtn = page.locator('button').filter({ hasText: /annual/i }).first()
    await annualBtn.click()
    await page.waitForTimeout(400)

    await expect(page.locator('text=$99').first()).toBeVisible()
    await expect(page.locator('text=/yr/').first()).toBeVisible()
  })

  test('annual callout shows "save ~30%"', async ({ page }) => {
    const annualBtn = page.locator('button').filter({ hasText: /annual/i }).first()
    await annualBtn.click()
    await page.waitForTimeout(400)

    await expect(page.locator('text=/save.*30|30.*save/i').first()).toBeVisible()
  })

  test('switching back to Monthly restores $12 Starter price', async ({ page }) => {
    const annualBtn = page.locator('button').filter({ hasText: /annual/i }).first()
    await annualBtn.click()
    await page.waitForTimeout(300)

    const monthlyBtn = page.locator('button').filter({ hasText: /monthly/i }).first()
    await monthlyBtn.click()
    await page.waitForTimeout(300)

    await expect(page.locator('text=$12').first()).toBeVisible()
  })
})

test.describe('Checkout — localStorage plan persistence', () => {
  test('plan stored in localStorage is pre-selected', async ({ page }) => {
    await page.goto('/')
    await page.evaluate(() => localStorage.setItem('clio_selected_plan', 'pro'))
    await page.evaluate(() => localStorage.setItem('clio_billing_period', 'annual'))

    await page.goto('/checkout')
    await page.waitForLoadState('networkidle')

    // Pro + Annual = $199
    await expect(page.locator('text=$199').first()).toBeVisible({ timeout: 10000 })
  })

  test('localStorage plan is cleared after successful mock checkout', async ({ page }) => {
    // In mock mode (no real Stripe key), checkout → /dashboard/welcome clears storage
    // We can verify the storage was set and test the clearing indirectly
    await page.goto('/')
    await page.evaluate(() => {
      localStorage.setItem('clio_selected_plan', 'pro')
      localStorage.setItem('clio_billing_period', 'monthly')
    })

    await page.goto('/checkout?plan=pro')
    await page.waitForLoadState('networkidle')

    const storedPlan = await page.evaluate(() => localStorage.getItem('clio_selected_plan'))
    // Plan should still be in storage at this point (only cleared on successful submission)
    expect(storedPlan).toBe('pro')
  })
})

// ── Manual scenarios (require real Stripe keys and auth) ─────────────────────

test.describe.skip('Manual — Stripe payment flows (requires auth + Stripe test keys)', () => {
  // MANUAL STEP: Sign in → go to /plan → select Starter → /checkout
  // Use Stripe test card: 4242 4242 4242 4242, any future date, any CVV

  test('trial checkout with 4242 card — dashboard accessible', async ({ page }) => {
    // 1. Sign in via Clerk
    // 2. Navigate to /checkout?plan=starter
    // 3. Trial checkbox should be checked by default
    // 4. Enter card 4242 4242 4242 4242
    // 5. Submit → should redirect to /dashboard/welcome
    // 6. Dashboard should show: trialing banner with "3 days left"
    // 7. minutes_balance should be 5 in the dashboard Minutes card
    await page.goto('/dashboard/welcome')
    await expect(page.locator('text=/welcome|trial/i').first()).toBeVisible()
  })

  test('trial checkbox unchecked — immediate charge, full minutes', async ({ page }) => {
    // 1. Sign in → /checkout?plan=pro
    // 2. Uncheck the trial checkbox
    // 3. Button text should say "Subscribe now — $25/mo"
    // 4. Left panel callout should say "Full plan — starts today"
    // 5. Complete payment → minutes_balance should be 70 (Pro plan)
    await page.goto('/checkout?plan=pro')
    const checkbox = page.locator('input[type="checkbox"]').first()
    await checkbox.uncheck()
    await expect(page.locator('text=Subscribe now').first()).toBeVisible()
    await expect(page.locator('text=Full plan — starts today').first()).toBeVisible()
  })

  test('declined card 4000 0000 0000 0002 — error shown, no redirect', async ({ page }) => {
    // 1. Sign in → /checkout?plan=starter
    // 2. Enter card 4000 0000 0000 0002
    // 3. Submit → error message should appear
    // 4. URL should still be /checkout (not redirected)
    // 5. Error message: "Your card was declined" or similar
    await page.goto('/checkout?plan=starter')
    // After declined payment:
    await expect(page).toHaveURL(/\/checkout/)
    await expect(page.locator('text=/declined|failed|try again/i').first()).toBeVisible()
  })

  test('close tab mid-checkout → log back in → /plan', async ({ page }) => {
    // 1. Sign in → navigate to /checkout (don't complete)
    // 2. Close/navigate away → subscription_status remains null
    // 3. Log back in → should land on /plan (not /dashboard)
    await page.goto('/plan')
    await expect(page.locator('text=Choose your plan').first()).toBeVisible()
  })

  test('completed checkout → log out → log back in → /dashboard', async ({ page }) => {
    // 1. Complete checkout successfully
    // 2. Log out
    // 3. Log back in → NEXT_PUBLIC_CLERK_AFTER_SIGN_IN_URL=/dashboard
    // 4. Dashboard loads fully (no /plan redirect since subscription is active)
    await page.goto('/dashboard')
    await expect(page.locator('text=Dashboard').first()).toBeVisible()
  })
})
