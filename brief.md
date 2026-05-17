# BRIEF.md — Distill: Executive AI Micro-Learning Platform

---

## 1. The Problem

Senior leaders — CEOs, VPs, Capability Unit (CU) Leads, Business Unit (BU) Leads, Product Sponsors — are caught in a paradox:

- They have risen to roles that are **pure management**: strategy, stakeholder alignment, budgets, people
- In doing so, they have **left behind hands-on technical experience** and lost the instinct to evaluate new technology
- **AI is moving faster than any prior technology wave**, and this gap is now dangerous
- In every meeting where someone presents an AI initiative, they cannot confidently answer:
  - Does this actually solve a real problem?
  - Will this add measurable value for my organization?
  - Are we being sold hype or substance?
  - How do I evaluate the vendor / team / technology?
  - How do I communicate this upward to my board or boss?
- The result: **executive AI paranoia** — fear of being exposed as irrelevant, fear of losing the job, inability to lead AI transformation
- They **want to learn, but have no time** — no time for courses, no time for books, no patience for lengthy newsletters
- They need a **trusted, consistent, fast signal** — like having a knowledgeable friend who sends them the right update at the right time

---

## 2. The Solution — Distill

**Distill** is a personalized AI micro-learning assistant for busy executives.

It:
- Learns who you are in **15 seconds** at onboarding
- Builds a **custom learning plan** matched to your role, industry, and AI exposure level
- Delivers **1–2 messages per day** (email and/or SMS) that take **15–20 seconds to read**
- Content is **role-specific, jargon-free, immediately applicable**, and always current
- Gets smarter over time through **implicit and explicit feedback**
- Keeps you consistently informed so you can **lead, evaluate, and communicate AI confidently**

---

## 3. Target Users

| Role | Primary Pain Point |
|---|---|
| CEO | Board-level AI governance, competitive threat, when to invest |
| VP (Technology / Product / Operations) | ROI clarity, vendor evaluation, team readiness |
| Capability Unit (CU) Lead | AI use cases for their domain, implementation lessons |
| Business Unit (BU) Lead | Practical AI applications in their function, budgeting for AI |
| Product Sponsor | Evaluating AI product pitches, prioritization, build vs buy |
| Others (Directors, Senior Managers) | General AI literacy, speaking the language of AI |

---

## 4. Onboarding — 15 Seconds, 5 Questions

The onboarding must feel instant. **5 single-tap questions, no typing, no friction.**

**Q1 — Your Role**
[ ] CEO / MD / President
[ ] VP / SVP / EVP
[ ] CU Lead / Practice Head
[ ] BU Lead / Functional Head
[ ] Product Sponsor / Owner
[ ] Director / Senior Manager
[ ] Other

**Q2 — Your Industry**
[ ] Technology / SaaS
[ ] Financial Services / Banking
[ ] Healthcare / Life Sciences
[ ] Retail / E-commerce
[ ] Manufacturing / Supply Chain
[ ] Consulting / Professional Services
[ ] Other

**Q3 — Your current AI involvement**
[ ] Just observing from a distance
[ ] Evaluating AI vendors / solutions
[ ] Running AI pilots in my team
[ ] Scaling AI across my organization

**Q4 — What worries you most about AI?**
[ ] My job relevance / security
[ ] Knowing if AI investments deliver ROI
[ ] How to evaluate AI vendors and technology
[ ] Upskilling my team for AI
[ ] Falling behind competitors

**Q5 — How should we reach you?**
[ ] Email only
[ ] SMS only
[ ] Both Email + SMS

> After Q5, the system instantly generates their profile and learning plan. No loading screen longer than 2 seconds.

---

## 5. Content Strategy

### Content Types (per message)
Each message is ONE of the following — never a mix:

- **Daily Tip**: One concrete, actionable insight applicable to their role ("As a CU Lead evaluating an AI proposal, always ask for a baseline metric before approving budget.")
- **Industry Signal**: One significant AI development in their industry — contextualized ("Here's what JPMorgan's AI deployment means for financial services leaders.")
- **Concept Decoder**: An AI term explained in pure business language — no jargon ("What is a Foundation Model? Think of it as the engine. You don't build it — you license it and build on top.")
- **Leader Lens**: How a peer executive handled an AI challenge — a 3-bullet case study
- **Evaluation Framework**: A simple heuristic or question set for a specific situation ("5 questions to ask any AI vendor before a pilot")
- **Weekly Digest** (email only, Sundays): A crisp summary of the week's signals + one recommended focus for the coming week

### Content Quality Principles
- **Never exceed 80 words per message**
- **Always end with one sentence of "So what?"** — what this means for someone in their role
- No links unless premium tier
- Written at a **business executive reading level**, not technical
- Tone: confident peer, not teacher

### Personalization Engine
- Content is tagged by: role, industry, AI maturity level (observer / evaluator / pilot / scaler), worry category
- Each user receives only content matching their tag intersection
- As users engage (or don't), the system adjusts the tag weights

---

## 6. Feedback & Adaptive Learning

- Every SMS ends with: **"Reply Y if useful, N if not"**
- Every email has a **single thumbs up / thumbs down** button — no redirect, inline click
- After 5 "N" responses in a row → system automatically adjusts content angle and notifies user: "We're recalibrating your plan"
- After 7 days of engagement → unlock an **AI Readiness Score** (0–100) with a one-line explanation
- Score improves visibly over time → creates motivation to stay consistent

---

## 7. Features List

### Core (MVP)
1. **Onboarding flow** — 5-question tap experience, profile built in <2 seconds
2. **Learning plan generator** — Claude AI maps role + worry + maturity → content track
3. **Daily content delivery** — 1 email per day OR 1 SMS per day (based on preference)
4. **Content generation pipeline** — Claude API generates personalized snippets daily
5. **Feedback capture** — Y/N SMS reply, thumbs up/down email inline
6. **Plan selection + Stripe payment** — tiered subscription checkout
7. **Twilio SMS** — dedicated number assignment per user (or shared pool for starter)
8. **Resend email** — transactional + marketing emails with custom templates
9. **Pause / Resume** — users can pause delivery for travel or vacation
10. **Unsubscribe** — one-click, no friction

### Growth (Post-MVP)
11. **Ask Anything (SMS)** — reply any question to your Twilio number, get a Claude-powered answer in <60 seconds
12. **Meeting Prep Mode** — "I have an AI vendor demo tomorrow" → get a prep brief delivered to email
13. **Progress Dashboard** — web portal showing learning streak, AI Readiness Score, topics covered
14. **Enterprise Tier** — bulk seat management, org-wide analytics, admin dashboard, SSO
15. **Referral System** — invite a colleague, both get a free week
16. **Content Freshness Engine** — real-time AI news ingestion (RSS + NewsAPI) mixed with evergreen fundamentals
17. **Calendar Integration** — connect Google/Outlook calendar; auto-detect AI-related meetings and send prep snippets

---

## 8. Pricing Tiers

| Plan | Monthly | Annual | Includes |
|---|---|---|---|
| **Free Trial** | $0 / 7 days | — | 1 email/day, onboarding + plan, no credit card |
| **Starter** | $12/mo | $99/yr (save 31%) | 1 email/day, personalized plan, weekly digest, feedback adaptation |
| **Pro** | $25/mo | $199/yr (save 34%) | Email + SMS daily, AI Readiness Score, adaptive content, Y/N SMS feedback |
| **Executive** | $49/mo | $399/yr (save 32%) | All Pro + dedicated Twilio number, Ask Anything SMS, Meeting Prep Mode, Progress Dashboard |
| **Enterprise** | Custom | Custom | Bulk seats, admin dashboard, SSO/SAML, org analytics, custom content tracks |

---

## 9. Tech Stack

| Layer | Technology | Purpose |
|---|---|---|
| Frontend | Next.js 14 (App Router) + Tailwind CSS | Web app, onboarding, dashboard |
| Backend | Next.js API Routes | Business logic, webhooks |
| Database | PostgreSQL via Supabase | Users, plans, content, engagement |
| Auth | Clerk | Authentication, session management |
| Email | Resend | Transactional + marketing emails |
| SMS | Twilio | Inbound/outbound SMS per user |
| Payments | Stripe | Subscription billing, plan management |
| AI / Content | Anthropic Claude API (claude-sonnet-4-6) | Content generation, personalization, Ask Anything |
| News Ingestion | NewsAPI + RSS Parser | Real-time AI news sourcing |
| Job Scheduling | Inngest or Vercel Cron | Daily content delivery pipeline |
| Hosting | Vercel | Frontend + API deployment |
| Storage | Supabase Storage | Email templates, assets |

---

## 10. Multi-Agent Architecture (Claude Code)

The application will be built using **Claude Code as the Orchestrator**, spawning specialized subagents for each domain:

```
ORCHESTRATOR AGENT
│   Reads brief.md, plans the full build, coordinates all subagents
│   Tracks progress, resolves blockers, runs final integration
│
├── RESEARCH AGENT
│   - Researches best practices for each tech stack component
│   - Identifies API documentation for Twilio, Resend, Stripe, Clerk
│   - Finds reference implementations and patterns
│   - Output: research-findings.md
│
├── ARCHITECTURE AGENT
│   - Designs database schema (users, plans, content, engagement, feedback)
│   - Designs API route structure
│   - Designs content tagging taxonomy (role × industry × maturity × worry)
│   - Output: architecture.md + schema.sql
│
├── FRONTEND AGENT
│   - Builds onboarding flow (5-question UI, progress animation)
│   - Builds landing page (problem, solution, pricing)
│   - Builds user dashboard (streak, score, history)
│   - Builds plan selection + Stripe checkout page
│   - Output: /app/** Next.js pages and components
│
├── BACKEND AGENT
│   - Implements all API routes
│   - Integrates Clerk auth middleware
│   - Integrates Stripe webhooks (subscription created, cancelled, renewed)
│   - Integrates Twilio (number assignment, inbound SMS handler, outbound send)
│   - Integrates Resend (email templates, send functions)
│   - Output: /app/api/** route handlers
│
├── CONTENT AGENT
│   - Builds content generation pipeline using Claude API
│   - Implements content tagging and personalization logic
│   - Builds news ingestion pipeline (NewsAPI + RSS)
│   - Implements feedback-based content adaptation
│   - Output: /lib/content/** content engine
│
├── SCHEDULER AGENT
│   - Implements daily cron jobs for content delivery
│   - Implements Inngest event functions (send email, send SMS)
│   - Implements weekly digest job (Sundays)
│   - Implements feedback processing job
│   - Output: /inngest/** or /cron/** job definitions
│
├── PAYMENT AGENT
│   - Implements Stripe subscription plans (Starter, Pro, Executive)
│   - Implements plan upgrade/downgrade flows
│   - Implements trial period logic (7-day free)
│   - Handles webhook events (payment failed, subscription cancelled)
│   - Output: /lib/stripe/** + /app/api/stripe/** 
│
└── TESTING AGENT
    - Writes unit tests for content generation logic
    - Writes integration tests for API routes
    - Writes E2E tests for onboarding flow and payment
    - Runs all tests and reports results
    - Output: /tests/** + test-report.md
```

---

## 11. Database Schema (High Level)

```
users
  - id, email, phone, role, industry, ai_maturity, worry_tags
  - plan_tier, stripe_customer_id, stripe_subscription_id
  - delivery_preference (email | sms | both)
  - twilio_number_assigned
  - onboarded_at, trial_ends_at, paused_until
  - ai_readiness_score, streak_days

content_items
  - id, type (tip | signal | decoder | lens | framework)
  - body_text (≤80 words), role_tags[], industry_tags[]
  - maturity_tags[], worry_tags[], created_at
  - source_url (optional), generated_by (claude | curated)

delivery_log
  - id, user_id, content_item_id, channel (email | sms)
  - sent_at, opened_at, feedback (positive | negative | null)

user_learning_plans
  - id, user_id, generated_at, plan_json
  - active_track, next_content_type, cadence_days

sms_conversations
  - id, user_id, twilio_number, direction (in | out)
  - body, received_at / sent_at, intent (feedback | question | command)
```

---

## 12. Key User Flows

### Onboarding Flow
```
Landing Page → "Get Started Free"
→ 5-question tap UI (15 seconds)
→ "Building your plan..." (2 second animation)
→ Plan preview screen (here's what you'll learn)
→ Choose delivery preference + enter email/phone
→ Select pricing plan → Stripe checkout
→ Confirmation: "Your first insight arrives tomorrow morning"
```

### Daily Delivery Flow
```
[Cron job fires at 7:00 AM user's timezone]
→ Fetch user profile + feedback history
→ Select next content item (tag-matched, not recently sent)
→ Personalize copy using Claude API (inject role/industry context)
→ Send via Resend (email) and/or Twilio (SMS)
→ Log to delivery_log
```

### SMS Feedback + Ask Anything Flow
```
User replies "N" → log negative feedback → queue recalibration
User replies "Y" → log positive feedback → reinforce content track
User replies any question → classify as "question" intent
→ Claude API generates a concise answer in <80 words
→ Reply via Twilio within 60 seconds
```

---

## 13. Open Questions / Decisions Needed

- [ ] App name confirmed? (AI Pulse is a working title)
- [ ] Shared Twilio number pool (starter) vs dedicated number (pro+)?
- [ ] Content: fully AI-generated vs human-curated hybrid?
- [ ] Should the Ask Anything feature support voice (Twilio Voice) in future?
- [ ] GDPR / data privacy: EU users — need consent flow at onboarding
- [ ] Which timezone logic to use for delivery scheduling?
- [ ] Should Week 1 be a fixed onboarding track before adaptive kicks in?

---

## 14. Success Metrics

- **Activation Rate**: % of signups who complete onboarding and receive first message
- **Day-7 Retention**: % still active after 1 week
- **Feedback Rate**: % of messages that get a Y/N response
- **Positive Feedback Ratio**: % of feedbacks that are Y
- **Conversion Rate**: Free trial → paid plan
- **AI Readiness Score Growth**: Average score improvement over 30 days

---

*Brief version: 1.1 | Created: May 2026 | Owner: Arun | App name: Distill | Domain: hello-clio.com*
