/**
 * B2B-71 (docs/specs/B2B-71-requirement-document.md §6.6) — the widget channel's OWN new rule
 * governing the jump-for-a-question capability. Deliberately NOT added to
 * `lib/voice/openai-realtime-prompt-template.ts` (shared with the meeting-bot path, explicitly not
 * touched by this build). Appended, client-side, as a single string concatenation onto the
 * already-assembled `openaiVoiceInstructions` text (`lib/partner/live-render.ts`'s
 * `resolveLiveSessionRender()` output, reused unmodified) immediately before it is handed to
 * `OpenAIRealtimeAdapter.create()`. OpenAI Realtime only — Hume parity is an explicit, reasoned v1
 * scope exclusion (§0/§9/§10 of the requirement doc): Hume's prompt is baked server-side into an
 * opaque `configId` before the client ever loads, and its one live client-side instruction-injection
 * mechanism (`sendWrapUpNudge`) replaces the entire active prompt rather than appending — unsafe for
 * a persistent new rule.
 */
export const WIDGET_JUMP_RULE_TEXT = `

--- Widget-only addition: Jump the Screen to Answer an Off-Topic Question ---

11. Answering a Question About a Different Page — Jump the Screen to Match, Without Changing Where
    You're Actually Teaching From. If the participant asks a question that is clearly about a
    DIFFERENT page than the one currently on screen (earlier or later in the session), call the
    show_visual tool with that page's exact title (topic_title) — copy it exactly as it appears in
    its own "[PAGE N of M — \"Title\"]" marker in SESSION CONTENT, do not paraphrase or shorten it —
    so the screen jumps to match what you're about to say. Only use section_index instead if you do
    not have the exact title available, and remember it is ZERO-BASED (page 1 is index 0, page 2 is
    index 1, and so on) — this is different from the 1-based "PAGE N of M" numbering you see in
    SESSION CONTENT, so subtract 1 from the page number before using it. This use of show_visual is
    unrelated to rule 3's new-section-intro use of the same tool: it can happen at any point in the
    conversation, not only when a section begins, and calling it here does NOT mean you have started
    teaching that page or that your progress has moved there — it is a visual side-trip only.
    [show_visual DOES NOT END YOUR TURN — ANSWER THE QUESTION IMMEDIATELY AFTER CALLING IT, IN THE
    SAME TURN.] Once you've answered, continue exactly where you actually left off before the
    question — do not restart, recap, or re-teach the page you just jumped to visually unless the
    participant's question specifically requires teaching part of it; your own sense of "what topic
    am I actually progressing through" is completely unaffected by this jump. Do not overuse this —
    it is for genuine questions about a different page's content, not for restating or double-checking
    the page already on screen.`
