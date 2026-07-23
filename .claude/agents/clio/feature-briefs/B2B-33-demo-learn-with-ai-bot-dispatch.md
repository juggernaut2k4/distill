# Feature Brief: B2B-33 — "Learn with AI" Demo: Real Bot Dispatch with Per-Topic Meeting URL

From: CEO (Arun)
To: Business Analyst Agent
Priority: P1 — makes the public "Learn with AI" demo surface (`test.hello-clio.com/demo`) actually
work end-to-end for the first time; also the first time that surface writes to the database and
triggers real (if free/test-mode) vendor bot-dispatch cost, so it carries real infra/abuse stakes
even though the UI ask itself is small.
Date: 2026-07-22

---

## What Arun Said

Verbatim, in order, across three messages:

> "now when you click "Learn with AI" button then it should trigger the bot to join the google
> meeting, also we need to send a api call along with the transcript, urls of visuals for the topic
> as part of the request body. each subtopic needs to be called out separately in the prompt so that
> the bot know that its moving from one sub-topic to other that way it will also help us to launch
> the next url and render it when explaining. do you understand. do you need anything else ?"

In response to the Orchestrator's clarifying question about the meeting-join flow, Arun gave a direct
product answer rather than picking from offered options:

> "at the end of topic page where you have discussion, learning check, add one more option called
> meeting. in that have a text box and save button. for the demo, i will enter the google meet url
> and save it. any url that is present in that box will be sent to the bot to join the meeting. ok?"

On pipeline reuse and topic scope:

> "1. yes
> 2. both topics"

Where "1. yes" = reuse the real session infrastructure (bot dispatch, the B2B-19 content-delivery API
contract, the transition-marker mechanism) rather than a separate demo-only pipeline, and "2. both
topics" = both `/demo/claude-ai` (5 chapters) and `/demo/oop-fundamentals` (7 chapters), which already
have live, verified static visual pages at `/demo/{slug}/visuals/{chapterId}`.

---

## The Problem Being Solved

The demo surface at `test.hello-clio.com/demo` is currently 100% static and inert: `DEMO_TOPICS` is a
hardcoded in-memory array (`app/demo/_content.ts`), the "Learn with AI" button is a no-op that shows
"Demo only — nothing is wired up behind this button yet" (`app/demo/[slug]/DemoTopicClient.tsx:100-109`),
and the whole surface has zero backend/database state. It cannot demonstrate the one thing it exists
to demonstrate: Clio's real bot joining a real meeting and narrating real content, driven by the same
mechanism real partners use. Arun wants this closed — the demo should be a genuine, live proof of the
product, not a mockup.

---

## What Success Looks Like

1. Each demo topic page gets a new **Meeting** tab (after Discussion, before/alongside Learning Check)
   with a text box + Save button for a Google Meet URL, scoped to the whole topic (one URL shared
   across all of that topic's chapters — matches "at the end of topic page," not per-chapter).
2. "Learn with AI" is disabled/inactive until a meeting URL has been saved for that topic; once saved,
   clicking it dispatches Clio's real meeting bot into that Google Meet URL.
3. The dispatch call carries the topic's content through the **real, already-built B2B-19 inline
   content-delivery contract** (`POST /api/partner/v1/sessions`, `content_pages[]`, one entry per
   chapter/subtopic) — each entry's `transition_trigger` names that chapter, its `page` URL points at
   the chapter's already-live static visual page, and the system-generated `transition_marker`
   mechanism (`lib/content/transition-markers.ts`) is what cues the bot, in-session, that it's moving
   from one subtopic to the next and to switch the rendered visual — exactly the mechanism Arun
   described, already built for real partner sessions, not reinvented.
4. This entire flow runs through a **dedicated internal demo partner account**, always in
   `test_mode: true`, so it costs nothing real and never touches any real partner's data, wallet, or
   `balance_usd` — "reuse the real pipeline" becomes literally true end-to-end without financial or
   data-isolation risk.
5. The saved meeting URL persists (new minimal table) so Arun doesn't have to re-enter it every demo.

---

## Known Constraints

- **Public, unauthenticated surface.** `/demo/*` has no login. Do not add Clerk auth to it — that
  would contradict its purpose. But this also means the Meeting-tab **Save action is a public write
  that triggers real (if free) vendor bot-dispatch on click** — an unprotected save box lets anyone
  who finds the page point Clio's bot at an arbitrary Google Meet, on demand, for free. This is a real
  abuse/cost/reputational vector, not a hypothetical one, and it did not exist on this surface before
  today because nothing on `/demo` wrote to a database or called a paid vendor. **Required, not
  optional:** gate the Save action (not page viewing, not the tab itself) behind a lightweight shared
  passcode — a single `PLACEHOLDER_DEMO_MEETING_PASSCODE` env var checked server-side on the save
  route, no new auth system, no user accounts. This is a technical/security safeguard within CEO
  autonomy per `CLAUDE.md`, not a UX decision — BA should design the passcode UI as part of the
  Meeting tab (e.g., a second field, submit-disabled until correct) under the same "document exactly,
  no ambiguity" bar as every other screen. If Arun later says he wants zero friction on this, that's
  his call to make after seeing the spec — do not build it unprotected by default.
- **Billing/data isolation is mandatory, not best-effort.** Every dispatch from this surface must run
  through a dedicated internal `partner_accounts` row created specifically for this feature (see
  Questions for BA #1) with `test_mode: true` on every session, so it only ever debits
  `test_minutes_balance`/`trial_minutes_used` (never `balance_usd`) and never trips the live-mode
  funding-required guardrail (`app/api/partner/v1/sessions/route.ts` B2B-06/B2B-27 checks). No code
  path in this feature may pass `test_mode: false` or reference any existing real partner's
  `partner_account_id`.
- **No AI-generated content on this screen.** The transcript/content sent to the bot must be the
  already-authored chapter text already live in `app/demo/_content.ts` (`Chapter.blocks`) — not a
  fresh LLM call to summarize or rewrite it. This directly follows the standing rule against
  populating user/bot-facing content with speculative AI output on an undefined screen; here the
  content isn't undefined, it's already written and approved, so use it verbatim.
- **Reuse, don't fork, the real pipeline.** The dispatch call is a server-to-server call to the
  existing `POST /api/partner/v1/sessions` route using the same `CreateSessionSchema`/`content_pages`
  inline-content contract, the same `content_source_id` registration flow
  (`lib/partner/content-sources.ts`), and the same `dispatchMeetingBot` (`lib/partner/session-init.ts`)
  that real partners use. Do not write a parallel/simplified bot-dispatch mechanism for the demo.
- **Meeting URL validation.** `meeting_url` is fetched by real infra (Recall.ai/Attendee — check
  `docs/b2b-pivot-status.md` for current vendor) the instant a real user clicks Save→Learn with AI.
  BA should confirm/require the same validation the real pipeline already applies to `meeting_url`
  (format check, no open redirect/arbitrary-fetch risk) rather than assuming free-text input is safe
  as-is.
- **Content source URLs are public, no-auth by design** — the demo's own visual pages
  (`/demo/{slug}/visuals/{chapterId}`) are already public Next.js routes. Register them the same way
  B2B-31 registered its showcase pages: one `content_source_id` with `auth_type: 'none'`, via the real
  `POST /api/partner/v1/content-sources` endpoint (or a one-time seed/migration row — BA's call, see
  Questions for BA #2).
- Approved vendor list, secrets handling, and Zod-validation rules in `CLAUDE.md` apply as normal — no
  new packages are needed for this brief; everything reuses existing `lib/partner/*` modules.
- Per the standing responsive/mobile-friendly rule: the new Meeting tab is a screen change, so it must
  ship genuinely mobile-friendly (fluid `clamp()`-based layout, no hardcoded pixel caps), same bar as
  every other screen touched going forward.

---

## CEO Resolutions (decided here, not left open for BA)

These were flagged as open questions in the original problem framing; resolving them now so the BA
spec starts from a settled foundation rather than re-litigating them:

1. **Billing isolation approach: new dedicated internal partner account, not a reuse of B2B-32's
   Test Harness account.** B2B-32 (`f6af5e8f-f595-4fd8-a019-f10cab854ef4`, "Clio Internal — Test
   Harness") is explicitly **on hold** per Arun's own instruction, is scoped to Arun's manual
   Postman-driven testing, and is a *different tool* solving a *different* problem (content-source
   fixture authoring). Coupling a new, live, public-facing feature's automated dispatch to a paused,
   manually-operated internal tool's account risks confusing two things Arun deliberately kept
   separate. Precedent (B2B-32) already establishes the pattern of a dedicated internal
   `partner_accounts` row solving exactly this billing-isolation problem — reuse the *pattern*, not
   the *row*. BA should provision a new row, e.g. "Clio Internal — Public Demo," `test_mode`-only.
2. **Meeting URL is topic-scoped, not chapter-scoped.** Arun's own words ("at the end of topic page")
   are unambiguous — one Meeting tab, one saved URL, per topic, shared across all of that topic's
   chapters.
3. **"Learn with AI" only works once a URL is saved.** No saved URL → button stays disabled (or
   hidden — BA's call on which reads better, document either way) with a short inline note, matching
   the existing pattern of an inline status note next to the button. No error-toast-driven flow needed
   for the "nothing saved yet" case — it should be prevented at the UI level, not caught after a
   failed dispatch.
4. **This needs a full BA Requirement Document — not a lightweight technical spec.** This is not a
   "mechanical extension of an already-approved pattern" the way the OOP-visuals build was (that was
   pure static content, zero new backend surface). This brief introduces: a new database table, a new
   public write endpoint with real abuse exposure, a new dedicated partner account, and a live call
   into real paid vendor infrastructure (even though cost is $0 under test_mode). That combination —
   new infra + new public write surface + real vendor dispatch — matches the shape of B2B-19/B2B-31/
   B2B-32, all of which got full specs. Full 12-section Requirement Document required before any code.
5. **Subtopic-marker format: reuse the existing transition-marker contract verbatim, no new format.**
   Each chapter becomes one `content_pages[]` entry with its own `transition_trigger` (a plain-language
   description of that chapter's content, from `Chapter.title`/first paragraph) and `page` URL
   (`/demo/{slug}/visuals/{chapterId}`, already live). The system-generated `transition_marker`
   (`generateTransitionMarkers`, `lib/content/transition-markers.ts`) is what actually cues the bot to
   say a near-zero-collision phrase and advance — this is the existing, already-proven mechanism from
   B2B-19/B2B-31. Do not invent a new prompt-marker scheme for the demo.

---

## Questions for BA

1. **Exact shape of the new "meeting URL" table** — minimal columns (likely just `slug` PK/unique,
   `meeting_url`, `updated_at`), migration, and RLS posture given the surface is public/no-auth (reads
   probably need to be server-side only via a route handler, not a public Supabase read — confirm and
   document the access pattern explicitly, don't leave it implicit).
2. **Content-source registration mechanism**: a one-time seed/migration row for the `auth_type: 'none'`
   content source pointing at the demo's own visual-page host, vs. registering it lazily on first
   dispatch via the real `POST /api/partner/v1/content-sources` endpoint. Either is fine technically;
   document the choice and why.
3. **Dispatch route shape**: confirm a new server-only route (e.g.
   `POST /api/demo/[slug]/dispatch`, public but passcode-checked per the Known Constraints section)
   that (a) loads the saved meeting URL, (b) assembles `content_pages[]` from the static
   `DEMO_TOPICS` chapter data, (c) calls the real `/api/partner/v1/sessions` endpoint server-to-server
   using the dedicated internal demo account's API key (server env var, never exposed to the browser),
   with `test_mode: true`.
4. **Post-click UI states** — this is a 3-line-minimum UX screen under the "Ambiguous UX = STOP" rule.
   Arun specified the trigger (click → dispatch) but not the loading/success/error states on the
   button. Document explicitly: what the button/page shows while dispatch is in flight, on success
   (e.g., confirmation the bot is joining, maybe the session ref), and on failure (invalid/unreachable
   meeting URL, dispatch error, passcode wrong) — no ambiguity, no dev improvisation.
5. **Passcode UX** for the Save gate described in Known Constraints — where it lives on the Meeting
   tab, what it looks like, and error messaging for a wrong passcode.

Section 11 of the resulting Requirement Document must be empty (no open questions) before this goes
to a developer agent, per the standing governance gate.

---

## Dependencies

- B2B-19 (inline content delivery, transition markers, `CreateSessionSchema`, `content_pages[]`,
  `dispatchMeetingBot`) — done, this brief is a new caller of that existing contract.
- B2B-06/B2B-27 (`partner_wallets`, card-on-file/funding guardrails, `test_mode` semantics) — done,
  this brief's dedicated internal account relies on `test_mode: true` to stay outside those guardrails
  exactly as B2B-32's account does.
- B2B-31 (`content_source_id`/`auth_type: 'none'` registration precedent, real
  `selectTemplate`/template pipeline reuse precedent) — done, same public-content-source pattern
  applies here.
- B2B-32 (dedicated internal `partner_accounts` row for isolation — pattern precedent only, not the
  same row; that tool remains on hold and untouched by this brief).
- The already-live static visual pages under `/demo/{slug}/visuals/{chapterId}` for both topics
  (source of the `page` URLs in `content_pages[]`).

---

## Files Likely Touched (for BA to confirm/expand in the spec)

- `app/demo/[slug]/DemoTopicClient.tsx` — new Meeting tab, wired "Learn with AI" button, post-click
  states.
- `app/demo/_content.ts` — no structural change expected; chapter data is the transcript source as-is.
- New: `app/api/demo/[slug]/meeting/route.ts` (save/read meeting URL, passcode-checked on write).
- New: `app/api/demo/[slug]/dispatch/route.ts` (assembles payload, calls real sessions endpoint
  server-to-server, passcode-checked).
- New migration: meeting-URL table + the dedicated "Clio Internal — Public Demo" `partner_accounts`
  row (and its content-source row, if seeded rather than lazy-registered).
- `.env.local.example` — new `PLACEHOLDER_DEMO_MEETING_PASSCODE` and a server-only demo-account API
  key placeholder.
