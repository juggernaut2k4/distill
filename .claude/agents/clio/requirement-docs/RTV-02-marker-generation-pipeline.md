# RTV-02 — Marker-Generation Content-Authoring Pipeline — Requirement Document
Version: 1.0
Status: APPROVED (CEO Agent, 2026-07-10)
Author: Business Analyst Agent
Date: 2026-07-10

> **CEO Review — APPROVED, 2026-07-10.** Cleared to build → test → deploy per Arun's standing authorization for this series. Section 11 empty; all 7 questions resolved with live-DB-grounded evidence; full algorithm pseudocode; all three checks correctly split (check 3 deterministic/no-LLM, checks 1&2 a single cross-topic LLM call); the no-fallback rework loop is bounded (3 source levels) with a proper never-ship-empty hard-stop (`rtv_eligible=false` + admin alert). 11 testable acceptance criteria.
> **CEO decision on the storage override:** ACCEPTED. The BA moved markers from the brief's suggested `topic_content_cache.topic_markers` to `sessions.session_markers` + `sessions.rtv_eligible`, with live evidence that `topic_content_cache` is empty for Hume-native sessions and content lives on `sessions.live_conductor_content`. This co-locates markers with the content RTV-03 actually reads and keys by the session UUID the runtime already resolves — the correct call.
> **CEO decision on the flagged existing-code change:** APPROVED. Adding `export` to `extractWhatToCover` in `lib/clio-context-builder.ts` is visibility-only, zero behavior change, and correctly avoids logic duplication/drift — exactly what the no-regress standing rule wants (flag it, don't silently change it). No existing caller affected.
> This phase does NOT touch the template-design approval gate (that is RTV-04). No Arun sign-off required to build/ship RTV-02.

---

## 1. Purpose

The real-time transcript-driven visualization series (RTV) lets Clio's on-screen
visual switch be driven by what she is *actually saying* live, instead of only by
her `show_visual` tool call. The live tracker that does this (RTV-03, a later
phase) works by listening to Clio's improvised speech and matching it against a
small set of **deliberately-distinctive keyword markers per topic**. It cannot
exist until those marker sets exist.

This phase (RTV-02) produces **DATA ONLY**: for every Hume-native session whose
content is authored, it derives — at content-authoring time — a high-precision
set of markers for each of the session's non-bookend topics, plus literal-word
markers for the two bookends (Overview / Summary), and stores that marker set
keyed to the session. Nothing runs live in this phase, nothing is displayed, no
tracker is built. The markers sit inertly in the database until RTV-03/RTV-05
consume them.

The core problem this solves: generic or common words (e.g. "AI", "model",
"Claude") appear across many topics in a session. If the tracker listened for
those, a single hit would wrongly conclude the topic changed — the visual would
jump to the wrong topic, or the session would appear to end early. RTV-02's
three-check algorithm guarantees every stored marker is a **"golden word"** — a
specific named term that appears in *exactly one* topic of that session — so
that RTV-03's design rule of **single-hit-decisive detection** (one marker hit is
enough, no corroboration) is safe to act on.

Failure mode without this feature: RTV-03 has nothing reliable to listen for, so
either RTV-03 cannot be built, or it is built on common-word matching and
produces silent wrong output (wrong visual, early end) during real executive
sessions — exactly the LIVE-06-class dual-signal failure the RTV series exists
to avoid.

This is a real, permanent, additive production feature. It ships behind a new
server-only flag, default OFF. OFF means today's exact content-authoring
behavior, byte-for-byte unchanged — no marker is generated, no new column is
written. ON means markers are generated and stored as purely additive data;
existing session content, scripts, `live_conductor_content`, and KB rows are
untouched.

---

## 2. User Story

As **Arun (product owner)**,
I want every Hume-native session's topics to carry a stored set of genuinely
unique "golden word" markers, generated automatically at content-authoring time
with a hard no-empty guarantee,
So that the later live tracker (RTV-03) can identify which topic Clio is teaching
from a single reliable keyword hit, and so that any session whose content cannot
yield a unique marker for even one topic is safely and visibly flagged
RTV-ineligible rather than silently shipping a tracker that would misfire.

As **a QA engineer / the product owner reviewing a real session**,
I want to inspect, per session, each topic and its ranked golden words (and see
which sessions were flagged RTV-ineligible and why),
So that I can verify marker quality before RTV-03 is ever switched on, and spot
content that needs improvement.

(No end-user-facing UI in this phase. The only human-facing surface is the
inspectability read path in Section 4.4 / Q6. Live participants are not affected
at all in this phase — the toggle default is OFF and even ON produces only
inert data.)

---

## 3. Trigger / Entry Point

- **No route, no URL, no end-user UI.** Marker generation is a new step hooked
  into the existing server-side content-authoring pipeline. It fires as part of
  work that is already triggered today; it adds no new user-facing trigger.
- **Primary trigger (authoring-time):** the existing Inngest function
  `session-content-pipeline` in `inngest/session-content-pipeline.ts`, which runs
  when a user approves their session plan (events
  `distill/session.content.generate` / `distill/session.designer.completed`).
  Marker generation hooks into the **LIVE-01 branch** of that function —
  immediately after `live_conductor_content` is built and passes its readiness
  check, before the step returns (see Section 4.2, Q4). This is the canonical
  producer: it is not latency-critical (background job), so it runs the full
  algorithm including the bounded rework loop.
- **Secondary path (session-start self-heal):** the CONTENT-POP-01 self-heal
  block in `app/api/hume-native/provision-config/route.ts` (~line 173+), which
  regenerates `live_conductor_content` synchronously at session connect when the
  primary pipeline left content empty. Per the resolved design (Q4, Section 4.3),
  marker generation is **deliberately NOT run synchronously in this path**;
  instead the session is flagged `rtv_eligible = false` so RTV-05's display
  toggle stays effectively OFF for it and today's safe `show_visual`-driven
  behavior is used. This is a documented, justified deferral, not a gap — the
  deferral is recorded as an explicit, inspectable state.
- **New condition governing whether any of this runs:** a new server-only
  environment variable, `RTV_MARKER_GENERATION_ENABLED`. Read as
  `process.env.RTV_MARKER_GENERATION_ENABLED === 'true'`. Any value other than
  the exact string `'true'` (unset, `'false'`, `'1'`, `'TRUE'`, typos) resolves
  to OFF — no marker generation runs, `session_markers` and `rtv_eligible` are
  never written, and content authoring is byte-for-byte identical to today.
- **State required:** identical to today's content pipeline — a `sessions` row
  with `live_conductor_content` populated (`tabs[]` with per-subtopic
  `article`). Marker generation reads only that already-produced structure; it
  requires no new upstream state.

---

## 4. Screen / Flow Description

There is no UI in this phase except the inspectability read path (4.4). Per the
governance model, this section describes the authoring-time data flow at the
same level of detail a UI flow would receive.

### 4.1 Where the marker source text comes from (grounding — verified live)

Verified against Supabase project `nqxlpcshouboplhnuvrh` on 2026-07-10:

- For every real Hume-native session (`sessions.hume_native_enabled = true`),
  the content lives in **`sessions.live_conductor_content`** (`tabs[]`, each with
  a full `article`). `topic_content_cache` has **zero rows keyed by
  `topic_id = sessionId`** for these sessions (the LIVE-01 branch of the pipeline
  writes `sessions.live_conductor_content` and skips the `topic_content_cache`
  per-subtopic upserts entirely). This is the load-bearing storage fact that
  drives the Q3 storage decision (Section 6): `topic_content_cache.topic_markers`
  would strand markers where the content does not exist. The canonical home is
  `sessions`.
- Each tab's `article.sections` has keys: `overview`, `how_it_works`,
  `enterprise_implications`, `key_facts`, `illustrative_example`,
  `decision_questions`, `common_misconceptions`, `try_this`.
- **The exact per-topic marker source string** (Q1, and the CEO brief's "confirm
  the exact string each non-bookend topic emits" constraint) is reproduced
  identically to what `buildSessionSummary()` emits to Clio at runtime:
  1. For non-bookend topic `i`, build the TEACH content exactly as the pipeline /
     self-heal mapping already does:
     `teachContent_i = [overview, how_it_works, enterprise_implications].filter(Boolean).join(' ')`
     (verified: this is the exact mapping at
     `provision-config/route.ts` lines ~305–311, and the field
     `buildSessionScript()`/`buildSessionSummary()` read via the TEACH segment).
  2. The runtime "what to cover" line is
     `extractWhatToCover(teachContent_i)` — the existing (currently
     module-private) function in `lib/clio-context-builder.ts` (lines 305–334),
     which returns the first complete sentence(s) up to a ~40-word / ~260-char
     cap, cut at a sentence boundary. **This is the level-0 marker source.**
- **Never** `buildTopicContext()` / `topic_context_doc` (confirmed NULL on
  effectively all rows and explicitly excluded by the brief).

### 4.2 Primary flow (flag ON) — Inngest `session-content-pipeline`, LIVE-01 branch

Steps 1–2 below are the existing, unchanged LIVE-01 branch; step 3 is the new,
additive marker step. When `RTV_MARKER_GENERATION_ENABLED` is OFF, step 3 does
not run at all and the branch is byte-for-byte as today.

1. **(existing, unchanged)** `generateContentArticles` → `articles`, then
   `generateTopicBackground` → `liveConductorContent` (`topic_background` +
   `tabs[]`).
2. **(existing, unchanged)** `verifyContentReadiness` passes → write
   `sessions.live_conductor_content` + `content_status: 'ready'`, reset the
   `walkthrough_state` tab pointer.
3. **(NEW — additive)** If `RTV_MARKER_GENERATION_ENABLED === 'true'`: run
   `generateSessionMarkers(sessionId, liveConductorContent.tabs)` (the algorithm
   in Section 5 / Q1). Write the result to the two new additive columns
   `sessions.session_markers` (the full marker JSON) and `sessions.rtv_eligible`
   (boolean). This runs in its own `step.run('rtv-generate-markers', …)` so an
   Inngest retry of the marker step never re-runs content generation. A thrown
   error inside this step is caught and converted to
   `rtv_eligible = false` + an admin alert — **it must never fail the parent
   pipeline or roll back `content_status: 'ready'`** (markers are additive; a
   marker failure must not break a session whose content is already good).

### 4.3 Secondary path (flag ON) — provision-config self-heal (deliberate deferral)

- The CONTENT-POP-01 self-heal block regenerates `live_conductor_content`
  synchronously inside `POST /api/hume-native/provision-config` at session
  connect, under an already-tight 60s internal timeout / 120s route budget.
- **Resolved design:** marker generation is NOT run here. Instead, when
  `RTV_MARKER_GENERATION_ENABLED === 'true'` and the self-heal path executes,
  the route sets `sessions.rtv_eligible = false` (and leaves `session_markers`
  as-is / NULL for that session) at the same point it persists the self-healed
  `live_conductor_content`.
- **Justification (answers the CEO brief's "cover the self-heal path or
  explicitly document why it defers"):** (a) the self-heal path is a rare
  defensive backstop that only runs when the primary pipeline left content
  empty — so there are no authoring-time markers to fall back on either; (b) the
  marker algorithm makes 1+ LLM calls and may run its bounded rework loop, which
  cannot be safely fitted into the latency-critical connect budget without
  risking the session start itself; (c) failing **RTV-closed** (not the session)
  is the correct trade — the session still runs perfectly on today's safe
  `show_visual`-driven display, just without the RTV tracker for that one
  session, because RTV-05's display authority defaults OFF and additionally
  requires `rtv_eligible === true`. This is fully consistent with the no-fallback
  hard-stop philosophy: we never "ship empty" markers into a live tracker; we
  fall back to the proven non-RTV path and record the reason.

### 4.4 Inspectability read path (Q6 — the only human-facing surface)

Two ways to inspect stored markers, both read-only:

1. **Admin debug endpoint (new):** `GET /api/admin/session-markers?sessionId=<uuid>`.
   Reuses the exact auth guard of the existing
   `app/api/admin/qa-session-context/route.ts` (Clerk `auth()`; `if (!userId)
   return 401`). Returns the stored `session_markers` JSON plus `rtv_eligible`
   and a flattened, human-readable summary (each topic, its golden word, its
   ranked markers, its source level). Returns `404` if the session has no
   `session_markers` (e.g. toggle was OFF when it was authored).
2. **Documented SQL query (for BA/QA, read-only):**
   ```sql
   SELECT id AS session_id,
          rtv_eligible,
          session_markers->>'generated_at' AS generated_at,
          jsonb_array_length(session_markers->'topics') AS topic_count,
          jsonb_path_query_array(
            session_markers->'topics',
            '$[*].golden_word'
          ) AS golden_words
   FROM sessions
   WHERE id = '<session-uuid>';
   ```
   Per the standing "Use APIs not Supabase" rule, the admin endpoint is the
   preferred path for Arun; the SQL is provided for BA/QA convenience only and is
   strictly read-only.

---

## 5. Visual Examples (algorithm walk-through in place of wireframes)

No UI. Per the CEO brief, in place of wireframes this section gives a worked,
concrete example of the algorithm and the stored output, using real tab-0 content
from session `004b39aa-899e-466e-83d4-9106bd970a3e` (verified live).

### 5.1 Worked example — one topic

Tab 0 title: *"Why These Three API Decisions Will Make or Break Your First Claude
Integration."*
`teachContent_0` (overview + how_it_works + enterprise_implications, joined)
contains, among much else: *"…output format control, sampling parameter
configuration, and streaming… temperature, top_p, top_k, max_tokens… a
server-sent events connection…"*

- **Level-0 marker source** = `extractWhatToCover(teachContent_0)` =
  *"You've made your first Claude API calls, structured your messages, and
  engineered prompts that hold up under pressure."* (first sentence, ~19 words;
  the next sentence would exceed the 40-word cap so extraction stops).
- Candidate nouns in the level-0 line: `claude`, `api`, `calls`, `messages`,
  `prompts`. Check 3 (uniqueness across this session's topics) disqualifies
  `claude`, `api`, `prompts`, `messages` (they appear in other topics of this
  session too). `calls` is descriptive/borderline. Result at level 0: **zero
  qualifying golden words → rework loop fires.**
- **Level-1 rework** widens the candidate pool to the full `teachContent_0`
  (still this topic's own Session Content, additive — see Section 5.3). New
  topic-unique candidates surfaced: `top_p`, `top_k`, `max_tokens`,
  `temperature`, `server-sent`, `streaming`. Checks 1 & 2 (LLM) confirm these are
  named technical terms and cannot-miss for this topic. Uniqueness (check 3,
  deterministic) confirms each appears in exactly one topic of this session.
- **Golden-word scoring** by within-topic frequency (repetition inside its home
  topic is the golden signal): `top_p`(×3) > `temperature`(×2) >
  `server-sent`(×1) … Ranked, strongest first.

### 5.2 Stored output for this topic (excerpt of the `session_markers` JSON)

```json
{
  "section_index": 1,
  "type": "topic",
  "subtopic_slug": "why-these-three-api-decisions-will-make-or-break-your-first-",
  "subtopic_title": "Why These Three API Decisions Will Make or Break Your First Claude Integration",
  "is_bookend": false,
  "source_level": 1,
  "golden_word": "top_p",
  "markers": [
    { "word": "top_p",        "within_topic_freq": 3, "rank": 1 },
    { "word": "temperature",  "within_topic_freq": 2, "rank": 2 },
    { "word": "max_tokens",   "within_topic_freq": 1, "rank": 3 },
    { "word": "server-sent",  "within_topic_freq": 1, "rank": 4 }
  ]
}
```

### 5.3 Bookend entries (no three-check pipeline — Q5 / requirement #17)

```json
{ "section_index": 0,   "type": "SessionOverview", "is_bookend": true,
  "golden_word": "overview", "markers": [ { "word": "overview", "literal": true } ] }
{ "section_index": 6,   "type": "SessionSummary",  "is_bookend": true,
  "golden_word": "summary",  "markers": [ { "word": "summary",  "literal": true } ] }
```

(`section_index` for the Summary bookend is `N+1`, where `N` = number of
non-bookend topics — here 5, so Summary = 6.)

### 5.4 A session that hard-stops (no-fallback → RTV-ineligible)

If any single non-bookend topic yields zero golden words after the full bounded
escalation (levels 0→1→2), the whole session is stored as:

```json
// sessions.rtv_eligible = false
// sessions.session_markers:
{
  "version": 1,
  "rtv_eligible": false,
  "rtv_ineligible_reason": "topic 'the-foundation-model-landscape' yielded zero unique golden words after full source escalation (levels 0-2)",
  "topics": [ /* all topics' markers that WERE found, for inspection */ ]
}
```

An admin alert is emitted (reused `sendAdminAlert`) naming the session and the
failing topic. RTV-05 (default OFF, additionally requires `rtv_eligible === true`)
therefore leaves display authority with `show_visual` for this session — the safe
path. **The session is never shipped with an empty marker set for any topic.**

---

## 6. Data Requirements

### 6.1 Storage decision (Q3) — confirmed with a correction to the brief's suggestion

The CEO brief suggested `topic_content_cache.topic_markers jsonb`. **Rejected,
with evidence:** `topic_content_cache` has zero rows keyed by `topic_id =
sessionId` for real Hume-native sessions (Section 4.1) — the content lives in
`sessions.live_conductor_content`. Storing markers in `topic_content_cache` would
strand them away from the content and away from where RTV-03 reads at runtime.

**Confirmed home: two new additive columns on `sessions` (keyed by session UUID,
which is exactly what RTV-03/RTV-05 already resolve at runtime — see
`provision-config/route.ts` resolving the active `sessions` row):**

| Column | Type | Default | Meaning |
|---|---|---|---|
| `sessions.session_markers` | `jsonb` | `NULL` | Full marker set for the session (shape in 6.2). NULL ⇔ markers never generated (toggle was OFF, or pre-feature session). |
| `sessions.rtv_eligible` | `boolean` | `NULL` | `true` = every non-bookend topic has ≥1 golden word (ready for RTV-03/05). `false` = hard-stop fired or self-heal path deferred (reason inside JSON). `NULL` = not generated. |

- **Migration:** additive `ALTER TABLE sessions ADD COLUMN session_markers jsonb;
  ADD COLUMN rtv_eligible boolean;` — both nullable, no default backfill, no
  change to any existing column. Existing rows read as NULL, which every consumer
  treats as "no markers / not RTV-eligible."
- **Why one JSON column + one boolean, not three columns:** RTV-03/05 need a
  cheap top-level boolean to gate on (`rtv_eligible`); everything else
  (per-topic markers, ranking, reason string, source provenance) is
  structured data best kept in one versioned JSON blob.

### 6.2 `sessions.session_markers` JSON shape (Q3)

```jsonc
{
  "version": 1,
  "generator": "rtv-02",
  "generated_at": "2026-07-10T12:00:00.000Z",
  "source": "live_conductor_content",     // provenance of the marker source text
  "rtv_eligible": true,                    // mirrors the sessions.rtv_eligible column
  "rtv_ineligible_reason": null,           // string when rtv_eligible=false, else null
  "topics": [
    // section_index space MATCHES the show_visual / tracker space exactly:
    //   0 = Overview bookend, 1..N = non-bookend topics in tab order, N+1 = Summary bookend
    {
      "section_index": 0,
      "type": "SessionOverview",
      "subtopic_slug": null,
      "is_bookend": true,
      "golden_word": "overview",
      "markers": [ { "word": "overview", "literal": true } ]
    },
    {
      "section_index": 1,
      "type": "topic",
      "subtopic_slug": "<slug>",
      "subtopic_title": "<title>",
      "is_bookend": false,
      "source_level": 0,                   // 0=what-to-cover line, 1=full teach, 2=full article
      "golden_word": "<highest-ranked word>",
      "markers": [
        { "word": "<token>", "within_topic_freq": 3, "rank": 1 },
        { "word": "<token>", "within_topic_freq": 1, "rank": 2 }
      ]
    }
    // … topics 2..N …
    ,{
      "section_index": 6,
      "type": "SessionSummary",
      "subtopic_slug": null,
      "is_bookend": true,
      "golden_word": "summary",
      "markers": [ { "word": "summary", "literal": true } ]
    }
  ]
}
```

- All `word` values are stored **lowercased and normalized** (the exact form
  RTV-03 will compare live transcript tokens against — RTV-03 lowercases
  incoming speech identically).
- `within_topic_freq` and `rank` are omitted on bookend literal markers (they
  don't go through scoring).

### 6.3 How RTV-03 (future) reads it at runtime

RTV-03 already resolves the active `sessions` row at session start (the same
query `provision-config/route.ts` uses). It reads `rtv_eligible` and
`session_markers` from that row:
- If `rtv_eligible !== true` → RTV-03 does not take display authority;
  `show_visual` remains authoritative (safe path). No further reads.
- If `rtv_eligible === true` → RTV-03 loads `session_markers.topics`, keyed by
  `section_index` (identical to the `show_visual({ section_index })` space), and
  runs its forward-only state machine, matching live transcript tokens against
  each topic's `markers[].word`. Bookend literal markers ("overview"/"summary")
  let it detect entry into the Overview/Summary moments. (Making Clio *say* those
  words is RTV-03's prompt job — out of scope here; RTV-02 only records that the
  bookend markers ARE those literal words.)

### 6.4 Reads / writes / external calls introduced by this feature

- **Read (new):** `sessions.live_conductor_content` (already read by
  provision-config; the Inngest branch has `liveConductorContent` in-memory, no
  extra read). `process.env.RTV_MARKER_GENERATION_ENABLED` (string, read once per
  pipeline run / per provision-config request).
- **Write (new, additive):** `sessions.session_markers`,
  `sessions.rtv_eligible`. No existing column is written differently. No write
  to `topic_content_cache`, `walkthrough_state`, `content_outline`, or
  `training_script`.
- **External API (new):** one Anthropic Messages API call per session
  (`claude-sonnet-4-6`, temperature 0), for checks 1 & 2 only, reusing the exact
  client pattern in `lib/content/live-conductor-content.ts` (the `isPlaceholder`
  guard + `MODEL` const). Rework escalations reuse the same single-call shape
  (at most 3 calls per session in the worst case: levels 0, 1, 2). On a
  placeholder API key, the call is mocked (Section 8) so builds/dev never break.
- **No `localStorage`/`sessionStorage`** — server-side only.

---

## 7. Success Criteria (Acceptance Tests)

Each is testable by QA. Tests 1–8 are unit/integration-testable against the
`generateSessionMarkers` module + a mocked Anthropic client and a mocked/staged
`sessions` row; test 9 is a manual DB-inspection acceptance test.

1. ✓ **OFF = byte-identical (rollback safety).** Given
   `RTV_MARKER_GENERATION_ENABLED` unset or any value other than `'true'`, when a
   session's content pipeline runs to completion, then `sessions.session_markers`
   and `sessions.rtv_eligible` remain `NULL`, no Anthropic call for markers is
   made, and `live_conductor_content` / `content_status` / `walkthrough_state`
   are written exactly as before this feature existed (assert the
   marker step is never entered).

2. ✓ **Marker source is the exact runtime "what to cover" line.** Given a topic's
   `article`, when the level-0 marker source is computed, then it equals
   `extractWhatToCover([overview, how_it_works, enterprise_implications].filter(Boolean).join(' '))`
   — identical to what `buildSessionSummary()` emits for that topic (assert
   string equality against a direct call to the shared function).

3. ✓ **Check 3 is deterministic and grouped-by-topic.** Given a token that
   appears 5 times inside topic A and 0 times in every other topic, when
   uniqueness is computed, then the token is topic-unique (qualifies on check 3).
   Given a token that appears once in topic A and once in topic B, then it is NOT
   topic-unique (fails check 3) regardless of total count. No LLM is invoked for
   this determination (assert the Anthropic mock is not called during check 3).

4. ✓ **Golden-word ranking rewards within-home-topic repetition.** Given two
   topic-unique, LLM-approved tokens in the same topic with within-topic
   frequencies 3 and 1, when markers are ranked, then the frequency-3 token has
   `rank: 1` and is the topic's `golden_word`.

5. ✓ **No-fallback guarantee holds (happy path).** Given a session where every
   non-bookend topic yields ≥1 golden word (possibly after escalation), when
   generation completes, then every non-bookend topic entry has a non-empty
   `markers` array and a non-null `golden_word`, `rtv_eligible = true`, and
   `rtv_ineligible_reason = null`.

6. ✓ **No-fallback hard-stop (failure path) — never ship empty.** Given a session
   in which at least one non-bookend topic yields zero golden words even after
   the full bounded escalation (levels 0→1→2), when generation completes, then
   `rtv_eligible = false`, `rtv_ineligible_reason` names the failing topic, an
   admin alert is emitted, and **no non-bookend topic is stored with an empty
   `markers` array while `rtv_eligible = true`** (i.e. `rtv_eligible = true`
   implies all non-bookend topics have ≥1 marker — assert this invariant).

7. ✓ **Bookends bypass the three-check pipeline (Q5 / #17).** Given any session,
   when markers are generated, then the entry at `section_index 0` has exactly
   one marker `{ "word": "overview", "literal": true }` and the entry at
   `section_index N+1` has exactly one marker `{ "word": "summary", "literal":
   true }`, and neither bookend was passed to the tokenizer, check 3, or the LLM.

8. ✓ **Marker step never breaks a good session.** Given the Anthropic call for
   checks 1&2 throws (network error), when the marker step runs inside the
   Inngest pipeline, then `content_status` remains `'ready'`,
   `live_conductor_content` is unchanged, `rtv_eligible` is set to `false` with a
   reason, and the parent pipeline returns success (assert the parent does not
   throw / does not retry content generation).

9. ✓ **Self-heal path defers correctly (Q4).** Given `RTV_MARKER_GENERATION_ENABLED
   = true` and a session whose content is regenerated via the provision-config
   self-heal path, when provisioning completes, then `sessions.rtv_eligible =
   false` for that session, `session_markers` is not populated by that path, the
   session connects and runs normally, and no marker-generation LLM call was made
   inside the connect request (assert connect latency is unaffected).

10. ✓ **Inspectability (Q6).** Given a session with generated markers, when
    `GET /api/admin/session-markers?sessionId=<id>` is called by an authenticated
    admin, then it returns the stored `session_markers` + `rtv_eligible` + a
    flattened per-topic summary; and for a session with no markers it returns
    `404`; and unauthenticated requests return `401`.

11. ✓ **Section-index space matches show_visual.** Given a session with N
    non-bookend topics, when markers are generated, then `topics[].section_index`
    is exactly `{0, 1, …, N, N+1}` in order — Overview=0, topics=1..N in tab
    order, Summary=N+1 — matching the `show_visual({ section_index })` space RTV-03
    will align against.

---

## 8. Error States

- **`RTV_MARKER_GENERATION_ENABLED` set to an unexpected value** (`'1'`, `'yes'`,
  `'TRUE'`) → resolves to OFF via strict `=== 'true'`. Safe default, not an error.
- **Anthropic API key is a placeholder** (`isPlaceholder` true) → the checks-1&2
  call is mocked: the mock approves the top-K topic-unique tokens by within-topic
  frequency (K = min(3, candidate count)) as "noun + cannot-miss," so dev/build
  and CI never break and produce deterministic, non-empty markers where
  topic-unique candidates exist. Logged as `[MOCK] rtv-02: …`.
- **Anthropic call fails at runtime (network/5xx/timeout)** → caught; the whole
  session is flagged `rtv_eligible = false` with reason
  `"marker LLM judgment unavailable"`, an admin alert is emitted, and the parent
  pipeline is unaffected (test 8). Markers are not partially trusted from a failed
  LLM pass.
- **LLM returns malformed JSON** → treated identically to a call failure
  (`rtv_eligible = false`, reason recorded). No attempt to salvage partial output
  into live markers (precision-over-recall bias).
- **A topic's `article` is missing / all three TEACH fields empty** → its
  `teachContent_i` is empty → level-0 source is empty. Escalation to level 1/2
  also yields nothing → that topic contributes zero golden words → session
  hard-stops to `rtv_eligible = false` (test 6). Never throws.
- **`live_conductor_content` has zero tabs** → nothing to generate; store
  `session_markers = { version:1, rtv_eligible:false, rtv_ineligible_reason:"no
  topics in live_conductor_content", topics:[bookends only] }`,
  `rtv_eligible = false`. Never throws.
- **DB write of `session_markers`/`rtv_eligible` fails** → logged as non-fatal
  (like the existing `walkthrough_state` tab-pointer reset). Content is already
  committed; a missed marker write simply means that session is treated as
  not-yet-eligible (NULL) by RTV-03 — the safe default.
- **Toggle flips ON/OFF in production between two sessions** → each pipeline run /
  request reads the flag independently at its own start; no caching. A session
  authored while OFF simply has NULL markers (RTV-safe); re-authoring it while ON
  populates them.

---

## 9. Edge Cases

- **Session with 1 non-bookend topic (+2 bookends):** `section_index` space is
  `{0,1,2}`. No special casing; the same algorithm applies. (Check-3 uniqueness
  with only one topic means *every* topic-unique-by-definition token qualifies on
  check 3 — the LLM checks 1&2 still prune to genuine named nouns, so precision
  is preserved.)
- **Two topics share a distinctive term** (e.g. both cover "streaming"): that
  term fails check 3 for both (appears in 2 topics) and is dropped from both —
  correct: it is not safe for single-hit-decisive detection.
- **A topic whose only unique named term appears once:** valid — a single
  topic-unique named noun is a legitimate golden word (`within_topic_freq: 1`).
  Repetition is a *bonus* to ranking, never a qualification gate (per requirement
  #3: "more repetition within its home topic is a plus, never a disqualifier").
- **Very short thin intro line at level 0 (the common case, per the tab-0
  example):** expected to escalate to level 1 routinely. This is normal, not an
  error; the bounded escalation exists precisely for this.
- **Compound/technical tokens** (`top_p`, `gpt-4`, `server-sent`, `max_tokens`):
  the tokenizer preserves internal hyphens, underscores, and digits so these
  survive as single tokens (they are exactly the strongest golden words). Pure
  standalone numbers and single-punctuation tokens are discarded.
- **Self-healed session (secondary path):** always `rtv_eligible = false` by
  design (Section 4.3) — a deliberate, resolved deferral, not a bug.
- **Re-running the pipeline for the same session** (content regenerated):
  `session_markers`/`rtv_eligible` are overwritten wholesale with the new run's
  output (idempotent replace, matching #9/#15 "saved once per session, reused if
  that exact session is reused; regenerated if the session's content is
  regenerated").
- **Non-summary-mode / ElevenLabs / Custom-LLM sessions:** RTV-02 still stores
  markers additively if the toggle is ON and `live_conductor_content` exists, but
  RTV-03/05 (future, default OFF, additionally gated on summary-mode) will not
  act on them. RTV-02 does not gate on voice provider or summary mode — it only
  gates on its own generation toggle + presence of content. (This keeps RTV-02
  simple and avoids coupling to `HUME_NATIVE_SUMMARY_MODE`.)

---

## 10. Out of Scope

- **The live tracker (RTV-03)** — no transcript listening, no state machine, no
  matching-against-markers at runtime. RTV-02 only produces the data.
- **The prompt instruction that makes Clio SAY "Overview"/"Summary"** before the
  bookends (requirement #17's speaking half) — that is RTV-03. RTV-02 only
  records the literal bookend markers in storage.
- **Templates (RTV-04) and display switching (RTV-05)** — no template selection,
  no visual rendering, no display toggle. The RTV-05 *display* toggle is a
  separate, later flag; this phase introduces only the *generation* toggle
  `RTV_MARKER_GENERATION_ENABLED`.
- **Relay/connectivity pre-flight gate (#19)** — the "session must not start if
  no transcript data" gate is a live-runtime concern (RTV-03), not this phase.
- **Any change to content generation** — `generateContentArticles`,
  `generateTopicBackground`, `buildSessionScript`, `buildSessionSummary`,
  `extractWhatToCover`'s logic, `content_outline`, `training_script`,
  `topic_content_cache`, `walkthrough_state` are all untouched. (The single
  permitted change is adding `export` to `extractWhatToCover` — additive,
  non-behavioral; Section 12.)
- **Running the marker pipeline synchronously in the session-connect path** —
  explicitly deferred (Section 4.3).
- **Rewriting or inserting fabricated terms into the content a user is taught** —
  the rework loop only *surfaces* genuinely-present named terms from the topic's
  own fuller Session Content; it never mutates stored/served content and never
  fabricates a term (Section 5 / Q2 rationale).
- **Backfilling markers for historical sessions** — no batch backfill; markers
  are generated going forward when the toggle is ON and a session is
  authored/re-authored.

---

## 11. Open Questions

None. All seven CEO-brief questions are resolved in this document:
1. Algorithm spec + worked pseudocode — Section 5 and the pseudocode below.
2. No-fallback rework loop, bounds, hard-stop — Section 5.4 + pseudocode + tests
   5, 6, 8.
3. Storage (rejected `topic_content_cache`, confirmed `sessions.session_markers`
   + `sessions.rtv_eligible`), JSON shape, RTV-03 read path — Section 6.
4. Hook point (Inngest primary; self-heal deferral) + toggle — Sections 3, 4.2,
   4.3.
5. Bookend literal-word markers without the three-check pipeline — Sections 5.3,
   6.2, test 7.
6. Inspectability (admin endpoint + SQL) — Section 4.4, test 10.
7. Toggle + rollback (`RTV_MARKER_GENERATION_ENABLED`, default OFF, byte-identical
   when OFF) — Section 3, test 1.

### Q1 — Authoritative algorithm pseudocode

```
generateSessionMarkers(sessionId, tabs):            # tabs = live_conductor_content.tabs (ordered, non-bookend)
  N = tabs.length

  # ---- 0. Bookend markers (NO three-check pipeline; requirement #17) ----
  topics = []
  topics.push({ section_index: 0,   type:"SessionOverview", is_bookend:true,
                golden_word:"overview", markers:[{word:"overview", literal:true}] })

  # ---- 1. Build per-topic sources at all 3 levels (all from the topic's OWN Session Content) ----
  for i in 0..N-1:
     a = tabs[i].article.sections
     teach_i   = [a.overview, a.how_it_works, a.enterprise_implications].filter(nonempty).join(" ")
     level0_i  = extractWhatToCover(teach_i)                      # EXACT runtime "what to cover" line
     level1_i  = teach_i                                         # full TEACH
     level2_i  = join(all 8 article.sections fields as text)     # richest own-topic source

  # ---- 2. STABLE uniqueness corpus (deterministic, NO LLM) ----
  # Uniqueness is defined once, against each topic's FULL teach text, so "appears in exactly
  # one topic" is stable and independent of which escalation level a topic is currently using.
  for i in 0..N-1:
     tokensFull_i = tokenize(level1_i)                           # multiset
  tokenToTopics = map<token, set<topicIndex>>
  for i, for token in distinct(tokensFull_i): tokenToTopics[token].add(i)
  isTopicUnique(token) := |tokenToTopics[token]| == 1

  # ---- 3. Per-topic candidate extraction with bounded escalation (rework loop) ----
  for i in 0..N-1:
     markers_i = []
     for level in [0,1,2]:                                       # bounded: 3 source levels max
        pool = tokenize(source_at(level, i))                     # multiset for THIS topic at THIS level
        candidates = distinct(pool) filtered to isTopicUnique(token)   # CHECK 3 (deterministic)
        if candidates is empty: continue                        # nothing unique at this level, escalate
        approved = LLM_checks_1_and_2(topic_title_i, source_text, candidates)  # CHECKS 1 & 2 (see Q1 LLM below)
        if approved non-empty:
           # ---- golden-word scoring: within-home-topic frequency is the golden signal ----
           for t in approved: freq_i[t] = count(pool, t)         # repetition within home topic = PLUS
           ranked = approved sorted by (freq_i desc, token.length desc, token asc)
           markers_i = ranked.mapWithRank()
           source_level_i = level
           break                                                 # topic satisfied; stop escalating
     if markers_i is empty:
        # ---- NO-FALLBACK HARD STOP: never ship empty ----
        rtv_eligible = false
        rtv_ineligible_reason = "topic '{slug_i}' yielded zero unique golden words after full source escalation (levels 0-2)"
        # continue building other topics' markers for inspection, but the SESSION is ineligible
     topics.push({ section_index:i+1, type:"topic", subtopic_slug:slug_i, is_bookend:false,
                   source_level:source_level_i, golden_word: markers_i[0]?.word ?? null, markers: markers_i })

  topics.push({ section_index:N+1, type:"SessionSummary", is_bookend:true,
                golden_word:"summary", markers:[{word:"summary", literal:true}] })

  rtv_eligible = (rtv_eligible != false) AND every non-bookend topic has >=1 marker
  write sessions.session_markers = { version:1, generator:"rtv-02", generated_at:now,
        source:"live_conductor_content", rtv_eligible, rtv_ineligible_reason, topics }
  write sessions.rtv_eligible = rtv_eligible
  if not rtv_eligible: sendAdminAlert(session, rtv_ineligible_reason)
```

**Tokenizer (deterministic):** lowercase + Unicode NFKC normalize; split on
whitespace and punctuation **except** internal hyphens `-`, underscores `_`, and
dots between alphanumerics (so `top_p`, `server-sent`, `gpt-4`, `claude-sonnet`
survive as single tokens); drop tokens that are pure numbers or shorter than 2
chars; drop tokens in a small English stopword list (articles, prepositions,
pronouns, auxiliaries, and a curated set of session-generic words such as
`ai`, `model`, `models`, `use`, `using`, `data`, `system`). The stoplist is a
constant in the RTV-02 module, reviewable by QA.

**Checks 1 & 2 = ONE LLM call across all topics (not per-topic):** a single
`claude-sonnet-4-6`, temperature 0 Messages call is made per escalation level
that needs judgment, passing every topic that still needs candidates judged at
that level, each with its title, its source text, and its topic-unique candidate
tokens. The model returns strict JSON `{ "topics": [ { "index": i,
"qualifying_tokens": ["…"] } ] }`, selecting only tokens that are BOTH (1) a
noun / specific named thing or technical term (not descriptive/paraphrasable) AND
(2) cannot-miss (the topic cannot be taught without saying it). **Rationale for
single-call-across-all-topics:** it gives the model the whole session's topic set
in one context so its "cannot-miss" and named-term judgments are consistent and
cross-aware, and it is cheaper/lower-latency than N calls. Worst case is 3 calls
per session (levels 0,1,2). Check 3 is **never** sent to the LLM — it is pure
in-process counting.

### Q2 — No-fallback rework loop (exact mechanics)

- **Detection of a zero-marker topic:** after checks 3→1→2 at a given source
  level, if a non-bookend topic's approved set is empty, it escalates to the next
  source level.
- **The re-extraction instruction (bounded, additive, no content mutation):**
  escalation does not re-prompt the LLM to *rewrite content*; it deterministically
  **widens the candidate pool from the topic's own Session Content** — level 0 =
  the ~40-word what-to-cover line, level 1 = the full TEACH (overview +
  how_it_works + enterprise_implications), level 2 = the full 8-field article.
  Each wider level surfaces genuinely-present named terms the thin line omitted
  (e.g. `top_p`, `temperature`, `server-sent`). This directly implements the
  brief's "re-run extraction with a deliberate instruction to surface a genuinely
  unique named term," and is chosen over literally rewriting/inserting terms into
  stored content because (a) the standing no-regress rule forbids altering
  existing content-authoring output, and (b) fabricating terms into what a user is
  taught risks accuracy. Uniqueness (check 3) is computed once against the stable
  full-teach corpus, so escalating one topic never destabilizes another topic's
  uniqueness.
- **Bounded attempts:** exactly 3 source levels (0→1→2). No infinite loop —
  level 2 is the richest available own-topic source; if it has no topic-unique
  named noun, no further re-running can help.
- **Hard-stop if still zero (never "ship empty"):** set `rtv_eligible = false`,
  record `rtv_ineligible_reason` naming the failing topic, store whatever markers
  the other topics produced (for inspection only), emit an admin alert. RTV-05's
  display authority (default OFF, additionally requires `rtv_eligible === true`)
  therefore never engages for this session → today's safe `show_visual` path is
  used. The session runs normally; only the RTV tracker is withheld for it.

---

## 12. Dependencies

**Must be true before this can be built:** nothing external — no third-party
setup, no credentials beyond the already-configured `ANTHROPIC_API_KEY`. One
additive DB migration.

**DB migration (additive only):**
```sql
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS session_markers jsonb;
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS rtv_eligible boolean;
```
No default, no backfill, no change to existing columns. Existing rows read NULL
(treated as "no markers / not eligible" by all consumers).

**Files a developer will change / add:**

1. **New:** `lib/content/session-markers.ts` — exports
   `generateSessionMarkers(sessionId, tabs): SessionMarkers` implementing the Q1
   algorithm (tokenizer, stoplist, deterministic check 3, single-call LLM checks
   1&2 reusing the `lib/content/live-conductor-content.ts` Anthropic pattern +
   placeholder mock, golden-word scoring, bounded rework loop, hard-stop). Pure/
   testable; does its own DB write via the admin client, or returns the object
   for the caller to write (developer's choice — spec requires the object shape
   in 6.2 either way).
2. **`lib/clio-context-builder.ts`** — add `export` to the existing
   `extractWhatToCover` function (currently module-private, line 305).
   **Flagged existing-code change per the standing no-regress rule:** this is
   additive and strictly non-behavioral — it changes no logic, only visibility —
   so that RTV-02 reuses the *exact* same function that produces the runtime
   "what to cover" line (single source of truth, no duplication/drift). No
   existing caller is affected.
3. **`inngest/session-content-pipeline.ts`** — inside the existing LIVE-01 branch,
   after the `live-conductor-generate-and-store` step succeeds, add a new
   `step.run('rtv-generate-markers', …)` gated on
   `process.env.RTV_MARKER_GENERATION_ENABLED === 'true'`. Errors caught → set
   `rtv_eligible = false` + admin alert; never throw to the parent. When the flag
   is OFF, the step is skipped entirely (byte-identical to today).
4. **`app/api/hume-native/provision-config/route.ts`** — in the CONTENT-POP-01
   self-heal block, when `RTV_MARKER_GENERATION_ENABLED === 'true'` and self-heal
   runs, set `sessions.rtv_eligible = false` at the same write where the
   self-healed `live_conductor_content` is persisted (the deliberate deferral,
   Section 4.3). No marker LLM call in this path.
5. **New:** `app/api/admin/session-markers/route.ts` — `GET` handler, Clerk
   `auth()` guard identical to `app/api/admin/qa-session-context/route.ts`,
   returns stored markers + flattened summary (Section 4.4).
6. **`.env.local.example`** — add `RTV_MARKER_GENERATION_ENABLED=false`
   (documented default, following the existing boolean-flag convention).
7. **New test file:** `tests/unit/session-markers.test.ts` — acceptance tests
   1–8 and 11 (structural/deterministic assertions against a mocked Anthropic
   client + staged tabs); tests 9 and 10 are manual/integration acceptance checks
   per Section 7's framing.

**Nothing else changes.** No existing content-generation function's behavior is
altered; the only existing-code edit is the additive `export` in change #2, which
is explicitly flagged above.
