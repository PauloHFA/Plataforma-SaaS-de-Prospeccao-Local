import type { DbContext } from './client.js';

const CORE_DDL = `
CREATE TABLE IF NOT EXISTS plans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  description TEXT NOT NULL,
  price_cents INTEGER NOT NULL DEFAULT 0,
  monthly_credits INTEGER NOT NULL DEFAULT 200,
  max_searches_per_month INTEGER NOT NULL DEFAULT 100,
  max_sites_per_month INTEGER NOT NULL DEFAULT 50,
  max_messages_per_day INTEGER NOT NULL DEFAULT 80,
  max_active_previews INTEGER NOT NULL DEFAULT 30,
  monthly_budget_cents INTEGER NOT NULL DEFAULT 15000,
  allow_byok BOOLEAN NOT NULL DEFAULT TRUE,
  allow_custom_domain BOOLEAN NOT NULL DEFAULT TRUE,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS tenants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  plan_id UUID NOT NULL REFERENCES plans(id),
  status TEXT NOT NULL DEFAULT 'ACTIVE',
  credits_balance INTEGER NOT NULL DEFAULT 200,
  geo_cache_ttl_days INTEGER NOT NULL DEFAULT 15,
  preview_expiration_days INTEGER NOT NULL DEFAULT 14,
  grace_period_days INTEGER NOT NULL DEFAULT 5,
  quarantine_days INTEGER NOT NULL DEFAULT 30,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  name TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'TENANT_OPERATOR',
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS users_tenant_idx ON users(tenant_id);

CREATE TABLE IF NOT EXISTS tenant_secrets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  ciphertext TEXT NOT NULL,
  iv TEXT NOT NULL,
  auth_tag TEXT NOT NULL,
  key_hint TEXT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS tenant_secrets_provider_uidx ON tenant_secrets(tenant_id, provider);

CREATE TABLE IF NOT EXISTS geo_search_cache (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  grid_key TEXT NOT NULL UNIQUE,
  lat DOUBLE PRECISION NOT NULL,
  lng DOUBLE PRECISION NOT NULL,
  radius_km DOUBLE PRECISION NOT NULL,
  keyword TEXT NOT NULL,
  provider TEXT NOT NULL,
  raw_results_json JSONB NOT NULL,
  hit_count INTEGER NOT NULL DEFAULT 0,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS geo_cache_expires_idx ON geo_search_cache(expires_at);

CREATE TABLE IF NOT EXISTS leads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  place_id TEXT NOT NULL,
  business_name TEXT NOT NULL,
  category TEXT NOT NULL,
  niche TEXT NOT NULL,
  phone_raw TEXT,
  phone_e164 TEXT,
  phone_type TEXT NOT NULL DEFAULT 'UNKNOWN',
  whatsapp_valid BOOLEAN,
  whatsapp_checked_at TIMESTAMPTZ,
  email TEXT,
  website_url TEXT,
  website_category TEXT NOT NULL DEFAULT 'NO_WEBSITE',
  website_platform_label TEXT,
  address TEXT NOT NULL,
  neighborhood TEXT NOT NULL DEFAULT 'Centro',
  city TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'SP',
  postal_code TEXT,
  lat DOUBLE PRECISION NOT NULL,
  lng DOUBLE PRECISION NOT NULL,
  rating DOUBLE PRECISION NOT NULL DEFAULT 0,
  review_count INTEGER NOT NULL DEFAULT 0,
  reviews_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  opening_hours_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  photos_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  funnel_stage TEXT NOT NULL DEFAULT 'LEAD_CAPTADO',
  opted_out BOOLEAN NOT NULL DEFAULT FALSE,
  opted_out_at TIMESTAMPTZ,
  opt_out_reason TEXT,
  opt_out_token TEXT NOT NULL UNIQUE,
  last_contacted_at TIMESTAMPTZ,
  dedup_address_key TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS leads_tenant_place_uidx ON leads(tenant_id, place_id);
CREATE INDEX IF NOT EXISTS leads_tenant_stage_idx ON leads(tenant_id, funnel_stage);
CREATE INDEX IF NOT EXISTS leads_tenant_phone_idx ON leads(tenant_id, phone_e164);
CREATE INDEX IF NOT EXISTS leads_tenant_addr_idx ON leads(tenant_id, dedup_address_key);

CREATE TABLE IF NOT EXISTS lead_notes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  lead_id UUID NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  content TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS lead_notes_lead_idx ON lead_notes(tenant_id, lead_id);

CREATE TABLE IF NOT EXISTS site_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  niche TEXT NOT NULL,
  description TEXT NOT NULL,
  default_palette_json JSONB NOT NULL,
  default_typography TEXT NOT NULL DEFAULT 'inter-plus-jakarta',
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS sites (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  lead_id UUID NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  template_id UUID NOT NULL REFERENCES site_templates(id),
  template_slug TEXT NOT NULL,
  subdomain_slug TEXT NOT NULL UNIQUE,
  custom_domain TEXT UNIQUE,
  status TEXT NOT NULL DEFAULT 'PREVIEW',
  schema_version TEXT NOT NULL DEFAULT '1.0',
  content_json JSONB NOT NULL,
  primary_color TEXT NOT NULL,
  font_pairing TEXT NOT NULL DEFAULT 'inter-plus-jakarta',
  preview_views_count INTEGER NOT NULL DEFAULT 0,
  whatsapp_clicks_count INTEGER NOT NULL DEFAULT 0,
  cta_clicks_count INTEGER NOT NULL DEFAULT 0,
  first_viewed_at TIMESTAMPTZ,
  last_viewed_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ,
  published_at TIMESTAMPTZ,
  suspended_at TIMESTAMPTZ,
  archived_at TIMESTAMPTZ,
  client_portal_token TEXT UNIQUE,
  cache_version INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS sites_tenant_idx ON sites(tenant_id, status);
CREATE INDEX IF NOT EXISTS sites_lead_idx ON sites(tenant_id, lead_id);
CREATE INDEX IF NOT EXISTS sites_content_gin_idx ON sites USING GIN (content_json);

CREATE TABLE IF NOT EXISTS site_telemetry_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  site_id UUID NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  device_type TEXT NOT NULL DEFAULT 'desktop',
  user_agent TEXT NOT NULL DEFAULT '',
  ip_hash TEXT NOT NULL DEFAULT '',
  referrer TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS telemetry_site_idx ON site_telemetry_events(tenant_id, site_id, created_at);

CREATE TABLE IF NOT EXISTS messaging_connections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  channel TEXT NOT NULL,
  label TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'DISCONNECTED',
  identifier TEXT NOT NULL,
  qr_code_data TEXT,
  encrypted_config_json TEXT,
  spf_verified BOOLEAN NOT NULL DEFAULT FALSE,
  dkim_verified BOOLEAN NOT NULL DEFAULT FALSE,
  daily_limit INTEGER NOT NULL DEFAULT 80,
  sent_today INTEGER NOT NULL DEFAULT 0,
  last_reset_date TEXT NOT NULL DEFAULT '',
  window_timezone TEXT NOT NULL DEFAULT 'America/Sao_Paulo',
  min_delay_seconds INTEGER NOT NULL DEFAULT 15,
  max_delay_seconds INTEGER NOT NULL DEFAULT 45,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS connections_tenant_idx ON messaging_connections(tenant_id, channel);

CREATE TABLE IF NOT EXISTS message_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  channel TEXT NOT NULL,
  subject TEXT,
  body TEXT NOT NULL,
  variables_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS msg_templates_tenant_idx ON message_templates(tenant_id);

CREATE TABLE IF NOT EXISTS campaigns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  channel TEXT NOT NULL,
  connection_id UUID NOT NULL REFERENCES messaging_connections(id),
  template_id UUID REFERENCES message_templates(id),
  status TEXT NOT NULL DEFAULT 'RUNNING',
  min_delay_ms INTEGER NOT NULL DEFAULT 15000,
  max_delay_ms INTEGER NOT NULL DEFAULT 30000,
  respect_business_hours BOOLEAN NOT NULL DEFAULT TRUE,
  scheduled_at TIMESTAMPTZ,
  total_targets INTEGER NOT NULL DEFAULT 0,
  sent_count INTEGER NOT NULL DEFAULT 0,
  blocked_count INTEGER NOT NULL DEFAULT 0,
  failed_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS campaigns_tenant_idx ON campaigns(tenant_id);

CREATE TABLE IF NOT EXISTS campaign_dispatches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  campaign_id UUID REFERENCES campaigns(id) ON DELETE CASCADE,
  lead_id UUID NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  site_id UUID REFERENCES sites(id) ON DELETE SET NULL,
  connection_id UUID NOT NULL REFERENCES messaging_connections(id),
  channel TEXT NOT NULL,
  recipient TEXT NOT NULL,
  rendered_subject TEXT,
  rendered_body TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'QUEUED',
  block_reason TEXT,
  external_message_id TEXT,
  scheduled_for TIMESTAMPTZ,
  sent_at TIMESTAMPTZ,
  delivered_at TIMESTAMPTZ,
  read_at TIMESTAMPTZ,
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS dispatches_tenant_lead_idx ON campaign_dispatches(tenant_id, lead_id);
CREATE INDEX IF NOT EXISTS dispatches_campaign_idx ON campaign_dispatches(campaign_id);
CREATE INDEX IF NOT EXISTS dispatches_ext_idx ON campaign_dispatches(external_message_id);

CREATE TABLE IF NOT EXISTS checkout_offers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  site_id UUID NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  lead_id UUID NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  token TEXT NOT NULL UNIQUE,
  gateway TEXT NOT NULL DEFAULT 'SANDBOX',
  billing_model TEXT NOT NULL DEFAULT 'HYBRID',
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  setup_amount_cents INTEGER NOT NULL DEFAULT 0,
  monthly_amount_cents INTEGER NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'BRL',
  status TEXT NOT NULL DEFAULT 'ACTIVE',
  external_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS checkout_offers_tenant_idx ON checkout_offers(tenant_id, site_id);

CREATE TABLE IF NOT EXISTS payment_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  offer_id UUID NOT NULL REFERENCES checkout_offers(id) ON DELETE CASCADE,
  site_id UUID NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  lead_id UUID NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  gateway TEXT NOT NULL,
  billing_model TEXT NOT NULL,
  amount_cents INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'PENDING',
  external_checkout_id TEXT,
  external_subscription_id TEXT,
  grace_until TIMESTAMPTZ,
  paid_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS payments_tenant_site_idx ON payment_transactions(tenant_id, site_id);

CREATE TABLE IF NOT EXISTS processed_webhook_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  gateway TEXT NOT NULL,
  event_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  signature_verified BOOLEAN NOT NULL DEFAULT TRUE,
  payload_hash TEXT NOT NULL,
  processed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS webhook_gateway_event_uidx ON processed_webhook_events(gateway, event_id);

CREATE TABLE IF NOT EXISTS custom_domains (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  site_id UUID NOT NULL UNIQUE REFERENCES sites(id) ON DELETE CASCADE,
  domain TEXT NOT NULL UNIQUE,
  expected_cname TEXT NOT NULL,
  expected_a_record TEXT NOT NULL,
  dns_status TEXT NOT NULL DEFAULT 'PENDING',
  ssl_status TEXT NOT NULL DEFAULT 'PENDING',
  verification_error TEXT,
  last_checked_at TIMESTAMPTZ,
  verified_at TIMESTAMPTZ,
  ssl_issued_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS custom_domains_tenant_idx ON custom_domains(tenant_id);

CREATE TABLE IF NOT EXISTS client_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  site_id UUID NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  request_type TEXT NOT NULL,
  message TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'OPEN',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS client_requests_site_idx ON client_requests(tenant_id, site_id);

CREATE TABLE IF NOT EXISTS notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  lead_id UUID,
  site_id UUID,
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  is_read BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS notifications_tenant_idx ON notifications(tenant_id, is_read);

CREATE TABLE IF NOT EXISTS usage_telemetry (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  metric_type TEXT NOT NULL,
  units INTEGER NOT NULL DEFAULT 1,
  prompt_tokens INTEGER NOT NULL DEFAULT 0,
  completion_tokens INTEGER NOT NULL DEFAULT 0,
  estimated_cost_cents INTEGER NOT NULL DEFAULT 0,
  used_byok BOOLEAN NOT NULL DEFAULT FALSE,
  metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS usage_tenant_type_idx ON usage_telemetry(tenant_id, metric_type, created_at);

CREATE TABLE IF NOT EXISTS audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID REFERENCES tenants(id) ON DELETE SET NULL,
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  actor_role TEXT NOT NULL,
  action TEXT NOT NULL,
  resource_type TEXT NOT NULL,
  resource_id TEXT,
  details_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS audit_tenant_idx ON audit_logs(tenant_id, created_at);
`;

const POSTGIS_DDL = `
ALTER TABLE leads ADD COLUMN IF NOT EXISTS geo_point geography(Point, 4326);
UPDATE leads SET geo_point = ST_SetSRID(ST_MakePoint(lng, lat), 4326)::geography WHERE geo_point IS NULL;
CREATE INDEX IF NOT EXISTS leads_geo_point_gist_idx ON leads USING GIST (geo_point);
`;

export async function runMigrations(ctx: DbContext): Promise<void> {
  const statements = CORE_DDL.split(/;\s*\n/)
    .map((s) => s.trim())
    .filter(Boolean);

  for (const stmt of statements) {
    await ctx.executeRaw(stmt);
  }

  if (ctx.hasPostgis) {
    const geoStmts = POSTGIS_DDL.split(/;\s*\n/)
      .map((s) => s.trim())
      .filter(Boolean);
    for (const stmt of geoStmts) {
      await ctx.executeRaw(stmt);
    }
  }
}
