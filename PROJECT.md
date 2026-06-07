# Clio — Master Project Record

**Product:** Clio (rebranded from Distill)
**Owner:** Arun Prakash
**Domain:** distill-peach.vercel.app
**Stack:** Next.js 14, Supabase, Clerk, Stripe, Twilio, Resend, Anthropic Claude, Recall.ai, ElevenLabs, Inngest, Vercel
**Last updated:** 2026-05-18

---

## 1. Product Vision

Clio is a personalized AI coaching platform for senior executives (CEOs, VPs, CU Leads, BU Leads, Product Sponsors). Executives are caught in a paradox: their roles are pure management, but AI is moving faster than any prior technology wave, leaving them unable to confidently evaluate AI investments, vendors, or initiatives.

Clio solves this through:
- **Daily AI micro-learning**: 15–20 second personalized insights by email/SMS
- **Live AI coaching sessions**: 1:1 sessions with Clio (AI voice agent) in Google Meet
- **Adaptive personalization**: content adjusts based on Y/N feedback, role, industry, maturity level
- **AI Readiness Score**: visible progress metric that grows as users engage

**Core promise:** 15 seconds a day. Zero jargon. Total confidence.

---

## 2. Target Users

| Role | Primary Pain |
|---|---|
| CEO / MD / President | Board-level AI governance, when to invest, competitive threat |
| VP (Technology / Product / Operations) | ROI clarity, vendor evaluation, team readiness |
| CU Lead / Practice Head | AI use cases for their domain, implementation lessons |
| BU Lead / Functional Head | Practical AI applications in their function |
| Product Sponsor / Owner | Evaluating AI product pitches, build vs. buy |
| Director / Senior Manager | General AI literacy, speaking the language of AI |

---

## 3. Pricing & Business Model

### Cost Basis (real, verified 2026-05-18)
| Component | Rate | Source |
|---|---|---|
| Recall.ai (recording + transcription) | $0.0108/min | $0.50/hr + $0.15/hr |
| ElevenLabs Conversational AI | $0.0800/min | Starter $6/75min = $0.08/min |
| Claude Sonnet 4.6 (amortized with cache) | $0.0002/min | $3/MTok in, $15/MTok out |
| Infra (Supabase, Vercel, Resend) | $0.0040/min | ~$5/user/month shared |
| **Total variable cost** | **$0.095/min** | |

### Subscription Plans ✅ CONFIRMED 2026-05-18
| Plan | Monthly | Annual | Coaching mins/month | ~Sessions | Margin |
|---|---|---|---|---|---|
| Free | $0 | — | 5 min (trial only) | — | — |
| Starter | $12/mo | $99/yr | 30 min | ~1–2 | 76% |
| Pro | $25/mo | $199/yr | 70 min | ~2–4 | 73% |
| Executive | $49/mo | $399/yr | 150 min | ~5–10 | 71% |
| Enterprise | Custom | Custom | Custom | Custom | Custom |

> ⚠️ Stripe Price IDs configured 2026-05-11 — confirm actual dollar amounts in Stripe dashboard.
> Marketing landing page shows $19/$49/$99 (wrong) — fix after Stripe confirmed.

### Minute Packages ✅ CONFIRMED 2026-05-18
Top-ups and add-on packages are the same product. No separate Stripe Price IDs needed (dynamic pricing).

| Package | Price | Minutes | Margin |
|---|---|---|---|
| Small | $20 | 50 min | 76% |
| Medium | $35 | 90 min | 75.6% |
| Large | $65 | 170 min | 75.2% |

---

## 4. What's Built ✅

### Core Platform
- [x] **Onboarding flow** — 5-question tap UI, role/industry/maturity/worry/delivery preference
- [x] **Auth** — Clerk sign-in/sign-up, Google OAuth, post-signup redirect to `/checkout`
- [x] **Checkout flow** — `/checkout` flushes localStorage onboarding data → Stripe subscription
- [x] **Stripe subscriptions** — checkout sessions, 3-day trial, webhook handlers (created/updated/deleted/payment_failed/trial_will_end)
- [x] **Stripe top-up** — one-time payment checkout for minute top-ups (`/api/checkout/topup`)
- [x] **User profile** — role, industry, maturity, delivery preference, timezone, plan tier
- [x] **Minutes system** — `minutes_balance`, `minutes_included`, `add_minutes` RPC, deducted per session
- [x] **Supabase schema** — users, sessions, topics, walkthrough_state, delivery_log, sms_conversations, topic_content_cache

### AI Coaching Sessions (Core Differentiator)
- [x] **Session scheduling** — calendar UI, Google Meet auto-creation, session duration selection (15/30 min)
- [x] **Agenda email** — sent 30 min before session via Resend
- [x] **Session reminders** — SMS + email reminders via Inngest
- [x] **Recall.ai bot** — joins Google Meet at session start, mediates ElevenLabs voice agent
- [x] **ElevenLabs voice agent** — Clio speaks live in the session, knows the topic before joining
- [x] **16-template visual stack** — full-screen scroll-snap layout pre-generated per session:
  - TopicHero, ConceptDefinition, StepFlow, ComparisonTable, TwoByTwoMatrix, FrameworkCard
  - ProsCons, CaseStudy, StatCallout, Timeline, ConceptMap, QuoteCallout
  - KeyTakeaway, QuestionAnswer, ActionPlan, Funnel
- [x] **Template content cache** — `topic_content_cache` table; cache hits skip Claude entirely, serve from DB
  - TTL: 14d (StatCallout/Timeline), 21d (CaseStudy), 30d (TopicHero/KeyTakeaway/ActionPlan), 60d (conceptual)
- [x] **SessionStack UI** — full-screen vertical scroll-snap rendering all template sections
- [x] **`show_visual` ElevenLabs tool** — Clio calls `scroll_to` to advance the visual stack during session
- [x] **Deferred questions** — questions beyond session scope captured for follow-up

### Content & Learning
- [x] **Topic catalog** — 22 topics across AI fundamentals, strategy, ethics, regulation, product, finance, etc.
- [x] **AI-generated topic list** — Claude generates personalized topic recommendations from user objectives
- [x] **Subtopic catalog** — 5 subtopics per topic, 110 total
- [x] **Template selector** — keyword-based selector assigns optimal template per subtopic + position
- [x] **Template generator** — Claude generates structured data per template type with executive framing
- [x] **Daily delivery** — Inngest cron, personalized email/SMS insights per user
- [x] **Weekly digest** — Sunday email summary
- [x] **Feedback processor** — Y/N responses update content weights, recalibration at 5 consecutive N

### Dashboard & UX
- [x] **Dashboard** — AI Readiness Score ring, streak counter, minutes balance card
- [x] **Sessions page** — upcoming + past sessions, session detail view
- [x] **Plan page** — topic cards, curriculum view, two-panel subtopic layout
- [x] **Schedule page** — plan selection, calendar, session scheduling, top-up UI
- [x] **Billing page** — current plan, manage billing (Stripe portal), upgrade option
- [x] **Settings page** — sign out, delete account (full data wipe)
- [x] **Messages page** — coming soon placeholder
- [x] **Welcome page** — post-payment confirmation
- [x] **Phone setup** — OTP verification, E.164 normalization
- [x] **Back button** — between onboarding steps
- [x] **Google OAuth** — white background fix for dark theme

### Infrastructure
- [x] **Vercel deployment** — production at distill-peach.vercel.app
- [x] **Environment variables** — all 9 Stripe keys, Clerk, Supabase, Resend, Twilio, Anthropic, Recall.ai, ElevenLabs, Inngest configured in Vercel
- [x] **`NEXT_PUBLIC_CLERK_AFTER_SIGN_UP_URL`** — updated to `/checkout` (2026-05-18)
- [x] **Topic content cache migration** — `009_topic_content_cache.sql` applied to Supabase (2026-05-18)

---

## 5. Active Backlog 🔲

> Items agreed but not yet built. Prioritized by impact.

| ID | Item | Priority | Notes |
|---|---|---|---|
| B-01 | Fix marketing page pricing ($19/$49/$99 → correct values) | ✅ Done | Fixed to $12/$25/$49 monthly, $99/$199/$399 annual 2026-05-18 |
| B-02 | Update webhook minute allocations (30/60/120 → 30/70/150) | ✅ Done | Updated stripe webhook + schedule page + pricing pages 2026-05-18 |
| B-03 | Update minute packages in code ($20/50min, $35/90min, $65/170min) | ✅ Done | `app/api/checkout/topup/route.ts` updated 2026-05-18 |
| B-04 | No top-up Stripe Price ID env vars needed | ✅ Confirmed | Uses dynamic price_data inline |
| B-05 | Update Stripe business URL from distill-peach.vercel.app → distill-peach.vercel.app | P1 | Do when domain DNS is live (currently not pointing to Vercel) |
| B-12 | Complete Stripe setup — products, price IDs, webhook | P0 | See Section 11 below — do this next session |
| B-13 | Connect distill-peach.vercel.app DNS to Vercel | P0 | Add A record 76.76.21.21 + CNAME www → cname.vercel-dns.com at registrar |
| B-06 | Messages page — build actual messages/delivery history | P2 | Currently shows "coming soon" |
| B-07 | Enterprise tier — bulk seats, admin dashboard, SSO | P3 | Post-revenue |
| B-08 | Referral system — invite colleague, both get free week | P3 | Post-revenue |
| B-09 | Meeting Prep Mode — "I have a vendor demo tomorrow" brief | P2 | Brief mentions this as growth feature |
| B-10 | GDPR consent flow at onboarding for EU users | P2 | Legal requirement if EU launch |
| B-11 | Content freshness engine — real-time RSS + NewsAPI ingestion | P2 | Currently static catalog |

---

## 6. Deferred / Parked Items 🗂️

| Item | Why Deferred | Revisit When |
|---|---|---|
| Twilio dedicated numbers per user (Executive) | Complexity + cost; all using shared pool currently | Executive plan has meaningful volume |
| Ask Anything SMS (reply any question → Claude answers) | Backend built, not wired to live product | SMS delivery is active |
| Voice coaching via Twilio Voice (not Meet) | ElevenLabs + Meet working well | Explicit user request |
| Playwright E2E tests | Build pressure; unit tests exist | Pre-launch hardening |
| Annual billing toggle working end-to-end | UI exists, Stripe price IDs need annual variants | After monthly is confirmed working |
| Content from NewsAPI (real-time ingestion) | Placeholder mocks working | Post-launch |
| AI Readiness Score growth curve | Calculation exists, display exists | Real user feedback data |

---

## 7. Key Architecture Decisions

### Session Flow
```
User schedules session → Google Meet created → agenda email sent (30 min before)
→ Recall.ai bot joins Meet at session time
→ ElevenLabs agent activates (knows topic_title from walkthrough_state)
→ Claude pre-generates 16 template sections (or serves from topic_content_cache)
→ SessionStack renders full-screen visual stack
→ Clio calls show_visual tool → scroll_to advances to next section
→ Session ends → minutes deducted → session logged
```

### Content Cache Strategy
- Cache key: `(topic_id, subtopic_slug)` — shared across all users
- User's role/industry patched onto meta at read time (data shared, display context personalized)
- First user generates, all subsequent users get instant DB read
- TTL varies by template type (time-sensitive content expires faster)

### Auth & Onboarding
- Onboarding is pre-auth (no Clerk session needed)
- Answers saved to `localStorage` as `clio_onboarding`
- After Clerk sign-up → `/checkout` flushes localStorage → creates DB record → Stripe checkout
- Returning signed-in users hitting `/onboarding` are redirected to dashboard immediately

### Stripe Top-Up
- Uses `price_data` inline (dynamic, no pre-created price objects)
- `checkout.session.completed` webhook with `metadata.type = 'topup'` credits minutes via `add_minutes` RPC
- Mock mode: credits minutes directly to DB when Stripe keys not configured

---

## 8. Pitch / Market Context

### Problem Size
- 1M+ senior executives in Fortune 5000 companies globally
- AI transformation is board-level priority at 87% of enterprises (McKinsey 2025)
- 73% of executives report feeling unprepared to lead AI initiatives
- Average executive has <20 min/week for non-meeting learning

### Competitive Landscape
| Competitor | Approach | Gap Clio fills |
|---|---|---|
| LinkedIn Learning / Coursera | Long-form courses, hours of content | Executives won't complete them |
| Morning Brew / newsletters | Broad tech news, not personalized | Signal-to-noise too low for exec decision-making |
| McKinsey / BCG reports | Deep, paid, one-off | Not daily habit-forming |
| ChatGPT (self-serve) | Requires user initiative | Passive delivery; no structured learning path |
| Executive coaches | High-cost 1:1 human | $500–2000/hr; not scalable |

**Clio's moat:** Personalized to exact role + industry + maturity. Delivered passively (no initiative needed). Habit-forming (daily). Live AI coaching on-demand. Affordable.

### Business Model Strengths
- Recurring SaaS revenue (monthly/annual subscriptions)
- Usage-based upsell (minute top-ups when balance runs out)
- Low marginal cost per user (AI-generated content, shared infrastructure)
- High switching cost (learning history, AI Readiness Score, personalized plan)
- Enterprise path: bulk seats for L&D / HR teams

### Metrics to Track (Pre-Launch)
- Activation rate: % completing onboarding → first session
- Day-7 retention
- Session completion rate (% who finish a scheduled session)
- Minutes consumed per user per month
- Top-up conversion rate (users who buy more minutes)
- Feedback rate on daily insights (Y/N response rate)

---

## 9. Open Questions for Arun

| # | Question | Context |
|---|---|---|
| 1 | What are the actual Stripe prices configured for Starter/Pro/Executive? | Need to fix marketing page inconsistency |
| 2 | What minute quantities for $20/$35/$65 top-up packs? | Code ready, just need the numbers |
| 3 | Is the brand name definitely "Clio" or still being decided? | Brief says "Distill", app says "Clio" |
| 4 | Is distill-peach.vercel.app live and pointing to Vercel? | Stripe URL update depends on this |
| 5 | Enterprise tier — any early conversations with potential customers? | Helps prioritize B-07 |

---

## 10. Environment Variables (Vercel — Production)

All configured. Key ones:

| Variable | Status | Notes |
|---|---|---|
| `ANTHROPIC_API_KEY` | ✅ Set | |
| `CLERK_SECRET_KEY` | ✅ Set | |
| `NEXT_PUBLIC_CLERK_AFTER_SIGN_UP_URL` | ✅ `/checkout` | Updated 2026-05-18 |
| `STRIPE_SECRET_KEY` | ✅ Set | Configured 2026-05-11 |
| `STRIPE_STARTER_MONTHLY_PRICE_ID` | ✅ Set | Configured 2026-05-11 |
| `STRIPE_PRO_MONTHLY_PRICE_ID` | ✅ Set | Configured 2026-05-11 |
| `STRIPE_EXECUTIVE_MONTHLY_PRICE_ID` | ✅ Set | Configured 2026-05-11 |
| `STRIPE_STARTER_ANNUAL_PRICE_ID` | ✅ Set | Configured 2026-05-11 |
| `STRIPE_PRO_ANNUAL_PRICE_ID` | ✅ Set | Configured 2026-05-11 |
| `STRIPE_EXECUTIVE_ANNUAL_PRICE_ID` | ✅ Set | Configured 2026-05-11 |
| `RECALL_AI_API_KEY` | ✅ Set | |
| `ELEVENLABS_AGENT_ID` | ✅ Set | |
| `NEXT_PUBLIC_SUPABASE_URL` | ✅ Set | |
| `SUPABASE_SERVICE_ROLE_KEY` | ✅ Set | |
| `RESEND_API_KEY` | ✅ Set | |
| `TWILIO_ACCOUNT_SID` | ✅ Set | |
| `GOOGLE_SERVICE_ACCOUNT_EMAIL` | ✅ Set | For Google Meet creation |
| `INNGEST_EVENT_KEY` | ✅ Set | |
| No `STRIPE_TOPUP_*` vars needed | — | Top-ups use dynamic `price_data` |

---

---

## 11. Stripe Setup — TODO Next Session 🔲

> Not yet complete. Checkout returns 500 because products/prices not created and webhook not configured.
> Use `distill-peach.vercel.app` for all URLs until `distill-peach.vercel.app` DNS is live.

### Step 1 — Create Products & Prices in Stripe
Go to: **Stripe Dashboard → Products → Add product**

Create 3 products, each with 2 prices (monthly + annual):

| Product Name | Description | Monthly Price | Annual Price |
|---|---|---|---|
| Clio Starter | AI coaching — 30 min/month | $12.00/mo recurring | $99.00/yr recurring |
| Clio Pro | AI coaching — 70 min/month | $25.00/mo recurring | $199.00/yr recurring |
| Clio Executive | AI coaching — 150 min/month | $49.00/mo recurring | $399.00/yr recurring |

For each price: set **billing period**, tick **3-day free trial**.
After creating, copy the **Price ID** (starts with `price_`).

### Step 2 — Add Price IDs to Vercel
Go to: **Vercel → distill project → Settings → Environment Variables**

| Variable | Value |
|---|---|
| `STRIPE_STARTER_MONTHLY_PRICE_ID` | price_xxx from Starter $12/mo |
| `STRIPE_STARTER_ANNUAL_PRICE_ID` | price_xxx from Starter $99/yr |
| `STRIPE_PRO_MONTHLY_PRICE_ID` | price_xxx from Pro $25/mo |
| `STRIPE_PRO_ANNUAL_PRICE_ID` | price_xxx from Pro $199/yr |
| `STRIPE_EXECUTIVE_MONTHLY_PRICE_ID` | price_xxx from Executive $49/mo |
| `STRIPE_EXECUTIVE_ANNUAL_PRICE_ID` | price_xxx from Executive $399/yr |

### Step 3 — Create Webhook in Stripe
Go to: **Stripe Dashboard → Developers → Webhooks → Add endpoint**

- **URL:** `https://distill-peach.vercel.app/api/webhooks/stripe`
  *(update to distill-peach.vercel.app once DNS is live — see B-05)*
- **Events to listen for:**
  - `checkout.session.completed`
  - `customer.subscription.created`
  - `customer.subscription.updated`
  - `customer.subscription.deleted`
  - `invoice.payment_failed`
  - `customer.subscription.trial_will_end`
- After saving, click **Reveal signing secret** → copy `whsec_...`

### Step 4 — Add Webhook Secret to Vercel
| Variable | Value |
|---|---|
| `STRIPE_WEBHOOK_SECRET` | whsec_xxx copied from webhook endpoint |

### Step 5 — Redeploy
After all env vars are set, trigger a redeploy:
```
npx vercel --prod
```
Or in Claude Code: ask Claude to deploy.

### Step 6 — Test with Stripe Test Card
Use card: `4242 4242 4242 4242` · any future expiry · any CVC
Confirm: checkout page → Stripe → back to dashboard/welcome

---

## 12. DNS Setup — distill-peach.vercel.app 🔲

Domain registered but not pointing to Vercel. Nameservers are third-party.

Go to your domain registrar (wherever distill-peach.vercel.app was purchased) and add:

| Type | Name | Value |
|---|---|---|
| `A` | `@` (root) | `76.76.21.21` |
| `CNAME` | `www` | `cname.vercel-dns.com` |

After adding records, Vercel will auto-verify (check: Vercel → project → Settings → Domains).
DNS propagation can take up to 24h but usually under 30 min.

Once live: update Stripe webhook URL from `distill-peach.vercel.app` → `distill-peach.vercel.app`.

---

*Last updated: 2026-05-18 | Maintained by Claude — update this file after every confirmed decision*
