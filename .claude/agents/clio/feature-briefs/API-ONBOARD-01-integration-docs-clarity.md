# Feature Brief: API-ONBOARD-01 — Clarity pass on Integration + API docs/Playground

From: CEO (Arun)
To: Business Analyst Agent
Priority: P1
Date: 2026-09-06

## What Arun Said

"CEO agent review and ensure it's easy for the user to understand and use ours." — following the
session's walkthrough of what a newly-invited partner needs to understand right after
DOMAIN-GUIDE-01: the Integration section (get API credentials) and the API docs/Playground page.

## The Problem Being Solved

A newly-invited partner reaches `/dashboard/configurator/api` and sees a full technical endpoint
list (9 endpoints across 4 categories, plus a webhook doc) with no framing. Nothing tells them,
before the detail, that the whole integration reduces to two calls: one outbound (start a session)
and one inbound (receive the results). They have to reverse-engineer the mental model from reading
every endpoint. Separately, the Integration screen's "API base URL" card describes
`outbound_base_url` only as being for "delivering usage events" — it never mentions that this is
also how they receive the `learner_insight`/`action_items` payload that is the actual product value
of a completed session, so a first-time reader has no reason to think this field matters to them.

## What Success Looks Like

- A partner opens the API page and, before touching the endpoint list, understands: call
  `POST /api/partner/v1/sessions` to start a session (meeting URL + content pages); later, Clio
  pushes a `session.insights_ready` event to the base URL they configured on Integration, carrying
  the learner summary and action items; `GET /sessions/:id` is optional status-only, not a required
  third step.
- A partner reading the Integration screen understands `outbound_base_url` is where they receive
  that insights payload, not just an opaque "usage events" destination.
- The webhook signature-verification formula on the docs page has a one-line plain-language gloss
  next to it (what it's for), without diluting the precise formula a partner engineer needs.
- None of this changes any API behavior, webhook dispatch logic, or the billing/usage webhook
  framing — copy and layout only.

## Known Constraints

- Explicitly OUT OF SCOPE: the usage/billing webhook framing and behavior — Arun is discussing that
  caveat separately. `session.insights_ready` is one event type multiplexed onto the same webhook
  URL as the usage events; this brief documents that shared-URL/filter-by-`event_type` mechanic
  (necessary to explain the insights webhook honestly) but does not redesign or re-explain the
  billing-specific event types themselves.
- No new libraries, no backend/API route or `lib/partner/webhooks.ts` changes.
- Must match the existing component style (`Card`/`PrimaryButton`/`SecondaryButton` from
  `../_shared` on Integration; the existing inline-style, no-Tailwind pattern on the API page).
- Responsive/mobile-friendly standing rule applies to any screen touched.
- `npx tsc --noEmit` must stay clean.

## Questions for BA

None — this brief already resolves the product-shape ambiguity (placement of the quick-start
framing, and the scope boundary around the multiplexed webhook) per the CEO's authority to decide
UX/product shape when the underlying conversation with Arun already established the content
direction. See the Requirement Document for the resolved decisions, Section 11 empty.
