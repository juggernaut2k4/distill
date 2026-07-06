# Feature Brief: Hume Config Lifecycle Consolidation (read/query + delete + builtin_tools fix)
From: CEO (Arun)
To: Business Analyst Agent
Priority: P1
Date: 2026-07-05

## What Arun Said

Verbatim intent, as relayed:

> Everything needs to be consolidated into one properly-specified system, not scattered ad-hoc
> pieces. The application itself must always be able to read the full details of any config AND
> its transcript — not just via a temporary debug hack — this should be a permanent, proper part of
> the app, reusable for future diagnosis. The application must delete configs once their useful
> life is over (confirm whether the nightly job already covers this, or whether a more general/
> on-demand deletion capability is also needed). "You need not show me but if I ask I need the
> answers" — this data doesn't need a user-facing UI, but must be reliably queryable/answerable on
> request, properly persisted, not dependent on live Hume API calls that could 401 without the
> right sandbox/credentials (the exact problem hit today). Specify this properly via the CEO→BA
> chain now, building ON TOP of what's already shipped — not throwing it away and starting over.

## The Problem Being Solved

Today, the only way to inspect a Hume Config's full details (voice, language model, tools,
builtin_tools) or diff it against the base production config is `app/api/debug/hume-chat/route.ts`
— a file explicitly commented "DELETE THIS FILE after debugging is complete" that was built ad hoc
mid-incident. It makes a **live** call to Hume's REST API every time, which means:

- It has no durability — if Hume 401s (wrong sandbox/env credentials, as happened today) or the
  Config has already been deleted by the nightly cleanup job, the answer is simply unavailable.
- It duplicates read capability that partially already exists in durable form: the nightly cleanup
  job (`inngest/hume-native-nightly-cleanup.ts`) already archives every eligible session's full
  Config snapshot and full transcript into `hume_native_config_archives` before deleting the
  Hume-side Config. That table is the right long-term source of truth for anything already
  archived — but there is no query surface (function or route) built on top of it.
- It is marked as throwaway, yet is doing something the product now needs permanently. Leaving it
  as-is means the next engineer either deletes genuinely-needed capability (per its own comment) or
  keeps relying on a file that was never designed to be depended on.

Separately, a known and already-diagnosed bug sits inside `config-provisioner.ts`: the
`builtin_tools` array is hardcoded to `[{ name: 'hang_up' }]` when reconstructing each per-session
cloned Config, silently dropping `web_search` even when the base production config
(`4e0c7e15-bb03-40b2-aded-21813f19fc8d`) has it enabled. This has been sitting un-fixed since it was
found and is small and contained enough to bundle into this same consolidation pass.

## What Success Looks Like

After this ships:

1. Arun (or a future investigation) can ask "what were the exact Config details and full
   transcript for session X" and get a reliable answer, sourced first from
   `hume_native_config_archives` (fast, no live Hume dependency, works for anything the nightly job
   has already processed), with a clearly-scoped fallback path for sessions from earlier the same
   day that the nightly job hasn't reached yet (live Hume fetch, using the app's own
   `HUME_API_KEY` from `process.env`, not a human running an ad-hoc curl).
2. This capability lives as a proper, permanent internal function/endpoint — not a file whose own
   comment says to delete it. No debug-labeled file is left doing production-relevant work.
3. There is one clear, specified answer for "does deletion coverage need anything beyond the
   nightly job" — either "no, nightly job coverage is sufficient, confirmed for these reasons" or a
   scoped on-demand deletion capability is added, but not both left ambiguous.
4. The per-session Hume Config clone always includes `web_search` in `builtin_tools` whenever the
   base config has it (matching base config behavior, not silently dropping it).
5. None of this touches the nightly job's existing cron schedule, eligibility logic, or archive-
   before-delete ordering — it is additive, built on top of what already exists and is already
   working.

## Known Constraints

Non-negotiable, carried forward from the existing HUME-NATIVE-01 work and Arun's explicit
instruction:

- Never touch the base production config (`4e0c7e15-bb03-40b2-aded-21813f19fc8d`) except to read it.
- Archive-before-delete ordering must be preserved everywhere Config deletion happens (already
  enforced in the nightly job; any new deletion path, if specified, must follow the same ordering).
- Per-session failure isolation — one session's failure (read, archive, or delete) must never break
  processing for any other session.
- No deletion of existing code, tables, or the debug endpoint's capability without explicit
  approval — this brief authorizes *consolidating* the debug endpoint's capability into a proper
  permanent home, not deleting functionality. If the BA spec concludes the file itself should be
  removed once its logic is absorbed elsewhere, that removal must be called out explicitly and
  approved, not silently dropped.
- Secrets only from `process.env` (`HUME_API_KEY`) — never logged, never exposed in responses.
- No user-facing UI required for this feature. Backend/internal-only, per Arun's explicit "you need
  not show me" — but the answer must be reliably producible on request.
- Out of scope: rebuilding or modifying the nightly cleanup job's core cron schedule, eligibility
  query, or archive/delete step logic. Only touch it if this brief's scoping decision (Question 2
  below) specifically requires an addition to it — and even then, prefer a new, separate function
  over editing its existing logic.

## Questions for BA

1. **Query surface shape** — should the permanent capability be (a) an internal API route (e.g.
   `app/api/internal/hume-native/session-details/route.ts` or similar, callable but not linked from
   any UI), (b) a plain library function under `lib/voice/hume-native/` callable from scripts/other
   server code, or (c) both (a thin route wrapping a lib function)? Recommend (c) for reusability
   plus easy on-request querying, but define the exact contract (input: session_id or config_id;
   output: archived snapshot + transcript, or live-fetched equivalent + a flag indicating which
   source was used).
2. **Archived-first, live-fallback logic** — specify exactly: for a given session_id, check
   `sessions.hume_config_archived_at`; if set, read from `hume_native_config_archives` (by
   `session_id`); if null, fall back to live Hume fetch using `hume_config_id`/`hume_chat_id` off
   `sessions` (confirm those columns exist and are populated pre-archive — verify against
   `config-provisioner.ts` and the session creation path). Define the exact error contract if the
   live fallback itself 401s or the config was already manually deleted outside the nightly job.
3. **Deletion coverage sufficiency** — confirm explicitly whether the nightly job's existing
   "archive then delete, sessions ended >1hr ago" coverage is sufficient as the sole deletion
   mechanism, or whether Arun's phrasing ("the application must delete configs once their useful
   life is over") implies an additional on-demand/manual deletion capability (e.g. for a
   specific session by id, outside the nightly cadence). If added, it must reuse the same
   archive-before-delete ordering and failure-isolation rules — do not duplicate that logic, extract
   a shared helper if needed.
4. **builtin_tools fix scope** — specify the fix precisely: read `builtin_tools` off the fetched
   base config (already available in `getExistingConfig`'s return value) and reconstruct the full
   list dynamically (not hardcode `web_search` as a second literal, which would silently drift again
   if the base config's builtin tools ever change) vs. explicitly listing both known values
   (`hang_up`, `web_search`) as literals matching today's base config. Recommend dynamic
   reconstruction from the base config's actual `builtin_tools` field, filtered/normalized to the
   `{ name, fallback_content? }` POST shape, so this doesn't need another manual fix if Hume's
   base config changes again. Confirm with BA which approach fits the existing
   "explicit-reconstruction, not blind spread" design rationale documented in
   `config-provisioner.ts`'s file-level comment (fixed enum reconstruction has been the pattern so
   far for `voice` and `language_model`, for good, function-signature-breaking-change reasons — but
   `builtin_tools` may reasonably differ since it's a list, not a fixed-shape object).
5. **Disposition of `app/api/debug/hume-chat/route.ts`** — once its capability (arbitrary
   config-by-id fetch + diff-against-base) is folded into the new permanent surface, should this
   file be (a) deleted outright since its logic now lives properly elsewhere, (b) kept only for the
   `chat_id`/`recent_chats` diagnostic paths that are out of this brief's scope (live chat/event
   inspection unrelated to config archival) with its "DELETE THIS FILE" comment and misleading
   "debug" framing removed, or (c) something else. Either way, no file continuing to do
   production-relevant work may keep a "temporary, delete me" label. Document the decision plainly
   in the spec so CEO review can confirm before any file is touched or removed.
6. **Testing/verification approach** — since this has no UI, define what "QA Gate 3" (live
   functional testing per CLAUDE.md) means for a backend-only, on-request capability: likely calling
   the new endpoint/function directly against a real archived session and a real not-yet-archived
   session, confirming both source paths return correct, non-mock data, plus confirming the
   `builtin_tools` fix by provisioning a fresh test session config and verifying `web_search` is
   present. Specify exact test session IDs/config IDs to use, or how the BA/QA agent should obtain
   one.
