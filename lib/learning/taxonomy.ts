/**
 * Learning platform taxonomy — roles, domains, proficiency levels.
 * Domain-agnostic: works for AI, DevOps, React, Agile, or any future subject.
 * This is the single source of truth for onboarding question options and
 * content profile cache key construction.
 */

// ─── PROFICIENCY LEVELS ───────────────────────────────────────────────────────

export const PROFICIENCY_LEVELS = [
  { value: 'beginner',     label: 'Just starting out',                description: 'New to this domain — build from the ground up' },
  { value: 'intermediate', label: 'Have some experience',             description: 'Know the basics — ready to go deeper' },
  { value: 'advanced',     label: 'Comfortable with fundamentals',    description: 'Want advanced patterns, trade-offs, and edge cases' },
  { value: 'expert',       label: 'Already proficient',               description: 'Want cutting-edge insights and strategic perspectives' },
] as const

export type Proficiency = typeof PROFICIENCY_LEVELS[number]['value']

// ─── LEARNING GOALS ───────────────────────────────────────────────────────────

export const LEARNING_GOALS = [
  { value: 'quick_wins',      label: 'Quick wins (5 min/day)',      description: 'Bite-sized insights I can act on immediately' },
  { value: 'steady_progress', label: 'Steady progress (15 min/day)',description: 'Consistent learning without overwhelming my schedule' },
  { value: 'deep_dive',       label: 'Deep dive (30+ min/day)',     description: 'Comprehensive mastery — go as deep as possible' },
] as const

export type LearningGoal = typeof LEARNING_GOALS[number]['value']

// ─── DOMAINS ─────────────────────────────────────────────────────────────────

export interface Domain {
  id: string        // slug, used in profile cache key
  label: string     // display name
  description: string
  icon: string      // emoji for UI
  tags: string[]    // searchable keywords
}

export const ALL_DOMAINS: Domain[] = [
  // Technology & Engineering
  { id: 'ai-ml',              label: 'AI & Machine Learning',              description: 'LLMs, agents, ML fundamentals, model evaluation',         icon: '🤖', tags: ['artificial intelligence', 'llm', 'gpt', 'machine learning', 'deep learning'] },
  { id: 'devops',             label: 'DevOps & Platform Engineering',      description: 'CI/CD, Kubernetes, Docker, SRE, observability',           icon: '⚙️', tags: ['kubernetes', 'docker', 'ci/cd', 'sre', 'platform', 'devops'] },
  { id: 'software-arch',      label: 'Software Architecture',              description: 'Design patterns, microservices, system design, DDD',       icon: '🏛️', tags: ['architecture', 'microservices', 'system design', 'patterns', 'ddd'] },
  { id: 'cloud',              label: 'Cloud Infrastructure',               description: 'AWS, GCP, Azure — compute, networking, storage, IaC',      icon: '☁️', tags: ['aws', 'gcp', 'azure', 'terraform', 'cloud', 'infrastructure'] },
  { id: 'frontend',           label: 'React & Frontend Development',       description: 'React, Next.js, TypeScript, state management, performance', icon: '⚛️', tags: ['react', 'nextjs', 'frontend', 'typescript', 'css', 'javascript'] },
  { id: 'typescript',         label: 'TypeScript & JavaScript',            description: 'Type systems, ES2024+, runtime internals, tooling',        icon: '📘', tags: ['typescript', 'javascript', 'nodejs', 'bun', 'deno'] },
  { id: 'backend',            label: 'Backend Development',                description: 'APIs, databases, caching, queues, Node/Python/Go',         icon: '🖥️', tags: ['node', 'python', 'go', 'api', 'rest', 'graphql', 'backend'] },
  { id: 'data-engineering',   label: 'Data Engineering & Pipelines',       description: 'ETL, Spark, dbt, data lakes, streaming, Kafka',            icon: '🔁', tags: ['data engineering', 'etl', 'spark', 'dbt', 'kafka', 'pipeline'] },
  { id: 'mlops',              label: 'MLOps & Model Deployment',           description: 'Model serving, monitoring, feature stores, drift detection', icon: '🚀', tags: ['mlops', 'model deployment', 'feature store', 'monitoring'] },
  { id: 'cybersecurity',      label: 'Cybersecurity & AppSec',             description: 'Zero trust, threat modelling, OWASP, pen testing',         icon: '🔐', tags: ['security', 'appsec', 'cybersecurity', 'owasp', 'pen testing'] },
  { id: 'testing',            label: 'Testing & Quality Engineering',      description: 'Unit, integration, E2E, TDD, performance testing',         icon: '🧪', tags: ['testing', 'tdd', 'e2e', 'playwright', 'vitest', 'quality'] },
  { id: 'databases',          label: 'Database Engineering',               description: 'SQL, NoSQL, indexing, query optimisation, migrations',      icon: '🗄️', tags: ['database', 'sql', 'postgres', 'mongodb', 'redis', 'supabase'] },
  { id: 'open-source',        label: 'Open Source & Developer Tooling',    description: 'Contributing, maintainership, CLI tools, developer DX',    icon: '🛠️', tags: ['open source', 'cli', 'tooling', 'developer experience', 'dx'] },
  { id: 'emerging-tech',      label: 'Emerging Technologies',              description: 'Web3, quantum computing, edge computing, spatial computing', icon: '🔭', tags: ['web3', 'blockchain', 'quantum', 'edge', 'spatial computing'] },

  // Data & Analytics
  { id: 'ml-fundamentals',    label: 'Machine Learning Fundamentals',      description: 'Supervised/unsupervised learning, model selection, evals',  icon: '📊', tags: ['machine learning', 'supervised', 'unsupervised', 'model selection'] },
  { id: 'deep-learning',      label: 'Deep Learning & Neural Networks',    description: 'CNNs, transformers, fine-tuning, training at scale',        icon: '🧠', tags: ['deep learning', 'neural networks', 'transformers', 'cnn', 'fine-tuning'] },
  { id: 'nlp',                label: 'Natural Language Processing',        description: 'Text classification, embeddings, RAG, named entity recognition', icon: '💬', tags: ['nlp', 'text', 'embeddings', 'rag', 'sentiment', 'classification'] },
  { id: 'data-viz',           label: 'Data Visualisation & Storytelling',  description: 'Dashboards, charting libraries, executive storytelling',    icon: '📈', tags: ['data viz', 'charts', 'dashboards', 'tableau', 'plotly', 'storytelling'] },
  { id: 'bi-analytics',       label: 'Business Intelligence & Analytics',  description: 'SQL analytics, OLAP, Looker, Metabase, self-serve BI',      icon: '🔍', tags: ['business intelligence', 'bi', 'analytics', 'looker', 'metabase', 'sql'] },
  { id: 'statistics',         label: 'Statistics & Probability',           description: 'Hypothesis testing, Bayesian methods, causal inference',    icon: '📉', tags: ['statistics', 'probability', 'bayesian', 'causal inference', 'a/b testing'] },
  { id: 'python',             label: 'Python for Data & Engineering',      description: 'Pandas, NumPy, async Python, packaging, performance',       icon: '🐍', tags: ['python', 'pandas', 'numpy', 'scipy', 'jupyter', 'async'] },

  // Product & Design
  { id: 'product-strategy',   label: 'Product Strategy & Roadmapping',     description: 'Vision, OKRs, prioritisation frameworks, opportunity sizing', icon: '🗺️', tags: ['product strategy', 'roadmap', 'okr', 'prioritisation', 'vision'] },
  { id: 'agile',              label: 'Agile & Scrum',                      description: 'Sprint planning, retrospectives, Kanban, scaled agile',     icon: '🔄', tags: ['agile', 'scrum', 'kanban', 'sprint', 'retrospective', 'safe'] },
  { id: 'user-research',      label: 'User Research & UX',                 description: 'Interviews, usability testing, personas, jobs-to-be-done',  icon: '🎯', tags: ['ux', 'user research', 'usability', 'personas', 'jtbd', 'design thinking'] },
  { id: 'growth',             label: 'Growth & Monetisation',              description: 'PLG, activation, retention, monetisation loops, pricing',   icon: '📈', tags: ['growth', 'plg', 'product-led growth', 'retention', 'monetisation', 'pricing'] },
  { id: 'go-to-market',       label: 'Go-to-Market Strategy',              description: 'Positioning, launch playbooks, ICP, competitive strategy',  icon: '🚀', tags: ['gtm', 'go to market', 'positioning', 'launch', 'icp', 'competitive'] },
  { id: 'ux-design',          label: 'UX Design & Research Strategy',      description: 'Design thinking, research ops, journey mapping, IA',        icon: '🎨', tags: ['ux design', 'design thinking', 'journey mapping', 'information architecture'] },
  { id: 'design-systems',     label: 'Design Systems & Component Libraries', description: 'Tokens, Storybook, accessibility, component-driven design', icon: '🧩', tags: ['design systems', 'storybook', 'tokens', 'figma', 'components'] },
  { id: 'interaction-design', label: 'Interaction Design & Prototyping',   description: 'Figma, motion, micro-interactions, high-fidelity prototyping', icon: '✏️', tags: ['interaction design', 'figma', 'prototyping', 'motion', 'animation'] },
  { id: 'accessibility',      label: 'Accessibility & Inclusive Design',   description: 'WCAG, screen readers, cognitive accessibility, ARIA',       icon: '♿', tags: ['accessibility', 'a11y', 'wcag', 'aria', 'inclusive design'] },
  { id: 'motion-design',      label: 'Motion Design & Animation',          description: 'Framer Motion, Lottie, CSS animations, UI choreography',    icon: '🎬', tags: ['motion', 'animation', 'framer motion', 'lottie', 'transitions'] },
  { id: 'ai-for-design',      label: 'AI Tools for Designers',             description: 'Midjourney, Stable Diffusion, AI-assisted design workflows', icon: '🤖', tags: ['ai design', 'midjourney', 'stable diffusion', 'generative design'] },

  // Business & Strategy
  { id: 'leadership',         label: 'Leadership & Strategy',              description: 'Executive decision-making, communication, organisational leadership', icon: '🏆', tags: ['leadership', 'strategy', 'executive', 'decision making', 'management'] },
  { id: 'digital-transformation', label: 'Digital Transformation',        description: 'Change programmes, technology adoption, operating model redesign', icon: '⚡', tags: ['digital transformation', 'change management', 'operating model'] },
  { id: 'finance',            label: 'Finance & Business Models',          description: 'P&L, unit economics, financial modelling, fundraising',     icon: '💰', tags: ['finance', 'p&l', 'unit economics', 'financial modelling', 'fundraising'] },
  { id: 'operations',         label: 'Operations & Process Excellence',    description: 'Lean, Six Sigma, OKRs, process design, operational efficiency', icon: '⚙️', tags: ['operations', 'lean', 'six sigma', 'process design', 'efficiency'] },
  { id: 'people-org',         label: 'People & Organisational Design',     description: 'Hiring, culture, performance, org structure, team dynamics', icon: '👥', tags: ['hr', 'people', 'culture', 'hiring', 'performance management', 'org design'] },
  { id: 'risk',               label: 'Cybersecurity & Risk Management',    description: 'Enterprise risk, governance, compliance, business continuity', icon: '🛡️', tags: ['risk', 'governance', 'compliance', 'business continuity', 'enterprise security'] },
  { id: 'innovation',         label: 'Innovation & Product Thinking',      description: 'Design sprints, venture thinking, build/buy/partner decisions', icon: '💡', tags: ['innovation', 'design sprint', 'venture', 'build buy partner'] },
  { id: 'data-decisions',     label: 'Data-Driven Decision Making',        description: 'Metrics that matter, experimentation culture, data literacy', icon: '📊', tags: ['data driven', 'metrics', 'experimentation', 'data literacy', 'kpis'] },
  { id: 'ma',                 label: 'Mergers & Acquisitions',             description: 'Due diligence, valuation, integration playbooks, deal structuring', icon: '🤝', tags: ['m&a', 'mergers acquisitions', 'due diligence', 'valuation', 'integration'] },
  { id: 'stakeholder',        label: 'Stakeholder & Executive Communication', description: 'Board communication, presenting to executives, influence without authority', icon: '🗣️', tags: ['stakeholder', 'communication', 'board', 'influence', 'executive presentation'] },

  // Marketing
  { id: 'content-seo',        label: 'Content Marketing & SEO',            description: 'Editorial strategy, SEO fundamentals, content ops, topical authority', icon: '✍️', tags: ['content marketing', 'seo', 'editorial', 'blog', 'content ops'] },
  { id: 'performance-mktg',   label: 'Performance Marketing & Paid Ads',   description: 'Meta Ads, Google Ads, attribution, budget optimisation',    icon: '💸', tags: ['performance marketing', 'meta ads', 'google ads', 'paid', 'attribution'] },
  { id: 'brand',              label: 'Brand Strategy & Positioning',       description: 'Brand identity, messaging frameworks, competitive positioning', icon: '🎭', tags: ['brand', 'positioning', 'identity', 'messaging', 'brand strategy'] },
  { id: 'crm-automation',     label: 'CRM & Marketing Automation',         description: 'HubSpot, Salesforce, email nurture, lead scoring, lifecycle marketing', icon: '🔧', tags: ['crm', 'hubspot', 'salesforce', 'marketing automation', 'email', 'nurture'] },
  { id: 'social-community',   label: 'Social Media & Community Building',  description: 'Organic social, community platforms, creator programmes',    icon: '📣', tags: ['social media', 'community', 'creator', 'linkedin', 'instagram'] },
  { id: 'cro',                label: 'Conversion Rate Optimisation',       description: 'Landing page testing, funnel analysis, copy, UX for conversion', icon: '📊', tags: ['cro', 'conversion', 'landing page', 'a/b testing', 'funnel'] },
  { id: 'ai-marketing',       label: 'AI for Marketing & Content',         description: 'AI copywriting, personalisation at scale, predictive segmentation', icon: '🤖', tags: ['ai marketing', 'ai copywriting', 'personalisation', 'predictive'] },

  // Finance-specific
  { id: 'fintech',            label: 'FinTech & Digital Finance',          description: 'Open banking, embedded finance, payment infrastructure, DeFi', icon: '🏦', tags: ['fintech', 'open banking', 'embedded finance', 'payments', 'defi'] },
  { id: 'corp-finance',       label: 'Corporate Finance & Capital Structure', description: 'WACC, capital allocation, debt/equity, treasury management', icon: '📑', tags: ['corporate finance', 'capital structure', 'wacc', 'treasury', 'equity'] },
  { id: 'esg',                label: 'Sustainable Finance & ESG',          description: 'ESG frameworks, sustainability reporting, green finance',    icon: '🌱', tags: ['esg', 'sustainability', 'green finance', 'impact investing', 'reporting'] },
  { id: 'financial-modeling', label: 'Financial Modelling & Forecasting',  description: '3-statement models, scenario analysis, driver-based planning', icon: '📉', tags: ['financial modelling', 'forecasting', 'scenario analysis', 'dcf', 'excel'] },

  // HR / People
  { id: 'talent',             label: 'Talent Acquisition & Employer Brand', description: 'Sourcing, structured interviewing, EVP, offer strategy',   icon: '🎯', tags: ['talent acquisition', 'recruiting', 'employer brand', 'evp', 'interviews'] },
  { id: 'learning-dev',       label: 'Learning & Development Strategy',    description: 'L&D programmes, skills taxonomy, upskilling, learning culture', icon: '📚', tags: ['learning development', 'l&d', 'upskilling', 'training', 'learning culture'] },
  { id: 'dei',                label: 'Diversity, Equity & Inclusion',      description: 'DEI frameworks, pay equity, belonging, inclusive leadership', icon: '🌈', tags: ['dei', 'diversity', 'equity', 'inclusion', 'belonging', 'pay equity'] },
  { id: 'hr-tech',            label: 'HR Technology & Systems',            description: 'HRIS, ATS, people analytics, HR automation, AI in HR',      icon: '🖥️', tags: ['hr tech', 'hris', 'ats', 'people analytics', 'hr automation'] },
]

export const DOMAIN_MAP = new Map(ALL_DOMAINS.map((d) => [d.id, d]))

// ─── ROLES ───────────────────────────────────────────────────────────────────

export interface Role {
  id: string
  label: string
  description: string
  primaryDomains: string[]   // domain IDs shown at top, in order
  otherDomains: string[]     // domain IDs shown in secondary section
}

export const ROLES: Role[] = [
  {
    id: 'ceo',
    label: 'CEO / MD / President',
    description: 'Chief Executive, Managing Director, or President',
    primaryDomains: ['ai-ml', 'leadership', 'digital-transformation', 'finance', 'data-decisions', 'innovation', 'risk'],
    otherDomains:  ['operations', 'people-org', 'ma', 'stakeholder', 'product-strategy', 'go-to-market', 'esg'],
  },
  {
    id: 'cto',
    label: 'CTO / VP Engineering',
    description: 'Chief Technology Officer or Head of Engineering',
    primaryDomains: ['ai-ml', 'devops', 'software-arch', 'cloud', 'cybersecurity', 'engineering-leadership', 'data-engineering'],
    otherDomains:  ['mlops', 'emerging-tech', 'testing', 'databases', 'open-source', 'leadership', 'stakeholder'],
  },
  {
    id: 'coo',
    label: 'COO / VP Operations',
    description: 'Chief Operating Officer or Head of Operations',
    primaryDomains: ['operations', 'ai-ml', 'digital-transformation', 'data-decisions', 'leadership', 'finance', 'risk'],
    otherDomains:  ['people-org', 'agile', 'stakeholder', 'innovation', 'product-strategy', 'bi-analytics', 'ma'],
  },
  {
    id: 'cfo',
    label: 'CFO / VP Finance',
    description: 'Chief Financial Officer or Head of Finance',
    primaryDomains: ['ai-ml', 'finance', 'financial-modeling', 'corp-finance', 'data-decisions', 'risk', 'bi-analytics'],
    otherDomains:  ['fintech', 'esg', 'ma', 'leadership', 'digital-transformation', 'operations', 'stakeholder'],
  },
  {
    id: 'product-manager',
    label: 'Product Manager / Owner',
    description: 'Product Manager, Product Owner, or Head of Product',
    primaryDomains: ['product-strategy', 'agile', 'ai-ml', 'user-research', 'data-decisions', 'growth', 'go-to-market'],
    otherDomains:  ['stakeholder', 'bi-analytics', 'frontend', 'design-systems', 'crm-automation', 'leadership', 'operations'],
  },
  {
    id: 'developer',
    label: 'Developer / Software Engineer',
    description: 'Software Engineer, Full-Stack Developer, or Architect',
    primaryDomains: ['ai-ml', 'frontend', 'typescript', 'devops', 'backend', 'cloud', 'software-arch'],
    otherDomains:  ['testing', 'databases', 'cybersecurity', 'data-engineering', 'mlops', 'open-source', 'system-design', 'nlp'],
  },
  {
    id: 'data-scientist',
    label: 'Data Scientist / ML Engineer',
    description: 'Data Scientist, ML Engineer, or Research Scientist',
    primaryDomains: ['ai-ml', 'ml-fundamentals', 'deep-learning', 'nlp', 'python', 'data-engineering', 'mlops'],
    otherDomains:  ['statistics', 'data-viz', 'bi-analytics', 'cloud', 'databases', 'frontend', 'bi-analytics'],
  },
  {
    id: 'data-analyst',
    label: 'Data / Business Analyst',
    description: 'Data Analyst, Business Analyst, or BI Developer',
    primaryDomains: ['bi-analytics', 'statistics', 'data-viz', 'sql', 'python', 'ai-ml', 'data-engineering'],
    otherDomains:  ['product-strategy', 'data-decisions', 'crm-automation', 'financial-modeling', 'agile', 'user-research'],
  },
  {
    id: 'designer',
    label: 'Designer / UX Lead',
    description: 'Product Designer, UX Designer, or Head of Design',
    primaryDomains: ['ux-design', 'design-systems', 'interaction-design', 'user-research', 'ai-for-design', 'accessibility', 'motion-design'],
    otherDomains:  ['product-strategy', 'agile', 'frontend', 'brand', 'ai-ml', 'growth', 'stakeholder'],
  },
  {
    id: 'marketing',
    label: 'Marketing / Growth Lead',
    description: 'CMO, Marketing Manager, or Growth Lead',
    primaryDomains: ['ai-marketing', 'growth', 'content-seo', 'performance-mktg', 'brand', 'bi-analytics', 'crm-automation'],
    otherDomains:  ['social-community', 'cro', 'go-to-market', 'product-strategy', 'user-research', 'data-decisions', 'fintech'],
  },
  {
    id: 'hr',
    label: 'HR / People Lead',
    description: 'CHRO, HR Director, or Head of People',
    primaryDomains: ['ai-ml', 'people-org', 'talent', 'learning-dev', 'dei', 'hr-tech', 'leadership'],
    otherDomains:  ['data-decisions', 'bi-analytics', 'operations', 'digital-transformation', 'stakeholder', 'risk', 'finance'],
  },
  {
    id: 'director',
    label: 'VP / SVP / Director',
    description: 'Senior leader managing teams and business outcomes',
    primaryDomains: ['leadership', 'ai-ml', 'data-decisions', 'digital-transformation', 'stakeholder', 'operations', 'people-org'],
    otherDomains:  ['finance', 'product-strategy', 'agile', 'risk', 'innovation', 'brand', 'bi-analytics'],
  },
]

export const ROLE_MAP = new Map(ROLES.map((r) => [r.id, r]))

// ─── HELPERS ─────────────────────────────────────────────────────────────────

/**
 * Returns an ordered domain list for a given role —
 * primary domains first, then secondary, de-duped.
 */
export function getDomainsForRole(roleId: string): Domain[] {
  const role = ROLE_MAP.get(roleId)
  if (!role) return ALL_DOMAINS.slice(0, 8)

  const ordered = [...role.primaryDomains, ...role.otherDomains]
  return ordered
    .map((id) => DOMAIN_MAP.get(id))
    .filter((d): d is Domain => Boolean(d))
}

/**
 * Search domains by keyword — used for the free-text custom domain input.
 */
export function searchDomains(query: string): Domain[] {
  const q = query.toLowerCase()
  return ALL_DOMAINS.filter(
    (d) =>
      d.label.toLowerCase().includes(q) ||
      d.description.toLowerCase().includes(q) ||
      d.tags.some((t) => t.includes(q))
  )
}

/**
 * Builds a deterministic profile cache key from role + domain + proficiency.
 * e.g. "developer__ai-ml__intermediate"
 */
export function buildProfileKey(role: string, domain: string, proficiency: string): string {
  return [role, domain, proficiency]
    .map((s) => s.toLowerCase().trim().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-'))
    .join('__')
}
