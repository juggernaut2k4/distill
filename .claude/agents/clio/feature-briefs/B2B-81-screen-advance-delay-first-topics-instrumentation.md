# CEO Review — B2B-81: Screen-advance delay on the first 1-2 topics — re-affirmed as intended, instrumentation-only fast-track

From: CEO Agent (on Arun's direct instruction, relayed verbatim by the Orchestrator, then
"fix both the issues" — 2026-09-08)
To: Dev/build agent
Priority: P2 — not a bug, a measurement gap; no user-facing harm beyond what's already accepted
Parent mechanism: `waitForPlaybackCaughtUp()` / `waitForPlaybackToFinish()`, shipped as part of
**B2B-61 round 3** (2026-08-02, "B2B item 7a") and reused by the widget's ElevenLabs `show_visual`
handler (2026-08-09)
Safety net: `checkpoint-2026-09-08-pre-greeting-and-screen-delay-fix` tag at `09ab7eb`.
Governance tier: **CEO-review only, no BA Requirement Document.** The only change this brief
authorizes is backend instrumentation (a log line) with zero product-shape, screen-content, or UX
surface. It explicitly does NOT authorize a content/prompt change — see §2.

---

## 0. Root cause — confirmed, and confirmed distinct from B2B-58/59/60

I traced this myself rather than accepting the loose date-based association. **Arun's own account is
correct**, and the mechanism is a different one from B2B-58/59/60, not the same one:

- **B2B-58** (2026-07-30) fixed `show_visual`/`advance_tab` force-advancing the page **one section
  ahead of what Clio had said anything about** — the opposite direction of the symptom described here
  (screen lagging, not leading).
- **B2B-59** (2026-07-31) fixed a **double-advance race** (page N → N+1 → N+2 from one real
  transition) caused by both signals re-resolving a shared mutable index. Also not this mechanism.
- The actual "wait until she's finished talking, capped at 8 seconds" mechanism is
  `waitForPlaybackToFinish(timeoutMs = 8000)` in `lib/voice/openai-realtime-adapter.ts` (private,
  exposed publicly as `waitForPlaybackCaughtUp()`), added as part of **B2B-61 round 3** — a separate,
  later fix for a separate, real bug: the model's tool call (`advance_tab`/`show_visual`) can resolve
  the instant it finishes **generating** the sentence naming the next topic, while that audio may
  still be **mid-flight through the local playback queue**. Without the wait, the visible page jumps
  ahead of what the participant has actually heard — confirmed live and documented in both
  `PartnerRenderClient.tsx`'s `advance_tab` handler and, for the widget's ElevenLabs path,
  `WidgetRenderClient.tsx`'s `show_visual` handler: *"Confirmed live: the screen jumped to the next
  topic's page while ElevenLabs was still ~8 seconds from finishing speaking the CURRENT topic's
  content, reproducing exactly what Arun described (\"navigated to topic 2 while explaining topic
  1\")."*

So: this is not B2B-58/59/60 recurring, and it is not unrelated either — B2B-58/59/60 fixed the page
running *ahead*; B2B-61 round 3 (a few days later, then ported to the widget's ElevenLabs path on
2026-08-09) fixed the same *direction* of problem via a different mechanism, and the 8-second cap is
this fix's own safety bound on how long it will wait before giving up and advancing anyway.

**Timing**: B2B-61 round 3 is ~5.5 weeks old as of today (2026-09-08), which matches "about a month
ago" closely enough that Arun's account should be taken as accurate, not revised.

---

## 1. Is a code change to the wait/cap mechanism itself warranted? No — re-affirming, with evidence

Arun's own message already leans this way, and I confirm it rather than second-guessing it: **do not
remove, shorten, or weaken `waitForPlaybackToFinish`/its 8-second cap.** It exists specifically to
prevent the page from visibly running ahead of Clio's narration — a real, previously-reported,
already-fixed-once bug (B2B-58's whole premise, and the reason B2B-61 round 3 was needed again on a
different provider). Removing or shortening it does not remove the underlying tension (tool-call
resolution vs. audio-playback completion); it just reintroduces the earlier bug in exchange for a
faster screen, which is the wrong trade for a product with an "Executive UX standard" that measures
itself on being crisp and trustworthy, not merely fast. The cap is already bounded (not unbounded —
worst case is 8 seconds, not "however long she talks"), which is the correct shape for a safety net.

## 2. What actually varies: content length on the first 1-2 topics — real, but not code-verifiable from here, so no blind content change

Arun's diagnosis of *why* the wait is most noticeable early — intro/framing lines run longest on the
first couple of topics — is plausible and has a real code correlate: `lib/content/session-content-generator.ts`'s
`generateSingleContentArticle()` gives `subtopicIndex === 0` a distinct, longer-framing position
("context anchor — open with why this is on their radar right now, not a definition") versus later
subtopics ("core concept"). However, I could not confirm from static code alone that the **spoken**
TEACH segment is actually longer for topic 1 — `lib/content/script-generator.ts`'s TEACH segment has a
uniform "exactly 140 words — hard limit" regardless of position; the longer framing lives in the
content-article layer (overview/how-it-works/enterprise-implications, used for on-screen text), which
is not necessarily what determines the audio-queue length the 8-second wait is draining. I do not have
access to real session audio-duration telemetry from this dispatch, so I am not going to authorize a
content/prompt trim on an unverified hypothesis — that risks a real regression to the CEO/BA-approved
CONTENT-01 calibration rules (2026-06-27, orient-first framing for the first topic is a deliberate,
approved design choice, not an accident) under this codebase's own standing rule against touching
approved content-generation behavior without a documented reason.

**Fast-track technical fix authorized here: instrumentation only.** Add a diagnostic log (reusing the
existing `voice-diagnostic-capture` pattern already used elsewhere in `WidgetRenderClient.tsx`/
`PartnerRenderClient.tsx` for exactly this kind of empirical-evidence-gathering) that records the
actual wait duration `waitForPlaybackCaughtUp()` resolves after, keyed by topic/section index, for
every real session. This converts "first couple of topics feel slow" from an assumption into
verified, per-topic data within days of real traffic — the same evidence-before-action discipline this
codebase already applied to the ElevenLabs post-call-transcript-delay question in B2B-76 item 4
("the unverified... question gets answered empirically from real production runs instead of staying a
guess forever").

**Explicitly not authorized by this brief:** any change to intro/framing copy length, the "context
anchor" position instruction, or the TEACH word limit. If the instrumentation confirms topic 1-2 waits
are meaningfully longer, that finding should go back through the CEO for a follow-up brief — at that
point it becomes a real content-calibration decision (touches what the first topic's framing says),
which is CLAUDE.md's "product decisions" lane, not this technical/measurement lane.

---

## 3. Build process

- Isolated git worktree off latest `main`.
- Add the diagnostic log call at the point `waitForPlaybackCaughtUp()` resolves in both
  `PartnerRenderClient.tsx`'s and `WidgetRenderClient.tsx`'s advance handlers — capture topic/section
  index and the actual elapsed wait in milliseconds. Fire-and-forget (`keepalive: true`), matching the
  existing `voice-diagnostic-capture` call sites' own pattern — do not add a new capture endpoint if
  the existing one already accepts an arbitrary `label`/`detail` payload (confirm before building a
  second one).
- No schema change expected — confirm the existing diagnostic-capture storage already accommodates an
  arbitrary detail payload before assuming a migration is needed.
- `npx tsc --noEmit` clean, `npx vitest run --no-file-parallelism` zero new failures, `npm run build`
  clean.
- `git diff main --stat` — confirm zero lines touched in `lib/content/**`, any prompt-template file, or
  the wait/cap constants themselves. This build should be a pure addition of logging around an
  existing call site.
- No QA Gate 3 live-call content assertion needed (nothing user-visible changes); confirm the log
  fires on a real or test-mode session and captures a sane index + duration.

---

## 4. What I did not find a genuine open fork on

Whether to act on Arun's hypothesis immediately by trimming content, versus verifying it first — I
resolved this myself in favor of verifying first, given the standing rule against unreviewed changes
to approved content-generation behavior and the absence of any user-facing harm from the status quo
(the cap already bounds the worst case, and the alternative — a page running ahead of narration — is a
strictly worse, already-reported bug). No escalation needed; if Arun disagrees with prioritizing
measurement over an immediate copy trim, that's a one-line redirect, not a fork requiring his input to
resolve at brief-writing time.
