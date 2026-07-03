# Clio — Core Business Objectives

**Version:** 1.0 | **Owner:** Arun | **Date:** 2026-06-07
**Status:** APPROVED — referenced at every sprint review and build validation

> These are non-negotiable product principles. Every feature, every build, every sprint must be validated against these. A build that breaks any of these is not shippable.

---

## Objective 1: The User Learning Profile is the Intelligence Layer

Clio must maintain a persistent, evolving, structured profile for every user — stored as typed DB parameters, not a text blob.

**The profile must be:**
- Seeded from onboarding (minimum viable profile before session 1)
- Updated after every completed session (Inngest job on `session.completed`)
- Read every time a visualization or script is generated (Steps 2 + 3 of content pipeline)
- Tied to the user's stated learning objective — not just what they know, but what they know relative to where they're trying to get

### 1a. Knowledge Profile
What the user knows, at what depth, on which topics.

| Level | What it means |
|---|---|
| `basic` | Can define the concept ("What is X?") |
| `intermediate` | Can apply the concept ("How would I use X for Y?") |
| `advanced` | Can critique or extend ("What are the trade-offs of X vs Y at scale?") |

**Tracks:** `topic_id`, `exposure_count`, `inferred_depth`, `mastered_concepts`, `gap_concepts`
**Source:** session `questions_raised`, quality evaluation scores, completion patterns

### 1b. Intellectual Profile
How this person thinks. Stable, largely unconscious cognitive orientation.

| Dimension | What it tracks |
|---|---|
| `reasoning_style` | systems / sequential / analogical |
| `abstraction_comfort` | abstract / concrete / mixed |
| `question_depth_pattern` | basic / intermediate / advanced (rolling weighted average) |
| `attention_proxy` | sessions_ended_early / sessions_ran_long / sessions_on_time |

**Source:** question text patterns, session duration vs planned

### 1c. Psychological / Motivation Profile
What drives them and their relationship to uncertainty.

| Dimension | Values |
|---|---|
| `learning_motivation` | fear_driven / opportunity_driven / compliance_driven |
| `risk_tolerance` | conservative / aggressive / balanced |

**Source:** question vocabulary ("what could go wrong?" vs "what's the advantage?"), topic selection, onboarding worry/goal
**⚠️ Most sensitive dimension:** Never label the user in a way they would find invasive. Profile is Clio's internal coaching file — never surfaced as a score or diagnosis.

### 1d. Business Focus Lens
The business outcome they filter all AI content through — this drives every "So what?" moment.

| Lens | What it means |
|---|---|
| `cost_reduction` | Primary focus: efficiency, automation savings, FTE reduction |
| `productivity` | Primary focus: team throughput, speed, time-to-decision |
| `capability_building` | Primary focus: elevating what the team can do |
| `risk_compliance` | Primary focus: what could go wrong, governance, regulation |
| `competitive_edge` | Primary focus: market positioning, what competitors are doing |
| `team_enablement` | Primary focus: empowering direct reports, building AI literacy |

**Source:** question vocabulary, topic selection, onboarding worry field
**Decision pending (Q7):** Single value (TEXT) or primary + secondary (TEXT[]) — Arun to decide

---

## Objective 2: Speak the User's Language

Every script and visualization must speak the user's actual vocabulary — not a demographic archetype.

**Vocabulary fingerprint** (stored as `vocab_fingerprint` JSONB):
- `domain_terms[]` — specific terms the user uses in their own questions (e.g. "NPV", "capex", "API latency")
- `detected_register` — finance / technical / operations / legal / general
- `example_preference` — quantitative / narrative / mixed

### The reference test — same topic, three different users

This is the test of whether Objective 2 is being met. Take any AI concept (e.g. hallucination risk) and verify the script sounds genuinely different for:

**VP of Technology, Financial Services (systems thinker, risk/compliance lens, advanced vocabulary):**
> "You know how a credit model can be technically valid but trained on data that doesn't reflect current conditions? Hallucination works similarly — the compliance question isn't 'does this model hallucinate?' It's 'under what conditions, and are those conditions present in our workflow?'"

**COO, Retail Chain (linear thinker, cost lens, general vocabulary):**
> "Think of it like a store associate who's brilliant 98% of the time but occasionally gives a customer completely wrong information with total confidence — and you can't tell which 2% that is by watching them. For retail, the question is: where does a wrong answer cost you money?"

**CEO, Professional Services (analogical thinker, competitive lens, strategic vocabulary):**
> "The firms that will be embarrassed by AI in the next 18 months aren't the ones who didn't adopt it — they're the ones who adopted it without the governance layer clients expect. That governance is the trust asset."

Same facts. Three completely different sessions. All correct. If the scripts feel generic, Objective 2 is failing.

---

## Objective 3: Content Static. Script + Visualization Adaptive.

| Layer | Behavior | Personalization |
|---|---|---|
| **Content (KB)** | Generated once per subtopic. Cached. | None — same for all users |
| **Script** | Generated per session using full profile | Vocabulary, reasoning style, business lens, skip mastered concepts |
| **Visualization** | Generated per session using profile | Abstraction comfort + reasoning style drive visual depth |

**Generation pipeline (existing — must not be broken):**
1. SubtopicOutline (enriched from topic catalog)
2. Visualization (Step 2) + Script (Step 3) run in parallel

Steps 2 and 3 must receive the `user_learning_profile` record — not the static 4-field context object. This is the core wiring change.

---

## Objective 4: Smart Topic Delta — Curriculum Adapts When Topics Change

**Status: BUILT 2026-07-03.** All 4 sub-features complete:
1. Topic-picker pre-selection — built (existing).
2. Scoped deletion of scheduled sessions for removed topics — built (existing, `app/api/topics/route.ts`).
3. Queue-promotion to fill freed visible slots — built (existing, `app/api/topics/route.ts`).
4. Bridging sessions on topic addition — built. `app/api/topics/route.ts` already computed the
   `delta` object and fired it on `clio/topics.selected`, but `inngest/curriculum-generator.ts` was
   dropping it (event type had no `delta` field). Fixed by:
   - `inngest/curriculum-generator.ts`: event type now includes `delta`. Pure-deletion/no-op deltas
     (`added.length === 0`) short-circuit before any LLM call — fixes a bug where deletion was
     previously still triggering a full plan regeneration via profile-hash mismatch. Additive deltas
     (`added.length > 0`) generate arcs only for the new topics and merge them into the existing plan;
     kept arcs are never re-sent to the LLM or rewritten.
   - `lib/curriculum/planner.ts`: new `generateArcsForTopics()` (scoped arc generation for added
     topics only) and `generateBridgingArc()` (LLM judges semantic relatedness between kept and added
     topics; returns `null` and skips bridging if the topics don't genuinely connect — no forced
     bridges). Both reuse the existing `ArcSchema`/ `buildSystemPrompt` machinery.
   - Session materialization for the new/bridge arcs happens the same way it already does for any
     plan change: `plan_approved` resets to `false`, and the existing `app/api/plan/approve` v2 path
     (`organizeSubtopicsIntoSessions` → `designSessionsForTopic`) picks up the merged arcs on next
     approval. No changes needed there.

**Pre-selection:** When a user opens the topic picker, their existing `topic_interests` must be pre-selected.

**Delta behavior:**

| Change | What happens |
|---|---|
| Pure deletion (A,B → A) | Remove B's scheduled sessions. Promote A's queued sessions to fill freed visible slots. No LLM call. |
| Deletion + Addition (A,B → A,C) | Remove B, keep A untouched, generate C sessions, generate 1-2 bridging sessions (A → C). |
| Pure addition (A,B → A,B,C) | Keep A+B untouched, generate C sessions, generate bridging ({A,B} → C). |

**Bridging sessions:** Connect new topics to what the user already knows. Placed at the entry point of the new topic's arc. Skip if topics are semantically unrelated (don't force a poor bridge).

**Rule:** Completed sessions are never deleted. They are permanent history and the primary signal source for the intelligence loop.

---

## Objective 5: Generation Is Background. Personalization Is Through the Profile.

The content pipeline runs in the background (current design preserved). Personalization is injected at generation time by reading the profile — not by delaying generation to the moment the user clicks "Start Session."

**The update loop:**
```
Session completes
  → Inngest job fires on session.completed
  → Classify questions_raised (single batched Claude call)
  → Update user_learning_profile fields
  → Next generation reads updated profile
  → Better script and visualization
```

For sessions 1-2 (no history): profile is seeded from onboarding only. Generation falls back to role/industry/maturity archetype. That is acceptable — it improves with every session.

---

## Profile Confidence Model

| Tier | Sessions | Behavior |
|---|---|---|
| `low` | 0–2 | Onboarding signals only. Script calibrated to role/industry archetype. |
| `medium` | 3–6 | Profile signals used with caution. 1-2 targeted adjustments per session. |
| `high` | 7+ | Full profile in use. Vocabulary, reasoning style, business lens all applied. |

When `profile_confidence = 'low'`, the generation prompt includes:
> "LEARNER PROFILE CONFIDENCE: low. Treat all profile signals as provisional. Prioritise maturity-level calibration over profile-inferred style signals."

---

## Open Questions — Arun Must Answer Before Build Starts

| # | Question | Blocks |
|---|---|---|
| Q1 | Sessions < 5 min: exclude from profile or count at 0.5 weight? | Schema type (INT vs NUMERIC) |
| Q2 | Confidence thresholds: low→medium at 3 sessions, medium→high at 7 — correct? | When full personalization kicks in |
| Q3 | Visualization gets full profile or subset (abstraction_comfort + reasoning_style only)? | Step 2 prompt template |
| Q4 | `learning_motivation` locked after first detection, or re-inferred if signals change? | Whether user evolution is reflected |
| Q5 | Non-English questions: classify as-is, translate first, or skip? | Classifier design |
| Q6 | Minimum session length to count (proposed: 5 min) — confirm? | Threshold value |
| Q7 | `business_focus_lens`: single TEXT or TEXT[] primary+secondary? | Schema column type |
| Q8 | Vocabulary fingerprint: natural injection into Clio's language, or only when user requests examples? | Script prompt design |
| Q9 | Read-only "your learning profile" card on dashboard — in scope now or future? | Scope boundary |
| Q10 | Does this feature write to `knowledge_profiles` or read it only? | Who owns comprehension status updates |

---

## Build Validation Checklist

Run at every sprint review before marking any session-related feature as complete:

**Profile integrity:**
- [ ] `user_learning_profiles` row updated after every completed session (`sessions_used_for_profile` increments)
- [ ] `profile_confidence` progresses correctly: `low` → `medium` → `high`
- [ ] Script generation prompt contains `profile_summary`, `reasoning_style`, `question_depth_pattern`, `vocab_fingerprint` — not the static 4-field object
- [ ] Visualization generator uses `abstraction_comfort` and `reasoning_style` from profile

**Topic delta:**
- [ ] Topics page pre-selects user's existing `topic_interests` on mount
- [ ] Topic deletion removes only `scheduled` sessions — completed sessions untouched
- [ ] Queue sessions promoted to fill freed visible slots after deletion
- [ ] Bridging sessions generated when new topic added to existing curriculum

**Resilience:**
- [ ] Fallback to static context when profile row doesn't exist (no crash, no 500)
- [ ] Empty `questions_raised` array handled gracefully (no classifier crash)
- [ ] Profile update job failure does not block session completion

**Privacy:**
- [ ] No profile dimension surfaced to any user-facing UI unless Q9 is resolved as "in scope"
- [ ] No comparative signals stored ("below average for their role") — ever

---

---

## Objective 6: API is the Integration Layer — UI is a Display Layer

**Approved: 2026-06-07**

> "No feature is complete until it is fully accessible through the API. UI renders what the API returns. Nothing else."

This is the foundational architecture principle. Every operation Clio performs — onboarding, curriculum generation, content delivery, session management — must be fully executable and validatable through the API alone. The browser is one client. The AI orchestrator is another. Both are equal.

### 6.1 Session Token Model

Every authenticated API call uses a per-user, short-lived session JWT. There is no global admin key.

```
User (or AI) authenticates with Clerk
    → POST /api/auth/session  (exchange Clerk token for session JWT)
    → Returns: { token, expiresAt, userId }

Token payload: { userId, sessionId, iat, exp }
Token scope:   that specific user only — cannot access another user's data
Token death:   browser closes / explicit logout / token expiry
On expiry:     401 returned → full re-authentication required from scratch
```

**Rules:**
- All protected routes accept `Authorization: Bearer <token>` — no cookie-only routes
- Token validated on every request: signature ✓ + not expired ✓ + userId matches resource ✓
- New session = new token. There is no token reuse across sessions.
- Admin-level operations (cross-user reads) require Arun's user record to carry an `is_admin` flag — enforced in middleware, not a separate key

**How the AI authenticates programmatically (no browser):**
```bash
TOKEN=$(curl -s -X POST https://distill-peach.vercel.app/api/auth/session \
  -H "Authorization: Bearer $CLERK_TOKEN" | jq -r .token)

curl https://distill-peach.vercel.app/api/user/profile \
  -H "Authorization: Bearer $TOKEN"
```
Same endpoint. Same token. Browser and AI are identical clients.

### 6.2 Async LLM Operations — No Blocking Routes

Any route that calls an LLM must return immediately with a job reference. It must never block the HTTP connection waiting for the LLM response.

**Pattern (mandatory for all LLM routes):**
```
POST /api/curriculum/generate
  → immediately: { jobId: "job_abc", status: "queued" }

GET /api/jobs/:jobId
  → { status: "running" | "complete" | "failed", progress: 0-1, result?: {...} }

Client (browser or AI) polls until status = "complete"
```

**Routes that must follow this pattern:**
- `POST /api/curriculum/generate`
- `POST /api/curriculum/generate-preview`
- `POST /api/sessions/:id/generate-content`
- Any future route that calls Anthropic, ElevenLabs, or any external AI service

**No exceptions.** Synchronous LLM routes produce 504s and degrade the user experience.

### 6.3 Thin UI Principle

UI components receive data from the API and render it. They do not:
- Make business logic decisions
- Validate business rules
- Access the database directly
- Compute derived state that belongs in the API

If a UI component contains logic that could break if the API response changes shape, that logic belongs in the API.

### 6.4 All Validations in the API Layer

- Input validation: Zod schema on every POST/PUT endpoint — no exceptions
- Authorization: middleware checks on every protected route — no client-side gating
- Business rules ("can this user start a session?", "has this topic already been generated?"): API layer only
- The UI trusts the API response. It never re-validates what the API already validated.

### 6.5 What the Integration Layer Enables

Once built:
- The AI can run the complete onboarding → curriculum → content → session flow from the terminal
- Every build can be validated end-to-end via a sequence of curl commands — no browser, no Supabase UI, no Vercel dashboard
- Bugs are caught programmatically, not by waiting for a human to notice them in the UI
- The application is testable, observable, and controllable without human intervention

### 6.6 Endpoint Reference (Integration Layer)

Every operation must be callable with a valid session token:

| Operation | Route | Returns |
|---|---|---|
| Issue session token | `POST /api/auth/session` | `{ token, expiresAt, userId }` |
| Refresh session | `POST /api/auth/refresh` | `{ token, expiresAt }` |
| Get user profile | `GET /api/user/profile` | Full user + learning profile |
| Get curriculum plan | `GET /api/curriculum/plan` | Visible + queue sessions |
| Get session list | `GET /api/sessions` | All sessions with status |
| Get session content | `GET /api/sessions/:id/content` | Content + viz instructions + script |
| Run onboarding | `POST /api/onboarding` | `{ success, userId }` |
| Save topics | `POST /api/topics` | `{ success }` |
| Start curriculum generation | `POST /api/curriculum/generate` | `{ jobId, status }` |
| Start content pipeline | `POST /api/sessions/:id/generate-content` | `{ jobId, status }` |
| Poll job status | `GET /api/jobs/:jobId` | `{ status, progress, result? }` |
| Get pipeline status | `GET /api/content/:topicId/pipeline-status` | Per-subtopic status summary |

---

## Build Validation Checklist — Full (Objectives 1–6)

Run at every sprint review before marking any feature complete.

**Objective 1 — User Learning Profile:**
- [ ] `user_learning_profiles` updated after every completed session
- [ ] `profile_confidence` progresses: `low` → `medium` → `high`
- [ ] Script generation uses profile, not static 4-field context
- [ ] Visualization generation uses `abstraction_comfort` and `reasoning_style`

**Objective 2 — Speak Their Language:**
- [ ] `vocab_fingerprint` populated after sessions 2+
- [ ] Script for same topic differs meaningfully across different user profiles
- [ ] `detected_register` matches user's industry

**Objective 3 — Content Static / Script+Viz Adaptive:**
- [ ] KB content identical for all users on same subtopic
- [ ] Script differs between users with different profiles on same subtopic
- [ ] Visualization depth differs based on `abstraction_comfort`

**Objective 4 — Smart Topic Delta:**
- [ ] Topics page pre-selects existing `topic_interests` on mount
- [ ] Removing a topic deletes only `scheduled` sessions — completed untouched
- [ ] Queue sessions promoted to fill freed visible slots after deletion
- [ ] Bridging sessions generated when new topic added

**Objective 5 — Background Generation / Profile-Driven:**
- [ ] LLM operations return `jobId` immediately — no blocking routes
- [ ] `GET /api/jobs/:jobId` returns accurate status and progress
- [ ] Profile update Inngest job fires on every `session.completed`

**Objective 6 — Integration Layer:**
- [ ] `POST /api/auth/session` issues a valid JWT from a Clerk token
- [ ] All protected routes accept `Authorization: Bearer <token>`
- [ ] A 504 timeout on any route is treated as a critical bug — root cause must be fixed
- [ ] End-to-end validation curl sequence runs clean (Steps 1–9 from integration layer spec)
- [ ] No route blocks on an LLM call — all async via jobId/polling
- [ ] UI renders what API returns — no business logic in components

---

*CORE_OBJECTIVES.md | Clio | Owner: Arun | Created: 2026-06-07 | Updated: 2026-06-07 | Must be read by all agents before touching any API route, content pipeline, curriculum engine, or session code.*
