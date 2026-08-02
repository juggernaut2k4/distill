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

## 2. OOP-fundamentals test call (session `eb613ede-aa59-48e7-9db8-9a5986d66aca`, 2026-08-02 ~13:29–13:39 UTC)

**Farewell/end_session — same bug, and the timing evidence is even more damning here:**
- The transcript's actual final AI line is: *"That's a solid summary. Let me close this out and make sure
  there's nothing else you want to cover."* — captured at `13:38:41.088Z`.
- That line is not a real spoken farewell, and it is not even a direct question — it's Marin narrating
  her own next move ("let me close this out") instead of just asking "is there anything else?" outright.
  No captured user response follows it, no captured goodbye follows it. The transcript simply ends there.
- `webhook_dispatch_log` shows `session.completed` fired at `13:38:42.263Z` — only **~1.2 seconds** after
  that line. That is not enough time for the participant to even answer the implied question, let alone
  for a real close (participant answers → Marin delivers a goodbye → end_session). 1.2 seconds is
  consistent with `end_session` being called immediately after that narrated line, with no farewell
  actually spoken.
- This is a stronger version of the same finding from item 1 (there it was ~4.8s with a real question
  asked; here it's ~1.2s and the "question" itself was narrated rather than asked directly).

**Meta-narration — confirmed still broken, including the literal blocked phrase "let me":**
Every one of the 6 topic transitions in this call follows the same rigid template — an affirmation,
then a narrated transition, then the verbatim line **"That covers what I wanted to walk through here."**
before the next topic's content. The narrated transitions:
- "Let's build from that and move into the next core idea."
- "Let's keep going and connect it to how we protect that state."
- "let's build on that and talk about what we choose to show versus what we hide"
- "Let's take that forward into the next concept."
- **"Let me bring that forward into the next idea."** — this is the literal "let me" phrasing rule 8c/11
  is supposed to block, appearing plainly mid-session, not just at the farewell.
- "Let's tie everything together with the bigger picture."
- And the closing line itself: **"Let me close this out..."**

So both evasions are present: "let's" (the rephrasing that slipped past the specific-word block in item 1)
and the originally-blocked "let me" itself (meaning the block isn't reliably firing at all, not just being
routed around). The identical verbatim scripted-sounding line before every section ("That covers what I
wanted to walk through here") also corroborates Arun's original observation #3 — "it sounded as if it was
reading the script."

**New issue, not previously documented — mid-session silence gaps:** the participant had to prompt Marin
back to life three separate times mid-call:
- "OK, I think you are in inheritance, but you're not speaking. What happened?"
- "Cleo, are you there?"
- "See you. You went silent again. Can you continue?"

Each followed a topic-transition line, suggesting a multi-second dead-air gap between the transition
narration and the next section's content (possibly a tool-call/latency gap with no filler speech to
bridge it). Not something tonight's changes touched — flagged as a distinct, separate issue for
awareness, not diagnosed.

