/**
 * Curriculum intelligence: prerequisite detection and session planning.
 * Ensures beginner users get foundational topics before advanced ones.
 */

export interface CurriculumTopic {
  id: string
  title: string
  estimatedMinutes: number
  difficulty: 'beginner' | 'intermediate' | 'advanced'
  prerequisites: string[]
  tags: string[]
}

export interface CurriculumSession {
  index: number
  title: string
  topics: CurriculumTopic[]
  estimatedMinutes: number
}

export interface CurriculumPlan {
  sessions: CurriculumSession[]
  totalMinutes: number
  totalTopics: number
  generatedAt: string
}

// ─── Topic catalog with prerequisites ─────────────────────────────────────────

const TOPIC_CATALOG: CurriculumTopic[] = [
  // Beginner foundations
  {
    id: 'ai-fundamentals',
    title: 'Generative AI Fundamentals',
    estimatedMinutes: 20,
    difficulty: 'beginner',
    prerequisites: [],
    tags: ['AI Strategy & Leadership', 'Technology Foundations'],
  },
  {
    id: 'llm-basics',
    title: 'How Large Language Models Work',
    estimatedMinutes: 25,
    difficulty: 'beginner',
    prerequisites: [],
    tags: ['Technology Foundations'],
  },
  {
    id: 'ai-strategy-intro',
    title: 'AI Strategy for Executives',
    estimatedMinutes: 25,
    difficulty: 'beginner',
    prerequisites: [],
    tags: ['AI Strategy & Leadership'],
  },
  {
    id: 'ml-basics',
    title: 'Machine Learning Basics',
    estimatedMinutes: 25,
    difficulty: 'beginner',
    prerequisites: ['ai-fundamentals'],
    tags: ['Technology Foundations'],
  },
  {
    id: 'ai-culture',
    title: 'Building an AI-Ready Culture',
    estimatedMinutes: 20,
    difficulty: 'beginner',
    prerequisites: ['ai-strategy-intro'],
    tags: ['AI Strategy & Leadership', 'Team & Org'],
  },

  // Intermediate topics
  {
    id: 'ai-roi',
    title: 'Measuring AI ROI',
    estimatedMinutes: 25,
    difficulty: 'intermediate',
    prerequisites: ['ai-strategy-intro'],
    tags: ['AI Strategy & Leadership'],
  },
  {
    id: 'ai-vendor-eval',
    title: 'AI Vendor Evaluation',
    estimatedMinutes: 25,
    difficulty: 'intermediate',
    prerequisites: ['ai-strategy-intro', 'ai-fundamentals'],
    tags: ['AI Strategy & Leadership'],
  },
  {
    id: 'ai-governance',
    title: 'AI Governance & Risk',
    estimatedMinutes: 25,
    difficulty: 'intermediate',
    prerequisites: ['ai-strategy-intro'],
    tags: ['AI Strategy & Leadership'],
  },
  {
    id: 'data-strategy',
    title: 'Data Strategy & Infrastructure',
    estimatedMinutes: 30,
    difficulty: 'intermediate',
    prerequisites: ['ml-basics'],
    tags: ['Technology Foundations'],
  },
  {
    id: 'ai-ops',
    title: 'AI in Operations & Supply Chain',
    estimatedMinutes: 25,
    difficulty: 'intermediate',
    prerequisites: ['ai-fundamentals'],
    tags: ['Operational AI'],
  },
  {
    id: 'ai-cx',
    title: 'AI for Customer Experience',
    estimatedMinutes: 20,
    difficulty: 'intermediate',
    prerequisites: ['ai-fundamentals'],
    tags: ['Operational AI'],
  },
  {
    id: 'process-automation',
    title: 'Process Automation with AI',
    estimatedMinutes: 25,
    difficulty: 'intermediate',
    prerequisites: ['ai-fundamentals', 'ml-basics'],
    tags: ['Operational AI'],
  },
  {
    id: 'upskilling',
    title: 'Upskilling Your Team for AI',
    estimatedMinutes: 20,
    difficulty: 'intermediate',
    prerequisites: ['ai-culture'],
    tags: ['Team & Org'],
  },
  {
    id: 'change-mgmt',
    title: 'Change Management for AI',
    estimatedMinutes: 20,
    difficulty: 'intermediate',
    prerequisites: ['ai-culture'],
    tags: ['Team & Org'],
  },
  {
    id: 'ai-security',
    title: 'AI Security & Privacy',
    estimatedMinutes: 25,
    difficulty: 'intermediate',
    prerequisites: ['ai-fundamentals'],
    tags: ['Technology Foundations'],
  },

  // Advanced topics
  {
    id: 'ai-competitive',
    title: 'AI Competitive Intelligence',
    estimatedMinutes: 25,
    difficulty: 'advanced',
    prerequisites: ['ai-roi', 'ai-vendor-eval'],
    tags: ['Competitive Edge'],
  },
  {
    id: 'ai-product',
    title: 'AI in Product Development',
    estimatedMinutes: 30,
    difficulty: 'advanced',
    prerequisites: ['data-strategy', 'process-automation'],
    tags: ['Competitive Edge'],
  },
  {
    id: 'ai-teams',
    title: 'Building AI Product Teams',
    estimatedMinutes: 25,
    difficulty: 'advanced',
    prerequisites: ['upskilling', 'change-mgmt'],
    tags: ['Team & Org'],
  },
  {
    id: 'ai-finance',
    title: 'AI in Finance & Forecasting',
    estimatedMinutes: 25,
    difficulty: 'advanced',
    prerequisites: ['data-strategy', 'ai-ops'],
    tags: ['Operational AI'],
  },
  {
    id: 'ai-ethics',
    title: 'AI Ethics & Responsible Use',
    estimatedMinutes: 20,
    difficulty: 'advanced',
    prerequisites: ['ai-governance'],
    tags: ['Team & Org'],
  },
  {
    id: 'ai-regulation',
    title: 'AI Regulation & Compliance',
    estimatedMinutes: 25,
    difficulty: 'advanced',
    prerequisites: ['ai-governance', 'ai-security'],
    tags: ['Competitive Edge'],
  },
  {
    id: 'ai-trends',
    title: 'Emerging AI Trends',
    estimatedMinutes: 20,
    difficulty: 'advanced',
    prerequisites: ['ai-vendor-eval'],
    tags: ['Competitive Edge'],
  },
]

const MATURITY_MAX_DIFFICULTY: Record<string, 'beginner' | 'intermediate' | 'advanced'> = {
  observer: 'beginner',
  evaluator: 'intermediate',
  pilot: 'intermediate',
  scaler: 'advanced',
}

/**
 * Builds a topologically-sorted curriculum from selected topic titles.
 * Injects prerequisite topics when user's maturity requires them.
 */
export function buildCurriculum(
  selectedTopicTitles: string[],
  aiMaturity: string,
): CurriculumPlan {
  const maxDifficulty = MATURITY_MAX_DIFFICULTY[aiMaturity] ?? 'intermediate'

  // Map titles to catalog entries (fuzzy match by tag category)
  const selectedCatalogTopics = matchTopicsToCatalog(selectedTopicTitles)

  // Inject prerequisites for any advanced topics beyond user's maturity
  const enrichedTopics = injectPrerequisites(selectedCatalogTopics, maxDifficulty)

  // Topological sort: prerequisites first
  const sorted = topologicalSort(enrichedTopics)

  // Group into sessions (3-4 topics each, max 90 mins per session)
  const sessions = groupIntoSessions(sorted)

  const totalMinutes = sessions.reduce((sum, s) => sum + s.estimatedMinutes, 0)

  return {
    sessions,
    totalMinutes,
    totalTopics: sorted.length,
    generatedAt: new Date().toISOString(),
  }
}

function matchTopicsToCatalog(titles: string[]): CurriculumTopic[] {
  const result: CurriculumTopic[] = []
  const addedIds = new Set<string>()

  for (const title of titles) {
    // Exact match first
    const exact = TOPIC_CATALOG.find(
      (t) => t.title.toLowerCase() === title.toLowerCase()
    )
    if (exact && !addedIds.has(exact.id)) {
      result.push(exact)
      addedIds.add(exact.id)
      continue
    }

    // Tag/category match
    const tagMatch = TOPIC_CATALOG.find(
      (t) => t.tags.some((tag) => title.toLowerCase().includes(tag.toLowerCase().split(' ')[0]))
        && !addedIds.has(t.id)
    )
    if (tagMatch) {
      result.push(tagMatch)
      addedIds.add(tagMatch.id)
    }
  }

  // If nothing matched, return default starter curriculum
  if (result.length === 0) {
    return TOPIC_CATALOG.filter((t) => t.difficulty === 'beginner').slice(0, 4)
  }

  return result
}

function injectPrerequisites(
  topics: CurriculumTopic[],
  maxDifficulty: 'beginner' | 'intermediate' | 'advanced'
): CurriculumTopic[] {
  const difficultyRank = { beginner: 0, intermediate: 1, advanced: 2 }
  const addedIds = new Set(topics.map((t) => t.id))
  const result = [...topics]

  // For each topic that exceeds user's max difficulty, inject prerequisites
  for (const topic of [...topics]) {
    if (difficultyRank[topic.difficulty] > difficultyRank[maxDifficulty]) {
      for (const prereqId of topic.prerequisites) {
        if (!addedIds.has(prereqId)) {
          const prereq = TOPIC_CATALOG.find((t) => t.id === prereqId)
          if (prereq) {
            result.unshift(prereq)
            addedIds.add(prereqId)
          }
        }
      }
    }
  }

  return result
}

function topologicalSort(topics: CurriculumTopic[]): CurriculumTopic[] {
  const topicMap = new Map(topics.map((t) => [t.id, t]))
  const visited = new Set<string>()
  const result: CurriculumTopic[] = []

  function visit(topic: CurriculumTopic) {
    if (visited.has(topic.id)) return
    visited.add(topic.id)

    for (const prereqId of topic.prerequisites) {
      const prereq = topicMap.get(prereqId)
      if (prereq) visit(prereq)
    }

    result.push(topic)
  }

  for (const topic of topics) {
    visit(topic)
  }

  return result
}

/**
 * Creates one session per topic. Each Clio coaching call covers exactly ONE topic (20–30 min max).
 */
function groupIntoSessions(topics: CurriculumTopic[]): CurriculumSession[] {
  return topics.map((topic, i) => buildSession(i + 1, topic))
}

function buildSession(
  index: number,
  topic: CurriculumTopic
): CurriculumSession {
  return {
    index,
    title: topic.title,
    topics: [topic],
    estimatedMinutes: topic.estimatedMinutes,
  }
}
