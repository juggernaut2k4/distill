# Clio — Core Product Decisions

This file is the single source of truth for decisions made during development.
Claude reads and updates this file across sessions so context is never lost.

---

## Pricing & Plans

### Subscription Plans ✅ CONFIRMED 2026-05-18
| Plan | Monthly | Annual | Coaching mins/month | Margin |
|---|---|---|---|---|
| Free | $0 | — | 5 min (trial only) | — |
| Starter | $12/mo | $99/yr | 30 min | 76% |
| Pro | $25/mo | $199/yr | 70 min | 73% |
| Executive | $49/mo | $399/yr | 150 min | 71% |

**Cost basis:** $0.095/min total variable cost
- Recall.ai: $0.0108/min (recording $0.50/hr + transcription $0.15/hr)
- ElevenLabs Conversational AI: $0.08/min (Starter $6/75min, Creator $22/275min)
- Claude Sonnet 4.6: ~$0.0002/min (amortized with topic_content_cache)
- Infra (Supabase, Vercel, Resend): ~$0.004/min

> ⚠️ **NEEDS VERIFICATION**: Stripe Price IDs configured 2026-05-11 — confirm actual
> dollar amounts in Stripe dashboard → Products. Marketing landing page shows $19/$49/$99
> which is wrong — fix to $12/$25/$49 after Stripe confirmed.

### Trial Model ✅ CONFIRMED 2026-05-13
- All plans (including "free") go through Stripe checkout with 3-day trial
- During trial: `minutes_balance = 5`
- On trial → active: `minutes_balance` topped up to full plan allocation (30/70/150)
- Free plan maps to Starter price ID in checkout

### Annual Pricing
| Plan | Annual | Monthly equivalent | Saving |
|---|---|---|---|
| Starter | $99/yr | $8.25/mo | ~31% |
| Pro | $199/yr | $16.58/mo | ~34% |
| Executive | $399/yr | $33.25/mo | ~32% |

---

## Minute Packages (Top-Up & Commitment Add-Ons) ✅ CONFIRMED 2026-05-18

Top-ups and minute add-on packages are the same product — one set of 3 prices.
No separate Stripe Price IDs needed — uses `price_data` inline (dynamic pricing).

| Package | Price | Minutes | Cost | Profit | Margin |
|---|---|---|---|---|---|
| Small | $20 | 50 min | $4.75 | $15.25 | 76% |
| Medium | $35 | 90 min | $8.55 | $26.45 | 75.6% |
| Large | $65 | 170 min | $16.15 | $48.85 | 75.2% |

**Per-minute rate vs plans** — upgrade pressure is via convenience, not punishing price:
- Small: $0.40/min (same as Starter plan rate)
- Medium: $0.39/min
- Large: $0.38/min

**Implementation:** `app/api/checkout/topup/route.ts` — update `PACK_PRICES` map.
Currently uses old packages (60/120/300 min at $15/$25/$55) — needs updating.

---

## Architecture Decisions ✅

### Auth
- Clerk for authentication
- `NEXT_PUBLIC_CLERK_AFTER_SIGN_UP_URL` = `/checkout` (updated 2026-05-18)
- `NEXT_PUBLIC_CLERK_AFTER_SIGN_IN_URL` = `/dashboard`

### Onboarding Flow
1. User answers 5 questions on `/onboarding` (unauthenticated)
2. Answers saved to `localStorage` as `clio_onboarding`
3. Redirects to `/sign-up`
4. After sign-up, Clerk sends to `/checkout`
5. `/checkout` flushes localStorage → calls `/api/checkout` → Stripe

### Session Coaching
- Recall.ai bot joins Google Meet when session starts
- ElevenLabs voice agent handles live conversation
- 16-template visual stack pre-generated before session (`lib/session-plan.ts`)
- Templates stored in `walkthrough_state.sections` in Supabase
- `topic_content_cache` caches generated sections per topic (added 2026-05-18)
  - TTL: 14d (StatCallout/Timeline), 21d (CaseStudy), 30d (TopicHero/KeyTakeaway/ActionPlan), 60d (conceptual)

### Domain
- Production URL: `hello-clio.com`
- Stripe business URL: still `distill-peach.vercel.app` → update once domain is fully live

---

## Pending / To Confirm

| Item | Status |
|---|---|
| Stripe Price IDs — confirm actual dollar amounts | ✅ Confirmed 2026-05-18 |
| Fix marketing page pricing ($19/$49/$99 → $12/$25/$49) | ✅ Done 2026-05-18 |
| Update code: plan minutes 30/70/150 (webhook + schedule page) | ✅ Done 2026-05-18 |
| Update code: minute packages $20/50min, $35/90min, $65/170min | ✅ Done 2026-05-18 |
| Stripe business URL → hello-clio.com | 🔲 Not done (deferred until domain live) |

---

*Last updated: 2026-05-18*
