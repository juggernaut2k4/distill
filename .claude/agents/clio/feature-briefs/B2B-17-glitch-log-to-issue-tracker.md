# Feature Brief: Glitch Log → Internal Issue Tracker (status, closure, RCA)

**ID:** B2B-17
**From:** CEO Agent (on behalf of Arun)
**To:** Business Analyst Agent
**Priority:** P1
**Date:** 2026-07-17

> **ID note (tie-break):** Highest existing brief at write time was `B2B-16`; this brief claimed
> `B2B-17`. Two other briefs were being dispatched in parallel today. Per this project's established
> rule — *whichever claims an ID second renumbers* — if a `B2B-17` from a parallel effort already
> exists when this lands, that other brief keeps its content and this one is not the one that moves;
> resolve by direct filename check, not by assuming. (This mirrors the documented `B2B-08`/`B2B-09`
> collision resolution.)

---

## What Arun Said

Verbatim, 2026-07-17, in reference to the post-call glitch log described in `CORE_OBJECTIVES.md` v3,
Objective 2, step 7:

> "Glitches to our application so we can fix, this should be like a log so we can constantly analyze
> for frequent issues, status of issues to track to closure etc, perform root cause analysis etc."

On visibility, when asked whether this surface is partner-facing:

> "stays internal with us."

And, directly on this build:

> "we need to build this."

This is a direct, confirmed instruction from Arun — not a discussion item. It is the explicit build
mandate for the gap named in `CORE_OBJECTIVES.md` v3 Objective 2, step 7 ("This log must support
constant analysis for frequent issues, status of issues tracked to closure, and root-cause
analysis").

---

## The Problem Being Solved

Clio's bot runs partner learning sessions; when the bot's own delivery breaks down (misunderstands
the user, repeats itself, causes confusion about itself, gets derailed), those breakdowns are
**glitches in Clio's own application**. Objective 2 step 7 makes capturing and *working through*
those glitches part of the product's exclusive scope — this is how Clio finds and fixes its own
recurring quality failures.

**What exists today (verified by code audit, 2026-07-17) is capture + read-only analytics, not a
tracker.** The current state:

- **Capture works.** `inngest/partner-session-insights-extractor.ts` runs after each partner session
  (triggered off the Hume `chat_ended` → `session.insights_ready` path, B2B-09), makes one Anthropic
  call, and writes glitches as a JSONB array onto `partner_session_insights.glitches`. Each glitch
  element is `{ type, description }`. Five types exist:
  `misunderstanding | repetition | confusion_about_clio | derailment | other`.
- **Frequency analytics work.** The `glitch_summary_by_type_and_partner()` RPC (migration 078)
  already aggregates **count + first-seen + last-seen** per `(glitch_type, partner)`. The
  `/dashboard/admin/glitches` UI (`GlitchDashboardClient.tsx`) shows this as a "Glitch Patterns"
  summary panel plus an "All Glitches" drill-down with partner/type filters.
- **Retention is bounded.** A daily purge RPC (`purge_partner_session_insights_full_detail`) strips
  glitch *descriptions* to type-only 30 days after extraction (this is the B2B-09 / Non-Negotiable
  Data Boundary retention window — glitch detail is de-identified application-behavior data, but it
  is still purged on the 30-day clock).

**What does not exist, and is exactly what Arun asked for:**

1. **No status.** A glitch (or a recurring pattern of glitches) cannot be marked open / investigating
   / resolved / won't-fix. There is no way to "track to closure."
2. **No root-cause-analysis support.** There is nowhere to record an investigation, a diagnosis, or
   the fact that ten separate glitch instances all stem from one underlying cause.
3. **No workflow layer at all** — the whole surface is read-only reporting.

Additionally, the audit found the screen is currently an **orphaned route**: `/dashboard/admin/glitches`
has zero inbound navigation links anywhere in the app. It works if you type the URL, but nothing
points to it.

---

## What Success Looks Like

An internal Clio operator (Arun, or whoever he designates) can:

1. Open the glitch surface **from a real navigation entry** — not by remembering a URL.
2. See recurring glitch patterns ranked by frequency (this already exists — **preserve it**).
3. **Assign a status to a tracked issue and move it through a lifecycle to closure** — so "this
   keeps happening" becomes "this is being worked" becomes "this is fixed / we've decided not to
   fix it."
4. **Record root-cause analysis** against a tracked issue — an investigation log / notes, and the
   ability to say "these glitch instances are all the same underlying problem."
5. Filter / see the log by status, so open work is distinguishable from closed work.

Concretely: the glitch surface stops being a passive report and becomes the place where Clio's own
quality bugs are triaged and driven to resolution. That is the bar in `CORE_OBJECTIVES.md` v3.

---

## Known Constraints (from Arun and from the codebase)

**Internal-only — hard boundary.**
- This is a Clio-internal surface (Arun: "stays internal with us"). It is the "dashboard we will use
  to target" from Objective 4 — **not** a partner-facing operational surface.
- **No partner-facing exposure of glitch status.** No partner API endpoint may surface glitch
  status, RCA notes, or issue tracking. Do not add glitch tracking to any partner API contract or
  partner dashboard.

**Reuse, don't rebuild (per Objective 5, and the standing "no regression / no delete without
approval" rule).**
- The extraction/capture pipeline (`partner-session-insights-extractor.ts`) and its storage table
  (`partner_session_insights`) already capture glitches correctly. **This brief adds a workflow layer
  on top of capture — it does not rebuild capture.** Do not change how glitches get created.
- The frequency/recurrence data (count + first/last-seen) already exists in
  `glitch_summary_by_type_and_partner()`. **Confirm it, preserve it, extend it if needed — do not
  rebuild it.**
- **Extend `GlitchDashboardClient.tsx`** (add status controls, a per-glitch/per-issue detail &
  investigation view, status filtering) rather than rewriting it from scratch where practical.

**Auth: build against the current (weak) gate — do NOT invent a new one.**
- Scope status-change permission to whatever currently gates `/dashboard/admin/*` (generic Clerk
  `currentUser()` / `requireAuth()`, matching the `/api/admin/glitches` and
  `/api/admin/billing/clients` precedent).
- **Known, separate, OUT-OF-SCOPE gap:** internal-admin pages have **no real role-based access
  control** beyond generic Clerk login — any authenticated user (including a partner admin) can reach
  them. This is tracked separately under the **Super-Admin backlog item** (`BACKLOG.md`, "🅿️ BACKLOG"
  section) and is explicitly held pending Arun's own super-admin brainstorm. **This brief must not
  attempt to fix it.** Note it, build against the current gate, and let the future super-admin system
  subsume proper access control.

**Navigation placement is coordinated, not dictated here.**
- The screen **must** be reachable from a real nav entry once this ships (fix the orphaned-route
  finding). But the internal-admin nav in `components/dashboard/DashboardShell.tsx` is being reworked
  concurrently (parallel B2B-dashboard-simplification effort — see `docs/b2b-pivot-status.md` and the
  `B2B-16` post-deletion orphan flags in `BACKLOG.md`). **This brief requires that the glitch surface
  gets a real, working nav entry into whatever the internal-admin nav becomes — it does not dictate
  the exact location.** The BA should coordinate the exact placement with the state of DashboardShell
  after that parallel work lands, and the Orchestrator must verify the link actually resolves before
  merge (the audit specifically caught a prior nav change that pointed at a dead page).

**Scope discipline.**
- Objective 3: the call-flow (incl. step 7's glitch log) is the *complete* scope. This is squarely
  in scope. Do **not** expand it into anything beyond status/closure/RCA + reachability + preserved
  frequency analytics (e.g. no AI-assisted clustering, no partner notifications, no external
  issue-tracker sync) unless a named question below resolves toward it with Arun's explicit say-so.

---

## Design Direction (a starting point for the BA — refine, don't rubber-stamp)

Arun did not specify the exact mechanism for status or RCA, and said as much implicitly ("etc").
The CEO's recommended starting shape, for the BA to pressure-test and fully specify:

**A. Separate the durable "issue" from the raw glitch instance.**
The core modeling insight from the audit: a glitch today is an *anonymous element inside a
per-session JSONB array* — it has no stable identity, and its description is purged at 30 days. You
cannot durably attach a status or an RCA to something with no ID that disappears in a month.
Arun's language ("status of *issues* to track to closure," "*frequent* issues," "root cause") is
about **recurring issues/patterns**, not one session's momentary hiccup. You don't "close" a single
session's misunderstanding — you close the underlying cause of a *class* of misunderstandings.

Recommended: introduce a durable **tracked-issue** record (its own table, e.g. `glitch_issues`) that
carries **status + RCA/investigation notes**, and link glitch instances to it. Frequency stays at the
aggregate level (already built). Status/closure/RCA live at the issue level (new). This also survives
the 30-day purge cleanly, because the issue record is separate durable data, not the purged
per-session detail.

**B. Give glitch instances stable identity.**
To link instances to an issue (and to attach anything durable), individual glitch instances need a
stable primary key — which the current JSONB-array-element model does not provide. The BA/architecture
should decide the clean foundation: most likely a **row-per-glitch instance table** (each glitch its
own row with a real PK, `partner_session_id`, `partner_account_id`, `type`, `description`, timestamps),
either replacing or sitting alongside the existing JSONB write path. **Preserve the existing capture
behavior and the existing summary analytics** through whatever migration path is chosen (the "no
regression" rule applies — the current dashboard must keep working).

**C. Status lifecycle — recommended starting set:**
`open → investigating → resolved` with a terminal `won't_fix` (and possibly `wont_fix`/`resolved`
distinct from a reopen path). Read the extraction pipeline
(`inngest/partner-session-insights-extractor.ts`, and B2B-09's `hume-action-item-extractor.ts`
sibling) to ground *how glitches actually come into being* before finalizing *how they get closed* —
the lifecycle should fit the real creation flow, not an abstract ideal.

**D. RCA mechanism — recommended starting shape (flag if uncertain):**
A **free-text investigation log / notes field** on the tracked issue, **plus the ability to mark
multiple glitch instances as the same underlying root cause** (i.e. attach many instances to one
issue). This is deliberately lighter than rigid structured RCA fields (5-whys templates, categorized
cause codes) — but if the BA believes structured fields serve Arun's "constantly analyze for frequent
issues" intent better, that is a legitimate alternative to raise. Do **not** guess the final shape;
either resolve it with high confidence from context, or name it precisely in Section 11 for Arun.

---

## Questions for the BA (explore, specify, and where genuinely unresolvable, escalate)

1. **Grouping unit for a tracked "issue."** What is one issue? Options the BA should weigh and pick
   (or escalate): (a) auto-derived per `(glitch_type, partner)` — matches the existing summary RPC
   exactly, zero curation, but coarse; (b) a manually-curated cluster an operator names and attaches
   instances to — flexible, matches "same underlying root cause," but needs curation UI; (c) hybrid —
   auto `(type, partner)` frequency view stays, plus operator-created named issues for closure/RCA.
   **Recommend and specify one; escalate only if it can't be resolved with high confidence.**

2. **Where does status live — per issue or per instance?** CEO leans per-issue (you close a cause,
   not a symptom). If the BA specs a lighter per-instance-status-only model, justify it against
   Arun's "track *issues* to closure" wording.

3. **RCA mechanism's exact shape** — free-text investigation log + link-related-instances (CEO
   recommendation) vs. structured RCA fields. Resolve from context if possible; otherwise name it
   precisely for Arun.

4. **Glitch-instance identity / migration path.** Confirm the row-per-glitch-instance direction (or a
   defensible alternative) and specify the migration that gives instances stable IDs **without
   regressing** the current capture pipeline or the existing summary/drill-down dashboard.

5. **Purge vs. long-lived issues — real constraint, must be reconciled.** The 30-day purge strips
   glitch *descriptions*. If an issue is tracked over weeks/months, its instance-level evidence
   vanishes at 30 days. The BA must decide and specify one: (a) attaching an instance to a tracked
   issue **exempts** it from purge; (b) the issue record **snapshots** the needed detail before
   purge; (c) accept that closed-out evidence ages out and RCA notes must stand alone. This touches
   *why* the purge exists (the Non-Negotiable Data Boundary). Note: glitch detail is de-identified
   application-behavior data (Clio's own bot behavior), **not** end-user content — so this is a
   lighter governance question than B2B-09's action-item retention was — but it still revises a
   retention behavior Arun's data-boundary policy motivated. **If the chosen answer changes the
   meaning of the 30-day purge, escalate to Arun before finalizing.**

6. **Nav placement** — coordinate the exact internal-admin nav entry with the post-B2B-16
   DashboardShell state (see constraint above). Specify *that* it must be linked and reachable; leave
   *where* to the coordinated outcome, and require the Orchestrator to verify the link resolves to a
   live page before merge.

**Standing gate reminder:** Section 11 (Open Questions) of the Requirement Document must be empty
before this reaches a developer. Any question above that the BA cannot resolve with high confidence
from context must be escalated (BA → CEO → Arun) — not guessed. Per the "spec before build" rule, no
code is written until the full Requirement Document is complete and CEO-approved.

---

## Explicitly Out of Scope

- Fixing the internal-admin role-based-access-control gap (tracked under the Super-Admin backlog
  item; held for Arun's own brainstorm).
- Any partner-facing surface or partner API exposure of glitch status / RCA / tracking.
- Rebuilding glitch capture, the extraction prompt, or the existing frequency analytics.
- AI-assisted glitch clustering, external issue-tracker (Jira/Linear) sync, partner notifications —
  none of these are what Arun asked for; do not add them without a new explicit instruction.

---

## Grounding / Source Files (verified by direct read, 2026-07-17)

- `CORE_OBJECTIVES.md` v3 — Objective 2 step 7 (the mandate), Objectives 3–5 (scope discipline),
  Backlog super-admin item.
- `app/api/admin/glitches/route.ts`, `app/api/admin/glitches/summary/route.ts` — current read-only
  routes and auth gate.
- `supabase/migrations/078_b2b09_session_delivery_glitch_dashboard.sql` — `partner_session_insights`
  table (JSONB `glitches`), `glitch_summary_by_type_and_partner()` RPC, 30-day purge RPC.
- `app/dashboard/admin/glitches/GlitchDashboardClient.tsx`, `.../page.tsx` — current 2-panel UI to
  extend; the 5 glitch types and the Clerk `currentUser()` gate.
- `inngest/partner-session-insights-extractor.ts` — how glitches are created (LLM extraction,
  `PartnerGlitchSchema`, the per-session JSONB write, the purge job). `inngest/hume-action-item-extractor.ts`
  is the sibling legacy extractor referenced by B2B-09.
- `components/dashboard/DashboardShell.tsx` — the internal-admin nav (in flux under parallel B2B-16
  work) that must gain a real entry to this screen.
- `BACKLOG.md` — Super-Admin backlog item (the out-of-scope RBAC gap) + B2B-16 orphan flags.
- `.claude/agents/clio/feature-briefs/B2B-09-session-delivery-glitch-dashboard.md` — origin of the
  current glitch dashboard; the data-boundary/retention reasoning this brief must respect.

---

## CEO Sign-off Posture

This brief is the CEO translation of a direct Arun instruction. It deliberately **does not** pre-decide
the issue-grouping model, the RCA shape, or the purge-reconciliation — those are named as questions
for the BA to resolve or escalate, because getting them wrong produces the wrong tracker. The CEO will
review the BA's Requirement Document against: (a) it preserves existing capture + frequency analytics
with zero regression; (b) status/closure/RCA are genuinely usable to "track to closure," not cosmetic;
(c) the surface stays strictly internal; (d) it builds against the current auth gate without touching
the RBAC gap; (e) the screen is actually reachable; (f) Section 11 is empty.
