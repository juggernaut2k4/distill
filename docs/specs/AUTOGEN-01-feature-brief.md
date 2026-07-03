# Feature Brief: AUTOGEN-01 — Autonomous Plan/Session Generation & Verified Minute Billing
From: CEO (Arun)
To: Business Analyst Agent
Priority: P0
Date: 2026-07-02

Supersedes: PIPE-01 (two duplicate content pipelines). This brief fully absorbs PIPE-01 — the BA spec must resolve which pipeline is canonical and retire the other, not treat it as a separate backlog item.

---

## What Arun Said

1. User selects topics during onboarding.
2. Immediately after the user leaves the topic-selection screen (post signup/payment), the system starts generating LLM topics — based on profile, learning intent, prerequisites/dependencies, and related topics. No approval gate.
3. Once topics exist, sessions generate immediately using the ONE FIXED duration chosen at onboarding (5/15/30 min). No approval gate.
4. Because duration is fixed at onboarding, remove the duration selector from the plan screen — that screen should only let the user pick DAYS and TIME OF DAY.
5. Session titles generate without waiting for approval.
6. Session 1's content generates immediately. All other sessions' content generates via cron, one session per hour. No approval gate.
7. After plan approval, show the sessions list with ready / not-ready status per session. Clicking a ready session lets the user enter the meeting URL and start.
8. Clicking a not-ready session jumps the generation queue — triggers immediate on-demand generation for that one session (ahead of its normal hourly turn), shows a spinner/progress UI with a green checkmark per completed section, then unlocks the meeting-URL entry once fully ready.
9. Timer functionality must determine real meeting minutes used and deduct from the user's balance.
10. (Superseded by #12 — context only, not an independent requirement.)
11. Consumed minutes must be stored in a DETAILED, timestamped audit log — connect time, speak-ready time, disconnect time, gaps — not just a final total. This must be defensible against user disputes because it is money the user is paying for.
12. AUTHORITATIVE RULE — Clio must warm up and fix page resolution before joining the meeting, then screen-share. The minutes counter starts ONLY once Clio is confirmed able to actually speak, verified via a 200 status code on the relevant voice connection — NOT on bot-join, NOT on screen-share-start. This is the one true billing-start trigger.

---

## The Problem Being Solved

Two separate problems, both P0:

**A. Generation is approval-gated and sequential where it should be autonomous and parallel.** Today, only Session 1's content pre-generates (via the legacy `session-content-async.ts` pipeline, triggered from `session-designer-auto.ts`). Sessions 2–N only start generating at `/api/plan/approve` — meaning the user can approve a plan and then wait, session by session, for content that should already have been building in the background since topic selection. This directly contradicts Arun's "no approval needed" rule for topics, session titles, and Session 1 content, and his "cron, one session per hour" rule for the rest. There are also two divergent code pipelines doing overlapping work (`session-content-pipeline.ts` canonical/atomic-with-QA vs. `session-content-async.ts` legacy) — this is PIPE-01, and it must be resolved as part of this feature so there is one system of record for "is this session's content ready."

**B. Minute billing is not trustworthy.** Today the clock starts at `POST /api/sessions/[id]/start`, fired the moment the Recall.ai bot joins the meeting — with no check that Clio can actually speak. There is no concept of "voice-connection-verified" anywhere in the code. Billing math is a single elapsed-time subtraction at `/end` (`Date.now() - started_at`, rounded up) with zero intermediate audit trail. If a user disputes a charge, there is nothing to show them except a single number. Since Arun has explicitly said the minute counter must start only on a verified 200-status voice-speak confirmation, and must be defensible with a timestamped log, the current implementation is a billing-accuracy risk, not just a UX gap.

---

## What Success Looks Like

- The moment a user leaves the topic-selection screen, topic generation kicks off automatically in the background — no user action, no approval screen blocking it.
- Session generation (titles + full content) begins immediately after topics exist, using the single onboarding-selected duration. The plan/approval screen no longer has a duration control — only day-of-week and time-of-day pickers.
- Session 1's content is ready by the time the user reaches the sessions list (or very shortly after). Sessions 2–N generate steadily in the background at one-per-hour via cron, without requiring the user to approve anything to trigger them.
- After approval, the sessions list clearly shows ready vs. not-ready per session. A ready session lets the user immediately enter a meeting URL and start. A not-ready session, when clicked, jumps the generation queue, shows live per-section progress (spinner + checkmarks), and unlocks the meeting-URL field the moment it finishes — without waiting for its scheduled cron hour.
- There is exactly ONE content-generation pipeline in the codebase. The legacy pipeline is retired or fully merged into the canonical one. PIPE-01 is closed.
- The minutes counter starts only when Clio's voice connection returns a verified "can speak" signal (200-equivalent) — never at bot-join, never at screen-share-start.
- Every session produces a detailed, timestamped audit record: bot-join time, voice-connect time, speak-ready time (billing start), any gap/reconnect events, disconnect time (billing end), and the final computed minutes. This record is queryable and precise enough to resolve a billing dispute without engineering involvement.

---

## Known Constraints

- Duration is fixed once at onboarding (5/15/30 min) via the existing `learningGoal` → `getSessionDuration()` mapping in `lib/curriculum/session-designer.ts`. Do not introduce a second duration input anywhere downstream.
- No approval gate may block: topic generation, session title generation, or Session 1 content generation. Approval only gates the schedule (day/time) and the session becoming visible/startable in the dashboard flow as it does today.
- Billing-start signal must be uniform across both currently-supported voice providers (ElevenLabs and Hume) even though their SDKs expose readiness differently today (ElevenLabs: `conversation.isOpen()`; Hume: `onConnect` on `chat_metadata` vs. `onModeChange('speaking')` on `assistant_message`). The BA and engineering must design one canonical signal, not two divergent billing behaviors per provider.
- Do not conflate this work with the Hume voice-connection bug fixed earlier in this session (unrelated, but touches adjacent code — coordinate carefully to avoid regressions).
- No audit/minutes-history table exists today — schema design for it is explicitly BA/engineering scope, not decided in this brief.
- Session-detail routes (`generate-content`, `start`, `end`, `meeting-url`) currently check only session ownership, not plan-approval state — closing this gap is in scope since it's directly adjacent to "jump the queue" and start-gating logic.

---

## Questions for BA

1. **Uniform billing-start signal across providers.** Design the exact mechanism that produces a single "speak-verified" event for both ElevenLabs (`isOpen()`) and Hume (`onConnect`/`onModeChange('speaking')`) adapters. Should this be a new shared adapter-interface method (e.g. `onSpeakVerified(cb)`) that both implementations must satisfy? What is the actual "200 status code" Arun is referring to for each provider's underlying connection handshake — confirm with Arun if the literal HTTP semantics differ from what "200" implies for a WebSocket-based provider.
2. **Audit log schema.** Design the new table (e.g. `session_minutes_audit` or similar) — columns needed at minimum: session_id, event_type (bot_joined, voice_connect_attempt, speak_verified, gap_start, gap_end, disconnected), timestamp, provider, raw status/response captured. Confirm retention policy and whether this must be exposed anywhere in UI (e.g. billing page transparency) or is purely internal/support-facing.
3. **PIPE-01 resolution.** Confirm: is `session-content-pipeline.ts` (atomic, QA-checked) the surviving canonical pipeline, with `session-content-async.ts` fully retired and its call sites (`generate-content-async` trigger in `session-designer-auto.ts`, the on-demand route in `app/api/sessions/[id]/generate-content/route.ts`, and any `async_jobs`-based polling UI) migrated to the canonical event (`distill/session.content.generate`)? Flag any feature only the legacy pipeline has (e.g. batch-of-3 progress increments) that the canonical pipeline needs to gain for parity with the "per-section progress" requirement in #8.
4. **"Jump the queue" progress UI granularity.** Arun wants a spinner + green checkmark per completed "section." Define what a "section" is in UI terms — is it per-subtopic (article generated → script+viz generated → template rendered → cached) or a coarser per-subtopic-complete checkmark? This determines whether the pipeline needs to emit intermediate progress events per step or just per subtopic.
5. **Cron cadence enforcement + queue-jump interaction.** When a not-ready session is jumped ahead of its hourly turn, does that change or delay the hourly cadence for the remaining queued sessions, or does the cron simply skip any session that already became ready via jump? Confirm expected behavior so BA can spec the queue/cron interaction precisely.
6. **Plan-approval gate on session routes.** Confirm scope: should `/api/sessions/[id]/generate-content`, `/start`, `/end`, `/meeting-url` all require the parent `curriculum_plan.is_approved = true`, or only some of them? (e.g., should on-demand generation be allowed pre-approval since generation itself is unapproved-by-design, but `/start` blocked until approval?)
7. **Backfill/migration for existing sessions.** Do users who already have plans/sessions under the current (approval-triggered) generation model need any migration, or does this apply prospectively only to new plans going forward?
8. **Billing dispute UX.** Is there a user-facing or support-facing surface planned for viewing the audit trail (e.g., an admin tool), or is Phase 1 scope just "capture it correctly" with no UI, deferring any display surface to a later feature?

---

## Priority & Sequencing Note for BA

This is P0 because part B (billing accuracy) has real financial/trust exposure with users being billed today via a mechanism Arun has explicitly said is wrong (billing starts at bot-join, not verified speak-readiness). Please sequence the requirement document so Part D (billing) has fully unambiguous acceptance criteria — including exact state-machine transitions, exact SQL/audit-write points, and exact fallback/error behavior if a voice connection never reaches "speak-verified" (e.g., timeout handling, partial-minute billing, refund path) — since this is the section most likely to be scrutinized after ship.
