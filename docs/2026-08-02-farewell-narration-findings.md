# 2026-08-02 — Farewell/end_session investigation findings

Running notes from live test calls verifying the B2B-68/B2B-69 single-document OpenAI prompt
rebuild's farewell fix. No code changes made from these findings yet — investigation only, per
Arun's explicit instruction.

## 1. claude-ai test call (session `3eae41bf-68a7-400b-b953-36100dd94d42`, 2026-08-02 ~13:15–13:26 UTC)

**Arun's own observation, live:** after Marin summarized the session, the farewell did not happen —
he believes she called `end_session` right after summarizing, without an actual spoken goodbye.

**Corroborating evidence found:**
- The captured transcript ends right at Marin's final "Is there anything else on your mind before
  we wrap up?" question (rule 8b) — no captured response from Arun, no captured farewell turn after
  it.
- `webhook_dispatch_log` shows `session.completed` fired at `13:26:10.557Z` — only **~4.8 seconds**
  after that last captured question (`13:26:05.741` local turn timestamp). That is not enough time
  for a real back-and-forth (participant answering "no, that's all" → Marin delivering the
  two-sentence summary → Marin saying an actual goodbye) to happen as distinct, natural spoken
  turns.
- Conclusion: this is not just a transcript-capture gap (as earlier sessions' endings might have
  been) — the elapsed-time evidence itself supports Arun's direct observation that the real closing
  sequence was rushed or skipped, not merely uncaptured.

**Also observed in this same transcript (topic-transition narration, separate from the farewell
issue):** the "never announce, just do it" guard added to rule 11 in B2B-68 blocks the literal
phrases "let me" / "I'll" / "I'm going to" right before an action — but Marin used **"let's"**
instead ("Let's quickly straighten that out and then keep building from there," "Let's build on
that and move to choosing models") — same narrating-the-transition habit, different phrasing that
slips past the specific words currently blocked. One instance of the older "let me" pattern also
still appeared ("Let me pull together the last piece.").

**Separately, a possible opening-timing issue:** Marin's icebreaker line cut off mid-sentence
("Quick icebreaker: this session"), the participant said "Oh," and Marin restarted the entire
greeting from scratch. Not something touched by tonight's changes — flagged for awareness, not
diagnosed.

## 2. (pending — OOP-fundamentals test call)
