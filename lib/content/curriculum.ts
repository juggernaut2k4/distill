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
  subtopics: string[]
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
    subtopics: [
      'What generative AI is and why this moment is strategically different',
      'The foundation model landscape: GPT, Claude, Gemini — what they share',
      'What AI can realistically do today vs. what vendors claim',
      'The three decisions every executive must make in the next 12 months',
      'How to frame AI as a capability, not a one-time project',
    ],
  },
  {
    id: 'llm-basics',
    title: 'How Large Language Models Work',
    estimatedMinutes: 30,
    difficulty: 'beginner',
    prerequisites: [],
    tags: ['Technology Foundations'],
    subtopics: [
      'How language models process and generate text — no math required',
      'What "training" means and why it determines what a model knows',
      'Context windows, tokens, and why they affect your use case',
      'Open-source vs. proprietary models: the real strategic trade-off',
      'Top LLM providers compared: GPT-4o vs Claude vs Gemini vs open-source — what each is best for',
      'Why two models with similar names can produce very different outputs',
    ],
  },
  {
    id: 'ai-strategy-intro',
    title: 'AI Strategy for Executives',
    estimatedMinutes: 25,
    difficulty: 'beginner',
    prerequisites: [],
    tags: ['AI Strategy & Leadership'],
    subtopics: [
      'The four strategic postures: observe, experiment, scale, lead',
      'How to define AI ambition without overcommitting resources',
      'Aligning AI initiatives with core business outcomes',
      'What separates an AI strategy from an AI wish list',
      'What a credible 12-month AI roadmap actually looks like',
    ],
  },
  {
    id: 'ml-basics',
    title: 'Machine Learning Basics',
    estimatedMinutes: 25,
    difficulty: 'beginner',
    prerequisites: ['ai-fundamentals'],
    tags: ['Technology Foundations'],
    subtopics: [
      'The difference between machine learning, deep learning, and AI',
      'How models learn from data and why data quality is the real bottleneck',
      'Supervised vs. unsupervised learning — which applies to your business',
      'Why ML models degrade after deployment and need ongoing maintenance',
      'Reading model performance metrics without being a data scientist',
    ],
  },
  {
    id: 'ai-culture',
    title: 'Building an AI-Ready Culture',
    estimatedMinutes: 20,
    difficulty: 'beginner',
    prerequisites: ['ai-strategy-intro'],
    tags: ['AI Strategy & Leadership', 'Team & Org'],
    subtopics: [
      'Why most AI initiatives fail for cultural, not technical, reasons',
      'The five mindset shifts required at every level of the organization',
      'How to create psychological safety around AI experimentation',
      'Identifying and empowering your internal AI champions',
      'Building an environment where AI experiments are expected to fail fast',
    ],
  },

  // Intermediate topics
  {
    id: 'ai-roi',
    title: 'Measuring AI ROI',
    estimatedMinutes: 25,
    difficulty: 'intermediate',
    prerequisites: ['ai-strategy-intro'],
    tags: ['AI Strategy & Leadership'],
    subtopics: [
      'The three categories of AI value: efficiency, revenue, and strategic advantage',
      'How to calculate ROI when benefits are indirect or long-term',
      'Which AI investments pay back in 90 days vs. 2 years',
      'Setting the right KPIs before you start — not after',
      'The measurement traps executives consistently fall into with AI',
    ],
  },
  {
    id: 'ai-vendor-eval',
    title: 'AI Vendor Evaluation',
    estimatedMinutes: 30,
    difficulty: 'intermediate',
    prerequisites: ['ai-strategy-intro', 'ai-fundamentals'],
    tags: ['AI Strategy & Leadership'],
    subtopics: [
      'The seven questions to ask every AI vendor — and the answers that matter',
      'How to evaluate vendor claims without deep technical knowledge',
      'Build vs. buy vs. partner: the executive framework for AI decisions',
      'Enterprise AI platforms compared: Microsoft Copilot vs Google Vertex vs AWS Bedrock vs Salesforce Einstein',
      'Red flags in AI vendor proposals and how to spot them',
      'Due diligence checklist for AI procurement',
    ],
  },
  {
    id: 'ai-governance',
    title: 'AI Governance & Risk',
    estimatedMinutes: 25,
    difficulty: 'intermediate',
    prerequisites: ['ai-strategy-intro'],
    tags: ['AI Strategy & Leadership'],
    subtopics: [
      'Why AI governance is now a board-level conversation',
      'The three pillars of AI governance: accountability, transparency, control',
      'How to structure an AI oversight committee that actually works',
      'Policy frameworks that balance innovation with risk management',
      'What good AI governance looks like in practice — with real examples',
    ],
  },
  {
    id: 'data-strategy',
    title: 'Data Strategy & Infrastructure',
    estimatedMinutes: 35,
    difficulty: 'intermediate',
    prerequisites: ['ml-basics'],
    tags: ['Technology Foundations'],
    subtopics: [
      'Why data is the real AI competitive advantage — not the model',
      'Honestly assessing your organization\'s data readiness',
      'Data lakes vs. warehouses vs. lakehouses: what you actually need',
      'Data platform tools compared: Snowflake vs Databricks vs BigQuery — key differentiators and best-fit scenarios',
      'Data governance: who owns what and why ownership matters',
      'Building a data strategy that enables AI without becoming a data project',
    ],
  },
  {
    id: 'ai-ops',
    title: 'AI in Operations & Supply Chain',
    estimatedMinutes: 30,
    difficulty: 'intermediate',
    prerequisites: ['ai-fundamentals'],
    tags: ['Operational AI'],
    subtopics: [
      'The eight operational areas where AI creates the most immediate value',
      'Supply chain AI: demand forecasting, route optimization, risk detection',
      'Operations AI tools compared: o9 Solutions vs Blue Yonder vs Kinaxis vs SAP IBP — what each does best',
      'How to identify automation candidates in your existing operations',
      'Integrating AI into operational workflows without disrupting them',
      'Measuring operational AI success beyond cost savings alone',
    ],
  },
  {
    id: 'ai-cx',
    title: 'AI for Customer Experience',
    estimatedMinutes: 25,
    difficulty: 'intermediate',
    prerequisites: ['ai-fundamentals'],
    tags: ['Operational AI'],
    subtopics: [
      'Where AI creates genuine customer experience improvements vs. hype',
      'The personalization paradox: why more data doesn\'t always mean better CX',
      'CX AI platforms compared: Salesforce Einstein vs Adobe Experience vs Genesys vs Intercom — strengths and fit',
      'AI-powered service: what customers actually respond to',
      'How to avoid the "AI chatbot that frustrates everyone" outcome',
      'Measuring CX AI impact in terms your customers actually care about',
    ],
  },
  {
    id: 'process-automation',
    title: 'Process Automation with AI',
    estimatedMinutes: 30,
    difficulty: 'intermediate',
    prerequisites: ['ai-fundamentals', 'ml-basics'],
    tags: ['Operational AI'],
    subtopics: [
      'Distinguishing RPA from intelligent automation from true AI',
      'The process automation opportunity matrix — where to start',
      'Automation platforms compared: UiPath vs Automation Anywhere vs Microsoft Power Automate vs AI-native agents',
      'How to identify which processes to automate first for maximum impact',
      'Managing the workforce transition that automation creates',
      'Automation governance: when AI makes wrong decisions at scale',
    ],
  },
  {
    id: 'upskilling',
    title: 'Upskilling Your Team for AI',
    estimatedMinutes: 20,
    difficulty: 'intermediate',
    prerequisites: ['ai-culture'],
    tags: ['Team & Org'],
    subtopics: [
      'The AI skills gap: what it actually means for your organization',
      'The four types of AI literacy your team needs at different levels',
      'Building an AI learning culture vs. just running a training program',
      'How to evaluate AI upskilling vendors and programs critically',
      'Creating an AI mentorship and peer learning ecosystem internally',
    ],
  },
  {
    id: 'change-mgmt',
    title: 'Change Management for AI',
    estimatedMinutes: 20,
    difficulty: 'intermediate',
    prerequisites: ['ai-culture'],
    tags: ['Team & Org'],
    subtopics: [
      'The three waves of AI-driven organizational change — and your timing',
      'Why AI change management differs from standard digital transformation',
      'Managing the fear and resistance that AI inevitably creates',
      'Communication strategies for AI adoption across all levels',
      'Building change capacity before you urgently need it',
    ],
  },
  {
    id: 'ai-security',
    title: 'AI Security & Privacy',
    estimatedMinutes: 30,
    difficulty: 'intermediate',
    prerequisites: ['ai-fundamentals'],
    tags: ['Technology Foundations'],
    subtopics: [
      'The new attack vectors that AI opens which didn\'t exist before',
      'Prompt injection, data poisoning, and model theft — explained simply',
      'AI security and data governance tools compared: what\'s available for enterprise protection',
      'How to evaluate AI security claims from vendors without being an expert',
      'Building AI security requirements into procurement and deployment',
      'The regulatory landscape for AI security and data privacy',
    ],
  },

  // Advanced topics
  {
    id: 'ai-competitive',
    title: 'AI Competitive Intelligence',
    estimatedMinutes: 30,
    difficulty: 'advanced',
    prerequisites: ['ai-roi', 'ai-vendor-eval'],
    tags: ['Competitive Edge'],
    subtopics: [
      'How to track and interpret competitors\' AI investments and capabilities',
      'Building a competitive intelligence system powered by AI',
      'Competitive intelligence platforms compared: Crayon vs Klue vs Similarweb vs AI-native research tools',
      'First-mover vs. fast-follower: which AI strategy fits your position',
      'Identifying AI-driven market disruption before it arrives at your door',
      'Translating competitive intelligence into board-level strategic decisions',
    ],
  },
  {
    id: 'ai-product',
    title: 'AI in Product Development',
    estimatedMinutes: 30,
    difficulty: 'advanced',
    prerequisites: ['data-strategy', 'process-automation'],
    tags: ['Competitive Edge'],
    subtopics: [
      'How AI fundamentally changes the product development lifecycle',
      'From feature roadmaps to intelligence roadmaps — the shift in thinking',
      'AI product ethics: what to build, what to avoid, and why it matters',
      'The new product management skills required in an AI-first environment',
      'Measuring AI product success beyond engagement and retention metrics',
    ],
  },
  {
    id: 'ai-teams',
    title: 'Building AI Product Teams',
    estimatedMinutes: 25,
    difficulty: 'advanced',
    prerequisites: ['upskilling', 'change-mgmt'],
    tags: ['Team & Org'],
    subtopics: [
      'The new roles AI creates and the existing roles it fundamentally changes',
      'How to recruit AI talent in a market where demand exceeds supply',
      'Centralized AI center of excellence vs. distributed team model',
      'Building interdisciplinary teams where AI engineers and business leaders align',
      'Creating a culture where AI and business speak the same language',
    ],
  },
  {
    id: 'ai-finance',
    title: 'AI in Finance & Forecasting',
    estimatedMinutes: 30,
    difficulty: 'advanced',
    prerequisites: ['data-strategy', 'ai-ops'],
    tags: ['Operational AI'],
    subtopics: [
      'AI applications in financial forecasting and strategic planning',
      'Fraud detection, risk modeling, and anomaly detection at enterprise scale',
      'Finance AI tools compared: Anaplan vs Workday Adaptive vs Oracle EPM vs Pigment — what each does best',
      'How AI is changing the CFO role and the finance function',
      'The financial data infrastructure that AI requires to perform reliably',
      'Evaluating AI vendors specifically for finance and forecasting use cases',
    ],
  },
  {
    id: 'ai-ethics',
    title: 'AI Ethics & Responsible Use',
    estimatedMinutes: 20,
    difficulty: 'advanced',
    prerequisites: ['ai-governance'],
    tags: ['Team & Org'],
    subtopics: [
      'Why AI ethics is a strategic business issue, not just a PR concern',
      'Identifying and mitigating bias in AI systems before it causes harm',
      'Fairness, accountability, and transparency — practical frameworks for leaders',
      'How to build an AI ethics review process that isn\'t just a checkbox',
      'When to say no: the decisions AI should never make on its own',
    ],
  },
  {
    id: 'ai-regulation',
    title: 'AI Regulation & Compliance',
    estimatedMinutes: 25,
    difficulty: 'advanced',
    prerequisites: ['ai-governance', 'ai-security'],
    tags: ['Competitive Edge'],
    subtopics: [
      'The global AI regulatory landscape and where it\'s heading',
      'EU AI Act, US Executive Orders, and what they mean for your business now',
      'Building compliance into AI development before regulators require it',
      'How to engage productively with regulators on AI policy',
      'Preparing for AI regulation that doesn\'t fully exist yet',
    ],
  },
  {
    id: 'ai-trends',
    title: 'Emerging AI Trends',
    estimatedMinutes: 20,
    difficulty: 'advanced',
    prerequisites: ['ai-vendor-eval'],
    tags: ['Competitive Edge'],
    subtopics: [
      'The AI capabilities arriving in the next 12–18 months that will matter most',
      'Multi-modal AI: what becomes possible when AI sees, hears, and reads together',
      'Agentic AI: when AI systems act autonomously on your organization\'s behalf',
      'The organizations that will define AI leadership in the next five years',
      'Separating genuine AI breakthroughs from noise — a leader\'s filter',
    ],
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

  // Map titles to catalog entries — exact match only, otherwise synthesize from title
  const selectedCatalogTopics = matchTopicsToCatalog(selectedTopicTitles, aiMaturity)

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

function generateSubtopicsForTitle(title: string): string[] {
  return [
    `Core concepts and frameworks underlying ${title.toLowerCase()}`,
    `How leading organizations approach this effectively`,
    `Common pitfalls, risks, and how to navigate them`,
    `Key decision points, metrics, and success indicators`,
    `Your immediate action plan: priorities for the next 90 days`,
  ]
}

function matchTopicsToCatalog(
  titles: string[],
  maturity: string,
): CurriculumTopic[] {
  const result: CurriculumTopic[] = []
  const addedIds = new Set<string>()

  const difficulty: 'beginner' | 'intermediate' | 'advanced' =
    MATURITY_MAX_DIFFICULTY[maturity] ?? 'intermediate'

  for (const title of titles) {
    // 1. Exact title match — only accept catalog entries that truly match
    const exact = TOPIC_CATALOG.find((t) => t.title.toLowerCase() === title.toLowerCase())
    if (exact && !addedIds.has(exact.id)) {
      result.push(exact)
      addedIds.add(exact.id)
      continue
    }

    // 2. Synthesize a topic from the user's actual title — never fuzzy-map to a
    //    wrong AI catalog entry just because a common word like "strategy" overlaps
    const syntheticId = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '').slice(0, 64)
    if (!addedIds.has(syntheticId)) {
      result.push({
        id: syntheticId,
        title,
        estimatedMinutes: difficulty === 'beginner' ? 20 : difficulty === 'advanced' ? 30 : 25,
        difficulty,
        prerequisites: [],
        tags: [],
        subtopics: generateSubtopicsForTitle(title),
      })
      addedIds.add(syntheticId)
    }
  }

  // Only fall back to default AI starter curriculum if no topics at all
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
