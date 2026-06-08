# Clio Feature Briefs
From: CEO Agent (on behalf of Arun)
To: Business Analyst Agent
Date: 2026-06-06

---

# Feature Brief: Fix — Sessions Created Without topic_id
ID: FB-001
From: CEO (Arun)
To: Business Analyst Agent
Priority: P0
Date: 2026-06-06

## What Arun Said
Fix the bug where sessions are created without a topic_id. This is the root cause of wrong visualisations in live sessions and duplicate KB entries. When the curriculum plan approval flow creates sessions in the `sessions` table, `topic_id` is null for every session. The content generation pipeline uses `topic_id` to store and retrieve content from `topic_content_cache`. With a null `topic_id`, the pipeline falls back to `'ai-fundamentals'`, causing sessions to display completely wrong visualisations.

## The Problem Being Solved
Every Clio live session depends on a `topic_id` to fetch pre-generated visuals, script, and KB content from `topic_content_cache`. When `topic_id` is null the pipeline substitutes a hardcoded fallback value (`'ai-fundamentals'`), meaning the user receives visualisations and coaching content that have nothing to do with the topic they booked. This breaks the core value proposition of the product: personalised, on-topic AI coaching. It also causes downstream data corruption (see FB-002).

The problem originates in the handoff between two systems:
- `lib/sessions/planner.ts` (`scheduleSessions` function) already computes a `topicId` per session — either from `primaryTopic.id` (catalog entry) or a slug derived from the session title.
- `app/dashboard/schedule/ScheduleClient.tsx` calls `scheduleSessions` and passes the resulting sessions to `POST /api/sessions/schedule`.
- `app/api/sessions/schedule/route.ts` writes `topic_id: s.topicId || null` into the `sessions` table — which means an empty string from the planner becomes `null` in the database.

The actual gap: when the curriculum plan does not map sessions to real catalog `topic.id` values (i.e. `primaryTopic?.id` is undefined), `planner.ts` falls back to a title-slug. That slug is not empty — it is a derived string — but the route defensively coerces any falsy value to null. The Inngest content-generation event for Session 1 fires correctly only if `firstSession.topicId` is truthy at the time the route runs. If the slug derivation produces an empty string or if the plan sends `topicId: ''`, content generation is skipped entirely.

## What Success Looks Like
- Every row inserted into `sessions` has a non-null, non-empty `topic_id`.
- The `topic_id` value stored in `sessions` matches the `topic_id` used in the `distill/session.content.generate` Inngest event for that session.
- The `distill/session.scheduled` Inngest events (pre-generation of visual specs) fire for every session, not just those where `topicId && subtopics.length > 0`.
- Session 1's content generation Inngest event fires for every plan approval, not just those with a catalog-mapped topic.
- No session row exists in production with `topic_id = null` or `topic_id = ''` after plan approval.
- KB page shows content keyed to the correct topic — not to `'ai-fundamentals'` unless that is genuinely the session topic.
- A developer reading the code can trace the exact `topic_id` value from `planner.ts` → `ScheduleClient.tsx` → API route → `sessions` table → Inngest event in a straight line with no branching fallbacks.

## Known Constraints
- Must not break the existing plan-approval UX in `ScheduleClient.tsx` — no new user-visible screens or prompts.
- The fix must work for both catalog-mapped sessions (where `primaryTopic.id` exists) and non-catalog sessions (title-slug derived). Both are valid; neither may fall through to null.
- The `distill/session.content.generate` event for Session 1 must continue to fire immediately on plan approval (user is waiting for content).
- `distill/session.scheduled` events for sessions 2–N must continue to fire in the background.
- Must not change the Zod schema in a way that rejects existing valid payloads from the client.
- No changes to the `topic_content_cache` table schema required for this fix.

## Questions for BA
1. The Zod schema in `route.ts` has `topicId: z.string().default('')` — an empty string is currently valid input. Should the fix enforce `z.string().min(1)` at the API boundary (rejecting empty strings from the client) or should the fix sit in `planner.ts` (guaranteeing the slug is always non-empty before the payload is built)? The BA must decide which layer owns the invariant and document it.
2. What is the correct `topic_id` derivation rule for sessions whose curriculum arc does not map to a catalog entry? The current logic in `planner.ts` slugifies the session title. Is this the approved rule going forward, or should the BA specify a different mapping strategy?
3. Should the BA specify a data-repair step (SQL UPDATE) for existing `sessions` rows with `topic_id = null` or `topic_id = ''`? If so, document the exact SQL and the deployment sequence (migration before or after code deploy).
4. The `distill/session.scheduled` filter in `route.ts` requires `s.topicId && s.subtopics.length > 0` — sessions without subtopics are excluded from pre-generation. Is this intentional? Document the acceptance criteria for which sessions should pre-generate visual specs.

---

# Feature Brief: Fix — Duplicate KB Entries
ID: FB-002
From: CEO (Arun)
To: Business Analyst Agent
Priority: P0
Date: 2026-06-06

## What Arun Said
The KB page shows two entries for the same session's content: one with `topic_id = ""` (empty string, 4 sections) and one with `topic_id = "ai-fundamentals"` (4 sections). Both entries have the same subtopic slugs but different topic_ids, created because content generation fires twice for Session 1. Fix this and clean up the duplicate rows.

## The Problem Being Solved
The Knowledge Base page (`/dashboard/kb`) is the user's permanent record of what they have learned. Duplicate entries for the same session destroy the credibility of this page — a user sees the same content twice under different headings and cannot tell which is authoritative. They also inflate the apparent size of the KB, making it look like the user has learned more sessions than they have. Over time, as more users complete sessions, the KB table fills with corrupted rows that are expensive to clean up.

The duplication has two root causes that must both be fixed:
1. Content generation fires more than once for Session 1 — the same session triggers `distill/session.content.generate` twice by different code paths (one from the schedule route, possibly another from an Inngest retry or a second client-side trigger).
2. The `topic_id` used in the first fire is `""` (empty string) and in the second fire is `"ai-fundamentals"` — so the deduplication check in the content generator (which is keyed on `topic_id + subtopic_slug`) does not catch them as the same content.

FB-001 fixes the `topic_id = ""` root cause. FB-002 must additionally: (a) ensure content generation fires exactly once per session per approval, and (b) define and implement idempotency in the content pipeline so that a duplicate fire — whatever the cause — cannot produce a duplicate row.

## What Success Looks Like
- The KB page shows exactly one entry per session.
- If content generation is triggered twice for the same session (e.g. due to an Inngest retry), the second run is a no-op — it does not insert a new row.
- The deduplication key used by the content pipeline is documented clearly: what column(s) in `topic_content_cache` form the unique constraint that prevents duplicate rows.
- Existing duplicate rows (where `topic_id = ''` or `topic_id = 'ai-fundamentals'` conflict with a correctly keyed row for the same session content) are removed by a one-time SQL cleanup as part of this fix.
- After the cleanup, the correctly keyed rows remain intact.
- The fix is safe to run in production: no content currently visible to real users is deleted incorrectly.

## Known Constraints
- Must not alter the schema of `topic_content_cache` in a way that breaks existing correctly-keyed rows.
- The idempotency mechanism must be at the database level (unique constraint or ON CONFLICT DO NOTHING / DO UPDATE) — not solely in application logic, which can race.
- The data cleanup SQL must be reviewed and explicitly approved before running in production. The BA spec must include the exact SQL.
- FB-002 depends on FB-001 being deployed first (or in the same deployment). The BA spec must note this dependency and define the deployment order.

## Questions for BA
1. What is the current unique constraint (if any) on `topic_content_cache`? The BA must inspect the Supabase schema and document the exact columns. If no constraint exists, the spec must define which columns should form the unique key and what `ON CONFLICT` behaviour is correct.
2. What is the full trigger path for Session 1 content generation? The BA must trace every code path that can emit `distill/session.content.generate` for Session 1 and document whether any of them are legitimate re-triggers (e.g. a user re-approving a plan) vs. bugs. Document which paths should be blocked at the Inngest event level vs. at the database level.
3. For the data cleanup: what is the correct rule for identifying which of the two duplicate rows to delete? (e.g. "delete the row where `topic_id = ''` and keep the row where `topic_id` matches the session's current `topic_id` field" — or some other rule.) The BA must define this unambiguously so the SQL can be written without interpretation.
4. Are there any users in production who have completed sessions and whose KB data must be preserved? If so, the BA must define a "safe delete" rule that does not touch completed-session content.

---

# Feature Brief: Fix — Google Meet Auto-Creation Fails Silently
ID: FB-003
From: CEO (Arun)
To: Business Analyst Agent
Priority: P1
Date: 2026-06-06

## What Arun Said
The session scheduling flow attempts to auto-create a Google Meet link via Google Calendar API. It times out (8s timeout added to prevent hanging) but fails silently. Users see "Creating meeting link..." or are asked to paste their own URL. Either fix the Google Calendar credentials properly so Meet creation succeeds, or remove auto-Meet creation and implement a clean "paste your meeting link" UX. Do not leave a silent failure state.

## The Problem Being Solved
When a user approves their curriculum plan and schedules sessions, they expect to receive a real Google Meet link for each session. Currently the system attempts to create this link via the Google Calendar API but fails without telling the user why. The user is left in an ambiguous state: no link, no explanation, no clear next step. For a product targeting senior executives — who have full calendars and delegate meeting logistics — this is a critical trust failure. They cannot send the session link to their EA, they cannot join the session from their calendar, and they receive no indication that anything went wrong.

The current implementation in `app/api/sessions/schedule/route.ts` (lines 78–106) wraps `createGoogleMeetEvent` in a `Promise.race` with an 8-second timeout. When it loses the race, the meeting URL is simply not written — no error surface to the user, no fallback link, no instruction. The session confirmation email is sent without a meeting link.

## What Success Looks Like
The BA must specify one of two approved outcomes — and must consult Arun if the choice is not clear from the brief:

**Option A — Fix Google Calendar integration:**
- Google Calendar API credentials are properly configured in the Vercel environment.
- `createGoogleMeetEvent` succeeds within a reasonable timeout (e.g. 5s) for >99% of calls.
- Every scheduled session has a `meeting_url` populated before the confirmation email is sent.
- If the Calendar API fails (transient error), the system retries once and surfaces a clear error to the user with an instruction to contact support.

**Option B — Remove auto-Meet, implement manual link entry:**
- The plan-approval UI in `ScheduleClient.tsx` presents a "Your meeting link" input field for each session (or one shared link if all sessions use the same Meet).
- The field is optional at scheduling time; it can be added later from the dashboard.
- The confirmation email states clearly: "Add your meeting link in your dashboard before your first session."
- The dashboard session card shows a "Add meeting link" CTA if `meeting_url` is null.
- The auto-Meet creation code in `route.ts` is removed entirely — no silent failures.
- No Google Calendar API dependency remains in the scheduling flow.

Either option eliminates the silent failure. The BA must document the full UX flow, all affected screens, and all copy for the chosen option.

## Known Constraints
- The silent failure state — a scheduled session with no meeting link and no user instruction — is not acceptable. This must be eliminated regardless of which option is chosen.
- If Option A is chosen: the `lib/google-calendar.ts` integration must be fully tested against real credentials before shipping. No placeholder or mock in production.
- If Option B is chosen: the Google Calendar integration code may be removed from the scheduling path but should be preserved in the codebase if it is used elsewhere (e.g. calendar invites to the user's Google Calendar as a future feature).
- The session confirmation email must not promise a meeting link that does not exist.
- No new npm packages may be introduced without justification against the approved library list.

## Questions for BA
1. Is Option A (fix Google Calendar) or Option B (manual link) the correct path? This is a product decision that requires Arun's input if the BA cannot answer from the existing brief. Escalate to CEO Agent if unclear.
2. If Option A: what is the current failure mode of `createGoogleMeetEvent`? Is it a credentials/auth issue, a scope issue, or a timeout issue? The BA must determine this before writing the spec (check Vercel environment variables for `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REFRESH_TOKEN`).
3. If Option B: what is the exact UX for adding a meeting link after scheduling? Where in the dashboard does it appear? What does the session card look like with vs. without a link? The BA must write a full screen specification for each state.
4. Regardless of option: what copy appears in the session confirmation email when no meeting link is present? The BA must write the exact email text.
5. Does the fix need to repair existing scheduled sessions (those currently sitting in the `sessions` table with `meeting_url = null`)? If so, how is the user notified?

---

# Feature Brief: Verify — localStorage Auto-Submit After Sign-Up
ID: FB-004
From: CEO (Arun)
To: Business Analyst Agent
Priority: P1
Date: 2026-06-06

## What Arun Said
A fix was deployed (commit `8a1c42a`) so that when a user completes onboarding anonymously and then creates an account, they're redirected back to `/onboarding` where their localStorage answers auto-submit. This has not been fully tested end-to-end. QA verification is required: anonymous user completes 6 questions, creates account, gets redirected to /onboarding, localStorage answers auto-submit, user lands on dashboard with their data saved correctly.

## The Problem Being Solved
Clio allows users to explore the onboarding flow before creating an account — a deliberate choice to reduce friction. If the transition from anonymous to authenticated state silently loses the user's answers, the user must repeat onboarding from scratch. This is a material friction point: the user invested time, saw a personalised plan preview, decided to sign up, and then finds their choices gone. Worse, if auto-submit fires but saves corrupted data (e.g. partial answers, wrong field mapping), the user receives a mis-personalised curriculum without knowing why.

The fix in commit `8a1c42a` addresses the redirect, but the full end-to-end path involves: localStorage persistence across the redirect, Clerk's post-sign-up redirect behaviour, the `/onboarding` page's auto-submit logic reading from localStorage, the `POST /api/onboarding` route correctly saving all 6 fields, and the subsequent redirect to `/dashboard` reflecting the saved data. Any break in this chain produces a silent data loss.

## What Success Looks Like
- A QA operator can execute the full flow in a live browser on `distill-peach.vercel.app` from an unauthentised state and confirm every step works as described.
- All 6 onboarding fields (role_level, department/roleId, industry, ai_maturity, topic_interests, learning_goal) are present and correct in the `users` table in Supabase after auto-submit.
- The user lands on `/dashboard` (not `/onboarding` again, not an error page).
- If localStorage is empty when the user arrives at `/onboarding` post-sign-up (e.g. they cleared storage), a graceful fallback is presented — the user is shown the onboarding questions to answer rather than a broken auto-submit.
- If the auto-submit fails (API error), the user sees a clear error and is not silently dropped on an empty dashboard.

## Known Constraints
- This is a QA and bug-fix brief, not a new feature. The BA must first run the QA flow and document what actually happens today before specifying any code changes.
- If the flow works correctly end-to-end, the BA's output is a QA pass report with evidence (screenshots or network log excerpts), not a code change.
- If the flow is broken, the BA must document each broken step precisely (what was expected, what happened, what the error was) and write a targeted fix spec for each break. No speculative fixes.
- The fix must not alter the onboarding question set or the field mapping — only the reliability of the save-after-redirect path.
- Do not use `sleep` in any test scripts.

## Questions for BA
1. Execute the full anonymous-to-authenticated flow on `distill-peach.vercel.app` today and document: (a) does localStorage persist through the Clerk sign-up redirect? (b) does the auto-submit fire on arrival at `/onboarding`? (c) does the API call succeed? (d) does the dashboard reflect the saved data? Report findings before writing the spec.
2. What is the Clerk `afterSignUpUrl` currently set to? Confirm it routes to `/onboarding` and not `/dashboard` directly.
3. What localStorage key is used to store the onboarding answers? Confirm the key name is consistent between the write (during anonymous flow) and the read (during auto-submit on return).
4. What happens if the user closes the browser between completing onboarding and signing up — does localStorage survive? Is this scenario in scope for the fix?
5. Is there a loading or transition state shown to the user between arriving at `/onboarding` post-sign-up and being redirected to `/dashboard`? If not, should there be one? (The BA must specify this if it is missing.)

---

# Feature Brief: VP Separate RoleIds and role_level Pipeline Pass-Through
ID: FB-005
From: CEO (Arun)
To: Business Analyst Agent
Priority: P1
Date: 2026-06-06

## What Arun Said
VP/Director currently maps to roleId `'cto'` — wrong. New distinct roleIds are required for VP-level roles. Additionally, `role_level` (the seniority tier: c-suite / vp-director / manager / specialist) must be passed into all content pipeline components. Currently `role_level` is captured in onboarding but dropped before reaching the content generators. This means a VP gets CTO-framed content.

## The Problem Being Solved
Clio's core promise is seniority-appropriate content. A VP of Finance getting content framed for a CTO violates this promise at its most basic level. The problem exists in two distinct layers:

**Layer 1 — Identity:** The onboarding DEPARTMENTS map (`app/onboarding/page.tsx`) assigns the same `roleId` values to VP/Director as to C-Suite for the same function. For example, "Technology & Engineering" at VP level maps to `roleId: 'cto'` — the same as "Technology & Engineering" at C-Suite level. The curriculum planner receives `role: 'cto'` for both a CTO and a VP of Technology, and generates identical framing.

**Layer 2 — Context loss:** Even if the `roleId` were corrected, the `role_level` field (c-suite / vp-director / manager / specialist) is captured at onboarding step 0 and saved to the `users` table but is never passed to `lib/curriculum/planner.ts`, `lib/curriculum/specialist.ts`, or `lib/content/session-content-generator.ts`. These generators have no way to apply seniority-appropriate depth, examples, or framing.

Both layers must be fixed together — fixing only the roleId without passing `role_level` (or vice versa) leaves the content mis-framed.

## What Success Looks Like
- A user who selects "VP / Director" and "Technology & Engineering" in onboarding gets a distinct `roleId` (e.g. `vp-technology`) — never `cto`.
- The `role_level` value (`c-suite`, `vp-dir`, `manager`, or `specialist`) is stored in the `users` table and passed to all three pipeline components: `planner.ts`, `specialist.ts`, `session-content-generator.ts`.
- The curriculum planner system prompt explicitly references the user's seniority level, not just their function, so Claude generates appropriately framed content.
- A VP of Finance receives financial content framed for a senior leader managing a function — not for a CFO with P&L authority and board reporting responsibilities.
- All VP/Director department options in the onboarding UI resolve to their own distinct `roleId` values, none of which duplicate a C-Suite `roleId`.
- Existing users with `role = 'cto'` who are actually VPs are not affected by this change (their saved data remains; only new onboarding flows use the new roleIds). The BA must specify whether a data migration for existing users is required and if so what the migration rule is.

## Known Constraints
- The approved new VP roleIds are: `vp-technology`, `vp-finance`, `vp-operations`, `vp-product`, `vp-data`, `vp-design`, `vp-marketing`, `vp-hr`. No deviations.
- C-Suite roleIds remain unchanged: `ceo`, `cto`, `cfo`, `coo`, `product-manager`, `hr`, `marketing`.
- The `role_level` field must be passed through as a string — it is already captured in onboarding step 0. The fix is a pipeline pass-through, not a new data capture.
- No new onboarding questions may be added as part of this brief.
- The curriculum planner prompt must be updated to use `role_level` but must not change the JSON output schema — downstream consumers of the curriculum plan must not break.
- The BA must specify every file that requires changes across the pipeline, including any places `role_level` must be added to a Zod schema, API payload, or database query.

## Questions for BA
1. Confirm the complete list of VP/Director department options currently in `app/onboarding/page.tsx` (the DEPARTMENTS map for `'vp-dir'`) and document their current `roleId` values. The spec must explicitly map each option to its new VP-specific `roleId`.
2. Where exactly is `role_level` saved to the `users` table today? Confirm the column name and that it is already being populated by the onboarding API route. If it is not being saved, the BA must add this to the spec.
3. For each pipeline file (`planner.ts`, `specialist.ts`, `session-content-generator.ts`): what is the current function signature? Document the exact parameter that must be added (`role_level: string`) and where in the system prompt it is injected. Write the exact prompt language for each file.
4. Does `buildProfileHash` in `planner.ts` include `role_level`? If not, should it? (If `role_level` affects the curriculum output, it should be part of the hash so a seniority change triggers a new plan.)
5. What is the correct framing difference between `c-suite` and `vp-dir` that Claude should apply? The BA must define this as a concrete prompt instruction — not a vague "adjust for seniority" — for each pipeline stage.

---

# Feature Brief: ai_maturity 8-Value Mapping in Curriculum Planner
ID: FB-006
From: CEO (Arun)
To: Business Analyst Agent
Priority: P1
Date: 2026-06-06

## What Arun Said
New onboarding introduced 4 values (`observer`, `emerging`, `practitioner`, `leader`). The planner depth-cap switch in `lib/curriculum/planner.ts` only handles old values (`beginner`, `intermediate`, `advanced`, `expert`). Both sets must work, with this mapping: observer → beginner (light, foundational, many analogies), emerging → intermediate (standard, practical focus), practitioner → advanced (deep, strategic), leader → expert (deepest, peer framing, edge cases).

## The Problem Being Solved
Onboarding was updated to use a new vocabulary for AI maturity that is more intuitive for executives — `observer`, `emerging`, `practitioner`, `leader`. However the curriculum planner's depth-cap logic was not updated to match. The `depthCap` switch in `lib/curriculum/planner.ts` (lines 68–77) handles `'beginner'`, `'no experience'`, `'intermediate'`, `'some experience'`, and `'somewhat experience'` — all of which fall through correctly — but none of `'observer'`, `'emerging'`, `'practitioner'`, or `'leader'` match any case. They all hit the `default` branch, which returns `'advanced'` — the maximum depth — regardless of actual maturity.

This means an `observer` (executive with no AI experience) receives content at the same depth level as a `leader` (AI-forward executive). The foundational analogies and gentler pacing that observers need are never applied.

## What Success Looks Like
- A user with `ai_maturity = 'observer'` receives a curriculum with sessions capped at `'intermediate'` depth — the same behaviour as a user with `ai_maturity = 'beginner'`.
- A user with `ai_maturity = 'emerging'` receives sessions up to `'advanced'` depth — the same as `'intermediate'`.
- A user with `ai_maturity = 'practitioner'` receives sessions up to `'advanced'` depth with strategic framing.
- A user with `ai_maturity = 'leader'` receives the deepest available sessions with peer framing and edge-case coverage.
- All four old values (`beginner`, `intermediate`, `advanced`, `expert`) continue to work as before — no regression for existing users whose `ai_maturity` was saved under the old vocabulary.
- The `depthCap` switch is documented with a comment explaining the two vocabularies and their equivalence, so future developers do not break this again.
- The `buildProfileHash` function includes the normalised maturity value (post-mapping) rather than the raw string, so `'observer'` and `'beginner'` do not generate different cache keys for the same depth level. (The BA must decide whether hash normalisation is required or whether distinct raw values are acceptable cache keys.)

## Known Constraints
- The mapping is fixed and approved: observer → beginner, emerging → intermediate, practitioner → advanced, leader → expert. No deviations.
- The fix must be backward-compatible. Existing `users` rows with old `ai_maturity` values must continue to generate correct curricula.
- This is a single-function change in `lib/curriculum/planner.ts`. The BA spec should be narrow — no scope creep into the specialist or content generator unless there is a confirmed gap there too.
- The depth level labels used in the Zod schema (`SessionSchema.depth_level`) are `'beginner' | 'intermediate' | 'advanced'` — these do not change. The mapping affects the cap applied to the prompt, not the output schema.

## Questions for BA
1. Confirm the complete set of `ai_maturity` values currently stored in the `users` table in production. Are there any values beyond the 8 listed above (old + new)? If so, document them and specify how the switch should handle them.
2. The approved mapping has both `'practitioner'` and `'leader'` mapping to depth cap `'advanced'`. The brief says leader gets "deepest — peer framing, edge cases." But the `depth_level` enum only has three values (`beginner | intermediate | advanced`). How does "deepest" differ from "advanced" in practice — is it a prompt instruction difference rather than a schema difference? The BA must clarify this and write the exact prompt language for each maturity level.
3. Should `buildProfileHash` normalise the raw maturity string to its canonical depth level before hashing? Document the decision and rationale.
4. Are there any other places in the codebase (outside `planner.ts`) where `ai_maturity` is used in a switch or conditional that would also fail on the new vocabulary? The BA must audit this.

---

# Feature Brief: 3-Layer Narrative Curriculum Generation
ID: FB-007
From: CEO (Arun)
To: Business Analyst Agent
Priority: P1
Date: 2026-06-06

## What Arun Said
Every selected topic should become a story, not a flat list. Three layers: Layer 1 (Foundations — 1–3 prerequisite subtopics, compressed/skipped if user already knows them), Layer 2 (Core Topic — 7 mandatory dimensions every topic must cover: how it works, capabilities, limitations, role-specific benefits, tradeoffs, industry examples, what not to do), Layer 3 (Strategic Alignment — 3–5 subtopics bridging to the user's other selected topics and role-specific applications). A 5-step algorithm governs generation: topic decomposition, narrative arc building, completeness check, quality scoring per subtopic (4 axes), and an adaptive feedback loop.

## The Problem Being Solved
The current curriculum planner generates a flat list of sessions with subtopics chosen by Claude without a structured framework. This produces inconsistent curricula: some sessions are strategically rich, others are shallow; some cover prerequisites the user already knows, others jump to advanced concepts without foundations; none are explicitly verified to cover all dimensions a senior executive needs to be genuinely competent on a topic. A VP of Finance who completes a session on "AI in Finance" should be able to answer "how does it work?", "what are its limits?", "what are the risks?", and "what should I not do?" — not just know that AI exists in finance. The 3-layer framework enforces this completeness structurally rather than relying on Claude's discretion each time.

## What Success Looks Like
- Every generated curriculum plan has sessions explicitly tagged with their layer (`L1_foundation`, `L2_core`, `L3_strategic`) — this tag is visible in the data (e.g. in the `raw_llm_output` JSONB) and used by the planner to order sessions correctly.
- Every L2 (core) session for every topic passes an automated completeness check against the 7 mandatory dimensions before the plan is finalised. A plan that fails the completeness check is regenerated, not surfaced to the user.
- Quality scores (4 axes: role relevance, industry specificity, narrative cohesion, dimension coverage) are computed per subtopic and stored. Subtopics below the threshold score are removed from the visible plan.
- L1 sessions are skipped or compressed for users whose `ai_maturity` signals they already have the prerequisite (e.g. `practitioner` or `leader` level users do not receive introductory "What is AI?" sessions).
- L3 sessions explicitly reference the user's other selected topics — the session title and focus must make the connection clear (e.g. "How AI Governance Connects to Your AI Strategy Work").
- A developer can inspect the plan JSON and see: for each session, its layer tag, its quality score, and for L2 sessions, a dimension coverage map showing which of the 7 dimensions are addressed.
- The plan generation time does not increase by more than 30 seconds vs. the current generation time (a single Claude call producing the full curriculum).

## Known Constraints
- The 7 Layer 2 dimensions are fixed and mandatory: (1) how it works, (2) capabilities, (3) limitations/failure modes, (4) role-specific benefits, (5) tradeoffs, (6) industry examples, (7) what not to do. The BA must not add or remove dimensions without Arun's approval.
- The 5-step algorithm is approved at the concept level. The BA must define the implementation detail for each step — specifically: how many Claude API calls are required, what each call's prompt structure looks like, and what the JSON schema for the enriched plan looks like.
- The narrative arc for each topic (dependency chain, bridge connections, "so what" per subtopic) must be stored in the plan data — it is used by the session content generator (FB-007 output feeds the content pipeline).
- The adaptive feedback loop (step 5 — post-session reclassification) is a separate capability documented in FB-008. FB-007 covers only steps 1–4.
- The quality threshold (below which subtopics are removed) must be defined by the BA as a concrete number on a documented scale. It must not be left as "to be determined."
- The existing curriculum plan approval UX must not change as a result of this brief. The user still approves the visible session list — the layers and quality scores are backend metadata, not user-facing.
- Total LLM API cost per plan generation must be estimated by the BA and reviewed before implementation begins. If the cost exceeds $0.10 per plan, escalate to CEO Agent for approval.

## Questions for BA
1. The 5-step algorithm as described involves at minimum: (a) topic decomposition, (b) narrative arc building, (c) completeness check, (d) quality scoring. Should these be separate Claude API calls (allowing each to be cached/retried independently) or a single structured call with a multi-section JSON output? The BA must specify the API call structure with estimated token counts per call.
2. What is the exact JSON schema for a session in the new plan format? It must include: layer tag, quality score per axis, dimension coverage map (for L2), dependency reference (what L1 session this L2 builds on), and bridge reference (what L3 session or other topic this connects to). The BA must write the full TypeScript type definition.
3. How is the "user already knows this prerequisite" signal computed for L1 skipping? Is it purely based on `ai_maturity` (e.g. `practitioner` or `leader` always skip L1) or does it use knowledge profile data (FB-008)? Define the exact rule.
4. The quality threshold: what does each of the 4 axes measure, on what scale (e.g. 0–10), and what is the minimum score on each axis for a subtopic to be included in the visible plan? The BA must define these numbers based on the product intent — not leave them configurable without defaults.
5. How does this change interact with the existing arc classification rules (domain / integrated / singleton) in the current planner prompt? Do L1/L2/L3 layers apply within each arc, or do they replace the arc structure? The BA must define the relationship clearly.
6. Does the new plan JSON format require a database schema change (e.g. new columns in `curriculum_plans`)? If so, document the migration.

---

# Feature Brief: Automated Quality Evaluation and Knowledge Profile Tracking
ID: FB-008
From: CEO (Arun)
To: Business Analyst Agent
Priority: P1
Date: 2026-06-06

## What Arun Said
During sessions, Clio asks checkpoint questions. A 7-variant classifier labels the user's response invisibly: V1 (perfect), V2/V3 (partial gap), V4/V5 (wrong/adjacent, gap flagged), V6 (I don't know, add to reinforcement queue), V7 (explain again, rephrase). After each session (daily cron, 2h post-session), extract response classifications from the transcript, update a knowledge profile per user per topic, schedule reinforcement subtopics for gaps, and promote maturity signal on high comprehension. Classifier implementation: Option A first (keyword scoring, <500ms, no AI call). Upgrade to Option B (AI call) only if accuracy is insufficient. A new DB table stores the knowledge profile. Six automated session quality acceptance criteria are defined.

## The Problem Being Solved
Clio currently has no mechanism to know whether a user actually understood a session's content. Every user progresses through the curriculum at the same pace regardless of comprehension. This means:
- A user who says "I don't understand" during a session still gets unlocked to the next topic.
- A user who demonstrates expert-level comprehension sits through prerequisite sessions they don't need.
- Gaps accumulate silently — the user's AI Readiness Score does not reflect genuine knowledge.
- Clio cannot tell Arun (or the user) whether the product is actually teaching anything.

The automated quality evaluation system changes this: it reads Clio's conversation transcript after each session, extracts the user's responses to checkpoint questions, classifies them against 7 variants, and uses the results to actively reshape the curriculum — adding reinforcement where needed, accelerating where comprehension is high.

## What Success Looks Like
- After each completed session, a cron job (running 2h post-session) reads the Recall.ai transcript for that session and extracts checkpoint question / user response pairs.
- Each user response is classified as one of 7 variants using a keyword-scoring classifier (<500ms, no external AI call in Option A).
- A `knowledge_profiles` row is created or updated for the user × topic combination, storing: number of sessions on this topic, average variant score, comprehension status (queued / in-progress / understood / gap), and a list of identified gaps.
- The curriculum queue is updated: gap-flagged subtopics trigger insertion of a reinforcement subtopic before the next scheduled session; high-comprehension signals trigger promotion of the next layer.
- The user's `ai_readiness_score` is recalculated after each session using the updated knowledge profile (not just feedback Y/N as at present).
- The 6 session quality acceptance criteria are evaluated automatically after each session and stored as a pass/fail record per criterion per session.
- A Clio admin can view the quality pass/fail record for any session in the Supabase dashboard.
- The classifier (Option A) achieves sufficient accuracy that no V1 response is mis-classified as V6 or vice versa in a set of 20 hand-reviewed test cases. (The BA must define what "sufficient" means and how this is measured.)

## Known Constraints
- The classifier must be Option A first (keyword scoring, <500ms, no AI call) as explicitly approved. Option B (AI call) is a future upgrade path, not part of this build.
- The 7 variant definitions are fixed: V1 perfect, V2/V3 partial, V4/V5 wrong/adjacent, V6 "I don't know", V7 "explain again". The BA must write the exact keyword lists and scoring rules for Option A.
- The knowledge profile JSON structure is specified: `{ topic_id, subtopics: { [slug]: { sessions, avg_variant, status } }, maturity_signal, gaps[] }`. The BA must not alter this structure without approval.
- The cron runs 2h post-session — not in real-time during the session. The session quality evaluation is asynchronous.
- The Recall.ai transcript must be accessible at the time the cron runs. The BA must confirm the transcript is available within 2h of session end and document the API call used to retrieve it.
- The 6 session quality acceptance criteria are fixed: (1) teaches the selected topic directly, (2) correct seniority framing, (3) at least one industry-specific example, (4) depth matches maturity, (5) ends with something actionable, (6) connects to adjacent subtopics. These are evaluated against the transcript, not manually.
- The adaptive feedback loop from FB-007 Step 5 is implemented here. The BA must reference the plan data format from FB-007 when specifying how the queue is updated.
- This brief does not include a user-facing knowledge profile view — that is a future feature. All outputs are internal data only.

## Questions for BA
1. How does the cron job identify which sessions completed in the last 2h? What query against the `sessions` table does it use, and what session status is set when a session ends? Document the trigger condition precisely.
2. How is the Recall.ai transcript retrieved? What is the API endpoint, what credentials are required, and what is the data structure of a transcript? The BA must verify this against the Recall.ai documentation and document the exact call. If the transcript is not available within 2h, what is the fallback?
3. What does "checkpoint question / user response pair" look like in a Recall.ai transcript? Are checkpoint questions identifiable by a pattern in Clio's speech (e.g. the `checkpoint_question` field from `SubtopicOutline`)? The BA must define the extraction logic precisely.
4. For Option A classifier: provide a concrete example of the keyword lists and scoring rules for at least 3 of the 7 variants. The spec must be specific enough that a developer can implement the classifier without interpreting the intent.
5. Where does the cron job run — Inngest, Vercel Cron, or another mechanism? The spec must specify the scheduler, the job registration, and the error handling for failed transcript fetches.
6. The 6 session quality criteria require evaluating the transcript against specific conditions (e.g. "contains at least one industry-specific example"). How is each criterion evaluated in Option A (keyword/pattern matching)? The BA must write the evaluation rule for each of the 6 criteria — not just describe the criterion.
7. Is there a new DB table required (`knowledge_profiles`)? Document the full table schema including primary key, indexes, RLS policy, and the `updated_at` trigger. Is a Supabase migration required?
8. What is the exact update to the curriculum queue when a gap is identified? Which table is modified, what SQL is run, and how does the reinforcement subtopic get its title and content defined?
