# Feature Brief: B2B-57b — Reseller Dashboard: Webhook Delivery / Usage Log View

From: CEO (Arun)
To: Business Analyst Agent
Priority: P2
Date: 2026-07-30

---

## What Arun Said

"if the session is a real session passed by the reseller then it has to be sent to reseller api and
lives in reseller dashboard." This is the second half of the voice-minute-webhook instruction covered
in B2B-57a — the real (non-demo) case.

---

## The Problem Being Solved

For real reseller sessions, `usage.voice_minute` webhook events are dispatched (mechanism already
built — `lib/partner/webhooks.ts`) toward the reseller's own configured `outbound_base_url`. Today, no
reseller has that URL populated (confirmed: `outbound_base_url` is NULL for every account except the
one internal demo account, which has none either) so nothing has actually been delivered over the wire
to a real partner yet — but the dispatch records themselves (`webhook_dispatch_log`, real field values)
exist and accumulate regardless of whether outbound delivery is configured. There is currently **no
screen anywhere** that lets a reseller see their own usage/webhook history inside their own dashboard —
the 3-surface Configurator/API/Docs dashboard from B2B-16 has no such view today.

---

## What Success Looks Like

A reseller can open their own dashboard and see a real, readable log of the usage events Clio has
recorded and (once configured) dispatched for their account — session reference, minutes, generation
type, mode (live/test), timestamp, delivery status if relevant — sourced from real
`webhook_dispatch_log` rows for their `partner_account_id`, not mock or placeholder data.

---

## Known Constraints

- Reseller-facing and billing-adjacent — must not show other partners' data (standard multi-tenant
  isolation already enforced elsewhere in the dashboard; this screen inherits that, doesn't invent it).
- Must handle the current real-world state gracefully: most/all partners will have zero webhook
  history today (no `outbound_base_url` configured anywhere yet) — empty state needs to be defined, not
  left to the developer to guess.

---

## Governance Call

**Needs a full BA Requirement Document before any build — this is genuinely new information
architecture, not an extension of an approved pattern.** Unlike B2B-57a (which slots new fields into an
already-shipped table on an already-approved screen), this is a screen or section that does not exist
anywhere today. Open product-shape questions a BA spec must resolve before a developer touches this:

1. Which of the 3 dashboard surfaces (Configurator / API / Docs) does this belong on, or is it a 4th
   surface / new nav item?
2. What does the empty state say and look like, given essentially every partner will hit it today
   (zero `outbound_base_url` configured anywhere)?
3. Pagination / date-range filtering — how far back, how many rows per page?
4. Exact field set and labels for a reseller audience (different framing than the internal admin
   Glitches dashboard or the demo Performance tab — this is the partner's own record of what they were
   billed for, so it reads more like a billing/usage statement than a debug log).
5. Does "delivery status" (whether the webhook actually reached their endpoint) belong on this screen,
   or is that a separate concern? If shown, what does a failed-delivery row look like and is there a
   retry affordance, or is that out of scope for v1?
6. Any relationship to B2B-04/B2B-12's wallet/billing UI already on the reseller dashboard — should this
   usage log live near that, or is it a fully separate nav item?

Per CLAUDE.md's gate: no code until all of the above are resolved in an approved 12-section spec with
Section 11 (Open Questions) empty. Flag to BA for dispatch.

## Questions for BA

See "Governance Call" above — those six questions are exactly what the Requirement Document needs to
answer before this returns to CEO for approval.
