# Session Handoff — Read This First on a New Login

_Last updated: 2026-07-01 | Written for continuity across Claude logins/machines_

This file exists so a fresh Claude Code session (different login, different machine, or memory wiped) can pick up exactly where the last session left off. Read this, then `BACKLOG.md` for the full feature backlog, then `CLAUDE.md` for governance rules.

---

## Ground rule — do not skip

**Never make code changes without Arun's explicit approval.** Investigate, diagnose, and present findings/options first. A plan or diagnosis is not approval — wait for an explicit "yes fix it" / "proceed" / "go ahead" before touching any file. This was stated directly by Arun on 2026-07-01 after a prior session made unapproved changes.

---

## What just happened (most recent session)

### Incident: auth redirect flow broke onboarding
A new user completed sign-up but the **topic selection page (`/topics`) was skipped entirely** — curriculum generated from hardcoded fallback topics instead of the user's actual profile.

**Root cause:** Two Clerk redirect props were hard-overriding the correct destination:
- `app/(auth)/sign-in/[[...sign-in]]/page.tsx` — `signUpForceRedirectUrl="/plan"` sent new sign-ups straight to `/plan`, bypassing onboarding
- `app/(auth)/sign-up/[[...sign-up]]/page.tsx` — `forceRedirectUrl="/plan"` ignored the `?redirect_url=/onboarding` param

`forceRedirectUrl` / `signUpForceRedirectUrl` are **hard overrides** in Clerk — they ignore all URL params. Only `afterSignUpUrl` behaves as a soft default.

**Fix (committed and deployed to production):**
- `e55f7bb` — sign-in page → `signUpForceRedirectUrl="/onboarding"`; sign-up page → `forceRedirectUrl="/onboarding"`
- `a390589` — added `/plan(.*)` to middleware's public routes (prevents a session race condition right after sign-up)
- Deployed to production 2026-07-01 (commit `a390589`), verified clean via `get_runtime_errors` — no new errors introduced.

### The canonical onboarding flow (do not deviate)
```
Onboarding → Role → Domain/Industry → AI Maturity → Learning goal/Worry
  → Sign up (first name / Google)
  → /topics        (topic selection based on profile)
  → /plan           (pricing — pick a plan)
  → /checkout       (payment)
  → curriculum generates
  → /plan           (personalised plan appears)
  → /dashboard
```
Key file: `app/onboarding/page.tsx` line ~732 — `router.push('/topics')` after sign-up. Any future auth/redirect change must preserve this order. Never route to `/plan` or `/dashboard` before `/topics` has been visited post-signup.

**Files that must always be checked together when touching auth redirects:**
- `app/(auth)/sign-in/[[...sign-in]]/page.tsx`
- `app/(auth)/sign-up/[[...sign-up]]/page.tsx`
- `middleware.ts` (public routes list)
- `app/onboarding/page.tsx` (post-auth redirect)

### Not yet tested
Arun was about to re-test the full flow end-to-end on the freshly deployed fix. **Next step on resume: ask if the flow test passed, or re-test it.**

---

## Open threads from earlier in the same session (not yet actioned — awaiting approval)

1. **Hume EVI 3 keep-alive disconnect** — `WalkthroughClient.tsx` fires `injectContext` every 8s with no provider check. For Hume, this sends a prohibited `session_settings.system_prompt` field, causing the socket to close (E0716/1008) and `onDisconnect` to fire. Fix identified (add a provider guard before calling `injectContext` in the keep-alive block) but **not implemented** — needs approval.
2. **Content article trims** — `source_concepts` field in generated articles has zero consumers (dead weight), `common_misconceptions` and `decision_questions` are over-requested. ~80–120 words/article could be trimmed. **Not implemented** — needs approval.
3. **Two parallel content pipelines both registered in Inngest** (`session-content-pipeline` + `session-content-async` in `app/api/inngest/route.ts`). The old async pipeline still runs hourly via `session-content-cron` against ALL scheduled sessions — misaligned with the intended "generate on approval" flow. Needs a decision on whether to retire `session-content-async`.
4. **Breadth expansion topics always `is_visible: false`** — `lib/curriculum/planner.ts` STEP 6 generates adjacent/prerequisite topics but they never surface in the plan. Not yet investigated further — was queued behind the auth fix.

---

## Stale/unrelated item in `.claude/plans/`

There's a saved plan at `~/.claude/plans/encapsulated-churning-gadget.md` about a `/dashboard/plan` crash (`Cannot read properties of undefined (reading 'charAt')`). This was **not actively being worked on** in the most recent session — unclear if it's still reproducing. Verify it's still an issue before acting on it; may be stale.

---

## Where to find more

- `BACKLOG.md` — full prioritized feature backlog (P0/P1/P2), updated 2026-06-23, still current for feature work.
- `CLAUDE.md` (root) — governance model (Arun → CEO Agent → BA Agent → Developer, no code without approved spec), tech stack, design system, agent roster.
- `docs/specs/AUTH-01-onboarding-vs-login-flow.md` — BA spec written this session documenting the approved flow in detail.
- Production URL: `distill-peach.vercel.app` (current), `hello-clio.com` / `www.hello-clio.com` (aliased, future primary domain).
- Vercel project: `prj_05lfiXOO7aVzoMwf5xPyuYvXv3OO`, team `team_EWsaTlIksJvb7aUbQdJwQD1T` — use `get_runtime_logs` / `get_runtime_errors` MCP tools for monitoring, not `npx vercel logs` CLI.
