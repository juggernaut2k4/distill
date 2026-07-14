-- B2B-03 — Designer/Configurator
-- See docs/specs/B2B-03-requirement-document.md Section 6 and architecture.md
-- Section 12.1 for full rationale. This migration is additive only — it does
-- not modify any B2B-02 table's columns (071/072), only extends
-- usage_events.event_type's CHECK constraint (Section 6.4/6.5) and adds a
-- 'failed' status to a new table below.
--
-- Isolation mechanism (Requirement Doc Section 6.4): every table below
-- carries partner_account_id from creation, RLS enabled, service-role-only
-- policy — identical pattern to every B2B-02 table. Tenant isolation itself
-- is enforced at the APPLICATION layer (every Configurator route requires
-- requirePartnerAdmin(partner_account_id) + explicit .eq('partner_account_id', ...)
-- scoping), not by RLS — Clerk is not Supabase auth, matching B2B-02's own
-- documented precedent.

-- ─── QUESTIONNAIRE (Section 6.1) ───────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS partner_questionnaires (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  partner_account_id  UUID NOT NULL REFERENCES partner_accounts(id) ON DELETE CASCADE,
  status              TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published')),
  layout              TEXT NOT NULL DEFAULT 'single_page' CHECK (layout IN ('single_page', 'multi_page')),
  schema              JSONB NOT NULL DEFAULT '[]'::jsonb, -- [{id, text, type, options?, required}]
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_partner_questionnaires_account ON partner_questionnaires(partner_account_id);
-- At most one 'published' row per partner_account_id — enforced in application
-- code (lib/partner/questionnaire.ts publishQuestionnaire()), not a DB
-- constraint, per architecture.md Section 12.1's note on the transactional
-- "set target published, set siblings back to draft" write.

CREATE TRIGGER update_partner_questionnaires_updated_at
  BEFORE UPDATE ON partner_questionnaires
  FOR EACH ROW EXECUTE PROCEDURE update_updated_at_column();

ALTER TABLE partner_questionnaires ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role full access on partner_questionnaires"
  ON partner_questionnaires FOR ALL
  USING (auth.role() = 'service_role');

-- Thin audit-only log for questionnaire submission delivery — deliberately NO
-- payload column (Section 6.1's "thin audit exception, explicitly scoped").
CREATE TABLE IF NOT EXISTS questionnaire_dispatch_log (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  partner_account_id  UUID NOT NULL REFERENCES partner_accounts(id) ON DELETE CASCADE,
  submitted_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  delivery_status     TEXT NOT NULL CHECK (delivery_status IN ('delivered', 'failed')),
  http_status_code    INTEGER
);
CREATE INDEX IF NOT EXISTS idx_questionnaire_dispatch_log_account
  ON questionnaire_dispatch_log(partner_account_id, submitted_at DESC);

ALTER TABLE questionnaire_dispatch_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role full access on questionnaire_dispatch_log"
  ON questionnaire_dispatch_log FOR ALL
  USING (auth.role() = 'service_role');

-- ─── TOPICS (Section 6.2) ───────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS partner_topic_config (
  id                    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  partner_account_id    UUID NOT NULL UNIQUE REFERENCES partner_accounts(id) ON DELETE CASCADE,
  topics_source         TEXT NOT NULL DEFAULT 'clio_generated' CHECK (topics_source IN ('clio_generated', 'partner_supplied')),
  prerequisites_source  TEXT NOT NULL DEFAULT 'clio_generated' CHECK (prerequisites_source IN ('clio_generated', 'partner_supplied')),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TRIGGER update_partner_topic_config_updated_at
  BEFORE UPDATE ON partner_topic_config
  FOR EACH ROW EXECUTE PROCEDURE update_updated_at_column();

ALTER TABLE partner_topic_config ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role full access on partner_topic_config"
  ON partner_topic_config FOR ALL
  USING (auth.role() = 'service_role');

-- ─── CONTENT SOURCE TOGGLE ──────────────────────────────────────────────────────
-- GAP NOTE (flagged, not silently invented): Section 4.A.3's "Where does
-- session content come from?" toggle (Clio-generated vs. partner-supplied) is
-- specified in the Requirement Document's wireframe but architecture.md
-- Section 12.1's literal DDL does not give it a table — only
-- partner_topic_config (topics/prerequisites) and partner_content_items
-- (generation staging) are defined there. This table closes that gap using
-- the identical shape/isolation pattern as partner_topic_config, rather than
-- overloading an unrelated table's columns.
CREATE TABLE IF NOT EXISTS partner_content_config (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  partner_account_id  UUID NOT NULL UNIQUE REFERENCES partner_accounts(id) ON DELETE CASCADE,
  content_source      TEXT NOT NULL DEFAULT 'clio_generated' CHECK (content_source IN ('clio_generated', 'partner_supplied')),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TRIGGER update_partner_content_config_updated_at
  BEFORE UPDATE ON partner_content_config
  FOR EACH ROW EXECUTE PROCEDURE update_updated_at_column();

ALTER TABLE partner_content_config ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role full access on partner_content_config"
  ON partner_content_config FOR ALL
  USING (auth.role() = 'service_role');

-- ─── CONTENT (Section 6.3) ──────────────────────────────────────────────────────
-- Transient staging only — never a permanent content store. draft_payload is
-- nulled on approved/rejected/discard (Section 6.3, architecture.md 12.4).
-- 'failed' status added per Section 8's error-state row (generation pipeline
-- failure), not present in architecture.md's original literal DDL snippet but
-- required by its own CHECK-extension list in Section 12 ("Dependencies").

CREATE TABLE IF NOT EXISTS partner_content_items (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  partner_account_id  UUID NOT NULL REFERENCES partner_accounts(id) ON DELETE CASCADE,
  partner_topic_ref   TEXT NOT NULL,
  status              TEXT NOT NULL DEFAULT 'generating'
                        CHECK (status IN ('generating', 'ready_for_review', 'approved', 'rejected', 'failed')),
  draft_payload       JSONB,               -- NULL once approved/rejected/discarded
  content_ref         UUID,                -- minted on approval; becomes the pushed content_ref
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at          TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '7 days'),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_partner_content_items_account ON partner_content_items(partner_account_id, status);
CREATE INDEX IF NOT EXISTS idx_partner_content_items_expiry ON partner_content_items(expires_at);

CREATE TRIGGER update_partner_content_items_updated_at
  BEFORE UPDATE ON partner_content_items
  FOR EACH ROW EXECUTE PROCEDURE update_updated_at_column();

ALTER TABLE partner_content_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role full access on partner_content_items"
  ON partner_content_items FOR ALL
  USING (auth.role() = 'service_role');

-- ─── VISUALIZATION — Level A/B/C (Section 6.4) ──────────────────────────────────

CREATE TABLE IF NOT EXISTS partner_theme_config (
  id                      UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  partner_account_id      UUID NOT NULL UNIQUE REFERENCES partner_accounts(id) ON DELETE CASCADE,
  theme_label             TEXT,
  primary_color           TEXT NOT NULL DEFAULT '#7C3AED' CHECK (primary_color ~ '^#[0-9A-Fa-f]{6}$'),
  secondary_color         TEXT NOT NULL DEFAULT '#06B6D4' CHECK (secondary_color ~ '^#[0-9A-Fa-f]{6}$'),
  accent_color            TEXT NOT NULL DEFAULT '#F59E0B' CHECK (accent_color ~ '^#[0-9A-Fa-f]{6}$'),
  font_family             TEXT NOT NULL DEFAULT 'Inter'
                            CHECK (font_family IN ('Inter', 'Roboto', 'Source Sans Pro', 'IBM Plex Sans', 'system-ui')),
  corner_style            TEXT NOT NULL DEFAULT 'soft' CHECK (corner_style IN ('sharp', 'soft', 'rounded')),
  spacing_scale           TEXT NOT NULL DEFAULT 'standard' CHECK (spacing_scale IN ('compact', 'standard', 'spacious')),
  assistant_display_name  TEXT, -- NULL => "your AI guide" fallback in the Hume system prompt; never "Clio"
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TRIGGER update_partner_theme_config_updated_at
  BEFORE UPDATE ON partner_theme_config
  FOR EACH ROW EXECUTE PROCEDURE update_updated_at_column();

ALTER TABLE partner_theme_config ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role full access on partner_theme_config"
  ON partner_theme_config FOR ALL
  USING (auth.role() = 'service_role');

CREATE TABLE IF NOT EXISTS partner_template_config (
  id                    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  partner_account_id    UUID NOT NULL REFERENCES partner_accounts(id) ON DELETE CASCADE,
  template_name         TEXT NOT NULL REFERENCES template_library(template_name),
  title_override        TEXT,
  show_so_what_footer   BOOLEAN NOT NULL DEFAULT TRUE,
  motion_enabled        BOOLEAN NOT NULL DEFAULT TRUE,
  color_variant         TEXT NOT NULL DEFAULT 'default' CHECK (color_variant IN ('default', 'lighter', 'darker')),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (partner_account_id, template_name)
);
CREATE INDEX IF NOT EXISTS idx_partner_template_config_account ON partner_template_config(partner_account_id);

CREATE TRIGGER update_partner_template_config_updated_at
  BEFORE UPDATE ON partner_template_config
  FOR EACH ROW EXECUTE PROCEDURE update_updated_at_column();

ALTER TABLE partner_template_config ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role full access on partner_template_config"
  ON partner_template_config FOR ALL
  USING (auth.role() = 'service_role');

CREATE TABLE IF NOT EXISTS partner_component_config (
  id                    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  partner_account_id    UUID NOT NULL REFERENCES partner_accounts(id) ON DELETE CASCADE,
  template_name         TEXT NOT NULL REFERENCES template_library(template_name),
  component_slot        TEXT NOT NULL, -- e.g. 'cell', 'legend', 'connector', 'callout_card'
  style_mode            TEXT NOT NULL DEFAULT 'fill' CHECK (style_mode IN ('fill', 'outline', 'neon')),
  motion                TEXT NOT NULL DEFAULT 'none' CHECK (motion IN ('none', 'fade', 'stagger', 'slide')),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (partner_account_id, template_name, component_slot)
);
CREATE INDEX IF NOT EXISTS idx_partner_component_config_account ON partner_component_config(partner_account_id);

CREATE TRIGGER update_partner_component_config_updated_at
  BEFORE UPDATE ON partner_component_config
  FOR EACH ROW EXECUTE PROCEDURE update_updated_at_column();

ALTER TABLE partner_component_config ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role full access on partner_component_config"
  ON partner_component_config FOR ALL
  USING (auth.role() = 'service_role');

-- ─── PREFERENCE METER (Section 6.5) ─────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS partner_design_preference (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  partner_account_id  UUID NOT NULL UNIQUE REFERENCES partner_accounts(id) ON DELETE CASCADE,
  score               INTEGER NOT NULL DEFAULT 0 CHECK (score BETWEEN 0 AND 100),
  domains_touched     JSONB NOT NULL DEFAULT '[]'::jsonb, -- subset of ['color','font','spacing','motion']
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TRIGGER update_partner_design_preference_updated_at
  BEFORE UPDATE ON partner_design_preference
  FOR EACH ROW EXECUTE PROCEDURE update_updated_at_column();

ALTER TABLE partner_design_preference ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role full access on partner_design_preference"
  ON partner_design_preference FOR ALL
  USING (auth.role() = 'service_role');

-- ─── PARTNER-AUTHORED CUSTOM TEMPLATES (Section 6.4, Section 11 Q1 resolution) ──
-- Distinct from, and never joined/written to, template_library — RTV-04's
-- global gate, table, and 27-renderer set are entirely untouched by this table.

CREATE TABLE IF NOT EXISTS partner_custom_templates (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  partner_account_id  UUID NOT NULL REFERENCES partner_accounts(id) ON DELETE CASCADE,
  template_label      TEXT NOT NULL,
  skeleton_schema     JSONB NOT NULL, -- structural definition only; enforced at write-time (app layer) to
                                       -- contain only typed/enum/regex-validated primitives — no raw
                                       -- CSS, HTML/markup, or executable code, ever
  status              TEXT NOT NULL DEFAULT 'pending_review' CHECK (status IN ('pending_review', 'live')),
  source              TEXT NOT NULL CHECK (source IN ('free_text_generated', 'skeleton_generated')),
  confirmed_at        TIMESTAMPTZ, -- set the moment the partner-admin clicks [Confirm & make live]
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (partner_account_id, template_label)
);
CREATE INDEX IF NOT EXISTS idx_partner_custom_templates_account ON partner_custom_templates(partner_account_id, status);
-- Only status='live' rows are ever eligible for selectTemplate()/render — enforced
-- in application code at the render-path query (lib/partner/custom-templates.ts
-- selectPartnerTemplate()), not by a DB trigger — matches this document's
-- existing app-layer-isolation precedent (Requirement Doc Section 6.4).

CREATE TRIGGER update_partner_custom_templates_updated_at
  BEFORE UPDATE ON partner_custom_templates
  FOR EACH ROW EXECUTE PROCEDURE update_updated_at_column();

ALTER TABLE partner_custom_templates ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role full access on partner_custom_templates"
  ON partner_custom_templates FOR ALL
  USING (auth.role() = 'service_role');

-- ─── USAGE_EVENTS extension (Section 6.4/6.5) ───────────────────────────────────
-- Extends the CHECK constraint with the 3 new AI-authoring billable actions
-- (Section 6.5) plus the 1 new net-new-template-generation action (Section 6.4
-- / Section 11 Q1 resolution). Only applied if migration 072 (usage_events
-- itself) has already been applied — this ALTER is a no-op-safe extension of
-- that table's own CHECK constraint, matching architecture.md Section 12.1
-- exactly.

ALTER TABLE usage_events DROP CONSTRAINT IF EXISTS usage_events_event_type_check;
ALTER TABLE usage_events ADD CONSTRAINT usage_events_event_type_check
  CHECK (event_type IN (
    'voice_minute', 'llm_generation_topic', 'llm_generation_content', 'llm_generation_prerequisite',
    'llm_generation_skeleton', 'llm_generation_discovery', 'llm_generation_sample_fill',
    'llm_generation_new_template'
  ));

COMMENT ON TABLE partner_questionnaires IS 'B2B-03: partner-authored onboarding questionnaire definitions. Submissions are never persisted — see questionnaire_dispatch_log.';
COMMENT ON TABLE partner_content_items IS 'B2B-03: transient content-generation staging only, never a permanent content store — draft_payload is nulled on approve/reject/discard.';
COMMENT ON TABLE partner_theme_config IS 'B2B-03: Visualization Level A (Application/product) — always applies, Clio defaults as fallback.';
COMMENT ON TABLE partner_template_config IS 'B2B-03: Visualization Level B (Template) — only for already-approved template_library rows.';
COMMENT ON TABLE partner_component_config IS 'B2B-03: Visualization Level C (Component/container).';
COMMENT ON TABLE partner_custom_templates IS 'B2B-03: wholly-new partner-authored template skeletons, partner-scoped, never joined to template_library. Only status=live rows are ever render-eligible.';
