---
id: FB-003
title: Fix User Flow — Topics Before Sign-Up
status: pending-ba-spec
author: CEO Agent
date: 2026-05-31
---

# Feature Brief — FB-003

## What We're Building

A set of flow corrections to make the user journey match the intended product experience:

**Correct flow:**
```
Landing → "Get started"
  → /onboarding (6 questions, no auth required)
  → "Building your plan..."
  → /topics (AI recommendations, no auth required)
  → "Build my learning plan →"
  → /sign-up (if not signed in) OR /plan (if signed in)
  → /plan (pick Starter / Pro / Executive)
  → /checkout (payment)
  → /dashboard
```

**Six specific fixes:**

1. **Onboarding always redirects to /topics after Q6** — currently conditional on auth state (`isSignedIn ? '/topics' : '/sign-up'`). Topics must be shown to ALL users before sign-up.

2. **Topics page becomes a public route** — currently protected by Clerk middleware. Must be accessible without authentication.

3. **Topics "Build my learning plan" button is auth-aware** — if not signed in: save selected topics to localStorage and redirect to `/sign-up`. If signed in: redirect to `/plan`.

4. **afterSignUpUrl changes to /plan** — currently set to `/onboarding` in the sign-up page component. After sign-up, the user's onboarding data and selected topics are already in localStorage. They go straight to plan selection.

5. **Drop topic minimum from 3 to 1** — any single topic selection should unlock the "Build my learning plan" button. The curriculum engine can handle 1+ topics. A 3-topic floor adds friction without product benefit.

6. **Dashboard gate redirects to /plan not /pricing (Story S3)** — `app/dashboard/layout.tsx` currently redirects unsubscribed users to `/pricing`. This sends them back to the top of a public marketing page. It should redirect to `/plan` where they can choose and subscribe.

## Why

The current flow sends users to sign-up BEFORE they see topics. This means users commit to creating an account before experiencing the product's core value (personalised topic recommendations). Moving topics before sign-up lets users see value first, then commit. This is standard product-led growth practice.

The dashboard gate issue means a user who somehow reaches `/dashboard` without a subscription gets thrown to the marketing page instead of the subscription flow.

## User Story

As a new visitor, I want to see my personalised topic recommendations immediately after answering the onboarding questions — before being asked to create an account — so I know Clio is worth signing up for.

## Scope

**In scope:**
- All 6 fixes listed above
- `/topics` remains accessible to signed-in users (no regression)
- Topics selected before sign-up are preserved in localStorage and available when the user reaches `/plan`

**Out of scope:**
- Any changes to the topic recommendation logic or Claude API prompt
- Any changes to the onboarding questions themselves
- S5 (trial redesign) — separate feature brief required
- Inngest mark-session-ready race condition — separate fix required

## Acceptance (high level)

- A user who has never signed in can complete onboarding and reach `/topics`
- A user who has never signed in can see all 4 sections of topic recommendations
- Clicking "Build my learning plan →" with 1 topic selected works (not blocked)
- Clicking "Build my learning plan →" when not signed in → goes to `/sign-up`
- After signing up with Google → lands on `/plan`, not `/onboarding`
- A signed-in user who visits `/dashboard` without a subscription → redirects to `/plan`
