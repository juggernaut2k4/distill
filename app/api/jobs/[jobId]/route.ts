/**
 * GET /api/jobs/:jobId
 * Polls the status of an async LLM job.
 *
 * Returns:
 *   { status: 'queued' | 'running' | 'complete' | 'failed', progress: number, result?: object, error?: string }
 *
 * Clients should poll every 2–3 seconds until status is 'complete' or 'failed'.
 *
 * Example:
 *   GET /api/jobs/550e8400-e29b-41d4-a716-446655440000
 */

import { NextRequest, NextResponse } from 'next/server'
import { requireSessionAuth } from '@/lib/session-auth'
import { createSupabaseAdminClient } from '@/lib/supabase'

interface Params { params: { jobId: string } }

export async function GET(request: NextRequest, { params }: Params) {
  const { userId, error } = await requireSessionAuth(request)
  if (error) return error

  const supabase = createSupabaseAdminClient()

  const { data: job } = await supabase
    .from('async_jobs')
    .select('id, type, status, progress, result, error_message, created_at, updated_at, completed_at')
    .eq('id', params.jobId)
    .eq('user_id', userId)
    .maybeSingle()

  if (!job) {
    return NextResponse.json({ error: 'Job not found' }, { status: 404 })
  }

  return NextResponse.json({
    jobId: job.id,
    type: job.type,
    status: job.status,
    progress: Number(job.progress),
    result: job.result ?? null,
    error: job.error_message ?? null,
    createdAt: job.created_at,
    updatedAt: job.updated_at,
    completedAt: job.completed_at ?? null,
  })
}
