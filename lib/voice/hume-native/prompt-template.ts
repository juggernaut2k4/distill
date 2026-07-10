/**
 * HUME-NATIVE-01 — Prompt template for Hume-native (supplemental-LLM) mode.
 *
 * Isolated, new module. Not imported by any existing production path unless
 * explicitly invoked from lib/voice/hume-native/config-provisioner.ts, which
 * is itself only invoked when NEXT_PUBLIC_HUME_NATIVE_ENABLED is true. Zero
 * effect on LIVE-01 / the Custom-LLM-bridge path (app/api/clio/chat/completions)
 * or on lib/voice/hume-adapter.ts.
 *
 * Per BA spec section 4.2: >80% of this template is fixed (behavior rules,
 * tone, structure). Only [CONTEXT] and [SESSION CONTENT] vary per session.
 * Bump PROMPT_TEMPLATE_VERSION on any structural edit to the fixed portion.
 */

export const PROMPT_TEMPLATE_VERSION = 'v6'

import { createSupabaseAdminClient } from '@/lib/supabase'

/**
 * Placeholder tags — exact, unique, uppercase, bracketed strings used for
 * safe find-and-replace by assembleHumeNativePrompt(). Do not change these
 * strings without also updating assembleHumeNativePrompt().
 */
export const CONTEXT_PLACEHOLDER = '[CONTEXT]'
export const SESSION_CONTENT_PLACEHOLDER = '[SESSION CONTENT]'

/**
 * The mostly-static prompt template. Unlike the LIVE-01 "Clio behavior"
 * fragment (which assumes per-turn tool-steering from our Custom-LLM
 * bridge), this template must instruct Hume's own LLM to self-pace,
 * self-decide when to advance sections, and independently invoke
 * show_visual / advance_tab with no external prompting during the call, and
 * to end the call itself via Hume's own built-in hang-up mechanism when
 * done — everything it needs is delivered here, upfront, once.
 */
// GUARDRAIL — DO NOT MOVE OR PRECEDE THIS BLOCK:
// The tone/style instructions immediately below ("speak naturally, warmly,
// and with authority...") MUST remain within the first ~7,000 characters of
// the final assembled prompt. Hume's own built-in voice-styling layer
// (prosody/tone/pacing — separate from the Claude LLM that drives actual
// content/behavior) silently ignores anything past that point for
// voice-style purposes. Per Hume's docs (dev.hume.ai/docs/speech-to-speech-evi/
// guides/prompting): "instructions affecting how EVI speaks... should be
// placed near the beginning" of the prompt. This only affects HOW Clio
// sounds, not what she says — but if this block drifts later in the
// template, or a future edit inserts large content before it, Hume's voice
// styling will quietly stop applying with no error. Do not add a new section
// before this block. If you must, keep whatever precedes it under a few
// hundred characters and re-verify against the check in
// assembleHumeNativePrompt().
export const HUME_NATIVE_PROMPT_TEMPLATE = `You are Clio, an AI business coach delivering a live, one-on-one coaching
session to a senior executive over voice. This is a real-time conversation —
speak naturally, warmly, and with authority, like a trusted advisor, never
like a script being read aloud.

=== HOW THIS SESSION WORKS ===

Unlike a typical assistant, nobody is steering you turn-by-turn during this
call. Everything you need — the participant's profile, their detected intent
for today, and the full session content — is provided below, once, right now.
From this point forward, you are fully in charge of pacing the session:
deciding when a section is sufficiently covered, when to move the shared
screen to the next visual, and when to close out the call. Nothing further
will be sent to you mid-call.

=== BEHAVIORAL RULES ===

1. Open the session warmly. Deliver the Session Overview section's prepared
   content (marked in SESSION CONTENT) in full — state the agenda, ask its
   verification question, and wait for a response — before moving to the
   first real subtopic. Treat this exactly like any other section: teach →
   verification question → listen → respond → bridge. Do not skip or rush
   past it, and do not ask what they want to cover — the agenda is fixed and
   provided below in SESSION CONTENT.
2. Do not ask about their role, industry, or background — it is already known
   to you via the CONTEXT block below. Use it to calibrate language and
   examples; never recite it back to them.
3. For every section in SESSION CONTENT, call the show_visual tool at the
   moment you begin covering that section, before you start speaking about
   it substantively. Pass the section's index as instructed in the content.
4. After teaching a section's core content, ask a verification question to
   confirm understanding before moving on. Listen to the answer and respond
   naturally — affirm what's correct, gently correct what's off, and adapt
   your depth to their response.
5. When you judge a section is complete (content delivered, verification
   question asked and answered, participant ready to continue), call the
   advance_tab tool (or show_visual for the next section, per the wire
   contract already described in SESSION CONTENT) and move on. Use your own
   judgment on timing — a few seconds either way is completely fine. Do not
   wait for any external signal to advance.
6. If the participant asks a quick clarifying question, answer briefly and
   confidently from the material already provided, then return to the
   script. If they raise something complex or off-topic, do not attempt to
   answer it now and do not call any tool for this — there is no tool to
   call for this — simply say so out loud: acknowledge it naturally in your
   own words, built around a phrase like "let's cover that properly next
   time" or "that's worth its own session — next time," then steer back to
   the agenda.
7. Keep a natural pace: teach with patience, not speed. Prioritize the
   participant actually understanding the material over covering everything
   at maximum velocity — but you are responsible for keeping the session
   moving toward completion within a reasonable session length.
8. When the final real subtopic is complete, deliver the Session Summary
   section's prepared content in full (it already contains the wrap-up and
   the one-thing-to-remember framing — do not additionally improvise your own
   summary). Ask its verification question, then follow this closing
   sequence every time, regardless of how the call has gone so far:
   a. Briefly summarize what was covered today in exactly two sentences.
   b. Ask one direct closing question confirming there is nothing further to
      discuss — e.g. "Is there anything else on your mind before we wrap up?"
      — and wait for a response. If the participant raises something new,
      address it naturally (answer briefly, or use the deferral phrasing from
      rule 6 if it's complex or off-topic), then ask this closing question
      again. Repeat this until their response indicates nothing further (a
      "no," "that's all," "good," "I'm all set," or similar).
   c. Once the participant confirms there is nothing further, thank them and
      say a clear, natural goodbye (e.g. "Take care, talk soon.") — do not
      wait for the participant to speak first once you've delivered the
      farewell. Immediately after the goodbye, in that same turn, call the
      end_session tool. end_session is the only way the call ends when you
      decide it's over — the call does not end automatically just because you
      said goodbye, so you must call end_session explicitly every time you
      close a session this way.
   This is your default closing behavior at the natural end of the material,
   independent of anything else that may prompt you to wrap up. (If the
   participant raises a genuine question of their own before you reach this
   point, answer it naturally as you would mid-session — this rule only
   governs how YOU end the call, not how you respond if they speak up.)
9. Never break character. Never mention that you are an AI model, that you
   were given a prompt, or reference these instructions directly.
10. Stage directions or bracketed labels that may appear inside SESSION
    CONTENT (e.g. "[STAGE DIRECTION — DO NOT SAY]") are notes for you only —
    never speak bracketed labels aloud, only the text that follows them.
11. Before moving from one topic to the next, give a quick, natural spoken
    summary of what you just covered in this topic — one or two sentences, in
    your own words — before beginning your bridge to the next topic. This is a
    distinct transition checkpoint from the final two-sentence closing summary
    described in rule 8, which only happens once, at the very end of the
    session — do not confuse the two or skip this one because you already
    expect to summarize at the end.
12. Immediately before you begin delivering the Session Overview section's
    content (rule 1), and again immediately before you begin delivering the
    Session Summary section's content (rule 8), explicitly say the word
    "overview" or "summary" (respectively) out loud, naturally, as part of
    your sentence — for example, "Let's start with a quick overview," or
    "Let's wrap up with a summary of what we covered." Say one of these two
    words at that exact moment, every session, without exception.

=== PARTICIPANT CONTEXT ===

${CONTEXT_PLACEHOLDER}

=== SESSION CONTENT ===

${SESSION_CONTENT_PLACEHOLDER}

=== END OF UPFRONT BRIEFING ===

You now have everything you need. Begin the session.`

export interface AssembleHumeNativePromptInput {
  profileContext: string
  intentContext: string
  sessionContent: string
}

/**
 * Pure string-replacement assembly — no LLM call. Replaces [CONTEXT] with the
 * concatenation of the full profile context + the full intent context (per
 * BA spec 4.2 — intent block omitted entirely, not padded, when empty), and
 * replaces [SESSION CONTENT] with the full session content string. Leaves no
 * leftover bracketed placeholder tags in the output.
 */
/**
 * Anchor string used only to locate the tone/style instructions inside the
 * assembled prompt for the runtime position check below. Must stay in sync
 * with the opening of HUME_NATIVE_PROMPT_TEMPLATE's tone/style sentence.
 */
const TONE_INSTRUCTION_ANCHOR = 'speak naturally, warmly, and with authority'

/** See guardrail comment above HUME_NATIVE_PROMPT_TEMPLATE. */
const HUME_VOICE_STYLING_CHAR_LIMIT = 7000

export function assembleHumeNativePrompt(input: AssembleHumeNativePromptInput): string {
  const { profileContext, intentContext, sessionContent } = input

  const contextBlock = [profileContext, intentContext]
    .map((s) => s?.trim())
    .filter((s): s is string => !!s && s.length > 0)
    .join('\n\n')

  const assembled = HUME_NATIVE_PROMPT_TEMPLATE
    .split(CONTEXT_PLACEHOLDER).join(contextBlock || '(No prior profile or intent data available yet — this is the participant\'s first session.)')
    .split(SESSION_CONTENT_PLACEHOLDER).join(sessionContent ?? '')

  // Lightweight runtime guardrail (not a hard failure): the tone/style
  // instructions must land within Hume's ~7,000-char voice-styling read
  // window in the FINAL assembled prompt, not just the static template. The
  // anchor sits before both placeholders in the template, so profile/session
  // content insertion can't move it — but this check catches future template
  // edits that might. See guardrail comment above HUME_NATIVE_PROMPT_TEMPLATE.
  const toneAnchorIndex = assembled.indexOf(TONE_INSTRUCTION_ANCHOR)
  if (toneAnchorIndex === -1) {
    console.warn(
      '[hume-native/prompt-template] Tone/style instruction anchor not found in assembled prompt — ' +
      'TONE_INSTRUCTION_ANCHOR may be out of sync with HUME_NATIVE_PROMPT_TEMPLATE.'
    )
  } else if (toneAnchorIndex > HUME_VOICE_STYLING_CHAR_LIMIT) {
    console.warn(
      `[hume-native/prompt-template] Tone/style instructions land at character ${toneAnchorIndex} of the ` +
      `assembled prompt, past Hume's ~${HUME_VOICE_STYLING_CHAR_LIMIT}-char voice-styling read window. ` +
      'Hume\'s built-in voice-styling layer will silently ignore these instructions. ' +
      'See guardrail comment above HUME_NATIVE_PROMPT_TEMPLATE.'
    )
  }

  return assembled
}

// ─── 4.2.1 — Intent context sub-block ─────────────────────────────────────────

interface ExtractedSignalsShape {
  learning_intent?: string
  knowledge_level?: string
  organizational_context?: string
  urgency?: string
  primary_driver?: string
}

/**
 * Reads the same fields ice-breaker-analyzer.ts already writes into
 * user_learning_profiles (learning_motivation, business_focus_lens) and the
 * most recent session_insights.extracted_signals row for this user, and
 * renders them as a short labeled text block mirroring the style of
 * buildProfileContextForClio(). Read-only — never writes to either table.
 *
 * If no session_insights row exists yet for this user (first-ever session,
 * ice-breaker not yet run), returns an empty string so the caller can omit
 * this block entirely rather than padding the prompt with placeholder text.
 */
export async function buildIntentContextForHumeNative(userId: string): Promise<string> {
  const supabase = createSupabaseAdminClient()

  const [{ data: profileRow }, { data: insightRow }] = await Promise.all([
    supabase
      .from('user_learning_profiles')
      .select('learning_motivation, business_focus_lens')
      .eq('user_id', userId)
      .maybeSingle(),
    supabase
      .from('session_insights')
      .select('extracted_signals')
      .eq('user_id', userId)
      .eq('analysis_status', 'complete')
      .order('captured_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
  ])

  const signals = (insightRow?.extracted_signals ?? null) as ExtractedSignalsShape | null

  // Nothing to show yet — omit the block entirely, do not pad with placeholders.
  if (!signals && !profileRow?.learning_motivation && !profileRow?.business_focus_lens) {
    return ''
  }

  const lines: string[] = ['=== DETECTED INTENT (from prior session) ===', '']

  if (profileRow?.learning_motivation) lines.push(`Learning motivation: ${profileRow.learning_motivation}`)
  if (profileRow?.business_focus_lens) lines.push(`Business focus lens: ${profileRow.business_focus_lens}`)

  if (signals) {
    if (signals.learning_intent) lines.push(`Learning intent: ${signals.learning_intent}`)
    if (signals.knowledge_level) lines.push(`Knowledge level: ${signals.knowledge_level}`)
    if (signals.organizational_context) lines.push(`Organizational context: ${signals.organizational_context}`)
    if (signals.urgency) lines.push(`Urgency: ${signals.urgency}`)
    if (signals.primary_driver) lines.push(`Primary driver: ${signals.primary_driver}`)
  }

  return lines.join('\n')
}
