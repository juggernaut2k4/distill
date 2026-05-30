/**
 * Auth setup — run once to save authenticated session state.
 * This handles 2FA / MFA by pausing for manual code entry.
 *
 * Usage:
 *   TEST_BASE_URL=https://distill-peach.vercel.app npx playwright test tests/e2e/auth.setup.ts --headed
 *
 * This opens a real browser, logs in, pauses for you to complete 2FA,
 * then saves the session to tests/e2e/.auth/session.json
 * Subsequent test runs load that session — no login needed.
 */

import { test as setup } from '@playwright/test'
import path from 'path'

const SESSION_FILE = path.join(__dirname, '.auth', 'session.json')
const TEST_EMAIL = 'arunprakash.s2000@gmail.com'
const TEST_PASSWORD = 'Clio2026#QA'

setup('authenticate and save session', async ({ page }) => {
  await page.goto('/sign-in')
  await page.waitForLoadState('networkidle')

  // Fill email
  const emailInput = page.getByRole('textbox').first()
  await emailInput.waitFor({ state: 'visible', timeout: 15_000 })
  await emailInput.fill(TEST_EMAIL)

  // Click Clerk's form submit (not Google OAuth button)
  await page.locator('[data-localization-key="formButtonPrimary"]').click()

  // Fill password
  await page.waitForFunction(
    () => {
      const inputs = Array.from(document.querySelectorAll('input[type="password"]'))
      return inputs.some((el) => {
        const input = el as HTMLInputElement
        return !input.hidden && input.getAttribute('aria-hidden') !== 'true' && input.name !== 'hiddenPassword' && getComputedStyle(input).display !== 'none'
      })
    },
    { timeout: 15_000 }
  )
  await page.locator('input[type="password"]:not([aria-hidden="true"]):not([name="hiddenPassword"])').first().fill(TEST_PASSWORD)
  await page.locator('[data-localization-key="formButtonPrimary"]').click()

  // If 2FA page appears — pause so you can enter the code manually
  try {
    await page.waitForURL(/sign-in\/factor-two/, { timeout: 5_000 })
    console.log('\n⚠️  2FA required — enter your code in the browser window, then press Enter here to continue...')
    // Wait for user to complete 2FA — poll until URL changes
    await page.waitForURL((url) => !url.pathname.includes('/sign-in'), { timeout: 120_000 })
  } catch {
    // No 2FA — already redirected
  }

  // Wait until fully logged in
  await page.waitForURL((url) => !url.pathname.includes('/sign-in'), { timeout: 30_000 })
  console.log(`Logged in — landed on: ${page.url()}`)

  // Save session state (cookies + localStorage)
  await page.context().storageState({ path: SESSION_FILE })
  console.log(`Session saved to: ${SESSION_FILE}`)
})
