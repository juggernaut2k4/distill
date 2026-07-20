# Feature Brief: B2B-31 — Partner Showcase Demo (Channel-Partner "Showcase" Tab)

From: CEO (Arun)
To: Business Analyst Agent
Priority: P1 — not a live-billing or auth-integrity fix, but Arun wants this ready for upcoming
sales-partner demo calls; no committed date given, treat as next-up after any in-flight P0 work.
Date: 2026-07-19
Version: 2.0 — supersedes v1.0 (2026-07-19). Do not build from v1; the sections below marked
"CORRECTED IN v2" replace v1's content outright, they do not sit alongside it.

---

## Revision Note (v2.0) — read this before anything else below

Since v1.0 was written, the Orchestrator had an extended live design conversation with Arun that
resolved every one of v1's open questions — and in doing so **overturned two of v1's core assumptions
outright**. This is not an incremental refinement; it is a different feature shape wearing the same ID.

**What was wrong in v1, in Arun's own words, and why it matters:**

1. **v1 assumed "fully public, no auth" (its own Scope Question 1, answered "yes" by default).
   This is WRONG.** Arun, verbatim: *"this is for sales-admin and it is setup in my dummy account.
   once the demo is complete i am doing to ask you to turn it off or enable it only for a specific
   user account."* This is a **private** tool tied to Arun's own dummy channel-partner account — never
   a link handed to anonymous prospects, investors, or the open internet. Every one of v1's Known
   Constraints and Scope C content about "unbounded public billing/usage risk," rate caps, and a
   server-side-proxy-to-hide-credentials mechanism was solving a problem that no longer exists once
   the surface is private and dispatch is a deliberate manual action Arun personally takes (see
   correction 4). That entire risk category is **removed from scope in v2**, not carried forward.

2. **v1 assumed "throwaway, not persisted" (implicit throughout — "stable, fixed sample content,"
   no data-retention discussion at all). This is WRONG.** Arun, verbatim: *"i will keep this showcase
   for few more demos but the content i might change frequently based on the clients i am going to
   meet. but the overall activity and behavior is the same. anything i enter or save should not be
   deleted or removed until i say so."* Content is real, persisted, editable/overwritable across many
   future demo sessions, with **no automatic cleanup or expiry job.** "Not real production data" means
   the rows are isolated to Arun's dummy account and never touch a real client's billing or records —
   it does **not** mean the rows themselves are temporary.

3. **v1's framing of "purpose" was off.** v1 pitched this as an artifact for prospects/investors/
   partners to click on their own. Arun corrected this directly: *"this is only for demo to our
   salespartner showing how it works so this is one time only... in real sales partner scenario, this
   showcase screen does not exist. instead each sales-partner will directly use our api to pass the
   title, subtitle, content, urls or images of content that we need to share during the meeting. using
   this showcase we can also check our api's are working correctly."* It is Arun's own internal tool
   for (a) demonstrating live, to a prospective sales-partner he is personally talking to, exactly how
   the real API-driven integration works, and (b) exercising the real production API surface as an
   integration/regression check. No one else ever opens this page unattended.

4. **v1 speculated about a new, capped, credential-hidden dispatch mechanism (finding 5/6, Scope C).
   Not needed.** Confirmed directly in code (`lib/partner/session-schema.ts`, `CreateSessionSchema`):
   the real, already-live `POST /api/partner/v1/sessions` endpoint already accepts exactly the shape
   this brief needs — `meeting_url` + `content_pages: [{url, media_type, title?, subtitle?,
   transition_trigger}]` + `content_source_id`, plus top-level `title`/`subtitle`/`content_to_explain`.
   Arun will supply `meeting_url` himself and fire the actual dispatch **manually via Postman** when
   he's ready to demo live — not an automatic trigger the moment content is saved. Showcase's job is
   to **produce a valid payload in this exact shape and display it for Arun to copy** — not to build a
   second dispatch mechanism, a server-side proxy, or a rate cap. Since access is private and dispatch
   is Arun's own deliberate action, there is no anonymous-traffic cost exposure to guard against.

5. **v1 flagged transition-marker design as an open question (finding/Scope note about page
   advancement). It isn't one — this is existing B2B-19 machinery, reused verbatim.** Confirmed by
   reading `lib/content/transition-markers.ts`: each `content_pages[].transition_trigger` string a
   user writes is only an *intent label* (where to place a transition in the narration). The actual
   detection mechanism is a system-generated, collision-checked marker phrase (two uncommon words + a
   random digit tag, e.g. `"kestrel-vellum-9471"`) injected into the bot's narration and matched
   against the live transcript by word-token, ignoring digits/formatting. Showcase reuses this exactly
   as-is — no new design needed.

**What did NOT change, and is carried forward from v1 unmodified:** no domain/DNS changes; approved
libraries only; fluid/responsive layout with no hardcoded pixel-width caps; and the standing rule
against AI-generated content populating an undefined screen (see the clarified scope of that rule
under Non-Negotiables below — v2 narrows it correctly, v1 didn't anticipate the LLM topic-grouping
step at all).

Everything below this line is the v2 design. Where v1 language is reused, it has been corrected to
match.

---

## What Arun Said

Verbatim, 2026-07-19 (original ask, still the root of the feature): *"now that hello-clio is active and
working. i want to use distill-peach.vercel.app as the sales-partner portal which will push content to
the both through api and we will use few pages for visualization content also that we can render and
build this for the demo which we can show to others. what do you think"*

The Orchestrator's original domain-risk finding still stands and is still settled: `distill-peach
.vercel.app` is not a separate app, it's a second alias on the same deployment and is hardcoded as a
fallback URL in ~15+ live API routes (`app/api/partner/v1/sessions/route.ts:149` builds every
`render_url` from `process.env.NEXT_PUBLIC_APP_URL ?? 'https://distill-peach.vercel.app'`). Detaching
or repurposing that domain is out of scope. **This part of v1 is unchanged and settled — do not
re-open it.**

What changed is *where this lives and who can see it*, per the Orchestrator's subsequent live design
conversation with Arun (summarized in the Revision Note above): not a public `/showcase` route, but a
private tab inside Arun's own existing channel-partner dashboard.

---

## The Problem Being Solved (corrected in v2)

Arun needs a working tool, usable only by himself, to (a) show a prospective sales-partner — live, on
a call — exactly how the real Clio API integration works (push content in, get a rendered
visualization out, dispatch it into a real meeting), and (b) exercise the real `/api/partner/v1/*`
surface end-to-end as a lightweight integration check, since in the real production flow no partner
ever sees a UI like this — they call the API directly.

**Failure without this:** every demo requires either a live screen-share of `PlaygroundClient.tsx`
(raw JSON, no visual rendering, not built for a sales pitch) or hand-assembling a `content_pages`
JSON payload from scratch each time with no way to preview what it will render as before dispatching a
real bot.

---

## What Success Looks Like (corrected in v2)

- A new "Showcase" tab inside the existing `ChannelPartnerShell` (`app/dashboard/channel-partner/
  _shared.tsx`), visible only to Arun — gated by `requireChannelPartnerAdmin()` **plus** a new
  DB-backed allowlist check, so even other real channel-partner admins cannot see it.
- Arun can enter/edit a title, subtitle, and content body for his dummy channel-partner account, save
  it, and have it persist indefinitely — editable and re-savable across many future demo sessions, with
  no automatic deletion or expiry.
- From that saved content, Arun can trigger a real LLM call that groups it into 2–3 topics, then, per
  topic, paste a relevant excerpt and generate a real rendered visualization using the same production
  template pipeline real partner sessions use — each with its own public, no-auth, full-screen render
  URL.
- Once all topics are visualized, Showcase assembles and displays the exact, valid JSON payload for the
  real `POST /api/partner/v1/sessions` endpoint, ready for Arun to paste into Postman alongside his own
  `meeting_url` and fire manually when he's live with a prospect.
- The Orchestrator can flip Arun's access on/off, or restrict Showcase to a specific Clerk user ID,
  live — without a redeploy.

---

## Non-Negotiables Carried Forward From v1 (unchanged, still apply)

- No domain/DNS changes — this lives inside the existing hello-clio app regardless of the auth-model
  change made in v2.
- **No AI-generated content populating an UNDEFINED-content screen — clarified scope in v2.** This
  standing rule does **not** apply to the Visualization tab's real, Arun-requested LLM topic-grouping
  call. That is a genuine, explicitly-requested content-processing feature operating on content Arun
  himself entered and approved — not speculative filler auto-populating a screen whose content
  requirements were never defined. BA should make this distinction explicit in the spec so it isn't
  misapplied to block the one deliberate LLM call this brief calls for.
- Fluid/responsive layout, no hardcoded pixel-width caps (standing policy — this is new UI).
- Approved libraries only.

**Removed from scope in v2** (v1 carried these; they no longer apply once access is private and
dispatch is manual): the public/no-auth billing-risk requirement, the server-side dispatch proxy that
hides a credential from the browser, and any rate-cap/budget mechanism on the dispatch call itself.
None of these are needed — see Revision Note corrections 1 and 4.

---

## Ground Truth — Verified Directly by Reading the Code (v2, treat as fact, not speculation)

**1. `ChannelPartnerShell` and `requireChannelPartnerAdmin()` are real, live, and confirmed by direct
read.** `app/dashboard/channel-partner/_shared.tsx` exports `ChannelPartnerShell`; the channel-partner
dashboard tree (`clients/`, `settings/`, `team/`) already exists under `app/dashboard/channel-partner/`.
Showcase is a new sibling tab in this same shell, gated the same way plus the new allowlist.

**2. A Clerk user gets at most ONE `channel_partner`-kind `partner_accounts` row, ever, by design.**
Confirmed in `lib/partner/admin-accounts.ts`: `createOrClaimPartnerAccount`'s idempotency check
"guarantees a given Clerk user only ever gets ONE `partner_accounts` membership total, of either kind,
never both." **This means Arun's "dummy account" is not something this brief creates from scratch — it
is Arun's own existing single `channel_partner`-kind account**, resolved via
`getChannelPartnerAccountForClerkUser(clerkUserId)`. BA must confirm this account already exists
(from earlier B2B-26 dogfooding) and design Showcase to operate against it, not fabricate a new
`partner_accounts` row. This directly corrects v1 finding 2, which assumed no demo account existed
anywhere and specified creating one — that assumption predates the private, Arun's-own-account design.

**3. `CreateSessionSchema` (`lib/partner/session-schema.ts`) already accepts exactly the payload shape
this brief needs**, with a `.refine()` requiring `content_source_id` whenever `content_pages` is
provided (line 53–55). No schema changes needed — Showcase must produce a payload that satisfies this
schema as-is.

**4. The reuse target for the LLM topic-grouping call is `lib/partner/content-generation.ts`**, not the
retired B2C generator. The file's own header comment states this explicitly: `lib/content/generator.ts`
+ `lib/content/personalizer.ts` are confirmed NOT the reuse target (B2C, keyed to retired schema); the
correct pattern is `buildPartnerOutline()` (partner-scoped, no session/user continuity lookups) feeding
`generateTrainingScript()` → `generateTemplateData()`/`selectTemplate()` (from `lib/templates/
generator.ts`/`lib/templates/selector.ts`), all reused verbatim per this brief's design.

**5. `app/partner-render/[clio_session_ref]/page.tsx` is already public with zero Clerk auth, by
design** — confirmed in its own header comment: "Public, no Clerk session — loaded headlessly by the
meeting-bot's browser." This is the direct precedent for making each Showcase-generated visualization's
render URL public: Clio's own bot/rendering infrastructure must be able to fetch it exactly the same
way, and public-render-with-no-auth is not a new risk category in this codebase.

**6. `POST /api/partner/v1/content-sources` already exists and is live (B2B-19)** — confirmed at
`app/api/partner/v1/content-sources/route.ts`. Showcase needs exactly one `auth_type: 'none'`
registration against it, once, for Arun's dummy account, since Showcase-rendered URLs are same-origin
and publicly fetchable with no external auth needed.

**7. `lib/content/transition-markers.ts` exists and is the confirmed reuse target for per-topic
transition triggers** — see Revision Note correction 5 above.

**8. `SettingsClient.tsx` (`app/dashboard/channel-partner/settings/SettingsClient.tsx`) already
implements the dirty-state Save pattern** — confirmed present in this codebase, the correct precedent
for the Visualization tab's "Save disabled until textbox has content, re-enabled on any further edit"
requirement.

---

## The Confirmed Final Screen Design

### Content tab
Title / subtitle / content boxes (pre-fillable with sample text for convenience). Save persists to
Arun's dummy channel-partner account's own real content record — maps to `CreateSessionSchema`'s
top-level `title`/`subtitle`/`content_to_explain` fields. Persisted normally; no expiry; editable and
re-savable indefinitely (per Revision Note correction 2).

### Visualization tab
On open: a real Anthropic API call groups the saved Content into 2–3 topics, reusing the
`buildPartnerOutline`/`generateTrainingScript` pattern (ground truth 4). Topics render as clickable
links.

Clicking a topic opens a canvas plus a multi-line textbox below it, where Arun manually pastes a
relevant excerpt of the original Content for that topic. Save is disabled until the textbox has
content, and re-enables on any further edit — the same dirty-state pattern as `SettingsClient.tsx`
(ground truth 8).

Clicking Save runs the pasted excerpt through the real template pipeline
(`generateTemplateData`/`selectTemplate`) — title/subtitle inherited from the topic link — and renders
the result onto the canvas. This repeats independently per topic (2–3 times).

Each generated visualization gets its own unique, **public** (no-auth) full-screen render URL, shown
below its canvas — this is exactly one `content_pages[]` entry. This mirrors the existing
`/partner-render/[clio_session_ref]` public-by-design precedent (ground truth 5).

Arun writes a `transition_trigger` per topic (default suggestion auto-derived from the topic title,
e.g. "Now let's look at {topic title}" — editable). Actual marker generation/detection happens exactly
as it already does for real partner sessions (ground truth 7, Revision Note correction 5) — no new
mechanism.

### One real content_source registration
Register exactly one, `auth_type: 'none'`, for Arun's dummy demo account, once, via the existing real
`POST /api/partner/v1/content-sources` endpoint (ground truth 6).

### Final assembly
Once all topics are visualized, Showcase displays the exact `POST /api/partner/v1/sessions` JSON
payload (title, subtitle, content_pages array, content_source_id) ready to copy into Postman. Arun adds
his own `meeting_url` and fires it manually when demoing live to a prospect — no code needed for this
step; it's the real, existing, unmodified endpoint (ground truth 3, Revision Note correction 4).

---

## Access Control (new in v2, replaces v1's public-access design entirely)

DB-backed allowlist — **not an env var** — so the Orchestrator can flip access on/off, or restrict it
to a specific account/Clerk user ID, live, without a redeploy (per Arun's own words in Revision Note
correction 1: *"once the demo is complete i am doing to ask you to turn it off or enable it only for a
specific user account"*). Gate: `requireChannelPartnerAdmin()` **plus** this new allowlist check,
applied in that order, so even other genuine channel-partner admins cannot see the tab unless
explicitly allowlisted. BA to finalize exact schema (new small table vs. a column on the dummy
`partner_accounts` row) — see Scope for BA below.

---

## Scope for BA to Finalize as Technical Decisions (Section 11 should end up empty)

1. Exact schema/mechanism for the DB-backed access allowlist (new small table vs. a column on Arun's
   dummy `partner_accounts` row; how the Orchestrator updates it live going forward).
2. Exact route tree (e.g. `/dashboard/channel-partner/showcase`, `/dashboard/channel-partner/showcase/
   visualization`, public render at `/showcase/render/[pageId]` or similar — BA's call, follow existing
   route-naming conventions in this codebase).
3. Data model for persisted Content + per-topic Visualization records (new tables vs. reuse of existing
   `content_items`/`content_pages`-adjacent structures — BA to decide, but must NOT pollute real
   partner-content tables with demo rows from other real partners; keep this scoped strictly to Arun's
   single dummy channel-partner account's own id).
4. Exact LLM prompt/mechanism for the 2–3-topic grouping call.
5. Exact UI for the "copy this JSON payload" final-assembly panel.
6. Default `transition_trigger` suggestion string generation.
7. Confirm (quick DB check, not a product question) that Arun's dummy `channel_partner`-kind account
   already exists per ground truth 2, and resolve it by Clerk user ID rather than creating a new
   `partner_accounts` row.

---

## UX Requirement (per standing responsive policy)

This is new UI inside an existing, already-responsive shell (`ChannelPartnerShell`) — the standing
"fluid/tiered, no hardcoded pixel-width caps" policy applies (`CLAUDE.md`), consistent with however the
rest of `app/dashboard/channel-partner/*` already handles this. Not a new design-system brief — reuse
the channel-partner dashboard's existing visual language; no new visual direction is being invented
here.

---

## Governance

Per this project's CEO→BA→Dev gate, the Requirement Document is not yet needed — this is the CEO brief
(this task). Once written, this goes to the BA for the full 12-section Requirement Document, then back
to CEO for review, then Dev build, verified with `tsc --noEmit` + real `npm run build` + full test
suite, then push to production per Arun's standing "don't wait, push when ready" authorization.
Section 11 (Open Questions) must end up empty — everything in this brief is either settled by Arun's
own words (Revision Note) or a technical implementation detail within BA's discretion (Scope for BA
above); do not invent new product-shape questions that aren't already resolved above.

## Questions for BA

None outstanding — every product-shape question from v1 was resolved directly by Arun in the live
design conversation summarized in the Revision Note. Everything remaining is listed under "Scope for
BA to Finalize" above and is implementation detail within BA's discretion, to be resolved in Section 11
of the Requirement Document, not escalated.

---

Do not write code. Output only the Feature Brief markdown file.
