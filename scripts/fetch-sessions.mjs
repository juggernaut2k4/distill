// Temporary script — fetch all sessions + curriculum plan for CEO review
// Run with: node scripts/fetch-sessions.mjs
import { readFileSync } from 'fs'
import { resolve } from 'path'

function loadEnv(file) {
  try {
    const lines = readFileSync(resolve(process.cwd(), file), 'utf8').split('\n')
    const out = {}
    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith('#')) continue
      const eq = trimmed.indexOf('=')
      if (eq < 1) continue
      const k = trimmed.slice(0, eq).trim()
      let v = trimmed.slice(eq + 1).trim()
      // strip surrounding quotes
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
        v = v.slice(1, -1)
      }
      out[k] = v
    }
    return out
  } catch { return {} }
}

const env = loadEnv('.env.local')
const URL  = env['NEXT_PUBLIC_SUPABASE_URL'] || process.env.NEXT_PUBLIC_SUPABASE_URL
const KEY  = env['SUPABASE_SERVICE_ROLE_KEY'] || process.env.SUPABASE_SERVICE_ROLE_KEY

if (!URL || !KEY) {
  console.error('URL length:', URL?.length, '| KEY length:', KEY?.length)
  // Print raw lines from file for these keys
  try {
    const raw = readFileSync(resolve(process.cwd(), '.env.local'), 'utf8')
    for (const line of raw.split('\n')) {
      if (line.startsWith('NEXT_PUBLIC_SUPABASE_URL') || line.startsWith('SUPABASE_SERVICE_ROLE_KEY')) {
        console.error('RAW:', JSON.stringify(line.slice(0, 80)))
      }
    }
  } catch(e) { console.error(e.message) }
  process.exit(1)
}
const USER = 'user_3FZR9g8JINjjgdk1AQ2sobbWAaf'

const h = { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' }

const [sessRes, planRes] = await Promise.all([
  fetch(`${URL}/rest/v1/sessions?select=session_index,session_title,status,content_status,curriculum_session_id,sub_sessions&user_id=eq.${USER}&not.status=in.(cancelled)&order=session_index.asc`, { headers: h }),
  fetch(`${URL}/rest/v1/curriculum_plans?select=visible_sessions,generated_at&user_id=eq.${USER}&is_approved=eq.true&order=generated_at.desc&limit=1`, { headers: h }),
])

const sessions = await sessRes.json()
const plans    = await planRes.json()
const plan     = plans?.[0]

console.log('\n═══════════════════════════════════════════════════════')
console.log(' SESSION TITLES (ordered by session_index)')
console.log('═══════════════════════════════════════════════════════\n')

sessions.forEach(s => {
  const icon = s.content_status === 'ready' ? '✅' : s.content_status === 'generating' ? '⏳' : '○'
  console.log(`${icon}  S${s.session_index}. ${s.session_title}`)
  if (s.sub_sessions?.length) {
    s.sub_sessions.forEach((sub, i) => console.log(`      ${i+1}. ${sub.title}`))
  }
  console.log()
})

console.log('\n═══════════════════════════════════════════════════════')
console.log(' CURRICULUM PLAN — visible_sessions (original order)')
console.log('═══════════════════════════════════════════════════════\n')

const vs = plan?.visible_sessions ?? []
vs.forEach((v, i) => {
  console.log(`${i+1}. [${v.arc_name ?? v.arc_type ?? '?'}] ${v.title}`)
  console.log(`   Focus: ${v.focus}`)
  console.log(`   Depth: ${v.depth_level}  |  Est: ${v.estimated_minutes}min`)
  if (v.subtopics?.length) v.subtopics.forEach(st => console.log(`   • ${st}`))
  console.log()
})
