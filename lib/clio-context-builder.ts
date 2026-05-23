/**
 * Builds Clio's complete session coaching brief — sent to ElevenLabs on connect.
 *
 * Covers everything Clio needs to run a fully scripted session:
 *   - Session topic and ordered agenda
 *   - TEACH / CHECKPOINT / PROBE / CONTINUE scripts per section
 *   - Key concepts and misconceptions for off-script Q&A
 *   - Screen awareness and loading bridge language
 *   - Strict behavioural rules
 */

// ─── MINIMAL TYPES ────────────────────────────────────────────────────────────
// Defined inline to avoid importing server-only modules (Anthropic SDK etc.)

interface TrainingSegment {
  type: 'TEACH' | 'CHECKPOINT' | 'PROBE' | 'CONTINUE'
  content: string
}

interface TrainingScript {
  subtopic_title: string
  subtopic_slug: string
  segments: TrainingSegment[]
}

interface ContentOutline {
  subtopic_title: string
  content_summary?: string
  key_concepts?: string[]
  common_misconceptions?: string[]
  executive_relevance?: string
}

interface SectionMeta {
  subtopicTitle: string
  sessionTitle?: string
}

interface Section {
  id: string
  meta: SectionMeta
}

// ─── BUILDER ──────────────────────────────────────────────────────────────────

interface BuildContextInput {
  sessionTitle: string
  sessionIndex?: number | null
  topicId: string
  sections: Section[]
  trainingScripts: (TrainingScript | null)[]
  contentOutlines: (ContentOutline | null)[]
  skippedTopics?: string[]
}

export function buildClioSessionContext(input: BuildContextInput): string {
  const {
    sessionTitle,
    sessionIndex,
    sections,
    trainingScripts,
    contentOutlines,
    skippedTopics = [],
  } = input

  const totalSections = sections.length
  const sessionLabel = sessionIndex != null ? `Session ${sessionIndex}` : 'Session'

  // ── 1. Header ──────────────────────────────────────────────────────────────
  const header = [
    `=== CLIO COACHING BRIEF ===`,
    ``,
    `${sessionLabel}: ${sessionTitle}`,
    `Total sections: ${totalSections}`,
  ].join('\n')

  // ── 2. Agenda ──────────────────────────────────────────────────────────────
  const agendaLines = sections.map((s, i) => {
    const skipped = skippedTopics.includes(s.meta.subtopicTitle)
    return `${i + 1}. ${s.meta.subtopicTitle}${skipped ? ' [SKIPPED — say "We\'re skipping this one" and move on]' : ''}`
  })
  const agenda = [
    `TODAY'S AGENDA — cover in this exact order:`,
    ...agendaLines,
  ].join('\n')

  // ── 3. Section scripts ─────────────────────────────────────────────────────
  const scriptBlocks = sections.map((section, i) => {
    const script = trainingScripts[i] ?? null
    const outline = contentOutlines[i] ?? null
    const title = section.meta.subtopicTitle

    const lines: string[] = [
      `--- [${i + 1}/${totalSections}] "${title}" ---`,
    ]

    if (outline?.content_summary) {
      lines.push(`SUMMARY: ${outline.content_summary}`)
    }
    if (outline?.key_concepts?.length) {
      lines.push(`KEY CONCEPTS: ${outline.key_concepts.join(', ')}`)
    }
    if (outline?.executive_relevance) {
      lines.push(`WHY IT MATTERS: ${outline.executive_relevance}`)
    }

    if (script) {
      const get = (type: TrainingSegment['type']) =>
        script.segments.find((s) => s.type === type)?.content ?? ''

      lines.push(``, `TEACH — deliver this when you show this section:`)
      lines.push(get('TEACH') || '(no script — explain the key concepts in plain language)')

      lines.push(``, `CHECKPOINT — ask after TEACH:`)
      lines.push(get('CHECKPOINT') || 'How does that land for you so far?')

      lines.push(``, `PROBE — use if they seem uncertain:`)
      lines.push(get('PROBE') || 'Let me try a different angle.')

      lines.push(``, `CONTINUE — say this to bridge before the next section:`)
      lines.push(get('CONTINUE') || "Good. Let's keep moving.")
    } else {
      lines.push(``, `(No pre-written script — coach this section from the key concepts above)`)
    }

    if (outline?.common_misconceptions?.length) {
      lines.push(``, `COMMON MISCONCEPTIONS TO CORRECT:`)
      outline.common_misconceptions.forEach((m) => lines.push(`- ${m}`))
    }

    return lines.join('\n')
  })

  const scripts = [
    `=== SECTION SCRIPTS ===`,
    `Deliver each TEACH script when you call show_visual for that section.`,
    `Speak naturally — these are your words, not a teleprompter.`,
    ``,
    ...scriptBlocks,
  ].join('\n')

  // ── 4. Screen awareness + loading bridge ───────────────────────────────────
  const screenAwareness = [
    `=== SCREEN CONTROL ===`,
    `You control the participant's visual display via show_visual.`,
    ``,
    `When you call show_visual:`,
    `- The visual loads in 1–2 seconds. While it loads, say something like:`,
    `  "Let me bring that up on screen — [one sentence teaser of the topic]. There we go."`,
    `  Then immediately deliver the TEACH script for that section.`,
    `- If the screen appears instantly: skip the loading bridge and go straight to TEACH.`,
    ``,
    `Call show_visual at the VERY START of each section — before you begin explaining.`,
    `This keeps what you say and what they see in perfect sync.`,
  ].join('\n')

  // ── 5. Behavioural rules ───────────────────────────────────────────────────
  const rules = [
    `=== RULES ===`,
    `1. NEVER ask what to cover — the agenda above is fixed.`,
    `2. NEVER ask about their background — it is already known.`,
    `3. Always call show_visual before explaining a new section.`,
    `4. After TEACH, always ask the CHECKPOINT question.`,
    `5. Use PROBE only when they express confusion or ask for clarification.`,
    `6. Use CONTINUE to bridge naturally before calling show_visual for the next section.`,
    `7. For quick off-script questions: answer in 1–2 sentences from the section's key concepts, then return to script.`,
    `8. For complex or off-topic questions: call defer_question and say "Great question — I've saved that for a dedicated session."`,
    `9. Skipped topics: say "We're skipping [topic] today" and advance immediately.`,
    `10. When the session is done, summarise what was covered and call end_session.`,
  ].join('\n')

  return [header, ``, agenda, ``, scripts, ``, screenAwareness, ``, rules].join('\n')
}
