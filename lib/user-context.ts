/**
 * Manages per-user session context stored in Supabase.
 * Tracks personality notes, sentiment history, and unresolved questions.
 */

import { createSupabaseAdminClient } from '@/lib/supabase'

export interface UserSessionContext {
  userId: string
  personalityNotes: string
  sentimentHistory: Array<{ date: string; sentiment: string; session: string }>
  unresolvedQuestions: Array<{ question: string; sessionId: string; addedAt: string }>
  communicationStyle: 'formal' | 'casual' | 'direct'
  engagementLevel: 'high' | 'medium' | 'low'
  keyConcerns: string[]
}

interface DbRow {
  user_id: string
  personality_notes: string
  sentiment_history: UserSessionContext['sentimentHistory']
  unresolved_questions: UserSessionContext['unresolvedQuestions']
  communication_style: UserSessionContext['communicationStyle']
  engagement_level: UserSessionContext['engagementLevel']
  key_concerns: string[]
}

function rowToContext(row: DbRow): UserSessionContext {
  return {
    userId: row.user_id,
    personalityNotes: row.personality_notes,
    sentimentHistory: row.sentiment_history ?? [],
    unresolvedQuestions: row.unresolved_questions ?? [],
    communicationStyle: row.communication_style,
    engagementLevel: row.engagement_level,
    keyConcerns: row.key_concerns ?? [],
  }
}

/**
 * Fetches the user's session context, creating a default record if none exists.
 */
export async function getOrCreateContext(userId: string): Promise<UserSessionContext> {
  const supabase = createSupabaseAdminClient()

  const { data: existing } = await supabase
    .from('user_session_context')
    .select('*')
    .eq('user_id', userId)
    .single()

  if (existing) return rowToContext(existing as DbRow)

  const defaults: Omit<DbRow, 'user_id'> = {
    personality_notes: '',
    sentiment_history: [],
    unresolved_questions: [],
    communication_style: 'formal',
    engagement_level: 'medium',
    key_concerns: [],
  }

  const { data: created, error } = await supabase
    .from('user_session_context')
    .insert({ user_id: userId, ...defaults })
    .select()
    .single()

  if (error || !created) {
    // Return in-memory defaults on insert failure (e.g. DB not migrated yet)
    return {
      userId,
      personalityNotes: '',
      sentimentHistory: [],
      unresolvedQuestions: [],
      communicationStyle: 'formal',
      engagementLevel: 'medium',
      keyConcerns: [],
    }
  }

  return rowToContext(created as DbRow)
}

/**
 * Appends a sentiment entry to the user's history for a given session.
 */
export async function updateSentiment(
  userId: string,
  sentiment: string,
  sessionId: string
): Promise<void> {
  const supabase = createSupabaseAdminClient()
  const ctx = await getOrCreateContext(userId)

  const newEntry = { date: new Date().toISOString(), sentiment, session: sessionId }
  // Keep last 50 entries
  const updated = [...ctx.sentimentHistory, newEntry].slice(-50)

  await supabase
    .from('user_session_context')
    .update({ sentiment_history: updated })
    .eq('user_id', userId)
}

/**
 * Adds a question that couldn't be answered in the current session to the backlog.
 */
export async function addUnresolvedQuestion(
  userId: string,
  question: string,
  sessionId: string
): Promise<void> {
  const supabase = createSupabaseAdminClient()
  const ctx = await getOrCreateContext(userId)

  const newEntry = { question, sessionId, addedAt: new Date().toISOString() }
  const updated = [...ctx.unresolvedQuestions, newEntry]

  await supabase
    .from('user_session_context')
    .update({ unresolved_questions: updated })
    .eq('user_id', userId)
}

/**
 * Removes a resolved question from the user's unresolved list.
 */
export async function resolveQuestion(userId: string, question: string): Promise<void> {
  const supabase = createSupabaseAdminClient()
  const ctx = await getOrCreateContext(userId)

  const updated = ctx.unresolvedQuestions.filter((q) => q.question !== question)

  await supabase
    .from('user_session_context')
    .update({ unresolved_questions: updated })
    .eq('user_id', userId)
}

/**
 * Updates the personality and communication notes for this user.
 */
export async function updatePersonalityNotes(userId: string, notes: string): Promise<void> {
  const supabase = createSupabaseAdminClient()

  await supabase
    .from('user_session_context')
    .upsert({ user_id: userId, personality_notes: notes })
    .eq('user_id', userId)
}

/**
 * Deletes all session context for a user (called on account deletion).
 */
export async function deleteContext(userId: string): Promise<void> {
  const supabase = createSupabaseAdminClient()

  await supabase.from('user_session_context').delete().eq('user_id', userId)
  await supabase.from('walkthrough_state').delete().eq('user_id', userId)
}
