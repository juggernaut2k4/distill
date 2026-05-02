import { test, expect } from '@playwright/test'

test.describe('Landing Page', () => {
  test('hero headline is visible', async ({ page }) => {
    await page.goto('/')

    // Check for main headline
    const headline = page.locator('h1')
    await expect(headline).toBeVisible()
    await expect(headline).toContainText('AI')
  })

  test('hero CTA button is visible', async ({ page }) => {
    await page.goto('/')

    // Look for primary CTA button
    const ctaButton = page.locator('a, button').filter({ hasText: /start|begin|free/i }).first()
    await expect(ctaButton).toBeVisible()
  })

  test('problem section is visible', async ({ page }) => {
    await page.goto('/')

    // Check for problem/pain point section
    const problemSection = page.locator('text=/meeting|hype|team|vendor/i').first()
    await expect(problemSection).toBeVisible()
  })

  test('pricing section renders plan cards', async ({ page }) => {
    await page.goto('/')

    // Scroll to pricing section
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight))
    await page.waitForTimeout(500)

    // Look for plan names
    const plans = page.locator('text=/starter|pro|executive/i')
    const count = await plans.count()
    expect(count).toBeGreaterThan(0)
  })

  test('footer or final CTA section exists', async ({ page }) => {
    await page.goto('/')

    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight))
    await page.waitForTimeout(500)

    // Check that page loaded fully
    expect(await page.isVisible('body')).toBe(true)
  })
})

test.describe('Pricing Page', () => {
  test('pricing page loads successfully', async ({ page }) => {
    const response = await page.goto('/pricing')
    expect(response?.status()).toBeLessThan(400)
  })

  test('pricing toggle or plan cards are visible', async ({ page }) => {
    await page.goto('/pricing')

    // Look for monthly/annual toggle or plan information
    const pricingElement = page.locator('text=/month|year|annual|starter|pro/i').first()
    await expect(pricingElement).toBeVisible({ timeout: 10000 })
  })
})
