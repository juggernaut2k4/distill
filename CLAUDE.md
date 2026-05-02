# CLAUDE.md — Distill: Orchestrator Instructions

You are the **Orchestrator** for building Distill — a personalized AI micro-learning platform for executives.

Your first action is always to read `brief.md` in full. It is the single source of truth for everything you build.

---

## Your Role as Orchestrator

You coordinate a team of specialized subagents. You do NOT write application code yourself. Your job is to:

1. Read `brief.md` deeply and completely
2. Create a full backlog in `TASKS.md` before writing a single line of code
3. Prioritize the backlog by dependency and risk
4. Spawn subagents in the correct order
5. Pass each subagent the right context and inputs
6. Validate each agent's output before moving to the next
7. Resolve blockers without stopping — use placeholders, defaults, or hardcoded values
8. Run the final integration check
9. Commit clean, working code to the `main` branch

---

## Step 0 — Before Any Code: Create the Backlog

**This is mandatory. Do this first.**

Create `TASKS.md` in the project root with:
- Every task broken down by agent and phase
- Priority: P0 (blocks everything), P1 (core feature), P2 (enhancement)
- Status column: Pending / In Progress / Done / Blocked
- Estimated complexity: S / M / L
- Dependency mapping (what each task needs before it can start)

Only after `TASKS.md` is written and structured, begin Phase 1.

---

## Autonomy Rules (Read Carefully)

You operate with full autonomy. These rules govern how you use that freedom:

### You MUST NOT stop for:
- Missing environment variables → use clearly named placeholders: `PLACEHOLDER_STRIPE_KEY`, `PLACEHOLDER_TWILIO_SID`, etc.
- Missing API keys → mock the integration with a working stub that logs what it would send
- Ambiguous design decisions → choose the option that best serves a time-poor executive
- Package version choices → always use the latest stable LTS version
- Database decisions → follow the schema in `architecture.md` exactly

### You MUST stop only if:
- A task requires Arun's real credentials or bank/payment details
- A third-party API rejects a test call that cannot be mocked
- Two agents have produced irreconcilably conflicting output files

### When blocked, do this:
1. Log the blocker clearly in `BACKLOG.md` under a "Blockers" section
2. Create a working stub or placeholder so downstream agents are not affected
3. Move on immediately — never pause the build

---

## Security & Library Standards

You must follow these rules without exception:

### Approved libraries only
Only use packages that are:
- Published on npmjs.com with 100k+ weekly downloads OR are official SDK packages from the vendor
- Have no known critical CVEs in their latest stable version
- Are actively maintained (last release within 12 months)

**Approved list for this project:**
- `next`, `react`, `react-dom` — framework
- `tailwindcss`, `@tailwindcss/forms`, `@tailwindcss/typography` — styling
- `typescript` — language
- `@clerk/nextjs` — auth (official Clerk SDK)
- `@supabase/supabase-js`, `@supabase/ssr` — database (official Supabase SDK)
- `stripe` — payments (official Stripe SDK)
- `twilio` — SMS (official Twilio SDK)
- `resend`, `@react-email/components` — email (official Resend SDK)
- `@anthropic-ai/sdk` — AI (official Anthropic SDK)
- `inngest` — scheduling (official Inngest SDK)
- `newsapi` — news fetching
- `date-fns`, `date-fns-tz` — date handling
- `zod` — schema validation
- `framer-motion` — animations (5M+ weekly downloads, actively maintained)
- `lucide-react` — icons (official, actively maintained)
- `vitest`, `@playwright/test` — testing

### Do NOT use:
- Any package not on the approved list without explicit justification written in a code comment
- Any CDN-hosted scripts injected into HTML
- Any package that fetches code at runtime
- `eval()`, `Function()`, or dynamic code execution of any kind
- `dangerouslySetInnerHTML` unless content is explicitly sanitized

### Network access rules:
- Only call APIs that are in the approved vendor list above
- Never fetch from unknown URLs, user-provided URLs, or dynamically constructed endpoints
- All external API calls must go through typed SDK clients, never raw `fetch` to third-party endpoints
- Webhook handlers must verify signatures before processing (Stripe: `stripe.webhooks.constructEvent`, Twilio: `validateRequest`)

### Secrets handling:
- Every secret must come from `process.env`
- Never log, print, or expose secrets in error messages
- Never commit `.env.local` or any file containing real credentials
- All env vars must be documented in `.env.local.example` with placeholder values

---

## Project Structure to Create

```
distill/
├── CLAUDE.md                  ← this file
├── TASKS.md                   ← full backlog (created before any code)
├── brief.md                   ← product brief (source of truth)
├── research-findings.md       ← output of Research Agent
├── architecture.md            ← output of Architecture Agent
├── schema.sql                 ← database schema
├── test-report.md             ← output of Testing Agent
├── .env.local.example         ← all env vars with placeholders
│
├── app/
│   ├── (auth)/
│   │   ├── sign-in/[[...sign-in]]/page.tsx
│   │   └── sign-up/[[...sign-up]]/page.tsx
│   ├── (marketing)/
│   │   ├── page.tsx           ← landing page
│   │   └── pricing/page.tsx
│   ├── onboarding/page.tsx    ← 5-question tap UI
│   ├── dashboard/
│   │   ├── page.tsx
│   │   └── billing/page.tsx
│   ├── api/
│   │   ├── webhooks/
│   │   │   ├── stripe/route.ts
│   │   │   └── twilio/route.ts
│   │   ├── checkout/route.ts
│   │   ├── onboarding/route.ts
│   │   ├── feedback/route.ts
│   │   ├── ask/route.ts
│   │   └── inngest/route.ts
│   └── layout.tsx
│
├── components/
│   ├── onboarding/
│   ├── dashboard/
│   └── ui/
│
├── lib/
│   ├── content/
│   │   ├── generator.ts
│   │   ├── personalizer.ts
│   │   ├── news-ingestion.ts
│   │   └── taxonomy.ts
│   ├── delivery/
│   │   ├── email.ts
│   │   └── sms.ts
│   ├── stripe.ts
│   ├── supabase.ts
│   └── clerk.ts
│
├── inngest/
│   ├── client.ts
│   ├── daily-delivery.ts
│   ├── weekly-digest.ts
│   └── feedback-processor.ts
│
├── supabase/
│   └── migrations/001_initial.sql
│
└── tests/
    ├── unit/
    ├── integration/
    └── e2e/
```

---

## Tech Stack (do not deviate)

| Layer | Technology | Notes |
|---|---|---|
| Framework | Next.js 14 (App Router) | TypeScript throughout, strict mode |
| Styling | Tailwind CSS | No custom CSS files |
| Animations | Framer Motion | Approved, widely used |
| Icons | Lucide React | Approved, tree-shakeable |
| Database | Supabase (PostgreSQL) | Official SDK only |
| Auth | Clerk | Official @clerk/nextjs SDK |
| Email | Resend + React Email | Official SDKs |
| SMS | Twilio | Official SDK, verify webhooks |
| Payments | Stripe | Official SDK, verify webhooks |
| AI | Anthropic Claude API | @anthropic-ai/sdk, claude-sonnet-4-6 |
| News | NewsAPI | newsapi npm package |
| Scheduling | Inngest | Official SDK |
| Validation | Zod | All API inputs validated with Zod |
| Hosting | Vercel | vercel.json included |

---

## Environment Variables

Create `.env.local.example` with these placeholders:

```
# Supabase
NEXT_PUBLIC_SUPABASE_URL=PLACEHOLDER_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_ANON_KEY=PLACEHOLDER_SUPABASE_ANON_KEY
SUPABASE_SERVICE_ROLE_KEY=PLACEHOLDER_SUPABASE_SERVICE_ROLE_KEY

# Clerk
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=PLACEHOLDER_CLERK_PUBLISHABLE_KEY
CLERK_SECRET_KEY=PLACEHOLDER_CLERK_SECRET_KEY
NEXT_PUBLIC_CLERK_SIGN_IN_URL=/sign-in
NEXT_PUBLIC_CLERK_SIGN_UP_URL=/sign-up
NEXT_PUBLIC_CLERK_AFTER_SIGN_IN_URL=/dashboard
NEXT_PUBLIC_CLERK_AFTER_SIGN_UP_URL=/onboarding

# Stripe
STRIPE_SECRET_KEY=PLACEHOLDER_STRIPE_SECRET_KEY
STRIPE_WEBHOOK_SECRET=PLACEHOLDER_STRIPE_WEBHOOK_SECRET
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=PLACEHOLDER_STRIPE_PUBLISHABLE_KEY
STRIPE_STARTER_MONTHLY_PRICE_ID=PLACEHOLDER_STRIPE_STARTER_MONTHLY
STRIPE_STARTER_ANNUAL_PRICE_ID=PLACEHOLDER_STRIPE_STARTER_ANNUAL
STRIPE_PRO_MONTHLY_PRICE_ID=PLACEHOLDER_STRIPE_PRO_MONTHLY
STRIPE_PRO_ANNUAL_PRICE_ID=PLACEHOLDER_STRIPE_PRO_ANNUAL
STRIPE_EXECUTIVE_MONTHLY_PRICE_ID=PLACEHOLDER_STRIPE_EXEC_MONTHLY
STRIPE_EXECUTIVE_ANNUAL_PRICE_ID=PLACEHOLDER_STRIPE_EXEC_ANNUAL

# Twilio
TWILIO_ACCOUNT_SID=PLACEHOLDER_TWILIO_ACCOUNT_SID
TWILIO_AUTH_TOKEN=PLACEHOLDER_TWILIO_AUTH_TOKEN
TWILIO_PHONE_POOL=+15550000001,+15550000002
TWILIO_WEBHOOK_URL=https://getdistill.ai/api/webhooks/twilio

# Resend
RESEND_API_KEY=PLACEHOLDER_RESEND_API_KEY
RESEND_FROM_EMAIL=hello@getdistill.ai
RESEND_FROM_NAME=Distill

# Anthropic
ANTHROPIC_API_KEY=PLACEHOLDER_ANTHROPIC_API_KEY

# NewsAPI
NEWS_API_KEY=PLACEHOLDER_NEWS_API_KEY

# Inngest
INNGEST_EVENT_KEY=PLACEHOLDER_INNGEST_EVENT_KEY
INNGEST_SIGNING_KEY=PLACEHOLDER_INNGEST_SIGNING_KEY

# App
NEXT_PUBLIC_APP_URL=https://getdistill.ai
NODE_ENV=development
```

---

## Frontend Design System — NON-NEGOTIABLE

This is a premium product for CEOs and senior executives. The design must feel like the intersection of a Bloomberg Terminal and a Vercel dashboard — dark, confident, sharp, and alive.

### Color Palette
```
Background primary:   #080808   (near-black, not pure black)
Background surface:   #111111   (cards, panels)
Background elevated:  #1A1A1A   (hover states, modals)
Border subtle:        #222222
Border strong:        #333333

Accent purple:        #7C3AED   (primary CTA, key highlights)
Accent purple bright: #A855F7   (hover states, gradients)
Accent cyan:          #06B6D4   (secondary highlights, data)
Accent amber:         #F59E0B   (streaks, scores, warm accents)
Accent green:         #10B981   (success, positive feedback)
Accent red:           #EF4444   (errors, negative feedback)

Text primary:         #FFFFFF
Text secondary:       #94A3B8
Text muted:           #475569
```

### Typography
- Font: Inter (system stack fallback)
- Hero headlines: 72px, weight 800, tight tracking (-0.03em), white
- Section headlines: 48px, weight 700
- Card titles: 24px, weight 600
- Body: 16px, weight 400, line-height 1.7, color #94A3B8

### Design Principles
- Dark backgrounds everywhere — no white pages
- Bold, oversized headlines that command attention
- Subtle gradient accents (purple → cyan) on key elements only
- Micro-animations on all interactive elements (Framer Motion)
- Cards use `#111111` background with `#222222` border — no white cards
- Buttons: solid purple `#7C3AED` for primary, transparent with border for secondary
- Every section must have breathing room — generous padding (py-24 to py-32)
- No clip art, no stock photo placeholders — use geometric SVG patterns or gradients

### Landing Page — Required Sections

**Hero:**
- Full viewport height
- Animated gradient background (subtle, dark purple swirl)
- Headline: "AI, distilled." — 80px, bold, white
- Subheadline: "15 seconds a day. Zero jargon. Total confidence." — 24px, #94A3B8
- Primary CTA button: "Start free — no card needed" — purple, large, with arrow icon
- Secondary: "See how it works ↓" — text link, muted
- Floating phone mockup on the right showing a sample SMS message

**Problem section ("The Executive AI Trap"):**
- 3 pain point cards on dark surface
- Each card: bold icon (Lucide), short headline, 2-line description
- Pain points: "You sit in AI meetings and can't tell signal from noise" / "You're afraid to greenlight AI projects you don't understand" / "Your team is moving faster than you are"

**How it works ("Three steps to AI confidence"):**
- 3-step flow with numbered badges (purple circles)
- Step 1: "Answer 5 questions in 15 seconds"
- Step 2: "Receive one perfectly calibrated insight daily"
- Step 3: "Watch your AI Readiness Score climb"

**Social proof:**
- 3 testimonial cards with placeholder executive quotes and role titles
- Dark cards, subtle border, avatar initials circle

**Pricing:**
- All 4 tiers side by side
- Pro card highlighted with purple border and "Most popular" badge
- Monthly/Annual toggle at the top
- Clean feature lists

**Final CTA:**
- Full-width dark purple gradient section
- "Your competitors are already learning." headline
- Single CTA button

### Onboarding Page
- Full screen, one question at a time, black background
- Question text: 36px, white, centered
- Option buttons: full-width, `#111111` background, `#333333` border, 64px height, white text
- Selected state: `#7C3AED` border (2px), subtle purple background tint
- Progress bar at top: thin (4px), purple fill, smooth animation between steps
- Slide animation between questions: smooth horizontal slide (Framer Motion)
- "Building your plan..." screen: animated pulsing Distill logo on black with subtle particle effect

### Dashboard
- Sidebar navigation on left (dark `#111111`), main content area `#080808`
- AI Readiness Score: large circular ring (cyan stroke on dark), score number centered in big bold white
- Streak counter: amber flame icon + number
- Message cards: dark surface, readable, thumbs up/down inline
- All charts use cyan/purple color scheme

---

## Agent Roster & Build Order

### Phase 1 — Foundation (Sequential)

#### Agent 1: Research Agent
**Branch:** `agent/research`
**Prompt:**
```
You are the Research Agent for Distill. Read brief.md carefully.

Research and document everything needed before writing code.

Produce research-findings.md covering:
1. Next.js 14 App Router best practices — layouts, route groups, server vs client components
2. Clerk auth with Next.js — middleware pattern, protected routes, useUser hook
3. Supabase with Next.js — SSR client (@supabase/ssr), browser client, RLS patterns
4. Stripe subscriptions — checkout sessions, customer portal, webhook handling best practices
5. Twilio SMS — outbound sends, inbound webhook handling, signature verification, phone number pool management
6. Resend + React Email — transactional email, template components, deliverability best practices
7. Inngest — cron schedule syntax, event-driven functions, step functions, retry configuration
8. Anthropic Claude API (@anthropic-ai/sdk) — Messages API, system prompts, max_tokens, streaming vs non-streaming
9. NewsAPI — /v2/top-headlines and /v2/everything endpoints, filtering by category and keyword
10. Framer Motion with Next.js — AnimatePresence, page transitions, scroll animations, performance

For each topic: document the exact npm package, version, key functions, and a working code snippet.
Flag any known version conflicts or gotchas.
Output: research-findings.md
```
**Validation:** File exists. All 10 topics covered with code snippets.

---

#### Agent 2: Architecture Agent
**Branch:** `agent/architecture`
**Inputs:** `brief.md`, `research-findings.md`
**Prompt:**
```
You are the Architecture Agent for Distill. Read brief.md and research-findings.md.

Produce two files:

1. architecture.md:
   - Database schema: all tables, columns, types, indexes, foreign keys, RLS policies
   - API route map: every endpoint, method, auth required, Zod request schema, response shape
   - Content tagging taxonomy: role × industry × maturity × worry tag constants
   - Inngest job definitions: cron schedules, event names, step definitions
   - Twilio strategy: shared pool (Starter/Pro), dedicated number (Executive)
   - Stripe setup: product names, price IDs structure, trial configuration
   - Data flow diagrams (text-based) for: onboarding, daily delivery, SMS feedback loop, Ask Anything

2. schema.sql — production-ready Supabase PostgreSQL migration:
   Tables: users, content_items, delivery_log, user_learning_plans, sms_conversations, feedback_weights
   Include: indexes on foreign keys and frequent query columns, RLS policies for user data isolation, updated_at triggers

Be precise. All subsequent agents depend on this.
```
**Validation:** Both files exist. schema.sql passes `psql --dry-run` check. All tables present.

---

### Phase 2 — Core Build (Run all 4 agents in PARALLEL)

#### Agent 3: Backend Agent
**Branch:** `agent/backend`
**Inputs:** `brief.md`, `architecture.md`, `research-findings.md`
**Prompt:**
```
You are the Backend Agent for Distill. Read brief.md, architecture.md, and research-findings.md.

Build all server-side code. Use TypeScript strict mode. Validate all inputs with Zod. Handle errors gracefully with typed error responses. Add JSDoc on every exported function. Never log sensitive data.

Files to create:

lib/supabase.ts
- createServerClient() using @supabase/ssr for API routes and server components
- createBrowserClient() for client components
- Helper: getUserFromSession(request) → returns user or null

lib/clerk.ts
- currentUser() wrapper with proper typing
- requireAuth() middleware helper that returns 401 if not authenticated
- getUserId() from Clerk session

lib/stripe.ts
- Stripe client initialization
- getPlanFromPriceId(priceId) → returns 'starter' | 'pro' | 'executive'
- createCheckoutSession(userId, priceId, billingPeriod) → Stripe checkout URL
- createPortalSession(customerId) → Stripe portal URL
- handleWebhookEvent(event) → processes all subscription events

lib/delivery/email.ts
- Resend client initialization
- sendDailyEmail(user, contentItem) → sends personalized email
- sendWeeklyDigest(user, items[]) → sends Sunday digest
- sendPaymentFailedEmail(user) → billing alert
- sendTrialEndingEmail(user) → upgrade nudge
- sendRecalibrationEmail(user) → "adjusting your plan" notice
All email functions must return { success: boolean, error?: string }

lib/delivery/sms.ts
- Twilio client initialization
- sendSMS(toNumber, fromNumber, body) → sends outbound SMS
- assignPhoneNumber(userId, plan) → assigns from pool or dedicated
- verifyTwilioSignature(request, signature, url) → returns boolean
- parseInboundSMS(body) → classifies as 'feedback_yes' | 'feedback_no' | 'question' | 'command'

app/api/onboarding/route.ts (POST)
- Validate body with Zod: role, industry, aiMaturity, worry, deliveryPreference, timezone
- Save to users table via Supabase
- Generate initial learning plan (call personalizer stub)
- Assign Twilio number if Pro/Executive plan
- Return: { success, userId, planPreview }

app/api/feedback/route.ts (POST)
- Validate Twilio webhook signature
- Parse Y/N response
- Update delivery_log with feedback
- Emit Inngest event: 'distill/feedback.received'
- Return 200 TwiML response

app/api/ask/route.ts (POST)
- Validate Twilio webhook signature
- Extract question from SMS body
- Call Anthropic API with executive advisor system prompt
- Reply via Twilio SMS (max 160 chars)
- Log to sms_conversations
- Return 200 TwiML response

app/api/webhooks/stripe/route.ts (POST)
- Verify Stripe webhook signature (constructEvent)
- Handle: customer.subscription.created, .updated, .deleted, invoice.payment_failed, customer.subscription.trial_will_end
- Update users table on all events
- Trigger appropriate email via Resend
- Return 200 on success, 400 on signature failure

app/api/webhooks/twilio/route.ts (POST)
- Verify Twilio signature
- Parse inbound SMS intent
- Route to /api/feedback or /api/ask based on intent
- Return TwiML response

app/api/checkout/route.ts (POST)
- Require auth (Clerk)
- Validate plan and billingPeriod with Zod
- Create Stripe checkout session
- Return { checkoutUrl }

middleware.ts
- Use Clerk middleware
- Protect routes: /dashboard/*, /api/onboarding, /api/feedback, /api/ask, /api/checkout
- Public routes: /, /pricing, /sign-in, /sign-up, /api/webhooks/*

If an integration requires a real API key to test, create a mock stub that:
- Has the exact same TypeScript interface as the real implementation
- Logs what it would send to console.log('[MOCK]', ...)
- Returns realistic mock data
- Can be switched to real implementation by setting NODE_ENV=production
```
**Validation:** `npx tsc --noEmit` passes. All files created. Stubs work without real API keys.

---

#### Agent 4: Content Agent
**Branch:** `agent/content`
**Inputs:** `brief.md`, `architecture.md`, `research-findings.md`
**Prompt:**
```
You are the Content Agent for Distill. Read brief.md, architecture.md, and research-findings.md.

Build the entire content engine:

lib/content/taxonomy.ts
- Export typed constants: ROLES, INDUSTRIES, MATURITY_LEVELS, WORRY_TYPES as const arrays
- Export type definitions: Role, Industry, Maturity, Worry
- Export: matchContentToUser(userProfile, contentItems[]) → returns ranked ContentItem[]
- Ranking logic: exact tag match scores 3pts, partial match 1pt, sort descending
- Export: getNextContentType(deliveryLog[]) → balances content types so user gets variety

lib/content/generator.ts
- Anthropic SDK integration using ANTHROPIC_API_KEY env var
- generateContent(contentItem, userProfile, contentType) → PersonalizedContent
- System prompt: "You are a concise AI advisor for senior business executives. Write like a trusted peer, not a teacher. No jargon. No fluff. Every sentence must be immediately actionable or illuminating. Maximum 80 words. Always end with one 'So what?' sentence specific to their role."
- Enforce 80-word max: count words, truncate at last complete sentence under limit
- Validate output: word count check, not empty, ends with a sentence
- Format SMS version: strip to ≤160 chars, preserve the "So what?" line
- If ANTHROPIC_API_KEY is placeholder: return realistic mock content for each content type

lib/content/news-ingestion.ts
- NewsAPI integration: fetch /v2/everything with query='artificial intelligence OR AI' and category filtering
- Filter articles: remove duplicates by URL, score relevance by keyword presence
- Transform to ContentItem candidates: extract title, description, source, url, publishedAt
- Tag articles by detected role/industry relevance using keyword matching
- Save to content_items table via Supabase
- If NEWS_API_KEY is placeholder: return 10 hardcoded realistic mock articles

lib/content/personalizer.ts
- getUserContentPlan(userId) → full personalization pipeline:
  1. Fetch user profile from users table
  2. Fetch last 30 delivery_log entries for this user
  3. Fetch feedback_weights for this user
  4. Call matchContentToUser() to get ranked candidates
  5. Filter out items sent in last 14 days
  6. Call getNextContentType() to determine today's content type
  7. Call generateContent() to personalize the chosen item
  8. Return: { emailContent, smsContent, contentItemId }

Seed file: supabase/seed.sql
- 50 INSERT statements into content_items
- 10 per content type: tip, signal, decoder, lens, framework
- Distributed across role tags and industry tags
- All under 80 words, all end with a "So what?" sentence
- Generated content should be realistic, high-quality, exec-appropriate
```
**Validation:** TypeScript compiles. seed.sql has exactly 50 valid INSERT statements.

---

#### Agent 5: Frontend Agent
**Branch:** `agent/frontend`
**Inputs:** `brief.md`, `architecture.md`, `research-findings.md`
**Prompt:**
```
You are the Frontend Agent for Distill. Read brief.md and architecture.md carefully.

Build all user-facing pages and components using Next.js 14 App Router, TypeScript, Tailwind CSS, Framer Motion, and Lucide React.

CRITICAL DESIGN REQUIREMENT — READ THIS FIRST:
This product is for CEOs, VPs, and senior executives. The design must make them feel the energy of a premium AI startup. Think: Vercel meets Bloomberg Terminal. Dark, bold, confident, alive.

Color system (apply via Tailwind config):
- bg-void: #080808 (page backgrounds)
- bg-surface: #111111 (cards, panels)
- bg-raised: #1A1A1A (hover, modals)
- border-subtle: #222222
- border-strong: #333333
- accent-purple: #7C3AED
- accent-purple-bright: #A855F7
- accent-cyan: #06B6D4
- accent-amber: #F59E0B
- text-primary: #FFFFFF
- text-secondary: #94A3B8
- text-muted: #475569

Tailwind config: extend the theme with these colors.

PAGE 1 — app/(marketing)/page.tsx — Landing Page

Hero section:
- Full viewport height (min-h-screen)
- Background: #080808 with an animated radial gradient (purple glow at center, fading to black)
- Headline: "AI, distilled." — text-8xl font-extrabold tracking-tight text-white
- Subheadline: "15 seconds a day. Zero jargon. Total confidence." — text-2xl text-secondary
- Primary CTA: large purple button "Start free — no card needed" with ArrowRight icon, Framer Motion hover scale
- Below CTA: 3 trust signals in a row (icons): "5-question onboarding", "Daily in your inbox", "Cancel anytime"
- Right side: floating phone mockup (styled div showing an example SMS message from Distill)
- Framer Motion: hero content fades and slides up on load

Problem section "The executive AI trap":
- Section background: #080808
- Section heading: "Sound familiar?" — bold, centered
- 3 cards on dark surface (#111111), purple-left-border accent
- Card 1: BrainCircuit icon — "You sit in AI meetings and can't separate hype from substance"
- Card 2: TrendingUp icon — "Your team moves faster on AI than you do"
- Card 3: Search icon — "You can't tell if an AI vendor's pitch is brilliant or nonsense"
- Framer Motion: cards stagger-animate in on scroll

How it works "Three steps to AI confidence":
- Numbered steps with large purple circle badges (1, 2, 3)
- Step content with bold heading + 2-line description
- Connecting line between steps (subtle, dashed, #333333)
- Step 1: Zap icon — "Answer 5 questions" / "Tell us your role, industry, and biggest AI worry. 15 seconds."
- Step 2: MessageSquare icon — "Receive one insight daily" / "Personalized to your exact role. Email or SMS. 15–20 seconds to read."
- Step 3: TrendingUp icon — "Watch your score climb" / "Your AI Readiness Score grows as you engage. Track your progress."

Social proof (placeholder):
- 3 testimonial cards, dark (#111111), subtle border
- Placeholder quotes from: "CEO, Fortune 500 Retail", "VP Technology, Global Bank", "CU Lead, Consulting Firm"
- Avatar: colored circle with initials (A, B, C) in purple/cyan/amber

Pricing section:
- Monthly/Annual toggle — styled as pill toggle, purple for selected
- 4 plan cards (Free Trial, Starter, Pro, Executive)
- Pro card: purple border (2px), "Most popular" badge in purple
- Each card: plan name, price, billing note, feature list with CheckCircle icons
- All cards: dark (#111111) background
- CTA buttons link to /onboarding or Stripe checkout

Bottom CTA banner:
- Full-width dark purple gradient
- "Your competitors are already learning. Are you?" — large, bold, white
- Single CTA button — white text on purple

PAGE 2 — app/onboarding/page.tsx — 5-Question Tap UI

- Full viewport height, black background (#080808)
- Thin progress bar at top (4px height, purple fill, width animates 20%→40%→60%→80%→100%)
- One question visible at a time — centered vertically
- Question text: text-4xl font-bold text-white text-center, max-w-lg mx-auto
- 4–7 option buttons per question — full width (max-w-sm mx-auto), min-h-[64px]
- Option button: bg-surface border border-subtle text-white rounded-xl, hover:border-strong hover:bg-raised
- Selected option: border-accent-purple bg-purple-950/30 text-white
- Framer Motion AnimatePresence: slide current question out left, new question in from right
- After Q5: show "Building your plan..." screen
  - Centered Distill logo (text, styled)
  - Animated pulsing purple ring (CSS animation)
  - Tagline: "Calibrating your AI learning path..." fades in after 0.5s
  - After 2s: redirect to /dashboard or /pricing

PAGE 3 — app/dashboard/page.tsx — User Dashboard

Layout:
- Left sidebar: 240px, bg-surface, contains nav links with Lucide icons
- Main area: bg-void, padded (p-8)
- Sidebar nav items: Dashboard, Messages, Billing, Settings
- Top right: Clerk UserButton component

Content:
- Row 1: 3 metric cards (bg-surface, border-subtle)
  - AI Readiness Score: large cyan circular progress ring + number (0–100)
  - Day Streak: amber flame icon + number + "days active"
  - Messages Received: total count + "this month"
- Row 2: Recent Messages (last 7)
  - Each message card: date, content preview (2 lines), thumbs up/thumbs down buttons
  - Thumbs up: green when positive feedback given
  - Thumbs down: red when negative feedback given
- Row 3: Preferences
  - Delivery toggle: Email | SMS | Both — styled as segmented control (purple selected)
  - Pause delivery button: bordered, no fill
- If plan is Starter: upgrade CTA banner (purple gradient, "Unlock SMS delivery with Pro")

COMPONENTS

components/ui/Button.tsx — variant props: primary | secondary | ghost | danger
components/ui/Card.tsx — dark surface card with border
components/ui/Badge.tsx — small colored badge (purple | cyan | amber | green | red)
components/ui/ProgressRing.tsx — SVG circular progress component, accepts value 0-100
components/onboarding/QuestionCard.tsx — animated question wrapper
components/onboarding/OptionButton.tsx — selectable option
components/onboarding/ProgressBar.tsx — thin top progress bar
components/dashboard/ScoreRing.tsx — AI readiness score display
components/dashboard/StreakCounter.tsx — streak with flame animation
components/dashboard/MessageCard.tsx — message with feedback buttons
components/dashboard/DeliveryToggle.tsx — segmented preference control

All components: typed props, no any types, Framer Motion for transitions.
```
**Validation:** `npm run build` passes. All pages render without errors.

---

#### Agent 6: Payment Agent
**Branch:** `agent/payment`
**Inputs:** `brief.md`, `architecture.md`, `research-findings.md`
**Prompt:**
```
You are the Payment Agent for Distill. Read brief.md and architecture.md.

Build the complete Stripe subscription system. If STRIPE_SECRET_KEY is a placeholder, implement with full real logic but add mock guards that return success responses without calling Stripe — so the build never breaks.

1. Document Stripe product structure in architecture.md:
   Product: Distill Starter — prices: $12/mo, $99/yr (with 7-day trial)
   Product: Distill Pro — prices: $25/mo, $199/yr (with 7-day trial)
   Product: Distill Executive — prices: $49/mo, $399/yr (with 7-day trial)

2. app/api/checkout/route.ts
   - Auth required (Clerk)
   - Zod validate: { plan, billingPeriod }
   - Create Stripe Checkout Session: trial_period_days=7, success_url=/dashboard?welcome=1, cancel_url=/pricing
   - Return checkoutUrl

3. app/api/webhooks/stripe/route.ts
   - Verify signature via stripe.webhooks.constructEvent
   - customer.subscription.created → upsert users table (plan, stripe_customer_id, status=active)
   - customer.subscription.updated → update plan tier if changed
   - customer.subscription.deleted → set plan=free, status=inactive, stop delivery flag
   - invoice.payment_failed → sendPaymentFailedEmail()
   - customer.subscription.trial_will_end → sendTrialEndingEmail() 3 days before
   Return 200 always (log errors, don't return 500 — Stripe retries on 5xx)

4. app/dashboard/billing/page.tsx
   - Show current plan name and status
   - Next billing date (from Stripe subscription)
   - "Manage billing" button → calls /api/portal → redirects to Stripe Customer Portal
   - "Upgrade plan" button if on Starter or free

5. app/api/portal/route.ts
   - Auth required
   - Create Stripe Customer Portal session
   - Return portalUrl
```
**Validation:** Checkout → success flow works with Stripe test mode. All webhook events handled.

---

### Phase 3 — Scheduling (After Phase 2 complete)

#### Agent 7: Scheduler Agent
**Branch:** `agent/scheduler`
**Inputs:** All Phase 2 outputs
**Prompt:**
```
You are the Scheduler Agent for Distill. Read brief.md, architecture.md, and all lib/ files.

Build the Inngest job system. If INNGEST_EVENT_KEY is a placeholder, all functions should still register and log what they would do — never throw on missing keys.

inngest/client.ts
- Initialize Inngest client with name 'distill' and eventKey from env

inngest/daily-delivery.ts — cron: "0 7 * * *" (per user timezone, use date-fns-tz)
- Fetch all active users (not paused, plan != 'free', subscription status = 'active')
- Batch in groups of 50 using Inngest step.run() for each batch
- For each user: call getUserContentPlan(userId) from lib/content/personalizer.ts
- Send email if deliveryPreference includes 'email': call sendDailyEmail()
- Send SMS if deliveryPreference includes 'sms' AND plan is 'pro' or 'executive': call sendSMS()
- Log each send to delivery_log table
- On error for individual user: log error, continue to next user (never fail the whole batch)
- Retry configuration: { retries: 3, backoff: 'exponential' }

inngest/weekly-digest.ts — cron: "0 8 * * 0" (Sundays 8AM UTC)
- Fetch all Starter+ active users
- For each user: get their top 5 content items from last 7 days (by positive feedback or recency)
- Call sendWeeklyDigest(user, items)
- Log to delivery_log with channel='email', type='weekly_digest'

inngest/feedback-processor.ts — triggered by event: 'distill/feedback.received'
- Update delivery_log with feedback value
- Upsert feedback_weights: increment tag weight +1 for Y, decrement -0.5 for N
- Count consecutive N responses in last 10 deliveries
- If 5+ consecutive N: update user flag needs_recalibration=true, send recalibration SMS
- Count total deliveries with feedback
- If 7+ days since onboarding AND 5+ feedbacks: calculate AI Readiness Score:
  Score = (positive_feedbacks / total_feedbacks) * 60 + (streak_days / 30) * 40
  Clamp to 0–100. Save to users.ai_readiness_score.

app/api/inngest/route.ts
- Serve all Inngest functions: [dailyDelivery, weeklyDigest, feedbackProcessor]
- Required by Inngest SDK to register functions
```
**Validation:** Inngest dev server starts. All 3 functions register. Test events trigger without errors.

---

### Phase 4 — Testing (After Phase 3)

#### Agent 8: Testing Agent
**Branch:** `agent/testing`
**Inputs:** All previous agent outputs
**Prompt:**
```
You are the Testing Agent for Distill. Verify the entire application.

UNIT TESTS (tests/unit/) — use Vitest:

content-generator.test.ts
- Mock Anthropic SDK
- Test: output is always ≤80 words
- Test: output always ends with a sentence (not mid-word truncation)
- Test: mock returns valid PersonalizedContent shape
- Test: SMS version is always ≤160 chars

personalizer.test.ts
- Mock Supabase calls
- Test: matchContentToUser returns items in correct priority order
- Test: items sent in last 14 days are excluded
- Test: getNextContentType rotates content types correctly

taxonomy.test.ts
- Test: all ROLES constants are non-empty strings
- Test: matchContentToUser with exact tag match scores higher than partial match
- Test: empty tag arrays don't throw

stripe-webhooks.test.ts
- Use Stripe test fixtures (from stripe npm package)
- Test: subscription.created → users table updated
- Test: subscription.deleted → plan set to free
- Test: payment_failed → email function called
- Test: invalid signature → returns 400

INTEGRATION TESTS (tests/integration/) — use Vitest + mock Supabase:

onboarding-api.test.ts
- POST valid payload → 200 with userId
- POST missing required field → 400 with Zod error
- POST invalid role value → 400

feedback-api.test.ts
- POST valid Y feedback → delivery_log updated, Inngest event emitted
- POST invalid Twilio signature → 403

ask-api.test.ts
- POST valid question → Claude called, SMS sent, 200 TwiML returned
- POST empty body → 400

E2E TESTS (tests/e2e/) — use Playwright:

onboarding-flow.test.ts
- Navigate to /onboarding
- Click through all 5 questions
- Verify "Building your plan..." screen appears
- Verify redirect happens after 2.5s

landing-page.test.ts
- Navigate to /
- Verify hero headline is visible
- Verify all 3 pricing plan cards render
- Verify monthly/annual toggle works

dashboard.test.ts
- Navigate to /dashboard (mock Clerk session)
- Verify ScoreRing renders
- Verify StreakCounter renders

After all tests, create test-report.md:
- Total tests run, pass count, fail count
- Coverage percentage per module
- Any failures: file, test name, error message, root cause, fix applied
- Overall: PASS or FAIL
- If any tests fail: fix the underlying code and re-run until all pass
```
**Validation:** All unit + integration tests pass. E2E tests pass. test-report.md shows PASS.

---

## Final Integration Checklist

Before marking the build complete, verify ALL of these:

- [ ] `npm run build` — zero errors, zero TypeScript errors
- [ ] `npx tsc --noEmit` — clean
- [ ] `.env.local.example` — all vars documented with PLACEHOLDER_ values
- [ ] No hardcoded secrets or real credentials anywhere in code
- [ ] No unapproved npm packages used
- [ ] All API inputs validated with Zod
- [ ] All webhook handlers verify signatures before processing
- [ ] All agent branches merged into `dev`
- [ ] `dev` passes full test suite
- [ ] `dev` merged into `main` with commit: `feat: complete initial Distill build`
- [ ] `README.md` created with local setup instructions

---

## Git & Branch Strategy

```
main           ← production-ready, protected
dev            ← integration branch
agent/research
agent/architecture
agent/backend
agent/content
agent/frontend
agent/payment
agent/scheduler
agent/testing
```

Commit format: `type(scope): description`
Examples:
- `feat(frontend): add hero section with Framer Motion animations`
- `feat(backend): add Twilio inbound SMS webhook handler`
- `fix(content): enforce 80-word limit in generator`
- `test(unit): add personalizer tag matching tests`

---

## How to Start

Open terminal in `~/Documents/claudeworkspace` and run:

```bash
claude
```

Then paste this prompt:

```
Read CLAUDE.md and brief.md completely before doing anything.

You are the Orchestrator for Distill. Your mission: build the complete application fully autonomously.

Begin by creating TASKS.md — a full prioritized backlog of every task across all 8 agents and 4 phases.

Then execute the build:
- Follow the phase order strictly: Phase 1 → Phase 2 (parallel) → Phase 3 → Phase 4
- Never stop for approvals or missing credentials — use PLACEHOLDER_ values and mock stubs
- If any agent's output fails validation, fix it before moving to the next phase
- If tests fail, fix the code and re-run — do not leave failing tests
- Log any items needing Arun's real credentials in BACKLOG.md and move on immediately
- Only use approved libraries from the security list in CLAUDE.md
- Think before any external network call — is this vendor approved? Is this endpoint safe?

When complete, say: "Distill build complete. All tests passing. See test-report.md."
```

---

*CLAUDE.md version: 2.0 | Project: Distill | Owner: Arun | Created: May 2026*
