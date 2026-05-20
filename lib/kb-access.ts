/**
 * Knowledge Base access control.
 *
 * Currently open to all authenticated users (KB_ADMIN_ONLY not set).
 * At go-live: set KB_ADMIN_ONLY=true and KB_ADMIN_EMAIL=your@email.com
 * to restrict the KB to that email only — all other users get 403.
 */

export function isKBEnabled(): boolean {
  // If KB_ENABLED is explicitly set to 'false', disable entirely
  if (process.env.KB_ENABLED === 'false') return false
  return true
}

export function isKBAdminOnly(): boolean {
  return process.env.KB_ADMIN_ONLY === 'true'
}

export function getKBAdminEmail(): string | undefined {
  return process.env.KB_ADMIN_EMAIL
}

/**
 * Returns true if the given userEmail is allowed to access the KB.
 * When KB_ADMIN_ONLY=false (default), everyone passes.
 * When KB_ADMIN_ONLY=true, only KB_ADMIN_EMAIL passes.
 */
export function canAccessKB(userEmail?: string | null): boolean {
  if (!isKBEnabled()) return false
  if (!isKBAdminOnly()) return true
  const adminEmail = getKBAdminEmail()
  if (!adminEmail) return false
  return userEmail === adminEmail
}
