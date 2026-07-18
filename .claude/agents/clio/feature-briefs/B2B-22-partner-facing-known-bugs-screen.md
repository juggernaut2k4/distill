# Feature Brief: Partner-Facing "Known Bugs" Screen (per-bug visibility toggle, status + ETA, partner comments/evidence)

**ID:** B2B-22
**From:** CEO Agent (on behalf of Arun)
**To:** Business Analyst Agent
**Priority:** P1
**Date:** 2026-07-18

> **ID note (RESOLVED by Orchestrator, 2026-07-18):** This brief originally claimed `B2B-21` — a
> 4-way parallel collision occurred, since three other briefs were dispatched simultaneously and all
> read `B2B-20` as the highest existing ID. Resolved by actual file mtime order:
> `B2B-21` = Internal Admin Identity (super-admin/sales-partner roles, this brief's hard dependency,
> filed first), `B2B-22` = **this brief**, `B2B-23` = Configurator Milestone Scope Reduction,
> `B2B-24` = Configurator Dashboard/Overview. Renamed from `B2B-21-partner-facing-known-bugs-screen.md`
> to `B2B-22-partner-facing-known-bugs-screen.md` accordingly.

> **⛓️ Hard dependency (metadata):** This feature **cannot be built** until the **Super-Admin /
> sales-partner role system lands — B2B-21**,
> `B2B-21-internal-admin-identity-super-admin-and-sales-partner.md` (ID now bound; it is the
> successor to the `BACKLOG.md` "Super admin page" + "Sales-partner (reseller) system" items, lines
> 75–82). This brief is written now regardless, but **BA/Dev sequencing waits on B2B-21 landing
> first** — specifically, requirement #2 below (who may toggle) has no meaning until the role system
> defines "super-admin" and "sales-partner tagged to a specific partner account." The BA must not
> invent a role model; it consumes B2B-21's role model. If B2B-21's BA spec has not closed when this
> brief's BA picks it up, **that is a blocker to escalate, not to guess around.**

---

## What Arun Said

Verbatim, 2026-07-18, across two messages. This is a **direct, confirmed instruction from Arun** —
the product shape of the toggle and the read-only partner posture are his exact words, not CEO
interpretation.

**Message 1 (the core feature):**

> "you are right, this information about the partner comes to us. if we mark any of the glitch to be
> valid then from my admin or sales-partner id, they can review and mark to inform the partner. when
> they mark it, this will be displayed to the partner in a screen called known bugs with the status
> and eta. we can show them progress and inform them when we complete so the partner gains
> confidence. this should happen only when we enable a toggle. else partner screen - known bugs will
> be empty with only the table headers and a chart of past list of issues (how many open, closed,
> in-progress)"

**Message 2 (clarifying the toggle's scope, when asked):**

> "no we need this toggle for each bug identified and any of the super-admin or sales-partner tagged
> to the specific partner can toggle it. partner can only view it. maybe attach more evidence or
> respond with comments but cannot change the description or status etc"

---

## The Problem Being Solved

Clio already captures its own delivery glitches per partner session, and **B2B-17 (shipped
2026-07-17)** turned that raw glitch log into an **internal issue tracker**: durable tracked issues
(`glitch_issues`) with a status lifecycle and root-cause/investigation notes, backed by stable
per-glitch rows (`glitch_instances`) that each carry a `partner_account_id`. **B2B-17 was explicitly
internal-only — Arun's words then were "stays internal with us," and it deliberately added no
partner-facing surface whatsoever.**

The new problem Arun is solving is a **trust / relationship** one, not a capture one. When Clio
finds and validates a real bug affecting a partner, the partner today has zero visibility — the work
happens invisibly. Arun wants a **controlled, opt-in window** for the partner: *"we can show them
progress and inform them when we complete so the partner gains confidence."*

The design tension Arun himself resolved in advance: this must **not** be an automatic firehose of
every internal glitch. Internal glitches are raw, noisy, and often not partner-actionable; exposing
them wholesale would *destroy* confidence, not build it. So Arun's model is **per-bug, human-gated
exposure**: an internal operator validates a bug, decides it's worth telling this partner about, and
**deliberately toggles that one bug visible**. Until then the partner's Known Bugs screen shows
nothing but headers and an aggregate chart.

**What exists today (verified by direct code read, 2026-07-18):**
- `glitch_issues` — durable tracked issue: `id, title, root_cause_summary, status, created_by,
  resolved_at, created_at, updated_at`. Status vocabulary lives in `lib/glitches/issue-status.ts`:
  `open → investigating → resolved | wont_fix` (reopen → `open`). **No `partner_account_id` column,
  no ETA field, no partner-visibility concept.**
- `glitch_instances` — stable row-per-glitch: `id, partner_session_id, partner_account_id,
  glitch_type, description, ordinal, extracted_at, full_detail_purged_at, issue_id`. **Instances
  carry `partner_account_id`; the issue that groups them does not.**
- `glitch_issue_notes` — append-only, immutable internal investigation log.
- Internal admin surface at `/dashboard/admin/glitches` (`GlitchDashboardClient.tsx`) + the
  `/api/admin/glitches/*` route family (summary, drill-down, issues CRUD, status PATCH, attach,
  detach, notes). All gated only by generic Clerk `requireAuth()` — no real RBAC yet.

**What does not exist, and is exactly what Arun asked for:**
1. **No partner-facing Known Bugs screen at all.** No partner route, no partner API surface for
   glitch/issue data. (B2B-17 forbade one; this brief is the explicit, later instruction that
   authorizes a *narrow, gated* one.)
2. **No per-bug partner-visibility toggle.** Nothing lets an operator mark one specific issue visible
   to one specific partner.
3. **No ETA field** on a tracked issue.
4. **No partner comment / evidence-attachment mechanism.**
5. **No partner-scoped aggregate chart** (open / closed / in-progress counts for a partner's own
   issues).

---

## What Success Looks Like

**For the internal operator (super-admin, or a sales-partner tagged to that partner account):**
1. From the existing internal glitch tracker, they can take a validated tracked issue and **toggle it
   visible to the specific partner it concerns** — a per-issue, per-partner switch.
2. When toggling on (or afterward), they can set/edit an **ETA** the partner will see, alongside the
   issue's **status** (which already moves through B2B-17's lifecycle) and a **partner-safe
   description**.
3. Toggling visibility **off again** removes that bug from the partner's screen without deleting any
   internal tracking.

**For the partner (view-only, in their own Configurator/dashboard area):**
4. A **Known Bugs** screen. When one or more bugs are toggled visible to them, they see a table: each
   visible bug's **partner-safe description, status, and ETA**, updating as Clio makes progress —
   *"we can show them progress and inform them when we complete."*
5. When **no** bug is toggled visible, the table shows **only its headers** (empty state), **plus the
   aggregate chart is still shown** (see the escalation below on exactly what that chart counts).
6. The partner can, on a **visible** bug only, **attach more evidence or respond with comments** —
   and **cannot** change the bug's description, status, or ETA. Read-only on Clio's fields;
   write-only on their own comments/evidence.

**The bar:** the partner gains genuine, real-time confidence that a validated bug is being worked and
will be resolved — without Clio leaking its raw internal glitch stream, its investigation notes, its
root-cause analysis, or (pending the escalation below) the mere existence of bugs Clio chose not to
show them.

---

## Known Constraints (from Arun, from B2B-17, and from the codebase)

**A. Builds on B2B-17 — extend, do not regress or rebuild.**
- This is a **partner-facing extension layered on top of B2B-17's internal tracker.** The internal
  tracker (`/dashboard/admin/glitches`, `glitch_issues`/`glitch_instances`/`glitch_issue_notes`, the
  `/api/admin/glitches/*` routes, the status lifecycle in `lib/glitches/issue-status.ts`) must keep
  working **byte-for-byte unchanged in its existing behavior.** Per the standing "no regression / no
  delete without approval" rule, adding partner visibility must not alter how internal triage,
  status, RCA, capture, or the 30-day purge already work.
- **Reuse the existing status vocabulary.** Do **not** invent a parallel partner status enum.
  B2B-17's lifecycle is `open | investigating | resolved | wont_fix`. Arun's chart language is "open,
  closed, in-progress" — the BA must define a precise, documented **mapping** from the internal
  4-state lifecycle to whatever the partner sees (e.g. `investigating` → "In Progress"; `resolved` +
  `wont_fix` → "Closed"; `open` → "Open"). Decide whether `wont_fix` is even shown to a partner or is
  never partner-visible — a "we won't fix your bug" state may be relationship-sensitive; name it.

**B. The internal / partner-visible field boundary — HARD, name it precisely.**
Only a **narrow, deliberately-authored subset** of an issue is ever partner-visible. The BA must
enumerate this boundary explicitly in the spec. CEO's starting classification:
- **NEVER partner-visible (internal-only, hard boundary):** `glitch_issue_notes` (the whole
  investigation log), `root_cause_summary`, `created_by`, the raw `glitch_instances.description` /
  `partner_session_id` / `ordinal` linkage, and the internal `glitch_type` taxonomy. These are Clio's
  own diagnostic guts and its de-identified application-behavior data — none of it is for partners.
- **Partner-visible candidates only:** **status** (mapped per A), **ETA** (new field), and a
  **partner-safe description**.
- **Load-bearing sub-decision on "description":** B2B-17's `glitch_issues.title` is *operator
  shorthand* — it may contain internal language, partner names, or blunt phrasing never meant for the
  partner's eyes. Per Arun's own product principle ("Role of the user matters — never let a Director
  see CFO framing"), the CEO's strong steer is that the partner-visible description should be a
  **separate, deliberately-authored partner-facing field** the operator writes when toggling visible
  — **not** a raw passthrough of the internal `title`. The BA must confirm this and design it; if it
  instead reuses `title`, that requires explicit justification against the "never leak internal
  framing" principle.

**C. Toggle model — per-bug, human-gated, per-partner.**
- The toggle is **per individual bug (per tracked issue), not a global switch.** Arun was explicit:
  *"we need this toggle for each bug identified."*
- **Default is OFF.** A newly-tracked issue is invisible to the partner until an operator toggles it
  on. The partner's default Known Bugs state is the empty table + chart.
- **Who may toggle:** a **super-admin (any)** or a **sales-partner tagged to that specific partner
  account** — as defined by the sibling role-system brief (the Dependency). The **partner themselves
  can never toggle** (or otherwise change) visibility, status, description, or ETA.

**D. Partner write-surface — narrow and specific.**
- The partner's *only* write capability is **comments and evidence attachments on a visible bug.**
  Everything Clio owns (description, status, ETA) is **read-only** to the partner. Arun: *"partner
  can only view it. maybe attach more evidence or respond with comments but cannot change the
  description or status etc."*
- Comments/evidence must be scoped to **visible bugs only** — a partner cannot comment on (or even
  address) a bug not toggled visible to them.
- File-attachment ("evidence") introduces storage + upload-validation surface not present anywhere in
  the glitch subsystem today. The BA must specify it precisely (allowed types, size cap, storage
  location, virus/DoS considerations) or, if that scope balloons, scope v1 to **text comments only**
  and defer file evidence to a follow-up — flag which.

**E. Auth — consume the sibling role system; do NOT reinvent, do NOT ship on the weak gate.**
- Unlike B2B-17 (which was explicitly told to build against the *current weak* `requireAuth()` gate
  because it was internal-only), **this feature is partner-facing and cross-tenant by nature** — a
  sales-partner tagged to Partner A must be able to toggle A's bugs but not B's, and Partner A must
  see only A's bugs. That is precisely the RBAC the sibling role brief defines. **This feature
  therefore genuinely depends on real role checks** and must not ship on generic Clerk login alone.
  This is the concrete reason for the hard dependency in the metadata.

**F. Reseller *business* mechanics stay frozen.**
- Do **not** build any sales-partner commission, agreement/e-signature, geography/language, or
  reseller-onboarding mechanics. Arun: *"we will brainstorm once the dashboard is complete."* This
  brief consumes only the sales-partner **identity + tagging-to-a-partner-account** primitive from
  the role brief — nothing about how resellers are paid or contracted.

**G. Navigation placement is coordinated, not dictated here.**
- The partner-facing Known Bugs screen needs a **real, reachable entry** in the partner
  Configurator/dashboard area (post-B2B-20 `ConfiguratorSurface.tsx` uses a grouped left-nav:
  *Learning experience / Delivery & integration / Billing* + a pinned Go Live). **Known Bugs is not a
  Configurator "setup" step** — it's an ongoing operational/status view, so it may not belong inside
  the Configurator's step groups at all; it may belong in the broader partner dashboard shell.
- **A separate Dashboard/Overview brief is being written in parallel right now** and will also want
  partner-dashboard nav placement. **Do not design Known Bugs' nav slot in isolation** — the BA must
  coordinate placement with that sibling brief's outcome and the post-B2B-20 surface, and the
  Orchestrator must verify the link resolves to a live page before merge (the B2B-17 audit caught a
  prior nav change that pointed at a dead page — do not repeat that).

**H. Design system + scope discipline.**
- Follow Clio's existing dark-void / purple-accent design language and the App-UI rules (calm
  hierarchy, no AI-slop patterns). **No new colors, typography, or npm dependencies** without written
  justification. For the chart, prefer an approved existing primitive; do not add a charting library
  without justification against the approved list.
- **Do not over-spec pixel-level styling in the requirement doc.** Per the standing governance rule,
  CEO/BA fixes product shape (data, states, interactions, the visibility/field boundary); `/design-review`
  polishes presentation *after* build. Focus the spec on structure, data model, states, and the
  security-sensitive boundaries.
- **Do not expand scope** beyond: per-bug visibility toggle + partner-safe status/ETA/description +
  partner comments/evidence + the aggregate chart + reachable nav. No partner email/SMS
  notifications, no external issue-tracker sync, no AI-generated partner-facing summaries (forbidden:
  never fill a partner-facing screen with speculative AI output), no self-serve partner bug-filing.
  None of these are what Arun asked for.

---

## Design Direction (a starting point for the BA — refine, don't rubber-stamp)

Arun specified the *behavior* precisely but not the *data model*. The CEO's recommended starting
shape, for the BA to pressure-test and fully specify:

**1. The core modeling problem the BA must solve first — issue-to-partner scoping.**
B2B-17's `glitch_issues` has **no `partner_account_id`**. An issue is a grouping of
`glitch_instances`, and *each instance* carries its own `partner_account_id` — so **a single tracked
issue can span instances from multiple partners** (the same class of bug hitting several partners).
Arun's feature is inherently **per-partner**: "displayed to *the* partner," "sales-partner tagged to
*the specific* partner," a Known Bugs screen scoped to one partner's own bugs. These two facts
collide. The BA must resolve, precisely:
- **What is "a bug" from the partner's point of view?** Is it the whole tracked issue, or the
  issue-as-it-pertains-to-this-one-partner? If issue X has instances from Partner A and Partner B,
  and an operator toggles X visible "to A," does B also see it? (It must **not**, by default —
  cross-partner leakage would be a serious data-exposure bug.)
- **Therefore visibility cannot be a single boolean on `glitch_issues`.** CEO's strong steer: model
  visibility as a **per-(issue, partner_account) record** — e.g. a new `glitch_issue_partner_visibility`
  table keyed on `(issue_id, partner_account_id)` carrying `is_visible`, `eta`,
  `partner_facing_description`, `toggled_by`, `toggled_at`. That makes "toggle this bug visible to
  *this* partner" first-class, keeps ETA/description partner-scoped (the same issue could reasonably
  carry a different ETA framing per partner), and structurally prevents one partner from seeing
  another's. The BA should confirm this or propose a defensible alternative — but **must not** ship a
  model where toggling for one partner can expose the bug to another.
- Which partners is a given issue even *eligible* to be shown to? Derive from the distinct
  `partner_account_id`s of its attached `glitch_instances` — an operator can only toggle an issue
  visible to a partner that actually has instances under it. Specify this guard.

**2. ETA field.** A new nullable date (or date-ish) field, partner-scoped (per the visibility record
above). Set at toggle-on time or edited afterward, **only** by a super-admin or the tagged
sales-partner. Define: is it required to toggle visible, or optional (nullable → partner sees
"ETA: TBD")? Is it a date, or a coarser bucket ("this week" / "next release")? CEO leans optional +
concrete date with a graceful "TBD" empty state — resolve precisely.

**3. Status shown to the partner.** Read-only, derived from the issue's existing B2B-17 status via the
documented mapping (Constraint A). The partner sees progress move as Clio advances the internal
status — no separate partner status field to keep in sync.

**4. Partner comments / evidence.** A new append-only, partner-authored record scoped to a
(visible issue, partner_account) — e.g. `glitch_issue_partner_comments`. Visible to internal
operators in the admin surface (so they actually see the partner's added evidence). Mirror B2B-17's
`glitch_issue_notes` append-only/immutable posture. Decide v1 = text-only vs. text + file evidence
(Constraint D).

**5. The partner Known Bugs screen — three states:**
- **Empty (default):** table headers only + the aggregate chart. (This is Arun's explicit empty
  state.)
- **Populated:** a row per visible bug — partner-safe description, mapped status (badge), ETA — each
  expandable to the partner's comment/evidence thread on that bug. Plus the aggregate chart.
- **Detail/interaction:** on a visible bug, the partner can add a comment / attach evidence;
  everything Clio owns is read-only.

**6. The aggregate chart.** "how many open, closed, in-progress," scoped to this partner. **Its exact
data source is the open escalation below** — do not implement it until that is resolved, because it
carries real data-exposure weight.

**7. Internal operator surface for the toggle.** Extend the existing `/dashboard/admin/glitches`
tracker (per B2B-17's "extend, don't rebuild") with: a per-issue "Show to partner" control (with the
per-partner scoping from #1), ETA + partner-facing-description inputs, and a view of the partner's
returned comments/evidence. Do **not** build a second parallel admin surface.

---

## 🔴 Open Escalation — the aggregate-chart data-exposure question (CEO → Arun)

This is the one decision with **real security/privacy weight** and the CEO is **not** resolving it
unilaterally. It is raised here for Arun and named as the lead BA question.

**The question:** When the partner's Known Bugs screen shows the aggregate chart of "open / closed /
in-progress" issues, **does the chart count *all* of that partner's tracked issues (including bugs
never toggled visible), or only the bugs that have been toggled visible to them?**

**Why it matters:** Arun's phrasing — *"a chart of past list of issues (how many open, closed,
in-progress)"* — plausibly reads as *all* issues (numbers only, no detail). But if the chart counts
issues never made visible, the partner learns **how many hidden bugs exist against their account**
even without detail — e.g. "Clio is showing me 1 bug but the chart says I have 9 open." That:
- directly **undercuts Arun's own stated goal** ("so the partner gains confidence") — it invites
  "what are you hiding?" and erodes trust rather than building it;
- creates a **data-exposure surface** (a count is still information about Clio's internal quality
  posture toward that partner) that a real enterprise security review will probe;
- is in tension with the whole **human-gated, per-bug** design Arun deliberately chose.

**Options:**
- **(a) Chart counts only ever-toggled-visible bugs** — the chart and table are always consistent;
  the partner never infers hidden bugs. *(CEO recommendation.)*
- **(b) Chart counts all of the partner's tracked issues** (visible + hidden), numbers only, no
  detail — matches the most literal reading of Arun's words, but exposes hidden-bug counts.
- **(c) Hybrid** — e.g. chart counts only visible bugs' lifecycle states, but the historical "past
  list" framing is satisfied by including *previously-visible, now-closed* bugs (never counts
  never-visible ones).

**CEO recommendation:** **Option (a)** — the aggregate chart counts **only bugs that are (or have
been) toggled visible to that partner.** This keeps the chart perfectly consistent with the gated,
confidence-building intent, leaks no hidden-bug counts, and still gives Arun the "chart of past
issues, how many open/closed/in-progress" he asked for — computed over the set the partner is
actually allowed to know about.

**But this reinterprets Arun's literal "past list of issues" and it's a privacy call, so:**

```
🔴 CEO ESCALATION — NEEDS ARUN'S DECISION

Context: Building the partner-facing "Known Bugs" screen (B2B-22). Per your instruction, when no bug
is toggled visible the screen shows empty table headers plus a chart of past issues (open / closed /
in-progress).

Blocker: Should that aggregate chart count ALL of a partner's tracked bugs — including ones we never
toggled visible to them — or ONLY the bugs we've chosen to show them? Counting hidden bugs would let a
partner infer "Clio has N bugs on my account it isn't showing me," which is a data-exposure decision
and cuts against the "gain confidence" goal.

Options considered:
  (a) Chart counts only ever-visible bugs — chart always matches the table, no hidden-count leak.
  (b) Chart counts all the partner's bugs (numbers only, no detail) — most literal reading of your words.
  (c) Hybrid — count visible + previously-visible-now-closed, never never-visible ones.

Recommendation: Option (a). It gives you the open/closed/in-progress chart you asked for, keeps the
partner's confidence intact, and leaks no hidden-bug counts — which a partner security review will test.

Please confirm (a), or tell us you want (b)/(c), so the BA can finalize the chart's data source.
```

> **✅ RESOLVED by Arun, 2026-07-18:** *"only the bugs tagged for the partner should be consider for
> the display and charts. for superadmin and sales partners - they should see all bugs."*
>
> Confirms **Option (a)** for the partner-facing screen: the table and the aggregate chart both scope
> to only bugs toggled visible to (tagged for) that partner — never counts hidden bugs, matching the
> CEO recommendation exactly.
>
> **Also resolves an adjacent point the escalation didn't explicitly ask, stated for completeness:**
> the **internal** super-admin/sales-partner view (where the toggle itself lives, per requirement #2)
> is a **different, unscoped view** — it shows **all** bugs for a partner, visible or not, since
> internal roles are the ones deciding what to make visible in the first place. The partner-only
> visible-scoping applies strictly to the partner's own screen. The BA must build two distinct read
> paths (partner-scoped vs. internal-unscoped), not one shared query with a role-based filter bolted
> on as an afterthought — the internal view's "all bugs" requirement was already implied by requirement
> #2 (super-admin/sales-partner toggle each bug) but is now explicit and non-negotiable.
>
> **Section 11 blocker on the chart's data source is now CLOSED.** The internal-vs-partner scoping
> distinction is a new, explicit BA requirement (see Questions for the BA, updated below).

The BA can now fully specify the chart's data source (Option a, partner-scoped) and the internal
management view (unscoped, all bugs) — nothing in this brief is blocked on Arun's answer any longer,
only on B2B-21 landing (the role-model dependency, unchanged).

---

## Questions for the BA (explore, specify, and where genuinely unresolvable, escalate)

1. **Aggregate-chart counting scope — RESOLVED (see Section 8 resolution).** Partner-facing chart:
   only visible/tagged bugs. Internal super-admin/sales-partner view: all bugs, unscoped. Spec both
   as distinct read paths.
2. **Issue-to-partner scoping model** (Design #1) — how visibility is modeled so it is strictly
   per-partner and a multi-partner issue toggled for one partner never leaks to another. Recommend
   and fully specify the schema (CEO leans a `(issue_id, partner_account_id)` visibility table).
3. **Status mapping** — the exact, documented map from B2B-17's `open|investigating|resolved|wont_fix`
   to the partner-visible "open / in-progress / closed" vocabulary, including **whether `wont_fix` is
   ever partner-visible** (relationship-sensitive).
4. **Partner-visible "description"** — separate operator-authored partner-facing field (CEO
   recommendation) vs. reusing internal `title`. Resolve against the "never leak internal framing"
   principle.
5. **ETA field shape** — required vs. optional, exact type (date vs. coarse bucket), empty-state
   ("TBD"), who can edit and when.
6. **Comments/evidence scope for v1** — text-only vs. text + file evidence. If files: allowed types,
   size cap, storage, upload validation, abuse/DoS. If that balloons, scope v1 to text and defer
   files (flag it).
7. **Field boundary enumeration** (Constraint B) — the complete, explicit list of internal-only vs.
   partner-visible fields, written into the spec, so the partner API can be built to expose *only*
   the whitelisted set and nothing else.
8. **Toggle eligibility guard** — confirm an operator can only toggle an issue visible to a partner
   that actually has `glitch_instances` under that issue for that `partner_account_id`.
9. **Auth binding** — consume the sibling role brief's definitions of "super-admin" and "sales-partner
   tagged to partner account X"; specify exactly which role checks gate the toggle route, the
   ETA/description edit route, and the partner read/comment routes. **If the role brief hasn't landed,
   this is a blocker to escalate — not to guess.**
10. **Nav placement** (Constraint G) — coordinate with the parallel Dashboard/Overview brief and the
    post-B2B-20 surface; specify *that* it must be reachable and require the Orchestrator to verify a
    live link before merge; leave *where* to the coordinated outcome.

**Standing gate reminder:** Section 11 (Open Questions) of the Requirement Document must be **empty**
before this reaches a developer. Q1 (the chart escalation) and Q9 (the role dependency) are the two
that structurally cannot be closed by the BA alone — they require Arun's answer and the sibling
brief landing, respectively. Per the "spec before build" rule, no code is written until the full
Requirement Document is complete and CEO-approved, **and** the Super-Admin/sales-partner role system
has landed.

---

## Explicitly Out of Scope

- **Any change to B2B-17's internal tracker behavior**, its capture pipeline, its status lifecycle,
  its RCA/notes, or its 30-day purge. This brief only *reads from* and *adds a visibility/comment
  layer on top of* that data.
- **Exposing any internal-only field** to the partner — investigation notes, `root_cause_summary`,
  `created_by`, raw instance descriptions, session linkage, internal glitch taxonomy. Never.
- **Fixing the internal-admin RBAC gap in general** (that is the sibling role brief's job; this brief
  *consumes* the new roles, it does not define them).
- **Any sales-partner business mechanics** — commission, agreements/e-signature, reseller onboarding,
  geography/language. Frozen until Arun's dashboard-complete brainstorm.
- **Partner notifications** (email/SMS/push), **external issue-tracker sync**, **AI-generated
  partner-facing summaries**, **self-serve partner bug-filing** — none were requested; do not add.

---

## Grounding / Source Files (verified by direct read, 2026-07-18)

- `.claude/agents/clio/feature-briefs/B2B-17-glitch-log-to-issue-tracker.md` — the internal tracker
  this extends; its internal-only mandate and reuse discipline.
- `supabase/migrations/082_b2b17_glitch_issue_tracker.sql` — `glitch_issues` (no `partner_account_id`,
  no ETA, no visibility), `glitch_instances` (carries `partner_account_id`), `glitch_issue_notes`
  (internal, append-only), the fan-out trigger, and the purge RPC. **The `glitch_issues`-has-no-
  partner-column fact that drives Design #1 comes straight from this file.**
- `lib/glitches/issue-status.ts` — the authoritative status lifecycle
  (`open|investigating|resolved|wont_fix`) the partner-visible status must map from; reuse, don't fork.
- `app/api/admin/glitches/route.ts` + `app/api/admin/glitches/issues/**` (route, `[id]`, `attach`,
  `detach`, `notes`) — the existing internal API family; the partner API is a *new, separate,
  whitelist-only* surface, not an extension of these.
- `app/dashboard/admin/glitches/GlitchDashboardClient.tsx` + `page.tsx` — the internal operator
  surface to *extend* with the toggle/ETA/partner-description/partner-comment-view controls.
- `app/dashboard/configurator/ConfiguratorSurface.tsx` (post-B2B-20 grouped left-nav) + the partner
  `app/dashboard/` shell — the partner-facing area where Known Bugs needs a reachable, coordinated
  nav slot (note: Known Bugs is an operational view, likely *not* a Configurator setup step).
- `BACKLOG.md` lines 75–82 — the "Super admin page" + "Sales-partner (reseller) system" items that
  the sibling role brief (this brief's hard dependency) supersedes.
- `docs/b2b-pivot-status.md` — Live Status; the parallel Dashboard/Overview and role-system briefs to
  coordinate with.

---

## CEO Sign-off Posture

This brief is the CEO translation of a direct Arun instruction, captured verbatim across two messages
so the read-only partner posture and the per-bug human-gated toggle — both Arun's exact words — are
preserved literally, not interpreted. It deliberately **does not** pre-decide the aggregate-chart
counting scope (escalated to Arun, real privacy weight) or the issue-to-partner visibility schema
(named for the BA, because the `glitch_issues`-has-no-partner-column reality makes a naïve boolean
toggle a cross-partner data-leak). The CEO will review the BA's Requirement Document against:
(a) B2B-17's internal tracker and its internal-only data boundary are preserved with zero regression;
(b) the internal/partner field boundary is enumerated explicitly and the partner API exposes only the
whitelisted subset (status + ETA + partner-safe description) — never notes/RCA/raw instances;
(c) visibility is strictly per-partner with no cross-partner leakage path;
(d) the partner is genuinely read-only on Clio's fields and write-only on their own comments/evidence;
(e) auth is bound to the real super-admin/sales-partner role system, not the weak internal gate;
(f) the screen is actually reachable via a coordinated, verified nav link;
(g) Q1 (chart) is answered by Arun and Q9 (roles) is unblocked by the sibling brief landing;
(h) Section 11 is empty.
