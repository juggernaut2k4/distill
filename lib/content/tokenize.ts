/**
 * Deterministic, zero-dependency tokenizer shared by RTV-02 (marker generation,
 * server-only) and RTV-03 (live tracking, imported client-side into
 * WalkthroughClient.tsx). Deliberately kept in its own file with no imports at
 * all — this file must never pull in server-only SDKs (Anthropic, Resend,
 * etc.), since it is bundled into the browser. Do not add imports here.
 *
 * Single source of truth for excluded generic terms — words that would appear
 * across nearly every topic in an AI-coaching session, so they are never safe
 * single-hit markers.
 */
export const RTV02_STOPWORDS = new Set<string>([
  // articles
  'a', 'an', 'the',
  // prepositions
  'of', 'in', 'on', 'at', 'to', 'for', 'with', 'by', 'from', 'into', 'onto',
  'over', 'under', 'about', 'across', 'after', 'before', 'between', 'during',
  'through', 'without', 'within', 'against', 'among', 'around', 'up', 'out', 'off',
  // pronouns / determiners
  'it', 'its', 'they', 'their', 'them', 'this', 'that', 'these', 'those',
  'you', 'your', 'we', 'our', 'he', 'she', 'his', 'her', 'i', 'my', 'who', 'which', 'what',
  // auxiliaries / common verbs
  'is', 'are', 'was', 'were', 'be', 'been', 'being', 'has', 'have', 'had',
  'do', 'does', 'did', 'can', 'could', 'will', 'would', 'should', 'may', 'might', 'must', 'shall',
  // conjunctions / connectives
  'and', 'or', 'but', 'so', 'as', 'if', 'because', 'than', 'then', 'not', 'no',
  // curated session-generic terms — appear across nearly every topic in an
  // AI-coaching session, so they are never safe single-hit markers
  'ai', 'model', 'models', 'use', 'using', 'used', 'data', 'system', 'systems',
  'executive', 'executives', 'business', 'team', 'teams', 'work', 'working',
  'help', 'helps', 'need', 'needs', 'way', 'ways', 'one', 'two', 'three',
  'also', 'more', 'most', 'like', 'just', 'get', 'gets', 'new', 'today', 'now',
  'when', 'where', 'why', 'how', 'all', 'any', 'some', 'each', 'every', 'other',
  'make', 'makes', 'making', 'take', 'takes', 'taking', 'give', 'gives', 'giving',
  'session', 'topic', 'topics', 'thing', 'things', 'know', 'knowing', 'understand',
])

/**
 * Deterministic tokenizer: lowercase + Unicode NFKC normalize, split on
 * whitespace/punctuation EXCEPT internal hyphens/underscores/dots between
 * alphanumerics (so `top_p`, `server-sent`, `gpt-4`, `claude-sonnet-4-6`
 * survive as single tokens). Drops pure-number tokens, tokens shorter than 2
 * chars, and stopwords.
 */
export function tokenize(text: string | null | undefined): string[] {
  if (!text) return []
  const normalized = text.normalize('NFKC').toLowerCase()
  const raw = normalized.match(/[a-z0-9]+(?:[._-][a-z0-9]+)*/g) ?? []
  return raw.filter((tok) => {
    if (tok.length < 2) return false
    if (/^[0-9]+$/.test(tok)) return false
    if (RTV02_STOPWORDS.has(tok)) return false
    return true
  })
}
