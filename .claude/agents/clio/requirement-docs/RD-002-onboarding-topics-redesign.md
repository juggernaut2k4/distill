# Onboarding Enhancement + Smart Topic Recommendations — Requirement Document

Version: 1.0
Status: CEO REVIEW
Author: Business Analyst Agent
Date: 2026-05-31
Feature Brief: FB-002

---

## 1. Purpose

The current onboarding collects domain (e.g. "Finance") but not sub-domain (e.g. "Banking"). This makes the subsequent topic recommendations too broad to feel personalised — a CFO in Insurance and a FinTech founder both see the same list. Additionally, the current `/topics` page shows a static catalog with no personalisation signal applied, undermining the product's core promise.

This feature does three things:
1. Removes the insight preview screen (was never in the brief; content is too thin at that point to be useful)
2. Adds a sub-domain question (Q6) to onboarding so the content engine has the precision it needs
3. Replaces the static topic catalog with AI-generated recommendations grouped into meaningful sections

Without this fix, a new user's first experience of Clio feels generic. With it, the topic selection screen should feel like Clio already knows them.

---

## 2. User Story

**Primary:**
As a newly onboarded executive, after completing my 6-question profile, I want to see topic recommendations that reflect my exact role, sub-domain, and stated goal — so I feel immediately that Clio is worth my time.

**Secondary:**
As a VP of Technology in Cybersecurity, I want to see AI tools like Anthropic Claude, Microsoft Copilot, and GitHub Copilot listed as learnable topics — so I can build a learning plan that includes the specific tools relevant to my work.

---

## 3. Trigger / Entry Point

### Change 1 — Remove insight preview
- **Current route:** `/api/onboarding/preview` (POST) — this route is deleted entirely
- **Current page state:** the "Here's your first insight" screen at the end of onboarding — removed
- **After removal:** the "Building your plan..." animation completes → redirect to `/topics`

### Change 2 — Sub-domain question (Q6)
- **Trigger:** user completes Q5 (delivery preference) and clicks "Continue"
- **Route:** still `/onboarding` — Q6 is inserted as the 6th and final question
- **State required:** user must have selected a primary domain in Q2

### Change 3 — Topic recommendations
- **Route:** `/topics` (replaces current page entirely)
- **Trigger:** page load after onboarding redirect, or direct navigation by logged-in user
- **State required:** user must have `clio_onboarding` in localStorage with `role`, `primaryDomain`, `subDomain`, and `learningGoal`; if any is missing, show a reduced recommendation set using only what is available

---

## 4. Screen / Flow Description

### 4A — Onboarding Q6 (new)

After Q5, the progress bar advances to 6/6 and Q6 slides in from the right.

**Q6 screen:**
- Progress bar: full width (100%), purple fill
- Question text (centered): "Which area of [domain] describes your work best?" — where [domain] is replaced with the user's Q2 selection in title case (e.g. "Which area of Finance describes your work best?")
- Sub-domain option buttons: rendered as full-width selectable buttons, same style as Q1–Q5
- Each button: single label (e.g. "Banking"), no description text
- User taps one sub-domain option
- Tapping a button immediately selects it (purple border + tint) and auto-advances after 400ms (same as other questions)
- After selection: show "Building your plan..." loading screen (same as before)
- After 2 seconds: redirect to `/topics`

**Sub-domain lists (complete, by domain):**

| Domain | Sub-domains |
|--------|-------------|
| Finance | Banking, Insurance, Investment Management, FinTech, Private Equity, Corporate Finance |
| Technology | Cloud & Infrastructure, Cybersecurity, Data & Analytics, Software Development, AI / ML, Product Management |
| Healthcare | Clinical Operations, Pharma & Life Sciences, Health Insurance, MedTech & Devices, Digital Health |
| Retail | E-commerce, Physical Retail, Consumer Goods, Supply Chain & Logistics, Retail Technology |
| Manufacturing | Industrial Operations, Automotive, Aerospace & Defence, Consumer Manufacturing, Supply Chain |
| Legal | Corporate Law, Regulatory & Compliance, Legal Tech, Litigation, Financial Services Law |
| Consulting | Strategy Consulting, Technology Consulting, Management Consulting, HR & Organisational Change, Financial Advisory |

If the user's domain does not match any of the above (edge case: old data), show a generic fallback set: "Strategy", "Operations", "Technology", "People & Culture", "Finance".

---

### 4B — Topic Recommendations Page (`/topics`)

**State 1: Loading**
- Page background: `#080808`
- Header text: "Curating your learning plan..." — `text-xl font-semibold text-white`, centered
- Sub-text: "Analysing your role, domain, and goals" — `text-sm text-[#94A3B8]`, centered
- Below: 3 rows of 4 skeleton cards each (12 total), `animate-pulse`, `bg-[#111111]` with `#222222` border, `h-24 rounded-xl`
- No other interactive elements while loading

**State 2: Loaded (recommendations ready)**
- Page background: `#080808`
- Page heading (top left): "Your AI Learning Plan" — `text-2xl font-bold text-white`
- Sub-heading: "Select the topics you want to master. Pick at least 3." — `text-sm text-[#94A3B8]`
- Top right: pill showing selected count: "3 selected" (cyan text, `#06B6D4`, dark pill background) — updates in real-time as user selects
- Four sections, each with a section heading and topic cards in a 2-column grid (desktop) or 1-column (mobile):

  **Section 1 — "Trending in your field"**
  - Icon: `TrendingUp` (Lucide, `#06B6D4`)
  - 3–4 topic cards

  **Section 2 — "Based on your role"**
  - Icon: `Briefcase` (Lucide, `#7C3AED`)
  - 3–4 topic cards

  **Section 3 — "Tools to master"**
  - Icon: `Wrench` (Lucide, `#F59E0B`)
  - 3–4 topic cards
  - Anthropic Claude must be included in this section for all domains where AI tools are relevant (all domains)

  **Section 4 — "Based on your goal"**
  - Icon: `Target` (Lucide, `#10B981`)
  - 3–4 topic cards

- Total: 12–16 topic cards across all sections

**Topic card anatomy:**
```
┌──────────────────────────────────┐
│  [Topic Title]  (text-sm bold)   │
│  [One-line description]  (muted) │
└──────────────────────────────────┘
```
- Default state: `bg-[#111111]` border `#222222`, `rounded-xl p-4`
- Selected state: border `#7C3AED` (2px), background `rgba(124,58,237,0.12)`, white text
- Hover: border `#333333`, background `#1A1A1A`
- Framer Motion: `whileHover` scale `1.02`, `whileTap` scale `0.98`

**"Add your own topic" input (above sticky bar):**
- A single text input field with placeholder: "Add your own topic..." — `bg-[#111111]` border `#333333`, `rounded-xl px-4 py-3 text-white`, full-width within the page's content padding
- To the right of the input: an "Add" button — secondary style (transparent, `#333333` border), label "Add"
- User types a topic name and presses Enter or clicks "Add"
- On add: a custom topic card appears at the top of the page under a new section heading "Your topics" — above all AI-generated sections
- Custom topic card visual: same dimensions as AI-generated cards, but with a `#333333` border (not purple), a small `Plus` icon (Lucide) in the top-right corner to remove it, and "Custom" badge (`text-xs`, amber `#F59E0B`)
- Custom topics are pre-selected (count toward the 3-topic minimum automatically)
- Removing a custom topic: click the `Plus` icon (acts as X/remove) — card disappears and count decrements
- Validation: empty input → no action. Input longer than 60 characters → trim to 60. Duplicate topic name (case-insensitive) → no action, clear input.
- Input field clears after a successful add

**Bottom bar (sticky):**
- Fixed to bottom of viewport
- Background: `#111111` border-top `#222222`
- Left: "X topics selected" — `text-sm text-[#94A3B8]`
- Right: "Build my learning plan →" button — primary purple, disabled + greyed out until 3+ topics selected (custom topics count)
- When <3 selected, button shows tooltip on hover: "Select at least 3 topics to continue"
- When ≥3 selected, clicking button navigates to `/plan` (existing flow)

**State 3: Error / Fallback**
- Claude API call fails or times out (>10 seconds)
- Page falls back to existing Supabase topic catalog silently (no error shown to user)
- Same visual layout but section headings change to: "Recommended for you", "Popular topics", "AI Tools", "Getting started"
- Fallback topics are fetched from `topic_catalog` table, filtered by user's domain

**State 4: Empty (no topics available even from fallback)**
- Show: "We're still building your topic library for [domain]. Check back tomorrow." — centered, muted text
- Button: "Go to dashboard →" — secondary style

---

## 5. Visual Examples

### Q6 — Sub-domain selection (Finance example)

```
┌──────────────────────────────────────────────────────┐
│ ████████████████████████████████████████ (100%)      │  ← progress bar
│                                                      │
│                                                      │
│   Which area of Finance describes your work best?    │
│                    (text-4xl bold white centered)    │
│                                                      │
│   ┌──────────────────────────────────────────────┐   │
│   │  Banking                                     │   │
│   └──────────────────────────────────────────────┘   │
│   ┌──────────────────────────────────────────────┐   │
│   │  Insurance                                   │   │
│   └──────────────────────────────────────────────┘   │
│   ┌──────────────────────────────────────────────┐   │
│   │  Investment Management                       │   │
│   └──────────────────────────────────────────────┘   │
│   ┌──────────────────────────────────────────────┐   │
│   │  FinTech                                     │   │
│   └──────────────────────────────────────────────┘   │
│   ┌──────────────────────────────────────────────┐   │
│   │  Private Equity                              │   │
│   └──────────────────────────────────────────────┘   │
│   ┌──────────────────────────────────────────────┐   │
│   │  Corporate Finance                           │   │
│   └──────────────────────────────────────────────┘   │
│                                                      │
└──────────────────────────────────────────────────────┘
```

### Topic Recommendations — Loaded state

```
┌──────────────────────────────────────────────────────┐
│  Your AI Learning Plan          [3 selected]         │
│  Select topics to master. Pick at least 3.           │
│                                                      │
│  📈 Trending in your field                           │
│  ┌──────────────────┐  ┌──────────────────┐          │
│  │ AI in Risk Mgmt  │  │ LLMs in Trading  │          │
│  │ One-line desc    │  │ One-line desc    │          │
│  └──────────────────┘  └──────────────────┘          │
│                                                      │
│  💼 Based on your role                               │
│  ┌──────────────────┐  ┌──────────────────┐          │
│  │ AI Strategy for  │  │ Building AI      │          │
│  │ Finance Leaders  │  │ Business Cases   │          │
│  └──────────────────┘  └──────────────────┘          │
│                                                      │
│  🔧 Tools to master                                  │
│  ┌──────────────────┐  ┌──────────────────┐          │
│  │ Anthropic Claude │  │ ChatGPT for      │          │
│  │ for Finance      │  │ Analysis         │          │
│  └──────────────────┘  └──────────────────┘          │
│                                                      │
│  🎯 Based on your goal                               │
│  ┌──────────────────┐  ┌──────────────────┐          │
│  │ AI ROI           │  │ Evaluating AI    │          │
│  │ Frameworks       │  │ Vendor Pitches   │          │
│  └──────────────────┘  └──────────────────┘          │
│                                                      │
├──────────────────────────────────────────────────────┤
│  3 topics selected        [Build my learning plan →] │  ← sticky bottom bar
└──────────────────────────────────────────────────────┘
```

### Loading state

```
┌──────────────────────────────────────────────────────┐
│                                                      │
│           Curating your learning plan...             │
│        Analysing your role, domain, and goals        │
│                                                      │
│  ┌──────────────┐  ┌──────────────┐  ┌────────────┐  │
│  │  ░░░░░░░░░░  │  │  ░░░░░░░░░░  │  │  ░░░░░░░░  │  │  ← skeleton
│  └──────────────┘  └──────────────┘  └────────────┘  │
│  ┌──────────────┐  ┌──────────────┐  ┌────────────┐  │
│  │  ░░░░░░░░░░  │  │  ░░░░░░░░░░  │  │  ░░░░░░░░  │  │
│  └──────────────┘  └──────────────┘  └────────────┘  │
│                                                      │
└──────────────────────────────────────────────────────┘
```

---

## 6. Data Requirements

### Read
- `localStorage['clio_onboarding']`: `role`, `primaryDomain`, `subDomain`, `domainProficiency`, `learningGoal`
- `topic_catalog` table (Supabase): used for fallback if Claude API fails — fetch where `domain` matches user's `primaryDomain`

### Write
- `localStorage['clio_onboarding']`: add `subDomain` field after Q6 selection
- `users` table (Supabase): add column `sub_domain TEXT` — written via `POST /api/onboarding` (existing route, add `subDomain` to Zod schema and INSERT)

### New API route
**`POST /api/topics/recommendations`**

Request body:
```json
{
  "role": "director",
  "primaryDomain": "finance",
  "subDomain": "banking",
  "learningGoal": "understand how to evaluate AI vendors",
  "aiMaturity": "intermediate"
}
```

Response:
```json
{
  "sections": [
    {
      "id": "trending",
      "label": "Trending in your field",
      "icon": "TrendingUp",
      "topics": [
        { "id": "uuid", "title": "AI in Risk Management", "description": "How banks use ML to detect fraud and model credit risk in real time." },
        ...
      ]
    },
    {
      "id": "role",
      "label": "Based on your role",
      "icon": "Briefcase",
      "topics": [...]
    },
    {
      "id": "tools",
      "label": "Tools to master",
      "icon": "Wrench",
      "topics": [
        { "id": "uuid", "title": "Anthropic Claude for Finance", "description": "Using Claude for contract review, report drafting, and scenario analysis." },
        ...
      ]
    },
    {
      "id": "goal",
      "label": "Based on your goal",
      "icon": "Target",
      "topics": [...]
    }
  ]
}
```

### Claude API prompt (for `/api/topics/recommendations`)
**System prompt:**
```
You are a senior AI learning advisor for executives. Generate personalised AI topic recommendations for a business leader based on their profile. Return ONLY valid JSON matching the specified schema. Be specific and practical — every topic must be immediately relevant to someone in their exact role and sub-domain.
```

**User prompt:**
```
Generate AI learning topic recommendations for:
- Role: {role}
- Domain: {primaryDomain}
- Sub-domain: {subDomain}
- AI experience: {aiMaturity}
- Learning goal: {learningGoal}

Return exactly 4 sections:
1. "trending" — 4 topics: current AI trends and use cases in {subDomain} within {primaryDomain}
2. "role" — 3 topics: what {role}-level professionals in {primaryDomain} are learning about AI right now
3. "tools" — 3 topics: specific AI tools relevant to {subDomain}. MUST include Anthropic Claude as one of the tools, named specifically as "Anthropic Claude for {subDomain}" with a one-line description of how it's used in that sub-domain. Also include 2 other relevant tools (e.g. ChatGPT, Microsoft Copilot, GitHub Copilot, Glean, Notion AI — choose based on domain relevance).
4. "goal" — 3 topics: topics that directly help someone who wants to "{learningGoal}"

Each topic: { "id": "slug-format", "title": "max 6 words", "description": "one sentence, max 15 words, specific to their domain" }

Return JSON only. No markdown, no explanation.
```

**Timeout:** 10 seconds. On timeout or error, return `{ "fallback": true }` — frontend handles fallback display.

### Deleted
- `POST /api/onboarding/preview` — route deleted entirely
- Insight preview screen state in `app/onboarding/page.tsx` — removed

---

## 7. Success Criteria (Acceptance Tests)

✓ Given a user who selected Finance in Q2, when Q6 loads, then they see exactly 6 sub-domain options: Banking, Insurance, Investment Management, FinTech, Private Equity, Corporate Finance.

✓ Given a user who selected Technology in Q2, when Q6 loads, then they see exactly 6 options: Cloud & Infrastructure, Cybersecurity, Data & Analytics, Software Development, AI / ML, Product Management.

✓ Given a user who completes Q6, when the onboarding flow saves to localStorage, then `clio_onboarding.subDomain` is set to the selected value.

✓ Given a user who completes onboarding, when `/topics` loads, then the page calls `POST /api/topics/recommendations` with the user's profile and shows a skeleton loading state.

✓ Given a successful recommendations API response, when the page renders, then exactly 4 sections are shown with their correct headings and icons.

✓ Given any user profile, when the "Tools to master" section renders, then at least one topic card has "Anthropic Claude" in its title.

✓ Given a user who has selected fewer than 3 topics (including custom), when they hover the "Build my learning plan" button, then the button is disabled and a tooltip reads "Select at least 3 topics to continue".

✓ Given a user who types a topic name and presses Enter, when the topic is added, then a "Your topics" section appears at the top, the custom card is shown as pre-selected, the input clears, and the selected count increments.

✓ Given a user who types a duplicate topic name (case-insensitive), when they press Enter, then nothing is added and the input clears silently.

✓ Given a user who types more than 60 characters, when the topic is added, then the title is trimmed to 60 characters.

✓ Given a custom topic card, when the user clicks the remove icon, then the card disappears and the selected count decrements.

✓ Given a user who has selected 3 or more topics, when they click "Build my learning plan →", then they are navigated to `/plan`.

✓ Given the Claude API times out after 10 seconds, when the page detects the timeout, then the page silently falls back to Supabase topic catalog without showing an error to the user.

✓ Given a user who navigates directly to `/api/onboarding/preview`, then they receive a 404 (route no longer exists).

✓ Given a completed onboarding, when the "Building your plan..." screen plays, then there is NO insight preview screen — the user goes directly from the loading screen to `/topics`.

---

## 8. Error States

| Scenario | What the user sees |
|---|---|
| Claude API fails (non-timeout error) | Silent fallback to Supabase catalog. No error message. |
| Claude API times out (>10s) | Silent fallback to Supabase catalog. No error message. |
| Supabase fallback also returns 0 topics | "We're still building your topic library for [domain]. Check back tomorrow." with "Go to dashboard →" button |
| localStorage `clio_onboarding` is missing `subDomain` (old user data) | `/topics` page calls API with `subDomain: ""` — Claude omits the sub-domain from the prompt gracefully |
| User navigates to `/topics` without being logged in | Clerk middleware redirects to `/sign-in` |
| User selects a topic then deselects it | Topic card returns to default state; selected count decrements |

---

## 9. Edge Cases

- **User re-visits `/topics` after already having a plan:** Show the same recommendations (cached from first load via sessionStorage for the session). Do not re-call Claude API on every visit.
- **Mobile layout:** Topic cards are 1-column (full width) on screens <640px. Sticky bottom bar remains.
- **User refreshes mid-topic-selection:** Selection state is not persisted — they start fresh. This is acceptable for now.
- **Domain with fewer than 6 sub-domains:** Render however many exist. Do not pad with empty options.
- **User completes onboarding but closes tab before reaching `/topics`:** On next login, they land on `/dashboard` per Clerk redirect config. The `/topics` page is accessible from the dashboard sidebar.
- **Very long learning goal text from Q4:** Truncate to 200 characters before sending to Claude API prompt.
- **Q6 option list overflow on small screens:** All buttons stack vertically and scroll within the full-height container. No horizontal scroll.

---

## 10. Out of Scope

- No changes to Q1, Q2, Q3, Q4, or Q5 of onboarding
- No changes to the `/plan` page or curriculum engine
- Custom topics added via free text are not validated against any catalog — they are passed as-is to the plan builder
- No saving of topic recommendations to the database for reuse — generated fresh per session
- No A/B testing of recommendation sections
- No analytics on which topics are most selected (future)
- No changes to the delivery, scoring, or messaging systems

---

## 11. Open Questions

None. All questions from FB-002 resolved:
- Sub-domain as new Q6: confirmed
- Sub-domain lists: defined in section 4A
- Number of recommendations: 13 total (4+3+3+3) across 4 sections
- Section groupings: defined (Trending, Role, Tools, Goal)
- Claude listed in tools: yes, mandatory, named as "Anthropic Claude for [sub-domain]"
- Free-text topics: out of scope
- Fallback on failure: silent Supabase catalog fallback

---

## 12. Dependencies

- **Must exist before build starts:**
  - `users` table must have `sub_domain TEXT` column added via migration
  - `/api/onboarding` route (exists) must accept `subDomain` in its Zod schema
  - Anthropic API key configured (or PLACEHOLDER_ mock guard active)
  - `topic_catalog` table seeded (exists) — used for fallback

- **Parallel work possible:**
  - Frontend (Q6 screen + `/topics` redesign) and Backend (`/api/topics/recommendations` route) can be built in parallel once this spec is approved

- **Must be removed:**
  - `app/api/onboarding/preview/route.ts` — deleted
  - Insight preview JSX block in `app/onboarding/page.tsx` — deleted
