# Glitch Log → Internal Issue Tracker — Requirement Document

Version: 1.0
Status: DRAFT → CEO REVIEW
Author: Business Analyst Agent
Feature Brief: `.claude/agents/clio/feature-briefs/B2B-17-glitch-log-to-issue-tracker.md` (B2B-17, P1)
Governing objective: `CORE_OBJECTIVES.md` v3, Objective 2 step 7
Date: 2026-07-17

> **Read Section 11 first if you are approving.** This spec resolves five of the six CEO-flagged
> design tensions with direct code evidence and leaves **exactly one** open: the purge-policy
> ratification (Q1). Per the Feature Brief's explicit carve-out ("the purge-policy question in
> particular may need to stay open for Arun/CEO") and the CLAUDE.md rule that a product decision
> revising a policy Arun personally approved is his call, that one question is escalated rather than
> guessed. Every other section is build-ready.

---

## 1. Purpose

Clio runs partner learning sessions through its own AI voice bot. When the bot's delivery breaks
down — it misunderstands the user, repeats itself, causes confusion about itself, or gets
derailed — that breakdown is a **glitch in Clio's own application**. `CORE_OBJECTIVES.md` v3
Objective 2 step 7 makes capturing *and working through* those glitches part of the product's
exclusive scope: "This log must support constant analysis for frequent issues, status of issues
tracked to closure, and root-cause analysis."

Today Clio has **capture + read-only analytics only**. Glitches are extracted after each session and
shown on an internal dashboard grouped by frequency, but there is no way to assign a status, drive an
issue to closure, or record a root-cause investigation. The dashboard is also an **orphaned route** —
nothing links to it.

This feature turns that passive report into a real internal issue tracker: recurring glitch patterns
become **tracked issues** an operator can move through a lifecycle to closure, with an investigation
log and the ability to declare that many glitch instances share one root cause. It stays strictly
internal to Clio.

**Failure without it:** Clio can *see* that (say) "misunderstanding" glitches keep happening at a
partner, but has no place to record that someone is investigating them, what the diagnosis is, or
that the problem is fixed. Recurring quality failures are visible but never systematically driven to
resolution — the exact gap Objective 2 step 7 names.

---

## 2. User Story

There is one user type: an **internal Clio operator** (Arun, or whoever he designates). Access is
gated by generic Clerk login only (see Section 3) — this feature does not introduce role scoping.

> **As** an internal Clio operator,
> **I want to** group recurring glitch instances into a tracked issue, move that issue through a
> status lifecycle to closure, and record a root-cause investigation against it,
> **so that** Clio's own recurring quality failures get systematically diagnosed and driven to fixed,
> not just observed.

> **As** an internal Clio operator,
> **I want to** still see recurring glitch patterns ranked by frequency and filter the raw glitch log
> by status,
> **so that** I can tell what is happening most, and separate open work from closed work.

---

## 3. Trigger / Entry Point

- **Route (unchanged):** `/dashboard/admin/glitches` — the existing internal admin page, extended
  in place (`app/dashboard/admin/glitches/page.tsx` + `GlitchDashboardClient.tsx`).
- **Trigger:** operator navigates to the page (page load), then interacts with new controls
  (create issue, change status, attach instance, add note).
- **Required state:** authenticated Clerk user. The page uses `currentUser()` and redirects to
  `/sign-in` if absent (existing behavior, `page.tsx:15-16`). All new mutating API routes use
  `requireAuth()` (`lib/clerk.ts:27`) — a 401 if no Clerk session — matching the existing
  `/api/admin/glitches` and `/api/admin/billing/clients` precedent exactly.
- **Auth scope (explicit, per Feature Brief):** any signed-in Clerk user can reach this — including,
  today, a partner admin. That RBAC weakness is a **known, separate, OUT-OF-SCOPE** gap tracked under
  the Super-Admin backlog item (`BACKLOG.md:37`). This feature **builds against the current gate and
  must not attempt to fix or change it.**
- **Nav entry (new — see Section 4.G and Acceptance Test in Section 7):** the page must gain at least
  one working inbound navigation link (it currently has zero). Exact placement is coordinated with
  the concurrent B2B-18 DashboardShell rework — this spec requires *that* it be reachable, not
  *where*.

---

## 4. Screen / Flow Description

The screen extends the existing two-panel `GlitchDashboardClient.tsx`. After this feature it has
**three panels plus one detail view**. Panels 1 and 2 are the existing panels (Panel 1 unchanged,
Panel 2 extended). Panel 3 and the Issue Detail view are new.

### 4.A — Panel 1: "Glitch Patterns" (EXISTING — unchanged)

Preserved exactly as built. One row per distinct `(glitch_type, partner)`, columns: Type, Partner,
Count, First seen, Last seen; sortable; sorted by Count descending by default. Backed by the existing
`glitch_summary_by_type_and_partner()` RPC via `GET /api/admin/glitches/summary`. **No change to this
panel, its route, or its RPC.** This is the "constant analysis for frequent issues" surface and it
already works.

### 4.B — Panel 2: "All Glitches" (EXISTING — extended)

The existing per-instance drill-down table, extended with issue-tracking affordances:

- **Existing columns kept:** Partner, Session, Type, Description, Extracted at.
- **New column "Status":** shows the tracking status of each glitch instance:
  - `Untriaged` (grey) — instance is not attached to any issue.
  - `Open` / `Investigating` / `Resolved` / `Won't fix` — the status of the issue this instance is
    attached to (a badge, colored per Section 5). An instance's status is **inherited from its linked
    issue**; instances have no independent status (Section 6, Q2 resolution).
- **New column "Issue":** the linked issue's title as a clickable link opening the Issue Detail view
  (Section 4.E); blank with an "Attach…" action if untriaged.
- **New row action "Attach to issue":** opens a small inline control (a dropdown of existing open
  issues + a "＋ New issue…" option). Selecting an issue attaches this instance to it; "New issue…"
  opens the Create Issue form (Section 4.D) pre-seeded to attach this instance on creation.
- **New filter "Status":** a dropdown — `All statuses` / `Untriaged` / `Open` / `Investigating` /
  `Resolved` / `Won't fix` — added alongside the existing Partner and Type filters. Filters the table
  by inherited status. This is the "filter/see the log by status … open work distinguishable from
  closed work" requirement.
- **Existing Partner and Type filters kept unchanged.**
- **Description / purge behavior:** unchanged in shape — shows the description, or the italic purge
  notice when the instance's detail has been purged (Section 6). Tracked (non-terminal) instances
  retain their description past 30 days per the Section 11 Q1 resolution.
- **Row identity:** rows are now keyed by the stable `glitch_instances.id` (Section 6), replacing the
  current unstable array-index React key.

### 4.C — Panel 3: "Tracked Issues" (NEW)

A table of operator-created tracked issues. One row per issue. Columns:

- **Title** — clickable, opens Issue Detail (Section 4.E).
- **Status** — badge (`Open` / `Investigating` / `Resolved` / `Won't fix`).
- **Instances** — count of glitch instances attached.
- **Created** — created date.
- **Last activity** — most recent of: issue update, latest note, latest attached-instance
  extraction (`updated_at`).

Controls:
- **"＋ New issue" button** (top-right of the panel) — opens the Create Issue form (Section 4.D).
- **Status filter** — `All` / `Open` / `Investigating` / `Resolved` / `Won't fix`. Default `All`.
- Sorted by Last activity descending by default.
- Empty state: "No tracked issues yet. Create one from a glitch in the log below, or with ＋ New
  issue."

### 4.D — Create Issue form (NEW — modal or inline panel)

Fields:
- **Title** (required, text input, 1–200 chars) — e.g. "Bot mis-hears numeric ranges as dates."
- **Root cause summary** (optional at creation, multi-line textarea) — the current best diagnosis;
  editable later.
- (If launched from a Panel-2 row's "New issue…") the originating glitch instance is listed as "Will
  be attached on create."

On submit: creates the issue with status `Open`, attaches any seeded instance, closes the form, and
refreshes Panel 3 (and Panel 2 if an instance was attached). Validation errors shown inline.

### 4.E — Issue Detail view (NEW — drawer or dedicated sub-view within the client)

Opened by clicking an issue title. Shows:

1. **Header:** issue title (editable), status control (a segmented control / dropdown offering only
   the transitions valid from the current status, per Section 5's lifecycle), created/updated
   timestamps.
2. **Root cause summary:** editable multi-line text; a Save button; shows last-saved state.
3. **Investigation log:** an append-only, timestamped list of notes (newest first), each showing
   body + created timestamp + author. A textarea + "Add note" button appends a new note. Notes are
   **not** editable or deletable in v1 (append-only investigation trail).
4. **Attached glitch instances:** a table (Partner, Session, Type, Description-or-purge-notice,
   Extracted at, "Detach" action). "Detach" removes the instance from this issue (it reverts to
   Untriaged). A count and an empty state ("No instances attached yet — attach them from the All
   Glitches panel").
5. **Close/back affordance** returning to the panels.

### 4.F — Status change behavior

Changing an issue's status:
- Persists immediately via `PATCH /api/admin/glitches/issues/:id`.
- Only valid transitions are offered (Section 5).
- On moving to `Resolved` or `Won't fix`, sets `resolved_at`. On reopening, clears it.
- Reflected on reload (durable), on Panel 3, and on the inherited status of every attached instance
  in Panel 2.

### 4.G — Navigation entry (NEW — reachability requirement, placement coordinated)

The page must be reachable from a real nav link. Two coordination facts (verified 2026-07-17):
- `DashboardShell.tsx`'s `NAV_ITEMS` currently contains **no admin entries at all** — the admin
  pages are islands.
- The existing admin pages cross-link via header links: `PartnerBillingClient.tsx:178` →
  `/dashboard/admin/templates`, and `TemplateApprovalClient.tsx:187` → `/dashboard/admin/clients`.
  `/dashboard/admin/glitches` is absent from that cluster.
- B2B-18 is concurrently reworking `DashboardShell` nav and its changelog entry states it "also fixes
  the orphaned `/dashboard/admin/glitches` nav gap."

**Requirement:** ship at least one working inbound link to `/dashboard/admin/glitches`. To guarantee
reachability **independent of B2B-18's timing**, add a header cross-link to the glitch dashboard from
the existing admin cross-link cluster (mirroring the `PartnerBillingClient`/`TemplateApprovalClient`
header-link pattern), and add a reciprocal link from the glitch dashboard header back to the cluster.
If B2B-18 lands a DashboardShell admin nav entry first, coordinate so the two are consistent (no
duplicate/conflicting entries) — but do not block on it. See Section 12 (Dependencies) and the
Section 7 acceptance test requiring the Orchestrator to verify the link resolves to a live page
before merge.

---

## 5. Visual Examples

Design language: reuse the existing dark admin table aesthetic already in `GlitchDashboardClient.tsx`
(bg `#111111`, border `#222222`, headings white, secondary text `#94A3B8`, accent `#7C3AED`). No new
visual direction is invented.

**Status badge colors** (reusing the existing palette):
- `Untriaged` → text `#475569` (muted)
- `Open` → `#F59E0B` (amber)
- `Investigating` → `#06B6D4` (cyan)
- `Resolved` → `#10B981` (green)
- `Won't fix` → `#475569` (muted) with strikethrough-free label

**Status lifecycle (issue level):**

```
        ┌─────────────────────────────────────────────┐
        │                                             │
   ┌────────┐   start    ┌───────────────┐            │
   │  OPEN  │ ─────────▶ │ INVESTIGATING │            │
   └────────┘            └───────────────┘            │
      │  │                    │      │                │
      │  └──────────┐         │      │                │
      │             ▼         ▼      ▼                │
      │        ┌──────────┐  ┌────────────┐           │
      └───────▶│ RESOLVED │  │ WON'T FIX  │           │
               └──────────┘  └────────────┘           │
                     │              │                 │
                     └──── reopen ──┴─────────────────┘
                          (→ OPEN)
```
Valid transitions: OPEN→INVESTIGATING, OPEN→RESOLVED, OPEN→WONT_FIX, INVESTIGATING→RESOLVED,
INVESTIGATING→WONT_FIX, INVESTIGATING→OPEN, RESOLVED→OPEN (reopen), WONT_FIX→OPEN (reopen).

**Panel 2 — All Glitches (extended), wireframe:**

```
┌──────────────────────────────────────────────────────────────────────────────────────────┐
│  All Glitches                                                                              │
│  Partner [All partners ▾]   Type [All types ▾]   Status [All statuses ▾]                   │
│ ┌────────────┬──────────┬─────────────────┬──────────────────────┬──────────┬───────────┐ │
│ │ Partner    │ Session  │ Type            │ Description           │ Status   │ Issue     │ │
│ ├────────────┼──────────┼─────────────────┼──────────────────────┼──────────┼───────────┤ │
│ │ Acme Learn │ a1b2c3d4…│ Misunderstanding│ Bot heard "3-5" as…  │ 🟠 Open  │ Numeric…  │ │
│ │ Acme Learn │ e5f6g7h8…│ Repetition      │ Repeated the intro…  │ Untriaged│ [Attach…] │ │
│ │ BetaCo     │ i9j0k1l2…│ Derailment      │ — purged (30-day …)  │ 🟢 Resolvd│ Off-topic │ │
│ └────────────┴──────────┴─────────────────┴──────────────────────┴──────────┴───────────┘ │
└──────────────────────────────────────────────────────────────────────────────────────────┘
```

**Panel 3 — Tracked Issues (new), wireframe:**

```
┌──────────────────────────────────────────────────────────────────────────────┐
│  Tracked Issues                          Status [All ▾]        [＋ New issue]  │
│ ┌───────────────────────────────┬──────────────┬───────────┬─────────┬──────┐ │
│ │ Title                         │ Status       │ Instances │ Created │ Last │ │
│ ├───────────────────────────────┼──────────────┼───────────┼─────────┼──────┤ │
│ │ Bot mis-hears numeric ranges  │ 🔵 Investig. │    7      │ Jul 2   │ Jul16│ │
│ │ Off-topic derailment on pricing│ 🟢 Resolved  │    3      │ Jun 28  │ Jul10│ │
│ └───────────────────────────────┴──────────────┴───────────┴─────────┴──────┘ │
└──────────────────────────────────────────────────────────────────────────────┘
```

**Issue Detail view (new), wireframe:**

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ ← Back        Bot mis-hears numeric ranges as dates   [Status: Investigating ▾]│
│ Created Jul 2, 2026 · Updated Jul 16, 2026                                     │
│                                                                               │
│ Root cause summary                                                    [Save]  │
│ ┌───────────────────────────────────────────────────────────────────────────┐ │
│ │ Hume ASR maps "3 to 5" onto a date grammar. Suspect number-normalization…  │ │
│ └───────────────────────────────────────────────────────────────────────────┘ │
│                                                                               │
│ Investigation log                                                             │
│ ┌───────────────────────────────────────────────────────────────────────────┐ │
│ │ [ add a note … ]                                              [Add note]   │ │
│ ├───────────────────────────────────────────────────────────────────────────┤ │
│ │ Jul 16 14:20 · arun — Confirmed reproduces on the numeric-range prompt.   │ │
│ │ Jul 12 09:03 · arun — Grouped 4 more instances from BetaCo under this.    │ │
│ └───────────────────────────────────────────────────────────────────────────┘ │
│                                                                               │
│ Attached glitch instances (7)                                                 │
│ ┌────────────┬──────────┬─────────────────┬───────────────────┬────────┬────┐ │
│ │ Partner    │ Session  │ Type            │ Description        │ At     │    │ │
│ │ Acme Learn │ a1b2c3d4…│ Misunderstanding│ Bot heard "3-5"…  │ Jul 2  │ ✕  │ │
│ └────────────┴──────────┴─────────────────┴───────────────────┴────────┴────┘ │
└──────────────────────────────────────────────────────────────────────────────┘
```

**Create Issue form (new), wireframe:**

```
┌──────────────────────────────────────────────┐
│  New tracked issue                        ✕   │
│                                              │
│  Title *                                     │
│  [ Bot mis-hears numeric ranges as dates   ] │
│                                              │
│  Root cause summary (optional)               │
│  ┌──────────────────────────────────────────┐│
│  │                                          ││
│  └──────────────────────────────────────────┘│
│                                              │
│  Will attach: glitch a1b2c3d4… (Acme Learn)  │
│                                              │
│           [Cancel]        [Create issue]     │
└──────────────────────────────────────────────┘
```

---

## 6. Data Requirements

All new persistence is internal-only. **No partner API, no partner webhook event, and no
partner-facing table is added or modified.** New objects live in a new migration
`supabase/migrations/082_b2b17_glitch_issue_tracker.sql` (082 is the next free number; highest
existing is 081).

### 6.1 New table — `glitch_instances` (row-per-glitch, gives stable identity)

The core modeling change. Today a glitch is an anonymous element inside
`partner_session_insights.glitches` (JSONB array of `{type, description}`) with **no stable ID** and a
description purged at 30 days — you cannot attach durable status/RCA to it. This table gives every
glitch instance a real primary key.

```
glitch_instances
  id                     UUID PK        default uuid_generate_v4()
  partner_session_id     UUID  NOT NULL REFERENCES partner_sessions(id) ON DELETE CASCADE
  partner_account_id     UUID  NOT NULL REFERENCES partner_accounts(id) ON DELETE CASCADE
  glitch_type            TEXT  NOT NULL CHECK (glitch_type IN
                            ('misunderstanding','repetition','confusion_about_clio','derailment','other'))
  description            TEXT  NULL      -- NULL once purged (or if source was already type-only)
  ordinal                INT   NOT NULL  -- 0-based position within the session's glitches array
  extracted_at           TIMESTAMPTZ NOT NULL
  full_detail_purged_at  TIMESTAMPTZ NULL
  issue_id               UUID  NULL REFERENCES glitch_issues(id) ON DELETE SET NULL
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now()
  UNIQUE (partner_session_id, ordinal)

  indexes: (issue_id), (partner_account_id), (glitch_type), (extracted_at DESC),
           partial (full_detail_purged_at) WHERE full_detail_purged_at IS NULL
  RLS: ENABLE; "Service role full access" policy (auth.role() = 'service_role') — identical to
       partner_session_insights.
```

**Population — zero change to the capture pipeline.** `glitch_instances` is a durable projection of
the JSONB glitches, populated by a Postgres trigger, so
`inngest/partner-session-insights-extractor.ts` is **not modified at all** (it keeps writing the JSONB
array exactly as today):

```
FUNCTION fanout_glitch_instances()  -- AFTER INSERT OR UPDATE OF glitches ON partner_session_insights
  Fires ONLY on the first-population transition: WHEN (NEW.glitches IS NOT NULL
    AND (TG_OP = 'INSERT' OR OLD.glitches IS NULL) AND jsonb_array_length(NEW.glitches) > 0)
  INSERT INTO glitch_instances (partner_session_id, partner_account_id, glitch_type,
      description, ordinal, extracted_at)
    SELECT NEW.partner_session_id, NEW.partner_account_id, g.value->>'type',
           g.value->>'description', g.ordinality - 1, COALESCE(NEW.extracted_at, now())
    FROM jsonb_array_elements(NEW.glitches) WITH ORDINALITY AS g(value, ordinality)
  ON CONFLICT (partner_session_id, ordinal) DO NOTHING;   -- idempotent
```

The guard `OLD.glitches IS NULL` is the load-bearing detail: the extractor writes glitches exactly
once (NULL→array — the idempotency guard makes `success`/`success_empty` terminal, so it is never
re-written), and the daily purge rewrites glitches array→type-only (non-null→non-null), which the
guard **excludes**. So the trigger fires on capture and never on purge — `glitch_instances`
descriptions are never touched by the JSONB purge. (`extracted_at` is written by the extractor in the
same `.update()` that sets `glitches`; it is non-null when this trigger fires.)

**One-time backfill (in the same migration):** fan out every existing
`partner_session_insights` row's glitches into `glitch_instances`, carrying `full_detail_purged_at`
from the parent so already-purged rows land with `description = NULL` and a set `full_detail_purged_at`
(preserving the existing purge-notice semantics):

```
INSERT INTO glitch_instances (partner_session_id, partner_account_id, glitch_type,
    description, ordinal, extracted_at, full_detail_purged_at)
  SELECT psi.partner_session_id, psi.partner_account_id, g.value->>'type',
         g.value->>'description', g.ordinality - 1, psi.extracted_at, psi.full_detail_purged_at
  FROM partner_session_insights psi,
       LATERAL jsonb_array_elements(psi.glitches) WITH ORDINALITY AS g(value, ordinality)
  WHERE psi.glitches IS NOT NULL AND jsonb_array_length(psi.glitches) > 0
ON CONFLICT (partner_session_id, ordinal) DO NOTHING;
```

### 6.2 New table — `glitch_issues` (the durable tracked issue: status + RCA)

```
glitch_issues
  id                   UUID PK default uuid_generate_v4()
  title                TEXT NOT NULL CHECK (char_length(title) BETWEEN 1 AND 200)
  root_cause_summary   TEXT NULL
  status               TEXT NOT NULL DEFAULT 'open'
                         CHECK (status IN ('open','investigating','resolved','wont_fix'))
  created_by           TEXT NULL          -- Clerk user id of creator
  resolved_at          TIMESTAMPTZ NULL   -- set on → resolved/wont_fix, cleared on reopen
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now()
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
  indexes: (status), (updated_at DESC)
  trigger: BEFORE UPDATE ... EXECUTE PROCEDURE update_updated_at_column()  -- reuse existing proc
  RLS: ENABLE; "Service role full access" policy.
```

### 6.3 New table — `glitch_issue_notes` (append-only investigation log)

```
glitch_issue_notes
  id                    UUID PK default uuid_generate_v4()
  issue_id              UUID NOT NULL REFERENCES glitch_issues(id) ON DELETE CASCADE
  body                  TEXT NOT NULL CHECK (char_length(body) BETWEEN 1 AND 5000)
  author_clerk_user_id  TEXT NULL
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now()
  index: (issue_id, created_at DESC)
  RLS: ENABLE; "Service role full access" policy.
```

Notes are insert-only (no update/delete route) → the investigation trail is immutable.

### 6.4 Purge reconciliation (the Section 11 Q1 mechanism)

The existing purge function `purge_partner_session_insights_full_detail()` and the daily
`partnerSessionInsightsPurge` Inngest job (`inngest/partner-session-insights-extractor.ts:419`) are
kept **byte-for-byte unchanged** for the JSONB path — the JSONB stays the bounded-retention copy and
the summary RPC (which only needs `type` + `extracted_at`, both survive purge) is unaffected.

A **new companion RPC** purges `glitch_instances` descriptions on the same 30-day clock, with an
exemption for actively-tracked issues:

```
FUNCTION purge_glitch_instances_full_detail(p_cutoff TIMESTAMPTZ) RETURNS INTEGER
  UPDATE glitch_instances gi
    SET description = NULL, full_detail_purged_at = now()
  WHERE gi.full_detail_purged_at IS NULL
    AND gi.extracted_at < p_cutoff
    AND (
      gi.issue_id IS NULL                                   -- untracked → purge on the normal clock
      OR EXISTS (SELECT 1 FROM glitch_issues i
                 WHERE i.id = gi.issue_id
                   AND i.status IN ('resolved','wont_fix'))  -- closed issue → evidence re-ages-out
    );
    -- EXEMPT: instances attached to an OPEN or INVESTIGATING issue keep their description past 30 days.
```

The daily purge job gains **one added `step.run`** calling this new RPC with the same
`now() - 30 days` cutoff, right after the existing step (existing step untouched).

**Net data-boundary behavior:**
- **Untracked glitch** → description purged from BOTH the JSONB (existing) and `glitch_instances`
  (new) at 30 days. No description persists beyond 30 days. **Boundary preserved for the default
  case.**
- **Actively-tracked glitch (open/investigating issue)** → JSONB description still purged at 30 days;
  `glitch_instances` description **retained** while the issue is open. This is the deliberate,
  operator-triggered exemption — **the policy change escalated in Section 11 Q1.**
- **Closed-issue glitch (resolved/wont_fix)** → becomes purge-eligible again on the normal clock, so
  raw extracted evidence does not linger indefinitely after closure. Operator-authored RCA
  (`root_cause_summary` + notes) is never purged — it is Clio's own authored record, not extracted
  glitch text, so it is outside the data-boundary's scope and stands alone.

> **If Q1 resolves to "keep the purge absolute" (option c),** the only change is: drop the exemption
> branch so `purge_glitch_instances_full_detail` purges *all* instances older than 30 days
> regardless of `issue_id`/status. Everything else in this spec is unaffected. The schema and UI do
> not change. This is why Q1 can remain open without blocking build design — see Section 11.

### 6.5 Reads / writes summary

Reads from DB:
- `glitch_summary_by_type_and_partner()` RPC — Panel 1 (unchanged).
- `glitch_instances` (joined to `partner_accounts` for name, left-joined to `glitch_issues` for
  inherited status/title) — Panel 2 (repointed from JSONB unnest to this table).
- `glitch_issues` (+ instance counts, latest activity) — Panel 3.
- `glitch_issues` + `glitch_issue_notes` + attached `glitch_instances` — Issue Detail.

Writes to DB:
- INSERT `glitch_issues` (create issue).
- UPDATE `glitch_issues` (status, title, root_cause_summary, resolved_at).
- INSERT `glitch_issue_notes` (add note).
- UPDATE `glitch_instances.issue_id` (attach/detach).
- (Automatic) trigger INSERT into `glitch_instances` on capture; purge UPDATE nulling descriptions.

### 6.6 API routes (all `requireAuth()`, all under `/api/admin/*`, all Zod-validated)

| Method | Route | Purpose |
|---|---|---|
| GET | `/api/admin/glitches` (existing — **repoint**) | Panel 2. Read `glitch_instances` + linked issue. Query: `partner_account_id?`, `type?`, `status?` (`untriaged`\|`open`\|`investigating`\|`resolved`\|`wont_fix`). Returns rows incl. `id`, `issue_id`, `issue_title`, `status`, `full_detail_purged`. |
| GET | `/api/admin/glitches/summary` (existing — **unchanged**) | Panel 1. |
| GET | `/api/admin/glitches/issues` | Panel 3. List issues + `instance_count` + `last_activity`. Query: `status?`. |
| POST | `/api/admin/glitches/issues` | Create issue. Body: `{ title, root_cause_summary?, attach_instance_id? }`. Returns created issue. |
| GET | `/api/admin/glitches/issues/:id` | Issue Detail. Returns issue + notes + attached instances. |
| PATCH | `/api/admin/glitches/issues/:id` | Update. Body: `{ status?, title?, root_cause_summary? }`. Status transitions validated against Section 5; invalid → 400. Sets/clears `resolved_at`. |
| POST | `/api/admin/glitches/issues/:id/notes` | Append note. Body: `{ body }`. |
| POST | `/api/admin/glitches/issues/:id/attach` | Attach instances. Body: `{ instance_ids: string[] }`. Sets `issue_id`. |
| POST | `/api/admin/glitches/issues/:id/detach` | Detach instances. Body: `{ instance_ids: string[] }`. Sets `issue_id = NULL`. |

All mutating routes read/write via `createSupabaseAdminClient()` (service role), same as existing
glitch routes. `created_by` / `author_clerk_user_id` are populated from `requireAuth()`'s `userId`.

---

## 7. Success Criteria (Acceptance Tests)

Verifiable by QA / grep / `tsc`. "Persists and survives reload" means a real DB round-trip, not
component state.

**Lifecycle & closure**
1. ✓ Given an operator on the Tracked Issues panel, when they click ＋ New issue, fill Title, and
   submit, then a `glitch_issues` row is created with `status='open'` and appears in Panel 3 after
   reload.
2. ✓ Given an open issue, when the operator sets status to Investigating then Resolved, then
   `glitch_issues.status='resolved'` and `resolved_at` is non-null, and the change is reflected on
   Panel 3 and on every attached instance's inherited Status in Panel 2 **after a full page reload**.
3. ✓ Given a resolved issue, when the operator reopens it, then `status='open'` and `resolved_at` is
   NULL, persisted across reload.
4. ✓ Given an issue with status `open`, when a PATCH requests a transition not permitted by Section 5
   (e.g. `resolved`→`investigating` without going through `open`), then the API returns 400 and the
   status is unchanged.

**Grouping / RCA (root-cause analysis)**
5. ✓ Given three separate glitch instances (across one or more sessions/partners), when the operator
   attaches all three to one issue, then `GET /api/admin/glitches/issues/:id` returns all three under
   that issue and each instance's `issue_id` equals that issue in Panel 2 — demonstrating "these
   instances are the same underlying root cause."
6. ✓ Given an issue, when the operator adds two investigation notes, then both persist as
   `glitch_issue_notes` rows, display newest-first with timestamp + author, and are not editable or
   deletable via any route.
7. ✓ Given an issue, when the operator edits and saves Root cause summary, then
   `glitch_issues.root_cause_summary` is updated and shown on reload.
8. ✓ Given an attached instance, when the operator detaches it, then its `issue_id` is NULL and it
   shows `Untriaged` in Panel 2 after reload.

**Frequency analytics preserved (no regression)**
9. ✓ Panel 1 ("Glitch Patterns") renders identical rows/counts/first-seen/last-seen as before this
   feature; `glitch_summary_by_type_and_partner()` and `/api/admin/glitches/summary` are unchanged
   (grep: no diff to `summary/route.ts` or the RPC definition).
10. ✓ For every `(glitch_type, partner)`, the Panel 1 count equals the number of `glitch_instances`
    rows for that pair (backfill + trigger completeness check).

**Capture pipeline not regressed**
11. ✓ `inngest/partner-session-insights-extractor.ts` has **no source change** (grep/diff: file
    untouched) — glitch capture still writes the JSONB array exactly as before.
12. ✓ Given a new partner session that produces glitches, when extraction writes the JSONB array,
    then the fan-out trigger creates one `glitch_instances` row per array element (correct type,
    description, ordinal), and zero rows for an empty/`success_empty` extraction.

**Purge reconciliation**
13. ✓ Given an untracked glitch instance older than 30 days, when the daily purge runs, then its
    `glitch_instances.description` is NULL and `full_detail_purged_at` is set (Panel 2 shows the purge
    notice) — i.e. the purge job no longer leaves un-tracked evidence, and destroys data only for
    glitches **not** attached to an open/investigating issue.
14. ✓ Given a glitch instance attached to an `open` or `investigating` issue and older than 30 days,
    when the purge runs, then its `description` is **retained** (not nulled) — *conditional on Q1
    resolving to the recommended option; if Q1 resolves to option (c), this test inverts to "is
    nulled" and the exemption branch is removed.*
15. ✓ Given a glitch instance attached to a `resolved`/`wont_fix` issue and older than 30 days, when
    the purge runs, then its `description` is nulled (evidence re-ages-out after closure); the issue's
    `root_cause_summary` and notes are unaffected.

**Reachability & scope**
16. ✓ Grep proves at least one inbound `href`/link to `/dashboard/admin/glitches` exists in the app,
    and the Orchestrator manually verifies the link resolves to a live rendered page (not a 404)
    before merge.
17. ✓ Grep proves no new route under `app/api/partner/**` references glitch issues/status/notes, and
    no partner webhook event type is added — the tracker is internal-only.
18. ✓ `npx tsc --noEmit` is clean; `npm run build` succeeds; all new API inputs are Zod-validated;
    the existing test suite still passes.

---

## 8. Error States

| Condition | Behavior |
|---|---|
| Any GET fails (network/500) | Panel shows the existing red inline message ("Couldn't load … Try refreshing the page.") — reuse the current pattern in `GlitchDashboardClient.tsx`. |
| Panel loading | Existing "Loading…" row/state reused for all new panels. |
| Create Issue: empty/too-long title | Inline validation error under the field; submit disabled; API also returns 400 (Zod) as defense-in-depth. |
| PATCH invalid status transition | API 400 with a message; UI keeps the prior status and shows a toast/inline error; only valid transitions are offered in the control so this is a guard, not a normal path. |
| Attach an instance already attached to another issue | Allowed — re-assigns `issue_id` to the new issue (an instance belongs to at most one issue). No error; Panel 2 reflects the new issue after reload. |
| Add note: empty body | Submit disabled; API 400 on empty. |
| Attach/detach references a non-existent instance/issue id | API 404; UI surfaces a non-blocking error and refreshes. |
| Slow API | Buttons show a pending/disabled state; no optimistic mutation that could desync from the DB (avoid the "looks saved but isn't" class — all mutations confirm against the server response before updating the view). |
| Instance description is purged | Show the existing italic purge notice (`— purged (30-day retention window elapsed)`) in place of the description, in Panel 2 and in the Issue Detail attached-instances table. |
| Anthropic/Hume down | Irrelevant to this feature — it never calls them. Capture (which does) is untouched. |

---

## 9. Edge Cases

- **Empty state / first run:** No issues yet → Panel 3 empty state. No glitches yet → Panels 1 & 2
  keep their existing "No glitches recorded yet." empty state.
- **`success_empty` extraction:** writes `glitches: []` — trigger fans out zero rows. No orphan
  instance. (Test 12.)
- **A session with N>1 glitches:** N `glitch_instances` rows, ordinals 0…N-1, unique per session.
- **Purge already ran before backfill:** already-purged parent rows backfill with `description=NULL`
  + `full_detail_purged_at` set — instances show the purge notice, never a fake/empty description.
- **Instance's session deleted:** `ON DELETE CASCADE` from `partner_sessions` removes the instance;
  if it was attached, the issue simply loses that instance (issue itself survives).
- **Issue deleted:** not offered in v1 UI (no delete route). If ever added, `ON DELETE SET NULL`
  detaches instances and `ON DELETE CASCADE` removes its notes. (Out of scope to build a delete UI —
  see Section 10.)
- **Reopen after purge:** if an issue was closed, its instances aged out (description NULL), and it is
  later reopened — the descriptions are gone (they were purged while closed). The `root_cause_summary`
  + notes remain, so the investigation record survives; new instances attached later retain detail
  while open again. This is the intended, documented behavior of the closure→re-age-out boundary.
- **Same underlying cause spanning multiple partners/types:** fully supported — an issue can hold
  instances of any type from any partner (grouping is operator-curated, not constrained to one
  `(type, partner)`). This is the deliberate advantage of curated issues over the auto `(type,
  partner)` summary. (Q1 grouping resolution.)
- **Two operators editing one issue concurrently:** last-write-wins on `root_cause_summary`/status
  (acceptable for a low-volume internal tool with a handful of operators); notes are append-only so
  they never collide. No locking in v1.
- **Mobile vs desktop:** reuse the existing responsive table pattern (`overflow-x-auto`) already in
  the client; no bespoke mobile layout. The Issue Detail view stacks vertically on narrow screens.
- **Large log:** Panel 2 already loads all glitches unpaginated (existing behavior). This feature does
  not add pagination (not requested; volume is internal-scale). If the existing route is already slow
  at scale that is a pre-existing condition, not introduced here — flagged, not fixed.

---

## 10. Out of Scope

- **Fixing the internal-admin RBAC gap** (any authenticated Clerk user reaching `/dashboard/admin/*`)
  — explicitly tracked under the Super-Admin backlog item (`BACKLOG.md:37`), held for Arun's own
  brainstorm. Build against the current gate; do not touch it.
- **Any partner-facing surface or partner API exposure** of glitch status, RCA, notes, or tracking.
  No `/api/partner/**` route, no partner dashboard, no partner webhook event.
- **Rebuilding glitch capture, the extraction prompt, or the frequency analytics.** The extractor,
  the JSONB write path, `glitch_summary_by_type_and_partner()`, and Panel 1 are preserved unchanged.
- **AI-assisted / automatic glitch clustering.** Grouping is manual/operator-curated (Q1). No LLM
  call is added anywhere in this feature.
- **External issue-tracker sync** (Jira/Linear/GitHub), partner notifications, email/SMS on status
  change.
- **Issue deletion UI, note editing/deletion, per-instance status, assignment/owner fields, due
  dates, SLA timers, comment threading.** Not requested; the schema leaves room but the UI/routes are
  not built.
- **Pagination / full-text search of the glitch log.** Not requested.
- **Changing the DashboardShell nav structure itself** — that is B2B-18's job; this feature only
  requires that a reachable link exists and coordinates placement (Section 4.G).
- **Deciding the purge policy unilaterally** — the mechanism is specified; the policy ratification is
  Arun's (Section 11 Q1).

---

## 11. Open Questions

Five of the six CEO-flagged tensions are resolved below with direct code evidence and are **not**
open. One is escalated.

**Resolved in-spec (not open):**
- **Grouping unit (CEO Q1):** **Hybrid.** Keep the auto `(glitch_type, partner)` frequency view
  (Panel 1, already built) as the "frequent issues" signal, and add operator-created named issues
  (`glitch_issues`) for closure/RCA, to which instances of any type/partner are attached. Resolved:
  matches Arun's "same underlying root cause" (a cause can span types/partners, which `(type,
  partner)` cannot express) and "frequent issues" (the auto panel) simultaneously; grounded in the
  existing summary RPC + the audit's identity finding. High confidence.
- **Status per-issue vs per-instance (CEO Q2):** **Per-issue.** You close a cause, not a symptom;
  instances inherit status from their linked issue (or "untriaged"). Grounded: a glitch instance is
  one session's momentary hiccup whose description is purged at 30 days — it cannot be the durable
  unit of closure; Arun's wording is "status of *issues* to track to closure." High confidence.
- **RCA shape (CEO Q3):** **Free-text `root_cause_summary` + append-only investigation notes +
  link-related-instances**, not rigid structured fields. Refinement over the CEO's baseline: the
  investigation log is an append-only timestamped notes table (not one mutable blob) so a
  weeks-long investigation keeps an immutable trail with author/time — this directly serves "track to
  closure … root cause analysis" over time without heavyweight 5-whys structure. High confidence.
- **Glitch-instance identity / migration (CEO Q4):** **New `glitch_instances` row-per-glitch table,
  populated by a trigger fan-out from the existing JSONB (guarded to fire only on first population)
  plus a one-time backfill** — so the capture pipeline and summary RPC are untouched and the existing
  dashboard keeps working (Section 6.1). High confidence; the "no regression" rule is satisfied by
  construction (extractor file unchanged, verified as Acceptance Test 11).
- **Nav placement (CEO Q6):** Resolved as a *requirement* (must be reachable) + a concrete
  non-blocking mechanism (admin header cross-link mirroring the existing pattern) + coordination with
  B2B-18, with Orchestrator link-resolves-verification gated at merge (Section 4.G, Test 16). High
  confidence; not open.

**ESCALATED — needs Arun (CEO Q5): the purge-policy ratification.**

> **Q1 (the only open question): May glitch-instance *descriptions* be retained beyond the 30-day
> purge window for instances an operator has attached to an OPEN or INVESTIGATING tracked issue?**
> — NEEDS ANSWER FROM: **Arun** (via CEO).

Why this is escalated and not decided in-spec: the Feature Brief and CLAUDE.md are explicit that if
the resolution *changes the meaning of the 30-day purge*, it is Arun's call, not the BA's or CEO's.
The recommended resolution does change that meaning — see below. Glitch descriptions are Clio's own
de-identified bot-behavior data (not end-user content), so this is a **lighter** governance question
than B2B-09's action-item retention was — but it still revises a retention behavior Arun's
Non-Negotiable Data Boundary motivated and that he personally approved (Option A) two days ago.

- **Recommended answer (the spec is designed for this):** **Yes — exempt while actively tracked.**
  An instance attached to an open/investigating issue keeps its description past 30 days; once the
  issue is resolved/won't-fix, the instance re-ages-out on the normal clock; untracked instances are
  unaffected (still purged at 30 days). Rationale: recurring issues by definition recur over
  time (often >30 days), so without this the tracker cannot do RCA on exactly the "frequent issue"
  case it exists to serve; the retained data is Clio's own bot behavior, deliberately and narrowly
  scoped to instances an operator hand-attached, and bounded (re-purged after closure). This is the
  smallest change that makes the feature actually work.
- **Fallback if Arun declines (option c):** keep the purge absolute — drop the exemption branch;
  `glitch_instances` descriptions purge at 30 days regardless of tracking. The feature still ships;
  RCA is limited to evidence <30 days old plus operator-authored notes (which never purge). **No
  schema or UI change** — only the one `EXISTS(... status IN ('open','investigating'))` branch is
  removed from `purge_glitch_instances_full_detail` (Section 6.4). Acceptance Test 14 inverts.

Because the entire build is designed to be correct under *either* answer with only a one-line SQL
difference, this open question **does not block the CEO's spec approval or the developer's start on
everything except the final purge-exemption branch.** But per the standing gate, the purge-exemption
branch itself must not be finalized until Arun ratifies Q1. The Orchestrator should carry Q1 to Arun
via the CEO in parallel with the build.

---

## 12. Dependencies

- **B2B-09 (done, shipped 2026-07-16):** the capture pipeline
  (`partner-session-insights-extractor.ts`), `partner_session_insights` table + `glitches` JSONB, the
  `glitch_summary_by_type_and_partner()` RPC, the 30-day purge RPC/job, and the
  `GlitchDashboardClient.tsx` two-panel UI this feature extends. All present and verified.
- **Existing infra reused:** `requireAuth()` (`lib/clerk.ts`), `createSupabaseAdminClient()`
  (`lib/supabase.ts`), `update_updated_at_column()` procedure (used by migration 075 etc.),
  `uuid_generate_v4()`, the existing admin table/loading/empty/error UI conventions.
- **B2B-18 (in flight — coordination, not a hard block):** reworking `DashboardShell` nav and slated
  to fix the orphaned-glitches nav gap. This feature adds an independent header cross-link so it does
  not *depend* on B2B-18 landing first, but the Orchestrator must reconcile the two so there is no
  duplicate/conflicting nav entry, and must verify the final link resolves to a live page before
  merge (Test 16).
- **New migration `082_b2b17_glitch_issue_tracker.sql`** must be applied before the new routes/UI go
  live: creates `glitch_instances`, `glitch_issues`, `glitch_issue_notes`, the fan-out trigger, the
  backfill, and the `purge_glitch_instances_full_detail` RPC; adds the one `step.run` to the existing
  purge job.
- **Q1 (Section 11)** must be answered by Arun before the purge-exemption branch is finalized; the
  rest of the build proceeds in parallel.
- **No new third-party package, no new vendor API, no env var.** Approved-library and internal-only
  constraints hold trivially.
```
