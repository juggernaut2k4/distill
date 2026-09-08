# Feature Brief: B2B-56 — Fan Out Session-Extracted Glitches to `glitch_instances`

From: CEO (Arun)
To: Developer Agent (no BA gate — see Governance Call)
Priority: P1
Date: 2026-07-30

---

## What Arun Said

"the conversational hiccups needs to come to admin dashboard for sure with the category (define the
category like derailment etc)." Confirmed by Arun as covering the item-2 admin subset he'd separately
mentioned — no separate work needed for that.

---

## The Problem Being Solved

Two systems exist and don't talk to each other, confirmed by direct code read:

- `glitch_instances` (Postgres table): written only by `app/api/partner/render/client-error/route.ts`
  (client-side technical crashes, `glitch_type: 'technical_error'`). Read by
  `app/api/admin/glitches/route.ts` and the admin `GlitchDashboardClient.tsx` — confirmed this endpoint
  now exists and returns real rows (verified directly, not assumed from the backlog note that it was
  once missing).
- `partner_session_insights.glitches` (jsonb): written by
  `inngest/partner-session-insights-extractor.ts` after every session ends. An Anthropic call already
  classifies each conversational hiccup into exactly one of five categories via `PartnerGlitchSchema`
  (line ~52-67 of that file): `misunderstanding`, `repetition`, `confusion_about_clio`, `derailment`,
  `other`. This data never reaches `glitch_instances` — confirmed zero references to that table name
  anywhere in the extractor file.

The admin route's own filter enum (`app/api/admin/glitches/route.ts` line 26) is
`z.enum(['misunderstanding', 'repetition', 'confusion_about_clio', 'derailment', 'other'])` —
byte-for-byte the same five values `PartnerGlitchSchema` already produces. **The category taxonomy
Arun asked for ("define the category like derailment etc") already exists on both ends; it just isn't
wired together.** This is a missing fan-out, not a missing design decision.

---

## What Success Looks Like

After a session ends and the insights extractor runs, every glitch in its `glitches[]` array also
lands as one row in `glitch_instances`, visible on the existing admin Glitches dashboard exactly like
today's technical-error rows — same table, same filters, same categories, no new screen.

---

## Known Constraints

- Reuse the exact insert shape `client-error/route.ts` already uses (lines ~94-117): look up
  `partner_sessions` by `clio_session_ref`/session id → get `id` + `partner_account_id`; compute
  `ordinal` as `max(existing ordinal for this session) + 1` (same pattern, no floor constant needed
  here — the floor in client-error's route exists to reserve low ordinals for technical errors
  specifically; a fresh sequential ordinal per session is fine for extractor-sourced rows); write
  `partner_session_id`, `partner_account_id`, `glitch_type` (the category from `PartnerGlitchSchema`,
  written verbatim — no remapping), `description`, `ordinal`, `extracted_at`.
- Insert one row per item in the `glitches[]` array, in array order.
- Must be non-blocking / best-effort like the client-error path — a `glitch_instances` insert failure
  must never fail the extractor's own success path (action items, learner insight still need to save).
- Do not touch `PartnerGlitchSchema`, the 5-category taxonomy, or the admin route's filter enum — they
  already match; nothing about the taxonomy needs defining or changing.
- Mock/placeholder glitches (`ANTHROPIC_API_KEY` not configured path, line ~99) should still fan out
  the same way — keeps dev/local behavior consistent with prod, and is a natural way to smoke-test the
  write path without a live session.

---

## Governance Call

**No BA Requirement Document needed — approved for immediate build.** This is a pure backend
data-completeness fix: no new screen, no new information architecture, no new taxonomy, no product/UX
decision. It fans an already-classified, already-approved data source into an already-shipped,
already-approved screen's existing table and existing pattern (mirrors `client-error/route.ts` almost
exactly). Squarely inside CLAUDE.md's "additions to an already-approved screen's existing pattern do
not need a BA spec" carve-out.

## Questions for BA

None — no BA involvement required.
