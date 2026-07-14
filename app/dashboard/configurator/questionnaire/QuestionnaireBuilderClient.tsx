'use client'

import { useEffect, useState } from 'react'
import type { AdminPartnerAccount } from '@/lib/partner/admin-accounts'
import type { PartnerQuestionnaire, QuestionnaireQuestion, QuestionType } from '@/lib/partner/questionnaire'
import { ConfiguratorShell, Card, PrimaryButton, SecondaryButton, COLORS } from '../_shared'

type View = { mode: 'list' } | { mode: 'edit'; id: string }

export default function QuestionnaireBuilderClient({ accounts, activePartnerAccountId, embedded = false }: { accounts: AdminPartnerAccount[]; activePartnerAccountId: string; embedded?: boolean }) {
  const [view, setView] = useState<View>({ mode: 'list' })
  const [questionnaires, setQuestionnaires] = useState<PartnerQuestionnaire[]>([])
  const [loading, setLoading] = useState(true)

  async function reload() {
    setLoading(true)
    const res = await fetch(`/api/admin/configurator/questionnaire?partner_account_id=${activePartnerAccountId}`)
    const data = await res.json()
    setQuestionnaires(data.questionnaires ?? [])
    setLoading(false)
  }

  useEffect(() => { reload() }, [activePartnerAccountId])

  async function createNew() {
    const res = await fetch('/api/admin/configurator/questionnaire', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ partner_account_id: activePartnerAccountId }),
    })
    const data = await res.json()
    if (data.questionnaire) {
      setView({ mode: 'edit', id: data.questionnaire.id })
      reload()
    }
  }

  if (view.mode === 'edit') {
    const content = (
      <EditView
        partnerAccountId={activePartnerAccountId}
        questionnaireId={view.id}
        onBack={() => { setView({ mode: 'list' }); reload() }}
      />
    )
    if (embedded) return <>{content}</>
    return (
      <ConfiguratorShell accounts={accounts} activePartnerAccountId={activePartnerAccountId} title="Questionnaire Builder" backHref={`/dashboard/configurator?partner_account_id=${activePartnerAccountId}`}>
        {content}
      </ConfiguratorShell>
    )
  }

  const published = questionnaires.filter((q) => q.status === 'published')
  const drafts = questionnaires.filter((q) => q.status === 'draft')

  const content = (
    <>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <h1 style={{ fontSize: 18, fontWeight: 700 }}>Questionnaire Builder</h1>
        <PrimaryButton onClick={createNew}>+ New</PrimaryButton>
      </div>

      {loading ? (
        <p style={{ color: COLORS.textSecondary, fontSize: 13 }}>Loading…</p>
      ) : questionnaires.length === 0 ? (
        <Card>
          <p style={{ color: COLORS.textSecondary, fontSize: 13, textAlign: 'center' }}>
            No questionnaire yet. Create one to let your end users onboard themselves.
          </p>
        </Card>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {[...published, ...drafts].map((q) => (
            <Card key={q.id}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <p style={{ fontWeight: 600 }}>
                    Questionnaire {q.status === 'published' && <span style={{ color: COLORS.green, fontSize: 11, marginLeft: 8 }}>PUBLISHED</span>}
                  </p>
                  <p style={{ fontSize: 12, color: COLORS.textSecondary }}>
                    {q.schema.length} question{q.schema.length === 1 ? '' : 's'} · {q.layout === 'single_page' ? '1 page' : `${q.schema.length} pages`}
                  </p>
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <SecondaryButton onClick={() => setView({ mode: 'edit', id: q.id })}>Edit</SecondaryButton>
                  {q.status === 'published' ? (
                    <SecondaryButton
                      onClick={async () => {
                        await fetch(`/api/admin/configurator/questionnaire/${q.id}/unpublish`, {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({ partner_account_id: activePartnerAccountId }),
                        })
                        reload()
                      }}
                    >
                      Unpublish
                    </SecondaryButton>
                  ) : null}
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}
    </>
  )

  if (embedded) return <>{content}</>
  return (
    <ConfiguratorShell accounts={accounts} activePartnerAccountId={activePartnerAccountId} title="Questionnaire Builder" backHref={`/dashboard/configurator?partner_account_id=${activePartnerAccountId}`}>
      {content}
    </ConfiguratorShell>
  )
}

function EditView({ partnerAccountId, questionnaireId, onBack }: { partnerAccountId: string; questionnaireId: string; onBack: () => void }) {
  const [questionnaire, setQuestionnaire] = useState<PartnerQuestionnaire | null>(null)
  const [addingQuestion, setAddingQuestion] = useState(false)
  const [editingIndex, setEditingIndex] = useState<number | null>(null)

  async function reload() {
    const res = await fetch(`/api/admin/configurator/questionnaire/${questionnaireId}?partner_account_id=${partnerAccountId}`)
    const data = await res.json()
    setQuestionnaire(data.questionnaire ?? null)
  }

  useEffect(() => { reload() }, [questionnaireId])

  async function saveSchema(schema: QuestionnaireQuestion[]) {
    await fetch(`/api/admin/configurator/questionnaire/${questionnaireId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ partner_account_id: partnerAccountId, schema }),
    })
    reload()
  }

  async function saveLayout(layout: 'single_page' | 'multi_page') {
    await fetch(`/api/admin/configurator/questionnaire/${questionnaireId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ partner_account_id: partnerAccountId, layout }),
    })
    reload()
  }

  async function publish() {
    const res = await fetch(`/api/admin/configurator/questionnaire/${questionnaireId}/publish`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ partner_account_id: partnerAccountId }),
    })
    if (res.ok) onBack()
  }

  if (!questionnaire) return <p style={{ color: COLORS.textSecondary, fontSize: 13 }}>Loading…</p>

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <button onClick={onBack} style={{ background: 'none', border: 'none', color: COLORS.textSecondary, cursor: 'pointer', fontSize: 13 }}>
          ← All questionnaires
        </button>
        <PrimaryButton disabled={questionnaire.schema.length === 0} onClick={publish} title={questionnaire.schema.length === 0 ? 'Add at least one question first' : undefined}>
          Publish
        </PrimaryButton>
      </div>

      <div style={{ marginBottom: 20 }}>
        <p style={{ fontSize: 13, marginBottom: 8 }}>Layout</p>
        <label style={{ marginRight: 16, fontSize: 13 }}>
          <input type="radio" checked={questionnaire.layout === 'single_page'} onChange={() => saveLayout('single_page')} /> All questions on one page
        </label>
        <label style={{ fontSize: 13 }}>
          <input type="radio" checked={questionnaire.layout === 'multi_page'} onChange={() => saveLayout('multi_page')} /> One question per page
        </label>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 16 }}>
        {questionnaire.schema.map((q, i) => (
          <Card key={q.id} style={{ padding: 12 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <p style={{ fontSize: 14 }}>{i + 1}. {q.text}</p>
                <p style={{ fontSize: 12, color: COLORS.textSecondary }}>
                  {typeLabel(q.type)}{q.options ? ` · ${q.options.length} options` : ''} · {q.required ? 'Required' : 'Optional'}
                </p>
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <SecondaryButton style={{ padding: '4px 10px' }} onClick={() => setEditingIndex(i)}>Edit</SecondaryButton>
                <SecondaryButton
                  style={{ padding: '4px 10px' }}
                  onClick={() => saveSchema(questionnaire.schema.filter((_, idx) => idx !== i))}
                >
                  ×
                </SecondaryButton>
              </div>
            </div>
          </Card>
        ))}
      </div>

      {(addingQuestion || editingIndex !== null) ? (
        <QuestionForm
          initial={editingIndex !== null ? questionnaire.schema[editingIndex] : undefined}
          onCancel={() => { setAddingQuestion(false); setEditingIndex(null) }}
          onSave={(q) => {
            if (editingIndex !== null) {
              const next = [...questionnaire.schema]
              next[editingIndex] = q
              saveSchema(next)
            } else {
              saveSchema([...questionnaire.schema, q])
            }
            setAddingQuestion(false)
            setEditingIndex(null)
          }}
        />
      ) : (
        <SecondaryButton onClick={() => setAddingQuestion(true)}>+ Add question</SecondaryButton>
      )}
    </div>
  )
}

function typeLabel(t: QuestionType): string {
  return t === 'multiple_choice' ? 'Multiple choice' : t === 'short_text' ? 'Short text' : 'Yes/No'
}

function QuestionForm({ initial, onSave, onCancel }: { initial?: QuestionnaireQuestion; onSave: (q: QuestionnaireQuestion) => void; onCancel: () => void }) {
  const [text, setText] = useState(initial?.text ?? '')
  const [type, setType] = useState<QuestionType>(initial?.type ?? 'multiple_choice')
  const [options, setOptions] = useState<string[]>(initial?.options ?? ['', ''])
  const [required, setRequired] = useState(initial?.required ?? true)

  const valid = text.trim().length > 0 && text.length <= 200 && (type !== 'multiple_choice' || options.filter((o) => o.trim()).length >= 2)

  return (
    <Card>
      <div style={{ marginBottom: 12 }}>
        <label style={{ fontSize: 12, color: COLORS.textSecondary }}>Question text</label>
        <input
          value={text}
          onChange={(e) => setText(e.target.value.slice(0, 200))}
          style={{ width: '100%', marginTop: 4, background: COLORS.raised, border: `1px solid ${COLORS.borderStrong}`, borderRadius: 6, padding: 8, color: COLORS.textPrimary }}
        />
      </div>
      <div style={{ marginBottom: 12 }}>
        <label style={{ fontSize: 12, color: COLORS.textSecondary }}>Type</label>
        <select
          value={type}
          onChange={(e) => setType(e.target.value as QuestionType)}
          style={{ display: 'block', marginTop: 4, background: COLORS.raised, border: `1px solid ${COLORS.borderStrong}`, borderRadius: 6, padding: 8, color: COLORS.textPrimary }}
        >
          <option value="multiple_choice">Multiple choice</option>
          <option value="short_text">Short text</option>
          <option value="yes_no">Yes/No</option>
        </select>
      </div>
      {type === 'multiple_choice' && (
        <div style={{ marginBottom: 12 }}>
          <label style={{ fontSize: 12, color: COLORS.textSecondary }}>Options</label>
          {options.map((opt, i) => (
            <div key={i} style={{ display: 'flex', gap: 8, marginTop: 6 }}>
              <input
                value={opt}
                onChange={(e) => {
                  const next = [...options]
                  next[i] = e.target.value.slice(0, 60)
                  setOptions(next)
                }}
                style={{ flex: 1, background: COLORS.raised, border: `1px solid ${COLORS.borderStrong}`, borderRadius: 6, padding: 8, color: COLORS.textPrimary }}
              />
              {options.length > 2 && (
                <SecondaryButton style={{ padding: '4px 10px' }} onClick={() => setOptions(options.filter((_, idx) => idx !== i))}>Remove</SecondaryButton>
              )}
            </div>
          ))}
          {options.length < 8 && (
            <button
              onClick={() => setOptions([...options, ''])}
              style={{ marginTop: 8, background: 'none', border: 'none', color: COLORS.cyan, cursor: 'pointer', fontSize: 12 }}
            >
              + Add option
            </button>
          )}
        </div>
      )}
      <label style={{ fontSize: 13, display: 'block', marginBottom: 16 }}>
        <input type="checkbox" checked={required} onChange={(e) => setRequired(e.target.checked)} /> Required
      </label>
      <div style={{ display: 'flex', gap: 8 }}>
        <PrimaryButton
          disabled={!valid}
          onClick={() =>
            onSave({
              id: initial?.id ?? crypto.randomUUID(),
              text,
              type,
              options: type === 'multiple_choice' ? options.filter((o) => o.trim()) : undefined,
              required,
            })
          }
        >
          {initial ? 'Save question' : 'Add question'}
        </PrimaryButton>
        <SecondaryButton onClick={onCancel}>Cancel</SecondaryButton>
      </div>
    </Card>
  )
}
