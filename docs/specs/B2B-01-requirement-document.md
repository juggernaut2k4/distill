# B2B-01 — Core Objectives Rewrite
# Requirement Document

Version: 1.0
Status: CEO REVIEW
Author: Business Analyst Agent
Date: 2026-07-13

Source Feature Brief: `.claude/agents/clio/feature-briefs/B2B-01-core-objectives-rewrite.md`
Authoritative source material: `docs/brainstorm-b2b-platform-pivot.md` (all sections read in full,
Section 3 used as primary input per the Feature Brief's instruction), `docs/b2b-pivot-status.md`
(current pivot status, read for context on F-01/F-02 and sequencing)

---

## Template Adaptation Note

This is a strategy/objectives document, not a UI feature, per the Feature Brief's own framing
(Question 2). The standard 12-section template is built for screen-by-screen UI specs. Sections
below are kept in the standard order and numbering for consistency with every other spec in
`docs/specs/`, but several are adapted rather than force-fit:

- **Section 5 (Visual Examples)** is marked N/A — there are no screens or wireframes. The
  equivalent rigor is carried by the "reference test" example embedded in Objective 2 (Section 4),
  matching the original 2026-06-07 document's own convention.
- **Section 6 (Data Requirements)** is adapted — this artifact is a markdown file, not a runtime
  feature; the section instead states what the document must *not* assert (no DB schema, no API
  contract) to avoid contradicting B2B-02's forthcoming architecture output.
- **Sections 4, 7, 9, 10, 12** apply directly and are treated as first-class, not diminished by the
  adaptation — Section 4 in particular contains the full literal text to be committed as
  `CORE_OBJECTIVES.md`, so that whoever commits it does so with zero interpretation required.

---

## 1. Purpose

`CORE_OBJECTIVES.md` (v1.0, approved 2026-06-07) described a B2C, Clio-owned, single-tenant,
direct-to-executive product: Clio as system of record for a persistent per-user profile, individual
sign-up, scheduled daily delivery, gamified engagement. That product is retired. The file itself was
deleted 2026-07-13 as stale B2C content. Since then, there has been no single settled statement of
what Clio's objectives are under the B2B/B2B2C pivot — only a brainstorm document (`docs/
brainstorm-b2b-platform-pivot.md`) that captures the analysis but was never intended to be the
build-time reference (its own status line says "no CORE_OBJECTIVES.md rewrite... made yet").

**Failure without this document:** every downstream Feature Brief (B2B-02 Partner API, B2B-03
Designer/Configurator, B2B-04 Billing, B2B-05 Domain infra) needs an unambiguous, single-source
answer to questions like "does Clio store this," "who owns personalization," and "what must the API
guarantee." Without a settled objectives document, different CEO/BA/Developer agents drafting those
four briefs could each infer different answers from the brainstorm doc independently, producing
contradictory specs that surface as conflicts only after code is written.

This document specifies the exact content of the replacement artifact and the acceptance criteria
by which its completeness and correctness can be judged.

## 2. User Story

This document has no end-user-facing reader; its readers are the agents and people who build and
validate Clio.

**Story 1 — CEO Agent drafting B2B-02 through B2B-05**
As the CEO Agent scoping a downstream Feature Brief,
I want a single settled objectives document to check every product decision against,
So that I don't inadvertently propose something that resurrects a killed B2C surface or violates the
data-ownership boundary.

**Story 2 — BA Agent writing a downstream Requirement Document**
As the Business Analyst Agent writing the B2B-02/03/04/05 spec,
I want falsifiable, testable statements of each objective,
So that I can write acceptance criteria that are actually checkable, not just aspirational language.

**Story 3 — Developer/QA Agent validating a build**
As a developer or QA agent evaluating whether a shipped feature is correct,
I want a concrete test case per objective,
So that I can determine pass/fail without having to interpret intent.

**Story 4 — Orchestrator resuming work after a context gap**
As the Orchestrator picking this project back up in a new session,
I want the hard premise (B2C killed) stated unambiguously at the top,
So that I don't need to infer current product direction from git history or partial memory.

## 3. Trigger / Entry Point

Not a runtime trigger — a reference document. Entry points are:

- **Location:** repo root, filename `CORE_OBJECTIVES.md` — same name and location as the retired
  v1.0 document. Confirmed rather than proposing an alternative (Feature Brief Question 1): the
  pivot doesn't change *that* Clio has core objectives, only what they say, and `docs/
  b2b-pivot-status.md` (line 8) already forward-references this exact filename as what B2B-01
  produces. A different name would break that existing reference and offers no benefit — "core
  objectives" is not inherently B2C-era naming; the *content* was.
- **Read by:** `CLAUDE.md` does not currently name this file explicitly as mandatory first-read
  (it names `docs/b2b-pivot-status.md` and `BACKLOG.md`), but every CEO Feature Brief and BA
  Requirement Document for B2B-02 through B2B-05 must read it before drafting, per this document's
  own Dependencies (Section 12).
- **State required:** none — this is a static reference, not a stateful flow.

## 4. Document Content Requirements

This section is the literal, complete text to be committed as `CORE_OBJECTIVES.md` at the repo
root, replacing the deleted v1.0. It supersedes the version-1.0 document (approved 2026-06-07,
deleted 2026-07-13). Commit verbatim below the horizontal rule — the `[APPROVAL DATE]` placeholder
is the only value to fill in, on the date the CEO Agent approves this Requirement Document.

---

```markdown
# Clio — Core Business Objectives

Version: 2.0 | Owner: Arun | Date: [APPROVAL DATE]
Status: APPROVED — referenced at every Feature Brief, every sprint review, every build validation
Supersedes: v1.0 (approved 2026-06-07, deleted 2026-07-13 — described a Clio-owned, single-tenant,
direct-to-executive B2C product that no longer exists)

> These are non-negotiable product principles under the B2B/B2B2C pivot. Every Feature Brief, every
> build, every sprint must be validated against these. A build that breaks any of these is not
> shippable.

---

## Hard Premise: B2C Is Killed

Clio's original B2C product — self-serve individual sign-up, a consumer landing page and pricing
page, gamified engagement (AI Readiness Score, streak counter), scheduled daily SMS/email delivery
via Twilio/Resend cron jobs, and Clerk-per-executive authentication as the primary product entry
point — is **retired, not paused, and not a parallel channel.**

This is a hard premise, not a hedge:

- No agent may resurrect any B2C surface, copy, flow, or schema (landing page, pricing page,
  onboarding-as-signup, gamification, SMS/Twilio, cron-scheduled daily delivery, individual Clerk
  accounts as end-user identity) by inferring intent from git history, `archive/b2c-legacy`, or
  prior sessions.
- Resurrecting any B2C surface requires a new, explicit instruction from Arun — not inference, not
  "it seemed useful," not silence read as permission.
- Infrastructure originally built for B2C that is reused under the new model (the Recall.ai/Attendee
  live meeting bot, Hume voice, the async content-generation pipeline, the template-review admin
  tool) is reused because it is genuinely infrastructure, not because B2C is coming back.

## What Clio Is Now

Clio is a B2B/B2B2C AI narration and integration layer for partner learning platforms. Clio does not
compete with platforms like Pluralsight, Domestika, or Coursera for individual executive users — it
plugs into them via API. Clio's AI joins a live meeting (via Recall.ai/Attendee), walks a user
through content, and narrates/explains it in that person's own terms — a capability those platforms
don't have natively.

Two partner archetypes are equally first-class instances of success. Neither is the default and
neither is a special case:

| Archetype | Example | Shape |
|---|---|---|
| **Platform Partner** | Pluralsight | Already has users, topics, and content. Wants Clio's AI to narrate its *existing* content live and answer questions. Billed by voice-minutes only. |
| **No-Platform Partner** | Capgemini | Has no existing learning platform. Uses Clio's Designer/Configurator to build one from scratch (questionnaire, topics, content, visualization, white-label domain). Billed by voice-minutes + LLM-generation-call count. |

Both partner types configure the same one flexible API via toggles — these are not two separate
products or capability tiers.

A partner (e.g. Capgemini) may extend its own credit allowance to its own downstream clients (e.g.
Hartford Insurance) as a sub-tenant. Those sub-tenants experience the product as the partner's own —
no Clio branding, no Designer access. Clio sees only a single rollup usage line per top-level
partner account; sub-tenant identity is opaque to Clio and entirely the partner's own concern.

## The Non-Negotiable Data Boundary

**Clio computes signal. Clio never becomes the system of record for partner or end-user data.**

The sole exception: Clio retains de-identified interaction transcripts, for its own
quality-improvement and prompt-tuning purposes only. These transcripts carry no user-identifying
information.

Everything else — end-user identity, learning profile, generated content, session history — is
either:

- Never stored by Clio at all (the default), or
- Computed by Clio and pushed to the partner's own database via the partner's API, opt-in per
  partner via a configuration toggle. If a partner enables the toggle, Clio pulls the data back via
  the partner's API at the start of each relevant session. If disabled, everything is purely
  session-scoped with no cross-session continuity.

This statement holds regardless of how the still-open question of whether Clio additionally keeps
an opaque-reference usage ledger for its own billing/dashboard purposes, or computes those numbers
live via round-trips to partner APIs, is eventually resolved — neither resolution stores partner or
end-user *identity, content, or profile* as Clio's system of record. That resolution is a
billing/dashboard implementation detail for later Feature Briefs, not a data-boundary exception.

---

## The Six Objectives

### Objective 1 — The User Learning Profile Is the Intelligence Layer
**Status: MODIFIED, survives.**

Clio still computes a structured, multi-dimensional learning profile per user (knowledge,
intellectual, psychological/motivation, and business-focus-lens dimensions — the same conceptual
structure as before) from de-identified session transcripts. What changes: Clio never owns storage
of that profile. Storage is delegated to the partner, opt-in per partner via a configuration toggle,
and fetched back via the partner's API at the start of every session where the toggle is enabled.

If a partner never enables the toggle, there is no cross-session profile continuity for their users
at all — every session is purely session-scoped, computed and used once, then discarded by Clio.
This is a fully legitimate, supported configuration, not a degraded one.

**Falsifiable test case:** A partner with the profile-storage toggle OFF gets a session where Clio
behaves as if it remembered the user from a prior session (e.g. skips a concept it "shouldn't know"
was already covered, or references a prior session by name). This is a violation — with the toggle
off, Clio must have no memory of the user across sessions.

### Objective 2 — Speak the User's Language
**Status: MODIFIED, survives, mechanism shifts.**

Personalization no longer happens by generating a different script text per user ahead of time. It
happens live, at explanation time: Hume's system prompt is instructed to check for a fetched user
profile (per Objective 1) and, if present, explain the same underlying (fixed, reused) content using
that person's vocabulary, reasoning style, and business-focus lens. If no profile is available —
either because the partner's toggle is off, or because this is the user's first session with no
signal yet — Hume explains generically from the content alone and still answers questions live.

**The reference test — same concept, two profile states, two different explanations.** Take any
concept in a piece of partner content (e.g. "hallucination risk" in an AI-literacy topic) and verify
Clio's live narration is genuinely different for:

- **A user with a fetched profile indicating a risk/compliance business lens and technical
  vocabulary:** narration should frame the concept in terms of governance, audit trail, and "under
  what conditions does this fail" — using the user's own domain terms if present in the profile.
- **A user with no profile available (toggle off, or first session):** narration should explain the
  same concept generically and correctly, without inventing a persona or lens the profile didn't
  actually establish.

Same underlying content object in both cases. If the narration sounds identical regardless of
profile presence, or if Clio fabricates personalization it has no signal for, Objective 2 is
failing.

**Falsifiable test case:** Two sessions on the same partner+topic content, one with a fetched
profile and one without, produce narration that is either (a) identical regardless of profile
presence, or (b) personalized in the no-profile case using signal Clio could not actually have had.
Either is a violation.

### Objective 3 — Content Static, Script + Visualization Adaptive
**Status: MODIFIED, survives, converges with the (paused) Template Designer thread.**

"Static" content generation becomes stronger than originally conceived: content is generated once
per partner+topic (via the Designer, for No-Platform partners; or supplied directly by the partner,
for Platform partners), approved by the partner, pushed to the partner's own database, and reused
across every session on that topic for that partner's users — never regenerated per individual end
user. "Adaptive" moves entirely into Objective 2's live-narration mechanism rather than being baked
into pre-generated script text per user.

Partner customization of how content renders happens via a 3-level configuration model:

- **Application/product level** — global theme, layout choices.
- **Template level** — properties common to every instance of a given content template.
- **Component/container level** — per-element styling and behavior.

This objective describes *what* that customization model must achieve (partner-configurable
rendering of reused, once-generated content) — it does not commit to which specific effort formally
owns building the mechanism. Whether that is the paused AI Template Designer brainstorm resumed
as-is, folded into a later Feature Brief as new scope, or some other implementation is a scoping
decision for that later brief, made separately from this objective.

**Falsifiable test case:** The same generated content item, rendered for two different partners with
different visualization configurations, is identical in ways their configured properties should
have differentiated (e.g. both partners configured different container-level styling but the
rendered output ignores it). Also a violation: content is regenerated per individual end user rather
than reused across all sessions on that partner+topic.

### Objective 4 — Smart Topic Delta
**Status: LARGELY UNCHANGED.**

The bridging/delta logic (pre-selecting existing topic interests, scoped deletion of removed-topic
sessions, queue-promotion to fill freed slots, bridging sessions generated when a topic is added) is
unaffected by the pivot. What changes is exposure: this is now an optional, toggle-gated capability
a partner can invoke via API (e.g. a Platform Partner sending an updated topic list) rather than the
only path an end user experiences directly inside a Clio-owned UI.

**Falsifiable test case:** A partner sends an updated topic list via API (add C, keep A, remove B)
and the resulting session set does not reflect scoped deletion of B's sessions, promotion of A's
queued sessions, and bridging-session generation for C — the same behavior the original delta logic
guaranteed, just triggered by a partner API call instead of a direct user action.

### Objective 5 — Just-in-Time Personalization via Profile, Not Just-in-Time Generation
**Status: LARGELY UNCHANGED, recontextualized.**

The async background-generation pipeline (SubtopicOutline → Visualization + Script generated in
parallel, ready before use rather than generated live during a session) holds as-is. What changes:
the trigger moves from a personal daily cron to a partner-initiated session/API call, and the
destination moves from "ready in Clio's own dashboard before the user clicks Start" to "pushed to
the partner's database, pulled back by Clio at render time." Nothing is generated live during a
meeting, in either the old or new model.

**Falsifiable test case:** A user's session start is observably blocked on live content generation
(visualization or script generated synchronously during the call rather than pre-generated and
pulled from the partner's database ahead of time). This is a violation regardless of which trigger
initiated the pipeline.

### Objective 6 — API Is the Integration Layer, UI Is a Display Layer
**Status: BECOMES THE CORE OF THE BUSINESS MODEL.**

> "No feature is complete until it is fully accessible through the API. UI renders what the API
> returns. Nothing else."

This was an internal architecture principle under the B2C product. Under the pivot, it is no longer
background architecture — it is the product itself. Every data flow (content push/pull, profile
push/pull, usage/webhook events) is API-mediated, with zero Clio-side persistence of partner or
end-user data except de-identified transcripts (see "The Non-Negotiable Data Boundary" above).

This objective now requires dimensions it did not need under the B2C model:

- **Partner-level API keys** — trust boundaries are per-partner-account, not per-individual-user-JWT.
- **Usage-metering hooks** — every billable event (voice-minutes, LLM-generation calls) is
  API-observable, feeding both billing and the partner's own dashboard.
- **White-label rendering** under a partner's own domain, with no Clio branding visible to end users
  of a No-Platform partner's portal.
- **Two-tier account hierarchy** for sub-tenant delegation (e.g. Capgemini → Hartford), where Clio
  sees only a rollup line per top-level partner.

**Falsifiable test case:** Any feature or data flow that can only be exercised through Clio's own
UI, with no equivalent partner-facing API path producing the same result, violates this objective —
the UI (Designer/Configurator, admin dashboard) must be a client of the API, never a required path.

---

## How the Objectives Apply to Each Partner Archetype

Neither archetype is the default case the objectives were written for — both must hold, with the
same objective realized through a different mechanism:

| Objective | Platform Partner (e.g. Pluralsight) | No-Platform Partner (e.g. Capgemini) |
|---|---|---|
| 1 — Profile | Optional signal the partner already has (wishlist, completed courses) can seed the profile if the partner opts in; otherwise purely session-scoped, same as any partner with the toggle off | Profile computed by Clio from its own sessions |
| 2 — Language | Narration adapts live to a fetched profile if available; otherwise generic — identical mechanism | Same mechanism |
| 3 — Content | Content authored once by the partner, not regenerated by Clio, reused across sessions — satisfies "generated once, reused" via partner authorship instead of Clio generation | Content generated once via the Designer, partner-approved, reused |
| 4 — Topic delta | Optional, invoked if the partner sends updated topic lists via API | Optional, invoked via the same API or the Designer's topic toggle |
| 5 — Background prep | The partner's existing content is converted into Clio's walkthrough-ready paginated format ahead of session time, not live during the call | Visualization/script generated ahead of session time via the async pipeline |
| 6 — API-first | The entire integration is a single API call triggered by a button in the partner's own UI | The entire Designer/Configurator and end-user flow is API-mediated end to end |

---

## Out of Scope for This Document

This document states objectives only. It does not specify:

- The partner API request/response contract
- Designer/Configurator UI requirements
- Billing rate tables, credit-wallet mechanics, or tier pricing
- Domain/white-label infrastructure
- Resolution of the open ledger-storage question or COGS-derived burn rates
- Which specific effort formally owns building Objective 3's 3-level configuration mechanism

Each of the above is scoped to a separately sequenced Feature Brief.
```

---

**End of literal `CORE_OBJECTIVES.md` content.**

**Rationale for what was intentionally NOT carried forward from v1.0** (for CEO review — this is not
a gap, it's a deliberate scoping choice): the original document mixed objectives with
implementation-level detail — DB column names (`topic_id`, `exposure_count`, `vocab_fingerprint`
JSONB shape), a "Profile Confidence Model" tier table, a session-token-model architecture diagram,
and a line-item "Build Validation Checklist." That granularity is exactly what made the old document
read as B2C-era and Clio-storage-assuming. Under the new data boundary, Clio may not even be the
system that stores those fields going forward (partner-delegated storage, per the toggle). Re-stating
DB-column-level detail here would either (a) contradict or pre-empt B2B-02's forthcoming schema
design, or (b) require silent revision the moment B2B-02 lands — both undesirable. The new document
keeps the *conceptual* structure (four profile dimensions, confidence-building-over-time as a
narrative idea) without asserting schema, matching the Feature Brief's Known Constraints ("no
architecture.md exists yet... schema decisions live in the relevant BA spec" — B2B-02's, not this
one's).

## 5. Visual Examples

N/A. This is a markdown reference document with no screens, wireframes, or UI states. The
equivalent illustrative rigor is carried by the "reference test" example embedded in Objective 2
above (same convention the original 2026-06-07 document used for its own Objective 2).

## 6. Data Requirements

N/A in the standard sense (no database reads/writes, no API calls, no localStorage) — this artifact
is a static markdown file at the repo root.

What this section instead constrains, per the Feature Brief's Known Constraints: the document's
content (Section 4) must not assert specific database schema, table/column names, or an API request
contract, since no architecture document exists yet for the pivot and those decisions belong to
B2B-02. The literal content in Section 4 was checked against this constraint — it references
"a structured, multi-dimensional learning profile" and "the four dimensions" only in conceptual
terms, never as column-level schema.

## 7. Success Criteria (Acceptance Tests)

✓ Given the repo root, when a developer or agent looks for the current core-objectives reference,
then a file named `CORE_OBJECTIVES.md` exists at the repo root, matching Section 4 of this document
verbatim, with `[APPROVAL DATE]` replaced by the actual CEO approval date.

✓ Given any future B2B-02 through B2B-05 Feature Brief is drafted, when the CEO or BA Agent reads
`CORE_OBJECTIVES.md`'s "Hard Premise: B2C Is Killed" section, then no B2C surface (landing page,
gamification, SMS/Twilio, cron delivery, individual Clerk accounts) is proposed in that brief without
an explicit new instruction from Arun quoted directly in the brief.

✓ Given a developer or QA agent evaluates a build against Objective 1, when a partner has the
profile-storage toggle OFF, then the Objective 1 falsifiable test case is directly checkable by
inspecting session narration for any of the disallowed "remembers me" behaviors described in that
objective.

✓ Given the open ledger-storage question (tracked as F-01 in `docs/b2b-pivot-status.md`) is later
resolved in either direction, when re-reading "The Non-Negotiable Data Boundary" section, then no
edit to `CORE_OBJECTIVES.md` is required — the statement is written to hold under both resolutions.

✓ Given the paused Template Designer brainstorm is later formally assigned to Objective 3's
mechanism or built as separate new scope, when re-reading Objective 3, then no edit to
`CORE_OBJECTIVES.md` is required — mechanism ownership is explicitly out of scope for this document.

✓ Given a Platform Partner (Pluralsight-style) build is evaluated against all six objectives, and
separately a No-Platform Partner (Capgemini-style) build is evaluated against all six objectives,
then neither evaluation finds any objective marked N/A or non-applicable in the archetype-mapping
table — every objective has a legitimate, non-N/A instantiation for both archetypes.

✓ Given `CORE_OBJECTIVES.md` is committed to the repo root, when `docs/b2b-pivot-status.md`'s Live
Status table is next checked, then B2B-01's row is updated to `Done` with a reference to this
Requirement Document and the commit, per the Orchestrator's standing "update the instant it changes"
rule — this is a completion criterion for whoever lands the change, not a claim about the document's
own content.

## 8. Error States

Adapted for a reference document — there are no runtime failures, but there are process failure
modes:

- **If a downstream Feature Brief (B2B-02..05) appears to need this document to state something it
  doesn't cover** (e.g., a specific schema decision, a specific billing rate): the correct behavior
  is to escalate to the CEO Agent / Arun for a brief-level decision in that brief's own spec — never
  to silently amend `CORE_OBJECTIVES.md` outside the CEO → BA → approval chain just to unblock a
  downstream brief.
- **If an agent is unsure whether a piece of reused infrastructure counts as "genuine infrastructure
  reuse" or "B2C resurrection"** (the distinction the Hard Premise section draws): default to
  treating it as resurrection and escalate/ask, rather than building on the assumption it's fine.
- **If CEO review requests changes to this Requirement Document:** it returns to `DRAFT` status.
  The literal content in Section 4 is not committed as `CORE_OBJECTIVES.md` until the document is
  re-approved with the requested changes incorporated.

## 9. Edge Cases

- **A partner never enables the profile-storage toggle at all** (any partner, either archetype): no
  cross-session continuity ever exists for that partner's users. Covered explicitly in Objective 1;
  this is a fully supported, non-degraded configuration, not an edge case to special-case around.
- **A partner is simultaneously a Platform Partner for some content and requests Designer-built
  content for other topics** (a hybrid case not explicitly named in the source brainstorm): the
  objectives as written support this without modification — Objective 3's per-partner-per-topic
  framing ("content generated once per partner+topic... or supplied directly") already allows the
  authorship source to vary topic-by-topic within one partner account. No open question results from
  this because the objective language was deliberately written at the partner+topic granularity, not
  the whole-partner granularity.
- **A Capgemini-style partner extends credit to a sub-tenant (Hartford) that itself behaves like a
  Platform Partner** (brings its own existing content): the two-tier account hierarchy in Objective 6
  and the archetype table in Section 4 do not preclude this — Clio's rollup-only visibility into
  sub-tenants means this composition is invisible to Clio regardless, so no additional objective
  language is needed.
- **An agent attempts to resurrect a B2C surface citing "it's just for testing" or "temporary":** the
  Hard Premise section explicitly closes this — resurrection requires a new explicit instruction from
  Arun, with no carve-out for testing/temporary framing.
- **The two currently-open items (F-01 ledger model, Template Designer ownership) get resolved after
  this document ships:** by design (Section 4's explicit statements and Section 7's acceptance
  criteria #4 and #5), neither resolution requires editing `CORE_OBJECTIVES.md`. This was verified
  during drafting, not assumed.

## 10. Out of Scope

- The partner API request/response contract (belongs to B2B-02)
- Designer/Configurator UI requirements (belongs to B2B-03)
- Billing rate tables, credit-wallet mechanics, or tier pricing (belongs to B2B-04)
- Domain/white-label infrastructure (belongs to B2B-05)
- Resolving F-01 (ledger storage model) or F-02 (COGS-derived burn rates) — this document is written
  to be correct regardless of how they resolve, not to resolve them
- Assigning ownership of Objective 3's 3-level configuration mechanism to a specific brainstorm
  thread or Feature Brief
- Any DB schema, table, or column definition (belongs to B2B-02's architecture output)
- Migration or disposition of any existing B2C data or signed-up users, if any exist (an operational
  detail per the brainstorm doc's own Section 5, item 4 — not an objectives-level question)

## 11. Open Questions

None.

Both items the Feature Brief flagged as explicitly not-yet-decided by Arun (F-01 ledger storage
model; whether the paused Template Designer brainstorm formally becomes Objective 3's mechanism)
were written around at the principle level per the Feature Brief's own instruction, and verified in
Section 7 (acceptance criteria #4, #5) and Section 9 (edge cases) to hold correctly under either
future resolution — they are not open questions blocking this spec, exactly as the Feature Brief
characterized them. No other genuine ambiguity was found in the source material that this document
could not resolve by reading `docs/brainstorm-b2b-platform-pivot.md` in full.

## 12. Dependencies

- `docs/brainstorm-b2b-platform-pivot.md` must remain the authoritative source of the underlying
  analysis; this Requirement Document restates and formalizes it but does not edit it.
- CEO Agent approval of this Requirement Document is required before the literal content in Section
  4 is committed to the repo root as `CORE_OBJECTIVES.md`, per the standing governance gate.
- Immediately upon commit, `docs/b2b-pivot-status.md`'s Live Status table must be updated: B2B-01
  row moves to `Done`, referencing this file and the commit — per the Orchestrator's standing
  real-time-update instruction, not batched.
- Does **not** depend on resolution of F-01 (ledger storage) or F-02 (COGS/burn rates) — by design.
- Does **not** depend on a decision about the Template Designer brainstorm's formal role — by design.
- B2B-02 (Partner API & multi-tenant architecture) is blocked on this document landing, per the
  dependency graph in `docs/b2b-pivot-status.md`; B2B-03/04/05 are transitively blocked on B2B-02.
