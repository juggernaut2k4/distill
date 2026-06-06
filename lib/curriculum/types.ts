export type ArcPosition = 'foundation' | 'interest' | 'context' | 'deploy' | 'govern'
export type Maturity = 'beginner' | 'intermediate' | 'advanced' | 'expert'

export interface UserProfile {
  role: string
  industry: string
  maturity: Maturity
  roleLevel: string  // 'c-suite' | 'vp-dir' | 'manager' | 'specialist'
  interest?: string // optional free text (last resort)
}

export interface CurriculumSpec {
  role: string
  industry: string
  maturity: Maturity
  interest: string
  roleLevel: string  // 'c-suite' | 'vp-dir' | 'manager' | 'specialist'
  isNamedProduct: boolean
  productName: string | null
  requiredFoundation: SpecItem[]
  requiredInterest: SpecItem[]
  requiredContext: SpecItem[]
  requiredDeploy: SpecItem[]
  requiredGovern: SpecItem[]
  totalTarget: number
}

export interface SpecItem {
  type: string
  reason: string
  product?: string
  industry?: string
  role?: string
}

export interface CurriculumSession {
  position: number
  title: string
  arc_position: ArcPosition
  justification: string
  estimated_minutes: number
}

export interface CurriculumResult {
  sessions: CurriculumSession[]
  tier4: Array<{ title: string; unlocks_after: number }>
  meta: {
    role: string
    industry: string
    maturity: string
    interest: string
    total_sessions: number
    total_minutes: number
  }
}

export interface ValidationResult {
  valid: boolean
  errors: string[]
}
