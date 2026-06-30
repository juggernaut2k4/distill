import { inngest } from './client'
import { createSupabaseAdminClient } from '@/lib/supabase'
import { clerkClient } from '@clerk/nextjs/server'

export const abandonedOnboardingCleanup = inngest.createFunction(
  {
    id: 'abandoned-onboarding-cleanup',
    name: 'Abandoned Onboarding Cleanup',
    triggers: [{ event: 'clio/user.created' }],
    cancelOn: [{ event: 'clio/onboarding.completed', match: 'data.userId' }],
    concurrency: { key: 'event.data.userId', limit: 1 },
    retries: 2,
  },
  async ({ event, step }: { event: { data: { userId: string; email: string; createdAt: string } }; step: { sleep: (id: string, duration: string) => Promise<void>; run: <T>(id: string, fn: () => Promise<T>) => Promise<T> } }) => {
    await step.sleep('wait-for-payment', '75m')

    await step.run('check-and-delete', async () => {
      const { userId, email } = event.data
      const supabase = createSupabaseAdminClient()

      const { data: user } = await supabase
        .from('users')
        .select('id, subscription_status, stripe_customer_id, created_at, email')
        .eq('id', userId)
        .maybeSingle()

      if (!user) {
        console.log(`[onboarding-cleanup] User ${userId} already deleted — skipping`)
        return
      }

      const createdAt = new Date(user.created_at as string)
      const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000)

      if (
        user.subscription_status !== 'inactive' ||
        user.stripe_customer_id !== null ||
        createdAt < twoHoursAgo
      ) {
        console.log(`[onboarding-cleanup] User ${userId} has active or converted subscription — skipping`)
        return
      }

      // Delete Supabase row — ON DELETE CASCADE handles all child tables
      const { error: dbError } = await supabase
        .from('users')
        .delete()
        .eq('id', userId)

      if (dbError) {
        console.error(`[onboarding-cleanup] Supabase delete failed for ${userId}: ${dbError.message}`)
        throw new Error(dbError.message)
      }

      // Delete Clerk account — revokes all active sessions automatically
      try {
        await clerkClient.users.deleteUser(userId)
      } catch (err) {
        // Supabase row is already gone. On retry, the maybeSingle() above returns null → skips.
        console.error(`[onboarding-cleanup] Clerk delete failed for ${userId}: ${(err as Error).message}`)
        throw err
      }

      console.log(`[onboarding-cleanup] Deleted ghost user ${userId} (${email ?? (user.email as string)}) at T+75m`)
    })
  },
)
