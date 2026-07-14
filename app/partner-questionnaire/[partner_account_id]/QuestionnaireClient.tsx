'use client'

import { useMemo, useState } from 'react'
import type { PartnerQuestionnaire, QuestionnaireQuestion } from '@/lib/partner/questionnaire'
import type { PartnerThemeConfig } from '@/lib/partner/theme'

/**
 * B2B-03 — End-user questionnaire render (Requirement Doc Section 4.B).
 *
 * Styled entirely by the partner's Level A theme config — no Clio dark-admin
 * styling leaks into this page (deliberately visually unrelated to the
 * Configurator, Section 4.A). Answers held only in-memory (component state)
 * — never written to localStorage/sessionStorage or any Clio table
 * (Section 6.1/4.B Screen state 4).
 */

type Answer = string | string[] | boolean

export default function QuestionnaireClient({
  partnerAccountId,
  questionnaire,
  theme,
}: {
  partnerAccountId: string
  questionnaire: PartnerQuestionnaire
  theme: PartnerThemeConfig
}) {
  const [answers, setAnswers] = useState<Record<string, Answer>>({})
  const [pageIndex, setPageIndex] = useState(0)
  const [submitState, setSubmitState] = useState<'idle' | 'submitting' | 'success' | 'failure'>('idle')

  const questions = questionnaire.schema
  const isMultiPage = questionnaire.layout === 'multi_page'
  const visibleQuestions = isMultiPage ? [questions[pageIndex]] : questions

  const allRequiredAnswered = useMemo(() => {
    return questions
      .filter((q) => q.required)
      .every((q) => {
        const a = answers[q.id]
        if (a === undefined) return false
        if (typeof a === 'string') return a.length > 0
        if (Array.isArray(a)) return a.length > 0
        return true
      })
  }, [questions, answers])

  const currentPageAnswered = useMemo(() => {
    if (!isMultiPage) return true
    const q = questions[pageIndex]
    if (!q || !q.required) return true
    const a = answers[q.id]
    if (a === undefined) return false
    if (typeof a === 'string') return a.length > 0
    if (Array.isArray(a)) return a.length > 0
    return true
  }, [isMultiPage, questions, pageIndex, answers])

  const cornerRadius = theme.cornerStyle === 'sharp' ? 0 : theme.cornerStyle === 'rounded' ? 16 : 8
  const spacingMultiplier = theme.spacingScale === 'compact' ? 0.75 : theme.spacingScale === 'spacious' ? 1.5 : 1

  const pageStyle: React.CSSProperties = {
    minHeight: '100vh',
    width: '100vw',
    background: '#ffffff',
    color: '#111111',
    fontFamily: theme.fontFamily,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: `${24 * spacingMultiplier}px`,
  }

  const cardStyle: React.CSSProperties = {
    width: '100%',
    maxWidth: 560,
  }

  async function handleSubmit() {
    setSubmitState('submitting')
    try {
      const res = await fetch(`/partner-questionnaire/${partnerAccountId}/submit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ answers }),
      })
      setSubmitState(res.ok ? 'success' : 'failure')
    } catch {
      setSubmitState('failure')
    }
  }

  if (submitState === 'success') {
    return (
      <div style={pageStyle}>
        <p style={{ fontSize: 18 }}>Thanks — you&apos;re all set.</p>
      </div>
    )
  }

  if (submitState === 'failure') {
    return (
      <div style={pageStyle}>
        <div style={{ textAlign: 'center' }}>
          <p style={{ fontSize: 16, marginBottom: 16 }}>Something went wrong submitting your answers. Please try again.</p>
          <button
            onClick={handleSubmit}
            style={{
              background: theme.primaryColor,
              color: '#ffffff',
              border: 'none',
              borderRadius: cornerRadius,
              padding: `${10 * spacingMultiplier}px ${20 * spacingMultiplier}px`,
              fontFamily: theme.fontFamily,
              cursor: 'pointer',
            }}
          >
            Try again
          </button>
        </div>
      </div>
    )
  }

  const isLastPage = !isMultiPage || pageIndex === questions.length - 1

  return (
    <div style={pageStyle}>
      <div style={cardStyle}>
        {isMultiPage && (
          <p style={{ fontSize: 12, color: '#666666', marginBottom: 16 }}>
            Question {pageIndex + 1} of {questions.length}
          </p>
        )}

        {visibleQuestions.map((q) => (
          <QuestionBlock
            key={q.id}
            question={q}
            value={answers[q.id]}
            onChange={(value) => setAnswers((prev) => ({ ...prev, [q.id]: value }))}
            theme={theme}
            cornerRadius={cornerRadius}
            spacingMultiplier={spacingMultiplier}
          />
        ))}

        <div style={{ display: 'flex', gap: 12, marginTop: 24 * spacingMultiplier }}>
          {isMultiPage && pageIndex > 0 && (
            <button
              onClick={() => setPageIndex((p) => p - 1)}
              style={{
                background: 'transparent',
                color: '#111111',
                border: `1px solid #cccccc`,
                borderRadius: cornerRadius,
                padding: `${10 * spacingMultiplier}px ${20 * spacingMultiplier}px`,
                fontFamily: theme.fontFamily,
                cursor: 'pointer',
              }}
            >
              Back
            </button>
          )}
          <button
            disabled={isMultiPage ? !currentPageAnswered : !allRequiredAnswered}
            onClick={() => {
              if (isMultiPage && !isLastPage) {
                setPageIndex((p) => p + 1)
              } else {
                handleSubmit()
              }
            }}
            style={{
              background: theme.primaryColor,
              color: '#ffffff',
              border: 'none',
              borderRadius: cornerRadius,
              padding: `${10 * spacingMultiplier}px ${20 * spacingMultiplier}px`,
              fontFamily: theme.fontFamily,
              cursor: 'pointer',
              opacity: (isMultiPage ? currentPageAnswered : allRequiredAnswered) ? 1 : 0.4,
            }}
          >
            {isLastPage ? (submitState === 'submitting' ? 'Submitting…' : 'Submit') : 'Next'}
          </button>
        </div>
      </div>
    </div>
  )
}

function QuestionBlock({
  question,
  value,
  onChange,
  theme,
  cornerRadius,
  spacingMultiplier,
}: {
  question: QuestionnaireQuestion
  value: Answer | undefined
  onChange: (value: Answer) => void
  theme: PartnerThemeConfig
  cornerRadius: number
  spacingMultiplier: number
}) {
  return (
    <div style={{ marginBottom: 24 * spacingMultiplier }}>
      <p style={{ fontSize: 16, fontWeight: 600, marginBottom: 12 * spacingMultiplier }}>{question.text}</p>

      {question.type === 'multiple_choice' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {(question.options ?? []).map((option) => (
            <label
              key={option}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                border: `1px solid ${value === option ? theme.primaryColor : '#dddddd'}`,
                borderRadius: cornerRadius,
                padding: `${10 * spacingMultiplier}px ${12 * spacingMultiplier}px`,
                cursor: 'pointer',
              }}
            >
              <input type="radio" name={question.id} checked={value === option} onChange={() => onChange(option)} />
              {option}
            </label>
          ))}
        </div>
      )}

      {question.type === 'yes_no' && (
        <div style={{ display: 'flex', gap: 8 }}>
          {['Yes', 'No'].map((option) => (
            <label
              key={option}
              style={{
                border: `1px solid ${value === option ? theme.primaryColor : '#dddddd'}`,
                borderRadius: cornerRadius,
                padding: `${10 * spacingMultiplier}px ${16 * spacingMultiplier}px`,
                cursor: 'pointer',
              }}
            >
              <input type="radio" name={question.id} checked={value === option} onChange={() => onChange(option)} style={{ marginRight: 6 }} />
              {option}
            </label>
          ))}
        </div>
      )}

      {question.type === 'short_text' && (
        <input
          type="text"
          value={typeof value === 'string' ? value : ''}
          onChange={(e) => onChange(e.target.value)}
          style={{
            width: '100%',
            border: '1px solid #dddddd',
            borderRadius: cornerRadius,
            padding: `${10 * spacingMultiplier}px ${12 * spacingMultiplier}px`,
            fontFamily: theme.fontFamily,
          }}
        />
      )}
    </div>
  )
}
