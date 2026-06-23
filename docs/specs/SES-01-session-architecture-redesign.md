# Design: SES-01 — Session Architecture Redesign: DB Session as the Unit of Truth

**Status:** Design complete — pending CEO Feature Brief + BA Requirement Document
**Date:** 2026-06-10
**Author:** Orchestrator + Owner (Arun)
**Supersedes:** TITLE-01 (absorbed and refined here)

---

## Problem Statement

The current system has two separate models for a "session" that are in conflict:

1. **Curriculum session** — the planning unit. 5 entries in `curriculum_plans.visible_sessions`. Each is 30 min. This is what the user approved.
2. **DB session** — the delivery unit. 10 rows in the `sessions` table. Each is 15 min. This is what the user actually attends.

The session designer splits each 30-min curriculum session into 2×15-min DB sessions. This split is correct and should stay. But the system does not treat the DB session as the true unit of record — it continues to key content, KB entries, and UI references against the curriculum session. This creates:

- **Content collisions**: Both halves of a split (Session 1a and 1b) share the same `topic_content_cache` key (`curriculum_session_id`), so both sessions show all subtopics from the full curriculum topic, not their individual scope.
- **KB confusion**: KB shows 5 entries (one per curriculum topic) instead of 10 (one per DB session). A user cannot see what they covered in Session 1a vs. 1b separately.
- **Title drift**: The curriculum plan has one title per topic. The session designer generates unique titles per DB session. Nothing enforces which is canonical, so the plan screen and session screen show different strings.
- **Schedule setup destroys metadata**: The SCH-01 scheduling route deletes scheduled sessions and re-inserts shell rows, losing `curriculum_session_id`, `curriculum_plan_id`, and `subtopics` — the fields the content pipeline depends on.
- **Content generates too early**: The content pipeline fires at `plan/approve` for Session 1, and by cron for subsequent sessions — before the session designer has confirmed subtopic assignments. This leads to content generating against incorrect or empty subtopic lists.

---

## Decision: DB Session is the Unit of Truth

Once the session designer finalizes a DB session (assigns title + subtopics), that session IS the canonical record. Everything downstream — content generation, KB, UI, emails, calendar invites — refers to the DB session, never the curriculum session.

The curriculum session becomes a planning artifact only. It is used to generate the DB sessions. After that, it is not visible to the user or used as a content key.

---

## The Three-Level Hierarchy (canonical, locked)

```
Level 1 — Arc
  Source: curriculum_plans.visible_sessions[].arc_name
  Example: "Anthropic Claude for Work"
  Used: Arc grouping header in plan screen, sessions screen
  Owner: Curriculum engine (set once, never changed downstream)

Level 2 — Topic
  Source: curriculum_plans.visible_sessions[].title
  Example: "Introducing Claude for Work — Why It Matters for a Technology Leader"
  Used: Plan screen topic card title, grouping label above sessions
  Owner: Curriculum engine (set once, never changed downstream)
  Note: One Topic → N DB Sessions (currently N=2, may vary)

Level 3 — Session
  Source: sessions.session_title
  Example: "Claude in Financial Services: Safety Architecture, Deployment Models..."
  Used: Sessions screen row title, KB entry title, email subject, calendar invite title
  Owner: Session designer (set when session row is created, never changed downstream)
```

**One title per level. One owner per level. No downstream agent may rename.**

---

## What Changes

### Change 1 — Content cache key: curriculum_session_id → DB session ID

**Current:**
```
topic_content_cache.topic_id = 'claude-for-work-s1'  (curriculum session ID)
Both Session 1a and 1b share this key → same 9 subtopics shown for both
```

**New:**
```
topic_content_cache.topic_id = sessions.id  (DB session UUID, or a stable slug)
Session 1a has its own cache rows → only its assigned subtopics
Session 1b has its own cache rows → only its assigned subtopics
```

**Result:** KB shows 10 independent entries. Session 1a's KB page shows only what Session 1a covered. Session 1b's KB page shows only what Session 1b covered. No overlap, no duplication.

---

### Change 2 — Content pipeline trigger: fires after session designer, not at plan/approve

**Current:**
- `plan/approve` fires content generation for Session 1 immediately
- Hourly cron fires content generation for sessions 2–N as they become pending
- Neither waits for the session designer to confirm subtopic assignments

**New:**
- `plan/approve` does NOT fire content generation
- Session designer finalizes a session (writes title + subtopics to the DB row) → fires content generation for THAT session only
- Content pipeline runs per DB session, reads that session's subtopics, generates only those subtopics
- Cron handles retries and stale sessions, but does NOT fire for a session with no subtopics

**Trigger event:** `distill/session.designer.completed` — emitted by session designer after writing `session_title` and `subtopics` to a DB session row.

---

### Change 3 — SCH-01 schedule route: update only, never delete/re-insert

**Current:**
```javascript
// Deletes all scheduled sessions and re-inserts shell rows
await supabase.from('sessions').delete().eq('status', 'scheduled')
// Then inserts rows without curriculum_session_id, curriculum_plan_id, subtopics
```

**New:**
```javascript
// Only updates scheduled_at on existing sessions
await supabase.from('sessions')
  .update({ scheduled_at: s.scheduledAt })
  .eq('user_id', userId)
  .eq('session_index', s.sessionIndex)
```

Sessions are created once by `plan/approve` → enriched by session designer → `scheduled_at` is the only field the schedule route may touch.

---

### Change 4 — Plan screen shows DB sessions, not curriculum topics

**Current:** Plan screen shows 5 curriculum topic cards (from `visible_sessions`). After approval, user sees 5 entries. But 10 sessions exist in the DB.

**New:** After plan approval and session designer completion, plan screen shows the actual DB sessions — 10 rows grouped by arc and topic.

```
Arc: Anthropic Claude for Work
  Topic: Introducing Claude for Work — Why It Matters for a Technology Leader
    ├── Session 1: Claude in Financial Services: Safety Architecture...   [Completed]
    └── Session 2: From First Use to Strategic Advantage...               [Scheduled Jun 11]
  Topic: How Claude Works — Core Mechanisms...
    ├── Session 3: How Claude Works — Core Mechanisms: Part 1             [Completed]
    └── Session 4: Claude in Your Enterprise: Data Boundaries...          [Scheduled Jun 12]
  ...
```

The curriculum topic title is a grouping label, not a session. The session designer's titles are the leaf items.

---

### Change 5 — KB restructured: one entry per DB session

**Current:** KB index shows 5–6 entries (one per unique curriculum_session_id in cache). Each entry aggregates ALL subtopics for that curriculum session.

**New:** KB index shows 10 entries (one per DB session). Each entry shows only the subtopics assigned to that DB session.

- KB entry title = `sessions.session_title`
- KB entry content = `topic_content_cache` rows WHERE `topic_id = sessions.id`

---

## End-to-End Sequence: How Content Reaches the User

```
1. plan/approve
   → Creates 10 DB sessions (2 per curriculum topic), status='scheduled'
   → Does NOT fire content generation

2. Session designer runs per curriculum topic
   → For each topic, designs 2 DB sessions:
       Session 1: writes session_title, subtopics=[slug1, slug2, slug3, slug4]
       Session 2: writes session_title, subtopics=[slug5, slug6, slug7, slug8, slug9]
   → Emits distill/session.designer.completed for each session

3. Content pipeline (triggered by event)
   → Receives: sessionId, subtopics (from sessions.subtopics)
   → Generates content ONLY for the assigned subtopics
   → Writes to topic_content_cache WHERE topic_id = sessions.id
   → Marks sessions.content_status = 'ready'

4. KB becomes available
   → KB index shows session entry with sessions.session_title
   → KB detail page shows only that session's subtopics

5. User attends session (Clio voice)
   → Visual specs served from that session's cache rows
   → Scripts served from that session's cache rows
   → No mixing of content from sibling session
```

---

## What Is NOT Changing (Locked)

- Topic generation — unchanged
- Arc structure and sequencing — unchanged
- Number of curriculum sessions (5) — unchanged
- Session designer's subtopic design logic — unchanged (only the trigger and output target change)
- 15-min session duration — unchanged
- The 1:2 split (2 DB sessions per curriculum topic) — unchanged
- Session scheduling (scheduled_at, user preferences) — unchanged in concept; only the update mechanism changes

---

## Current State vs. Target State

| | Current | Target |
|---|---|---|
| Content cache key | curriculum_session_id | DB session UUID |
| KB entries | 5 (per curriculum topic) | 10 (per DB session) |
| KB entry scope | All subtopics for topic | Only that session's subtopics |
| Content trigger | plan/approve + cron (pre-subtopic) | session.designer.completed event |
| Schedule route | Delete + re-insert | Update scheduled_at only |
| Plan screen leaf | Curriculum topic (5) | DB session (10) |
| Title shown in KB | Inconsistent | sessions.session_title (always) |

---

## Migration Required (existing data)

For the 2 completed sessions (idx 1 and idx 3):
- Re-key `topic_content_cache` rows from `topic_id = curriculum_session_id` → `topic_id = DB session UUID`
- Specific UUIDs to be confirmed by BA during spec phase

For the 8 scheduled sessions: these will be handled by the new flow once architecture is in place.

---

## Open Questions for BA (must resolve before spec is approved)

1. What does the plan screen look like BEFORE session designer has run? (sessions exist but have no subtopics yet — show loading state or hide?)
2. What does KB show for a session that is scheduled but content not yet generated? (locked entry, "coming soon" label?)
3. When session designer runs for Session 2 after Session 1 is already completed — does it re-run or skip?
4. How does the user see the Topic grouping label (Level 2) on the sessions screen — is it collapsible?
5. What is the naming rule for Session 2's title when the session designer generates it? (always descriptive continuation? never "Part 2"?)
6. Does the migration of existing cache rows need to be a DB migration, or can it be a one-time script?

---

## Features to Spec (BA to write a Requirement Document for each)

| Feature ID | Area | Change Required |
|---|---|---|
| SESS-01 | Content cache re-keying | topic_content_cache.topic_id → DB session UUID |
| SESS-02 | Content pipeline trigger | fire on session.designer.completed, not plan/approve |
| SESS-03 | Schedule route fix | UPDATE scheduled_at only, no delete/re-insert |
| SESS-04 | Plan screen redesign | show 10 DB sessions grouped under 5 topics |
| SESS-05 | KB restructure | 10 entries, per-session scope, per-session title |
| TITLE-01 | Title consistency | 3-level hierarchy enforcement (Arc → Topic → Session) |

---

*SES-01 v1.0 | Design complete | Pending CEO Brief + BA Spec | 2026-06-10*
