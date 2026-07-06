# Feature Brief: Retake a Completed Session
From: CEO (Arun)
To: Business Analyst Agent
Priority: P1
Date: 2026-07-06

## What Arun Said
"A completed session can't be rejoined (by design, to prevent double-charging). I want a way for
the user to take that session's material again as a brand-new attempt — new session, new call,
new billing, same topic." Confirmed 2026-07-06 via CEO: this is a NEW session + NEW call reusing
the same topic, not reopening the ended one — must not touch the billing-safety fix from
SESSION-DURATION-01 (the `status === 'completed'` hard-block in `/api/sessions/[id]/start`).

## The Problem Being Solved
Users can't currently revisit material from a session they already completed and were billed for.
If they want to go through it again (e.g. they didn't retain it, wanted to explore differently,
or a colleague joined late), there's no path — the completed session is permanently frozen. This
under-serves a paying user who legitimately wants more time with the same topic.

## What Success Looks Like
From a completed session's detail page, the user can click "Retake this session." This creates a
brand-new session row (new UUID, new Meet link, new bot join, own billing against
`minutes_balance`) scoped to the *same topic* as the original. The user does not lose or overwrite
the original completed session's record, transcript, or deferred questions. The retake goes through
the existing scheduling → content-ready → live-session pipeline like any other session.

## Known Constraints
- MUST reuse the existing pipeline (session-designer/content-pipeline/meeting-setup/start/end) as
  much as possible — no parallel bespoke system.
- MUST NOT weaken or bypass the `status === 'completed'` restart block in
  `/api/sessions/[id]/start` — that block stays exactly as is; retake creates a *new* row instead.
- MUST bill independently — retake consumes the user's own `minutes_balance` like any session,
  no special-casing or discount.
- Original completed session (transcript, deferred_questions, duration_mins actually billed) must
  remain untouched and fully intact after a retake is created and/or completed.

## Questions for BA — resolve all, zero open questions allowed in the spec

1. **Entry point placement and UX:** Confirm `app/dashboard/sessions/[id]/SessionDetailClient.tsx`
   is correct. Define exactly what the button looks like, where it sits (near the existing Actions
   row, or as its own card), what it says, what happens on click (confirmation modal? immediate
   nav?), and what the user sees while the new session is being provisioned (session-designer +
   content pipeline both take real wall-clock time — define the loading/redirect UX).
2. **Content reuse vs regeneration:** `session-content-pipeline.ts` keys `topic_content_cache` by
   `topic_id = sessionId` (the row's own UUID) — NOT by a shared topic slug. This means a retake
   with a fresh session UUID will trigger full regeneration by default. Decide and document: does
   a retake (a) copy/clone the original's `topic_content_cache` rows to the new `topic_id` (fast,
   consistent, no new LLM spend, but content is byte-identical to what user already saw), or
   (b) regenerate fresh content via the normal `distill/session.content.generate` event (new LLM
   spend, possibly different content each retake, matches "brand-new attempt" framing more
   literally)? State the recommendation and reasoning explicitly — this is a real fork with cost
   and product-feel implications, not a coin flip.
3. **Abuse / rate-limit guard:** Is the user's own `minutes_balance` sufcient gating (a user with
   real money on the line has no incentive to abuse this), or does unlimited retake-spawning need
   a guard (e.g. max N retakes per original session, cooldown between retakes)? Recommend a
   specific limit or explicitly recommend none, with reasoning tied to the billing model.
4. **`retaken_from_session_id` linkage:** Confirm the new session row needs a
   `retaken_from_session_id` FK-style column pointing at the original completed session. Define:
   migration needed, whether it's nullable/indexed, and whether downstream systems should read it —
   specifically (a) the deferred-questions-next-session logic in
   `app/api/defer-question/route.ts` / `SessionDetailClient.tsx`'s "Saved for Follow-up" display,
   and (b) curriculum/learner-profile tracking (`lib/learning/user-profile.ts` and the sequencing
   logic in `session-designer-auto.ts`). Recommend concretely whether a retake should inherit the
   original's deferred questions as its own starting agenda, and whether learner-profile tracking
   should treat a retake as "additional exposure to topic X" (reinforcing mastery signal) vs a
   wholly independent session.
5. **Which existing routes/files change:** Enumerate every file that needs to change (new API
   route to create the retake, migration for the new column, SessionDetailClient.tsx button +
   state, any session-designer-auto.ts / session-content-pipeline.ts changes needed to support
   cache-copy if (2) resolves that way).
6. **Session numbering / display:** How does `session_index` get assigned for a retake (next
   global index, or a sub-index like "Session 3 (Retake)")? How is it labeled in the sessions list
   and on the detail page so it's visually distinct from a first-time session?

Per the standing rule from Arun (2026-07-04): do not regress existing topic selection, LLM topic
generation, or session generation in solving this. Flag — do not silently make — any change to
existing code paths outside the new retake flow.
