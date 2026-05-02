import Anthropic from '@anthropic-ai/sdk'
import type { ContentItem, UserProfile, ContentType } from './taxonomy'

const isPlaceholder =
  !process.env.ANTHROPIC_API_KEY ||
  process.env.ANTHROPIC_API_KEY.startsWith('PLACEHOLDER_')

const anthropic = isPlaceholder ? null : new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
})

const MODEL = 'claude-sonnet-4-6'
const MAX_WORDS = 80
const MAX_SMS_CHARS = 160

export interface PersonalizedContent {
  emailBody: string
  smsBody: string
  wordCount: number
}

const SYSTEM_PROMPT = `You are a concise AI advisor for senior business executives. Write like a trusted peer, not a teacher. No jargon. No fluff. Every sentence must be immediately actionable or illuminating. Maximum ${MAX_WORDS} words. Always end with one "So what?" sentence specific to their role.`

/** Mock content pool for development without an API key */
const MOCK_CONTENT: Record<ContentType, string[]> = {
  tip: [
    `Before your next AI vendor meeting, ask: "Show me a before-and-after metric from a real deployment." If they can't, they're selling potential, not performance. So what? As a leader, you should demand proof of value, not proof of concept.`,
    `When evaluating AI projects, require a clear baseline metric before approving any budget. Without a starting point, you can't measure ROI. So what? You'll make better investment decisions when you insist on measurable outcomes upfront.`,
  ],
  signal: [
    `Goldman Sachs deployed AI across their trading operations and cut manual review time by 60%. The pattern: start narrow, measure obsessively, scale only what works. So what? Your competitors are learning to move faster — understanding their playbook helps you set the right pace.`,
    `Microsoft reported that executives using Copilot spent 30% less time on email synthesis. The productivity gap between AI-augmented and non-augmented leaders is widening. So what? The question isn't if AI will change your role — it's whether you'll shape that change or react to it.`,
  ],
  decoder: [
    `What is a Foundation Model? Think of it as a powerful engine. You don't build it — companies like Anthropic or OpenAI do. You license access and build applications on top. So what? When someone pitches you an "AI solution," ask what foundation model they're using — it tells you half the story.`,
    `What is RAG (Retrieval Augmented Generation)? It means connecting AI to your company's own data, so it answers with your knowledge, not just internet knowledge. So what? Any AI tool that works with your internal docs, policies, or client data is likely using RAG.`,
  ],
  lens: [
    `A Fortune 500 CFO faced an AI audit tool pitch. Instead of approving the $2M budget, she ran a 30-day pilot on one process. Result: 40% accuracy improvement, clear ROI. Pilot greenlit. So what? Pilots beat proposals — a 30-day test costs less than a wrong $2M bet.`,
    `A retail CEO resisted AI personalization for 18 months, worried about customer privacy backlash. When competitors gained 12% conversion lifts, she fast-tracked a privacy-first pilot. Lesson: waiting for perfect conditions is itself a risk decision. So what? Define your acceptable risk threshold now, before urgency forces a rushed choice.`,
  ],
  framework: [
    `5 questions for any AI vendor pitch: 1) What problem does this solve that humans can't? 2) Show me a real client result with numbers. 3) How does your system handle errors? 4) What data does it need to work? 5) What's the exit cost if this doesn't work? So what? These questions separate vendors with substance from those with slides.`,
    `Before greenlighting AI budget, use this 3-check filter: Is the problem real and recurring? Is there a measurable success metric? Is there a human fallback if AI fails? All three must be yes. So what? This framework prevents you from investing in AI theater instead of AI value.`,
  ],
}

/**
 * Counts words in a text string.
 */
function countWords(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length
}

/**
 * Truncates text to the last complete sentence within the word limit.
 */
function truncateToWordLimit(text: string, maxWords: number): string {
  const words = text.trim().split(/\s+/)
  if (words.length <= maxWords) return text

  const truncated = words.slice(0, maxWords).join(' ')
  // Find the last sentence-ending punctuation
  const lastSentenceEnd = Math.max(
    truncated.lastIndexOf('. '),
    truncated.lastIndexOf('? '),
    truncated.lastIndexOf('! ')
  )

  if (lastSentenceEnd > 0) {
    return truncated.substring(0, lastSentenceEnd + 1).trim()
  }

  return truncated
}

/**
 * Formats email content to SMS length by preserving the "So what?" sentence.
 */
function formatForSMS(emailBody: string): string {
  if (emailBody.length <= MAX_SMS_CHARS) return emailBody

  // Try to extract just the "So what?" sentence
  const soWhatIndex = emailBody.toLowerCase().lastIndexOf('so what?')
  if (soWhatIndex !== -1) {
    const soWhatSentence = emailBody.substring(soWhatIndex)
    if (soWhatSentence.length <= MAX_SMS_CHARS) {
      return soWhatSentence
    }
    return soWhatSentence.substring(0, MAX_SMS_CHARS - 1).trim()
  }

  // Fall back to last sentence that fits
  const sentences = emailBody.split(/(?<=[.!?])\s+/)
  let smsBody = ''
  for (const sentence of sentences) {
    if ((smsBody + sentence).length > MAX_SMS_CHARS) break
    smsBody += (smsBody ? ' ' : '') + sentence
  }

  return smsBody || emailBody.substring(0, MAX_SMS_CHARS)
}

/**
 * Generates personalized content for a user using Claude API.
 * Falls back to mock content if ANTHROPIC_API_KEY is a placeholder.
 * @param contentItem - The source content item to personalize
 * @param userProfile - The user's profile for personalization context
 * @param contentType - The type of content to generate
 * @returns Personalized email and SMS content
 */
export async function generateContent(
  contentItem: ContentItem,
  userProfile: UserProfile,
  contentType: ContentType
): Promise<PersonalizedContent> {
  // Mock mode: return realistic test content
  if (isPlaceholder || !anthropic) {
    const mockPool = MOCK_CONTENT[contentType]
    const mockText = mockPool[Math.floor(Math.random() * mockPool.length)]
    return {
      emailBody: mockText,
      smsBody: formatForSMS(mockText),
      wordCount: countWords(mockText),
    }
  }

  const userContext = `Role: ${userProfile.role}. Industry: ${userProfile.industry}. AI involvement level: ${userProfile.ai_maturity}.`

  const prompt = `Content type: ${contentType}
Source insight: "${contentItem.body_text}"
User context: ${userContext}

Write a ${contentType} for this executive. Remember: max ${MAX_WORDS} words, end with "So what?" sentence specific to their role. No jargon, no fluff.`

  const response = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 200,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: prompt }],
  })

  const rawText =
    response.content[0].type === 'text' ? response.content[0].text : ''

  const emailBody = truncateToWordLimit(rawText, MAX_WORDS)
  const wordCount = countWords(emailBody)
  const smsBody = formatForSMS(emailBody)

  return { emailBody, smsBody, wordCount }
}
