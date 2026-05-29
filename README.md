# Clio

![CI](https://github.com/OWNER/REPO/actions/workflows/ci.yml/badge.svg)

Personalized AI micro-learning for executives. 15 seconds a day. Zero jargon. Total confidence.

> **Note:** Replace `OWNER/REPO` in the badge URL above with your GitHub username and repository name (e.g. `arunprakash/hello-clio`).

## Tech Stack

| Layer | Technology |
|---|---|
| Framework | Next.js 14 (App Router, TypeScript) |
| Styling | Tailwind CSS + Framer Motion |
| Auth | Clerk |
| Database | Supabase (PostgreSQL) |
| Email | Resend |
| SMS | Twilio |
| Payments | Stripe |
| AI | Anthropic Claude (`claude-sonnet-4-6`) |
| News | NewsAPI |
| Scheduling | Inngest |

## Local Setup

### Prerequisites

- Node.js 18+
- npm 9+

### 1. Clone and install

```bash
git clone <repo-url>
cd distill
npm install --legacy-peer-deps
```

### 2. Environment variables

```bash
cp .env.local.example .env.local
```

Edit `.env.local` and replace all `PLACEHOLDER_*` values with real credentials.

Required services:
- [Supabase](https://supabase.com) — create a project, get URL + anon key + service role key
- [Clerk](https://clerk.com) — create an application, get publishable + secret keys
- [Stripe](https://stripe.com) — create products/prices, get keys + webhook secret
- [Twilio](https://twilio.com) — get account SID + auth token + phone numbers
- [Resend](https://resend.com) — get API key
- [Anthropic](https://console.anthropic.com) — get API key
- [NewsAPI](https://newsapi.org) — get API key
- [Inngest](https://inngest.com) — get event key + signing key

### 3. Set up the database

Run the migration in your Supabase SQL editor:

```bash
# Copy contents of supabase/migrations/001_initial.sql into Supabase SQL editor and run
```

Optionally seed with sample content:

```bash
# Copy contents of supabase/seed.sql into Supabase SQL editor and run
```

### 4. Run the development server

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

### 5. Run Inngest (for scheduling)

In a separate terminal:

```bash
npx inngest-cli@latest dev
```

This starts the Inngest dev server which connects to your local app at `/api/inngest`.

## Development Without Real API Keys

All integrations check for `PLACEHOLDER_` prefix and switch to mock mode automatically:

- **Anthropic** — returns pre-written executive content samples
- **Twilio** — logs SMS sends to console instead of sending
- **Resend** — logs email sends to console instead of sending
- **Stripe** — returns mock checkout URLs
- **NewsAPI** — returns 10 hardcoded mock news articles
- **Inngest** — registers functions but doesn't send events to cloud

You can run the full application locally with all `PLACEHOLDER_` values and it will work end-to-end.

## Running Tests

```bash
# Unit + integration tests (Vitest)
npm test

# E2E tests (Playwright — requires the app to be running on port 3000)
# Terminal 1: start the server
npm run dev
# Terminal 2: run E2E tests
npm run test:e2e
```

### CI

Every push and pull request to `main` runs the full test suite via GitHub Actions (`.github/workflows/ci.yml`):

- **unit-and-integration** — Vitest unit and integration tests. Runs first.
- **e2e** — Playwright E2E tests against a built production server. Runs only after unit-and-integration passes.

To enforce these as required checks on `main`, go to:  
GitHub → Settings → Branches → Add branch protection rule → Require status checks → add `unit-and-integration` and `e2e`.

## Project Structure

```
app/                    Next.js App Router pages and API routes
components/             React components (ui/, onboarding/, dashboard/)
lib/                    Server-side utilities
  content/              Content generation pipeline (generator, personalizer, taxonomy, news)
  delivery/             Email (Resend) and SMS (Twilio) delivery
  clerk.ts              Auth helpers
  stripe.ts             Payment helpers
  supabase.ts           Database clients
inngest/                Scheduled and event-driven jobs
supabase/               Database migrations and seed data
tests/                  Unit, integration, and E2E tests
```

## Deployment

This project is configured for [Vercel](https://vercel.com). Push to `main` and connect to Vercel.

Set all environment variables in the Vercel project settings.

Configure webhooks in each service to point to your production URL:
- Stripe: `https://yourdomain.com/api/webhooks/stripe`
- Twilio: `https://yourdomain.com/api/webhooks/twilio`
- Inngest: auto-configured via the Inngest dashboard

## Plan Tiers

| Plan | Price | Features |
|---|---|---|
| Free Trial | $0 / 7 days | 1 email/day, onboarding |
| Starter | $12/mo or $99/yr | 1 email/day, weekly digest |
| Pro | $25/mo or $199/yr | Email + SMS, AI Readiness Score, Ask Anything |
| Executive | $49/mo or $399/yr | Everything + dedicated number, Meeting Prep Mode |
