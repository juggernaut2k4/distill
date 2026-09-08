# CEO Review — B2B-82: Widget-channel name greeting silently loses to ElevenLabs' un-overridden `first_message`

From: CEO Agent (on Arun's direct instruction, relayed verbatim by the Orchestrator, then
"fix both the issues" — 2026-09-08)
To: Dev/build agent
Priority: P0 — real product gap, live in production right now on every widget ElevenLabs session
Parent spec: `docs/specs/B2B-75-requirement-document.md` (ElevenLabs widget provider, approved,
built, live)
Safety net: `checkpoint-2026-09-08-pre-greeting-and-screen-delay-fix` tag at `09ab7eb` (Orchestrator-
created). `git reset --hard` to it if this fix misbehaves live.
Governance tier: **CEO-review only, no BA Requirement Document.** This restores previously-approved,
already-shipped behavior (greet the participant by name — confirmed working on a real call
2026-07-07, `project_participant_greeting.md`) via the correct technical mechanism. It is not a new
screen, not new product behavior, and not a new copy decision beyond one short, precedented default
string. Squarely CLAUDE.md's "technical decisions: full autonomy" lane — same tier as B2B-76.

---

## 0. Correcting the record before building anything

Both Arun's framing and the Orchestrator's code pointers describe this as the same known,
already-accepted limitation: `sendContextualUpdate()`/`sendWrapUpNudge()` is advisory-only on
ElevenLabs — it lands context but never forces a turn, unlike Hume's full-replace `session_settings`
or OpenAI Realtime's `conversation.item.create` + `response.create` pair. **That limitation is real
and correctly documented** (`lib/voice/elevenlabs-adapter.ts` lines ~497-521), but I traced the
actual greeting failure to a different mechanism entirely, and the advisory-nudge limitation is not
its cause. Two findings the Orchestrator's briefing did not have:

**Finding 1 — the join-greeting poll/nudge mechanism the Orchestrator pointed at never fires for
widget sessions at all.** `join_greeting_pending`/`join_greeting_participant_first_name` (the fields
`WidgetRenderClient.tsx`'s poll and `sendWrapUpNudge` chain read) are set to `true` in exactly one
place in the entire codebase: `app/api/attendee/webhook/route.ts`, on a `participant_events.join_leave`
event from the Attendee meeting-bot webhook. That is the **meeting-bot channel's** "someone joined
mid-call" signal. No code path ever sets this flag for a widget session — there is no meeting bot in
the widget flow, so no join/leave webhook ever fires. `WidgetRenderClient.tsx`'s poll of this same
endpoint (reused "as-is... same proven flag-set → poll → send → clear pattern," per its own comment)
is live, harmless, and permanently a no-op for every widget session that has ever run. **This is not
the widget's greeting mechanism and was never going to be** — it's dead-but-harmless reused plumbing.

**Finding 2 — the widget's real greeting mechanism already exists, is baked into the initial system
prompt (the reliable, "forced" mechanism, not a live nudge), and is structurally correct — for
OpenAI.** Both widget prompt files carry an explicit numbered instruction as the very first rule of
the session:
- `lib/voice/widget-prompt-rules.ts` (OpenAI): `1a. Greet ${WIDGET_OPENAI_PARTICIPANT_NAME_PLACEHOLDER}
  and introduce yourself.`
- `lib/voice/widget-elevenlabs-prompt-rules.ts` (ElevenLabs) line 265: `1a. Greet
  ${WIDGET_ELEVENLABS_PARTICIPANT_NAME_PLACEHOLDER} and introduce yourself.`

Both are populated from the same `participantName: session.endUserName` field (`lib/partner/live-render.ts`,
resolved at render time, confirmed already correctly plumbed — this is the exact `end_user_name`
seam a 2026-08-02 fix, cited in `live-render.ts`'s own comment at line 438-441, closed for template
mode: "a real test call never greeting Arun by name despite end_user_name='Arun' already being stored
correctly"). This instruction lives in `overrides.agent.prompt.prompt` — per the adapter's own header
comment, "THE ONE THING OVERRIDDEN" and the one field ElevenLabs actually honors from this codebase.
**This is not the advisory `sendContextualUpdate` path.** It is delivered at connection time as part
of the authoritative system prompt, the same way OpenAI's identical rule 1a is — and OpenAI's version
of this works (no report of a missing-name bug on the OpenAI-provider widget path).

**The actual, verified root cause:** ElevenLabs Conversational AI treats `first_message` — a
*separate* field from the system prompt — as the literal text the agent speaks as its opening line.
Per ElevenLabs' own documentation (elevenlabs.io/docs/eleven-agents/customization/personalization/overrides,
confirmed live this session): *"The first message is what the assistant will speak out loud when a
user starts a conversation... In contrast, the system prompt controls conversational behavior and
response style, but does not control conversation flow mechanics."* Known Constraint C3
(`elevenlabs-adapter.ts` header, B2B-75 §10.B) deliberately leaves `first_message` un-overridden —
"stays exactly as Arun's base agent has them configured" in the ElevenLabs dashboard, a static string
with no per-session name in it. That static `first_message` is what actually gets spoken as turn one,
**pre-empting** rule 1a — which was written assuming (correctly, for OpenAI, where no such competing
field exists in this build) that the model's own turn-based reasoning drives the opening line. On
ElevenLabs, by the time the model would act on rule 1a, the un-personalized `first_message` has
already been spoken as the connection's first turn.

**This is a different, previously-undocumented gap from the `sendContextualUpdate`-is-advisory
limitation Arun described.** That real limitation governs a different code path
(`sendWrapUpNudge`/`triggerRecoveryNudge`, used for the max-call-duration wrap-up notice and the idle
check-in — see `widget-elevenlabs-prompt-rules.ts`'s own G22 history comment). It has nothing to do
with the opening greeting, which was never routed through that mechanism at all.

---

## 1. Fix direction

**Add `first_message` to the ElevenLabs adapter's override object**, computed server-side with the
participant's name already substituted in — literal text, not an instruction for the model to
interpret, mirroring this codebase's existing `DualModePromptField { mode: 'literal' | 'instruction' }`
pattern already used for `joinGreeting`/`goodbyeLine`/`closingConfirmationQuestion` in
`lib/partner/prompt-config.ts`.

1. **`lib/partner/prompt-config.ts`** — add a new configurable field, `openingGreeting:
   DualModePromptField | null`, following the exact same shape/plumbing as `joinGreeting` (interface
   field, default-config entry, the `PROMPT_FIELD_MODES`/DB-column-name maps, the `merged.*` /
   `*_column` read-write pairs). Default (literal mode, matching `DEFAULT_JOIN_GREETING`'s
   established tone):
   ```
   {
     mode: 'literal',
     text: 'Hi {firstName}, I'm {assistantName}. Let's get started.',
   }
   ```
   Falls back to `'there'` for `{firstName}` exactly like `DEFAULT_JOIN_GREETING` already does when
   `endUserName` is null — do not invent a different fallback convention.

2. **`lib/voice/widget-elevenlabs-prompt-rules.ts`** — export a new `assembleWidgetElevenLabsFirstMessage()`
   (or fold into the existing assembler's return shape) that substitutes `{firstName}`/`{assistantName}`
   into `openingGreeting` the same way `join-greeting/route.ts` already does its `{firstName}`
   substitution (`.split('{firstName}').join(firstName)`), producing the literal string to send as
   `overrides.agent.first_message`.

3. **`lib/voice/elevenlabs-adapter.ts`** — add `firstMessage` to `ElevenLabsAdapterConfig`, thread it
   into the `overrides.agent` object alongside the existing `prompt.prompt` override at the
   `Conversation.startSession(...)` call site. Update the file's own header comment — "THE ONE THING
   OVERRIDDEN" becomes "the two things overridden," with the same reasoning (ElevenLabs throws on an
   override for a field whose Security-tab toggle is off) now applying to two fields, not one.

4. **Remove the double-greeting risk.** `1a. Greet [PARTICIPANT_NAME] and introduce yourself` in
   `widget-elevenlabs-prompt-rules.ts` must be rewritten, not left as-is — once `first_message` speaks
   the greeting, rule 1a firing again on the model's first real turn would double-greet. This exact
   failure class already happened once in this codebase: `widget-prompt-rules.ts`'s own v4 history
   comment records "the model greeting twice... rule 1 from scratch, producing the double greeting,"
   fixed by a GLOBAL RULE explicitly naming the real state. Follow that precedent: rewrite rule 1a to
   something like *"Your first message has already greeted them by name — do not greet again. Move
   straight into introducing what this session covers."* Do not simply delete 1a outright; the
   "introduce yourself" half of the instruction still needs a home.

5. **Update `docs/specs/B2B-75-requirement-document.md`'s §10.B "Explicitly NOT modified" /
   "Overriding... first message... — only `agent.prompt.prompt` is overridden (C3)" line** to reflect
   the amendment, with a dated note (this is the second deliberate, disclosed reversal of a B2B-75
   decision this month, same pattern as B2B-76 item 4's reversal of the transcript-API decision — name
   it plainly, don't silently drift past it).

---

## 2. Mandatory external dependency — Arun's own action, cannot be built around

ElevenLabs **throws on connect** when an override arrives for a field whose Security-tab toggle is
off (documented in the adapter's own header comment, independently confirmed against ElevenLabs' own
docs this session: overrides must be individually enabled per field). B2B-75 already required Arun to
enable the System-prompt override toggle manually before the first session — this adds one more:

**Arun must enable the "First message" override toggle on the ElevenLabs agent's Security tab before
this code is deployed.** Skipping this does not degrade gracefully to "greeting still missing" — it
makes **every** widget ElevenLabs connection fail outright at connect (worse than today's bug). This
is the same class of mandatory manual step B2B-75 §12.1 already documents three of ("each fails in a
way that looks like something else") — add this as a fourth. **Do not deploy this fix until Arun has
confirmed the toggle is enabled.** Log this explicitly in `BACKLOG.md` as a pre-deploy gate, not a
"fix and ship" item — I am flagging it here rather than treating code completion as done.

---

## 3. Build process

- Isolated git worktree off latest `main`.
- Extend `tests/unit/` for the new `openingGreeting` config field (default fallback, `{firstName}`
  substitution, literal-vs-instruction mode) and `tests/integration/` for the adapter now sending two
  override fields.
- `npx tsc --noEmit` clean, `npx vitest run --no-file-parallelism` zero new failures, `npm run build`
  clean.
- `git diff main --stat` — confirm zero lines touched outside `lib/partner/prompt-config.ts`,
  `lib/voice/widget-elevenlabs-prompt-rules.ts`, `lib/voice/elevenlabs-adapter.ts`,
  `docs/specs/B2B-75-requirement-document.md`, plus their test files. **Do not touch**
  `widget-prompt-rules.ts`, any Hume/OpenAI adapter, or `app/(with-clerk)/partner-render/**` — same
  do-not-touch boundary B2B-75/76 established, still binding, this is a widget/ElevenLabs-only change.
- QA Gate 3 cannot verify the actual spoken greeting without a real ElevenLabs session (needs the
  Security-tab toggle enabled first) — report this plainly as deferred pending Arun's toggle
  confirmation, not as a false PASS. Everything else (config default, substitution, override wiring
  present in the outgoing `startSession` call, rule-1a text) is verifiable without a live call.

---

## 4. What I did not find a genuine open fork on

Whether the personalized opening line should be literal (spoken verbatim) vs. an instruction for the
model to phrase naturally — I resolved this myself: literal, because `first_message` is ElevenLabs'
own field for exactly this ("what the assistant will speak out loud"), and instruction-mode would
reintroduce the same "advisory, may not land" risk this fix exists to close. No escalation needed.
