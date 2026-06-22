/**
 * Semantic search via pgvector + Voyage AI embeddings.
 *
 * Why voyageai and not @anthropic-ai/sdk: Anthropic's Claude API has no embeddings
 * endpoint — it is a text-generation-only API. Voyage AI is Anthropic's official
 * recommended embeddings partner. Using the same ANTHROPIC ecosystem, different key.
 * Package: voyageai — official Voyage AI SDK, actively maintained.
 *
 * Model: voyage-3-lite — 1024 dimensions, fast, low cost, high quality for retrieval.
 * Required env var: VOYAGE_API_KEY (separate from ANTHROPIC_API_KEY)
 *
 * Usage:
 *   1. Generate: generateEmbedding(text) → number[] | null
 *   2. Store:    embedding vector(1024) column in topic_content_cache (migration 036+037)
 *   3. Search:   semanticSearchContent(query, userContext) → ranked cache rows
 *
 * Integration points:
 *   - inngest/session-content-async.ts: stores embedding after each section is generated
 *   - lib/session-ai.ts: calls semanticSearchContent for off-script user questions during live sessions
 */

import { VoyageAIClient } from 'voyageai'
import { createSupabaseAdminClient } from './supabase'
import type { TemplateSection } from './templates/types'

const _isPlaceholder =
  !process.env.VOYAGE_API_KEY ||
  process.env.VOYAGE_API_KEY.startsWith('PLACEHOLDER')

const _voyage = _isPlaceholder ? null : new VoyageAIClient({ apiKey: process.env.VOYAGE_API_KEY })

const EMBEDDING_MODEL = 'voyage-3-lite'

// ─── HELPERS ─────────────────────────────────────────────────────────────────

/**
 * Converts a TemplateSection into readable text for embedding.
 * Extracts the highest-signal fields rather than dumping raw JSON.
 */
function sectionToText(section: TemplateSection, subtopicTitle: string): string {
  const data = section.data as unknown as Record<string, unknown>
  const parts: string[] = [subtopicTitle]

  for (const key of ['title', 'term', 'question', 'headline_stat', 'topic_name', 'framework_name', 'company', 'challenge', 'central_concept']) {
    if (typeof data[key] === 'string') parts.push(data[key] as string)
  }

  for (const key of ['so_what', 'so_what_for_you', 'direct_answer', 'context', 'purpose', 'one_line']) {
    if (typeof data[key] === 'string') parts.push(data[key] as string)
  }

  return parts.join(' ').slice(0, 4000)
}

// ─── GENERATE ─────────────────────────────────────────────────────────────────

/**
 * Generates a 1024-dimension Voyage AI embedding for the given text.
 * Returns null if VOYAGE_API_KEY is not configured — callers handle gracefully.
 */
export async function generateEmbedding(text: string): Promise<number[] | null> {
  if (!_voyage) {
    console.log('[embeddings] Skipping — VOYAGE_API_KEY not configured')
    return null
  }
  try {
    const result = await _voyage.embed({
      input: [text.slice(0, 8000)],
      model: EMBEDDING_MODEL,
    })
    return result.data?.[0]?.embedding ?? null
  } catch (err) {
    console.warn('[embeddings] generateEmbedding failed (non-fatal):', err)
    return null
  }
}

/**
 * Generates an embedding for a TemplateSection and stores it in topic_content_cache.
 * Called asynchronously after content generation — never blocks the pipeline.
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
 * Used when a user asks an off-script question during a live Recall.ai session
 * and Clio needs to find the best matching content without an exact key lookup.
 *
 * Lookup order:
 *   1. Personalised rows matching the user's exact industry + role
 *   2. Generic rows (industry='', role='') as fallback
 *
 * @param query       Free-text query (e.g. user question from live session)
 * @param userContext Used to prefer personalised rows
 * @param topicId     Optional: restrict search to a specific topic
 * @param limit       Max results to return (default 3)
 */
export async function semanticSearchContent(
  query: string,
  userContext: { role: string; industry: string },
  topicId?: string,
  limit = 3
): Promise<SemanticSearchResult[]> {
  if (!_voyage) {
    console.log('[embeddings] semanticSearch skipped — VOYAGE_API_KEY not configured')
    return []
  }

  const queryEmbedding = await generateEmbedding(query)
  if (!queryEmbedding) return []

  try {
    const supabase = createSupabaseAdminClient()
    const embeddingStr = `[${queryEmbedding.join(',')}]`

    // 1. Personalised rows
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

    // 2. Generic fallback
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
