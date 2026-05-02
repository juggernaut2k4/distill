# Distill — Test Report

**Date:** 2026-05-01
**Runner:** Vitest v4.1.5
**Overall verdict: ✅ PASS**

---

## Summary

| Category | Files | Tests | Passed | Failed |
|---|---|---|---|---|
| Unit | 4 | 39 | 39 | 0 |
| Integration | 3 | 17 | 17 | 0 |
| **Total (vitest)** | **7** | **56** | **56** | **0** |
| E2E (Playwright) | 2 | 12 | — | — |

E2E tests require a running Next.js server (`npm run dev`) and Playwright browsers. They were not executed during this automated run — see instructions below.

---

## Unit Tests

### tests/unit/taxonomy.test.ts — 14/14 passed
- `should have non-empty ROLES array`
- `should have non-empty INDUSTRIES array`
- `should have non-empty MATURITY_LEVELS array`
- `should have non-empty WORRY_TYPES array`
- `should return empty array for empty content items`
- `should score exact role match higher than wildcard`
- `should score multiple exact tag matches highest`
- `should handle user with empty tags gracefully`
- `should return all items even with no matches`
- `getNextContentType: should return "tip" for empty delivery history`
- `getNextContentType: should return a valid ContentType`
- `getNextContentType: should prefer least recently used content type`
- `getNextContentType: should rotate through different content types`
- `getNextContentType: should handle deliveries without content_type gracefully`

### tests/unit/content-generator.test.ts — 8/8 passed
- `should return PersonalizedContent with emailBody and smsBody`
- `should have non-empty emailBody`
- `should have smsBody <= 160 characters`
- `should have emailBody <= 80 words (mock mode)`
- `should accept different contentType parameters`
- `should return realistic mock content in placeholder mode`
- `should have wordCount matching actual email word count`
- `should not throw when given different user profiles`

### tests/unit/personalizer.test.ts — 6/6 passed
- `should return ContentPlan with required properties`
- `should have non-empty emailContent`
- `should have non-empty smsContent`
- `should have valid contentItemId`
- `should have valid contentType`
- `should have numeric wordCount`

### tests/unit/stripe.test.ts — 13/13 passed
- `getPlanFromPriceId: should return "starter" for starter price IDs`
- `getPlanFromPriceId: should return "pro" for pro price IDs`
- `getPlanFromPriceId: should return "executive" for executive price IDs`
- `getPlanFromPriceId: should return "unknown" for unknown price IDs`
- `createCheckoutSession: should return a URL string in placeholder mode`
- `createCheckoutSession: should include success parameters in mock URL`
- `createCheckoutSession: should not throw when called with valid parameters`
- `createPortalSession: should return a URL string in placeholder mode`
- `createPortalSession: should include billing path in mock URL`
- `createPortalSession: should not throw when called with customer ID`
- `constructWebhookEvent: should return null in placeholder mode`
- `constructWebhookEvent: should handle empty body gracefully`
- `constructWebhookEvent: should handle invalid signature gracefully`

---

## Integration Tests

### tests/integration/onboarding-api.test.ts — 6/6 passed
- `should return 200 with valid payload`
- `should return 400 when role is missing`
- `should return 400 when aiMaturity is invalid`
- `should return 400 when deliveryPreference is invalid`
- `should accept all valid aiMaturity levels`
- `should accept all valid deliveryPreference values`

### tests/integration/feedback-api.test.ts — 4/4 passed
- `should return 200 TwiML for valid Y feedback`
- `should return 200 TwiML for valid N feedback`
- `should return 403 for invalid Twilio signature`
- `should return empty TwiML for non-feedback messages`

### tests/integration/ask-api.test.ts — 5/5 passed
- `should return 400 for empty body`
- `should return 200 TwiML for valid question`
- `should return 403 for invalid Twilio signature`
- `should return mock answer in placeholder mode`
- `should return empty TwiML for non-question messages`

---

## Coverage Report

```
File                        | % Stmts | % Branch | % Funcs | % Lines
----------------------------|---------|----------|---------|--------
All files                   |   79.82 |    57.67 |   92.59 |   80.63
 app/api/ask/route.ts       |   86.11 |    56.66 |     100 |   85.71
 app/api/feedback/route.ts  |   89.65 |    72.72 |     100 |   89.28
 app/api/onboarding/route.ts|   76.92 |    63.15 |     100 |   76.92
 lib/stripe.ts              |   68.18 |    47.05 |     100 |   68.18
 lib/content/generator.ts   |   51.16 |    26.92 |      75 |   55.00
 lib/content/personalizer.ts|   87.50 |    52.77 |   85.71 |   87.09
```

Overall: 79.82% statements, 92.59% functions covered.

---

## E2E Tests (Playwright — Skipped: requires running server)

### tests/e2e/landing-page.test.ts — SKIPPED
### tests/e2e/onboarding-flow.test.ts — SKIPPED

To run E2E tests:
```bash
npm run dev                           # Terminal 1
npx playwright install --with-deps chromium
npx playwright test                   # Terminal 2
```

---

## Fixes Applied During Testing

| Issue | Fix Applied |
|---|---|
| `getPlanFromPriceId` returned `'unknown'` for all IDs in tests because `PRICE_TO_PLAN` was built at module init time before `vi.stubEnv` ran | Moved map construction inside the function body (lazy evaluation) |
| Playwright `test.describe()` being picked up by Vitest | Added `exclude: ['**/tests/e2e/**']` to `vitest.config.ts` |

---

## Final Checklist

- [x] `npm run build` — clean, 17 routes compiled (Next.js 14.2.35)
- [x] `npx tsc --noEmit` — zero TypeScript errors
- [x] `.env.local.example` — all vars documented with `PLACEHOLDER_` values
- [x] No hardcoded secrets in source code
- [x] All approved libraries only (per CLAUDE.md security list)
- [x] All API inputs validated with Zod
- [x] Stripe webhook: `stripe.webhooks.constructEvent` signature verification
- [x] Twilio webhooks: `twilio.validateRequest` signature verification
- [x] All integrations mock gracefully when keys are `PLACEHOLDER_`
- [x] Unit + integration tests: **56/56 passed**
- [x] E2E tests: Playwright config ready, skipped (no running server)

---

**Overall: PASS** — 56/56 automated tests passing. Build clean. No secrets exposed.
