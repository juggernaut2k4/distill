'use client'

import { useState } from 'react'

const BATCH1 = ['ai-ml','devops','software-arch','cloud','frontend','typescript','backend','data-engineering','mlops','cybersecurity','testing','databases','open-source','emerging-tech','ml-fundamentals','deep-learning','nlp','data-viz','bi-analytics','statistics','python','product-strategy','agile','user-research','growth','go-to-market','ux-design','design-systems']
const BATCH2 = ['interaction-design','accessibility','motion-design','ai-for-design','leadership','digital-transformation','finance','operations','people-org','risk','innovation','data-decisions','ma','stakeholder','content-seo','performance-mktg','brand','crm-automation','social-community','cro','ai-marketing','fintech','corp-finance','esg','financial-modeling','talent','learning-dev','dei','hr-tech']

export default function SeedAdminPage() {
  const [log, setLog] = useState<string[]>([])
  const [running, setRunning] = useState(false)

  function addLog(msg: string) {
    setLog((prev) => [...prev, `${new Date().toLocaleTimeString()} — ${msg}`])
  }

  async function seedBatch(domains: string[], replace: boolean, label: string) {
    addLog(`${label}: starting (${domains.length} domains)…`)
    const res = await fetch('/api/admin/seed-topics', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ replace, domains }),
    })
    const data = await res.json()
    if (res.ok) {
      addLog(`${label}: done — inserted ${data.inserted} topics across ${data.domains} domains (${data.failed} failed)`)
    } else {
      addLog(`${label}: ERROR — ${JSON.stringify(data)}`)
    }
  }

  async function handleSeedAll() {
    setRunning(true)
    setLog([])
    try {
      await seedBatch(BATCH1, true, 'Batch 1')
      await seedBatch(BATCH2, false, 'Batch 2')
      addLog('All done!')
    } catch (err) {
      addLog(`Exception: ${String(err)}`)
    } finally {
      setRunning(false)
    }
  }

  async function handleSeedBatch1() {
    setRunning(true)
    try { await seedBatch(BATCH1, true, 'Batch 1') }
    finally { setRunning(false) }
  }

  async function handleSeedBatch2() {
    setRunning(true)
    try { await seedBatch(BATCH2, false, 'Batch 2') }
    finally { setRunning(false) }
  }

  return (
    <div style={{ padding: 32, background: '#080808', minHeight: '100vh', color: '#fff', fontFamily: 'monospace' }}>
      <h1 style={{ fontSize: 24, marginBottom: 24 }}>Topic Catalog Admin</h1>

      <div style={{ display: 'flex', gap: 12, marginBottom: 24 }}>
        <button
          onClick={handleSeedAll}
          disabled={running}
          style={{ padding: '12px 24px', background: running ? '#333' : '#7C3AED', color: '#fff', border: 'none', borderRadius: 8, cursor: running ? 'not-allowed' : 'pointer', fontSize: 16 }}
        >
          {running ? 'Running…' : 'Seed All Topics (Both Batches)'}
        </button>
        <button
          onClick={handleSeedBatch1}
          disabled={running}
          style={{ padding: '12px 24px', background: '#1A1A1A', color: '#fff', border: '1px solid #333', borderRadius: 8, cursor: running ? 'not-allowed' : 'pointer' }}
        >
          Batch 1 Only
        </button>
        <button
          onClick={handleSeedBatch2}
          disabled={running}
          style={{ padding: '12px 24px', background: '#1A1A1A', color: '#fff', border: '1px solid #333', borderRadius: 8, cursor: running ? 'not-allowed' : 'pointer' }}
        >
          Batch 2 Only
        </button>
      </div>

      <div style={{ background: '#111', border: '1px solid #222', borderRadius: 8, padding: 16, minHeight: 200 }}>
        {log.length === 0 && <p style={{ color: '#475569' }}>Log will appear here…</p>}
        {log.map((line, i) => (
          <p key={i} style={{ margin: '4px 0', color: line.includes('ERROR') ? '#EF4444' : line.includes('done') || line.includes('All done') ? '#10B981' : '#94A3B8' }}>
            {line}
          </p>
        ))}
      </div>
    </div>
  )
}
