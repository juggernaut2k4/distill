/**
 * Semantic search via pgvector + OpenAI embeddings.
 *
 * Why openai package: @anthropic-ai/sdk does not provide an embeddings API.
 * OpenAI text-embedding-3-small is the industry-standard 1536-dimension model
 * and the only approved path to vector search on this stack.
 * Package: openai@4.x — 10M+ weekly downloads, actively maintained, no known CVEs.
 *
 * Usage:
 *   1. Generate: generateEmbedding(text) → number[] | null
 *   2. Store:    embedding column in topic_content_cache (migration 036)
 *   3. Search:   semanticSearchContent(query, userContext) → matching cache rows
 *
 * Integration points:
 *   - session-content-async.ts: generates + stores embedding after each section
 *   - lib/session-ai.ts: calls semanticSearchContent for off-script user questions
 *   - lib/topic-cache.ts: getCachedSection falls back to semantic match when exact + adaptation miss
 */

import OpenAI from 'openai'
import { createSupabaseAdminClient } from './supabase'
import type { TemplateSection } from './templates/types'

const _isPlaceholder =
  !process.env.OPENAI_API_KEY ||
  process.env.OPENAI_API_KEY.startsWith('PLACEHOLDER')

const _openai = _isPlaceholder ? null : new OpenAI({ apiKey: process.env.OPENAI_API_KEY })

const EMBEDDING_MODEL = 'text-embedding-3-small'
const EMBEDDING_DIMS = 1536

// ─── HELPERS ─────────────────────────────────────────────────────────────────

/**
 * Converts a TemplateSection into a readable text string suitable for embedding.
 * Extracts the most semantically meaningful fields from the structured data
 * rather than embedding raw JSON noise.
 */
function sectionToText(section: TemplateSection, subtopicTitle: string): string {
  const data = section.data as unknown as Record<string, unknown>
  const parts: string[] = [subtopicTitle]

  // Pull top-level string fields that carry meaning
  for (const key of ['title', 'term', 'question', 'headline_stat', 'topic_name', 'framework_name', 'company', 'challenge', 'central_concept']) {
    if (typeof data[key] === 'string') parts.push(data[key] as string)
  }

  // Pull "so what" and summary fields — highest signal for relevance
  for (const key of ['so_what', 'so_what_for_you', 'direct_answer', 'context', 'purpose', 'summary', 'one_line']) {
    if (typeof data[key] === 'string') parts.push(data[key] as string)
  }

  return parts.join(' ').slice(0, 4000) // stay well under token limits
}

// ─── GENERATE ─────────────────────────────────────────────────────────────────

/**
 * Generates a 1536-dimension embedding for the given text.
 * Returns null if OPENAI_API_KEY is not configured — callers must handle gracefully.
 */
export async function generateEmbedding(text: string): Promise<number[] | null> {
  if (!_openai) {
    console.log('[embeddings] Skipping — OPENAI_API_KEY not configured')
    return null
  }
  try {
    const response = await _openai.embeddings.create({
      model: EMBEDDING_MODEL,
      input: text.slice(0, 8000), // model limit
      dimensions: EMBEDDING_DIMS,
    })
    return response.data[0].embedding
  } catch (err) {
    console.warn('[embeddings] generateEmbedding failed (non-fatal):', err)
    return null
  }
}

/**
 * Generates an embedding for a TemplateSection and stores it in topic_content_cache.
 * Called asynchronously after content generation — never blocks the main pipeline.
 */
export async function embedAndStoreSection(
  topicId: string,
  subtopicSlug: string,
  subtopicTitle: string,
  section: TemplateSection,
  userContext: { role: string; industry: string }
): Promise<void> {
  const text = sectionToText(section, subtopicTitle)
  const embedding = await generateEmbedding(text)
  if (!embedding) return

  try {
    const supabase = createSupabaseAdminClient()
    await supabase
      .from('topic_content_cache')
      .update({ embedding })
      .eq('topic_id', topicId)
      .eq('subtopic_slug', subtopicSlug)
      .eq('industry', userContext.industry)
      .eq('role', userContext.role)
  } catch (err) {
    console.warn('[embeddings] Store failed (non-fatal):', err)
  }
}

// ─── SEARCH ───────────────────────────────────────────────────────────────────

export interface SemanticSearchResult {
  topic_id: string
  subtopic_slug: string
  subtopic_title: string
  section_data: TemplateSection
  training_script: unknown
  similarity: number
}

/**
 * Finds the most semantically relevant cached sections for an arbitrary text query.
 *
 * Priority order:
 *   1. Exact industry+role match (personalised rows)
 *   2. Generic rows (industry='', role='') as fallback
 *
 * @param query     - Free-text query (e.g. a user question from a live session)
 * @param userContext - Used to prefer personalised rows
 * @param topicId   - Optional: restrict search to a specific topic
 * @param limit     - Max results (default 3)
 */
export async function semanticSearchContent(
  query: string,
  userContext: { role: string; industry: string },
  topicId?: string,
  limit = 3
): Promise<SemanticSearchResult[]> {
  if (!_openai) {
    console.log('[embeddings] semanticSearch skipped — OPENAI_API_KEY not configured')
    return []
  }

  const queryEmbedding = await generateEmbedding(query)
  if (!queryEmbedding) return []

  try {
    const supabase = createSupabaseAdminClient()
    const embeddingStr = `[${queryEmbedding.join(',')}]`

    // Search personalised rows first
    let q = supabase.rpc('match_topic_content', {
      query_embedding: embeddingStr,
      match_industry: userContext.industry,
      match_role: userContext.role,
      match_count: limit,
    })
    if (topicId) q = q.eq('topic_id', topicId)

    const { data: personalised } = await q

    if (personalised && personalised.length > 0) {
      return personalised as SemanticSearchResult[]
    }

    // Fallback: search generic rows
    let gq = supabase.rpc('match_topic_content', {
      query_embedding: embeddingStr,
      match_industry: '',
      match_role: '',
      match_count: limit,
    })
    if (topicId) gq = gq.eq('topic_id', topicId)

    const { data: generic } = await gq
    return (generic ?? []) as SemanticSearchResult[]
  } catch (err) {
    console.warn('[embeddings] semanticSearch failed (non-fatal):', err)
    return []
  }
}
