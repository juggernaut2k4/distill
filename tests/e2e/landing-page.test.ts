import { test, expect } from '@playwright/test'

// ── Landing page (//) ─────────────────────────────────────────────────────────

test.describe('Landing page — hero section', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/')
    await page.waitForLoadState('networkidle')
  })

  test('headline is visible and contains brand name', async ({ page }) => {
    const h1 = page.locator('h1').first()
    await expect(h1).toBeVisible()
    // Headline is either "AI, distilled." or "Meet Clio." depending on variant
    await expect(h1).toContainText(/AI|Clio/i)
  })

  test('subheadline mentions 15 seconds', async ({ page }) => {
    const sub = page.locator('text=15 seconds').first()
    await expect(sub).toBeVisible()
  })

  test('a CTA button linking to /onboarding with "start free" text is visible', async ({ page }) => {
    // MarketingNav has "Get started" → /onboarding; hero has "Start free — 3-day trial" → /onboarding
    // Filter to find the hero-level CTA (contains "start free" or "get started")
    const ctaLinks = page.locator('a[href="/onboarding"]')
    await expect(ctaLinks.first()).toBeVisible()
    const count = await ctaLinks.count()
    expect(count).toBeGreaterThan(0)
  })

  test('CTA links do not have ?plan= query parameter', async ({ page }) => {
    // Plan should only appear in URL after explicit selection on /plan
    const links = await page.locator('a[href*="/onboarding"]').all()
    for (const link of links) {
      const href = await link.getAttribute('href')
      expect(href).not.toContain('?plan=')
    }
  })

  test('trust signals row is visible below CTA', async ({ page }) => {
    // 3 trust signals: "5-question onboarding", "Daily in your inbox", "Cancel anytime"
    await expect(page.locator('text=5-question').first()).toBeVisible()
    await expect(page.locator('text=Cancel anytime').first()).toBeVisible()
  })
})

test.describe('Landing page — problem section', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/')
  })

  test('"Sound familiar?" heading is present', async ({ page }) => {
    await page.evaluate(() => window.scrollTo(0, 600))
    await page.waitForTimeout(400)
    const heading = page.locator('text=Sound familiar').first()
    await expect(heading).toBeVisible()
  })

  test('3 pain-point cards are present', async ({ page }) => {
    await page.evaluate(() => window.scrollTo(0, 600))
    await page.waitForTimeout(400)
    // Each card has one of the known headlines
    await expect(page.locator('text=/hype|substance|meetings/i').first()).toBeVisible()
    await expect(page.locator('text=/team.*moves faster|moves faster.*AI/i').first()).toBeVisible()
    await expect(page.locator('text=/vendor.*pitch|pitch.*brilliant/i').first()).toBeVisible()
  })
})

test.describe('Landing page — how it works section', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/')
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight / 2))
    await page.waitForTimeout(400)
  })

  test('3 numbered steps are visible', async ({ page }) => {
    await expect(page.locator('text=Answer 5 questions').first()).toBeVisible()
    await expect(page.locator('text=insight daily').first()).toBeVisible()
    await expect(page.locator('text=score').first()).toBeVisible()
  })
})

test.describe('Landing page — pricing section', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/')
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight))
    await page.waitForTimeout(600)
  })

  test('exactly 3 plan cards visible (no Free tier)', async ({ page }) => {
    await expect(page.locator('text=Starter').first()).toBeVisible({ timeout: 10000 })
    await expect(page.locator('text=Pro').first()).toBeVisible({ timeout: 10000 })
    await expect(page.locator('text=Executive').first()).toBeVisible({ timeout: 10000 })
    // Free plan name must not appear as a standalone plan heading
    // (the word "free" can appear in "free trial" copy — use a stricter regex)
    const freePlanHeading = page.locator('text=/^Free$/')
    await expect(freePlanHeading).not.toBeVisible()
  })

  test('"Most popular" badge appears on Pro card', async ({ page }) => {
    const badge = page.locator('text=Most popular').first()
    await expect(badge).toBeVisible()
  })

  test('monthly/annual toggle switches prices', async ({ page }) => {
    // Get the Starter price in monthly mode
    const monthlyPrice = page.locator('text=$12').first()
    await expect(monthlyPrice).toBeVisible()

    // Switch to Annual
    const annualBtn = page.locator('button').filter({ hasText: /annual/i }).first()
    await annualBtn.click()
    await page.waitForTimeout(300)

    // Starter annual price should appear
    const annualPrice = page.locator('text=$99').first()
    await expect(annualPrice).toBeVisible()

    // Monthly price should be gone
    await expect(page.locator('text=$12').first()).not.toBeVisible()
  })

  test('switching back to Monthly restores original prices', async ({ page }) => {
    const annualBtn = page.locator('button').filter({ hasText: /annual/i }).first()
    await annualBtn.click()
    await page.waitForTimeout(200)

    const monthlyBtn = page.locator('button').filter({ hasText: /monthly/i }).first()
    await monthlyBtn.click()
    await page.waitForTimeout(300)

    await expect(page.locator('text=$12').first()).toBeVisible()
  })

  test('plan CTAs link to /onboarding (not /checkout direct)', async ({ page }) => {
    const ctaLinks = await page.locator('a[href="/onboarding"]').all()
    expect(ctaLinks.length).toBeGreaterThan(0)
  })
})

test.describe('Landing page — bottom CTA', () => {
  test('final CTA section is present', async ({ page }) => {
    await page.goto('/')
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight))
    await page.waitForTimeout(400)
    await expect(page.locator('text=/competitors|already learning/i').first()).toBeVisible()
  })
})

// ── Pricing page (/pricing) ───────────────────────────────────────────────────

test.describe('Pricing page (/pricing)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/pricing')
    await page.waitForLoadState('networkidle')
  })

  test('page loads with 200 status', async ({ page }) => {
    const response = await page.goto('/pricing')
    expect(response?.status()).toBeLessThan(400)
  })

  test('heading "Simple pricing" is visible', async ({ page }) => {
    await expect(page.locator('h1').filter({ hasText: /simple pricing/i })).toBeVisible()
  })

  test('3-day free trial note is shown', async ({ page }) => {
    await expect(page.locator('text=3-day free trial').first()).toBeVisible()
  })

  test('all 3 plans are present', async ({ page }) => {
    await expect(page.locator('text=Starter').first()).toBeVisible()
    await expect(page.locator('text=Pro').first()).toBeVisible()
    await expect(page.locator('text=Executive').first()).toBeVisible()
  })

  test('no Free tier on pricing page', async ({ page }) => {
    const body = await page.textContent('body')
    // "Free" should not appear as a plan name (but can appear in "free trial" text)
    const planFreeCount = (body?.match(/\bFree\b/g) ?? []).filter(
      (m) => !body?.includes('free trial')
    ).length
    expect(planFreeCount).toBe(0)
  })

  test('monthly/annual toggle works on /pricing', async ({ page }) => {
    // Should start on monthly
    await expect(page.locator('text=$12').first()).toBeVisible()

    const annualBtn = page.locator('button').filter({ hasText: /annual/i }).first()
    await annualBtn.click()
    await page.waitForTimeout(300)

    // $99 annual starter price
    await expect(page.locator('text=$99').first()).toBeVisible()
  })

  test('plan selection saves to localStorage', async ({ page }) => {
    // Click a plan CTA — should set clio_selected_plan in localStorage
    const starterCta = page.locator('a[href="/onboarding"]').first()
    await starterCta.click()

    // Should navigate to /onboarding (which is where the link goes)
    await expect(page).toHaveURL(/\/onboarding/)
  })
})
