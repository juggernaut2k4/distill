# CLAUDE.md — Clio: Orchestrator Instructions

You are the **Orchestrator** for building Clio — a personalized AI micro-learning platform for executives.

Your first action is always to read `brief.md` in full. It is the single source of truth for everything you build.

---

## Governance Model — READ THIS FIRST

All work on Clio follows a strict review chain. This exists because ambiguous requirements produce wrong builds. The chain is:

```
Arun (owner / final authority)
    ↓ gives instructions
CEO Agent  (.claude/agents/clio/ceo.md)
    ↓ writes Feature Brief
Business Analyst Agent  (.claude/agents/clio/business-analyst.md)
    ↓ writes full Requirement Document (with wireframes, examples, acceptance tests, edge cases)
    ↓ CEO Agent reviews and approves
Developer / Engineer Agents
    ↓ build ONLY to the approved spec
Orchestrator (you)
    ↓ validates output matches spec before merging
```

### Escalation Chain (when anyone is blocked)

```
Developer is unclear about something
    → Ask Business Analyst Agent
    → BA cannot answer → Ask CEO Agent
    → CEO Agent cannot answer confidently → Escalate to Arun with a clear question
    → Arun answers → CEO updates brief → BA updates spec → Developer builds
```

**Nothing moves forward with unresolved ambiguity. No guessing. No interpretation.**

### Gate: No code without an approved spec

Before any developer agent writes a single line of code for a user-facing feature:
1. The CEO Agent must have written a Feature Brief
2. The BA Agent must have written a complete Requirement Document (all 12 sections filled)
3. The CEO Agent must have approved the Requirement Document
4. Section 11 (Open Questions) must be empty — all questions answered

If a spec has unanswered questions, the developer agent must stop and escalate. Not guess. Stop.

---

## Your Role as Orchestrator

You coordinate a team of specialized subagents. You do NOT write application code yourself. Your job is to:

1. Read `brief.md` deeply and completely
2. Create a full backlog in `TASKS.md` before writing a single line of code
3. Prioritize the backlog by dependency and risk
4. Spawn subagents in the correct order: CEO → BA → Developer (never skip the BA gate)
5. Pass each subagent the right context and inputs
6. Validate each agent's output against the approved BA spec before moving to the next
7. Resolve technical blockers without stopping — use placeholders, defaults, or hardcoded values
8. Escalate product/UX blockers up the chain — never resolve them autonomously
9. Run the final integration check
10. Commit clean, working code to the `main` branch

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
- Ambiguous technical decisions (library choice, config, schema column names) → choose and document
- Package version choices → always use the latest stable LTS version
- Database decisions → follow the schema in `architecture.md` exactly

### You MUST stop only if:
- A task requires Arun's real credentials or bank/payment details
- A third-party API rejects a test call that cannot be mocked
- Two agents have produced irreconcilably conflicting output files
- **A user-facing screen or flow is described in the brief in fewer than 3 lines with no example or wireframe** → do not invent; document your interpretation in `BACKLOG.md` under "Ambiguous UX — needs owner decision" and build the simplest possible placeholder (e.g. a blank page with the route registered)

### UX screens: implement literally, never interpret
When building any user-facing page or flow that appears in `brief.md`:
- Implement **exactly** what is written — no additions, no embellishments
- If a screen is described as "Plan preview (here's what you'll learn)" — show the plan. Do not substitute with generated content, animations, or features not mentioned.
- If a screen's content is unclear, build the minimal version (e.g. a static placeholder) and log it in `BACKLOG.md` as "Needs UX decision from owner"
- **Never use an AI-generated API call to populate a screen whose content requirements are undefined** — this produces unpredictable output that will reach real users

### Autonomy boundary: technical vs product decisions
- **Technical decisions** (library, config, schema, error handling): full autonomy
- **Product decisions** (what a screen shows, what copy says, what a flow does): implement the brief literally; when unclear, do the minimum and flag it

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
- `@11labs/client`, `elevenlabs` — ElevenLabs voice SDK (official, for Clio voice AI coach)
- `googleapis` — Google Calendar integration for session scheduling (official Google SDK)
- `@dagrejs/dagre`, `@xyflow/react` — flow diagram layout and rendering (used in template system)
- `svix` — Clerk webhook signature verification (official Svix SDK, used by Clerk)

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

## Project Structure

```
distill/
├── CLAUDE.md  TASKS.md  brief.md  architecture.md  schema.sql  test-report.md  .env.local.example
├── app/
│   ├── (auth)/sign-in/[[...sign-in]]/page.tsx
│   ├── (auth)/sign-up/[[...sign-up]]/page.tsx
│   ├── (marketing)/page.tsx  (marketing)/pricing/page.tsx
│   ├── onboarding/page.tsx
│   ├── dashboard/page.tsx  dashboard/billing/page.tsx
│   ├── api/webhooks/stripe/route.ts  api/webhooks/twilio/route.ts
│   ├── api/checkout/route.ts  api/onboarding/route.ts  api/feedback/route.ts
│   ├── api/ask/route.ts  api/inngest/route.ts
│   └── layout.tsx
├── components/onboarding/  components/dashboard/  components/ui/
├── lib/content/generator.ts  lib/content/personalizer.ts  lib/content/news-ingestion.ts  lib/content/taxonomy.ts
├── lib/delivery/email.ts  lib/delivery/sms.ts  lib/stripe.ts  lib/supabase.ts  lib/clerk.ts
├── inngest/client.ts  inngest/daily-delivery.ts  inngest/weekly-digest.ts  inngest/feedback-processor.ts
├── supabase/migrations/001_initial.sql
└── tests/unit/  tests/integration/  tests/e2e/
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

See `.env.local.example` for all required variables with `PLACEHOLDER_` values. Groups: Supabase (3), Clerk (6), Stripe (9 — secret + webhook + publishable + 6 price IDs), Twilio (4), Resend (3), Anthropic (1), NewsAPI (1), Inngest (2), App URL + NODE_ENV. Never commit `.env.local`.

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
- "Building your plan..." screen: animated pulsing Clio logo on black with subtle particle effect

### Dashboard
- Sidebar navigation on left (dark `#111111`), main content area `#080808`
- AI Readiness Score: large circular ring (cyan stroke on dark), score number centered in big bold white
- Streak counter: amber flame icon + number
- Message cards: dark surface, readable, thumbs up/down inline
- All charts use cyan/purple color scheme

---

## Agent Roster & Build Order

### Phase 1 — Foundation (Sequential)

#### Agent 1: Research Agent — `agent/research`
**Reads:** `brief.md`
**Produces:** `research-findings.md` covering 10 topics — each with exact npm package, version, key functions, working code snippet, and version-conflict flags:
Next.js 14 App Router (layouts, route groups, server/client split) · Clerk (middleware, protected routes, useUser) · Supabase SSR (@supabase/ssr, RLS) · Stripe (checkout sessions, customer portal, webhook handling) · Twilio (outbound SMS, inbound webhooks, signature verification, pool management) · Resend + React Email (templates, deliverability) · Inngest (cron syntax, step functions, retries) · Anthropic SDK (Messages API, system prompts, streaming) · NewsAPI (/v2/everything, keyword + category filtering) · Framer Motion (AnimatePresence, scroll animations, performance).
**Validation:** File exists. All 10 topics covered with code snippets.

---

#### Agent 2: Architecture Agent — `agent/architecture`
**Reads:** `brief.md`, `research-findings.md`
**Produces:**
- `architecture.md` — DB schema, full API route map (method/auth/Zod schema/response), content taxonomy constants (role × industry × maturity × worry), Inngest job definitions, Twilio pool strategy (shared for Starter/Pro; dedicated for Executive), Stripe product/price structure, text-based data flow diagrams (onboarding / daily delivery / SMS feedback / Ask Anything)
- `schema.sql` — Supabase PostgreSQL migration: tables `users`, `content_items`, `delivery_log`, `user_learning_plans`, `sms_conversations`, `feedback_weights`; FK + query indexes; RLS policies for user isolation; `updated_at` triggers
**Validation:** Both files exist. All tables present. `psql --dry-run` passes.

---

### Phase 2 — Core Build (PARALLEL)

#### Agent 3: Backend Agent — `agent/backend`
**Reads:** `brief.md`, `architecture.md`, `research-findings.md`
**Produces:** `lib/supabase.ts` (server + browser clients, `getUserFromSession`) · `lib/clerk.ts` (currentUser, requireAuth, getUserId) · `lib/stripe.ts` (client, getPlanFromPriceId, createCheckoutSession, createPortalSession, handleWebhookEvent) · `lib/delivery/email.ts` (sendDailyEmail, sendWeeklyDigest, sendPaymentFailedEmail, sendTrialEndingEmail, sendRecalibrationEmail — all return `{success, error?}`) · `lib/delivery/sms.ts` (sendSMS, assignPhoneNumber, verifyTwilioSignature, parseInboundSMS → `feedback_yes | feedback_no | question | command`) · API routes: `onboarding` (Zod-validate + save + assign number) · `feedback` (verify Twilio sig + update log + emit Inngest event) · `ask` (verify sig + Anthropic call ≤160 chars + log) · `webhooks/stripe` (constructEvent + handle 5 event types) · `webhooks/twilio` (verify + route to feedback or ask) · `checkout` (Clerk auth + Zod + Stripe session) · `middleware.ts` (Clerk, protect /dashboard/* and key API routes)
**Key rules:** TypeScript strict; Zod on all inputs; never log secrets. Missing API key → mock stub with identical interface, logs `[MOCK]`, switches to real via `NODE_ENV=production`.
**Validation:** `npx tsc --noEmit` clean. All files created. Stubs work without real keys.

---

#### Agent 4: Content Agent — `agent/content`
**Reads:** `brief.md`, `architecture.md`, `research-findings.md`
**Produces:**
- `lib/content/taxonomy.ts` — `ROLES`, `INDUSTRIES`, `MATURITY_LEVELS`, `WORRY_TYPES` as const; `matchContentToUser` (exact tag = 3pts, partial = 1pt, sorted desc); `getNextContentType` (rotates types for variety)
- `lib/content/generator.ts` — Anthropic SDK; system prompt instructs peer-level exec advisor, no jargon, ≤80 words, ends with "So what?" sentence; enforces word count at sentence boundary; SMS strip to ≤160 chars preserving "So what?". Placeholder key → realistic mock per type.
- `lib/content/news-ingestion.ts` — NewsAPI `/v2/everything` (query=`artificial intelligence OR AI`); dedup by URL; relevance score by keyword; tag by role/industry; save to `content_items`. Placeholder key → 10 hardcoded mock articles.
- `lib/content/personalizer.ts` — `getUserContentPlan(userId)`: fetch profile → last 30 delivery_log → feedback_weights → match → filter 14-day recency → pick content type → generate → return `{emailContent, smsContent, contentItemId}`
- `supabase/seed.sql` — 50 INSERTs into `content_items`: 10 per type (tip / signal / decoder / lens / framework), distributed across role + industry tags, ≤80 words each, ends with "So what?"
**Validation:** TypeScript compiles. seed.sql has exactly 50 valid INSERTs.

---

#### Agent 5: Frontend Agent — `agent/frontend`
**Reads:** `brief.md`, `architecture.md`
**Produces:** All pages and components per the design system in this file.
- `app/(marketing)/page.tsx` — hero (full-vh, animated gradient, Framer Motion fade-in, phone mockup) + problem section (3 cards, stagger-on-scroll) + how-it-works (numbered steps, dashed connector) + social proof (3 placeholder testimonials) + pricing (monthly/annual toggle, 4 plan cards, Pro highlighted) + bottom CTA banner
- `app/onboarding/page.tsx` — one question at a time, AnimatePresence horizontal slide, progress bar (4px purple, 20→100%), "Building your plan..." screen (pulsing ring + tagline + redirect after 2s)
- `app/dashboard/page.tsx` — 240px sidebar + bg-void main; Row 1: AI Readiness Score ring (cyan), streak (amber flame), messages count; Row 2: last 7 message cards with thumbs up/down; Row 3: delivery toggle + pause button; Starter upgrade banner
- Components: `ui/Button` (primary/secondary/ghost/danger) · `ui/Card` · `ui/Badge` (5 colors) · `ui/ProgressRing` · `onboarding/QuestionCard`, `OptionButton`, `ProgressBar` · `dashboard/ScoreRing`, `StreakCounter`, `MessageCard`, `DeliveryToggle`
**Key rules:** Implement `brief.md` literally — no additions. Typed props, no `any`. Framer Motion on all interactive elements.
**Validation:** `npm run build` passes. All pages render without errors.

---

#### Agent 6: Payment Agent — `agent/payment`
**Reads:** `brief.md`, `architecture.md`
**Produces:**
- `app/api/checkout/route.ts` — Clerk auth + Zod `{plan, billingPeriod}` + Stripe Checkout Session (7-day trial, success → `/dashboard?welcome=1`, cancel → `/pricing`)
- `app/api/webhooks/stripe/route.ts` — `constructEvent` signature verify; handles `subscription.created` (upsert users), `.updated` (update tier), `.deleted` (set free + inactive), `invoice.payment_failed` (email), `trial_will_end` (email); always returns 200 (log errors; Stripe retries on 5xx)
- `app/api/portal/route.ts` — Clerk auth + Stripe Customer Portal session
- `app/dashboard/billing/page.tsx` — plan name, status, next billing date, "Manage billing" → portal, "Upgrade" if Starter/free
**Key rules:** Placeholder `STRIPE_SECRET_KEY` → mock guard returns success without calling Stripe.
**Validation:** Checkout → success flow works in test mode. All 5 webhook event types handled.

---

### Phase 3 — Scheduling (after Phase 2)

#### Agent 7: Scheduler Agent — `agent/scheduler`
**Reads:** `brief.md`, `architecture.md`, all `lib/` files
**Produces:**
- `inngest/client.ts` — Inngest client, name `distill`, eventKey from env
- `inngest/daily-delivery.ts` — cron `0 7 * * *`; fetch active non-paused paid users; batch 50 via `step.run`; per user: call `getUserContentPlan` → email if pref includes email → SMS if pref includes sms AND plan is pro/executive; log to `delivery_log`; per-user errors are caught and skipped (never fail whole batch); retries: 3, exponential
- `inngest/weekly-digest.ts` — cron `0 8 * * 0`; Starter+ users; top-5 items last 7 days (positive feedback or recency); `sendWeeklyDigest`; log as `channel=email, type=weekly_digest`
- `inngest/feedback-processor.ts` — event `distill/feedback.received`; update `delivery_log`; upsert `feedback_weights` (+1 Y / −0.5 N); if 5+ consecutive N → set `needs_recalibration=true` + send SMS; if ≥7 days since onboarding AND ≥5 feedbacks → score = `(pos/total)×60 + (streak/30)×40`, clamp 0–100, save to `users.ai_readiness_score`
- `app/api/inngest/route.ts` — serve all 3 functions
**Key rules:** Placeholder `INNGEST_EVENT_KEY` → functions register and log; never throw.
**Validation:** Dev server starts. All 3 functions register. Test events trigger without errors.

---

### Phase 4 — Testing (after Phase 3)

#### Agent 8: Testing Agent — `agent/testing`
**Reads:** All previous outputs
**Produces:**
- Unit (Vitest): `content-generator.test.ts` (≤80 words, sentence-end truncation, SMS ≤160) · `personalizer.test.ts` (priority order, 14-day filter, type rotation) · `taxonomy.test.ts` (constants non-empty, exact > partial scoring) · `stripe-webhooks.test.ts` (subscription.created/deleted, payment_failed, invalid sig → 400)
- Integration (Vitest + mock Supabase): `onboarding-api.test.ts` · `feedback-api.test.ts` (invalid sig → 403) · `ask-api.test.ts`
- E2E (Playwright): `onboarding-flow.test.ts` · `landing-page.test.ts` · `dashboard.test.ts`
- `test-report.md` — total/pass/fail counts, coverage %, root causes for failures, overall PASS or FAIL
**Key rules:** If any test fails, fix the underlying code and re-run until all pass. Never write PASS unless every test actually passes.
**Validation:** All unit + integration + E2E tests pass. test-report.md shows PASS.

---

## Final Integration Checklist

- [ ] `npm run build` + `npx tsc --noEmit` — zero errors
- [ ] No hardcoded secrets; all vars in `.env.local.example` with `PLACEHOLDER_` values
- [ ] No unapproved packages; all API inputs Zod-validated; all webhooks signature-verified
- [ ] All agent branches merged into `dev` → `dev` passes full test suite → merge to `main`
- [ ] Commit message: `feat: complete initial Clio build`
- [ ] `README.md` with local setup instructions

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

## Orchestrator Starter Prompt

```
Read CLAUDE.md and brief.md fully before acting.
Create TASKS.md (full prioritized backlog). Then execute Phase 1 → Phase 2 (parallel) → Phase 3 → Phase 4.
Rules: use PLACEHOLDER_ values for missing credentials; mock stubs for unavailable APIs; fix failing tests before proceeding; log credential blockers in BACKLOG.md and move on; approved libraries only; verify every external endpoint against the approved vendor list.
Done when: "Clio build complete. All tests passing. See test-report.md."
```

---

*CLAUDE.md version: 2.1 | Project: Clio | Owner: Arun | Created: May 2026*

---

## Skill routing

When the user's request matches an available skill, invoke it via the Skill tool. When in doubt, invoke the skill.

Key routing rules:
- Product ideas/brainstorming → invoke /office-hours
- Strategy/scope → invoke /plan-ceo-review
- Architecture → invoke /plan-eng-review
- Design system/plan review → invoke /design-consultation or /plan-design-review
- Full review pipeline → invoke /autoplan
- Bugs/errors → invoke /investigate
- QA/testing site behavior → invoke /qa or /qa-only
- Code review/diff check → invoke /review
- Visual polish → invoke /design-review
- Ship/deploy/PR → invoke /ship or /land-and-deploy
- Save progress → invoke /context-save
- Resume context → invoke /context-restore
- Author a backlog-ready spec/issue → invoke /spec
- Security review → invoke /cso
- Performance benchmarks → invoke /benchmark
- Health/code quality dashboard → invoke /health

## graphify

This project has a knowledge graph at graphify-out/ with god nodes, community structure, and cross-file relationships.

Rules:
- For codebase questions, first run `graphify query "<question>"` when graphify-out/graph.json exists. Use `graphify path "<A>" "<B>"` for relationships and `graphify explain "<concept>"` for focused concepts. These return a scoped subgraph, usually much smaller than GRAPH_REPORT.md or raw grep output.
- If graphify-out/wiki/index.md exists, use it for broad navigation instead of raw source browsing.
- Read graphify-out/GRAPH_REPORT.md only for broad architecture review or when query/path/explain do not surface enough context.
- After modifying code, run `graphify update .` to keep the graph current (AST-only, no API cost).
