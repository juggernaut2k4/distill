'use client'

import { useEffect, useState } from 'react'
import type { AdminPartnerAccount } from '@/lib/partner/admin-accounts'
import type { PartnerThemeConfig } from '@/lib/partner/theme'
import { ConfiguratorShell, Card, PrimaryButton, SecondaryButton, COLORS } from '../_shared'

const FONTS = ['Inter', 'Roboto', 'Source Sans Pro', 'IBM Plex Sans', 'system-ui']

type Screen =
  | { kind: 'theme' }
  | { kind: 'template-list' }
  | { kind: 'template-detail'; templateName: string }

interface TemplateListItem {
  templateName: string
  displayName: string
  parameterized: boolean
}

export default function VisualizationClient({ accounts, activePartnerAccountId }: { accounts: AdminPartnerAccount[]; activePartnerAccountId: string }) {
  const [screen, setScreen] = useState<Screen>({ kind: 'theme' })

  return (
    <ConfiguratorShell accounts={accounts} activePartnerAccountId={activePartnerAccountId} title="Visualization" backHref={`/dashboard/configurator?partner_account_id=${activePartnerAccountId}`}>
      <div style={{ display: 'flex', gap: 16, marginBottom: 20, fontSize: 13 }}>
        <button onClick={() => setScreen({ kind: 'theme' })} style={{ background: 'none', border: 'none', color: screen.kind === 'theme' ? COLORS.textPrimary : COLORS.textSecondary, cursor: 'pointer', fontWeight: screen.kind === 'theme' ? 700 : 400 }}>
          Theme
        </button>
        <button onClick={() => setScreen({ kind: 'template-list' })} style={{ background: 'none', border: 'none', color: screen.kind !== 'theme' ? COLORS.textPrimary : COLORS.textSecondary, cursor: 'pointer', fontWeight: screen.kind !== 'theme' ? 700 : 400 }}>
          Templates
        </button>
      </div>

      {screen.kind === 'theme' && <ThemeScreen partnerAccountId={activePartnerAccountId} />}
      {screen.kind === 'template-list' && (
        <TemplateListScreen partnerAccountId={activePartnerAccountId} onOpen={(templateName) => setScreen({ kind: 'template-detail', templateName })} />
      )}
      {screen.kind === 'template-detail' && (
        <TemplateDetailScreen partnerAccountId={activePartnerAccountId} templateName={screen.templateName} onBack={() => setScreen({ kind: 'template-list' })} />
      )}
    </ConfiguratorShell>
  )
}

function ThemeScreen({ partnerAccountId }: { partnerAccountId: string }) {
  const [theme, setTheme] = useState<PartnerThemeConfig | null>(null)

  useEffect(() => {
    fetch(`/api/admin/configurator/theme?partner_account_id=${partnerAccountId}`)
      .then((r) => r.json())
      .then((data) => setTheme(data.theme))
  }, [partnerAccountId])

  if (!theme) return <p style={{ color: COLORS.textSecondary, fontSize: 13 }}>Loading…</p>

  async function save() {
    if (!theme) return
    const res = await fetch('/api/admin/configurator/theme', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        partner_account_id: partnerAccountId,
        theme_label: theme.themeLabel,
        primary_color: theme.primaryColor,
        secondary_color: theme.secondaryColor,
        accent_color: theme.accentColor,
        font_family: theme.fontFamily,
        corner_style: theme.cornerStyle,
        spacing_scale: theme.spacingScale,
        assistant_display_name: theme.assistantDisplayName,
      }),
    })
    if (res.ok) setTheme((await res.json()).theme)
  }

  const hexValid = (v: string) => /^#[0-9A-Fa-f]{6}$/.test(v)

  return (
    <Card>
      <Field label="Theme name">
        <TextInput value={theme.themeLabel ?? ''} onChange={(v) => setTheme({ ...theme, themeLabel: v })} />
      </Field>
      <div style={{ display: 'flex', gap: 24, marginBottom: 16 }}>
        <Field label="Primary color">
          <TextInput value={theme.primaryColor} onChange={(v) => setTheme({ ...theme, primaryColor: v })} invalid={!hexValid(theme.primaryColor)} />
        </Field>
        <Field label="Secondary color">
          <TextInput value={theme.secondaryColor} onChange={(v) => setTheme({ ...theme, secondaryColor: v })} invalid={!hexValid(theme.secondaryColor)} />
        </Field>
        <Field label="Accent color">
          <TextInput value={theme.accentColor} onChange={(v) => setTheme({ ...theme, accentColor: v })} invalid={!hexValid(theme.accentColor)} />
        </Field>
      </div>
      <Field label="Font family">
        <select
          value={theme.fontFamily}
          onChange={(e) => setTheme({ ...theme, fontFamily: e.target.value })}
          style={selectStyle}
        >
          {FONTS.map((f) => <option key={f} value={f}>{f}</option>)}
        </select>
      </Field>
      <Field label="Corner style">
        {(['sharp', 'soft', 'rounded'] as const).map((v) => (
          <label key={v} style={{ marginRight: 16, fontSize: 13 }}>
            <input type="radio" checked={theme.cornerStyle === v} onChange={() => setTheme({ ...theme, cornerStyle: v })} /> {v[0].toUpperCase() + v.slice(1)}
          </label>
        ))}
      </Field>
      <Field label="Spacing">
        {(['compact', 'standard', 'spacious'] as const).map((v) => (
          <label key={v} style={{ marginRight: 16, fontSize: 13 }}>
            <input type="radio" checked={theme.spacingScale === v} onChange={() => setTheme({ ...theme, spacingScale: v })} /> {v[0].toUpperCase() + v.slice(1)}
          </label>
        ))}
      </Field>
      <Field label="Assistant display name (spoken persona — never defaults to &quot;Clio&quot;)">
        <TextInput value={theme.assistantDisplayName ?? ''} onChange={(v) => setTheme({ ...theme, assistantDisplayName: v || null })} placeholder="your AI guide" />
      </Field>
      <PrimaryButton disabled={!hexValid(theme.primaryColor) || !hexValid(theme.secondaryColor) || !hexValid(theme.accentColor)} onClick={save}>
        Save theme
      </PrimaryButton>
    </Card>
  )
}

function TemplateListScreen({ partnerAccountId, onOpen }: { partnerAccountId: string; onOpen: (templateName: string) => void }) {
  const [templates, setTemplates] = useState<TemplateListItem[]>([])
  const [totalApproved, setTotalApproved] = useState(0)
  const [totalTemplates, setTotalTemplates] = useState(0)
  const [freeText, setFreeText] = useState('')
  const [discoveryResult, setDiscoveryResult] = useState<{ noMatch: boolean; bestMatch: { templateName: string; reasoning: string; confidence: string } | null } | null>(null)

  useEffect(() => {
    fetch(`/api/admin/configurator/templates?partner_account_id=${partnerAccountId}`)
      .then((r) => r.json())
      .then((data) => {
        setTemplates(data.templates ?? [])
        setTotalApproved(data.total_approved ?? 0)
        setTotalTemplates(data.total_templates ?? 0)
      })
  }, [partnerAccountId])

  async function discover() {
    if (!freeText.trim()) return
    const res = await fetch('/api/admin/configurator/templates/discover', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ partner_account_id: partnerAccountId, free_text: freeText }),
    })
    const data = await res.json()
    setDiscoveryResult({ noMatch: Boolean(data.no_match), bestMatch: data.best_match })
  }

  return (
    <div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 20 }}>
        <TextInput value={freeText} onChange={setFreeText} placeholder="Search or describe what you want to show..." style={{ flex: 1 }} />
        <PrimaryButton onClick={discover}>Go</PrimaryButton>
      </div>

      {discoveryResult && (
        <Card style={{ marginBottom: 20 }}>
          {discoveryResult.bestMatch ? (
            <div>
              <p style={{ fontSize: 14, fontWeight: 600 }}>
                Best match: {discoveryResult.bestMatch.templateName}{' '}
                <span style={{ fontSize: 11, color: COLORS.textSecondary }}>Confidence: {discoveryResult.bestMatch.confidence}</span>
              </p>
              <p style={{ fontSize: 12, color: COLORS.textSecondary, marginBottom: 12 }}>{discoveryResult.bestMatch.reasoning}</p>
              <div style={{ display: 'flex', gap: 8 }}>
                <PrimaryButton onClick={() => onOpen(discoveryResult.bestMatch!.templateName)}>Use this template</PrimaryButton>
                <SecondaryButton
                  onClick={async () => {
                    await fetch('/api/admin/configurator/templates/discover', {
                      method: 'PATCH',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ partner_account_id: partnerAccountId }),
                    })
                    setDiscoveryResult(null)
                  }}
                >
                  Not quite — see other options
                </SecondaryButton>
              </div>
            </div>
          ) : (
            <div>
              <p style={{ fontSize: 13, marginBottom: 12 }}>
                No existing template matches &quot;{freeText}&quot; closely enough for Clio to recommend one confidently.
              </p>
              <div style={{ display: 'flex', gap: 8 }}>
                <SecondaryButton onClick={() => setDiscoveryResult(null)}>Try describing it differently</SecondaryButton>
                <GenerateNewButton partnerAccountId={partnerAccountId} freeText={freeText} />
                <SecondaryButton onClick={() => setDiscoveryResult(null)}>Browse the full template library instead</SecondaryButton>
              </div>
            </div>
          )}
        </Card>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, marginBottom: 16 }}>
        {templates.map((t) => (
          <Card key={t.templateName} style={{ cursor: 'pointer' }}>
            <div onClick={() => onOpen(t.templateName)}>
              <p style={{ fontWeight: 600, marginBottom: 4 }}>{t.displayName}</p>
              <p style={{ fontSize: 12, color: t.parameterized ? COLORS.green : COLORS.textSecondary }}>
                {t.parameterized ? '✓ Parameterized' : 'Not customized'}
              </p>
            </div>
          </Card>
        ))}
      </div>

      <p style={{ fontSize: 12, color: COLORS.textMuted }}>
        {totalApproved} of {totalTemplates} Clio templates are currently available to customize.
        {totalApproved === 0 && ' (Arun hasn’t approved any base templates yet — check back soon.)'}
      </p>
    </div>
  )
}

function GenerateNewButton({ partnerAccountId, freeText }: { partnerAccountId: string; freeText: string }) {
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<{ id: string; templateLabel: string } | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function generate() {
    setBusy(true)
    setError(null)
    const res = await fetch('/api/admin/configurator/templates/generate-new', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        partner_account_id: partnerAccountId,
        template_label: freeText.slice(0, 100),
        free_text_description: freeText,
        source: 'free_text_generated',
      }),
    })
    setBusy(false)
    if (res.ok) {
      const data = await res.json()
      setResult({ id: data.custom_template.id, templateLabel: data.custom_template.templateLabel })
    } else {
      setError('Couldn’t generate a safe template — try again or describe it differently.')
    }
  }

  async function confirm() {
    if (!result) return
    await fetch(`/api/admin/configurator/templates/custom/${result.id}/confirm`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ partner_account_id: partnerAccountId }),
    })
    setResult(null)
  }

  if (result) {
    return (
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <span style={{ fontSize: 12, color: COLORS.textSecondary }}>&quot;{result.templateLabel}&quot; generated (pending review)</span>
        <PrimaryButton onClick={confirm}>Confirm &amp; make live</PrimaryButton>
      </div>
    )
  }

  return (
    <div>
      <SecondaryButton disabled={busy} onClick={generate}>{busy ? 'Generating…' : 'Generate a new template'}</SecondaryButton>
      {error && <p style={{ fontSize: 11, color: COLORS.red, marginTop: 6 }}>{error}</p>}
    </div>
  )
}

function TemplateDetailScreen({ partnerAccountId, templateName, onBack }: { partnerAccountId: string; templateName: string; onBack: () => void }) {
  const [config, setConfig] = useState({ titleOverride: '', showSoWhatFooter: true, motionEnabled: true, colorVariant: 'default' as 'default' | 'lighter' | 'darker' })
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetch(`/api/admin/configurator/templates/${templateName}?partner_account_id=${partnerAccountId}`)
      .then((r) => r.json())
      .then((data) => {
        if (data.config) {
          setConfig({
            titleOverride: data.config.titleOverride ?? '',
            showSoWhatFooter: data.config.showSoWhatFooter,
            motionEnabled: data.config.motionEnabled,
            colorVariant: data.config.colorVariant,
          })
        }
      })
  }, [partnerAccountId, templateName])

  async function save() {
    setError(null)
    const res = await fetch(`/api/admin/configurator/templates/${templateName}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        partner_account_id: partnerAccountId,
        title_override: config.titleOverride || null,
        show_so_what_footer: config.showSoWhatFooter,
        motion_enabled: config.motionEnabled,
        color_variant: config.colorVariant,
      }),
    })
    if (!res.ok) {
      const data = await res.json().catch(() => ({}))
      setError(data.error === 'template_not_approved' ? 'This template is not yet approved by Arun.' : 'Save failed.')
    }
  }

  return (
    <div>
      <button onClick={onBack} style={{ background: 'none', border: 'none', color: COLORS.textSecondary, cursor: 'pointer', fontSize: 13, marginBottom: 16 }}>
        ← Templates
      </button>
      <h2 style={{ fontSize: 16, fontWeight: 700, marginBottom: 16 }}>{templateName}</h2>

      <Card style={{ marginBottom: 16 }}>
        <p style={{ fontSize: 13, fontWeight: 600, marginBottom: 12 }}>Template-level</p>
        <Field label="Title override">
          <TextInput value={config.titleOverride} onChange={(v) => setConfig({ ...config, titleOverride: v })} />
        </Field>
        <Field label="Show &quot;So what?&quot; footer">
          <label style={{ marginRight: 16, fontSize: 13 }}>
            <input type="radio" checked={config.showSoWhatFooter} onChange={() => setConfig({ ...config, showSoWhatFooter: true })} /> Yes
          </label>
          <label style={{ fontSize: 13 }}>
            <input type="radio" checked={!config.showSoWhatFooter} onChange={() => setConfig({ ...config, showSoWhatFooter: false })} /> No
          </label>
        </Field>
        <Field label="Motion">
          <label style={{ marginRight: 16, fontSize: 13 }}>
            <input type="radio" checked={config.motionEnabled} onChange={() => setConfig({ ...config, motionEnabled: true })} /> On
          </label>
          <label style={{ fontSize: 13 }}>
            <input type="radio" checked={!config.motionEnabled} onChange={() => setConfig({ ...config, motionEnabled: false })} /> Off
          </label>
        </Field>
        <Field label="Color variant">
          {(['default', 'lighter', 'darker'] as const).map((v) => (
            <label key={v} style={{ marginRight: 16, fontSize: 13 }}>
              <input type="radio" checked={config.colorVariant === v} onChange={() => setConfig({ ...config, colorVariant: v })} /> {v[0].toUpperCase() + v.slice(1)}
            </label>
          ))}
        </Field>
      </Card>

      <ComponentSlotEditor partnerAccountId={partnerAccountId} templateName={templateName} />

      {error && <p style={{ fontSize: 12, color: COLORS.red, marginBottom: 12 }}>{error}</p>}
      <PrimaryButton onClick={save}>Save</PrimaryButton>
    </div>
  )
}

function ComponentSlotEditor({ partnerAccountId, templateName }: { partnerAccountId: string; templateName: string }) {
  // Section 12.5 — non-exhaustive fixed slot examples; a full implementation
  // derives this list programmatically at build time from lib/templates/types.ts.
  const KNOWN_SLOTS: Record<string, string[]> = {
    Heatmap: ['cell', 'legend'],
    Overlay: ['zone_marker', 'connector', 'callout_card'],
  }
  const slots = KNOWN_SLOTS[templateName] ?? []
  if (slots.length === 0) return null

  return (
    <Card style={{ marginBottom: 16 }}>
      <p style={{ fontSize: 13, fontWeight: 600, marginBottom: 12 }}>Component-level</p>
      {slots.map((slot) => (
        <ComponentSlotRow key={slot} partnerAccountId={partnerAccountId} templateName={templateName} slot={slot} />
      ))}
    </Card>
  )
}

function ComponentSlotRow({ partnerAccountId, templateName, slot }: { partnerAccountId: string; templateName: string; slot: string }) {
  const [styleMode, setStyleMode] = useState<'fill' | 'outline' | 'neon'>('fill')
  const [motion, setMotion] = useState<'none' | 'fade' | 'stagger' | 'slide'>('none')

  useEffect(() => {
    fetch(`/api/admin/configurator/templates/${templateName}/components/${slot}?partner_account_id=${partnerAccountId}`)
      .then((r) => r.json())
      .then((data) => {
        if (data.config) {
          setStyleMode(data.config.styleMode)
          setMotion(data.config.motion)
        }
      })
  }, [partnerAccountId, templateName, slot])

  async function save(nextStyleMode: typeof styleMode, nextMotion: typeof motion) {
    await fetch(`/api/admin/configurator/templates/${templateName}/components/${slot}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ partner_account_id: partnerAccountId, style_mode: nextStyleMode, motion: nextMotion }),
    })
  }

  return (
    <div style={{ borderTop: `1px solid ${COLORS.borderSubtle}`, paddingTop: 12, marginTop: 12 }}>
      <p style={{ fontSize: 13, fontWeight: 600, marginBottom: 8, textTransform: 'capitalize' }}>{slot.replace('_', ' ')}</p>
      <div style={{ marginBottom: 8 }}>
        {(['fill', 'outline', 'neon'] as const).map((v) => (
          <label key={v} style={{ marginRight: 16, fontSize: 12 }}>
            <input type="radio" checked={styleMode === v} onChange={() => { setStyleMode(v); save(v, motion) }} /> {v[0].toUpperCase() + v.slice(1)}
          </label>
        ))}
      </div>
      <div>
        {(['none', 'fade', 'stagger', 'slide'] as const).map((v) => (
          <label key={v} style={{ marginRight: 16, fontSize: 12 }}>
            <input type="radio" checked={motion === v} onChange={() => { setMotion(v); save(styleMode, v) }} /> {v[0].toUpperCase() + v.slice(1)}
          </label>
        ))}
      </div>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 16 }}>
      <label style={{ fontSize: 12, color: COLORS.textSecondary, display: 'block', marginBottom: 6 }}>{label}</label>
      {children}
    </div>
  )
}

const selectStyle: React.CSSProperties = {
  background: COLORS.raised,
  border: `1px solid ${COLORS.borderStrong}`,
  borderRadius: 6,
  padding: 8,
  color: COLORS.textPrimary,
  fontSize: 13,
}

function TextInput({ value, onChange, invalid, placeholder, style }: { value: string; onChange: (v: string) => void; invalid?: boolean; placeholder?: string; style?: React.CSSProperties }) {
  return (
    <input
      value={value}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
      style={{
        background: COLORS.raised,
        border: `1px solid ${invalid ? COLORS.red : COLORS.borderStrong}`,
        borderRadius: 6,
        padding: 8,
        color: COLORS.textPrimary,
        fontSize: 13,
        ...style,
      }}
    />
  )
}
