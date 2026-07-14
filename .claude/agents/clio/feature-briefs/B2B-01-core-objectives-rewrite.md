# Feature Brief: B2B-01 — Core Objectives Rewrite (Formal Replacement for `CORE_OBJECTIVES.md`)
From: CEO (Arun)
To: Business Analyst Agent
Priority: P0
Date: 2026-07-13

## Series context
First of five sequenced Feature Briefs for the B2C → B2B/B2B2C pivot (see
`docs/b2b-pivot-status.md` for the full dependency graph). B2B-02 (Partner API &
multi-tenant architecture), B2B-03 (Designer/Configurator), B2B-04
(Billing/metering), and B2B-05 (Domain/white-label infra) all depend on this
brief landing first and are explicitly **out of scope here** — do not pull
partner API contract detail, Designer UI, billing rate tables, or domain infra
into this spec. This brief covers objectives only: what Clio is now for, and
what "done" means for each objective, not how any downstream system implements
it.

Authoritative source: `docs/brainstorm-b2b-platform-pivot.md` — read it in
full, not just this brief. Section 3 of that document is a complete,
Arun-confirmed objective-by-objective impact analysis against the old (now
deleted) `CORE_OBJECTIVES.md`. **Use Section 3 as the primary input for the new
objectives — it has already been through multiple rounds of clarification with
Arun and should not be redone from scratch.** This brief translates that
analysis into a build-ready spec request; it does not re-litigate it.

## What Arun Said
Direct quote (source doc §1.4), the instruction that started this whole
thread: *"Analyze these requirements thoroughly and let me know your thoughts.
Tell me what changes impact our core objectives. I think we need to start with
those, but before making any changes to the code, let me hear your
recommendations and thoughts on this."*

The pivot itself, in his words (§1.1): the original B2C framing put Clio in
direct competition with Pluralsight/Domestika/Coursera for individual
executive users — platforms with an existing user base Clio cannot
out-acquire. What those platforms lack is AI that can join a live meeting,
screen-share, and walk a user through content interactively. Arun's decision:
**don't compete with them, plug into them via API.** B2B, not B2C.

Confirmed via the Q&A trail (source doc §2, §7):
- B2C is **killed**, not paused, not a parallel channel (Q1).
- Clio retains only de-identified transcripts for its own quality/prompt-tuning;
  everything else about a user is either not stored at all, or stored by the
  partner via an opt-in push/pull API (Q2).
- Nothing is generated live during a session — same async background-generation
  pattern as today, just re-pointed to push output to a partner's DB instead of
  Clio's own, and pull it back at render time. Personalization moves from
  generation-time (per-user script text) to explanation-time (Hume's system
  prompt reads a fetched profile live, if one exists) (Q3).
- One flexible API, not two product tiers — partners configure it into
  different shapes via toggles (Q4).
- This is a different shape of complexity, not a smaller one — real reduction
  in consumer-facing surface, real reuse of the hardest infrastructure
  (Recall.ai/Attendee bot, Hume voice), but multi-tenant billing, white-label
  hosting, the partner content/profile contract, and sub-tenant hierarchy are
  genuinely new (§4-5, Arun agreed with this framing).
- Clerk scoped to partner-admin accounts only, never end-user identity (§7.1,
  confirmed).
- Billing: single unified credit wallet (Option B), metered at different burn
  rates per product — decided, not dual pre-allocated pools (§7.4).

## The Problem Being Solved
`CORE_OBJECTIVES.md` (approved 2026-06-07, deleted 2026-07-13 as stale)
described a B2C, Clio-owned, single-tenant, direct-to-executive product: Clio
as system of record for a persistent per-user profile, individual sign-up,
scheduled daily delivery, gamified engagement. That document no longer
describes what Clio is. Every downstream Feature Brief in the pivot (B2B-02
through B2B-05) needs a settled, unambiguous statement of what Clio's
objectives are under the new model before any of them can be spec'd — right
now there is no source of truth for "does Clio store this," "who owns
personalization," or "what does the API actually have to guarantee," and
different agents could each infer different answers.

## What Success Looks Like
A new objectives document exists (see Question 1 below on artifact/location)
that:
1. States B2C-killed as a **hard, explicit premise** at the top — not hedged,
   not framed as "paused" or "deprioritized." Any agent reading it should
   immediately understand that resurrecting a B2C surface requires a new
   explicit instruction from Arun, not inference from git history.
2. Restates all 6 original objectives with the same before/after rigor as the
   2026-06-07 doc, each tagged with its new status from source doc §3
   (**modified, survives** / **largely unchanged, recontextualized** /
   **becomes the core of the business model**) and a concrete, falsifiable test
   case for each — in the style of the original doc's "same concept, three
   different sessions for three different users" example. A developer or QA
   agent should be able to look at an objective and know exactly what behavior
   would violate it.
3. Elevates Objective 6 (API is the integration layer) from a background
   architecture principle to the explicit center of the business model, per
   source doc §3's verdict — this is what B2B-02 onward will be graded against.
4. Establishes, at the principle level, the non-negotiable data boundary that
   every future brief must respect: **Clio computes but never becomes the
   system of record for partner or end-user data**, with the sole exception of
   de-identified transcripts retained for Clio's own quality/prompt-tuning. This
   must be stated in a way that stays true regardless of how the still-open
   ledger-storage question (F-01, see Known Constraints) eventually resolves.
5. Gives the two partner archetypes (Platform Partner / No-Platform Partner,
   source doc §1.2) an explicit place in the objectives — the objectives must
   be written so both are legitimate instances of "success," not with one
   treated as the default and the other as a special case.

## Known Constraints
- **B2C is killed, hard premise.** No resurrecting B2C surfaces, copy,
  gamification (AI Readiness Score, streaks), SMS/Twilio, cron-scheduled daily
  delivery, or self-serve individual signup/Clerk-per-executive, from git
  history or otherwise, without an explicit new instruction from Arun.
- **Data ownership boundary is non-negotiable:** Clio computes signal
  (profile, content) but partner or end-user data is never Clio's system of
  record. Only de-identified transcripts are retained by Clio itself.
- **Personalization mechanism has moved from generation-time to
  explanation-time** — a different script per user is no longer the model;
  content is generated once per partner+topic and reused, personalization
  happens live via Hume's system prompt conditionally reading a fetched
  profile.
- **Billing is a single unified credit wallet (Option B, decided)** metered at
  per-product burn rates (voice-minutes, LLM-generation-calls) — not
  dual-allocated pools. This is a billing-mechanism detail that belongs to
  B2B-04, but the objectives document should not describe billing in terms
  that contradict it (e.g., should not imply separate pre-allocated buckets).
- **Two partner archetypes, one flexible API** (source doc §1.2, §2 Q4) —
  Pluralsight-style (existing platform, thin narration layer, no Designer
  needed) and Capgemini-style (no existing platform, full Designer-configured
  build) are both first-class, not primary/secondary.
- **Sub-tenant delegation exists but stays opaque to Clio** — a partner (e.g.
  Capgemini) can extend credit to its own downstream clients (e.g. Hartford);
  Clio only ever sees one rollup line per top-level partner account, never
  visibility into sub-tenant identity.
- **Scope boundary:** this brief is B2B-01 only. Do not draft the partner API
  contract, Designer requirements, billing rate tables, or domain/white-label
  infra here — those are separately sequenced briefs (B2B-02 through B2B-05)
  that depend on this one landing first.
- **No file currently exists to diff against** — `CORE_OBJECTIVES.md` was
  already deleted 2026-07-13 as stale B2C content. This is a from-scratch
  write grounded in source doc §3, not an edit.

## Questions for BA
None of these are open product decisions requiring Arun's input before you can
start — they're scoping/format questions where I want you to use judgment and
flag back to me only if you get genuinely stuck. Per the standing gate,
Section 11 of your Requirement Document must still come back empty.

1. **Output artifact and location:** confirm you'll produce a new
   `CORE_OBJECTIVES.md` at the repo root (same name/location as the retired
   version), restating and updating all 6 objectives with status tags and
   test cases as described above under "What Success Looks Like" item 2. If
   you think a different location or filename now makes more sense given the
   pivot (e.g. because "core objectives" reads as B2C-era naming), propose it
   in your spec rather than silently picking one.
2. **Template fit:** the standard 12-section Requirement Document template is
   built for UI-feature specs — wireframes, screen-by-screen flows, UI
   acceptance criteria. Core Objectives is a strategy document, not a screen.
   Adapt sensibly: sections like acceptance criteria and edge cases still
   apply directly (e.g., "what does Objective 1 mean for a partner who never
   enables the profile-storage toggle" is a real, worth-documenting edge
   case), but collapse or explicitly mark N/A any section that doesn't map
   (e.g. wireframes) rather than forcing content into it. Use judgment.
3. **Do not presuppose two items Arun has explicitly not yet decided** — write
   around them rather than picking an answer:
   - Whether Clio keeps an opaque-reference usage ledger of its own vs. true
     zero-storage with live round-trips to partner APIs (open item F-01,
     tracked in `docs/b2b-pivot-status.md`). State the data-ownership
     objective at the principle level ("Clio never becomes the system of
     record for partner or end-user data, except de-identified transcripts
     retained for its own tuning") — that statement is true under either
     resolution of F-01. Do not describe a specific ledger implementation.
   - Whether the paused AI Template Designer brainstorm
     (`docs/brainstorm-ai-template-designer.md`) formally resumes as the
     mechanism for Objective 3's 3-level design-properties model (Orchestrator
     recommended yes in source doc §0/§6, Arun has not explicitly confirmed).
     Objective 3 should describe the *what* (content generated once per
     partner+topic, reused, with app/template/component-level partner
     customization) without committing to which brainstorm doc formally
     "owns" the mechanism — that's a B2B-03 scoping question, not this one's.

## Approval note
I've read `docs/brainstorm-b2b-platform-pivot.md` in full (all sections, both
rounds of Q&A) and `docs/b2b-pivot-status.md` before writing this brief — this
isn't a pass-through of the Orchestrator's summary. I'm confident enough in
Arun's already-stated decisions (B2C killed, data-ownership principle,
explanation-time personalization, one flexible API, Option B billing, Clerk
scope) to authorize BA work starting now, without a further escalation to Arun.
The two items flagged in Question 3 are genuinely open per Arun's own
un-confirmed items, but they don't block B2B-01 specifically — they matter for
B2B-02/03, not for stating the objectives at the right level of abstraction
here. I will review the completed Requirement Document against this brief and
against source doc §3 before approving it for build.
