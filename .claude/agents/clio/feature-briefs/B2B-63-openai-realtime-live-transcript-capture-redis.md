# Feature Brief: B2B-63 — Live transcript capture for OpenAI Realtime sessions (Redis, incremental)

From: CEO (Arun)
To: Business Analyst Agent
Priority: P1
Date: 2026-08-01

**Numbering note:** highest ID present anywhere (feature-briefs directory tops out at B2B-61;
`docs/b2b-pivot-status.md`'s Live Status table also has a B2B-62 row for tonight's multi-language
work, direct-build, no brief file). B2B-62 is taken as an ID even without a file. This brief is
**B2B-63**.

---

## What Arun Said

Relayed via the Orchestrator, from tonight's direct conversation with Arun:

> "Ok let's go with it... Can we proceed building with ceo agent so that once deployed I can test
> everything we deployed today."

This sits at the end of a live debugging conversation, not a cold request — Arun and the
Orchestrator worked through the actual failure together tonight (see grounding below), and the
"go with it" refers to the specific mechanism they landed on, not an open-ended ask. I want to be
explicit about scope: Arun's "test everything we deployed today" is broader than this single item —
B2B-61 (OpenAI Realtime adapter + admin toggle, all three parts) and B2B-62 (multi-language) are
**already shipped and testable right now**, independent of this brief. This brief covers only the
one piece that is *not yet built*: live transcript capture so OpenAI-provider sessions stop losing
their insights-extraction data silently. I'm scoping the brief to that, not re-litigating what's
already live.

## Independent verification (done directly against code, not taken on the Orchestrator's summary alone)

I read the actual files rather than trusting the relay:

1. **`inngest/partner-session-insights-extractor.ts` (lines 211–264) confirms the gap is real and
   already honestly handled, not silently broken.** `extractInsightsForPartnerSession()` now selects
   `voice_provider` (migration `106_voice_provider_per_session.sql`, applied — I read the migration
   file directly) and, for `voice_provider === 'openai_realtime'`, throws an explicit "not yet
   supported for this provider" error *after* the idempotency guard runs (so a real
   `partner_session_insights` row exists to record the failure against, and the 30-minute backstop
   sweep can correctly give up after 3 attempts instead of retrying forever). This matches what I was
   told. **Confirmed, not rubber-stamped.**
2. **OpenAI Realtime genuinely has no post-hoc transcript endpoint** — this is corroborated by the
   backlog entry in `docs/b2b-pivot-status.md` (added 2026-08-01, citing OpenAI's own current docs
   page and developer-community threads requesting exactly this endpoint, which doesn't exist yet). I
   did not re-verify OpenAI's docs myself tonight, but the reasoning chain (Hume rejecting an OpenAI
   session id as "not a valid UUID," live-observed) is consistent with a genuine architectural gap, not
   a code bug on our side.
3. **The transcript data is real and already flowing, just not persisted.** `lib/voice/openai-realtime-adapter.ts` fires `config.onMessage(text, 'ai')` on `response.output_audio_transcript.done`
   and `config.onMessage(text, 'user')` on `conversation.item.input_audio_transcription.completed` —
   confirmed by direct read (lines ~371–394). **However, one correction to how this was described to
   me tonight**: this `onMessage` callback is **not uniformly wired to anything today**. In
   `PartnerRenderClient.tsx` (lines 296–337), `onMessage` is only a real function for
   **inline-content-mode sessions** (`isInline`), where it drives the B2B-60 two-stage page-transition
   matcher — for **template/Designer-mode sessions** (the `sections` prop path), `onMessage` is a
   literal no-op (`() => {}`) by explicit, commented design ("do not alter this path," a B2B-03
   guarantee). The adapter still calls it either way; the client component just ignores it in
   template mode. This matters for the design below: **a new capture mechanism cannot simply "extend
   the existing onMessage callback"** — it needs to be a separate, additive tap on the same event data
   that fires regardless of which content mode a session uses, since insights extraction has to work
   for both. Flagging this now so the BA doesn't inherit an inaccurate premise.
4. **This callback is shared across both voice providers today** (`sharedCallbacks.onMessage`,
   `PartnerRenderClient.tsx` line ~336, explicitly commented "provider-agnostic by design"). A new
   capture hook placed carelessly at this shared call site would fire — and write to Redis — for Hume
   sessions too, which is unnecessary cost and scope creep given Hume's post-hoc fetch already works.
   **The BA spec must make the provider gate explicit** (write to Redis only when the session's
   resolved provider is `openai_realtime`), not assume it falls out naturally from where the hook is
   added.
5. **Upstash Redis is not in this codebase today, and its absence was already anticipated.**
   `lib/partner/rate-limit.ts` has a standing comment (read directly): "there is no Redis/Upstash in
   the approved vendor list... a distributed limiter is a reasonable future enhancement (e.g. once
   Upstash Redis or similar is added to the approved vendor list)." This brief would be the first to
   actually introduce it — worth noting as a real, non-trivial vendor addition, not a config tweak.
   Confirmed no existing `redis`/`upstash` package in `package.json`, and no env var placeholders for
   it yet.
6. **The 30-day purge precedent is real and directly analogous.** `partnerSessionInsightsPurge`
   (`inngest/partner-session-insights-extractor.ts`, cron job, ~line 544) already reduces
   `partner_session_insights` full-detail rows to summary-only after 30 days via a Postgres RPC. The
   short-retention framing for the new Redis-held raw transcript should mirror this *pattern*
   (bounded retention of raw content after its job is done), not necessarily its *exact window* — see
   Open Questions below.

Verdict: the problem is real, already-honestly-failing (not silently), and the proposed mechanism
(capture live client-side, since there is no vendor-side alternative) is the only structurally
sound option. One real correction made above (the `onMessage` wiring), otherwise the direction holds.

---

## The Problem Being Solved

Every OpenAI Realtime session run today produces **zero transcript, zero action items, zero learner
insight** — permanently, not just delayed — because OpenAI's Realtime API has no way to retrieve a
past session's conversation after the fact. This is not a hypothetical: OpenAI is now a live,
admin-selectable provider (`OPENAI_REALTIME_ADAPTER_AVAILABLE` was flipped to `true` earlier tonight
per B2B-61 Part B/C), so any partner session run on it from this point forward silently loses its
entire post-call insights pipeline — the same pipeline resellers depend on for action items and
learner-insight summaries delivered via webhook. The failure is currently *honest* (a clear thrown
error, correctly marked failed after 3 retries) rather than *silent*, which is the right interim
state — but "fails honestly" is not the same as "works." Every day this stays unbuilt, real partner
sessions on OpenAI accumulate as permanent, unrecoverable gaps.

## What Success Looks Like

- An OpenAI Realtime session's spoken conversation (both Clio's turns and the participant's turns)
  is captured incrementally, in near-real-time, during the call — not buffered only in memory and
  saved once at the end.
- If the browser tab crashes, the network drops, or the call ends abruptly, at most the last ~10–15
  seconds of conversation is lost — never the whole call.
- After the call ends, `extractInsightsForPartnerSession()` uses this self-captured transcript for
  `openai_realtime` sessions in place of the Hume-API call it currently makes only for Hume sessions
  — producing real action items and a real learner insight, delivered to the reseller exactly as
  Hume-provider sessions already are today.
- Hume-provider sessions are completely unaffected — this is purely additive.
- The main application Postgres database sees no added write load from this; no browser storage is
  used; nothing is lost to a crash mid-call.

## Known Constraints (explicit from Arun tonight)

1. Not the main Postgres database — this is high-frequency, ephemeral data and must not add write
   load there.
2. Not browser-side storage (localStorage/sessionStorage/IndexedDB) — explicitly ruled out.
3. Must be incremental/streaming, not buffer-everything-then-save-once — survives an abrupt call
   ending. Discussed cadence: roughly every 10–15 seconds or per conversational turn, whichever comes
   first, with jitter across sessions to avoid synchronized write bursts at scale. (Exact numbers not
   locked — see Open Questions.)
4. Vendor: **Upstash Redis via the Vercel Marketplace integration**, specifically because Arun
   already uses Vercel and wants one bill, not a separate vendor relationship. Cost discussed and
   acceptable at current scale (free tier ~500K writes/month; ~40–80 small writes per call comfortably
   covers thousands of calls/month before real spend).
5. After a call ends, the buffered transcript feeds `extractInsightsForPartnerSession()` as its input
   for `openai_realtime` sessions only — Hume's existing path is untouched.
6. Retention is short-term — enough to run extraction and allow a human to manually check a session
   if something looks off — then the raw transcript should be discarded/reduced, mirroring the
   existing 30-day purge policy's *spirit* (bounded retention of raw content). The exact window is
   explicitly not decided — see Open Questions.

## Explicitly NOT this brief's job to invent (per Arun, don't guess these)

- Exact Redis key naming/data shape (one key per session holding an ordered list vs. one key per
  turn, etc.)
- Exact batching trigger (pure time-based vs. per-turn vs. hybrid) and the exact interval/jitter
  numbers
- Exact TTL value for the Redis-side backstop expiry
- Whether Hume's existing path should be touched at all — my read, and Arun's framing throughout,
  is **no**: this is additive, OpenAI-only. Hume's fetch-after-the-fact mechanism should stay exactly
  as-is unless the BA finds a concrete reason otherwise (I don't see one).
- Any UI/dashboard visibility into a live in-progress transcript — not requested, do not invent it.

---

## Open Questions for the BA to resolve (Section 11 must not ship empty on these)

1. **Redis data shape.** Per-session key holding an ordered append-list, vs. one key per
   turn/timestamp under a session prefix, vs. something else. Needs to support: incremental append
   during the call, and a single clean read-back-in-order at extraction time.
2. **Batching trigger and exact numbers.** Time-based (fixed interval + jitter), per-turn, or hybrid
   (whichever comes first)? What are the actual interval/jitter values? A natural default given
   Arun's own framing ("roughly every 10–15 seconds or per turn, whichever comes first, with jitter")
   is available, but the BA should confirm it holds up against real call-length/turn-frequency
   assumptions, not just restate it.
3. **Retention/TTL.** A natural default (stated here, not assumed settled): delete the Redis-held
   transcript on successful extraction, plus a TTL backstop in case extraction never runs — sized to
   match or slightly exceed the existing 30-minute backstop sweep interval. The BA needs to confirm
   this default explicitly with reasoning (or propose a different one) rather than leave it implicit.
4. **Provider gate placement, concretely.** Given finding #4 above (the shared `onMessage` callback),
   where exactly does the new capture tap get wired so it (a) fires for both content modes
   (template/`sections` and inline), not just the inline path that already uses `onMessage` for
   page-transitions, and (b) only writes to Redis for `openai_realtime` sessions, never Hume? This is
   a real design decision, not a rubber-stamp of "just extend onMessage."
5. **Failure handling for the capture writes themselves.** If a Redis write fails mid-call (network
   blip, rate limit), does the session continue silently (losing that one chunk) or is there any
   retry? Given constraint #3 above (crash tolerance), silent-drop-and-continue for an individual
   write seems consistent with the spirit of the requirement, but the BA should state this explicitly
   rather than leave it to the developer's judgment call.
6. **What "the extraction step's input" looks like structurally.** `extractInsightsForPartnerSession()`
   currently builds `messageLines` from Hume's transcript events via `formatTranscriptLines()`. Does
   the OpenAI path read raw Redis entries and reshape them into the same `messageLines` shape (my
   expectation, for minimal blast radius on the Claude-calling code downstream), or does it need its
   own formatting function? BA should confirm by reading `formatTranscriptLines()`'s actual shape
   before specifying this.

## Vendor/technical items I am pre-clearing (full CEO/Orchestrator autonomy, not BA's job)

- Adding Upstash Redis (via Vercel Marketplace) to `CLAUDE.md`'s approved vendor list — this is a
  technical/infrastructure decision, not a product decision, and is squarely inside the
  Orchestrator's existing autonomy to add new vendor approvals as pivot items land. I'm noting it
  here so the BA doesn't treat "is this vendor allowed" as an open product question — it isn't one.
- Exact npm package name (`@upstash/redis`, the official SDK) — confirm during build, log once
  confirmed, same pattern this project already uses for `hume` and others.
- Actually provisioning the Vercel Marketplace integration (connecting the account) is an
  infrastructure/account step, not a product-shape one — flag to Arun only if it turns out to require
  an action only he can take (e.g. billing consent in the Vercel dashboard); otherwise proceed.

---

## Timeline reality check — my honest assessment, since Arun wants to test tonight

I don't think the full CEO → BA → CEO-review → Dev chain, run at its normal pace, lands *tonight* —
and I'd rather say that plainly than imply otherwise. Reasons this is a heavier lift than tonight's
other direct-build items (B2B-61 Part A/Part C, B2B-62):

- It introduces a **brand-new vendor integration** (Upstash Redis, first Redis anywhere in this
  codebase) — new package, new env vars, new provisioning step, not just new code against existing
  infrastructure.
- It has **real, unresolved product/technical shape questions** (data shape, batching cadence, TTL,
  gate placement) that Arun explicitly said are not decided — unlike B2B-62, which was a single
  additive optional field with an obvious default.
- It touches the **reseller-facing insights/billing-adjacent pipeline** — the same class of thing
  this project's own governance model exists to protect (data resellers act on, delivered via
  webhook). Getting the retention/gate-placement wrong is a real defect class, not cosmetic.

That said, I don't think this needs the *slow* version of the gate either. Most of the open
questions above have a reasonable default already stated in this brief — the BA's job is mostly to
confirm/detail those defaults with a concrete data-shape and acceptance criteria, not invent from a
blank page. My recommendation: run the BA spec **now, same session, fast turnaround** (BA writes
against this brief's defaults, I review same-session rather than waiting), so build can plausibly
start tonight even if full live-call verification (this codebase's own standing pattern for voice
features — LIVE-01, B2B-48, B2B-52 all needed multiple live-call passes) slips to tomorrow. I'd
rather tell Arun "spec and build start tonight, live-verified test likely tomorrow" than imply a
same-night full test that this class of change hasn't earned yet.

## What is NOT part of this brief

- No changes to Hume's post-hoc transcript-fetch path.
- No UI/dashboard visibility into live in-progress transcripts.
- No automatic retry/failover logic beyond what's already described in Open Question 5.
- No change to the existing 30-day `partner_session_insights` Postgres purge policy — that's a
  separate, already-working mechanism for a different table.

---

## Dispatch

Routed to the Business Analyst Agent now for a full Requirement Document against this brief —
including the 6 Open Questions above, a concrete Redis key-shape proposal, and explicit
acceptance criteria for the crash-survival requirement (constraint #3). Section 11 must be empty
before this comes back to me for approval. No code is written until I've approved that spec.
