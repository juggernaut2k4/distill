'use client'

import { useState } from 'react'

const BATCH1 = ['ai-ml','devops','software-arch','cloud','frontend','typescript','backend','data-engineering','mlops','cybersecurity','testing','databases','open-source','emerging-tech','ml-fundamentals','deep-learning','nlp','data-viz','bi-analytics','statistics','python','product-strategy','agile','user-research','growth','go-to-market','ux-design','design-systems']
const BATCH2 = ['interaction-design','accessibility','motion-design','ai-for-design','leadership','digital-transformation','finance','operations','people-org','risk','innovation','data-decisions','ma','stakeholder','content-seo','performance-mktg','brand','crm-automation','social-community','cro','ai-marketing','fintech','corp-finance','esg','financial-modeling','talent','learning-dev','dei','hr-tech']

interface SeedDetail { domainId: string; inserted: number; error?: string }

export default function SeedAdminPage() {
  const [log, setLog] = useState<string[]>([])
  const [running, setRunning] = useState(false)
  const [failedDomains, setFailedDomains] = useState<string[]>([])

  function addLog(msg: string) {
    setLog((prev) => [...prev, `${new Date().toLocaleTimeString()} — ${msg}`])
  }

  async function seedBatch(domains: string[], replace: boolean, label: string): Promise<string[]> {
    addLog(`${label}: starting (${domains.length} domains)…`)
    const res = await fetch('/api/admin/seed-topics', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ replace, domains }),
    })
    const data = await res.json() as { inserted: number; domains: number; failed: number; details: SeedDetail[] }
    const failed = (data.details ?? []).filter((d) => d.error).map((d) => d.domainId)
    if (res.ok) {
      addLog(`${label}: done — inserted ${data.inserted} topics across ${data.domains} domains (${data.failed} failed)`)
      if (failed.length > 0) {
        addLog(`${label}: failed domains — ${failed.join(', ')}`)
      }
    } else {
      addLog(`${label}: ERROR — ${JSON.stringify(data)}`)
    }
    return failed
  }

  async function handleSeedAll() {
    setRunning(true)
    setLog([])
    setFailedDomains([])
    try {
      const f1 = await seedBatch(BATCH1, true, 'Batch 1')
      const f2 = await seedBatch(BATCH2, true, 'Batch 2')
      const allFailed = [...f1, ...f2]
      setFailedDomains(allFailed)
      addLog(allFailed.length > 0 ? `All done — ${allFailed.length} domains need retry` : 'All done!')
    } catch (err) {
      addLog(`Exception: ${String(err)}`)
    } finally {
      setRunning(false)
    }
  }

  async function handleRetryFailed() {
    if (failedDomains.length === 0) return
    setRunning(true)
    try {
      const failed = await seedBatch(failedDomains, false, 'Retry')
      setFailedDomains(failed)
      if (failed.length === 0) addLog('Retry complete — all domains seeded!')
    } finally {
      setRunning(false)
    }
  }

  async function handleSeedBatch1() {
    setRunning(true)
    try { const f = await seedBatch(BATCH1, true, 'Batch 1'); setFailedDomains(f) }
    finally { setRunning(false) }
  }

  async function handleSeedBatch2() {
    setRunning(true)
    try { const f = await seedBatch(BATCH2, true, 'Batch 2'); setFailedDomains((p) => [...p, ...f]) }
    finally { setRunning(false) }
  }

  async function handleSetCeoProfile() {
    setRunning(true)
    try {
      addLog('Setting CEO profile (role + domains)…')
      const res = await fetch('/api/topics', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          topics: [],
          profile: {
            role: 'ceo',
            domains: ['ai-ml', 'leadership', 'digital-transformation', 'finance', 'data-decisions', 'innovation', 'risk'],
            primaryDomain: 'ai-ml',
          },
        }),
      })
      const data = await res.json()
      addLog(res.ok ? 'Profile set — role=ceo, domains=[ai-ml, leadership, …]' : `Profile update failed: ${JSON.stringify(data)}`)
    } finally {
      setRunning(false)
    }
  }

  return (
    <div style={{ padding: 32, background: '#080808', minHeight: '100vh', color: '#fff', fontFamily: 'monospace' }}>
      <h1 style={{ fontSize: 24, marginBottom: 8 }}>Topic Catalog Admin</h1>
      <p style={{ color: '#475569', marginBottom: 24, fontSize: 14 }}>Seeds role-aware topics into the topic_catalog table via Claude API</p>

      <div style={{ marginBottom: 24, padding: 16, background: '#111', border: '1px solid #333', borderRadius: 8 }}>
        <p style={{ color: '#94A3B8', marginBottom: 12, fontSize: 14 }}>Test profile setup — sets your DB profile to CEO so the catalog shows relevant topics</p>
        <button onClick={handleSetCeoProfile} disabled={running}
          style={{ padding: '10px 20px', background: '#06B6D4', color: '#fff', border: 'none', borderRadius: 8, cursor: running ? 'not-allowed' : 'pointer', fontSize: 14 }}>
          Set My Profile → CEO + AI domains
        </button>
      </div>

      <div style={{ display: 'flex', gap: 12, marginBottom: 24, flexWrap: 'wrap' }}>
        <button onClick={handleSeedAll} disabled={running}
          style={{ padding: '12px 24px', background: running ? '#333' : '#7C3AED', color: '#fff', border: 'none', borderRadius: 8, cursor: running ? 'not-allowed' : 'pointer', fontSize: 16 }}>
          {running ? 'Running…' : 'Seed All (Both Batches)'}
        </button>
        {failedDomains.length > 0 && (
          <button onClick={handleRetryFailed} disabled={running}
            style={{ padding: '12px 24px', background: '#EF4444', color: '#fff', border: 'none', borderRadius: 8, cursor: running ? 'not-allowed' : 'pointer', fontSize: 16 }}>
            Retry {failedDomains.length} Failed Domains
          </button>
        )}
        <button onClick={handleSeedBatch1} disabled={running}
          style={{ padding: '12px 24px', background: '#1A1A1A', color: '#fff', border: '1px solid #333', borderRadius: 8, cursor: running ? 'not-allowed' : 'pointer' }}>
          Batch 1 Only
        </button>
        <button onClick={handleSeedBatch2} disabled={running}
          style={{ padding: '12px 24px', background: '#1A1A1A', color: '#fff', border: '1px solid #333', borderRadius: 8, cursor: running ? 'not-allowed' : 'pointer' }}>
          Batch 2 Only
        </button>
      </div>

      {failedDomains.length > 0 && (
        <div style={{ background: '#1a0a0a', border: '1px solid #EF4444', borderRadius: 8, padding: 12, marginBottom: 16, fontSize: 13 }}>
          <strong style={{ color: '#EF4444' }}>Failed domains ({failedDomains.length}):</strong>{' '}
          <span style={{ color: '#94A3B8' }}>{failedDomains.join(', ')}</span>
        </div>
      )}

      <div style={{ background: '#111', border: '1px solid #222', borderRadius: 8, padding: 16, minHeight: 200 }}>
        {log.length === 0 && <p style={{ color: '#475569' }}>Log will appear here…</p>}
        {log.map((line, i) => (
          <p key={i} style={{ margin: '4px 0', color: line.includes('ERROR') || line.includes('failed domains') ? '#EF4444' : line.includes('done') || line.includes('All done') || line.includes('complete') ? '#10B981' : '#94A3B8' }}>
            {line}
          </p>
        ))}
      </div>
    </div>
  )
}
