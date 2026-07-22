# Feature Brief: B2B-32 — Internal Content Test Harness (`test.hello-clio.com`)

From: CEO (Arun)
To: Business Analyst Agent
Priority: P1 — internal test/QA tooling, not a partner-facing feature and not on the critical path
for a committed external deadline, but Arun wants it built now to validate the real B2B-19 content
pipeline end-to-end. Sequence after any in-flight P0 work.
Date: 2026-07-21

---

## What Arun Said

Verbatim, across two messages in the same session, 2026-07-21 (dates approximate to session context):

**Message 1:** *"ok cool. now i want to create a partner portal separately not part of hello-clio.
i will need a web page that has a text box for title, sub-title, text content of the topic, few
screens with the visualization content - we can build few with html page and one with image so we
can test all those ones out. then with that real information we can pass those details as an api to
the bot and lets check if this is working. no tell me how do you think we can do, what is your
approach. can we create sub-domain within hello-clio so we can use it for demo alone. what is your
thoughts"*

**Message 2 (approval, after the Orchestrator's analysis below):** *"ok agreed lets build
test.hello-clio.com. route through ceo -> ba and build it"*

The Orchestrator's analysis that Arun approved (relayed here as input for the BA to work from, not as
a pre-decided spec): host it as a subdomain, `test.hello-clio.com`, inside the existing Next.js app /
Vercel project — reusing existing partner-API, auth, and DB infrastructure — rather than a fully
separate app/deployment. This was framed as a recommendation, not dictated by Arun verbatim; Arun's
"ok agreed" approves the subdomain-in-existing-app approach specifically, not any other detail of the
Orchestrator's analysis.

---

## The Problem Being Solved

Arun needs a way to pressure-test the real partner content-delivery pipeline (B2B-19: partner supplies
title/subtitle/content + a set of visualization "screens" with transition triggers → Clio's API
assembles a session payload → the bot renders and narrates through the screens live) using
**deterministic, hand-authored fixtures** instead of the AI-generated content path.

Today, verifying that pipeline requires either a live screen-share of the raw JSON in
`PlaygroundClient.tsx`, or hand-assembling a `content_pages` payload from scratch with no way to
author or preview screens first. B2B-31 (Showcase) is adjacent but solves a different problem — it is
AI-driven (LLM topic-grouping over free-text content), lives inside the partner-facing
`ChannelPartnerShell` dashboard on Arun's dummy channel-partner account, and is scoped as a live sales
demo tool. What Arun is describing here is different in kind: manually authoring exact HTML pages and
at least one raw image as fixed "screens," with no LLM step in between, specifically to isolate and
test whether the real API → bot rendering pipeline itself works correctly — independent of content
generation quality. It should also live outside the partner dashboard entirely, on its own subdomain,
so it's never reachable from or confusable with any partner-facing surface.

**Failure without this:** there is no repeatable, deterministic way to regression-test the B2B-19
content-delivery contract (URL fetching, auth handling, transition-marker triggering, image vs. HTML
page rendering) independent of AI-content variability — every test today is either ad hoc or
contaminated by LLM output variance.

---

## What Success Looks Like

- A new, separate internal-only surface reachable at `test.hello-clio.com`, running inside the
  existing Next.js app/Vercel project (not a new repo or deployment) — per Arun's approved approach.
- Not part of, not linked from, and not reachable through the partner-facing dashboard or
  `hello-clio.com` marketing/product surfaces. This is Arun's own tool, not something any real
  partner account should ever see or reach.
- A simple form lets Arun enter: a title, a subtitle, and body text content for "the topic."
- Arun can author several visualization "screens" for that topic — deterministically, not
  AI-generated:
  - Some screens authored as raw/pasted HTML (Arun writes or pastes the markup directly).
  - At least one screen as an uploaded image.
- From that hand-authored content, the tool assembles a real, valid payload against the actual
  partner content-delivery API contract (B2B-19 — the same `POST /api/partner/v1/sessions` shape real
  partners use: `content_pages: [{url, media_type, title?, subtitle?, transition_trigger}]` etc.) —
  not a parallel/mock API.
- Arun can use that assembled payload to actually dispatch a real session against the real pipeline
  and confirm the bot renders and transitions through the hand-authored screens correctly.
- The tool has its own simple access control scoped to Arun only — this is an internal test harness,
  not a customer-facing or partner-facing product surface, and must not be reachable by any real
  partner or unauthenticated visitor.

---

## Known Constraints

1. **Must be reachable at `test.hello-clio.com`** as a subdomain of the existing `hello-clio.com`
   Vercel deployment — not a new app, not a new repo, not a separate hosting setup. This is what Arun
   explicitly approved in Message 2.
2. **Must not be part of, or reachable from, the partner-facing dashboard or UI.** No nav link, no
   shared shell with `ChannelPartnerShell`, no overlap with B2B-31 Showcase's surface.
3. **Must reuse the real partner content-delivery API contract (B2B-19)** rather than inventing a
   parallel/mock one — the entire point is testing the real pipeline partners will actually use.
4. **Check B2B-05's Vercel Domains API subdomain-provisioning pattern as prior art before designing
   routing.** B2B-05 built dynamic, per-partner subdomain provisioning
   (`<partner-slug>.<clio-root-domain>`) via the Vercel Domains API for white-label hosting. This is a
   fixed, single, internal subdomain (`test.hello-clio.com`) — not a per-partner dynamic one — so it
   may not need the same dynamic-provisioning machinery at all. The BA should confirm whether
   `test.hello-clio.com` can be a simple static domain/DNS entry pointed at the same Vercel project
   (reusing existing host-based middleware routing patterns if B2B-05 already built any), or whether
   there's a reason it needs the dynamic path. Do not assume B2B-05's full mechanism is required
   without checking first.
5. **Approved libraries and security standards from `CLAUDE.md` apply in full** — including the rule
   that `dangerouslySetInnerHTML` requires explicit sanitization. Since this feature's core purpose is
   rendering Arun's own hand-pasted raw HTML as visualization screens, the BA must define exactly how
   that HTML is rendered safely (sanitization approach, or an isolation mechanism such as a sandboxed
   iframe/served-as-static-asset pattern) rather than leaving it to the developer to improvise. This is
   a real security-relevant gap the spec must close, not an open question left for build time.
6. **Access control is single-user internal, not a new auth product surface.** This does not need
   Clerk partner-admin account infrastructure — the BA should define the simplest access-control
   mechanism appropriate for "only Arun can reach this" (e.g., a shared secret, an allowlisted Clerk
   user ID reusing existing auth, or IP/basic-auth gating), consistent with how B2B-31 gated Showcase
   access, and should note that trade-off explicitly rather than defaulting to the heaviest option.
7. **No AI-generated content on this surface.** Unlike B2B-31 (which has one deliberate, explicitly-
   requested LLM topic-grouping step), this tool's entire value proposition is deterministic,
   hand-authored fixtures. No LLM call should populate any part of what gets sent as the test payload.
8. Standing responsive/mobile-friendly policy and fluid-layout rule (no hardcoded pixel-width caps)
   apply — this is new UI.

---

## Questions for BA

1. What's the minimal viable data model for a "test topic" (title, subtitle, body text, N screens
   each either `html` or `image` type, transition-trigger label per screen) — should this be new
   tables, or does it fit inside existing B2B-19 content-source/content_pages infrastructure reused in
   test mode?
2. How should hand-pasted HTML screens actually be served/rendered so the bot's headless-browser
   fetch (per B2B-19's existing content-fetching mechanism) can load them as a URL — e.g., persisted
   and served from a route under `test.hello-clio.com` itself, or from existing object storage
   (Supabase Storage)? Confirm this against how B2B-19 already fetches partner-supplied `content_pages`
   URLs today.
3. Where do uploaded images get stored, and what constraints (size, format) apply?
4. What is the exact routing/middleware mechanism for `test.hello-clio.com` — static DNS entry to the
   same Vercel project plus a Host-header check in `middleware.ts`, or does it need anything from
   B2B-05's dynamic subdomain machinery? (See Known Constraint 4 — investigate before deciding.)
5. What access-control mechanism is simplest and appropriate here, given this is single-user and
   internal (see Known Constraint 6)?
6. Exact HTML-rendering-safety mechanism for pasted screens (see Known Constraint 5) — sanitization
   library/approach, or structural isolation (sandboxed iframe, static-asset serving with strict CSP)?
7. Data retention: should test topics/screens persist indefinitely like B2B-31's Showcase content
   (editable, no auto-expiry), or is this meant to be more disposable/scratch? Not stated by Arun —
   needs to be asked directly if the BA can't infer a safe default, per the "ambiguous UX = stop"
   standard.
8. Exact payload assembly / dispatch UX: does Arun want a "copy JSON payload to fire manually via
   Postman" pattern (as B2B-31 Showcase uses), or an in-tool "dispatch now" button that calls
   `/api/partner/v1/sessions` directly? Arun's Message 1 says "then with that real information we can
   pass those details as an api to the bot and lets check if this is working" — this reads as wanting
   an actual dispatch capability, not just a payload preview, but the exact mechanism (in-tool button
   vs. copy-to-Postman) is not stated and should be confirmed rather than assumed.

---

## Note to BA

This is a new internal tool with no existing UI to extend (unlike B2B-31, which extended
`ChannelPartnerShell`). Per the CEO/BA governance model, do not let any screen in this spec go out
with fewer than 3 lines of description or no example — this is exactly the kind of net-new,
Arun-only tooling where an under-specified screen either gets built wrong or ends up half-improvised
by a developer. Take the time to fully document the topic-authoring form, the screen-authoring flow
(HTML vs. image), and the payload-review/dispatch screen with concrete examples before this goes to
Section 11 review.
