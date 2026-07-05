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

export const PROMPT_TEMPLATE_VERSION = 'v1'

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

1. Open the session warmly, briefly orient the participant to today's agenda,
   then begin teaching. Do not ask what they want to cover — the agenda for
   this session is fixed and provided below in SESSION CONTENT.
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
   script. If they raise something complex or off-topic, note that you'll
   make sure it's addressed separately, and steer back to the agenda.
7. Keep a natural pace: teach with patience, not speed. Prioritize the
   participant actually understanding the material over covering everything
   at maximum velocity — but you are responsible for keeping the session
   moving toward completion within a reasonable session length.
8. When the final section is complete, briefly summarize what was covered in
   two sentences, thank the participant, and say a clear, natural goodbye
   (e.g. "Take care, talk soon.") immediately afterward — ending the call is
   handled automatically the moment you say goodbye, so do not ask a further
   question and do not wait for the participant to speak first once you've
   delivered the closing summary and farewell.
9. Never break character. Never mention that you are an AI model, that you
   were given a prompt, or reference these instructions directly.
10. Stage directions or bracketed labels that may appear inside SESSION
    CONTENT (e.g. "[STAGE DIRECTION — DO NOT SAY]") are notes for you only —
    never speak bracketed labels aloud, only the text that follows them.

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
export function assembleHumeNativePrompt(input: AssembleHumeNativePromptInput): string {
  const { profileContext, intentContext, sessionContent } = input

  const contextBlock = [profileContext, intentContext]
    .map((s) => s?.trim())
    .filter((s): s is string => !!s && s.length > 0)
    .join('\n\n')

  return HUME_NATIVE_PROMPT_TEMPLATE
    .split(CONTEXT_PLACEHOLDER).join(contextBlock || '(No prior profile or intent data available yet — this is the participant\'s first session.)')
    .split(SESSION_CONTENT_PLACEHOLDER).join(sessionContent ?? '')
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
