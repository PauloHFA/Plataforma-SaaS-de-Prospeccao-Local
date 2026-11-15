import {
  pgTable,
  uuid,
  text,
  integer,
  boolean,
  doublePrecision,
  timestamp,
  jsonb,
  uniqueIndex,
  index,
} from 'drizzle-orm/pg-core';
import type { SiteDocument } from '@plataforma/shared';

export const plans = pgTable('plans', {
  id: uuid('id').defaultRandom().primaryKey(),
  slug: text('slug').notNull().unique(),
  name: text('name').notNull(),
  description: text('description').notNull(),
  priceCents: integer('price_cents').notNull().default(0),
  monthlyCredits: integer('monthly_credits').notNull().default(200),
  maxSearchesPerMonth: integer('max_searches_per_month').notNull().default(100),
  maxSitesPerMonth: integer('max_sites_per_month').notNull().default(50),
  maxMessagesPerDay: integer('max_messages_per_day').notNull().default(80),
  maxActivePreviews: integer('max_active_previews').notNull().default(30),
  monthlyBudgetCents: integer('monthly_budget_cents').notNull().default(15000),
  allowByok: boolean('allow_byok').notNull().default(true),
  allowCustomDomain: boolean('allow_custom_domain').notNull().default(true),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

export const tenants = pgTable('tenants', {
  id: uuid('id').defaultRandom().primaryKey(),
  name: text('name').notNull(),
  slug: text('slug').notNull().unique(),
  planId: uuid('plan_id')
    .notNull()
    .references(() => plans.id),
  status: text('status').notNull().default('ACTIVE'), // ACTIVE | SUSPENDED
  creditsBalance: integer('credits_balance').notNull().default(200),
  geoCacheTtlDays: integer('geo_cache_ttl_days').notNull().default(15),
  previewExpirationDays: integer('preview_expiration_days').notNull().default(14),
  gracePeriodDays: integer('grace_period_days').notNull().default(5),
  quarantineDays: integer('quarantine_days').notNull().default(30),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

export const users = pgTable(
  'users',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenant_id').references(() => tenants.id, { onDelete: 'cascade' }),
    email: text('email').notNull().unique(),
    passwordHash: text('password_hash').notNull(),
    name: text('name').notNull(),
    role: text('role').notNull().default('TENANT_OPERATOR'), // GLOBAL_ADMIN | TENANT_OPERATOR | END_CLIENT
    isActive: boolean('is_active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index('users_tenant_idx').on(table.tenantId)],
);

export const tenantSecrets = pgTable(
  'tenant_secrets',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    provider: text('provider').notNull(),
    ciphertext: text('ciphertext').notNull(),
    iv: text('iv').notNull(),
    authTag: text('auth_tag').notNull(),
    keyHint: text('key_hint').notNull(),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [uniqueIndex('tenant_secrets_provider_uidx').on(table.tenantId, table.provider)],
);

export const geoSearchCache = pgTable(
  'geo_search_cache',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    gridKey: text('grid_key').notNull().unique(),
    lat: doublePrecision('lat').notNull(),
    lng: doublePrecision('lng').notNull(),
    radiusKm: doublePrecision('radius_km').notNull(),
    keyword: text('keyword').notNull(),
    provider: text('provider').notNull(),
    rawResultsJson: jsonb('raw_results_json').notNull(),
    hitCount: integer('hit_count').notNull().default(0),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index('geo_cache_expires_idx').on(table.expiresAt)],
);

export interface StoredReview {
  author: string;
  rating: number;
  text: string;
  relativeTime: string;
}

export interface StoredOpeningHour {
  day: string;
  hours: string;
}

export interface StoredPhoto {
  url: string;
  width: number;
  height: number;
  source: 'places' | 'upload' | 'stock';
}

export const leads = pgTable(
  'leads',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    placeId: text('place_id').notNull(),
    businessName: text('business_name').notNull(),
    category: text('category').notNull(),
    niche: text('niche').notNull(),
    phoneRaw: text('phone_raw'),
    phoneE164: text('phone_e164'),
    phoneType: text('phone_type').notNull().default('UNKNOWN'), // MOBILE | LANDLINE | UNKNOWN
    whatsappValid: boolean('whatsapp_valid'),
    whatsappCheckedAt: timestamp('whatsapp_checked_at', { withTimezone: true }),
    email: text('email'),
    websiteUrl: text('website_url'),
    websiteCategory: text('website_category').notNull().default('NO_WEBSITE'), // NO_WEBSITE | SOCIAL_ONLY | OWN_DOMAIN
    websitePlatformLabel: text('website_platform_label'),
    address: text('address').notNull(),
    neighborhood: text('neighborhood').notNull().default('Centro'),
    city: text('city').notNull(),
    state: text('state').notNull().default('SP'),
    postalCode: text('postal_code'),
    lat: doublePrecision('lat').notNull(),
    lng: doublePrecision('lng').notNull(),
    rating: doublePrecision('rating').notNull().default(0),
    reviewCount: integer('review_count').notNull().default(0),
    reviewsJson: jsonb('reviews_json').$type<StoredReview[]>().notNull().default([]),
    openingHoursJson: jsonb('opening_hours_json').$type<StoredOpeningHour[]>().notNull().default([]),
    photosJson: jsonb('photos_json').$type<StoredPhoto[]>().notNull().default([]),
    funnelStage: text('funnel_stage').notNull().default('LEAD_CAPTADO'),
    optedOut: boolean('opted_out').notNull().default(false),
    optedOutAt: timestamp('opted_out_at', { withTimezone: true }),
    optOutReason: text('opt_out_reason'),
    optOutToken: text('opt_out_token').notNull().unique(),
    lastContactedAt: timestamp('last_contacted_at', { withTimezone: true }),
    dedupAddressKey: text('dedup_address_key').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('leads_tenant_place_uidx').on(table.tenantId, table.placeId),
    index('leads_tenant_stage_idx').on(table.tenantId, table.funnelStage),
    index('leads_tenant_phone_idx').on(table.tenantId, table.phoneE164),
    index('leads_tenant_addr_idx').on(table.tenantId, table.dedupAddressKey),
  ],
);

export const leadNotes = pgTable(
  'lead_notes',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    leadId: uuid('lead_id')
      .notNull()
      .references(() => leads.id, { onDelete: 'cascade' }),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
    content: text('content').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index('lead_notes_lead_idx').on(table.tenantId, table.leadId)],
);

export const siteTemplates = pgTable('site_templates', {
  id: uuid('id').defaultRandom().primaryKey(),
  slug: text('slug').notNull().unique(),
  name: text('name').notNull(),
  niche: text('niche').notNull(),
  description: text('description').notNull(),
  defaultPaletteJson: jsonb('default_palette_json')
    .$type<{
      primaryColor: string;
      secondaryColor: string;
      accentColor: string;
      backgroundColor: string;
      surfaceColor: string;
      textColor: string;
    }>()
    .notNull(),
  defaultTypography: text('default_typography').notNull().default('inter-plus-jakarta'),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

export const sites = pgTable(
  'sites',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    leadId: uuid('lead_id')
      .notNull()
      .references(() => leads.id, { onDelete: 'cascade' }),
    templateId: uuid('template_id')
      .notNull()
      .references(() => siteTemplates.id),
    templateSlug: text('template_slug').notNull(),
    subdomainSlug: text('subdomain_slug').notNull().unique(),
    customDomain: text('custom_domain').unique(),
    status: text('status').notNull().default('PREVIEW'), // DRAFT | PREVIEW | PUBLISHED | SUSPENDED | ARCHIVED
    schemaVersion: text('schema_version').notNull().default('1.0'),
    contentJson: jsonb('content_json').$type<SiteDocument>().notNull(),
    primaryColor: text('primary_color').notNull(),
    fontPairing: text('font_pairing').notNull().default('inter-plus-jakarta'),
    previewViewsCount: integer('preview_views_count').notNull().default(0),
    whatsappClicksCount: integer('whatsapp_clicks_count').notNull().default(0),
    ctaClicksCount: integer('cta_clicks_count').notNull().default(0),
    firstViewedAt: timestamp('first_viewed_at', { withTimezone: true }),
    lastViewedAt: timestamp('last_viewed_at', { withTimezone: true }),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    publishedAt: timestamp('published_at', { withTimezone: true }),
    suspendedAt: timestamp('suspended_at', { withTimezone: true }),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    clientPortalToken: text('client_portal_token').unique(),
    cacheVersion: integer('cache_version').notNull().default(1),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('sites_tenant_idx').on(table.tenantId, table.status),
    index('sites_lead_idx').on(table.tenantId, table.leadId),
  ],
);

export const siteTelemetryEvents = pgTable(
  'site_telemetry_events',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    siteId: uuid('site_id')
      .notNull()
      .references(() => sites.id, { onDelete: 'cascade' }),
    eventType: text('event_type').notNull(), // PAGE_VIEW | WHATSAPP_CLICK | CTA_CLICK | PHONE_CLICK
    deviceType: text('device_type').notNull().default('desktop'),
    userAgent: text('user_agent').notNull().default(''),
    ipHash: text('ip_hash').notNull().default(''),
    referrer: text('referrer'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index('telemetry_site_idx').on(table.tenantId, table.siteId, table.createdAt)],
);

export const messagingConnections = pgTable(
  'messaging_connections',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    channel: text('channel').notNull(), // WHATSAPP_EVOLUTION | WHATSAPP_META | EMAIL_SMTP
    label: text('label').notNull(),
    status: text('status').notNull().default('DISCONNECTED'), // DISCONNECTED | QR_PENDING | CONNECTED | ERROR
    identifier: text('identifier').notNull(),
    qrCodeData: text('qr_code_data'),
    encryptedConfigJson: text('encrypted_config_json'),
    spfVerified: boolean('spf_verified').notNull().default(false),
    dkimVerified: boolean('dkim_verified').notNull().default(false),
    dailyLimit: integer('daily_limit').notNull().default(80),
    sentToday: integer('sent_today').notNull().default(0),
    lastResetDate: text('last_reset_date').notNull().default(''),
    windowTimezone: text('window_timezone').notNull().default('America/Sao_Paulo'),
    minDelaySeconds: integer('min_delay_seconds').notNull().default(15),
    maxDelaySeconds: integer('max_delay_seconds').notNull().default(45),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index('connections_tenant_idx').on(table.tenantId, table.channel)],
);

export const messageTemplates = pgTable(
  'message_templates',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    channel: text('channel').notNull(), // WHATSAPP | EMAIL
    subject: text('subject'),
    body: text('body').notNull(),
    variablesJson: jsonb('variables_json').$type<string[]>().notNull().default([]),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index('msg_templates_tenant_idx').on(table.tenantId)],
);

export const campaigns = pgTable(
  'campaigns',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    channel: text('channel').notNull(), // WHATSAPP | EMAIL
    connectionId: uuid('connection_id')
      .notNull()
      .references(() => messagingConnections.id),
    templateId: uuid('template_id').references(() => messageTemplates.id),
    status: text('status').notNull().default('RUNNING'), // DRAFT | SCHEDULED | RUNNING | COMPLETED | PAUSED
    minDelayMs: integer('min_delay_ms').notNull().default(15000),
    maxDelayMs: integer('max_delay_ms').notNull().default(30000),
    respectBusinessHours: boolean('respect_business_hours').notNull().default(true),
    scheduledAt: timestamp('scheduled_at', { withTimezone: true }),
    totalTargets: integer('total_targets').notNull().default(0),
    sentCount: integer('sent_count').notNull().default(0),
    blockedCount: integer('blocked_count').notNull().default(0),
    failedCount: integer('failed_count').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index('campaigns_tenant_idx').on(table.tenantId)],
);

export const campaignDispatches = pgTable(
  'campaign_dispatches',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    campaignId: uuid('campaign_id').references(() => campaigns.id, { onDelete: 'cascade' }),
    leadId: uuid('lead_id')
      .notNull()
      .references(() => leads.id, { onDelete: 'cascade' }),
    siteId: uuid('site_id').references(() => sites.id, { onDelete: 'set null' }),
    connectionId: uuid('connection_id')
      .notNull()
      .references(() => messagingConnections.id),
    channel: text('channel').notNull(), // WHATSAPP | EMAIL
    recipient: text('recipient').notNull(),
    renderedSubject: text('rendered_subject'),
    renderedBody: text('rendered_body').notNull(),
    status: text('status').notNull().default('QUEUED'),
    blockReason: text('block_reason'),
    externalMessageId: text('external_message_id'),
    scheduledFor: timestamp('scheduled_for', { withTimezone: true }),
    sentAt: timestamp('sent_at', { withTimezone: true }),
    deliveredAt: timestamp('delivered_at', { withTimezone: true }),
    readAt: timestamp('read_at', { withTimezone: true }),
    errorMessage: text('error_message'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('dispatches_tenant_lead_idx').on(table.tenantId, table.leadId),
    index('dispatches_campaign_idx').on(table.campaignId),
    index('dispatches_ext_idx').on(table.externalMessageId),
  ],
);

export const checkoutOffers = pgTable(
  'checkout_offers',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    siteId: uuid('site_id')
      .notNull()
      .references(() => sites.id, { onDelete: 'cascade' }),
    leadId: uuid('lead_id')
      .notNull()
      .references(() => leads.id, { onDelete: 'cascade' }),
    token: text('token').notNull().unique(),
    gateway: text('gateway').notNull().default('SANDBOX'), // STRIPE | ASAAS | SANDBOX
    billingModel: text('billing_model').notNull().default('HYBRID'), // ONE_TIME | SUBSCRIPTION | HYBRID
    title: text('title').notNull(),
    description: text('description').notNull(),
    setupAmountCents: integer('setup_amount_cents').notNull().default(0),
    monthlyAmountCents: integer('monthly_amount_cents').notNull().default(0),
    currency: text('currency').notNull().default('BRL'),
    status: text('status').notNull().default('ACTIVE'), // ACTIVE | PAID | CANCELED | EXPIRED
    externalUrl: text('external_url'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index('checkout_offers_tenant_idx').on(table.tenantId, table.siteId)],
);

export const paymentTransactions = pgTable(
  'payment_transactions',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    offerId: uuid('offer_id')
      .notNull()
      .references(() => checkoutOffers.id, { onDelete: 'cascade' }),
    siteId: uuid('site_id')
      .notNull()
      .references(() => sites.id, { onDelete: 'cascade' }),
    leadId: uuid('lead_id')
      .notNull()
      .references(() => leads.id, { onDelete: 'cascade' }),
    gateway: text('gateway').notNull(),
    billingModel: text('billing_model').notNull(),
    amountCents: integer('amount_cents').notNull(),
    status: text('status').notNull().default('PENDING'), // PENDING | PAID | PAST_DUE | SUSPENDED | CANCELED
    externalCheckoutId: text('external_checkout_id'),
    externalSubscriptionId: text('external_subscription_id'),
    graceUntil: timestamp('grace_until', { withTimezone: true }),
    paidAt: timestamp('paid_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index('payments_tenant_site_idx').on(table.tenantId, table.siteId)],
);

export const processedWebhookEvents = pgTable(
  'processed_webhook_events',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    gateway: text('gateway').notNull(),
    eventId: text('event_id').notNull(),
    eventType: text('event_type').notNull(),
    signatureVerified: boolean('signature_verified').notNull().default(true),
    payloadHash: text('payload_hash').notNull(),
    processedAt: timestamp('processed_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [uniqueIndex('webhook_gateway_event_uidx').on(table.gateway, table.eventId)],
);

export const customDomains = pgTable(
  'custom_domains',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    siteId: uuid('site_id')
      .notNull()
      .unique()
      .references(() => sites.id, { onDelete: 'cascade' }),
    domain: text('domain').notNull().unique(),
    expectedCname: text('expected_cname').notNull(),
    expectedARecord: text('expected_a_record').notNull(),
    dnsStatus: text('dns_status').notNull().default('PENDING'), // PENDING | VERIFIED | FAILED
    sslStatus: text('ssl_status').notNull().default('PENDING'), // PENDING | PROVISIONING | ACTIVE | FAILED
    verificationError: text('verification_error'),
    lastCheckedAt: timestamp('last_checked_at', { withTimezone: true }),
    verifiedAt: timestamp('verified_at', { withTimezone: true }),
    sslIssuedAt: timestamp('ssl_issued_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index('custom_domains_tenant_idx').on(table.tenantId)],
);

export const clientRequests = pgTable(
  'client_requests',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    siteId: uuid('site_id')
      .notNull()
      .references(() => sites.id, { onDelete: 'cascade' }),
    requestType: text('request_type').notNull(), // CONTENT_ADJUSTMENT | INFO_UPDATE | DOMAIN_HELP | SUBSCRIPTION
    message: text('message').notNull(),
    status: text('status').notNull().default('OPEN'), // OPEN | DONE
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index('client_requests_site_idx').on(table.tenantId, table.siteId)],
);

export const notifications = pgTable(
  'notifications',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    leadId: uuid('lead_id'),
    siteId: uuid('site_id'),
    type: text('type').notNull(),
    title: text('title').notNull(),
    body: text('body').notNull(),
    isRead: boolean('is_read').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index('notifications_tenant_idx').on(table.tenantId, table.isRead)],
);

export const usageTelemetry = pgTable(
  'usage_telemetry',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    metricType: text('metric_type').notNull(), // MAPS_SEARCH | LLM_GENERATION | WHATSAPP_DISPATCH | EMAIL_DISPATCH
    units: integer('units').notNull().default(1),
    promptTokens: integer('prompt_tokens').notNull().default(0),
    completionTokens: integer('completion_tokens').notNull().default(0),
    estimatedCostCents: integer('estimated_cost_cents').notNull().default(0),
    usedByok: boolean('used_byok').notNull().default(false),
    metadataJson: jsonb('metadata_json').$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index('usage_tenant_type_idx').on(table.tenantId, table.metricType, table.createdAt)],
);

export const auditLogs = pgTable(
  'audit_logs',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenant_id').references(() => tenants.id, { onDelete: 'set null' }),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
    actorRole: text('actor_role').notNull(),
    action: text('action').notNull(),
    resourceType: text('resource_type').notNull(),
    resourceId: text('resource_id'),
    detailsJson: jsonb('details_json').$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index('audit_tenant_idx').on(table.tenantId, table.createdAt)],
);
