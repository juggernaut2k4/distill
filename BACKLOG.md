# Clio — Product Backlog

_Last updated: 2026-05-13_

---

## Legend
- **Priority:** P0 = blocks active user path | P1 = core feature | P2 = enhancement
- **Status:** Pending | In Progress | Done | Blocked
- **Size:** S (<2h) | M (2-4h) | L (4-8h) | XL (>1 day)

---

## P0 — Critical

| # | Story | Status | Size | Notes |
|---|---|---|---|---|
| P0-1 | **Fix Stripe payment bypass** — checkout API returns mock URL when price IDs are PLACEHOLDER_; real Stripe checkout fires when real price IDs are set | Done | S | Mock only triggers on PLACEHOLDER_ prefix |
| P0-2 | **Post-payment confirmation email** — after `customer.subscription.created` fires, send branded "Welcome to Clio" email with plan name, included minutes, and next steps link | In Progress | S | `sendWelcomeEmail()` in email.ts + called in stripe webhook |
| P0-3 | **Post-payment plan setup screen** — `/dashboard/welcome` animated page shown after Stripe success before user lands on dashboard | In Progress | M | `app/dashboard/welcome/page.tsx` |
| P0-4 | **User row exists before webhook** — onboarding creates row; checkout API should ensure upsert if user skipped onboarding | Done | S | Onboarding must complete before payment |

---

## P1 — Core Features

### Topic Interest Selection

| # | Story | Status | Size | Notes |
|---|---|---|---|---|
| P1-1 | **Topic selection screen** — after onboarding Q5 (or after sign-up), show optional "What topics matter most?" with clickable topic boxes grouped by category; pick up to 5 | In Progress | M | `app/topics/page.tsx` |
| P1-2 | **Save topic interests to DB** — `POST /api/topics` saves to `users.topic_interests` (text[]); migration 003 adds column | In Progress | S | `supabase/migrations/003_topics_and_plan.sql` |
| P1-3 | **Curriculum intelligence** — when user picks advanced topics but has beginner maturity, inject prerequisite topics first; return ordered curriculum sequence | Pending | L | `lib/content/curriculum.ts` |
| P1-4 | **Topic → session grouping** — group topics into sessions (3-5 topics per session); assign estimated duration per topic based on complexity | In Progress | M | `lib/sessions/planner.ts` |

### Visual Flow Diagrams

| # | Story | Status | Size | Notes |
|---|---|---|---|---|
| P1-5 | **FlowDiagram React component** — dark matte (#080808), animated SVG/CSS nodes (circles + rounded rects), color-coded by type, animated connector lines with flow arrows | In Progress | L | `components/diagrams/FlowDiagram.tsx` |
| P1-6 | **Curriculum flow diagram** — user's learning path as animated flow: topics ordered by session, prerequisite arrows, session boundary boxes | In Progress | M | Used in `app/dashboard/plan/page.tsx` |
| P1-7 | **Session content diagram** — per-session topic nodes with animated status (pending=gray, active=cyan pulse, complete=green) | Pending | M | Session detail view |

### Session Planning & Scheduling

| # | Story | Status | Size | Notes |
|---|---|---|---|---|
| P1-8 | **Plan review/approval page** — `/dashboard/plan` shows: curriculum flow diagram, session list with topics + duration, "Approve Plan" + "Request Changes" buttons | In Progress | L | `app/dashboard/plan/page.tsx` |
| P1-9 | **Plan notification email + SMS** — after plan generated, send email + SMS with summary and link to `/dashboard/plan` | In Progress | S | `sendPlanReadyEmail()` in email.ts |
| P1-10 | **Session scheduling preferences UI** — user picks: first session date, frequency (daily/every 2 days/weekly), max duration (15/30 min), preferred time | In Progress | M | `app/dashboard/schedule/page.tsx` |
| P1-11 | **Minutes balance check before scheduling** — total minutes needed vs balance; if insufficient, show top-up recommendation | In Progress | M | `lib/sessions/minutes-check.ts` |
| P1-12 | **Schedule sessions to DB** — confirm schedule writes rows to `sessions` table | In Progress | S | `POST /api/sessions/schedule` |

### Phone Number Setup

| # | Story | Status | Size | Notes |
|---|---|---|---|---|
| P1-13 | **Phone setup page** — `/dashboard/phone` form: enter number → OTP SMS → verify → save + assign Twilio number | Pending | M | `app/dashboard/phone/page.tsx` |
| P1-14 | **Phone verification API** — `POST /api/phone/send-otp` and `POST /api/phone/verify` | Pending | M | Simple 6-digit OTP via Twilio |

---

## P2 — Enhancements

| # | Story | Status | Size | Notes |
|---|---|---|---|---|
| P2-1 | **Dashboard nav updates** — add "My Plan", "Sessions", "Phone Setup" to sidebar; badge on "My Plan" when pending approval | In Progress | S | Sidebar in `app/dashboard/page.tsx` |
| P2-2 | **Minutes balance widget** — remaining minutes on dashboard with colored progress bar | In Progress | S | DashboardClient metrics row |
| P2-3 | **Session status tracker** — list upcoming/past sessions with status badges | Pending | M | `app/dashboard/sessions/page.tsx` |
| P2-4 | **Top-up pack selection UI** — modal with 3 packs when minutes low; → Stripe one-time purchase | Pending | M | `components/dashboard/TopUpModal.tsx` |
| P2-5 | **Plan change request flow** — text input + topic reorder on "Request Changes" | Pending | L | Phase 2 |
| P2-6 | **Recalibration banner** — when `needs_recalibration=true`, show dashboard banner | Pending | S | DashboardClient |
| P2-7 | **Stripe URL update** — update to hello-clio.com when DNS ready | Pending | S | Blocked: domain propagation |

---

## Phase 2 — Future Sprint

| # | Story |
|---|---|
| F1 | Recall.ai video call bot joins scheduled sessions |
| F2 | ElevenLabs voice synthesis for Clio |
| F3 | Post-call AI session notes summary |
| F4 | Follow-up session auto-scheduling |
| F5 | Real-time minutes deduction during calls |
| F6 | Executive analytics / org-level rollup |

---

## Blockers Log

| Date | Blocker | Resolution |
|---|---|---|
| 2026-05-11 | NEXT_PUBLIC_APP_URL → getdistill.ai (third-party) | Updated to distill-peach.vercel.app |
| 2026-05-11 | Stripe business URL needed — hello-clio.com not live yet | Used distill-peach.vercel.app; update when domain ready |
| 2026-05-11 | Clerk blocking /onboarding and /checkout routes | Added to public routes in middleware.ts |
