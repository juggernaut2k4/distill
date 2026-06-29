# QA Role-Aware Checks — Requirement Document
Version: 1.0
Status: APPROVED
Author: Business Analyst Agent
Date: 2026-06-29

---

## 1. Purpose

The QA Validation Playbook today validates that a user profile was saved correctly and that arcs exist, but it does not check whether the generated curriculum is actually calibrated for the user's role tier. A CEO and a software engineer could receive nearly identical arc names and Stages 1–2 would pass both. Role differentiation failures only surface today when Arun or the CEO Agent manually reads arc titles and recognises generic or wrong-tier language — a judgement call that cannot scale as the user base grows.

This feature adds three automated checks — grouped as Stage 2A — that convert that manual judgement into a deterministic, repeatable signal. Check 5A validates that arc names in the generated plan contain language appropriate to the user's role tier. Check 5B validates that session subtopic titles carry the same tier-appropriate language. Check 5C validates that the plan covers at least one topic the user explicitly cares about. All three checks are pure case-insensitive substring matches against text the LLM already generated; no external API calls are required.

Without these checks, a regression in the curriculum generator prompt — such as role-specific framing being stripped from arc names — would be invisible until a human read a plan and noticed it. With them, the regression surfaces immediately in Stage 2A and produces a failing `ok: false` response with enough detail for the developer to trace the root cause without reading source code.

---

## 2. User Stories

**As a QA operator running the validation playbook after a new user completes onboarding,**
I want to call a single endpoint and receive a structured pass/fail verdict for role differentiation and topic coverage,
So that I can confirm the curriculum was correctly personalised for this user's tier without manually reading every arc name.

**As the CEO Agent reviewing a generated plan,**
I want the Stage 2A check to automatically flag when arc language does not match the user's role tier,
So that I can catch curriculum generator regressions immediately rather than during a live session.

**As a developer investigating why a user's plan looks generic,**
I want the endpoint response to include the specific arcs and subtopics that failed the keyword check, along with the keyword list that was applied,
So that I can identify whether the problem is in the LLM prompt, the role mapping, or the keyword definitions.

---

## 3. Functional Requirements

### 3.1 Endpoint

`GET /api/admin/qa-role-checks`

Optional query parameter: `userId` (string). If omitted, the endpoint evaluates the authenticated user's own plan. If provided, it evaluates the specified user's plan.

Authentication: Clerk `auth()`. If the caller is not authenticated, return HTTP 401. No additional admin-role guard beyond Clerk auth — same model as `qa-curriculum-order`.

Read-only. No writes. No side effects. No calls to external APIs or LLMs.

`maxDuration = 30`

### 3.2 Check 5A — Role Differentiation (Arc Names)

Source: `curriculum_plans.visible_sessions` JSONB array. Each element is an arc object; the arc name is at `arc_name` (string).

Tier mapping: call `getRoleTier(users.role_level)` from `lib/curriculum/role-utils.ts` to determine which keyword list to apply.

Method: for each arc, perform case-insensitive substring matching of the arc name against the tier's keyword list. An arc passes if at least one keyword from the list appears anywhere in the arc name string.

Pass threshold: at least 60% of arcs must pass (i.e., matched arcs / total arcs >= 0.60).

Score: `matched_count / total_count` expressed as a decimal (e.g. 0.75 for 75%).

### 3.3 Check 5B — Content Orientation (Subtopic Titles)

Source: `sessions` table, `sub_sessions` JSONB column. The column stores an array of objects with shape `{ title: string, type: string, duration_mins: number, learning_objective: string }`. Extract the `title` field from each element.

Scope: all sessions for the user that are not in `cancelled` status.

Tier: same tier derived in 5A (call `getRoleTier` once, reuse the result for all checks).

Method: for each subtopic title string, perform case-insensitive substring matching against the same tier keyword list used in 5A. A subtopic title passes if at least one keyword matches.

Null handling: if `sub_sessions` is null or not a valid array for a session row, treat that session as contributing zero subtopic titles to both the numerator and denominator. Do not throw; do not return 500.

Pass threshold: at least 50% of all subtopic titles across all sessions must pass (total matched titles / total titles >= 0.50).

Score: `matched_title_count / total_title_count` expressed as a decimal. If no sessions have any subtopic titles at all (total_title_count = 0), score = 0 and the check fails.

### 3.4 Check 5C — Topic Coverage

**Technical tier users (roleLevel = 'specialist'):**

Source: arc names from `curriculum_plans.visible_sessions` (same array as 5A).

Required keywords (fixed, case-insensitive substring): `claude`, `gpt`, `llm`, `llms`, `prompt engineering`

Pass condition: at least one arc name contains at least one of the required keywords.

Score: 1 if pass, 0 if fail.

**Executive and manager tier users (roleLevel = c-suite, vp-dir, vp-technology, vp-product, manager):**

Source: arc names from `curriculum_plans.visible_sessions`. User interest strings from `users.topic_interests` (string array).

Pass condition: at least one arc name contains at least one word from the `topic_interests` array. Each interest string is matched as a case-insensitive substring against each arc name. If `topic_interests` is null, empty, or unavailable, the check score = 0 and the check fails with detail "topic_interests not set for user."

Score: 1 if pass, 0 if fail.

### 3.5 Overall Response

`ok: true` only when all three checks pass (5A ok AND 5B ok AND 5C ok).

`ok: false` if any single check fails.

`issues` array: empty (or `['None — all checks passed']`) when all pass; otherwise contains one human-readable string per failed check describing which check failed, what ratio was achieved, and what threshold was required.

---

## 4. Data Sources

### 4.1 `curriculum_plans` table

Columns read:
- `id` — plan identifier, echoed in response
- `user_id` — filter to target user
- `visible_sessions` — JSONB array of arc objects; shape per element:
  ```typescript
  {
    arc_name: string,           // used by 5A and 5C
    arc_type: string,           // 'domain' | 'integrated' | 'singleton'
    arc_description: string,
    comprehensive_subtopics: string[],
    is_visible: boolean
  }
  ```
- `superseded_at` — filter to non-superseded plan (`.is('superseded_at', null)`)
- `generated_at` — order descending, take limit 1

Active plan query: `WHERE user_id = targetUserId AND superseded_at IS NULL ORDER BY generated_at DESC LIMIT 1`.

If no row is returned: respond HTTP 404 with `{ ok: false, error: 'No active curriculum plan found for this user.' }`.

### 4.2 `sessions` table

Columns read:
- `id`
- `sub_sessions` — JSONB, array of objects with shape:
  ```typescript
  {
    title: string,
    type: string,
    duration_mins: number,
    learning_objective: string
  }
  ```
- `status` — filter to exclude `'cancelled'`
- `user_id` — filter to target user

Extraction: `Array.isArray(s.sub_sessions) ? (s.sub_sessions as SubSession[]).map(x => x.title) : []`

### 4.3 `users` table

Columns read:
- `role_level` — string; one of `c-suite | vp-dir | vp-technology | vp-product | manager | specialist`
- `topic_interests` — string array; used only for Check 5C on executive/manager tier users

### 4.4 `lib/curriculum/role-utils.ts`

`getRoleTier(roleLevel: string): RoleTier` maps role levels to tiers:

| role_level | tier |
|---|---|
| c-suite | executive |
| vp-dir | executive |
| vp-technology | executive |
| vp-product | executive |
| manager | manager |
| specialist | technical |
| (unknown/null) | manager (default) |

Call this function once per request. Do not inline the mapping logic in the route file.

---

## 5. Business Rules

### 5.1 Keyword Lists (fixed in code, case-insensitive substring)

**Executive tier** (applies to c-suite, vp-dir, vp-technology, vp-product):
```
govern, governance, strategy, strategic, roi, cost, vendor, risk, board,
compliance, budget, oversight, policy, evaluate, investment, stakeholder, executive
```

**Technical tier** (applies to specialist):
```
implement, build, code, api, deploy, debug, architect, framework, integrate,
prompt engineering, llm, model, pipeline, engineer, developer, sdk, token, fine-tun
```

**Manager tier** (applies to manager):
```
team, workflow, process, adoption, productivity, collaboration, onboard,
training, manage, operational, rollout, change management
```

These lists are hardcoded constants in the route file. They are not read from the database. They must not be modified without a new BA spec version.

### 5.2 Threshold Constants (fixed in code)

| Check | Threshold | Condition |
|---|---|---|
| 5A | 0.60 | matched_arcs / total_arcs >= 0.60 |
| 5B | 0.50 | matched_titles / total_titles >= 0.50 |
| 5C | 1.0 (binary) | at least 1 arc matches |

### 5.3 Tier Mapping Authority

`getRoleTier()` from `lib/curriculum/role-utils.ts` is the single source of truth. The route must import and call it. It must not re-implement the mapping inline. This ensures that if the mapping is updated in the future, both the curriculum generator and the QA checks remain consistent.

### 5.4 Auth Model

Same model as `qa-curriculum-order`:
- Any authenticated Clerk user may call the endpoint without a `userId` param and receive their own results.
- Any authenticated Clerk user may pass a `?userId=<id>` param to inspect another user's results.
- No additional admin-role guard is applied.
- Unauthenticated callers receive HTTP 401.

### 5.5 Error Handling

| Condition | Response |
|---|---|
| No Clerk session | HTTP 401 `{ error: 'Unauthorized' }` |
| No active plan for targetUserId | HTTP 404 `{ ok: false, error: 'No active curriculum plan found for this user.' }` |
| `visible_sessions` is null or empty | HTTP 200, all three checks fail, issues array describes 0 arcs found |
| `sub_sessions` is null for some sessions | Those sessions contribute zero titles; do not throw |
| `topic_interests` is null or empty (executive/manager 5C) | Check 5C fails with detail "topic_interests not set for user" |
| `role_level` is null or unknown | `getRoleTier` returns `'manager'` as default; manager keyword list is applied |

---

## 6. API Contract

### 6.1 Request

```
GET /api/admin/qa-role-checks?userId=<clerkUserId>
Authorization: Clerk session cookie (automatic via middleware)
```

`userId` is optional. If omitted, uses authenticated user's Clerk id.

### 6.2 Response — HTTP 200

```typescript
interface CheckResult {
  ok: boolean
  score: number          // decimal 0–1 (e.g. 0.75 = 75%), binary 1 or 0 for 5C
  threshold: number      // 0.60 for 5A, 0.50 for 5B, 1.0 for 5C
  detail: string         // human-readable summary of the result
  signals_found: string[]   // keyword(s) that matched at least once
  signals_missing: string[] // for 5C: required keywords not found in any arc; for 5A/5B: empty
}

interface QARoleChecksResponse {
  ok: boolean
  user_id: string
  plan_id: string
  role_level: string        // raw value from users table
  role_tier: string         // 'executive' | 'technical' | 'manager'
  keyword_list_used: string[]  // the tier keyword list that was applied
  total_arcs: number
  total_subtopic_titles: number
  checks: {
    '5a': CheckResult
    '5b': CheckResult
    '5c': CheckResult
  }
  issues: string[]   // ['None — all checks passed'] or one string per failed check
}
```

### 6.3 Example — All Checks Pass (executive user)

```json
{
  "ok": true,
  "user_id": "user_abc123",
  "plan_id": "plan_xyz789",
  "role_level": "vp-technology",
  "role_tier": "executive",
  "keyword_list_used": ["govern", "governance", "strategy", "strategic", "roi", "cost", "vendor", "risk", "board", "compliance", "budget", "oversight", "policy", "evaluate", "investment", "stakeholder", "executive"],
  "total_arcs": 5,
  "total_subtopic_titles": 28,
  "checks": {
    "5a": {
      "ok": true,
      "score": 0.80,
      "threshold": 0.60,
      "detail": "4 of 5 arcs (80%) contain executive-tier keywords — above 60% threshold",
      "signals_found": ["vendor", "strategy", "roi", "governance"],
      "signals_missing": []
    },
    "5b": {
      "ok": true,
      "score": 0.57,
      "threshold": 0.50,
      "detail": "16 of 28 subtopic titles (57%) contain executive-tier keywords — above 50% threshold",
      "signals_found": ["vendor", "strategy", "risk", "cost", "board"],
      "signals_missing": []
    },
    "5c": {
      "ok": true,
      "score": 1,
      "threshold": 1.0,
      "detail": "At least one arc name matches user topic_interests",
      "signals_found": ["financial services"],
      "signals_missing": []
    }
  },
  "issues": ["None — all checks passed"]
}
```

### 6.4 Example — Check 5A Fails (executive user)

```json
{
  "ok": false,
  "user_id": "user_abc123",
  "plan_id": "plan_xyz789",
  "role_level": "c-suite",
  "role_tier": "executive",
  "keyword_list_used": ["govern", "governance", "strategy", "strategic", "roi", "cost", "vendor", "risk", "board", "compliance", "budget", "oversight", "policy", "evaluate", "investment", "stakeholder", "executive"],
  "total_arcs": 5,
  "total_subtopic_titles": 28,
  "checks": {
    "5a": {
      "ok": false,
      "score": 0.40,
      "threshold": 0.60,
      "detail": "Check 5A: only 2 of 5 arcs (40%) contain executive-tier keywords — below 60% threshold",
      "signals_found": ["strategy"],
      "signals_missing": []
    },
    "5b": {
      "ok": true,
      "score": 0.54,
      "threshold": 0.50,
      "detail": "15 of 28 subtopic titles (54%) contain executive-tier keywords — above 50% threshold",
      "signals_found": ["cost", "vendor", "risk"],
      "signals_missing": []
    },
    "5c": {
      "ok": true,
      "score": 1,
      "threshold": 1.0,
      "detail": "At least one arc name matches user topic_interests",
      "signals_found": ["retail"],
      "signals_missing": []
    }
  },
  "issues": [
    "Check 5A: only 2 of 5 arcs (40%) contain executive-tier keywords — below 60% threshold"
  ]
}
```

### 6.5 Error Responses

```
HTTP 401  { "error": "Unauthorized" }
HTTP 404  { "ok": false, "error": "No active curriculum plan found for this user." }
```

---

## 7. Edge Cases

### 7.1 User has 0 arcs (`visible_sessions` is null or empty array)

- `total_arcs = 0`
- Check 5A: score = 0, fails, detail = "Check 5A: no arcs found in visible_sessions — cannot evaluate role differentiation"
- Check 5B: score = 0, fails (no titles to evaluate)
- Check 5C: score = 0, fails (no arcs to match)
- `ok: false`
- issues array lists all three failures

### 7.2 All sessions have null `sub_sessions`

- `total_subtopic_titles = 0`
- Check 5B: score = 0, fails, detail = "Check 5B: no subtopic titles found across any session — sub_sessions may be null for all sessions"
- Checks 5A and 5C are unaffected (they read arc names, not sessions)
- Do not return 500

### 7.3 New user with plan but 0 sessions created (pre-approval state)

- `curriculum_plans` row exists → plan loads successfully
- Sessions query returns empty → `total_subtopic_titles = 0`
- Check 5B fails with detail explaining zero titles found
- Checks 5A and 5C still run against arc names from the plan
- This is a valid state; the endpoint returns HTTP 200, not 404

### 7.4 Unknown or null `role_level`

- `getRoleTier(null ?? '')` returns `'manager'` (the default branch in the switch statement)
- Manager keyword list is applied to all three checks
- Response includes `role_tier: 'manager'` so the caller can see what was applied

### 7.5 `topic_interests` is null or empty (executive/manager user, Check 5C)

- Check 5C score = 0, fails
- detail = "Check 5C: topic_interests not set for this user — cannot verify topic coverage"
- `signals_found = []`, `signals_missing = []`
- This is a profile completeness failure, not a code error

### 7.6 `topic_interests` contains a single very short word (e.g. "AI")

- Case-insensitive substring match will still work; short strings will match many arc names
- No minimum length guard is applied — this is acceptable behaviour; the interest is the user's stated value

### 7.7 Large plan (35+ arcs, 200+ subtopic titles)

- All arcs and subtopics are iterated; no pagination
- The endpoint must return within the 30-second `maxDuration` limit
- String matching is O(arcs × keywords) and O(titles × keywords); both are linear and well within the time budget at these scales

### 7.8 `vp-technology` user — must not be evaluated as technical tier

- `getRoleTier('vp-technology')` returns `'executive'`
- Executive keyword list is applied
- The response includes `role_tier: 'executive'` confirming correct mapping
- This is validated by acceptance test 7 below

### 7.9 Multiple sessions, some with null `sub_sessions`, some with valid arrays

- Valid sessions contribute their titles to the numerator and denominator
- Null sessions contribute 0 to both
- The aggregate ratio is computed across all non-null titles only
- The `total_subtopic_titles` field in the response reflects only titles that were successfully extracted

---

## 8. Acceptance Criteria

These are written as testable statements. A QA operator can verify each one by calling the endpoint against a known user record.

**AC-01 — Happy path: all checks pass**
Given a user with role_level `c-suite` and an active plan where 4 of 5 arc names contain executive-tier keywords and 60%+ of subtopic titles contain executive-tier keywords and at least one arc name matches a word in `topic_interests`,
When `GET /api/admin/qa-role-checks?userId=<id>` is called,
Then the response is HTTP 200 with `ok: true`, all three check objects have `ok: true`, and the issues array contains `['None — all checks passed']`.

**AC-02 — Check 5A fails below threshold**
Given a user with role_level `vp-dir` and an active plan where only 2 of 5 arc names (40%) contain executive-tier keywords,
When the endpoint is called,
Then `ok: false`, `checks['5a'].ok = false`, `checks['5a'].score = 0.40`, `checks['5a'].threshold = 0.60`, and the issues array contains one string mentioning "Check 5A", the arc count, the percentage, and the threshold.

**AC-03 — Check 5B fails below threshold**
Given a user with role_level `manager` and sessions where only 40% of subtopic titles contain manager-tier keywords,
When the endpoint is called,
Then `ok: false`, `checks['5b'].ok = false`, `checks['5b'].score = 0.40`, `checks['5b'].threshold = 0.50`, and the issues array contains a string mentioning "Check 5B".

**AC-04 — Check 5C fails for technical user**
Given a user with role_level `specialist` and an active plan where no arc name contains `claude`, `gpt`, `llm`, `llms`, or `prompt engineering`,
When the endpoint is called,
Then `checks['5c'].ok = false`, `checks['5c'].score = 0`, and the issues array contains a string mentioning "Check 5C".

**AC-05 — Check 5C fails for non-technical user with no topic_interests**
Given a user with role_level `c-suite` and `topic_interests` is null,
When the endpoint is called,
Then `checks['5c'].ok = false`, and detail contains "topic_interests not set for this user".

**AC-06 — Null sub_sessions does not throw**
Given a user with an active plan and at least one session row where `sub_sessions` is null,
When the endpoint is called,
Then the response is HTTP 200 (not 500), and Check 5B either passes or fails based on the remaining non-null sessions. No exception is raised.

**AC-07 — vp-technology maps to executive tier**
Given a user with role_level `vp-technology`,
When the endpoint is called,
Then the response contains `role_tier: 'executive'` and `keyword_list_used` matches the executive keyword list (contains `governance`, `roi`, etc.) — not the technical keyword list.

**AC-08 — No userId param uses authenticated user**
Given an authenticated Clerk session for user A,
When `GET /api/admin/qa-role-checks` is called with no `userId` param,
Then the response contains `user_id` equal to user A's Clerk id.

**AC-09 — Unauthenticated request returns 401**
Given no Clerk session cookie,
When `GET /api/admin/qa-role-checks` is called,
Then the response is HTTP 401 with `{ "error": "Unauthorized" }`.

**AC-10 — User with no active plan returns 404**
Given a userId where `curriculum_plans` has no row with `superseded_at IS NULL`,
When the endpoint is called with `?userId=<id>`,
Then the response is HTTP 404 with `{ "ok": false, "error": "No active curriculum plan found for this user." }`.

**AC-11 — Response includes keyword_list_used**
For every HTTP 200 response,
The `keyword_list_used` field must be present and must be the full array of keywords that were applied during the check run, so the caller can understand the basis of the verdict without reading source code.

**AC-12 — No writes to database**
After calling the endpoint,
No rows in any table are created, updated, or deleted. The endpoint is observably idempotent across any number of calls.

---

## 9. Non-Functional Requirements

**NFR-01 — Response time:** The endpoint must return within 2 seconds for any user with up to 35 arcs and 200 subtopic titles. String matching is the only computation; no LLM calls, no external HTTP calls, and no writes are permitted.

**NFR-02 — No external calls:** The endpoint must not call Anthropic, Twilio, Resend, Stripe, NewsAPI, or any other external service. All data comes from Supabase.

**NFR-03 — No writes:** The endpoint must not write to any database table. It is a pure read endpoint. Verified by AC-12.

**NFR-04 — TypeScript strict mode:** The route file must compile clean under `npx tsc --noEmit`. No `any` types are permitted in the route file or any types it defines. Import `RoleTier` from `lib/curriculum/role-utils.ts` rather than redeclaring it.

**NFR-05 — maxDuration:** Set `export const maxDuration = 30` at module level, matching the pattern in `qa-curriculum-order`.

**NFR-06 — Supabase client:** Use `createSupabaseAdminClient()` from `@/lib/supabase`. Do not use the browser client.

**NFR-07 — Keyword matching is case-insensitive substring only:** No regex character classes, no fuzzy matching, no semantic similarity. The check is: `arcName.toLowerCase().includes(keyword.toLowerCase())`. Multi-word keywords (e.g. `prompt engineering`, `change management`, `fine-tun`) are matched as complete substrings.

---

## 10. Out of Scope

The following are explicitly not part of this feature. They must not be built as part of QA-ROLE-01.

- **Semantic or embedding-based similarity matching.** All matching is case-insensitive substring only.
- **Database-driven keyword lists.** Keywords are hardcoded constants. There is no admin UI or database table for managing them.
- **Automatic remediation.** The endpoint reports; it does not trigger curriculum regeneration, send notifications, or write any state.
- **Checks on script or KB content.** The three checks target arc names and subtopic titles only. Script word choice, visualization template selection, and KB content quality are covered by Stages 4 and 5 of the playbook.
- **Per-arc pass/fail breakdown in the issues array.** The issues array contains one string per failed check. The per-arc detail is available inside the `checks['5a']` object but is not repeated in `issues`.
- **Renumbering of existing playbook stages.** Stage 2A is inserted as a sub-stage label. Stages 0 through 6 retain their current numbers and headings.
- **Admin-only access control.** Any authenticated Clerk user may call the endpoint for any userId. A future spec may add admin guards if needed.
- **Automated playbook execution.** The playbook remains a manual checklist. This feature adds one automated step to it; it does not automate the surrounding stages.
- **Mobile or UI surface.** This is an API endpoint only. No dashboard component or visual display is part of this spec.

---

## 11. Open Questions

None.

All questions from the CEO feature brief have been answered by Arun and are incorporated into this document:

- Q1 (keyword lists): confirmed keyword lists for all three tiers are in Section 5.1
- Q2 (sub_sessions JSON shape): confirmed as array of objects with `title` field; extraction path documented in Section 4.2
- Q3 (arc name field): confirmed as `arc_name` on the arc object; documented in Section 4.1
- Q4 (Check 5C non-technical): confirmed as case-insensitive substring match of each `topic_interests` string against arc names; documented in Section 3.4
- Q5 (per-check response shape): full TypeScript interface defined in Section 6.2
- Q6 (playbook update scope): full Stage 2A content specified in Section 12
- Q7 (admin auth model): confirmed as same Clerk-only model as `qa-curriculum-order`; documented in Section 5.4

---

## 12. Playbook Update — Stage 2A

The following section must be inserted into `docs/QA_VALIDATION_PLAYBOOK.md` between Stage 2 and Stage 3.

---

### Stage 2A — Role Differentiation & Coverage Checks (Automated)

_Run immediately after Stage 2 (plan validation). This stage is fully automated — no SQL required._

#### Endpoint

```
GET /api/admin/qa-role-checks?userId=<userId>
```

Replace `<userId>` with the target user's Clerk user id. Omit the `userId` param to check your own account.

Requires an authenticated Clerk session (cookie forwarded automatically in the browser, or pass the session token via Authorization header from curl).

#### What it checks

| Check | What it tests | Source | Pass threshold |
|---|---|---|---|
| 5A — Role Differentiation | Arc names contain role-tier keywords | `curriculum_plans.visible_sessions[].arc_name` | 60% of arcs match |
| 5B — Content Orientation | Subtopic titles contain role-tier keywords | `sessions.sub_sessions[].title` | 50% of titles match |
| 5C — Topic Coverage | Plan covers foundational AI tooling (technical) or user's stated interests (exec/manager) | Arc names vs keyword list or `topic_interests` | Binary: at least 1 arc matches |

#### Keyword lists applied per tier

**Executive tier** (role_level: c-suite, vp-dir, vp-technology, vp-product):
`govern, governance, strategy, strategic, roi, cost, vendor, risk, board, compliance, budget, oversight, policy, evaluate, investment, stakeholder, executive`

**Manager tier** (role_level: manager):
`team, workflow, process, adoption, productivity, collaboration, onboard, training, manage, operational, rollout, change management`

**Technical tier** (role_level: specialist):
`implement, build, code, api, deploy, debug, architect, framework, integrate, prompt engineering, llm, model, pipeline, engineer, developer, sdk, token, fine-tun`

All matching is case-insensitive substring. A keyword does not need to be a complete word — `fine-tun` matches `fine-tuning`.

#### Sample curl command

```bash
curl -s "https://distill-peach.vercel.app/api/admin/qa-role-checks?userId=USER_ID_HERE" \
  -H "Cookie: __session=YOUR_CLERK_SESSION_COOKIE" | jq .
```

#### Interpreting the response

**All checks pass:**
```json
{
  "ok": true,
  "role_tier": "executive",
  "checks": {
    "5a": { "ok": true, "score": 0.80, "threshold": 0.60, "detail": "4 of 5 arcs (80%) contain executive-tier keywords — above 60% threshold" },
    "5b": { "ok": true, "score": 0.57, "threshold": 0.50, "detail": "16 of 28 subtopic titles (57%) contain executive-tier keywords — above 50% threshold" },
    "5c": { "ok": true, "score": 1, "threshold": 1.0, "detail": "At least one arc name matches user topic_interests" }
  },
  "issues": ["None — all checks passed"]
}
```

**Check 5A fails:**
```json
{
  "ok": false,
  "role_tier": "executive",
  "checks": {
    "5a": { "ok": false, "score": 0.40, "threshold": 0.60, "detail": "Check 5A: only 2 of 5 arcs (40%) contain executive-tier keywords — below 60% threshold" },
    ...
  },
  "issues": ["Check 5A: only 2 of 5 arcs (40%) contain executive-tier keywords — below 60% threshold"]
}
```

#### Gate

Proceed to Stage 3 only when `ok: true`.

If any check fails, file the issue in BACKLOG.md as `QA-ROLE-XX` and investigate the curriculum generator prompt for role-tier framing before onboarding additional users.

#### Stage numbering note

This stage is inserted as 2A. Existing Stage 0 through Stage 6 headings are unchanged.

---

## Dependencies

Before this can be built:

- `lib/curriculum/role-utils.ts` must exist with `getRoleTier()` exported. It does — confirmed from codebase.
- `createSupabaseAdminClient()` must be exported from `lib/supabase.ts`. It is — confirmed from the pattern file.
- `curriculum_plans` table must have a `visible_sessions` JSONB column populated with arc objects in the shape documented in Section 4.1.
- `sessions` table must have a `sub_sessions` JSONB column. Null values on some rows are acceptable.
- `users` table must have `role_level` (string) and `topic_interests` (string array) columns.
- Clerk middleware must be active and protecting the `/api/admin/*` route prefix, or the route must call `auth()` itself (the pattern file confirms the latter — `auth()` is called directly in the handler).
- `docs/QA_VALIDATION_PLAYBOOK.md` must exist for the Stage 2A insertion. It does.
