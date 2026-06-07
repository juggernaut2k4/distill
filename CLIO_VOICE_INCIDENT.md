# Clio Voice Session — Incident Log & Root Cause Analysis

**Date:** 2026-05-24  
**Status:** Unresolved — analysis complete, no code changed  
**Symptom:** Clio joins the Google Meet call but never speaks or listens. The WebSocket to ElevenLabs connects briefly then disconnects in a loop, or fails entirely. `/api/clio/chat/completions` is never called during real sessions.

---

## 1. What Was Working Before

Before the content pipeline was added (before commit `0e81db5`), the session flow was:
- Bot joins Meet → loads `/walkthrough/${userId}` → WalkthroughClient mounts
- `Conversation.startSession()` sends a short, hand-crafted system prompt as `overrides.agent.prompt.prompt`
- ElevenLabs WebSocket connects, Clio listens and speaks
- Participant words captured by Recall.ai → transcript webhook → `walkthrough_state.pending_transcript` → WalkthroughClient polls → `conv.sendUserMessage()` → ElevenLabs → Claude generates speech → bot speaks in Meet

This entire flow was working.

---

## 2. What Changed (Chronological)

### Phase 1 — Content Pipeline (broke voice context, May 23 evening)

**Commits:** `0e81db5` → `6c6578d` → `74964e0` → `f34089b` → `1407c61`

Each commit added richer session context:
| Commit | What was added |
|--------|---------------|
| `74964e0` | Training scripts sent via `sendContextualUpdate` on first connect |
| `f34089b` | Full context (training scripts + outlines) built via `buildAllClioDocs`, stored in `walkthrough_state`, injected as `agent.prompt.prompt` override |
| `1407c61` | Three-document system: `session_brief` + `topic_context` + `session_script` — total ~41,000 chars |

**The problem this created:** ElevenLabs has a hard practical limit of ~12,000 chars on `overrides.agent.prompt.prompt`. When the combined three-doc context (~41k chars) was sent as the prompt override, ElevenLabs silently rejected or dropped the WebSocket. This produced the `connecting → listening → disconnected (retry 1)` loop that appeared after adding knowledge base content.

**Why it only broke after knowledge base content:** A session without content pipeline data has short context (~2k chars). A session with full knowledge base content has 41k chars. So the bug only surfaces when a session has been through the full content pipeline.

---

### Phase 2 — Today's Fix Attempt (May 24)

**Commits:** `ee2ef55` → `1a49f31` → `dbf3370` → `4a4cd54`

**The fix:** Built `/api/clio/chat/completions` — an OpenAI-compatible streaming endpoint. Instead of injecting 41k chars into ElevenLabs' prompt override, the plan was:
- Send only a tiny 60-char prompt: `You are Clio, an AI business coach. DISTILL_USER_ID: ${userId}`
- ElevenLabs calls our endpoint for every LLM turn
- Our endpoint fetches full 41k context from `walkthrough_state` in Supabase
- Our endpoint calls Claude Sonnet 4.6 with the full context
- Claude's response is streamed back to ElevenLabs in OpenAI SSE format

**Verification:** The endpoint was curl-tested successfully. ElevenLabs dashboard "Test connection" passed. The agent was published.

**What changed in `Conversation.startSession()`:**
```typescript
// BEFORE
const conv = await Conversation.startSession({
  agentId: AGENT_ID,
  connectionType: 'websocket',
  overrides: {
    agent: {
      prompt: { prompt: systemPrompt },  // 41k chars
      firstMessage: isReconnect ? '' : greeting,
    },
    tts: { voiceId: VOICE_ID },
  },
  ...

// AFTER
const conv = await Conversation.startSession({
  agentId: AGENT_ID,
  connectionType: 'websocket',
  dynamicVariables: { user_id: userId },  // ← NEW, potentially breaking
  overrides: {
    agent: {
      prompt: { prompt: `You are Clio, an AI business coach. DISTILL_USER_ID: ${userId}` },  // ← 60 chars
      firstMessage: isReconnect ? '' : greeting,
    },
    tts: { voiceId: VOICE_ID },
  },
```

---

## 3. Root Cause Analysis

### Why is `/api/clio/chat/completions` never called?

The Vercel logs show the bot joins the call (`bot.in_call_not_recording`) but there are **zero logs** from:
- `GET /walkthrough/${userId}` (the page the bot loads)
- `GET /api/walkthrough-state/${userId}` (the 300ms polling loop)
- `POST /api/clio/chat/completions` (our custom LLM)

If `/walkthrough/${userId}` is never loaded, WalkthroughClient never mounts, ElevenLabs never connects, and our custom LLM is never called. This means **the bot is in the Google Meet call but is NOT loading the walkthrough page.**

### Why is the walkthrough page not loading?

**Candidate A — `dynamicVariables` rejects the WebSocket (most likely for current sessions)**

The ElevenLabs SDK's `dynamicVariables` is a feature for substituting `{{variable}}` placeholders in the agent's system prompt template. The Clio agent's system prompt in ElevenLabs dashboard still contains the old coaching script content — it does NOT have a `{{user_id}}` placeholder.

When `dynamicVariables: { user_id: userId }` is passed to `startSession()` and there is no matching `{{user_id}}` template variable in the agent's configured prompt, ElevenLabs may reject the WebSocket handshake. This would explain:
- WebSocket connects briefly then drops
- No logs from any of our endpoints (connection rejected before any turn happens)
- The pattern persisting even after the custom LLM was published

**Candidate B — walkthroughUrl points to wrong domain (pre-existing issue)**

In `recall/bot/route.ts`:
```typescript
const walkthroughUrl = `${process.env.NEXT_PUBLIC_APP_URL}/walkthrough/${userId}`
```

If `NEXT_PUBLIC_APP_URL` is set to `https://distill-peach.vercel.app` in Vercel's environment variables, and `distill-peach.vercel.app` doesn't resolve to this deployment, the Recall.ai bot loads a 404 page. The bot would be in the call but showing nothing. This would also explain zero walkthrough-related logs.

**However:** This would have been broken from the very beginning, before the content pipeline. Since the user confirmed "it was working earlier," this is likely correct OR the domain was recently changed.

**Candidate C — Headless browser getUserMedia failure (pre-existing, intermittent)**

WalkthroughClient calls `await navigator.mediaDevices.getUserMedia({ audio: true })` before calling `startSession()`. If Recall.ai's headless Chromium doesn't grant mic access, this throws, the catch block retries, and we loop forever without ever reaching `startSession()`. This would explain:
- `connecting` status briefly
- Immediate disconnect
- Retries that never succeed
- Zero ElevenLabs calls

This was reportedly working before, but it's possible a headless browser environment change broke it.

---

## 4. The Core Architectural Truth

The custom LLM approach (`/api/clio/chat/completions`) is **architecturally correct**:
- Bypasses the 12k prompt limit entirely
- Full 41k context available per turn
- Already passes the curl test and ElevenLabs connection test
- Claude Sonnet 4.6 handles the context perfectly

The problem is **not the custom LLM itself** — the problem is the WebSocket connection from WalkthroughClient to ElevenLabs never completes in a real session, so our LLM is never reached.

---

## 5. Evidence Summary

| Signal | Value |
|--------|-------|
| `/api/clio/chat/completions` curl test | ✅ Works |
| ElevenLabs dashboard "Test connection" | ✅ Connection successful |
| ElevenLabs agent published | ✅ Confirmed (publish button disabled after) |
| Bot joins Google Meet | ✅ `bot.in_call_not_recording` logged |
| Transcript processing starts | ✅ `transcript.processing` logged |
| `/walkthrough/${userId}` GET in Vercel logs | ❌ Never seen |
| `/api/walkthrough-state/${userId}` polling in logs | ❌ Never seen |
| `/api/clio/chat/completions` calls in logs | ❌ Never seen |
| ElevenLabs WebSocket result in session | ❌ Disconnects immediately, retries |

---

## 6. Proposed Solution (no code changes made — for tomorrow)

### Step 1: Remove `dynamicVariables` from `startSession()` [HIGHEST PRIORITY]

This is the most likely cause of the current regression. Remove the line:
```typescript
dynamicVariables: { user_id: userId },
```
The userId is already in the prompt override as `DISTILL_USER_ID: ${userId}` — the custom LLM endpoint parses it from there. `dynamicVariables` is redundant AND potentially causing ElevenLabs to reject the WebSocket.

### Step 2: Verify `NEXT_PUBLIC_APP_URL` in Vercel

Check what `NEXT_PUBLIC_APP_URL` is set to in Vercel's environment variables (Settings → Environment Variables). It must resolve to the actual deployment:
- If using `distill-peach.vercel.app` → set to `https://distill-peach.vercel.app`
- If `distill-peach.vercel.app` is live and pointing to Vercel → keep as is

### Step 3: Add logging before `getUserMedia` in WalkthroughClient

Wrap the `getUserMedia` call in explicit logging so we can see in Vercel logs whether the headless browser is even reaching that point:
```typescript
console.log('[Walkthrough] Requesting mic permission...')
await navigator.mediaDevices.getUserMedia({ audio: true })
console.log('[Walkthrough] Mic granted — calling startSession')
```

This will confirm whether the page loads and reaches `startSession()`, or crashes before.

### Step 4: Add logging to walkthrough page server render

Add a `console.log` at the top of the `/walkthrough/[userId]/page.tsx` server component:
```typescript
console.log('[walkthrough/page] Rendering for userId:', userId)
```

This will appear in Vercel logs when the bot loads the page, confirming whether the walkthroughUrl is correct.

### Step 5: Remove `MAX_PROMPT_CHARS` dead code

The constant `MAX_PROMPT_CHARS = 12_000` is defined in WalkthroughClient but never used — the truncation logic was replaced by the custom LLM approach. Dead code can cause confusion.

---

## 7. Order of Investigation Tomorrow

1. Check Vercel env var `NEXT_PUBLIC_APP_URL` — confirm the domain resolves correctly  
2. Deploy with `dynamicVariables` removed + server-side logging added  
3. Start a session and watch Vercel logs — do we see the walkthrough page load?  
4. If yes → is `startSession()` reached? (via mic permission logs)  
5. If yes → is `/api/clio/chat/completions` called? (it should be after this fix)  
6. If no walkthrough page load → NEXT_PUBLIC_APP_URL is wrong — fix the domain  

---

## 8. Files Involved

| File | Role | Status |
|------|------|--------|
| `app/dashboard/walkthrough/WalkthroughClient.tsx` | Runs in Recall.ai headless browser. Connects to ElevenLabs. | Has `dynamicVariables` — suspected culprit |
| `app/api/clio/chat/completions/route.ts` | Custom LLM endpoint. Fetches context from DB, calls Claude. | Working (curl-tested), never reached in real sessions |
| `app/api/recall/bot/route.ts` | Creates Recall.ai bot, writes context to walkthrough_state first | Working, but uses `NEXT_PUBLIC_APP_URL` for walkthroughUrl |
| `app/walkthrough/[userId]/page.tsx` | Server-rendered page loaded by Recall.ai bot | No logging — can't confirm if it's loading |
| `middleware.ts` | Must have `/walkthrough/(.*)` and `/api/clio/chat/completions` as public | Both are public ✅ |

---

*Written: 2026-05-24. Good night.*
