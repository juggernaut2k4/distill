import { NextResponse } from 'next/server'
import { requireAuth } from '@/lib/clerk'
import { createSupabaseAdminClient } from '@/lib/supabase'
import { ROLES } from '@/lib/learning/taxonomy'

interface TopicRow {
  id: string
  title: string
  description: string
  domain_id: string
  relevant_roles: string[]
  relevant_maturity: string[]
  tags: string[]
}

/**
 * GET /api/topics/catalog
 *
 * Returns topics from topic_catalog that are relevant to the authenticated user's
 * role and selected domains. Ordered so the user's primary domain appears first.
 *
 * Response: { topics: TopicRow[], role: string, domains: string[] }
 */
export async function GET() {
  const { userId, error } = requireAuth()
  if (error) return error

  const supabase = createSupabaseAdminClient()

  // Fetch user profile fields needed for filtering
  const { data: user } = await supabase
    .from('users')
    .select('role, domains, primary_domain, domain_proficiency')
    .eq('id', userId!)
    .single()

  const userRole = user?.role ?? null
  const userDomains: string[] = Array.isArray(user?.domains) && user.domains.length > 0
    ? user.domains
    : []
  const primaryDomain = user?.primary_domain ?? userDomains[0] ?? null

  // If we have nothing to filter on, expand the role-based fallback
  // by pulling primary domains from the role definition
  let expandedDomains = userDomains
  if (expandedDomains.length === 0 && userRole) {
    const roleDef = ROLES.find((r) => r.id === userRole)
    if (roleDef) {
      expandedDomains = roleDef.primaryDomains.slice(0, 6)
    }
  }

  // Build the OR filter:
  //   - topics where user's role is in relevant_roles
  //   - OR topics where domain_id matches user's selected domains
  //
  // Supabase JS doesn't support OR with overlaps() directly, so we use two queries
  // and merge client-side.
  const [roleResult, domainResult] = await Promise.all([
    userRole
      ? supabase
          .from('topic_catalog')
          .select('id, title, description, domain_id, relevant_roles, relevant_maturity, tags')
          .contains('relevant_roles', [userRole])
          .eq('is_custom', false)
          .limit(120)
      : { data: [] as TopicRow[], error: null },

    expandedDomains.length > 0
      ? supabase
          .from('topic_catalog')
          .select('id, title, description, domain_id, relevant_roles, relevant_maturity, tags')
          .in('domain_id', expandedDomains)
          .eq('is_custom', false)
          .limit(120)
      : { data: [] as TopicRow[], error: null },
  ])

  const seen = new Set<string>()
  const merged: TopicRow[] = []

  // Domain results first (more targeted to user's explicit selections)
  for (const row of ((domainResult.data ?? []) as TopicRow[])) {
    if (!seen.has(row.id)) {
      seen.add(row.id)
      merged.push(row)
    }
  }
  // Then role-based results (broader relevance)
  for (const row of ((roleResult.data ?? []) as TopicRow[])) {
    if (!seen.has(row.id)) {
      seen.add(row.id)
      merged.push(row)
    }
  }

  // Sort: primary domain first, then rest of user's domains, then by domain_id alphabetically
  merged.sort((a, b) => {
    const aPrimary = a.domain_id === primaryDomain ? 0 : 1
    const bPrimary = b.domain_id === primaryDomain ? 0 : 1
    if (aPrimary !== bPrimary) return aPrimary - bPrimary

    const aUserDomain = expandedDomains.indexOf(a.domain_id)
    const bUserDomain = expandedDomains.indexOf(b.domain_id)
    const aIdx = aUserDomain === -1 ? 999 : aUserDomain
    const bIdx = bUserDomain === -1 ? 999 : bUserDomain
    if (aIdx !== bIdx) return aIdx - bIdx

    return a.domain_id.localeCompare(b.domain_id)
  })

  // If catalog is empty (not yet seeded), return empty so topics page falls back
  if (merged.length === 0) {
    console.log(`[topics/catalog] No catalog topics found for user=${userId} role=${userRole}`)
    return NextResponse.json({ topics: [], role: userRole, domains: expandedDomains, seeded: false })
  }

  return NextResponse.json({
    topics: merged,
    role: userRole,
    domains: expandedDomains,
    seeded: true,
  })
}
