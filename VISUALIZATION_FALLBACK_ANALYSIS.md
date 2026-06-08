# Root Cause Analysis: Live Session Uses Fallback Visualization Instead of KB Content

## What the User Sees

During a live Clio Google Meet session, the screen-share displays **live-generated visuals** (produced in real-time by Claude via `/api/generate-visual`) instead of **pre-generated hero content** from the Knowledge Base. This means:
- Visuals take several seconds to appear after `show_visual` is called
- The screen shows "Preparing your visual..." spinner during generation
- Each section triggers a fresh Claude API call during the coaching session
- The pre-built, high-quality KB content is completely ignored

---

## Architecture Overview (How It Should Work)

There are **two pipelines** that produce visual content, and one session-launch coordinator:

### Pipeline 1 — `generate-plan` (old, synchronous)
- **Route:** `POST /api/sessions/[id]/generate-plan`
- **Stores:** `sessions.session_plan` JSONB column — each subtopic gets a `template_section` object
- **Read by:** `getAllReadySections(session_plan)` in `lib/session-plan.ts`
- **Key used:** `session.topic_id ?? ''` — empty string for curriculum sessions (topic_id is null)
- **Problem:** Was never updated to handle curriculum sessions — always uses empty string as topicId

### Pipeline 2 — `generate-content` → Inngest (new, async, the KB pipeline)
- **Route:** `POST /api/sessions/[id]/generate-content` → triggers `clio/session.content.requested`
- **Inngest function:** `inngest/session-content-async.ts`
- **Stores:** `topic_content_cache` table — rows with `(topic_id, subtopic_slug)` as composite key
- **Columns written:** `section_data` (the TemplateSection), `training_script`, `content_outline`
- **Key used (after KB fix commit ccc6ac2):** `curriculum_session_id ?? topics[0] ?? 'ai-fundamentals'`
- **This is what the KB page reads from and what should drive live sessions**

### Session Launch — `recall/bot`
- **Route:** `POST /api/recall/bot`
- **Logic for curriculum sessions:**
  1. `topicId = session.topic_id ?? session.curriculum_session_id`
  2. Queries `topic_content_cache WHERE topic_id = topicId AND pipeline_status = 'ready'`
  3. Builds `freshSections` from `section_data` column of those rows
  4. Writes `walkthrough_state.sections = freshSections` (or `null` if empty)
- **During the live session:** `WalkthroughClient.show_visual` checks `sectionsRef.current`. If sections exist, scrolls to the matching one instantly. If sections array is empty → falls through to `POST /api/generate-visual` (live generation)

---

## Root Cause

### Primary Cause: Wrong `topic_id` Key in `topic_content_cache`

Before commit `ccc6ac2`, `inngest/session-content-async.ts` derived `topicId` as:
```typescript
const topicId = session.topic_id ?? 'ai-fundamentals'
```

Curriculum sessions have `topic_id = null`. So all 5 existing sessions stored their KB content under:
```
topic_id = 'ai-fundamentals'
subtopic_slug = <actual subtopic slug>
```

When `recall/bot` launches a session, it queries `topic_content_cache` with:
```
topic_id = curriculum_session_id   (e.g. 'claude-for-work-s1')
```

Result: **zero rows found**. `freshSections = []`. `walkthrough_state.sections = null`.

WalkthroughClient sees `hasSections = false` → every `show_visual` call falls through to live generation.

### Secondary Cause: `generate-plan` Pipeline Also Broken for Curriculum Sessions

`POST /api/sessions/[id]/generate-plan` uses:
```typescript
const topicId = session.topic_id ?? ''
```

Empty string for curriculum sessions. `getCachedSection('' , slug, ...)` and `setCachedSection('', slug, ...)` use a nonsense cache key. So even if `generate-plan` was called, `readySections` from `session_plan` would be unreliable for curriculum sessions.

`recall/bot` correctly bypasses `readySections` for curriculum sessions and goes straight to `topic_content_cache` — but this means it is **entirely dependent** on Pipeline 2 being correct. When Pipeline 2 data is missing or under the wrong key, there is no fallback — it silently launches with empty sections.

---

## How It Happened (Timeline)

1. `generate-plan` route built for **topic-based sessions** — works correctly, `topic_id` is always set
2. Curriculum sessions introduced — `topic_id` set to `null`, `curriculum_session_id` used instead
3. `recall/bot` correctly updated to handle curriculum sessions (queries `topic_content_cache` directly)
4. `session-content-async.ts` (Inngest, Pipeline 2) built — but fallback was `topic_id ?? 'ai-fundamentals'`
5. Nobody caught the `null` → `'ai-fundamentals'` substitution because:
   - The KB page appeared to show content (it just showed it under `ai-fundamentals`)
   - `generate-content` returned `status: ready` — the job completed successfully
   - The mismatch only manifests at session launch time, when `recall/bot` queries by the wrong key
6. Live sessions silently degraded to fallback without surfacing an error

---

## Why It Was Invisible

- `POST /api/sessions/[id]/generate-content` returns `{ jobId, status: 'queued' }` — success
- The Inngest job completes — `async_jobs.status = 'complete'` — looks green
- KB page shows content — but it's under `ai-fundamentals`, not the correct curriculum slug
- `recall/bot` logs: `Cache rows found: 0` but this is buried in Vercel function logs, not surfaced to the user
- `walkthrough_state.sections = null` is written silently; no error is returned
- The live session launches and appears to work — visuals do appear, just generated live instead of from cache

---

## What Needs to Happen (In Order)

### Step 1 — Data Fix (immediate, no code change needed)
Re-run `generate-content` for all 5 sessions after the KB fix (`ccc6ac2`) is deployed:
```
ead3a7ce-d4c4-4039-957e-7c6654dcc2b1
21766450-95a3-4093-bd5a-838c3494fc85
58ab5cec-9915-47e3-a789-40282d9d660e
384d411b-d448-4cb2-8777-453a0d03e31e
747a30ed-6691-45fc-b4b2-8bd5aaf9d950
```
Then clean up the stale rows:
```sql
DELETE FROM topic_content_cache
WHERE topic_id = 'ai-fundamentals'
  AND subtopic_slug IN (
    SELECT subtopic_slug FROM topic_content_cache
    WHERE topic_id = 'ai-fundamentals'
      AND created_at > '2026-06-06'  -- rows from the buggy pipeline run
  );
```
Or more targeted — delete by user_id context if the table has it.

---

## Fix Options (Code Changes — DO NOT IMPLEMENT WITHOUT APPROVAL)

### Fix A — Guard in `recall/bot` (defensive warning / hard gate)

Add after `freshSections` is built:
```typescript
if (freshSections.length === 0 && isCurriculumSession) {
  console.error(
    `[recall/bot] CRITICAL: No sections found in topic_content_cache for ` +
    `curriculum session topic_id=${topicId}. Live session will degrade to ` +
    `on-the-fly generation. Run generate-content for session ${sessionId} first.`
  )
  // Option: return 400 so the UI shows "Content not ready" instead of launching a broken session
  return NextResponse.json(
    { error: 'Session content not ready. Please generate content before launching.' },
    { status: 400 }
  )
}
```

**Pro:** Surfaces the problem clearly at launch time instead of silently degrading.  
**Con:** Blocks launch until content is ready — may be too strict if content generation is slow.

---

### Fix B — Pre-flight check in UI (soft gate)

Before the "Launch Session" button becomes active, verify:
```typescript
const { data } = await supabase
  .from('topic_content_cache')
  .select('subtopic_slug')
  .eq('topic_id', topicId)
  .eq('pipeline_status', 'ready')

if ((data?.length ?? 0) === 0) {
  // Show "Content is still being prepared..." with a spinner
  // Disable the launch button
}
```

**Pro:** User-friendly, non-blocking.  
**Con:** An extra DB query on the session page.

---

### Fix C — `generate-plan` fix for curriculum sessions

In `generate-plan/route.ts`, change:
```typescript
const topicId = session.topic_id ?? ''
```
to:
```typescript
const topicId = session.topic_id ?? (session as unknown as { curriculum_session_id?: string }).curriculum_session_id ?? ''
```

Also requires selecting `curriculum_session_id` in the query.

**Impact:** Makes Pipeline 1 cache correctly for curriculum sessions. Gives `recall/bot` a valid `session_plan` fallback even if Pipeline 2 cache is empty.

---

### Fix D — Assert in `session-content-async` (prevention)

In `inngest/session-content-async.ts`, after `topicId` is derived:
```typescript
if (topicId === 'ai-fundamentals' && session.curriculum_session_id) {
  throw new Error(
    `topicId resolved to 'ai-fundamentals' for a curriculum session ` +
    `(curriculum_session_id=${session.curriculum_session_id}). ` +
    `This would corrupt the cache key. Fix the topicId derivation.`
  )
}
```

**Pro:** Fails loudly at generation time, not silently at session launch.  
**Con:** Would have failed the Inngest job (retries 2×) rather than quietly completing with wrong data.

---

## Prevention Going Forward

1. **Never use a real topic slug as a fallback** — `'ai-fundamentals'` is a real topic that real sessions use. A fallback to it contaminates that topic's cache. Use `null` or a sentinel like `'__unknown__'` if a fallback is truly needed.

2. **`topic_content_cache` key must be validated before write** — an assertion that `topicId` is non-empty and not `'ai-fundamentals'` (unless the session is genuinely for that topic) would have caught this immediately.

3. **Session launch pre-flight gate** — `recall/bot` should refuse to launch (return 4xx) when `freshSections.length === 0` for a curriculum session. A degraded session is worse than a blocked one, because the user goes through the meeting without realising the content is wrong.

4. **End-to-end test for the KB → live-session path** — test: trigger `generate-content` → verify `topic_content_cache` has rows under correct key → call `recall/bot` → verify `walkthrough_state.sections` is non-empty. This test would have caught both the wrong-key bug and the empty-sections silent failure.

---

## Summary

| | Detail |
|---|---|
| **Symptom** | Live session generates visuals on-the-fly instead of serving pre-built KB content |
| **Root cause** | `topic_content_cache` rows stored under `topic_id = 'ai-fundamentals'`; `recall/bot` queries by `curriculum_session_id` and finds nothing |
| **Why it happened** | `session-content-async.ts` used `session.topic_id ?? 'ai-fundamentals'` — null for curriculum sessions |
| **Code fix deployed** | `ccc6ac2` — correct topicId derivation in Inngest pipeline |
| **Data still broken** | 5 existing sessions — content stored under wrong key, not yet re-generated |
| **Immediate action** | Re-run `generate-content` for all 5 sessions |
| **Structural gap** | No guard in `recall/bot` when sections = empty; no pre-flight check in UI |
| **Best long-term fix** | Fix A (guard in recall/bot) + Fix B (UI pre-flight) + Fix D (assertion in Inngest) |
