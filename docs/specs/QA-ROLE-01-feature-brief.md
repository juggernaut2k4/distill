# Feature Brief: QA Role Differentiation & Coverage Checks
From: CEO (Arun)
To: Business Analyst Agent
Priority: P1
Date: 2026-06-29

---

## What Arun Said

Add 3 new automated QA checks to validate that the curriculum generated for a user actually reflects their role tier. The checks should be accessible via a new admin endpoint following the same pattern as `GET /api/admin/qa-curriculum-order`. The endpoint returns a structured pass/fail result per check plus a flat issues array.

Check 5A — Role Differentiation: does the generated plan use role-appropriate language in arc names?
- Technical users should see arcs with language signals: implement, build, API, code, deploy
- Executive users should see arcs with language signals: governance, ROI, vendor, strategy, cost, risk
- Manager users should see arcs with language signals: team, workflow, process, adoption, productivity
- Pass threshold: 60% of arcs contain role-tier signals

Check 5B — Content Orientation: do session subtopic titles (sub_sessions) match the user's role tier?
- Same keyword signal approach as 5A, applied to sub_session title strings
- Pass threshold: 50% of subtopic titles contain role-appropriate keywords

Check 5C — Topic Coverage: for technical users, does the plan cover foundational AI tooling?
- Check at least one arc covers Claude, GPT, LLMs, or prompt engineering topics
- For non-technical users: check that at least one arc name reflects the user's topic_interests
- Pass if coverage condition is met

Also: document these 3 checks as Stage 2A in the QA Validation Playbook, positioned after Stage 2 (plan validation) and before Stage 3 (session validation).

---

## The Problem Being Solved

The QA Validation Playbook currently has 7 manual SQL-based stages. Stages 1 and 2 validate that a user profile was saved correctly and that arcs exist — but neither stage checks whether the generated plan is actually calibrated for the user's role tier. A CEO and a software engineer could be given nearly identical arc names and the existing playbook would pass them both.

This gap means role differentiation failures only surface when Arun or the CEO Agent manually reads arc titles and recognises they are generic or wrong-tier. That is a judgement call that cannot scale. The 3 new checks convert that judgement into an automated signal: a keyword presence test applied to the text the LLM already generated.

These checks also serve as an early-warning system for curriculum generator regressions. If a future LLM prompt change strips role-tier framing from arc names, Check 5A will catch it without requiring a human to re-read every plan.

---

## What Success Looks Like

After this is built:

1. A QA operator calls `GET /api/admin/qa-role-checks?userId=<id>` and receives a JSON response listing the pass/fail verdict and keyword match detail for each of the 3 checks.

2. When all 3 checks pass, the response contains `ok: true` and an empty issues array.

3. When any check fails, the response contains `ok: false`, the issues array identifies which check failed and why (e.g. "Check 5A: only 2 of 5 arcs (40%) contain executive-tier keywords — below 60% threshold"), and the detail object shows which arcs/subtopics passed and which did not.

4. The QA Validation Playbook documents Stage 2A with the endpoint URL, the pass/fail thresholds, and the keyword lists — so any operator can run it without reading source code.

5. A VP-Technology user's plan is never falsely flagged as failing because the system correctly maps vp-technology to the executive tier (not the technical tier), consistent with `getRoleTier()` in `lib/curriculum/role-utils.ts`.

---

## Known Constraints

### Must
- Follow the exact response shape of `GET /api/admin/qa-curriculum-order`: `{ ok, checks: { 5a: {...}, 5b: {...}, 5c: {...} }, issues: string[] }`. No deviation from this contract — the CEO Agent and QA operators already know the pattern.
- Use `getRoleTier()` from `lib/curriculum/role-utils.ts` as the single source of truth for mapping roleLevel → executive / technical / manager. Do not inline the mapping logic.
- Source arc names from `curriculum_plans.visible_sessions` (the active, non-superseded plan). Do not read from sessions table for arc-level checks.
- Source subtopic titles from `sessions.sub_sessions` (the JSONB column). Each entry is an object with a `title` string field — the check reads that field.
- Require Clerk auth. If the caller is not authenticated, return 401. Accept an optional `userId` query param; default to the authenticated user's own id (same as qa-curriculum-order).
- Return 404 if no active plan exists for the user.
- The endpoint must be read-only. No writes, no side effects.
- Pass thresholds are fixed in code: 5A = 60%, 5B = 50%, 5C = binary (at least 1 arc matches).
- Keyword lists are fixed in code (not database-driven). The BA spec must include the exact keyword lists so the developer does not have to invent them.

### Must Not
- Not call any external API or LLM. All checks are pure string matching against data already in the database.
- Not block or fail if `sub_sessions` is null or empty for some sessions. Treat null sub_sessions as contributing zero matching subtopics.
- Not use fuzzy matching or semantic similarity. Keyword matching is case-insensitive substring matching only.
- Not modify the playbook in a way that changes existing Stage 0–6 numbering. The new stage is inserted between 2 and 3 and labelled Stage 2A.

---

## Questions for BA

**Q1 — Keyword lists require sign-off before spec is finalised.**
Arun has agreed on the three tiers and pass thresholds. The BA must propose exact keyword lists for all three tiers in the spec for Arun to approve before developer work begins. The lists in the brief above are starting points, not final. The BA should derive candidates by sampling 10+ existing arc names from the production database before proposing the lists.

**Q2 — sub_sessions JSON shape.**
The BA must confirm the exact field path for subtopic title extraction from the `sub_sessions` JSONB column. The existing `qa-curriculum-order` route reads `sub_sessions` as a `string[]`, but in production `sub_sessions` is an array of objects with `title`, `type`, `duration_mins`, and `learning_objective` fields. The BA must inspect a live session row and document the correct extraction path in the spec before the developer uses it.

**Q3 — Arc name source field.**
`curriculum_plans.visible_sessions` is a JSONB column containing arc objects. The BA must confirm whether arc names are in `arc_name`, `title`, or another field by reading a live row, and document the correct field path in the spec.

**Q4 — Check 5C non-technical coverage rule.**
For non-technical users (executive and manager tiers), the check is: "does at least one arc name reflect the user's topic_interests?" The BA must specify how this is implemented given that `topic_interests` is a free-text or array field. Specifically: is the check a substring match of each interest string against arc names, or something else? Define the rule precisely enough that a developer has no ambiguity.

**Q5 — Response shape for per-check detail.**
The brief specifies `checks: { 5a: {...}, 5b: {...}, 5c: {...} }` but does not define the interior shape of each check object. The BA must define the full response schema including what detail is returned per check (e.g. matched arc count, total arc count, matched arcs list, keyword list used, pass/fail boolean). The developer must not invent this.

**Q6 — Playbook update scope.**
The BA must define exactly what gets added to Stage 2A: the endpoint URL, the full keyword lists (from Q1 above), the pass/fail thresholds, an example of a passing response, and an example of a failing response. Confirm whether the existing Stage 0–6 section headings need renumbering or whether Stage 2A as an inserted sub-stage is sufficient.

**Q7 — Admin auth model.**
The existing `qa-curriculum-order` endpoint uses Clerk auth with no additional admin role check — any authenticated user can call it for their own userId, and an operator can pass any userId to inspect another user. The BA must confirm this same model is acceptable for the new endpoint, or whether an admin-only guard should be added (e.g. checking against an env var allowlist of admin Clerk user IDs).

---

## Acceptance Criteria (for CEO Agent QA gate)

The following must all be true before this feature can merge:

1. `GET /api/admin/qa-role-checks?userId=<id>` returns HTTP 200 with `{ ok, checks, issues }` for a user with an active plan.
2. `ok` is `true` only when all 3 checks pass. `ok` is `false` if any single check fails.
3. Each check in the `checks` object carries its own `pass` boolean and enough detail (matched count, total count, threshold) for the caller to understand why it passed or failed without reading source code.
4. A user with roleLevel `vp-technology` is evaluated as executive tier, not technical tier. Verify by calling the endpoint for a vp-technology user and confirming the keyword list used in the response reflects executive signals.
5. Check 5B does not throw or return 500 if `sub_sessions` is null on any session row.
6. Calling without a userId param uses the authenticated user's own id and returns their results.
7. Calling without auth returns 401.
8. Calling with a userId that has no active plan returns 404.
9. Stage 2A exists in `docs/QA_VALIDATION_PLAYBOOK.md` between Stage 2 and Stage 3, with the endpoint, thresholds, keyword lists, and example responses documented.
10. TypeScript compiles clean (`npx tsc --noEmit`). No `any` types in the new route file.
