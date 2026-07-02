# Feature Brief: SES-01 — Session Architecture Redesign
From: CEO Agent (on behalf of Arun)
To: Business Analyst Agent
Priority: P0
Date: 2026-06-22 (updated — supersedes v1.0 dated 2026-06-10)

---

## What Arun Said

Original instruction (2026-06-10):
> "I am ok with the sessions being split up into 15 mins sessions that is the good approach. but when the sessions are split, let that become the updated list of sessions and be reflected everywhere. this sessions example: Session1a and Session1b becomes the session title and in the Knowledge base also i should see the title of the item in the knowledge base as session1a and session1b. this means the knowledge base items has to generate only after the sessions are finalized by the designer and then the content in the knowledge base will generate for the session title - session1a for the specific scope only. session2a will have the content for the scope specified for session2a."

Correction issued 2026-06-22 (overrides the trigger model in v1.0):
> "Any generation does not have to wait for user approval."

In plain terms: Arun has confirmed the 15-minute session split is correct and the DB session is the unit of record everywhere. He has additionally clarified that user approval of the plan is purely a display gate. Content generation must begin as soon as session titles exist — which happens when the curriculum plan is generated, not when the user clicks Approve. Approval gates nothing in the pipeline. The pipeline runs on its own schedule, driven by plan generation and the session designer, with zero dependency on user approval state.

---

## The Problem Being Solved

There are currently two parallel models of a "session" that are fighting each other throughout the product:

1. The **curriculum session** (planning unit) — 5 entries, 30-minute chunks, used to generate the DB sessions. This was the original design unit.
2. The **DB session** (delivery unit) — 10 rows in the `sessions` table, 15-minute chunks, the thing the user actually attends.

The session designer correctly splits curriculum sessions into DB sessions. But the rest of the system — content cache, KB index, plan screen, schedule route, title display — continues to treat the curriculum session as the canonical record. This produces four concrete user-facing failures:

**Failure 1: Content collision.** Sessions 1a and 1b both show the same subtopics because they share the same `topic_content_cache` key (`curriculum_session_id`). The user attending Session 1a sees content that belongs to Session 1b, and vice versa. The KB cannot differentiate them.

**Failure 2: KB is half the picture.** The KB shows 5 entries (one per curriculum topic) instead of 10 (one per DB session). A user who completed Session 1a cannot find a dedicated KB article for it. Their learning record is aggregated and blurred.

**Failure 3: Content generates at the wrong trigger.** Content pipeline fires at `plan/approve`, before the session designer has written subtopics to each DB session row. Content therefore generates against an empty or incorrect subtopic list. This is the root cause of the visualisation fallback bug already documented.

**Failure 4: Schedule route destroys metadata.** The current SCH-01 scheduling handler deletes all scheduled sessions and re-inserts shell rows. Those shell rows carry no `curriculum_session_id`, `curriculum_plan_id`, or `subtopics`. Every downstream pipeline that depends on those fields breaks silently.

The underlying principle Arun has confirmed: the DB session, once finalised by the session designer, is the unit of record for everything. The curriculum session is a planning artifact that has done its job once the DB sessions exist. And nothing in the generation pipeline waits for the user.

---

## What Success Looks Like

When this is built and working:

1. **Generation starts without user involvement.** When `stripe: subscription.created` fires, the curriculum plan is enqueued. As soon as the plan is generated and session titles exist, Session 1 content generation starts immediately (all layers: outline, visual, script). Sessions 2–N are enqueued for the cron. None of this waits for the user to open the app, view the plan, or click Approve.

2. **Plan screen is a read window, not a gate.** When the user navigates to the Plan screen, they see whatever state the pipeline has reached. If content is still generating, they see loading states. If it is ready, they see their sessions. Approval is a display interaction only — it shows the user their sessions but triggers no pipeline work.

3. **Plan screen leaf items are DB sessions.** The user sees all 10 DB sessions listed, grouped under their topic (Level 2) and arc (Level 1). The grouping labels are the curriculum topic titles. The leaf items are the session designer's titles (e.g. "Claude in Financial Services: Safety Architecture..."). There is no ambiguity about which sessions exist and what they cover.

4. **Knowledge Base shows exactly 10 entries.** The KB index shows one entry per DB session. Each entry title is the DB session's `session_title` as written by the session designer. Each KB detail page shows only the subtopics assigned to that specific DB session. No subtopic appears in two KB entries.

5. **Content cache is keyed by DB session UUID.** The `topic_content_cache.topic_id` field holds the DB session `sessions.id` UUID, not a curriculum session ID string. This is enforced for all new rows and back-filled for the 2 completed sessions via migration.

6. **Schedule route is safe.** Scheduling a session only updates `scheduled_at`. It cannot delete or replace sessions. The `curriculum_session_id`, `curriculum_plan_id`, and `subtopics` fields are always preserved.

7. **Title consistency is enforced.** One title per level, one owner per level. The arc title comes from the curriculum engine and never changes. The topic title comes from the curriculum engine and never changes. The session title comes from the session designer and never changes. No downstream agent or route may rename any of these.

8. **Migration is clean.** The 2 already-completed sessions have their `topic_content_cache` rows re-keyed from `curriculum_session_id` to their DB session UUID, so their KB entries are immediately correct under the new model.

---

## The Authoritative Generation Trigger Chain

This is the canonical model. The BA spec must reflect this exactly. Any existing spec language that places generation after `plan/approve` must be updated to match this.

```
stripe: subscription.created
  → enqueue: generate curriculum plan

Curriculum plan generated (session titles now exist in the plan)
  → immediately: start Session 1 content generation
      (all layers: outline, visual, script)
  → enqueue in cron: Session 2 through Session N content generation

User navigates to Plan screen
  → show plan with current pipeline state
  → if still generating: show spinner / skeleton rows per session
  → if ready: show completed sessions

User clicks Approve
  → plan screen transitions to show sessions (display gate only)
  → no pipeline work is triggered by this action
  → approval is a UI interaction, not a generation trigger
```

Nothing in content generation waits for the user. The user approving the plan is equivalent to the user viewing a page — it is a read action with a visual state change, not a write action that starts work.

---

## Known Constraints

These are Arun's explicit decisions. They are not up for debate in the spec. The BA must design within them.

1. **15-minute sessions stay.** The split is confirmed as correct. Do not reconsider session duration.
2. **Generation does not wait for user approval.** This is Arun's direct correction to the v1.0 brief. The trigger for Session 1 content generation is "plan generated and session titles exist." The trigger for Sessions 2–N is the cron. User approval is a display gate only — it gates nothing in the pipeline.
3. **The DB session is the unit of record.** After the session designer runs, the curriculum session is a planning artifact only. It must not appear as a user-visible entity in the plan screen, KB, or any email.
4. **KB content generates per DB session, after the session designer finalises scope.** Never before. Never for the full curriculum topic scope.
5. **Session titles are owned by the session designer and are never modified downstream.** Plan screen, KB, emails, calendar invites all read `sessions.session_title`. Nothing rewrites it.
6. **The schedule route must only update `scheduled_at`.** Delete + re-insert is forbidden. The sessions table is the authoritative record of session identity.
7. **Arc and Topic titles are owned by the curriculum engine and are never modified downstream.** They are grouping labels, not session titles.
8. **The session designer's subtopic assignments are the content boundary.** Content generation reads `sessions.subtopics` for the given DB session. It does not read from the curriculum plan.
9. **Separate cache rows per industry AND role.** `topic_content_cache` needs a schema change to support this. The cache key must distinguish between users from different industries and roles, not just between different sessions. Arun has confirmed this explicitly: "Separate cache rows per industry AND role." The BA must specify the schema change (new columns or composite key change) required to enforce this.

---

## Feature Areas (six, all in scope for this brief)

The design document identifies six discrete change areas. The BA must write a Requirement Document that covers all six. They are interdependent and must be specced together.

| ID | Area | What changes |
|---|---|---|
| SESS-01 | Content cache re-keying | `topic_content_cache.topic_id` key changes from `curriculum_session_id` (string) to `sessions.id` (UUID). Includes migration of existing rows for completed sessions. Schema must also support separate rows per industry and role (Constraint 9). |
| SESS-02 | Content pipeline trigger | Pipeline fires on `distill/session.designer.completed` event per DB session. Session 1 fires immediately after plan generation. Sessions 2–N are handled by cron. `plan/approve` emits no generation events. |
| SESS-03 | Schedule route fix | SCH-01 handler: UPDATE `scheduled_at` only. Delete + re-insert removed entirely. |
| SESS-04 | Plan screen redesign | Plan screen leaf items become the 10 DB sessions, grouped by Topic (Level 2) and Arc (Level 1). State handling required for before/after session designer has run. Approval is a display-only action. |
| SESS-05 | KB restructure | KB index shows 10 entries (one per DB session). KB detail scope is that session's subtopics only. KB entry title = `sessions.session_title`. |
| TITLE-01 | Three-level title hierarchy | Arc → Topic → Session enforced as immutable read-only hierarchy. No downstream agent writes to arc or topic title fields. Session title read from `sessions.session_title` everywhere. |

---

## What Has Changed Since v1.0

The following two items are corrections to the v1.0 brief. The BA's existing Requirement Document (v1.1, dated 2026-06-10) must be revised in all sections that are affected by these.

### Correction 1 — Generation trigger (affects SESS-02 and SESS-04 specification)

**v1.0 said:** Content pipeline fires on `distill/session.designer.completed`. The `plan/approve` route was the first trigger for Session 1.

**v1.1 says:** Content generation starts as soon as the curriculum plan is generated and session titles exist. This is before the user has seen the plan, before the user has approved the plan, and before any user action whatsoever. `plan/approve` emits no generation events. The BA must identify every place in the existing Requirement Document where generation was described as starting at or after `plan/approve` and update those sections to reflect the new trigger chain above.

Specifically, the BA must revise:
- Section 3 (Trigger / Entry Point for SESS-02) — the trigger description must reflect plan generation as the first-fire trigger for Session 1, not `session.designer.completed` alone.
- Section 4C (Content Pipeline Flow) — the sequence must show plan generation → immediate Session 1 generation start → cron for 2–N. The current flow starting at step 1 ("Session designer completes...") must be prefaced with the upstream trigger.
- Section 6 (Data Requirements, SESS-02) — the "Tables written" section describes what fires this pipeline. That must now reference the plan generation event, not `plan/approve`.
- Section 7 (Success Criteria, SESS-02) — the acceptance test "Given plan/approve is called, then NO distill/session.content.generate event is emitted" is correct and must be kept. The BA must add a complementary test: "Given the curriculum plan is generated and session titles exist, then Session 1 content generation begins immediately without any user action."
- Section 12 (Dependencies, Step 2) — the description of what SESS-02 deployment changes must be updated to reflect the new first-fire trigger.

### Correction 2 — Cache schema per industry and role (affects SESS-01 specification)

**v1.0 said:** `topic_content_cache.topic_id` changes from curriculum session ID string to DB session UUID. Migration covers 2 completed sessions.

**v1.1 adds:** The cache must store separate rows per industry AND per role. The BA must:
- Specify what schema change is required to `topic_content_cache` to support this (e.g. adding `industry` and `role` columns to the composite key, or a composite unique constraint on `(topic_id, subtopic, industry, role)`).
- Confirm whether this requires a new Supabase migration (it almost certainly does).
- Specify how the content generation pipeline uses industry and role when writing to and reading from the cache.
- Specify what happens on a cache miss for a new industry/role combination — does it generate fresh content, or fall back to a generic row?
- Confirm whether the migration SQL in Section 6F needs to be updated to account for the new schema columns (existing rows will have null industry/role — the BA must define how those are handled).

---

## Questions for BA

The following questions must be resolved in the revised Requirement Document before development begins. All questions from the v1.0 brief that were marked resolved remain resolved — do not re-open them. Only the new questions below require answers.

### On the generation trigger change (Correction 1)

**Q-NEW-1.** Under the new model, Session 1 content generation starts as soon as the plan is generated. But the session designer also needs to run before content can generate (the session designer writes `session_title` and `subtopics` to each DB session row, which the content pipeline reads). What is the exact event that triggers the session designer for Topic 1 (which produces Sessions 1a and 1b)? Is it the same plan-generation event, or does the curriculum engine emit a separate event that the session designer listens to? The BA must trace the full chain: plan generation → session designer → content generation, identifying every event name, emitter, and consumer, so the developer has a complete picture.

**Q-NEW-2.** When the spec says "Session 1 content generation starts immediately," does "immediately" mean: (a) within the same Inngest job that generates the plan, as a step, or (b) a new Inngest event is emitted by the plan generation job that triggers a separate content generation job? The distinction matters for error isolation — if (a) and plan generation fails partway through, it may leave a partial state. The BA must specify which pattern is used and why.

**Q-NEW-3.** The current `plan/approve` route presumably gates the plan screen behind some state (e.g. `users.plan_approved = true` or equivalent). Under the new model, approval is a display gate only. Does this flag still exist and still control what the user sees on the Plan screen? Or should the Plan screen show all generated sessions regardless of approval state? The BA must define what `plan/approve` does in the new world: if it no longer triggers generation, what exactly does it do?

**Q-NEW-4.** The Plan screen shows a spinner or skeleton state while content is still generating. But under the new model, content may already be partially or fully ready before the user ever navigates to the Plan screen. The BA must specify: what does the Plan screen show for a session where content is `ready` but `sessions.status = 'scheduled'` (i.e. the session has not been attended yet)? Is it shown differently from a session where content is `pending`? The current spec (Section 4A State 4) says content status does not affect session row appearance — this should be confirmed as still correct under the new model.

### On the cache schema change (Correction 2)

**Q-NEW-5.** The BA must confirm the composite key design for `topic_content_cache`. Proposed: `(topic_id, subtopic, industry, role)` as a unique constraint. Does this match the existing table structure, or does the table currently have a different unique constraint that must be dropped and replaced? The developer will need the exact migration SQL, not just a conceptual description.

**Q-NEW-6.** When a user from a new industry/role combination requests a session, and no cache row exists for that combination, does the pipeline: (a) generate fresh personalised content and cache it for that industry/role, or (b) generate content without caching (one-off), or (c) fall back to a cached row from the closest matching industry/role? Arun has not specified this — it is a product call. The BA must propose and document a specific answer.

**Q-NEW-7.** The migration SQL in Section 6F (the SESS-01 migration) was written assuming `topic_id` was the only key dimension. With the addition of `industry` and `role` columns, those columns on all existing migrated rows will be null. Is null an acceptable value for these columns in existing rows (meaning "content generated before industry/role personalisation existed"), or must they be backfilled with values? If backfilled — with what values, and where does the BA obtain them (from the user's profile)?

---

## CEO Instruction to BA

Revise the existing Requirement Document (v1.1, 2026-06-10) to incorporate both corrections above. Do not start over — the existing document is substantially correct and the work done on it is preserved. Make targeted updates to the sections identified under "What Has Changed Since v1.0" and add answers to Q-NEW-1 through Q-NEW-7.

The revised document must:
- Update the version number to v1.2 and the status to "READY FOR CEO APPROVAL."
- Answer Q-NEW-1 through Q-NEW-7 in Section 11 (Open Questions), then move them to the appropriate sections of the document and mark Section 11 empty.
- Update every section that references `plan/approve` as a content generation trigger to reflect the corrected trigger chain.
- Add the `topic_content_cache` schema change (new columns + migration SQL update) to Section 6.
- Add the new acceptance test from Correction 1 to Section 7 (SESS-02 success criteria).
- Do not change any section that is unaffected by these two corrections. Sections 4D, 4E, 4F, 5, 8, 9, 10, and 12 (Steps 1, 3, 4) are likely unchanged — verify before modifying.

The revised document is then returned to the CEO Agent for approval before any developer begins work.

---

*Feature Brief SES-01 v1.1 | CEO Agent | 2026-06-22 | Status: Handed to BA Agent for spec revision*
