# Clio — Complete Product Backlog
_Last updated: 2026-05-30 | Source of truth for all sprints_

---

## SPRINT 5 — Content Generation Architecture + Template Quality
_Priority: P0 first, then P1 in order. Approved 2026-05-30._

### Architecture decisions (locked)
- KB = `topic_content_cache` (already exists, keyed by `topic_id + subtopic_slug`)
- Canonical depth = always 1 hour; condense to user's `session.duration_mins` per-user
- Visuals = same for all users (from KB); script + outline condensed per user
- Session 1 = generate immediately on schedule confirmation (server-side)
- Sessions 2+ = Inngest cron hourly, one session per user
- Every script ends with a mandatory 2-min CLOSE segment (summary + encouragement + next-topic teaser)
- Screen sharing templates: only critical keywords; full content visible; no partial display; voice script must align exactly with what is on screen

| ID | Story | Status | Priority | Size |
|---|---|---|---|---|
| CG-01 | **Fix pipeline error logging** — add step-level logging so Vercel shows exactly which step fails; expose error detail in response during non-production | ✅ Done | P0 | S |
| CG-02 | **Trigger Session 1 on schedule confirm** — move generation trigger from page-open to `POST /api/sessions/schedule` server-side for the first session | ⬜ Pending | P1 | S |
| CG-03 | **Hourly cron for Sessions 2+** — new `inngest/session-content-cron.ts` that processes one pending session per user every hour | ⬜ Pending | P1 | M |
| CG-04 | **1-hour canonical depth in prompts** — update `generateSessionContentOutline` and `generateTrainingScript` prompts to explicitly target 60-min full-coverage depth | ⬜ Pending | P1 | S |
| CG-05 | **Duration adaptation** — add `adaptScriptToDuration(script, targetMins, nextTopic)` in `script-generator.ts`; wire into pipeline after KB hit or generation | ⬜ Pending | P1 | M |
| CG-06 | **Enforce CLOSE segment** — add `CLOSE` segment type to `ScriptSegment`; prompt must always produce it as the final segment (~2 min / ~300 words) | ⬜ Pending | P1 | S |
| TQ-01 | **Screen sharing template quality** — templates show only critical keywords, key terms essential to the topic; all content displays in full (no truncation/overflow); LLM selects words that are necessary to teach the concept | ⬜ Pending | P1 | M |
| TQ-02 | **Voice script ↔ screen alignment** — every script segment that references on-screen content must match exactly what the template displays; strengthen `contentSpec` enforcement in prompts | ⬜ Pending | P1 | S |

---

## PART 1 — COMPLETE FEATURE LIST

### 1. Marketing & Acquisition
- Landing page: hero, problem, how-it-works, social proof, pricing, CTA banner
- Pricing page: 4 plans (Free/Starter/Pro/Executive), monthly/annual toggle, plan comparison table

### 2. Onboarding (Pre-Auth)
- 5-question tap flow (role, industry, AI maturity, worry, delivery preference)
- "Building your plan" animation screen
- Plan stored in localStorage across navigation

### 3. Auth
- Clerk sign-up (email/password + social)
- Clerk sign-in
- After sign-up → /checkout
- After sign-in → /dashboard

### 4. Payment
- Stripe hosted checkout with 3-day trial
- Post-payment: animated welcome screen → topics
- Mock mode when Stripe keys are placeholder
- Webhook: subscription.created → set plan_tier + minutes_balance + welcome email
- Webhook: subscription.updated → update plan tier
- Webhook: subscription.deleted → downgrade to free
- Webhook: invoice.payment_failed → alert email
- Webhook: trial_will_end → upgrade nudge email

### 5. Topic Interest Selection
- 25 topics across 5 categories (pick up to 5)
- Categories: AI Strategy & Leadership, Technology Foundations, Operational AI, Team & Org, Competitive Edge
- Skip option (use default curriculum)
- Saves to users.topic_interests

### 6. Curriculum Intelligence
- Build learning path from topic interests + AI maturity
- **Each session = one coaching call = one topic (20–30 min max)**
- Prerequisite detection: if user picks advanced topic, inject foundational prerequisites first
- Topological sort: prerequisites always come before dependent topics
- Result: ordered list of sessions, each with one topic

### 7. Plan Review & Approval
- Visual animated flow diagram of learning path (all sessions as nodes)
- Session list with expand/collapse (topic, duration, status)
- Stats: total sessions, total minutes, minutes balance
- Minutes insufficiency warning with top-up CTA
- "Approve Plan" → sets plan_approved=true → sends confirmation email + SMS → redirect to scheduling
- "Change topics" → back to /topics
- Plan pending amber banner on dashboard until approved

### 8. Session Scheduling
- Input: first session date (date picker, min: tomorrow)
- Input: frequency (daily / every 2 days / weekly)
- Input: max session duration (15 min / 30 min)
- Input: preferred time slot (morning / afternoon / evening)
- Live preview: all sessions with dates and durations
- Minutes balance check before confirming
- Confirm → save sessions to DB → send confirmation email → send calendar invites (.ics) → send SMS
- After confirm: show "Sessions scheduled!" with full calendar view (NOT redirect away)

### 9. Sessions Dashboard (View + Manage)
- List view: upcoming sessions (date, time, topic, duration, status badge)
- List view: past sessions (with notes placeholder)
- Status badges: Scheduled / Active / Completed / Cancelled
- "Add to Calendar" button per session (downloads .ics)
- "Reschedule" action (future Phase 2)
- Empty state: "No sessions scheduled yet" with CTA to schedule

### 10. Daily Insights (Delivery)
- Inngest cron: 7am per user timezone
- Content: personalised Anthropic-generated insight (80 words, "So what?" ending)
- Delivery: email (all plans) + SMS (Pro/Executive with phone setup)
- Logged to delivery_log

### 11. Feedback on Insights
- 👍 / 👎 inline buttons on each insight card
- Updates delivery_log.feedback
- Fires Inngest event: clio/feedback.received
- Adjusts tag weights (+1 positive / -0.5 negative)
- Recalculates AI Readiness Score after 7 days + 5 feedbacks
- 5+ consecutive negatives → recalibration (email + SMS + needs_recalibration flag)

### 12. Weekly Digest
- Inngest cron: Sunday 8am UTC
- Top 5 insights from past week
- Email only

### 13. AI Readiness Score
- Formula: (positive_feedbacks / total) × 60 + (streak_days / 30) × 40
- Visible as cyan circular ring on dashboard
- Updated after each feedback event

### 14. Dashboard
- Sidebar nav: Dashboard, My Plan, Sessions, Messages, Billing, Phone Setup, Settings
- Amber badge on "My Plan" when plan not yet approved
- Row 1: AI Readiness Score ring | Day Streak | Monthly messages
- Minutes balance bar (green → amber → red)
- Plan pending banner (amber, links to /dashboard/plan)
- Recent insights (last 7) with 👍/👎
- Delivery preference toggle (Email / SMS / Both)
- Pause/Resume delivery button
- If Starter: "Unlock SMS with Pro" upgrade banner

### 15. Phone Number Setup
- Form: enter mobile number
- Send 6-digit OTP via Twilio SMS
- Verify OTP → save phone + assign Twilio number
- Success confirmation
- Required for SMS delivery

### 16. Billing
- Current plan name + status + next billing date
- Minutes balance + reset date
- Manage billing → Stripe Customer Portal
- Upgrade CTA for Starter/Free
- Top-up packs: Starter (60 min), Standard (120 min), Power (300 min)

### 17. Notifications (All Touch Points)
| Trigger | Email | SMS |
|---|---|---|
| Payment confirmed | ✅ Welcome email | ❌ |
| Plan generated | ✅ "Plan ready to review" | ✅ (if phone set up) |
| Plan approved | ✅ Approval confirmation | ✅ |
| Sessions scheduled | ✅ Full session calendar + .ics | ✅ Summary |
| Day before session | ✅ Reminder | ✅ Reminder |
| Daily insight | ✅ | ✅ (Pro/Exec) |
| Weekly digest | ✅ | ❌ |
| 5+ negative feedbacks | ✅ Recalibration | ✅ |
| Payment failed | ✅ | ❌ |
| Trial ending (3 days) | ✅ | ❌ |

---

## PART 2 — COMPLETE USER FLOW (Every Step)

### A. Discovery
1. User arrives at hello-clio.com (landing page)
2. Reads: "Meet Clio." + "15 seconds a day. Zero jargon. Total confidence."
3. Scrolls: sees problem section, how-it-works, testimonials, pricing
4. Clicks plan CTA (e.g. "Get Starter — $19/mo") → navigates to /onboarding?plan=starter
5. localStorage saves: clio_selected_plan=starter

### B. Onboarding (Pre-Auth)
6. /onboarding loads — full screen, dark, progress bar at top
7. Q1: "What is your role?" — picks one option
8. Q2: "What industry are you in?" — picks one option
9. Q3: "How involved are you with AI today?" — picks maturity level
10. Q4: "What worries you most about AI?" — picks one worry
11. Q5: "How should we reach you?" — Email / SMS / Both
12. After Q5 → clicks "Build my plan" → shows "Building your plan..." animation (2s)
13. Redirects to /sign-up (Clerk)

### C. Sign Up
14. User creates account: email + password (or Google OAuth)
15. Clerk fires afterSignUpUrl → redirects to /checkout

### D. Checkout
16. /checkout page reads localStorage plan → shows "Setting up your plan..."
17. Calls POST /api/checkout → gets Stripe checkout URL
18. Redirects to Stripe hosted checkout
19. User enters card (3-day free trial starts)
20. Stripe success → redirects to /dashboard/welcome

### E. Post-Payment Welcome
21. /dashboard/welcome: animated 4-step "Setting up Clio for you..." (~4 seconds)
22. Steps: "Activating your plan..." → "Setting up your profile..." → "Preparing your learning engine..." → "Almost ready..."
23. ✅ checked animation → "You're all set!"
24. Auto-redirects to /topics
25. [BACKGROUND] Stripe webhook fires: subscription.created → sets plan_tier, minutes_balance → sends welcome email

### F. Topic Interest Selection
26. /topics: "What topics matter most to you?" — 25 topics, 5 categories
27. User picks up to 5 topics (checkboxes animate in/out, counter updates)
28. Click "Build my plan" (or "Use recommended topics" if none selected)
29. POST /api/topics saves topic_interests to users table
30. [BACKGROUND] POST /api/plan/generate called → generates curriculum → sends "Plan ready" email + SMS
31. Redirects to /dashboard/plan

### G. Plan Review
32. /dashboard/plan loads with:
    - Header: "Your Learning Plan — X sessions · Y minutes"
    - Stats: sessions count, total minutes needed, minutes in balance
    - If balance < needed: amber warning + "Top up minutes" CTA
    - Flow diagram (animated): each session = one node, connections show order, session groups
    - Session list: each session expandable → topic name, difficulty badge, ~20min
    - "Approve Plan" button (top-right + bottom of page)
    - "Change topics →" text link
33. User reads through plan, checks sessions
34. Clicks "Approve Plan"
35. Button shows "Approving..." (loading state)
36. ✅ Success: green "Plan Approved!" banner appears
37. ✉️ Email sent: "Your Clio plan is approved — let's schedule your sessions"
38. 📱 SMS sent: "Your Clio plan is approved! Schedule your sessions here: [link]"
39. Auto-redirects to /dashboard/schedule after 1.5s

### H. Session Scheduling
40. /dashboard/schedule loads with:
    - Header: "Schedule your sessions — X sessions · Y minutes total"
    - Preference 1: "First session date" — date picker (min: tomorrow)
    - Preference 2: "Frequency" — Daily / Every 2 days / Weekly (3 card options)
    - Preference 3: "Max session duration" — 15 min / 30 min (2 card options)
    - Preference 4: "Preferred time" — Morning (9am) / Afternoon (1pm) / Evening (6pm)
    - [LIVE PREVIEW] As user changes preferences: session list updates instantly with dates/times
    - Minutes check: "X sessions × Y min = Z min total. You have W min remaining."
    - If insufficient: amber warning + "Top up" CTA (blocking confirmation)
41. User sets preferences
42. Clicks "Confirm Schedule"
43. Button shows "Saving..." (loading state)
44. POST /api/sessions/schedule → saves all sessions to DB
45. ✅ Page transitions to "Sessions Scheduled!" confirmation view showing:
    - Green checkmark animation
    - "Your sessions are confirmed" heading
    - Full list of all sessions with date/time/topic/duration
    - "Add all to calendar" button → downloads single .ics with all sessions
    - Per-session "Add to Calendar" link
    - "Go to Dashboard" CTA
46. ✉️ Email sent: full schedule with all sessions + .ics attachment
47. 📱 SMS sent: "Your Clio sessions are scheduled! Session 1: [date]. See full schedule: [link]"

### I. Dashboard (Ongoing Use)
48. /dashboard shows:
    - Sidebar with nav items
    - Amber banner: "Your plan is ready to review" (if plan not approved) — disappears after approval
    - AI Readiness Score ring (0–100, starts at 0)
    - Day streak: 0 days active
    - Monthly messages: 0
    - Minutes balance bar: full (e.g. 30/30 for Starter)
    - Recent Insights: "Your first insight arrives tomorrow morning." (empty state)
    - Delivery preferences toggle
    - Upgrade banner (if Starter plan)

### J. Daily Insights (Recurring)
49. Each morning: insight delivered via email and/or SMS
50. User reads insight on dashboard or via email/SMS
51. Clicks 👍 or 👎 → feedback saved
52. AI Readiness Score updates after 5 feedbacks + 7 days
53. Streak increments each day user gives feedback

### K. Session Reminders (Ongoing)
54. Day before each session: email + SMS reminder
55. "Tomorrow: AI Strategy for Executives with Clio · 9am · 25 min"
56. [Phase 2] Session link provided for video call

---

## PART 3 — BUG REPORT (Current Issues)

| # | Issue | Root Cause | Priority |
|---|---|---|---|
| B1 | Flow diagram text truncated at 18 chars | NODE_W=160 too narrow; truncate(label, 18) too short | P0 |
| B2 | Can't see content above first visible node | Group rect minY=-14 (negative) clips SVG top; MARGIN too small | P0 |
| B3 | Session 1 shows 3 topics = 3 meetings needed | MAX_TOPICS_PER_SESSION=4 but each topic = one call; need 1 topic per session | P0 |
| B4 | No emails received | sendPlanReadyEmail never triggered (POST /api/plan/generate not called from topics flow) | P0 |
| B5 | Plan approved but no confirmation feedback | approve route sets DB flag but sends no email/SMS, no visible "approved" toast | P0 |
| B6 | No view after scheduling | ScheduleClient redirects to /dashboard instead of showing session list | P0 |
| B7 | No calendar invite | .ics generation not implemented | P1 |
| B8 | No day-before session reminder | Inngest job not implemented | P1 |
| B9 | Sessions page (/dashboard/sessions) | Page file exists but no sessions list component | P1 |
| B10 | Phone setup page missing | /dashboard/phone has no page.tsx | P1 |
| B11 | Time preference missing from scheduling | Only date/frequency/duration; no preferred time slot | P1 |

---

## PART 4 — STORIES BACKLOG

### Sprint 1 — Fix Critical Bugs (P0, Dev Agent 1 + Dev Agent 2)

#### DEV-AGENT-1 SCOPE (UI Fixes + Session Model)

| ID | Story | AC | Size |
|---|---|---|---|
| S-01 | **Fix FlowDiagram node width and text** | Nodes are 220px wide; all topic titles fully visible without truncation; two-line labels for long titles; group rects don't clip at top (MARGIN ≥ 60px) | M |
| S-02 | **Fix session model: 1 topic per session** | curriculum.ts groupIntoSessions creates one session per topic (since each coaching call covers one topic, 20–30 min max); sessions array length = number of topics | S |
| S-03 | **Fix plan page: session = call terminology** | Plan page calls each item a "Session" (= one call); shows topic, difficulty badge, estimated duration; no "X topics" counter (it's always 1 per session) | S |
| S-04 | **Fix schedule confirm: show sessions list** | After confirm, ScheduleClient transitions to a confirmation view in-page (not router.push): green ✅ "Sessions Scheduled!", full list with dates/times, "Add all to Calendar" button, "Go to Dashboard" button | M |
| S-05 | **Add time preference to scheduling** | Scheduling page adds a 4th preference: "Preferred time" with Morning (9am) / Afternoon (1pm) / Evening (6pm) options; affects scheduledAt hour in generated sessions | S |
| S-06 | **Sessions list page** | /dashboard/sessions/page.tsx renders DashboardShell + SessionsClient with upcoming and past sessions; each row: session number, topic, date/time, duration, status badge; empty state with CTA | M |
| S-07 | **Fix plan-ready email trigger** | After POST /api/topics completes, automatically call /api/plan/generate (or call the function inline) to trigger email + SMS notification | S |

#### DEV-AGENT-2 SCOPE (Notifications + Calendar + Phone)

| ID | Story | AC | Size |
|---|---|---|---|
| S-08 | **Plan approval confirmation email + SMS** | /api/plan/approve sends (a) email: "Your plan is approved! Schedule your sessions now [link]" (b) SMS: "Clio: Your learning plan is approved. Schedule here: [url]" | S |
| S-09 | **Session confirmation email with full schedule** | POST /api/sessions/schedule sends email containing: all sessions in table format (date, time, topic, duration); "Add to Calendar" links per session | M |
| S-10 | **Calendar invite (.ics) generation** | lib/sessions/calendar.ts generates RFC 5545 compliant .ics content per session; each event: title="Clio: [topic]", duration, description, organizer=clio | M |
| S-11 | **Calendar invite per session in email** | buildSessionConfirmationHtml includes per-session "📅 Add to Calendar" links that hit /api/sessions/[id]/calendar which returns .ics download | M |
| S-12 | **Day-before session reminder (Inngest)** | inngest/session-reminder.ts runs every hour, checks sessions with scheduled_at = tomorrow ± 1 hour, sends email + SMS reminder: "Tomorrow at [time]: [topic] with Clio · [duration]" | L |
| S-13 | **Phone setup page + OTP** | /dashboard/phone/page.tsx: enter phone number → POST /api/phone/send-otp sends 6-digit code via Twilio → enter code → POST /api/phone/verify confirms code → saves phone + assigns Twilio number → success state | L |
| S-14 | **Session confirmation SMS** | After scheduling, send SMS: "Your Clio sessions are confirmed. Session 1: [date] [time] - [topic]. Full schedule at [url]" | S |

---

### Sprint 2 — Polish & Enhancement (P1)

| ID | Story | AC | Size |
|---|---|---|---|
| S-15 | Top-up pack modal | components/dashboard/TopUpModal.tsx with 3 pack options; "Top up" button on schedule page opens modal; redirects to Stripe one-time checkout | M |
| S-16 | Recalibration dashboard banner | When needs_recalibration=true, show prominent banner in DashboardClient linking to /topics | S |
| S-17 | Plan change request flow | "Request Changes" button on plan page opens text input; user describes changes; saved to users table; future: triggers AI re-planning | M |
| S-18 | Session detail page | /dashboard/sessions/[id] shows full session info, topics, notes (empty), "Reschedule" option | M |
| S-19 | Annual billing price display | Pricing page shows monthly equivalent + annual total + "Save X%" badge | S |

---

### Sprint 4 — Plan Value Features (P1) — PDF Export, Prep Brief, Meeting Readiness

> Positioning: Starter = Learn. Pro = Learn + Prepare. Executive = Learn + Prepare + Apply.
> All plans: flat rate regardless of topic/technology (same price for AI in healthcare, finance, retail, etc.)

#### PDF Export (Foundation — needed by all three tiers)

| ID | Story | Plan | AC | Size |
|---|---|---|---|---|
| F-01 | **PDF export: session notes (Starter+)** | Starter, Pro, Executive | After each completed session, a "Download PDF" button appears on the session detail page. PDF contains: session title, date, topics covered, key visual aids (as images), session summary. Generated server-side via `/api/sessions/[id]/export`. Branded Clio header/footer. | M |
| F-02 | **PDF export: full learning curriculum (Pro+)** | Pro, Executive | On the plan page and sessions page, a "Download Curriculum PDF" button. PDF contains: user name, all planned sessions in order, topic per session, difficulty badge, estimated duration, progress status (scheduled / completed). Formatted to share with EA or chief of staff. | M |
| F-03 | **Executive Briefing Pack PDF (Executive only)** | Executive | On the dashboard, "Generate Briefing Pack" button. Calls Anthropic API with user's completed sessions + AI Readiness Score. Output: board-ready PDF with: executive summary of AI learning progress, key insights from sessions, strategic AI recommendations for the user's industry/role, progress chart. Formatted professionally (not session notes — a shareable leadership document). | L |

#### Session Prep Brief (Pro+)

| ID | Story | Plan | AC | Size |
|---|---|---|---|---|
| F-04 | **Session Prep Brief email — night before (Pro+)** | Pro, Executive | Inngest job checks sessions scheduled for tomorrow. For each Pro/Executive user: generate a 1-page Prep Brief via Anthropic: (1) "What we'll cover today" — topic summary in 3 bullets, (2) "3 key concepts to know going in", (3) "2 questions worth thinking about before we start". Send as email at 8pm the night before. Also available as PDF download from session detail page. | L |
| F-05 | **Session Prep Brief — dashboard preview** | Pro, Executive | On the session detail page for an upcoming session, show the Prep Brief inline (not just via email). If not yet generated, show "Generating your prep brief..." with a spinner. Brief can be downloaded as PDF (reuses F-01 PDF infrastructure). | M |

#### Meeting Readiness (Executive only)

| ID | Story | Plan | AC | Size |
|---|---|---|---|---|
| F-06 | **Meeting Readiness — input form** | Executive | New page: `/dashboard/meeting-readiness`. Form fields: Meeting title, Meeting date/time, Who you're meeting (name + company + role), What the meeting is about (freetext), Any context or documents (freetext). Submit calls `/api/meeting-readiness/generate`. | M |
| F-07 | **Meeting Readiness — AI briefing generation** | Executive | POST `/api/meeting-readiness/generate`: calls Anthropic with meeting context + user's AI knowledge level (from AI Readiness Score + completed session topics). Output structured briefing: (1) About who you're meeting — company background, AI positioning, (2) What they're likely to pitch/discuss, (3) 5 questions to ask them, (4) Red flags to watch for, (5) How to evaluate what they tell you. Saved to DB + returned to client. | L |
| F-08 | **Meeting Readiness — briefing view + PDF** | Executive | Briefing displayed on the page in a clean readable layout (sections with headers). "Download as PDF" exports a professionally formatted briefing document. Briefing can be regenerated if context changes. List of past briefings accessible from sidebar. | M |

#### UI — Plan Benefits on Pricing & Plan Selection (immediate — do first)

| ID | Story | Plan | AC | Size |
|---|---|---|---|---|
| F-09 | **Update pricing page with full plan benefits** | All | Pricing page shows benefit-led copy per plan (not just feature list). Each plan includes: minutes/mo, flat-rate messaging, all key features with icons. Add "What's included" section below the plan cards with a full comparison table. | S |
| F-10 | **Update schedule plan selection with full benefits** | All | Plan cards on the schedule page show: minutes/mo prominently, feature list matching the plan, and a "Most popular" / recommended badge for Pro. | S |

---

### Sprint 3 — Phase 2 Foundations (P2)

| ID | Story | Notes |
|---|---|---|
| S-20 | Recall.ai integration | Video call bot joins session; requires Recall.ai API key |
| S-21 | ElevenLabs voice | Clio speaks during sessions |
| S-22 | Post-session AI summary | Anthropic call on transcript → structured notes |
| S-23 | Real-time minutes deduction | Inngest event per minute consumed during call |

---

## PART 5 — TEST REPORT TEMPLATE

Each story must be validated against:
1. **Renders correctly** — page loads, no console errors, no blank sections
2. **Data correct** — values from DB/state are accurate
3. **Interactions work** — buttons, forms, toggles behave correctly
4. **Emails sent** — email templates render correctly, are received
5. **SMS sent** — if applicable, Twilio delivery confirmed
6. **Edge cases handled** — empty state, error state, insufficient minutes
7. **Mobile responsive** — layout works at 375px width

---

## PART 6 — KNOWN CONSTRAINTS

- Twilio shared number: 1 number for all tiers at launch
- SMS delivery requires phone setup in /dashboard/phone
- Plan generation is client-side (curriculum.ts); no Anthropic call yet for plan personalisation
- Sessions are schedule-only at launch; video calls are Phase 2
- Calendar invites are .ics downloads; Google Calendar direct add is Phase 2
- OTP verification uses Twilio SMS (no Twilio Verify service; simple 6-digit stored in DB)
