/**
 * B2B-05 — Domain / White-label Infrastructure (Requirement Doc Section 6,
 * architecture.md §14.2). Single source of truth for the reserved
 * subdomain-slug list — never invented ad hoc per-call.
 */

export const RESERVED_SUBDOMAIN_SLUGS = [
  'www', 'api', 'app', 'admin', 'dashboard', 'sign-in', 'sign-up', 'pricing', 'onboarding', 'plan',
  'checkout', 'topics', 'walkthrough', 'partner-render', 'partner-questionnaire', 'questionnaire',
  'mail', 'ftp', 'staging', 'dev', 'test', 'docs', 'status', 'blog', 'cdn', 'static', 'assets',
  'help', 'support', 'clio', 'vercel',
] as const

/**
 * Subdomain-slug format validation (Requirement Doc Section 4.B.3): lowercase
 * `a-z0-9-`, 3–63 chars, not starting/ending with `-`.
 */
const SLUG_FORMAT = /^[a-z0-9]([a-z0-9-]{1,61})?[a-z0-9]$/

export function isValidSlugFormat(slug: string): boolean {
  if (slug.length < 3 || slug.length > 63) return false
  return SLUG_FORMAT.test(slug)
}

export function isReservedSlug(slug: string): boolean {
  return (RESERVED_SUBDOMAIN_SLUGS as readonly string[]).includes(slug)
}

/**
 * Auto-suggested slug derived from a partner account's display name
 * (Requirement Doc Section 4.A, Screen state 1): lowercased, non-alphanumeric
 * stripped to hyphens, truncated to 63 chars. Purely a UI pre-fill
 * convenience — never authoritative, the partner-admin can freely edit it.
 */
export function suggestSlugFromName(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 63)
  return slug
}

/**
 * Custom-domain hostname validation (Requirement Doc Section 4.B.4):
 * syntactically valid hostname, lowercase, no protocol, no path, no port, no
 * trailing dot.
 */
const HOSTNAME_FORMAT = /^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/

export function isValidCustomDomainFormat(domain: string): boolean {
  if (domain.length > 253) return false
  if (domain.includes('/') || domain.includes(':') || domain.includes('@')) return false
  return HOSTNAME_FORMAT.test(domain)
}

/**
 * True if `domain` is Clio's own root domain or any `*.{root_domain}` value
 * — a partner can never register Clio's own domain space as their "custom"
 * domain (Requirement Doc Section 4.B.4/9).
 */
export function isClioOwnedDomainSpace(domain: string, rootDomain: string): boolean {
  if (!rootDomain) return false
  return domain === rootDomain || domain.endsWith(`.${rootDomain}`)
}
