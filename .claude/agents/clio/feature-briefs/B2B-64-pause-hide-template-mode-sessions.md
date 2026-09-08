# Feature Brief: Pause and Hide Template-Mode Sessions (Commit to Inline-Only Going Forward)

From: CEO (Arun)
To: Business Analyst Agent
Priority: P0
Date: 2026-08-01

---

## What Arun Said

Verbatim, live: **"Yes we are pausing our client building contents with templates so you need to
turn off and hide it. This feature is not needed until further informed."**

Followed immediately, live, by a sharpening clarification relayed by the Orchestrator: **"I think we
will only proceed with online mode and no more 2 modes, only one mode"** — a typo for "inline mode,"
confirmed by the surrounding conversation about inline vs. template mode. This second statement
raises the stakes of the first: Arun isn't just pausing a feature for a sprint, he's stating an
intent to commit to inline content delivery as the **only** session content mode going forward, not
merely to temporarily shelve a second option "for now."

I am treating both statements together as one instruction: stop template-mode sessions, hide every
partner-facing trace of the option, and do it in a way whose tone matches "we're committing to one
mode," while preserving a clean reversal path in case that commitment is ever revisited (see
Reversibility below — my call, reasoning stated).

## The Problem Being Solved

Clio's partner session API has supported two content delivery modes for a live session since B2B-19:

- **Option 1 — inline mode**: the partner sends `content_pages` (+ `content_source_id`) directly in
  the `POST /api/partner/v1/sessions` body. This is the mode Arun wants to keep and commit to.
- **Option 2 — template/reference mode**: the partner sends `partner_topic_ref` or `content_ref`
  instead, and Clio resolves the actual content server-side (via `extractSections()` /
  `TemplateSection` / `TemplateRenderer`, in `lib/partner/live-render.ts`'s
  `resolveLiveSessionRender()` non-inline branch) from content authored in the Configurator's
  authoring screens (Questionnaire/Topics/Content/Visualization).

B2B-23 (shipped 2026-07-18) already hid those four Configurator **authoring** screens from the
partner-facing nav (`VISIBLE_SECTIONS = ['integration', 'payment']` in
`lib/partner/configurator-sections.ts`) — confirmed by direct read just now. But that change never
touched the **session-creation or session-rendering** code path itself. Today, a partner can still
call the sessions API with `partner_topic_ref`/`content_ref` and get a fully working template-mode
live session — the authoring UI is gone, but the runtime capability, and its public documentation,
are still fully live. Arun's instruction is specifically about that remaining gap: the session
capability itself, not (again) the authoring screens B2B-23 already handled.

I independently re-verified this distinction against the live code before writing this brief (see
below) rather than assuming Arun's framing was accurate on trust alone.

## What Success Looks Like

After this ships:

1. **New session-creation requests** to `POST /api/partner/v1/sessions` that supply
   `partner_topic_ref` or `content_ref` (Option 2) are rejected with a clear, honest, structured
   error — not a silent failure, not a confusing downstream crash. The route already has an
   established `{ error: { code, message } }` shape (see e.g. `invalid_client_id`,
   `content_source_not_found` in `app/api/partner/v1/sessions/route.ts`) — the new rejection should
   match that convention exactly, with its own distinct `code` (BA to name it in the spec) so
   partner integrations can detect it programmatically rather than string-matching a message.
2. **Every partner-facing surface that still documents or exposes Option 2 as available** is
   updated to stop presenting it as a live option. Confirmed by direct grep just now, two files
   need this:
   - `app/(with-clerk)/dashboard/configurator/docs/DocsClient.tsx` — the partner developer docs
     page (built as part of B2B-23's "Content & image auth" work) still shows a live example
     request body using `"partner_topic_ref": "onboarding-101"` as a valid session-creation call.
   - `app/(with-clerk)/dashboard/configurator/api/content.ts` — the API reference field table
     (feeds the Docs/API-reference surface) still lists `partner_topic_ref` and `content_ref` as
     valid, non-required-but-available fields with a footnote saying one of them is required.
   Both need to stop presenting Option 2 as something a partner can currently use. (I did not find
   any live reference in `PlaygroundClient.tsx` itself — its example payloads don't mention these
   fields directly; the BA should still double check the Playground's request-building UI doesn't
   let a partner freely add these fields into a live test call, since the Playground calls the real
   API.)
   The Configurator's four authoring screens (Questionnaire/Topics/Content/Visualization) are
   already hidden per B2B-23 — nothing further needed there.
3. **Existing template-mode sessions already created before this change ships keep working
   unchanged.** A partner's already-scheduled or already-live Google Meet session that was created
   in Option 2 must not break. This means `resolveLiveSessionRender()`'s non-inline branch
   (`extractSections()`/`TemplateSection`/`TemplateRenderer`) is explicitly **out of scope for
   removal** — only the creation of *new* Option 2 sessions is blocked. I'm stating this as an
   assumption, not a settled fact — BA/Arun should confirm or override it explicitly, since it's a
   real product-behavior choice with a plausible alternative (force-migrate or kill in-flight
   sessions too), not just an implementation detail.
4. The mechanism is a **named, centrally-located guard** (env var or a single exported boolean/const
   — BA to decide the exact form, following the repo's existing pattern for this kind of toggle),
   not a deletion of the `CreateSessionSchema` fields, the `.refine()` validation logic, or the
   render-side template code. Reasoning below under Reversibility.

## Known Constraints

- **Do not touch inline-mode (Option 1) behavior at all.** This brief is scoped exclusively to
  disabling/hiding Option 2. Zero risk to `content_pages`-based sessions.
- **Do not remove or alter `resolveLiveSessionRender()`'s non-inline render branch** — it must keep
  serving any session row already in the database with `partner_topic_ref`/`content_ref` set,
  unless Arun explicitly says otherwise (see assumption #3 above).
- **Do not touch B2B-23's authoring-screen hide (`VISIBLE_SECTIONS`)** — already correctly scoped
  and shipped; nothing to add there per my direct-code check.
- **Coordinate-by-awareness only with B2B-63** (concurrent, mid-BA-spec: live transcript capture for
  OpenAI voice sessions). That BA has already scoped itself to inline-mode-only in anticipation of
  this exact decision. This brief does not need to actively coordinate with it, just not contradict
  it — and it doesn't; B2B-63 assuming inline-only is fully consistent with this brief's outcome.
- **Tone/scoping per the live follow-up**: write the spec as committing to inline as the sole
  supported mode going forward, not as a "quick toggle we'll probably flip back next sprint." The BA
  should reflect that weight in the spec's framing (e.g., don't describe Option 2 as "temporarily
  unavailable" in partner-facing copy — describe it as not currently supported, full stop) while the
  underlying mechanism still stays a guard rather than deleted code, per my reasoning below.
- **Standing responsive/mobile rule** (CLAUDE.md standing story): the two files being edited
  (`DocsClient.tsx`, `api/content.ts` reference data) are being touched anyway for this change, so
  per the standing rule, if either surface currently has any non-responsive layout issues in the
  sections being edited, the BA/dev should bring just those touched sections up to the fluid/clamp()
  responsive bar as part of the same change. Do not use this as license for a wider audit.

### Reversibility — my explicit call

Arun's original phrasing ("not needed until further informed") and the live follow-up ("only one
mode going forward") are not in tension: a strong current commitment to inline-only is fully
compatible with the mechanism being a flag rather than a deletion. I'm choosing **guard, not
deletion**, for three concrete reasons, not just "flags are safer by default":

1. **The render-side code can't be deleted anyway** — it has to keep serving pre-existing
   template-mode sessions (see constraint above), so there's no actual code-deletion opportunity on
   that side regardless of how permanent Arun's intent is.
2. **The only real choice is at the request-validation layer** (reject vs. allow new Option 2
   session creation), and a named guard there costs nothing extra to maintain — it's one small,
   well-documented conditional, not a parallel system to keep in sync.
3. Even under the stronger "commit to one mode" framing, if this is ever revisited (e.g. a specific
   partner needs template mode reinstated), a one-line flag flip is strictly better than
   reconstructing deleted validation logic from git history — with no offsetting cost today.

If Arun wants outright removal of the Option 2 code paths (schema fields, refine logic, docs
mentions of the concept entirely) rather than a guarded rejection, that's a one-line follow-up
decision, not a reason to hold this brief.

## Questions for BA

1. **Guard implementation form**: env var (e.g. `TEMPLATE_MODE_ENABLED`, defaulting to disabled) vs.
   a single exported constant in a shared config/constants file. Check the repo for an existing
   convention for this kind of on/off product toggle (the B2B-61 OpenAI/Hume voice-provider toggle
   is one precedent — `NEXT_PUBLIC_VOICE_PROVIDER` — decide if that pattern fits or if a
   non-`NEXT_PUBLIC_` server-only var is more appropriate here, since this is a server-side
   validation gate, not a client-facing toggle).
2. **Exact error code/message and HTTP status** for the new rejection — match the existing route's
   `422`/structured-error convention; propose the specific `code` value.
3. **Confirm or override my assumption #3** (existing template-mode sessions keep rendering
   unchanged) — this is a real product-behavior decision, not just an implementation detail, and
   deserves explicit sign-off in the spec rather than inheriting my assumption silently.
4. **Playground UI**: confirm whether `PlaygroundClient.tsx`'s request-builder currently allows a
   partner to add `partner_topic_ref`/`content_ref` fields into a live test call. If yes, that's a
   third file needing the same "no longer offered" treatment as `DocsClient.tsx` and
   `api/content.ts`.
5. **Any BACKLOG.md items or open bugs** that reference template-mode session behavior that might
   need re-triaging as no-longer-applicable once this ships (BA to check `BACKLOG.md` and
   `docs/b2b-pivot-status.md` for stray references beyond what I found).

Once the BA spec has 0 open questions in Section 11 and I've reviewed and approved it, this goes to
Dev under the standard gate.
