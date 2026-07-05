# Feature Brief: HUME-NATIVE-01 Phase C — Nightly Transcript Archive, Config Archive + Cleanup

From: CEO (Arun)
To: Business Analyst Agent
Priority: P1
Date: 2026-07-05

This brief extends and finalizes **Section 4.8 (Post-Session Transcript Extraction)** of
`docs/specs/HUME-NATIVE-01-requirement-doc.md`. It does not replace 4.8 — it specifies the exact
nightly schedule, eligibility window, and adds two new responsibilities (Config archival + Config
deletion) on top of the transcript-pull mechanism 4.8 already scoped as a "secondary safety-net
cron job." The BA should treat this as writing the concrete spec for that cron job, now that its
schedule and full scope are settled.

---

## What Arun Said

Verbatim intent from this session:

> A nightly cron job, running at 12:00 AM, that for every session whose call ended before 11:00 PM
> CST (i.e., don't touch anything from the last ~1 hour before the run, as a safety buffer against
> touching something still possibly in use):
> 1. Reads that session's Hume Config (`hume_native_config_id`) — pulls its full details.
> 2. Reads that session's full transcript via Hume's Chat History API (`GET
>    /v0/evi/chats/{id}/events`, using `hume_chat_id`).
> 3. Saves both (config details + transcript) into our own database — durable archive, since once
>    the Hume-side config is deleted we lose access to it entirely.
> 4. Deletes the Hume-side Config (`DELETE /v0/evi/configs/{id}`) — confirmed free-to-use, no
>    account-level cap or cost for configs sitting unused, but proactive tidiness is wanted anyway.

Context established earlier in this session (not new, but load-bearing for this brief):
- HUME-NATIVE-01 creates a brand-new Hume Config per session, never reused.
- Arun confirmed there is no cost or hard-limit problem with Configs accumulating on Hume's side —
  this is a tidiness preference, not a constraint workaround.
- The transcript-pull requirement was already documented as desirable in
  `docs/brainstorm/ATTENDEE-HUME-ARCHITECTURE-brainstorm.md`'s "Decision — action items and glitch
  detection" section, with Arun explicitly fine with nightly-batch timing over real-time.

## The Problem Being Solved

Two distinct but related problems, solved by one job:

1. **Data loss risk:** once a per-session Hume Config is deleted, its configuration (prompt
   version, voice settings, tool wiring at the time of that session) is gone forever from Hume's
   side. Same risk applies to the transcript if it were ever to become unavailable Hume-side. We
   need our own durable copy before we ever delete anything.
2. **Account tidiness:** per-session Configs accumulate indefinitely with no functional need to
   keep them live on Hume's side after the session is long over. Not urgent, not cost-driven, but
   Arun wants a standing cleanup mechanism rather than manual/ad-hoc deletion later.

This also directly feeds the already-approved (but separately-scoped) action-item/glitch
extraction work in 4.8 — the transcript this job archives is the same transcript that extraction
step consumes. This brief is about the archive-then-delete mechanics, not the extraction logic
itself (see Explicitly Out of Scope below).

## What Success Looks Like

- Every night at 12:00 AM (timezone to be verified — see Known Constraints), a job runs that finds
  all `hume_native_enabled = true` sessions whose call ended before 11:00 PM CST relative to the
  run, and that haven't already been archived+cleaned up.
- For each eligible session: the Hume Config's full details and the full transcript (paginated,
  all events) are pulled and written to our own database, in full, before anything is deleted.
- Only after that write is confirmed successful does the job call `DELETE
  /v0/evi/configs/{hume_native_config_id}` on Hume's side.
- A session already cleaned up in a prior run is never reprocessed (idempotent).
- One session's failure (API error, partial data, etc.) never blocks any other session in the same
  run — every eligible session gets its own independent attempt.
- Nothing touches a session still in progress, or one that ended within the last hour before the
  run (the safety buffer).
- The base production Config (`4e0c7e15-bb03-40b2-aded-21813f19fc8d`) is never touched by this
  job — only per-session cloned Configs are ever eligible for deletion.
- Once archived, our own database is the sole source of truth for that session's Config details
  and transcript — no functional dependency on Hume still having the data.

## Known Constraints

These are things Arun explicitly said must happen, or things I'm flagging as non-negotiable
based on standing project rules (never silently deviate from these):

- **Schedule must be exactly right, not assumed.** Arun asked for the job to run at 12:00 AM and
  process sessions that ended before 11:00 PM **CST**. Inngest cron expressions (`0 0 * * *`) are
  evaluated in a specific timezone per Inngest's own docs/config — this must be confirmed against
  Inngest's actual documentation before the BA finalizes the schedule spec. **Do not assume UTC or
  guess.** If the cron's evaluation timezone differs from CST, the eligibility-window math (11 PM
  CST cutoff) must be adjusted accordingly so the *effective* real-world behavior matches Arun's
  intent (nightly run ~1 hour after the CST cutoff), regardless of what timezone the cron
  expression itself is written in.
- **Archive-before-delete ordering is non-negotiable.** The Config (and transcript) must never be
  deleted from Hume's side unless the archival write to our own database has been confirmed
  successful first. This is a hard ordering constraint, not a best-effort one.
- **Never touch anything from the last ~1 hour before the run.** This is a deliberate safety
  buffer against operating on a session that might still be wrapping up or in an ambiguous
  "ended" state. The BA must specify exactly how "ended" is determined — likely `sessions.ended_at`
  timestamp, but Hume's own chat-ended event data (if the Chat History API surfaces an `end_time`)
  should be considered as a cross-check per Arun's framing. BA to decide and document which is
  authoritative.
- **Idempotency is required**, not optional. A new timestamp column (e.g.
  `hume_config_archived_at` on `sessions`, following the existing `ended_at` /
  `action_items_extracted_at`-style pattern already used on this table) or equivalent must record
  that a session has been fully processed, so re-runs skip it. Hume returning 404 on an
  already-deleted Config must be handled as an expected, non-fatal case, not a job failure.
- **Storage schema must follow existing conventions.** New table(s) or columns should be
  consistent with the patterns already established by `session_billing_audit_log`
  (migration 051) and `minutes_ledger` (migration 057) — append-only where appropriate, RLS
  policies matching the existing per-user-isolation pattern, indexed on `session_id`. Per
  CLAUDE.md's project structure, this is a Supabase migration (next number: `058_*.sql` — confirm
  against the migrations directory at build time in case another migration lands first).
- **No deletion of any existing code, table, or column.** This is purely additive.
- **Never affect an in-progress/active session.** Only sessions clearly past the eligibility
  window are candidates at all.
- **Never touch the base production Config** `4e0c7e15-bb03-40b2-aded-21813f19fc8d` — deletion
  logic must only ever target `sessions.hume_native_config_id` values, never any hardcoded or
  shared base config ID.
- **Per-CLAUDE.md governance:** this requires a BA-written, CEO-approved spec (with Section 11 Open
  Questions fully resolved) before any code is written. No exceptions, including for what looks
  like "just a cron job."
- **Approved libraries/vendors only:** Inngest (scheduling), Supabase (storage) — both already
  approved. All Hume REST calls go through typed server-side calls only, `HUME_API_KEY` never
  logged, consistent with 4.8's and the rest of HUME-NATIVE-01's existing constraints.

## Questions for BA

1. **Inngest cron timezone verification (blocking):** confirm from Inngest's actual documentation
   what timezone `0 0 * * *` (or whatever cron expression is chosen) evaluates in in this project's
   Inngest setup. Document the exact cron expression and the exact eligibility-window boundary
   (in UTC, for implementation clarity) that correctly implements "runs ~12:00 AM, processes
   sessions that ended before 11:00 PM CST relative to that run." Do not guess — cite the doc.
2. **"Ended" determination:** should eligibility be based on `sessions.ended_at` alone, or
   cross-checked against Hume's own chat-ended timestamp from the Chat History API response? What
   happens if the two disagree, or if `ended_at` is null but a `hume_chat_id` exists?
3. **Exact schema:** specify the new column(s) on `sessions` (e.g. `hume_config_archived_at
   TIMESTAMPTZ`) and the new table(s) for config-snapshot + transcript-events storage — full DDL,
   following the `session_billing_audit_log` / `minutes_ledger` migration conventions (RLS,
   indexes, append-only enforcement where relevant).
4. **Relationship to the 4.8 extraction job:** 4.8 already describes a "secondary safety-net cron"
   for the extraction pipeline. Should this nightly archive+cleanup job be the *same* Inngest
   function as that safety-net (doing archive+extract+delete in one pass), or a *separate* function
   that runs first and the extraction job consumes its output afterward? Recommend they be
   separate concerns (this job's responsibility ends at "transcript is durably archived locally";
   extraction is a distinct consumer of that archived data) — BA to confirm or override.
5. **Failure/retry semantics:** Inngest's standard retry convention used elsewhere in this codebase
   (2-3 attempts) — confirm this job follows the same, and specify what "partial failure within one
   session" looks like (e.g. config-detail fetch succeeds, transcript fetch fails — does the job
   retry only the missing piece, or the whole session-processing step?).
6. **Config-detail fetch scope:** "pulls its full details" — confirm exactly which Hume API this
   uses (likely `GET /v0/evi/configs/{id}` or `.../configs/{id}/versions`) and what fields are
   captured in the archive (full raw response recommended, per the durable-archive intent).

## Explicitly Out of Scope (per Arun's framing)

- The action-item/glitch **extraction logic itself** — already separately scoped in Section 4.8
  of the original requirement doc. This brief's job produces the durably-archived transcript that
  extraction consumes; it does not reimplement or re-specify the extraction step.
- Any change to the primary event-driven extraction trigger path (`distill/session.hume-native.ended`)
  described in 4.8 — this nightly job is the safety-net/cleanup layer, not a replacement for it.
- Any change to `lib/voice/hume-adapter.ts`, the base production Config, or any other file listed
  as untouched in Section 4.9 of the original requirement doc.
- Broader Hume account management (e.g. bulk historical cleanup of Configs created before this
  system existed) — scope is limited to sessions going forward under this job's logic.

---

## Summary for Arun (plain English)

This is the concrete plan for the nightly cleanup job you asked for. Every night around
midnight, it will find yesterday's finished coaching sessions (skipping anything from the last
hour, so nothing mid-call gets touched), pull a full copy of that session's AI configuration and
conversation transcript from Hume, save both permanently in our own database, and only then delete
the Hume-side configuration to keep that account tidy. It never processes the same session twice,
never fails silently, and one session's problem won't stop the rest from processing. Before the BA
writes the full spec, one thing needs to be nailed down precisely: what timezone Inngest's
scheduler actually runs in, so "midnight" and "11 PM CST cutoff" line up exactly as you intend —
that will be verified against Inngest's real documentation, not assumed. This also archives the
data needed for the action-item/glitch extraction feature you already approved, but doesn't build
that extraction logic — this brief is just the archive-and-cleanup mechanics it depends on.
