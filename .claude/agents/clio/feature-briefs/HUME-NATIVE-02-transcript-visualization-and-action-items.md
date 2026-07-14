# Feature Brief: HUME-NATIVE-02 — Server-Side Transcript-Driven Visualization + Post-Session Action-Item/Glitch Extraction

From: CEO (Arun)
To: Business Analyst Agent
Priority: P0
Date: 2026-07-13

---

## IMPORTANT — this brief is narrower than the instruction that prompted it, and here's why

The instruction relayed to me (via the Orchestrator, quoting Arun directly throughout) described
moving Clio's live sessions "off today's architecture (Hume as transport-only, our own Claude-backed
Custom-LLM bridge deciding every turn) onto Hume's own native/supplemental LLM" as if this were still
a future architecture change to spec from scratch.

Before writing this brief I verified the actual current code state (not from memory — read the live
files directly, and dispatched a research pass to confirm each claim below with file:line evidence).
**Most of that architecture is already built and live in production.** Specifically, already shipped
and NOT part of this brief's scope:

- **Native-LLM mode switch itself** (`lib/voice/hume-native/config-provisioner.ts`) — Hume Config
  provisioned per-session with Language Model switched off Custom onto Hume's own native/supplemental
  option (Claude Sonnet). Shipped 2026-07-05 as HUME-NATIVE-01.
- **`NEXT_PUBLIC_HUME_NATIVE_ENABLED` is already `true` in Production/Preview** (per
  `docs/specs/HUME-SPEAK-01-requirement-document.md:22`), not a future toggle to flip.
- **Full user profile + detected intent already injected into the upfront prompt**, exactly as
  described in the relayed instruction: `app/api/hume-native/provision-config/route.ts` calls
  `buildProfileContextForClio()` (full, untrimmed) and a new `buildIntentContextForHumeNative()`
  helper, both feeding the `[CONTEXT]` placeholder in `lib/voice/hume-native/prompt-template.ts`.
  No trimming, no size cap applied — matches the "push full size first" decision already.
- **A real, application-level max-session-duration backstop already exists and is Hume-native-aware**
  (`inngest/session-timer.ts:16-102`) — it force-ends any session at its planned duration + a grace
  window regardless of whether Hume's `end_session` tool ever fires, shared with the existing
  disconnect watchdog. This is exactly the backstop the brainstorm doc recommended — it does not need
  to be built again.
- **`end_session` as a Hume-native tool call** — code built and deployed 2026-07-09 (SESSION-END-01).
  Not yet fully *active* in practice: see the operational blocker flagged below, which is not a spec
  item for the BA.

**What is genuinely still missing** — and the actual scope of this brief — is two things:

1. Visualization switching is **still Hume-tool-call-driven today**, the opposite of what Arun most
   recently decided. `config-provisioner.ts` registers `advance_tab`/`show_visual` as Hume tool IDs
   on the native config, and Hume's own LLM is the one deciding when to invoke them (verified: no
   server-side transcript-watching code exists anywhere in `lib/voice/` or `lib/content/`). This
   needs to be built.
2. **Post-session action-item and glitch extraction from Hume's transcript does not exist at all.**
   Confirmed by grep — zero real matches for "action item"/"glitch" extraction logic anywhere in the
   codebase. This needs to be built from scratch.

Everything below is scoped to just these two items. Do not re-spec or re-touch the already-shipped
pieces listed above.

---

## What Arun Said

Quoting directly, across this conversation and `docs/brainstorm/ATTENDEE-HUME-ARCHITECTURE-brainstorm.md`:

On visualization: **"hume does not trigger. we read the transcript and we trigger thats what we
discussed."** We (our own system) watch Hume's live transcript stream ourselves and decide when
Clio is wrapping up a section, then trigger the next visual directly — we do not rely on Hume's own
reasoning to initiate that action. A few seconds of timing slack either way is acceptable.
**Non-negotiable, his words: this tracking must never add lag or slow down Hume's responsiveness.**

On session ending (confirmed narrower than visualization): **"no end session can be handed over to
hume and it will use its tool to end the call."** This one action *is* Hume-native-LLM-initiated —
already built, see blocker below.

On action items: fetch action items and glitches **after** the session ends, not live — pull the
full two-sided transcript from Hume's Chat History API (`GET /v0/evi/chats/{id}/events`) and feed it
to Claude to extract action items and glitches. A nightly batch job across that day's sessions is
explicitly acceptable — no live/real-time requirement.

On the previously-planned visualization PDF export: **explicitly removed from scope, 2026-07-13** —
"this feature is not needed as now this is owned by client. its up to them to implement this feature
or not. not in our scope so you can remove." Reason: under the B2C→B2B pivot, Clio doesn't own the
end-user relationship anymore; partner platforms do. Do not build this. Do not let it resurface in
the BA spec.

---

## The Problem Being Solved

**Visualization:** Today, whether and when the on-screen visual advances depends on Hume's own LLM
choosing to call `advance_tab`/`show_visual` mid-conversation. Arun has explicitly decided he does
not trust the native LLM's own judgment for this — it's exactly the kind of per-turn steering
decision he wants us to own, not hand to Hume. The fix is mechanical, not a new capability: watch
what Hume's transcript is actually saying in real time and trigger the switch from our own server
code, the same way `advance_tab`/`show_visual` already work as a wire mechanism today — just
initiated by us instead of by Hume's reasoning.

**Action items / glitches:** Clio-led sessions currently produce no structured record of what was
discussed, decided, or went wrong after the call ends. Under the B2B pivot, a partner integrating
Clio has no way to see coaching outcomes without this. The data is fully available (Hume's own
Chat History API, and the `chat_id` needed to fetch it is already captured on `sessions` via
HUME-GROUND-TRUTH-01) — this is a wiring and extraction job, not new data collection.

## What Success Looks Like

- During a live session, the visual advances based on our own reading of Hume's live transcript, with
  no perceptible added latency to Clio's spoken responsiveness — verified by a real test call, not
  just code review.
- Hume's own LLM is no longer the decision-maker for `advance_tab`/`show_visual` timing. (Whether the
  tools are fully deregistered from the native config or left dormant as an unused fallback is an
  open question for the BA to resolve with a clear recommendation — see below.)
- After every Hume-native session ends (live or via nightly batch), a structured list of action items
  and any detected glitches exists, sourced from Hume's own transcript via Claude extraction, stored
  somewhere queryable (schema TBD by BA).
- No regression to the existing max-session-duration backstop, `end_session` tool-call path, or
  profile/intent injection — none of those are touched by this brief.

## Known Constraints

- **Non-negotiable latency constraint** (Arun's own words): transcript-watching for visualization must
  never slow down or add lag to Hume's responsiveness. The BA spec must state explicitly how this is
  verified (e.g., watching happens off the response-critical path, async, no blocking calls in
  Hume's turn-taking loop).
- A few seconds of visualization-switch timing slack is acceptable — this is not a hard real-time
  requirement.
- Action-item/glitch extraction is explicitly NOT required live — after-session or nightly batch is
  fine per Arun.
- Do not build any user-facing delivery of the extracted action items (PDF, email, in-app view) —
  that's explicitly out of scope per the 2026-07-13 pivot correction. This brief covers extraction and
  storage only; what a partner does with that data is their feature to build, not ours to surface.
- Must reconcile with an already-approved architectural decision that appears to be in tension here:
  `FB-HUME-GROUND-TRUTH-01-elevated.md` (Decision 2, already approved and referenced by
  `lib/session-billing.ts`/quality-eval code) established that **Hume's own transcript must never
  replace Recall/Attendee's transcript for analysis that depends on knowing what a specific human
  said**, because Hume cannot diarize multiple human speakers in a multi-participant meeting. Clio
  sessions are 1:1 (one executive + Clio), so that diarization problem may not actually apply here —
  but the BA must state this reasoning explicitly in the spec rather than silently deviating from a
  documented constraint, so it doesn't read as an unexplained inconsistency later.
- Do not touch `lib/voice/hume-native/config-provisioner.ts`'s `end_session` tool wiring, the
  max-duration backstop in `inngest/session-timer.ts`, or the profile/intent injection in
  `app/api/hume-native/provision-config/route.ts` — all already correct, already shipped, out of
  scope for this brief.

## Operational blocker — flagging to Arun directly, not a BA/spec item

`end_session` as a true Hume-native-judgment-driven tool call is not actually active yet, even though
the code shipped 2026-07-09. Per `docs/session-end-01-hume-setup.md` and
`docs/action-items.json` (2026-07-09 entry), full activation requires **Arun personally** to run a
one-time Hume Tools API registration (2 REST calls) using the real, non-placeholder `HUME_API_KEY` —
this cannot be done by an engineer without that key. Until it's run, Hume-native sessions still end
via the demoted `FAREWELL_PHRASES` timer fallback, not genuine native tool-calling. This means the
"end_session reliability" risk Arun asked to monitor during real sessions can't actually be observed
yet — the mechanism it depends on isn't switched on. Recommend Arun runs this step separately from
this brief; happy to hand over the exact 2 API calls if useful.

## Questions for BA

1. **Live transcript source for visualization-triggering**: Hume's Chat History API
   (`GET /v0/evi/chats/{id}/events`) is confirmed post-call only (already used in
   `lib/voice/hume-native/session-details.ts` for archival/debug lookup). Determine and document the
   actual mechanism for reading Hume's transcript *during* the live call — does the existing
   client-side Hume connection (`WalkthroughClient.tsx` / `HumeAdapter`) already expose incremental
   transcript events we can hook into, or does this require a new subscription/stream? Confirm with a
   direct check against Hume's docs/SDK, not assumption.
2. **Fate of the existing `advance_tab`/`show_visual` Hume tool registrations** on the native config:
   remove them from `config-provisioner.ts`'s `tools` array now that Hume should never trigger them,
   or leave them registered as a dormant fallback? My recommendation: remove them — leaving both
   mechanisms live risks Hume's LLM firing a tool call that races or conflicts with our own
   server-triggered switch. Confirm or override in the spec.
3. Full data flow, error states, and edge cases for the visual-switch-detection logic (what transcript
   pattern signals "wrapping up a section," what happens if detection is late/early beyond the
   acceptable few-second slack, what happens if the transcript stream itself drops).
4. Full schema for storing extracted action items/glitches (new table vs. columns on `sessions`;
   how action items map to a session/user/topic; what "glitch" means precisely — reuse or extend the
   existing quality-evaluator's glitch/`quality_error` concept from
   `inngest/session-quality-evaluator.ts`, or is this a distinct new category?).
5. Exact extraction prompt/approach for Claude reading the Hume transcript — what counts as an action
   item, expected output shape, how failures/empty results are handled (never silently mark "done"
   with zero output — this codebase has a known prior bug pattern of false-"ready" states, see
   `CONTENT-02-overview-summary-and-readiness-guard.md` for the precedent to avoid repeating).
6. Batch job design: triggered per-session-end vs. nightly cron across that day's sessions (Arun said
   either is fine) — BA to recommend one with reasoning, plus retry/failure handling.
7. Confirm the 1:1-vs-multi-participant reasoning above (Known Constraints, last bullet) explicitly in
   Section 4/9 of the spec so it's documented, not assumed.

Section 11 (Open Questions) must be empty before this reaches a developer. If BA cannot resolve
question 1 (live transcript source) without a direct Hume API/SDK check or a short live test, that's
an acceptable reason to flag it back to me rather than guess — per the standing "no guessing" rule.
