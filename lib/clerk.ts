import { auth, currentUser as clerkCurrentUser } from '@clerk/nextjs/server'
import { NextResponse } from 'next/server'

/**
 * Gets the current user from Clerk with full user object.
 * For use in Server Components and API Routes.
 */
export async function getCurrentUser() {
  const user = await clerkCurrentUser()
  return user
}

/**
 * Gets the authenticated user ID from the current Clerk session.
 * Returns null if not authenticated.
 */
export function getUserId(): string | null {
  const { userId } = auth()
  return userId
}

/**
 * Middleware helper that returns a 401 response if the user is not authenticated.
 * Use at the top of protected API route handlers.
 * @returns { userId, error } — either userId is set or error is a NextResponse 401
 */
export function requireAuth(): { userId: string; error: null } | { userId: null; error: NextResponse } {
  const { userId } = auth()
  if (!userId) {
    return {
      userId: null,
      error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }),
    }
  }
  return { userId, error: null }
}
