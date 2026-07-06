# Feature Brief: RETAKE-01 — "Retake This Session" for Completed Sessions

From: CEO (Arun)
To: Business Analyst Agent
Priority: P1
Date: 2026-07-06

---

## What Arun Said

Following SESSION-DURATION-01 (shipped last night), which blocks rejoining a session once its
`status` is `'completed'` — a deliberate fix for the real billing incident where re-entering an
ended call caused a duplicate 170-minute deduction — Arun asked, of a completed session: "why can't
I go through this again?"

We clarified directly with him. His answer, in his own words:

> "not the call, but he wants to take the session again then that user can.. we just need to send
> the prompt for that topic and send to clio for the session."

Confirmed explicitly: Arun does **not** want to reopen the same ended call (that would reintroduce
exactly the bug SESSION-DURATION-01 exists to prevent). He wants a **new** session/attempt on the
same topic — a new session record, a new live call, new billing — built the exact same way any
ordinary new session is built (assemble the topic's content into a prompt, hand it to Clio for a
live call), just re-using the same underlying topic instead of requiring the user to go back through
curriculum/scheduling from scratch.

## The Problem Being Solved

Right now, once a session is marked `completed`, there is no way for a user to revisit that
material through Clio again — the only path back to a given topic is through the original
curriculum flow, and SESSION-DURATION-01 correctly closed off re-entering the finished call itself.
That leaves a real gap: a user who wants to go through a topic a second time (e.g. they want a
refresher, they missed something, they want to bring a colleague through it again) has no
supported way to do that. The fix must not reopen the finished call — it must let the user start a
genuinely new one on the same topic.

## What Success Looks Like

- From a completed session's detail page, a user can trigger a "Retake this session" action.
- This creates a **brand-new session row** on the **same topic** — not a reopening of the old
  session — that goes through the same creation/content/provisioning pipeline as any normal new
  session, and is joined as a normal new live call.
- The retake is billed exactly like any other session (new minutes deducted for the new call). It
  must be structurally impossible to build a "free" retake by accident.
- The user ends up on a normal session-detail page for the new session, indistinguishable in
  mechanics from any other session Clio creates — same start flow, same billing flow, same content
  pipeline.
- Nothing about SESSION-DURATION-01's rejoin block is weakened, bypassed, or special-cased. The
  original completed session remains permanently un-rejoinable exactly as it is today.

## Known Constraints (from Arun, non-negotiable)

1. **Do not reopen the old call.** This is a brand-new session, not a bypass of the rejoin block.
   SESSION-DURATION-01's guard in `app/api/sessions/[id]/start/route.ts` must continue to reject any
   attempt to restart the original completed session, unchanged.
2. **Billing applies again, in full, exactly like a normal session.** Arun's own words confirm this
   — a retake is billed like any other session. No discount, no free replay, no special-cased
   minutes logic. The BA spec must state this explicitly so it can't be missed during build.
3. **Reuse the existing session-creation pipeline as much as possible.** Do not invent a parallel
   "retake pipeline." The same topic_id, the same content-assembly logic, the same provisioning path
   used for any ordinary new session should be reused, triggered from a different entry point (an
   existing completed session) rather than from the normal curriculum/scheduling flow.
4. **This is a genuinely new feature — take the time to get the design right, not a quick patch.**
   In particular the BA must resolve, with a clear recommendation and reasoning (not left open):
   - Whether a retake regenerates fresh content or reuses the completed session's exact generated
     content, given the existing content-caching design.
   - Whether any abuse/rate-limit guard is needed beyond the user's own minute balance as the
     natural limiter.
   - Whether the new session row needs a link back to the original (e.g.
     `retaken_from_session_id`) or can be an entirely ordinary new session sharing `topic_id`, and
     whether any downstream system (learner profile, curriculum tracking, the deferred-questions-
     carries-to-next-session logic just built) would benefit from knowing "this is a retake."

## Questions for BA

1. Confirm the right place in the product for this action — most likely a "Retake this session"
   button on `app/dashboard/sessions/[id]/SessionDetailClient.tsx`'s completed-session view. Confirm
   or find a better location if the existing UI doesn't naturally support it there.
2. Investigate and document, precisely, how a normal session is created end-to-end today (plan
   approval → session row insert → content pipeline → provisioning → joinable live call), and
   specify the minimal new entry point/trigger that reuses this pipeline for a retake instead of
   requiring the normal curriculum/scheduling flow.
3. Resolve the content-freshness question above with a concrete recommendation grounded in how the
   existing content cache is keyed and whether it has any staleness/versioning signal.
4. Resolve the schema question above (link column vs. plain new row) with a recommendation, and if a
   new column is recommended, specify the exact migration.
5. Define the exact new API route(s)/trigger, request/response shape, auth requirements, and error
   states (e.g. attempting to retake a session that isn't completed, attempting to retake while a
   retake is already in flight, insufficient minutes to even attempt a retake).
6. Define full acceptance criteria and edge cases, including: retaking a session whose topic's
   content has since changed, retaking the same session more than once, retaking while the user has
   zero minutes remaining, and confirming the original session's data/state is completely untouched
   by a retake.

No code should be written until this spec is complete, all six items above are answered, and the
CEO Agent has approved it.
