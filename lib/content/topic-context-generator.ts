/**
 * Generates a rich topic context document per subtopic — Clio's Q&A reference.
 *
 * This is NOT a script. It's a knowledge base Clio consults when answering
 * questions that go beyond the prepared TEACH content. Cached per subtopic in
 * topic_content_cache.topic_context_doc so it's generated once and reused.
 *
 * Format: plain-English explanation → why it matters → concept explanations
 *         with examples → anticipated Q&A → misconceptions to correct.
 */

import Anthropic from '@anthropic-ai/sdk'

const isPlaceholder =
  !process.env.ANTHROPIC_API_KEY ||
  process.env.ANTHROPIC_API_KEY.startsWith('PLACEHOLDER')

const anthropic = isPlaceholder
  ? null
  : new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

const MODEL = 'claude-sonnet-4-6'

interface ContentOutline {
  subtopic_title: string
  content_summary?: string
  key_concepts?: string[]
  common_misconceptions?: string[]
  executive_relevance?: string
  builds_on?: string[]
}

function buildMockContextDoc(outline: ContentOutline, topicTitle: string): string {
  const concepts = (outline.key_concepts ?? []).slice(0, 3)
  return [
    `## ${outline.subtopic_title}`,
    ``,
    `PLAIN ENGLISH EXPLANATION`,
    `In plain terms, ${outline.content_summary ?? `this section covers ${outline.subtopic_title} as part of ${topicTitle}.`}`,
    ``,
    `WHY IT MATTERS`,
    outline.executive_relevance ?? `This directly affects how you lead AI initiatives and evaluate vendor claims.`,
    ``,
    `KEY CONCEPTS EXPLAINED`,
    ...concepts.map(
      (c) =>
        `${c}: This is a foundational concept in ${outline.subtopic_title}. Think of it as the mechanism by which the underlying capability actually works. In practice, executives encounter this when evaluating proposals or briefing their board.`
    ),
    ``,
    `ANTICIPATED QUESTIONS AND ANSWERS`,
    `Q: How does this affect my organisation right now?`,
    `A: The most immediate impact is on how your team evaluates and adopts new tools. ${outline.content_summary?.split('.')[0] ?? 'Understanding this puts you in a stronger position to ask the right questions.'}`,
    ``,
    `Q: What should I be asking my technology team about this?`,
    `A: Ask them specifically which ${concepts[0] ?? 'aspect'} they're tracking, what their evaluation criteria are, and what a 6-month proof of concept would look like. These questions signal strategic awareness.`,
    ``,
    `Q: How do I explain this to my board?`,
    `A: Frame it around competitive risk and capability gap. The board doesn't need to understand the technology — they need to understand the cost of inaction.`,
    ``,
    `MISCONCEPTIONS TO CORRECT`,
    ...(outline.common_misconceptions ?? [`This is purely a technology decision`]).map(
      (m) => `Wrong: ${m}\nCorrect: This is a business strategy decision that technology enables, not drives.`
    ),
  ].join('\n')
}

/**
 * Generates a rich Q&A reference document for a single subtopic.
 * Returns the cached version if already generated.
 */
export async function generateTopicContextDoc(
  outline: ContentOutline,
  topicTitle: string,
  userContext: { role: string; industry: string }
): Promise<string> {
  if (!anthropic) {
    console.log('[MOCK] topic-context-generator: returning mock doc for', outline.subtopic_title)
    return buildMockContextDoc(outline, topicTitle)
  }

  const concepts = (outline.key_concepts ?? []).join(', ') || 'core concepts'
  const misconceptions = (outline.common_misconceptions ?? []).join('; ') || 'common vendor hype'

  const prompt = `You are building a reference document for an AI executive coach named Clio.
Clio uses this document during a live session to answer questions accurately and confidently.
This is NOT a script — it is a knowledge base. Write for the coach, not the participant.

SESSION TOPIC: ${topicTitle}
SUBTOPIC: ${outline.subtopic_title}
CONTENT SUMMARY: ${outline.content_summary ?? outline.subtopic_title}
KEY CONCEPTS TO EXPLAIN: ${concepts}
EXECUTIVE ROLE: ${userContext.role}
INDUSTRY: ${userContext.industry}
COMMON MISCONCEPTIONS: ${misconceptions}
${outline.builds_on?.length ? `BUILDS ON: ${outline.builds_on.join(', ')}` : ''}

Write the reference document in this exact format. Be specific, concise, and executive-grade.
Every answer must be under 60 words. No filler. No jargon without instant plain-English translation.

PLAIN ENGLISH EXPLANATION
[2-3 sentences any senior executive can understand. Start with "In plain terms,"]

WHY IT MATTERS
[2-3 sentences on why a ${userContext.role} in ${userContext.industry} should care right now. Be direct.]

KEY CONCEPTS EXPLAINED
[For each key concept, write: ConceptName: 2-3 sentence explanation + one concrete example from ${userContext.industry}]

ANTICIPATED QUESTIONS AND ANSWERS
[Write 4 Q&A pairs. These are the questions this executive is most likely to ask. Each answer max 50 words.]
Q: [question]
A: [answer]

MISCONCEPTIONS TO CORRECT
[For each misconception, write:]
Wrong: [the misconception]
Correct: [the correction in plain English]

Do not add any section not listed above. Do not use markdown headings (##, ###). Use the exact section labels shown.`

  const message = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 1200,
    messages: [{ role: 'user', content: prompt }],
  })

  const text = (message.content[0] as { type: string; text: string }).text.trim()
  return `## ${outline.subtopic_title}\n\n${text}`
}

/**
 * Generates context docs for all subtopics in parallel (batch of 3).
 * Skips subtopics that already have a cached doc.
 */
export async function generateAllTopicContextDocs(
  outlines: ContentOutline[],
  topicTitle: string,
  userContext: { role: string; industry: string },
  existingDocs: Map<string, string | null>
): Promise<Map<string, string>> {
  const results = new Map<string, string>()
  const BATCH = 3

  for (let i = 0; i < outlines.length; i += BATCH) {
    const batch = outlines.slice(i, i + BATCH)
    const docs = await Promise.all(
      batch.map(async (outline) => {
        const slug = outline.subtopic_title
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '-')
          .replace(/-+$/, '')
          .slice(0, 60)
        const cached = existingDocs.get(slug)
        if (cached) return { slug, doc: cached }
        const doc = await generateTopicContextDoc(outline, topicTitle, userContext)
        return { slug, doc }
      })
    )
    docs.forEach(({ slug, doc }) => results.set(slug, doc))
  }

  return results
}
