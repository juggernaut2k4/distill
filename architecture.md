# Distill: Technical Architecture

**Version:** 1.0
**Created:** 2026-05-01
**Last Updated:** 2026-05-01
**Owner:** Architecture Agent

This document is the permanent technical reference for the Distill platform. All implementation agents must reference this for database schema, API routes, content taxonomy, and system integration details.

---

## Table of Contents

1. [Database Schema Summary](#1-database-schema-summary)
2. [API Route Map](#2-api-route-map)
3. [Content Tagging Taxonomy](#3-content-tagging-taxonomy)
4. [Inngest Job Definitions](#4-inngest-job-definitions)
5. [Twilio Strategy](#5-twilio-strategy)
6. [Stripe Product Structure](#6-stripe-product-structure)
7. [Data Flow Diagrams](#7-data-flow-diagrams)
8. [Environment Variables Reference](#8-environment-variables-reference)

---

## 1. Database Schema Summary

**Schema Location:** `/Users/arunprakash/Documents/claudeWS/distill/distill/supabase/migrations/001_initial.sql`

All tables include:
- Row Level Security (RLS) policies for user data isolation
- `updated_at` triggers for automatic timestamp management
- Proper foreign key constraints
- Optimized indexes on frequently queried columns

### 1.1 users

**Purpose:** Store user profiles, subscription status, delivery preferences, and AI readiness metrics.

**Key Columns:**
- `id` (TEXT, PK): Clerk user ID
- `email` (TEXT): User email address
- `phone` (TEXT): Phone number for SMS delivery (E.164 format)
- `role` (TEXT): User's job role (CEO, VP, CU Lead, etc.)
- `industry` (TEXT): User's industry sector
- `ai_maturity` (TEXT): Current AI involvement level (observer | evaluator | pilot | scaler)
- `worry_tags` (TEXT[]): Array of user's AI concerns
- `plan_tier` (TEXT): Subscription plan (free | starter | pro | executive)
- `stripe_customer_id` (TEXT): Stripe customer ID
- `stripe_subscription_id` (TEXT): Stripe subscription ID
- `subscription_status` (TEXT): active | canceled | past_due | trialing
- `delivery_preference` (TEXT): email | sms | both
- `twilio_number_assigned` (TEXT): Assigned Twilio phone number
- `timezone` (TEXT): User timezone for delivery scheduling
- `delivery_paused` (BOOLEAN): Whether delivery is temporarily paused
- `needs_recalibration` (BOOLEAN): Flag for content personalization adjustment
- `ai_readiness_score` (INTEGER): 0-100 score showing AI literacy growth
- `streak_days` (INTEGER): Consecutive days of engagement

**Relationships:**
- Referenced by: delivery_log, user_learning_plans, sms_conversations, feedback_weights

**Indexes:**
- email, phone, stripe_customer_id, plan_tier, subscription_status

**RLS Policies:**
- Users can SELECT/UPDATE their own record only (using auth.uid() = id)
- service_role has full access

---

### 1.2 content_items

**Purpose:** Store all content (tips, signals, decoders, lenses, frameworks) with tagging for personalization.

**Key Columns:**
- `id` (UUID, PK): Unique content item ID
- `type` (TEXT): Content type (tip | signal | decoder | lens | framework)
- `body_text` (TEXT): The actual content (≤80 words)
- `role_tags` (TEXT[]): Relevant roles (role:ceo, role:vp, etc.)
- `industry_tags` (TEXT[]): Relevant industries (industry:finance, industry:healthcare, etc.)
- `maturity_tags` (TEXT[]): Relevant AI maturity levels (maturity:observer, etc.)
- `worry_tags` (TEXT[]): Relevant worry categories (worry:job_relevance, etc.)
- `source_url` (TEXT): Original source URL (for signals from NewsAPI)
- `generated_by` (TEXT): claude | curated | newsapi

**Relationships:**
- Referenced by: delivery_log

**Indexes:**
- type, created_at DESC, source_url

**RLS Policies:**
- All authenticated users can SELECT
- service_role can INSERT/UPDATE/DELETE

---

### 1.3 delivery_log

**Purpose:** Track every content delivery, feedback, and engagement metrics.

**Key Columns:**
- `id` (UUID, PK): Unique delivery log ID
- `user_id` (TEXT, FK): References users(id)
- `content_item_id` (UUID, FK): References content_items(id)
- `channel` (TEXT): email | sms
- `sent_at` (TIMESTAMPTZ): When content was sent
- `opened_at` (TIMESTAMPTZ): When email was opened (nullable)
- `feedback` (TEXT): positive | negative | null

**Relationships:**
- Many-to-one with users
- Many-to-one with content_items

**Indexes:**
- user_id, sent_at DESC, (user_id, sent_at DESC) composite, content_item_id

**RLS Policies:**
- Users can SELECT their own logs only
- service_role has full access

**Usage:**
- Personalization engine uses this to avoid sending duplicates within 14 days
- Feedback processor uses this to calculate AI Readiness Score
- Recalibration logic checks last 10 deliveries for consecutive negative feedback

---

### 1.4 user_learning_plans

**Purpose:** Store generated learning paths and personalization state for each user.

**Key Columns:**
- `id` (UUID, PK): Unique plan ID
- `user_id` (TEXT, FK): References users(id)
- `generated_at` (TIMESTAMPTZ): When plan was created
- `plan_json` (JSONB): Full personalization plan object
- `active_track` (TEXT): Current content track
- `next_content_type` (TEXT): Next content type to deliver (for rotation)
- `cadence_days` (INTEGER): Delivery frequency (default: 1 = daily)

**Relationships:**
- Many-to-one with users

**Indexes:**
- user_id, generated_at DESC

**RLS Policies:**
- Users can SELECT their own plans only
- service_role has full access

---

### 1.5 sms_conversations

**Purpose:** Log all SMS interactions (outbound content, inbound feedback/questions, Ask Anything).

**Key Columns:**
- `id` (UUID, PK): Unique conversation log ID
- `user_id` (TEXT, FK): References users(id)
- `twilio_number` (TEXT): The Twilio number used for this conversation
- `direction` (TEXT): in | out
- `body` (TEXT): SMS message body
- `intent` (TEXT): feedback | question | command
- `received_at` (TIMESTAMPTZ): For inbound messages
- `sent_at` (TIMESTAMPTZ): For outbound messages

**Relationships:**
- Many-to-one with users

**Indexes:**
- user_id, created_at DESC

**RLS Policies:**
- Users can SELECT their own conversations only
- service_role has full access

**Usage:**
- Ask Anything feature logs questions and answers here
- Feedback SMS logged here before updating delivery_log
- Command handling (STOP, PAUSE, RESUME) logged here

---

### 1.6 feedback_weights

**Purpose:** Store learned tag preferences based on user feedback for adaptive personalization.

**Key Columns:**
- `id` (UUID, PK): Unique weight ID
- `user_id` (TEXT, FK): References users(id)
- `tag` (TEXT): The tag name (e.g., "role:ceo", "industry:finance")
- `weight` (FLOAT): Positive weight = preference, negative = dislike
- `UNIQUE(user_id, tag)`: Each user has one weight per tag

**Relationships:**
- Many-to-one with users

**Indexes:**
- user_id

**RLS Policies:**
- Users can SELECT their own weights only
- service_role has full access

**Helper Function:**
```sql
increment_feedback_weight(p_user_id TEXT, p_tag TEXT, p_delta FLOAT)
```
Upserts feedback weight: adds p_delta to existing weight or creates new entry.

**Usage:**
- After positive feedback (Y): increment weight by +1 for all tags in content item
- After negative feedback (N): increment weight by -0.5 for all tags in content item
- Personalization engine uses these weights to boost/demote content matching specific tags

---

## 2. API Route Map

All API routes are located in `/app/api/`. All routes return JSON unless otherwise noted.

### 2.1 POST /api/onboarding

**Purpose:** Process onboarding responses and create user profile.

**Auth:** Clerk (required)

**Zod Request Schema:**
```typescript
const onboardingSchema = z.object({
  role: z.enum([
    'ceo',
    'vp',
    'cu_lead',
    'bu_lead',
    'product_sponsor',
    'director',
    'other'
  ]),
  industry: z.enum([
    'technology',
    'financial_services',
    'healthcare',
    'retail',
    'manufacturing',
    'consulting',
    'other'
  ]),
  aiMaturity: z.enum(['observer', 'evaluator', 'pilot', 'scaler']),
  worry: z.enum([
    'job_relevance',
    'roi_clarity',
    'vendor_evaluation',
    'team_upskilling',
    'competitive_pressure'
  ]),
  deliveryPreference: z.enum(['email', 'sms', 'both']),
  timezone: z.string().optional(), // IANA timezone string
})
```

**Response Shape:**
```typescript
{
  success: boolean
  userId: string
  planPreview?: {
    nextContentType: string
    estimatedFirstDelivery: string
  }
  error?: string
}
```

**Error Codes:**
- 401: Unauthorized (no Clerk session)
- 400: Validation error (Zod)
- 500: Database error

**Logic:**
1. Validate Clerk session
2. Validate request body with Zod
3. Upsert users table with profile data
4. Call `getUserContentPlan(userId)` to generate initial learning plan
5. If plan is Pro/Executive and deliveryPreference includes SMS: assign Twilio number
6. Return success with plan preview

---

### 2.2 POST /api/feedback

**Purpose:** Process SMS feedback responses (Y/N) from Twilio webhook.

**Auth:** Twilio signature verification (required)

**Zod Request Schema:**
Twilio sends form-encoded data, parsed from URLSearchParams:
```typescript
const feedbackSchema = z.object({
  From: z.string(), // User phone number
  Body: z.string(), // "Y", "N", "yes", "no", etc.
  MessageSid: z.string(),
})
```

**Response Shape:**
TwiML XML response (not JSON):
```xml
<?xml version="1.0" encoding="UTF-8"?>
<Response></Response>
```

**Error Codes:**
- 403: Invalid Twilio signature
- 400: Missing required fields
- 200: Always return 200 on success (Twilio requirement)

**Logic:**
1. Verify Twilio webhook signature
2. Parse From number to identify user
3. Parse Body to classify as 'feedback_yes' or 'feedback_no'
4. Find most recent delivery_log entry for this user without feedback
5. Update delivery_log with feedback value and timestamp
6. Emit Inngest event: `distill/feedback.received` with { userId, deliveryLogId, feedback }
7. Return empty TwiML response (200 OK)

---

### 2.3 POST /api/ask

**Purpose:** Handle "Ask Anything" SMS questions via Twilio webhook.

**Auth:** Twilio signature verification (required)

**Zod Request Schema:**
```typescript
const askSchema = z.object({
  From: z.string(), // User phone number
  Body: z.string(), // Question text
  MessageSid: z.string(),
})
```

**Response Shape:**
TwiML XML response with reply message:
```xml
<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Message>Answer text here (≤160 chars)</Message>
</Response>
```

**Error Codes:**
- 403: Invalid Twilio signature
- 400: Missing Body
- 200: Always return 200 with TwiML

**Logic:**
1. Verify Twilio webhook signature
2. Identify user by From phone number
3. Extract question from Body
4. Call Anthropic API with executive advisor system prompt and question
5. Truncate answer to 160 characters
6. Log to sms_conversations table (direction='in' for question, direction='out' for answer)
7. Return TwiML with `<Message>` containing answer

---

### 2.4 POST /api/checkout

**Purpose:** Create Stripe Checkout session for subscription purchase.

**Auth:** Clerk (required)

**Zod Request Schema:**
```typescript
const checkoutSchema = z.object({
  plan: z.enum(['starter', 'pro', 'executive']),
  billingPeriod: z.enum(['monthly', 'annual']),
})
```

**Response Shape:**
```typescript
{
  checkoutUrl: string
  error?: string
}
```

**Error Codes:**
- 401: Unauthorized
- 400: Validation error
- 500: Stripe API error

**Logic:**
1. Validate Clerk session
2. Validate request body
3. Get Clerk user email
4. Map plan + billingPeriod to Stripe price ID
5. Call `stripe.checkout.sessions.create()` with:
   - trial_period_days: 7
   - success_url: /dashboard?welcome=1
   - cancel_url: /pricing
   - metadata: { clerk_user_id: userId }
6. Return checkoutUrl

---

### 2.5 POST /api/portal

**Purpose:** Create Stripe Customer Portal session for billing management.

**Auth:** Clerk (required)

**Zod Request Schema:**
None (POST body empty)

**Response Shape:**
```typescript
{
  portalUrl: string
  error?: string
}
```

**Error Codes:**
- 401: Unauthorized
- 400: No subscription found
- 500: Stripe API error

**Logic:**
1. Validate Clerk session
2. Fetch user record from users table
3. Get stripe_customer_id
4. Call `stripe.billingPortal.sessions.create()` with customer ID
5. Return portalUrl

---

### 2.6 POST /api/webhooks/stripe

**Purpose:** Handle Stripe subscription lifecycle webhook events.

**Auth:** Stripe webhook signature verification (required)

**Request:** Raw body (text) + stripe-signature header

**Response Shape:**
```typescript
{
  received: boolean
}
```

**Error Codes:**
- 400: Invalid signature
- 200: Always return 200 on valid signature (even if processing fails internally)

**Events Handled:**

#### customer.subscription.created
- Extract clerk_user_id from subscription.metadata
- Extract plan tier from price ID
- Upsert users table:
  - plan = starter | pro | executive
  - subscription_status = 'active' | 'trialing'
  - stripe_customer_id = subscription.customer
  - stripe_subscription_id = subscription.id
  - current_period_end = subscription.current_period_end

#### customer.subscription.updated
- Same logic as created
- Handles plan upgrades/downgrades
- Updates subscription_status if changed

#### customer.subscription.deleted
- Set plan = 'free'
- Set subscription_status = 'canceled'
- Set delivery_paused = true

#### invoice.payment_failed
- Call `sendPaymentFailedEmail(user)`
- Optionally: set subscription_status = 'past_due'

#### customer.subscription.trial_will_end
- Triggered 3 days before trial ends
- Call `sendTrialEndingEmail(user)`

**Logic:**
1. Parse raw body as text
2. Get stripe-signature header
3. Call `stripe.webhooks.constructEvent(body, signature, STRIPE_WEBHOOK_SECRET)`
4. Switch on event.type and process accordingly
5. Always return 200 (log errors, don't throw)

---

### 2.7 POST /api/webhooks/twilio

**Purpose:** Router for inbound SMS — routes to /api/feedback or /api/ask based on intent.

**Auth:** Twilio signature verification (required)

**Request:** Form-encoded body + x-twilio-signature header

**Response Shape:**
TwiML XML

**Error Codes:**
- 403: Invalid signature
- 200: Always return TwiML

**Logic:**
1. Verify Twilio signature
2. Parse form data (From, Body, etc.)
3. Call `parseInboundSMS(Body)` to classify intent
4. Route:
   - feedback_yes | feedback_no → call /api/feedback handler logic
   - question → call /api/ask handler logic
   - command (STOP, PAUSE) → handle internally, update users table
5. Return appropriate TwiML response

---

### 2.8 GET /api/inngest

**Purpose:** Serve Inngest functions for registration.

**Auth:** None (Inngest handles auth internally)

**Response:** Inngest function manifest (JSON)

---

### 2.9 POST /api/inngest

**Purpose:** Handle Inngest function execution requests.

**Auth:** Inngest signing key verification

**Response:** Inngest execution response

**Functions Registered:**
- dailyDelivery (cron)
- weeklyDigest (cron)
- feedbackProcessor (event)

---

### 2.10 PUT /api/inngest

**Purpose:** Handle Inngest function registration updates.

**Auth:** Inngest signing key verification

**Response:** Inngest registration response

---

## 3. Content Tagging Taxonomy

**Location:** `lib/content/taxonomy.ts`

All content items are tagged with multiple dimensions for precise personalization.

### 3.1 ROLES

```typescript
export const ROLES = [
  'ceo',           // CEO / MD / President
  'vp',            // VP / SVP / EVP
  'cu_lead',       // Capability Unit Lead / Practice Head
  'bu_lead',       // Business Unit Lead / Functional Head
  'product_sponsor', // Product Sponsor / Owner
  'director',      // Director / Senior Manager
  'other',         // Other roles
] as const

export type Role = typeof ROLES[number]
```

**Tag Format:** `role:ceo`, `role:vp`, etc.

**Wildcard:** Empty role_tags array = matches all roles

---

### 3.2 INDUSTRIES

```typescript
export const INDUSTRIES = [
  'technology',         // Technology / SaaS
  'financial_services', // Financial Services / Banking
  'healthcare',         // Healthcare / Life Sciences
  'retail',             // Retail / E-commerce
  'manufacturing',      // Manufacturing / Supply Chain
  'consulting',         // Consulting / Professional Services
  'other',              // Other industries
] as const

export type Industry = typeof INDUSTRIES[number]
```

**Tag Format:** `industry:technology`, `industry:healthcare`, etc.

**Wildcard:** Empty industry_tags array = matches all industries

---

### 3.3 MATURITY_LEVELS

```typescript
export const MATURITY_LEVELS = [
  'observer',   // Just observing from a distance
  'evaluator',  // Evaluating AI vendors / solutions
  'pilot',      // Running AI pilots in team
  'scaler',     // Scaling AI across organization
] as const

export type Maturity = typeof MATURITY_LEVELS[number]
```

**Tag Format:** `maturity:observer`, `maturity:pilot`, etc.

**Wildcard:** Empty maturity_tags array = matches all maturity levels

---

### 3.4 WORRY_TYPES

```typescript
export const WORRY_TYPES = [
  'job_relevance',       // My job relevance / security
  'roi_clarity',         // Knowing if AI investments deliver ROI
  'vendor_evaluation',   // How to evaluate AI vendors and technology
  'team_upskilling',     // Upskilling my team for AI
  'competitive_pressure', // Falling behind competitors
] as const

export type Worry = typeof WORRY_TYPES[number]
```

**Tag Format:** `worry:job_relevance`, `worry:roi_clarity`, etc.

**Wildcard:** Empty worry_tags array = matches all worry types

---

### 3.5 CONTENT_TYPES

```typescript
export const CONTENT_TYPES = [
  'tip',       // Daily Tip: Actionable insight
  'signal',    // Industry Signal: Significant AI development
  'decoder',   // Concept Decoder: AI term explained in business language
  'lens',      // Leader Lens: Peer executive case study
  'framework', // Evaluation Framework: Heuristics for decision-making
] as const

export type ContentType = typeof CONTENT_TYPES[number]
```

**Storage:** Stored in content_items.type column

**Rotation:** `getNextContentType()` ensures variety — tracks last N content types delivered to user and rotates

---

### 3.6 Matching Algorithm

**Function:** `matchContentToUser(userProfile, contentItems[])`

**Scoring Logic:**

1. **Exact Tag Match = 3 points**
   - If content has `role:ceo` and user.role = 'ceo' → +3 points

2. **Partial Match (Wildcard) = 1 point**
   - If content has empty role_tags array → matches all roles, +1 point

3. **Multi-Dimension Scoring:**
   - Score accumulates across all dimensions (role + industry + maturity + worry)
   - Example: Content tagged `role:ceo, industry:finance, maturity:pilot`
     - User: CEO in Finance, running pilots → 3 + 3 + 3 = 9 points
     - User: VP in Finance, running pilots → 1 + 3 + 3 = 7 points

4. **Ranking:**
   - Sort all content items by score descending
   - Filter out items sent in last 14 days
   - Return top-ranked item

5. **Feedback Weight Adjustment:**
   - After scoring, apply learned feedback weights
   - If user has positive weight for `industry:finance` (+2.5), add to score
   - If user has negative weight for `worry:job_relevance` (-1.5), subtract from score

**Type Definition:**
```typescript
interface UserProfile {
  role: Role
  industry: Industry
  aiMaturity: Maturity
  worry: Worry
}

interface ContentItem {
  id: string
  type: ContentType
  body_text: string
  role_tags: string[]
  industry_tags: string[]
  maturity_tags: string[]
  worry_tags: string[]
}

interface RankedContentItem extends ContentItem {
  score: number
}

function matchContentToUser(
  userProfile: UserProfile,
  contentItems: ContentItem[]
): RankedContentItem[]
```

---

## 4. Inngest Job Definitions

**Location:** `/inngest/`

All jobs use Inngest for reliable, retryable execution.

### 4.1 daily-delivery

**File:** `inngest/daily-delivery.ts`

**Trigger:** Cron schedule

**Cron:** `"0 7 * * *"` (7 AM UTC daily)

**Timezone Handling:**
- Cron fires at 7 AM UTC
- For timezone-specific delivery:
  - Option A: Run hourly, check which users are at 7 AM local time
  - Option B: Run at 7 AM UTC, adjust delivery time per user timezone (MVP: use Option B, send to all at same time initially)

**Retry Config:**
```typescript
{
  retries: 3,
  backoff: 'exponential'
}
```

**Step Definitions:**

#### Step 1: fetch-active-users
```typescript
await step.run('fetch-active-users', async () => {
  const supabase = await createClient()
  const { data } = await supabase
    .from('users')
    .select('*')
    .eq('subscription_status', 'active')
    .neq('plan', 'free')
    .eq('delivery_paused', false)

  return data || []
})
```

#### Step 2: process-batch-N (one per batch of 50 users)
```typescript
await step.run(`process-batch-${index}`, async () => {
  await Promise.allSettled(
    batch.map(async (user) => {
      // 1. Get personalized content
      const { emailContent, smsContent, contentItemId } = await getUserContentPlan(user.id)

      // 2. Send email if preference includes email
      if (user.delivery_preference.includes('email')) {
        await sendDailyEmail(user, emailContent)
      }

      // 3. Send SMS if preference includes SMS AND plan supports it
      if (
        user.delivery_preference.includes('sms') &&
        ['pro', 'executive'].includes(user.plan) &&
        user.phone
      ) {
        await sendDailySMS(user.id, user.phone, user.plan, smsContent)
      }

      // 4. Log delivery
      await supabase.from('delivery_log').insert({
        user_id: user.id,
        content_item_id: contentItemId,
        channel: user.delivery_preference,
        sent_at: new Date().toISOString(),
      })
    })
  )
})
```

**Error Handling:**
- Individual user delivery failures are caught and logged
- Batch continues processing even if one user fails
- Step-level retries ensure resilience

**Output:**
```typescript
{
  processed: number,
  batches: number,
}
```

---

### 4.2 weekly-digest

**File:** `inngest/weekly-digest.ts`

**Trigger:** Cron schedule

**Cron:** `"0 8 * * 0"` (Sundays 8 AM UTC)

**Retry Config:**
```typescript
{
  retries: 3,
  backoff: 'exponential'
}
```

**Step Definitions:**

#### Step 1: fetch-digest-users
```typescript
await step.run('fetch-digest-users', async () => {
  const supabase = await createClient()
  const { data } = await supabase
    .from('users')
    .select('*')
    .neq('plan', 'free')
    .eq('subscription_status', 'active')

  return data || []
})
```

#### Step 2: process-digest-batch-N
```typescript
await step.run(`process-digest-batch-${index}`, async () => {
  await Promise.allSettled(
    batch.map(async (user) => {
      // 1. Get top 5 content items from last 7 days (by positive feedback or recency)
      const items = await getTopContentForUser(user.id, 7, 5)

      // 2. Send weekly digest email
      await sendWeeklyDigest(user, items)

      // 3. Log delivery
      await supabase.from('delivery_log').insert({
        user_id: user.id,
        content_item_id: null, // Digest has multiple items
        channel: 'email',
        type: 'weekly_digest',
        sent_at: new Date().toISOString(),
      })
    })
  )
})
```

**Output:**
```typescript
{
  processed: number,
}
```

---

### 4.3 feedback-processor

**File:** `inngest/feedback-processor.ts`

**Trigger:** Event

**Event Name:** `"distill/feedback.received"`

**Event Data:**
```typescript
{
  userId: string,
  deliveryLogId: string,
  feedback: 'positive' | 'negative'
}
```

**Retry Config:**
```typescript
{
  retries: 3,
  backoff: 'exponential'
}
```

**Step Definitions:**

#### Step 1: update-delivery-log
```typescript
await step.run('update-delivery-log', async () => {
  const supabase = await createClient()
  await supabase
    .from('delivery_log')
    .update({
      feedback: event.data.feedback,
      feedback_at: new Date().toISOString(),
    })
    .eq('id', event.data.deliveryLogId)
})
```

#### Step 2: update-feedback-weights
```typescript
await step.run('update-feedback-weights', async () => {
  const supabase = await createClient()

  // Fetch content item tags
  const { data: log } = await supabase
    .from('delivery_log')
    .select('content_items(role_tags, industry_tags, maturity_tags, worry_tags)')
    .eq('id', event.data.deliveryLogId)
    .single()

  const allTags = [
    ...(log?.content_items?.role_tags || []),
    ...(log?.content_items?.industry_tags || []),
    ...(log?.content_items?.maturity_tags || []),
    ...(log?.content_items?.worry_tags || []),
  ]

  const weightChange = event.data.feedback === 'positive' ? 1 : -0.5

  for (const tag of allTags) {
    await supabase.rpc('increment_feedback_weight', {
      p_user_id: event.data.userId,
      p_tag: tag,
      p_delta: weightChange,
    })
  }
})
```

#### Step 3: check-recalibration
```typescript
await step.run('check-recalibration', async () => {
  const supabase = await createClient()

  // Get last 10 deliveries
  const { data: recentDeliveries } = await supabase
    .from('delivery_log')
    .select('feedback')
    .eq('user_id', event.data.userId)
    .order('sent_at', { ascending: false })
    .limit(10)

  // Check if last 5 are all negative
  const consecutiveNegative = recentDeliveries
    ?.slice(0, 5)
    .every((d) => d.feedback === 'negative')

  if (consecutiveNegative) {
    // Flag for recalibration
    await supabase
      .from('users')
      .update({ needs_recalibration: true })
      .eq('id', event.data.userId)

    // Send recalibration SMS/email
    await sendRecalibrationNotification(event.data.userId)
  }
})
```

#### Step 4: calculate-ai-readiness
```typescript
await step.run('calculate-ai-readiness', async () => {
  const supabase = await createClient()

  // Get user onboarding date
  const { data: user } = await supabase
    .from('users')
    .select('created_at')
    .eq('id', event.data.userId)
    .single()

  const daysSinceOnboarding = Math.floor(
    (Date.now() - new Date(user!.created_at).getTime()) / (1000 * 60 * 60 * 24)
  )

  // Require at least 7 days
  if (daysSinceOnboarding < 7) return

  // Get feedback stats
  const { data: feedbackStats } = await supabase
    .from('delivery_log')
    .select('feedback')
    .eq('user_id', event.data.userId)
    .not('feedback', 'is', null)

  // Require at least 5 feedbacks
  if (!feedbackStats || feedbackStats.length < 5) return

  const positiveCount = feedbackStats.filter((f) => f.feedback === 'positive').length
  const totalCount = feedbackStats.length

  // Formula: (positive_rate * 60) + (streak_days / 30 * 40)
  // 60% weight on feedback quality, 40% weight on consistency
  const score = Math.min(
    100,
    Math.max(
      0,
      (positiveCount / totalCount) * 60 + (daysSinceOnboarding / 30) * 40
    )
  )

  await supabase
    .from('users')
    .update({ ai_readiness_score: Math.round(score) })
    .eq('id', event.data.userId)
})
```

**Output:**
```typescript
{
  success: boolean
}
```

---

## 5. Twilio Strategy

**Phone Number Management**

### 5.1 Shared Pool (Starter + Pro Plans)

**Pool Source:** `process.env.TWILIO_PHONE_POOL` (comma-separated list)

**Example:**
```bash
TWILIO_PHONE_POOL=+15551234567,+15559876543,+15556789012
```

**Assignment Logic:**
```typescript
function assignPhoneNumber(userId: string, plan: 'starter' | 'pro' | 'executive'): string {
  if (plan === 'executive') {
    return assignDedicatedNumber(userId) // See below
  }

  // Hash userId to consistently assign same number
  const hash = userId.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0)
  const index = hash % PHONE_POOL.length
  return PHONE_POOL[index]
}
```

**Benefits:**
- Cost-effective for Starter/Pro tiers
- Consistent number per user (same userId always gets same number)
- Scales to 3-5 numbers for thousands of users

**Considerations:**
- Users on same number may see slight delivery delays during high volume
- Shared pool numbers rotate across users

---

### 5.2 Dedicated Number (Executive Plan)

**Assignment:**
- Executive users get a dedicated Twilio number
- In MVP: assign first number from pool
- In production: purchase and assign unique number per Executive user via Twilio API

**Production Logic:**
```typescript
async function assignDedicatedNumber(userId: string): Promise<string> {
  // 1. Check if user already has dedicated number
  const { data: user } = await supabase
    .from('users')
    .select('twilio_number_assigned')
    .eq('id', userId)
    .single()

  if (user?.twilio_number_assigned) {
    return user.twilio_number_assigned
  }

  // 2. Purchase new number from Twilio
  const availableNumbers = await twilioClient.availablePhoneNumbers('US')
    .local.list({ limit: 1 })

  const purchasedNumber = await twilioClient.incomingPhoneNumbers.create({
    phoneNumber: availableNumbers[0].phoneNumber,
    smsUrl: process.env.TWILIO_WEBHOOK_URL,
  })

  // 3. Assign to user
  await supabase
    .from('users')
    .update({ twilio_number_assigned: purchasedNumber.phoneNumber })
    .eq('id', userId)

  return purchasedNumber.phoneNumber
}
```

**Benefits:**
- Premium experience for Executive tier
- No sharing, no delays
- User can save number as contact

---

### 5.3 Inbound Webhook Flow

**Webhook URL:** `https://hello-clio.com/api/webhooks/twilio`

**Configure in Twilio Console:**
- For each phone number (shared or dedicated)
- Set "A MESSAGE COMES IN" webhook to: `https://hello-clio.com/api/webhooks/twilio`
- Method: POST

**Flow:**
```
User sends SMS to Distill number
  ↓
Twilio receives SMS
  ↓
Twilio POST to /api/webhooks/twilio
  ↓
Verify signature
  ↓
Parse intent (parseInboundSMS)
  ↓
Route:
  - feedback_yes/no → update delivery_log, emit feedback event
  - question → call Claude API, reply via SMS
  - command → handle STOP/PAUSE/RESUME
  ↓
Return TwiML response
```

**Intent Classification:**
```typescript
function parseInboundSMS(body: string): Intent {
  const normalized = body.trim().toLowerCase()

  if (normalized === 'y' || normalized === 'yes' || normalized === '👍') {
    return 'feedback_yes'
  }

  if (normalized === 'n' || normalized === 'no' || normalized === '👎') {
    return 'feedback_no'
  }

  if (normalized.startsWith('stop') || normalized.startsWith('unsubscribe')) {
    return 'command'
  }

  return 'question' // Ask Anything
}
```

---

## 6. Stripe Product Structure

**Stripe Dashboard Setup:**

Create 3 products with corresponding price IDs.

### 6.1 Product: Distill Starter

**Monthly Price:**
- Amount: $12.00
- Interval: month
- Trial: 7 days
- Price ID stored in: `STRIPE_STARTER_MONTHLY_PRICE_ID`

**Annual Price:**
- Amount: $99.00 ($8.25/month — save 31%)
- Interval: year
- Trial: 7 days
- Price ID stored in: `STRIPE_STARTER_ANNUAL_PRICE_ID`

**Features:**
- 1 email/day
- Personalized learning plan
- Weekly digest (Sundays)
- Feedback adaptation
- AI Readiness Score

---

### 6.2 Product: Distill Pro

**Monthly Price:**
- Amount: $25.00
- Interval: month
- Trial: 7 days
- Price ID stored in: `STRIPE_PRO_MONTHLY_PRICE_ID`

**Annual Price:**
- Amount: $199.00 ($16.58/month — save 34%)
- Interval: year
- Trial: 7 days
- Price ID stored in: `STRIPE_PRO_ANNUAL_PRICE_ID`

**Features:**
- Everything in Starter
- SMS delivery (shared pool)
- Y/N SMS feedback
- Adaptive content personalization

---

### 6.3 Product: Distill Executive

**Monthly Price:**
- Amount: $49.00
- Interval: month
- Trial: 7 days
- Price ID stored in: `STRIPE_EXECUTIVE_MONTHLY_PRICE_ID`

**Annual Price:**
- Amount: $399.00 ($33.25/month — save 32%)
- Interval: year
- Trial: 7 days
- Price ID stored in: `STRIPE_EXECUTIVE_ANNUAL_PRICE_ID`

**Features:**
- Everything in Pro
- Dedicated Twilio number
- Ask Anything SMS
- Meeting Prep Mode (post-MVP)
- Progress Dashboard (post-MVP)

---

### 6.4 Webhook Events Handled

Configure Stripe webhook endpoint: `https://hello-clio.com/api/webhooks/stripe`

**Events to Listen For:**

#### customer.subscription.created
**Trigger:** User completes checkout and subscription is created

**Actions:**
1. Extract `clerk_user_id` from `subscription.metadata`
2. Extract price ID from `subscription.items.data[0].price.id`
3. Map price ID to plan tier (starter | pro | executive)
4. Upsert users table:
   - plan = tier
   - subscription_status = subscription.status
   - stripe_customer_id = subscription.customer
   - stripe_subscription_id = subscription.id
   - current_period_end = subscription.current_period_end

---

#### customer.subscription.updated
**Trigger:** Subscription changes (upgrade, downgrade, renewal)

**Actions:**
1. Same as subscription.created
2. Handle plan tier changes (e.g., Starter → Pro)
3. If upgraded to Pro/Executive: assign Twilio number

---

#### customer.subscription.deleted
**Trigger:** Subscription canceled or expired

**Actions:**
1. Extract clerk_user_id from metadata
2. Update users table:
   - plan = 'free'
   - subscription_status = 'canceled'
   - delivery_paused = true

---

#### invoice.payment_failed
**Trigger:** Payment method declined or failed

**Actions:**
1. Extract customer ID from invoice.customer
2. Find user by stripe_customer_id
3. Send payment failed email via Resend
4. Optionally: set subscription_status = 'past_due'

---

#### customer.subscription.trial_will_end
**Trigger:** 3 days before trial ends (Stripe sends this automatically)

**Actions:**
1. Extract clerk_user_id from subscription.metadata
2. Send trial ending email via Resend
3. Encourage upgrade with CTA to dashboard/billing

---

### 6.5 Trial Period Configuration

**Trial Length:** 7 days

**Implementation:**
```typescript
const session = await stripe.checkout.sessions.create({
  // ...
  subscription_data: {
    trial_period_days: 7,
    metadata: {
      clerk_user_id: userId,
    },
  },
})
```

**Trial Behavior:**
- User gets full access to plan features during trial
- No charge until trial ends
- If user cancels during trial: no charge, subscription ends immediately
- 3 days before trial ends: Stripe sends `customer.subscription.trial_will_end` event

---

## 7. Data Flow Diagrams

Text-based sequence diagrams for key user flows.

### 7.1 Onboarding Flow

```
User lands on Landing Page
  ↓
Click "Get Started Free"
  ↓
Navigate to /onboarding
  ↓
──────────────────────────────────────────────────────────────────
Question 1: Your Role
  → User taps option (e.g., "CEO")
  ↓
Question 2: Your Industry
  → User taps option (e.g., "Financial Services")
  ↓
Question 3: Your AI Involvement
  → User taps option (e.g., "Evaluating AI vendors")
  ↓
Question 4: What worries you most?
  → User taps option (e.g., "ROI clarity")
  ↓
Question 5: How should we reach you?
  → User taps option (e.g., "Both Email + SMS")
──────────────────────────────────────────────────────────────────
  ↓
Show "Building your plan..." animation (2s)
  ↓
POST /api/onboarding
  ↓
  ├─ Validate Clerk session
  ├─ Validate request body (Zod)
  ├─ Upsert users table
  ├─ Call getUserContentPlan(userId)
  └─ If Pro/Executive + SMS: assign Twilio number
  ↓
Return success + plan preview
  ↓
Redirect to /pricing (plan selection)
  ↓
User selects plan (e.g., "Pro - Monthly")
  ↓
POST /api/checkout
  ↓
Stripe Checkout Session created
  ↓
Redirect to Stripe Checkout page
  ↓
User enters payment info
  ↓
Stripe processes payment
  ↓
Stripe webhook: customer.subscription.created
  ↓
  ├─ Update users table (plan, subscription_status, etc.)
  └─ Return 200 to Stripe
  ↓
Redirect to /dashboard?success=1
  ↓
Dashboard shows: "Welcome! Your first insight arrives tomorrow morning."
```

---

### 7.2 Daily Delivery Flow

```
Inngest cron triggers at 7:00 AM UTC
  ↓
dailyDelivery function starts
  ↓
Step 1: fetch-active-users
  ↓
  ├─ Query users table:
  │     subscription_status = 'active'
  │     plan != 'free'
  │     delivery_paused = false
  └─ Return array of users
  ↓
Batch users into groups of 50
  ↓
For each batch:
  ↓
  Step N: process-batch-N
    ↓
    For each user in batch (parallel):
      ↓
      ├─ Call getUserContentPlan(userId)
      │    ↓
      │    ├─ Fetch user profile
      │    ├─ Fetch last 30 delivery_log entries
      │    ├─ Fetch feedback_weights
      │    ├─ Call matchContentToUser() → ranked content
      │    ├─ Filter out items sent in last 14 days
      │    ├─ Call getNextContentType() → rotate content types
      │    ├─ Call generateContent() → personalize with Claude API
      │    └─ Return { emailContent, smsContent, contentItemId }
      │
      ├─ If deliveryPreference includes 'email':
      │    ↓
      │    sendDailyEmail(user, emailContent)
      │      ↓
      │      Resend API → send email
      │
      ├─ If deliveryPreference includes 'sms' AND plan in ['pro', 'executive']:
      │    ↓
      │    sendDailySMS(userId, phone, plan, smsContent)
      │      ↓
      │      ├─ assignPhoneNumber(userId, plan) → get Twilio number
      │      └─ Twilio API → send SMS
      │
      └─ Insert into delivery_log
           (user_id, content_item_id, channel, sent_at)
  ↓
All batches complete
  ↓
Return { processed: N, batches: M }
```

---

### 7.3 SMS Feedback Loop

```
User receives SMS: "AI agents are rewriting customer service. CEOs should ask..."
  ↓
User reads content (15 seconds)
  ↓
User replies: "Y"
  ↓
Twilio receives inbound SMS
  ↓
Twilio POST to /api/webhooks/twilio
  ↓
  ├─ Request headers: x-twilio-signature
  ├─ Request body (form-encoded): From, Body, MessageSid
  ↓
Verify Twilio signature
  ↓
  ├─ Get auth token from env
  ├─ Call twilio.validateRequest()
  └─ If invalid: return 403
  ↓
Parse request body (URLSearchParams)
  ↓
Call parseInboundSMS(Body)
  ↓
  ├─ Body = "Y" → intent = 'feedback_yes'
  └─ Body = "N" → intent = 'feedback_no'
  ↓
Route to /api/feedback handler logic
  ↓
  ├─ Find user by From phone number
  ├─ Find most recent delivery_log without feedback
  ├─ Update delivery_log:
  │     feedback = 'positive'
  │     feedback_at = NOW()
  └─ Emit Inngest event: 'distill/feedback.received'
       { userId, deliveryLogId, feedback: 'positive' }
  ↓
Return TwiML: <Response></Response> (200 OK)
  ↓
Inngest receives event: 'distill/feedback.received'
  ↓
feedbackProcessor function starts
  ↓
Step 1: update-delivery-log
  (already done in webhook, but can be re-verified)
  ↓
Step 2: update-feedback-weights
  ↓
  ├─ Fetch content_items tags from delivery_log
  ├─ For each tag: call increment_feedback_weight(userId, tag, +1)
  │     (upserts feedback_weights table)
  └─ Complete
  ↓
Step 3: check-recalibration
  ↓
  ├─ Fetch last 10 delivery_log entries for user
  ├─ Check if last 5 are all negative
  └─ If yes:
       ├─ Set users.needs_recalibration = true
       └─ Send recalibration SMS: "We're adjusting your plan based on feedback"
  ↓
Step 4: calculate-ai-readiness
  ↓
  ├─ Check daysSinceOnboarding >= 7
  ├─ Check totalFeedbacks >= 5
  ├─ Calculate score:
  │     (positiveCount / totalCount) * 60 + (streakDays / 30) * 40
  └─ Update users.ai_readiness_score
  ↓
Return { success: true }
```

---

### 7.4 Ask Anything Flow

```
User receives daily SMS from Distill
  ↓
User has a question: "What is RAG in AI?"
  ↓
User replies with question text to same Twilio number
  ↓
Twilio receives inbound SMS
  ↓
Twilio POST to /api/webhooks/twilio
  ↓
Verify Twilio signature (same as feedback flow)
  ↓
Parse request body
  ↓
Call parseInboundSMS(Body)
  ↓
  Body = "What is RAG in AI?" → intent = 'question'
  ↓
Route to /api/ask handler logic
  ↓
  ├─ Identify user by From phone number
  ├─ Extract question from Body
  ├─ Call Anthropic Messages API:
  │     model: 'claude-sonnet-4-6'
  │     system: "You are a concise AI advisor for busy executives..."
  │     messages: [{ role: 'user', content: question }]
  │     max_tokens: 100
  ├─ Receive answer from Claude
  ├─ Truncate to 160 chars for SMS
  └─ Call sendSMS(From, twilioNumber, answer)
       ↓
       Twilio API → send SMS reply
  ↓
Log to sms_conversations:
  ├─ direction='in', body=question, intent='question', received_at
  └─ direction='out', body=answer, sent_at
  ↓
Return TwiML: <Response><Message>{answer}</Message></Response>
  ↓
User receives SMS reply within 60 seconds:
  "RAG = Retrieval-Augmented Generation. AI pulls real data before answering. Reduces hallucinations."
```

---

## 8. Environment Variables Reference

**Source:** `.env.local.example`

All environment variables use PLACEHOLDER_ prefix for example file. Real values stored in `.env.local` (gitignored).

### 8.1 Supabase

```bash
# Public URL for Supabase project
NEXT_PUBLIC_SUPABASE_URL=PLACEHOLDER_SUPABASE_URL

# Anonymous key (safe to expose in browser)
NEXT_PUBLIC_SUPABASE_ANON_KEY=PLACEHOLDER_SUPABASE_ANON_KEY

# Service role key (server-side only, bypasses RLS)
SUPABASE_SERVICE_ROLE_KEY=PLACEHOLDER_SUPABASE_SERVICE_ROLE_KEY
```

**Usage:**
- `NEXT_PUBLIC_*` vars are embedded in frontend bundle
- `SUPABASE_SERVICE_ROLE_KEY` used in API routes and Inngest functions for admin operations

---

### 8.2 Clerk

```bash
# Publishable key (safe to expose)
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=PLACEHOLDER_CLERK_PUBLISHABLE_KEY

# Secret key (server-side only)
CLERK_SECRET_KEY=PLACEHOLDER_CLERK_SECRET_KEY

# Redirect URLs
NEXT_PUBLIC_CLERK_SIGN_IN_URL=/sign-in
NEXT_PUBLIC_CLERK_SIGN_UP_URL=/sign-up
NEXT_PUBLIC_CLERK_AFTER_SIGN_IN_URL=/dashboard
NEXT_PUBLIC_CLERK_AFTER_SIGN_UP_URL=/onboarding
```

**Usage:**
- `NEXT_PUBLIC_*` vars configure ClerkProvider and UI components
- `CLERK_SECRET_KEY` used in middleware and API routes

---

### 8.3 Stripe

```bash
# Secret key (server-side only)
STRIPE_SECRET_KEY=PLACEHOLDER_STRIPE_SECRET_KEY

# Webhook signing secret (verify webhook events)
STRIPE_WEBHOOK_SECRET=PLACEHOLDER_STRIPE_WEBHOOK_SECRET

# Publishable key (safe to expose)
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=PLACEHOLDER_STRIPE_PUBLISHABLE_KEY

# Price IDs for each plan/billing period
STRIPE_STARTER_MONTHLY_PRICE_ID=PLACEHOLDER_STRIPE_STARTER_MONTHLY
STRIPE_STARTER_ANNUAL_PRICE_ID=PLACEHOLDER_STRIPE_STARTER_ANNUAL
STRIPE_PRO_MONTHLY_PRICE_ID=PLACEHOLDER_STRIPE_PRO_MONTHLY
STRIPE_PRO_ANNUAL_PRICE_ID=PLACEHOLDER_STRIPE_PRO_ANNUAL
STRIPE_EXECUTIVE_MONTHLY_PRICE_ID=PLACEHOLDER_STRIPE_EXEC_MONTHLY
STRIPE_EXECUTIVE_ANNUAL_PRICE_ID=PLACEHOLDER_STRIPE_EXEC_ANNUAL
```

**Usage:**
- Price IDs map to Stripe products created in dashboard
- Webhook secret validates incoming webhook requests

---

### 8.4 Twilio

```bash
# Account credentials
TWILIO_ACCOUNT_SID=PLACEHOLDER_TWILIO_ACCOUNT_SID
TWILIO_AUTH_TOKEN=PLACEHOLDER_TWILIO_AUTH_TOKEN

# Phone number pool (comma-separated, E.164 format)
TWILIO_PHONE_POOL=+15550000001,+15550000002

# Webhook URL for inbound SMS
TWILIO_WEBHOOK_URL=https://hello-clio.com/api/webhooks/twilio
```

**Usage:**
- `TWILIO_PHONE_POOL` used for Starter/Pro shared pool assignment
- `TWILIO_WEBHOOK_URL` configured in Twilio console for each number

---

### 8.5 Resend

```bash
# API key
RESEND_API_KEY=PLACEHOLDER_RESEND_API_KEY

# From email (must be verified domain)
RESEND_FROM_EMAIL=hello@hello-clio.com
RESEND_FROM_NAME=Distill
```

**Usage:**
- All transactional emails sent from `RESEND_FROM_EMAIL`
- Domain `hello-clio.com` must be verified in Resend dashboard

---

### 8.6 Anthropic

```bash
# API key
ANTHROPIC_API_KEY=PLACEHOLDER_ANTHROPIC_API_KEY
```

**Usage:**
- Content generation (daily personalization)
- Ask Anything SMS responses
- Model: `claude-sonnet-4-6`

---

### 8.7 NewsAPI

```bash
# API key
NEWS_API_KEY=PLACEHOLDER_NEWS_API_KEY
```

**Usage:**
- News ingestion for Industry Signals content type
- `/v2/everything` endpoint with query: "artificial intelligence OR AI"

---

### 8.8 Inngest

```bash
# Event key (for sending events)
INNGEST_EVENT_KEY=PLACEHOLDER_INNGEST_EVENT_KEY

# Signing key (for webhook verification)
INNGEST_SIGNING_KEY=PLACEHOLDER_INNGEST_SIGNING_KEY
```

**Usage:**
- `INNGEST_EVENT_KEY` used in inngest.send() calls
- `INNGEST_SIGNING_KEY` verifies requests to /api/inngest

---

### 8.9 App Configuration

```bash
# Public app URL
NEXT_PUBLIC_APP_URL=https://hello-clio.com

# Node environment
NODE_ENV=development
```

**Usage:**
- `NEXT_PUBLIC_APP_URL` used in email templates, Stripe redirect URLs, etc.
- `NODE_ENV=production` enables real API calls vs. mocks

---

## Summary

This architecture document provides the complete technical blueprint for Distill:

- **6 database tables** with RLS, triggers, and helper functions
- **10 API routes** with full Zod schemas and error handling
- **5-dimension content taxonomy** with scoring algorithm
- **3 Inngest jobs** with step-by-step definitions
- **Twilio strategy** with shared pool and dedicated number logic
- **Stripe structure** with 3 products, 6 price IDs, and 5 webhook events
- **4 data flow diagrams** covering onboarding, delivery, feedback, and Ask Anything
- **30+ environment variables** with clear purpose and usage

All subsequent agents (Backend, Frontend, Content, Payment, Scheduler, Testing) should reference this document as the single source of truth for implementation.

---

**Next Steps:**
1. Backend Agent: Implement all API routes and integrations using this spec
2. Frontend Agent: Build UI matching data structures defined here
3. Content Agent: Implement taxonomy and personalization engine
4. Payment Agent: Configure Stripe products and webhook handling
5. Scheduler Agent: Implement Inngest jobs as specified
6. Testing Agent: Validate all flows and integrations

---

**Document Version:** 1.0
**Last Updated:** 2026-05-01
**Status:** Ready for Implementation
