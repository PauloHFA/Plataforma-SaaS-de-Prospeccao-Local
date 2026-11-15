import { and, eq, gt, inArray, or, sql } from 'drizzle-orm';
import type { AppDatabase } from '@plataforma/db';
import { createOptOutToken, geoSearchCache, leads, tenants } from '@plataforma/db';
import {
  searchLocalBusinesses,
  validateWhatsAppNumber,
  type RawPlaceResult,
} from '@plataforma/integrations';
import type { QueueManager } from '@plataforma/queue';
import {
  computeGeoGridKey,
  normalizeTextKey,
  resolveApproximateCoordinates,
  type WebsiteCategory,
} from '@plataforma/shared';
import {
  checkTenantQuotaAndBudget,
  getDecryptedTenantSecret,
  recordUsageTelemetry,
} from './quota.service.js';
import { recordAuditLog } from './audit.service.js';

export type WebsiteFilterMode =
  | 'ALL'
  | 'WITHOUT_OWN_SITE'
  | 'NO_WEBSITE'
  | 'SOCIAL_ONLY'
  | 'OWN_DOMAIN';

export interface LeadSearchInput {
  tenantId: string;
  userId: string;
  actorRole: string;
  keyword: string;
  city?: string;
  state?: string;
  neighborhood?: string;
  postalCode?: string;
  lat?: number;
  lng?: number;
  radiusKm?: number;
  limit?: number;
  websiteFilter?: WebsiteFilterMode;
  waitForValidation?: boolean;
  masterKey?: string;
}

export async function searchAndEnrichLeads(
  db: AppDatabase,
  queue: QueueManager,
  input: LeadSearchInput,
) {
  const radiusKm = Math.max(1, Math.min(50, input.radiusKm ?? 5));
  const limit = Math.max(1, Math.min(20, input.limit ?? 20));
  const websiteFilter = input.websiteFilter ?? 'WITHOUT_OWN_SITE';

  const { usedByok } = await checkTenantQuotaAndBudget(
    db,
    input.tenantId,
    'MAPS_SEARCH',
    input.masterKey,
  );

  const center = resolveApproximateCoordinates({
    city: input.city,
    state: input.state,
    neighborhood: input.neighborhood,
    postalCode: input.postalCode,
    lat: input.lat,
    lng: input.lng,
  });

  const gridKey = computeGeoGridKey({
    lat: center.lat,
    lng: center.lng,
    radiusKm,
    keyword: input.keyword,
  });

  // RN-01: Cache geográfico compartilhado
  const [cached] = await db
    .select()
    .from(geoSearchCache)
    .where(and(eq(geoSearchCache.gridKey, gridKey), gt(geoSearchCache.expiresAt, new Date())));

  let rawResults: RawPlaceResult[];
  let cacheHit = false;
  let providerUsed = 'cache';

  if (cached && Array.isArray(cached.rawResultsJson)) {
    cacheHit = true;
    rawResults = cached.rawResultsJson as RawPlaceResult[];
    await db
      .update(geoSearchCache)
      .set({ hitCount: sql`${geoSearchCache.hitCount} + 1` })
      .where(eq(geoSearchCache.id, cached.id));
  } else {
    const byokPlacesKey = await getDecryptedTenantSecret(
      db,
      input.tenantId,
      'google_places',
      input.masterKey,
    );
    const searchOut = await searchLocalBusinesses({
      keyword: input.keyword,
      city: input.city || center.city,
      state: input.state || center.state,
      neighborhood: input.neighborhood,
      postalCode: input.postalCode,
      lat: center.lat,
      lng: center.lng,
      radiusKm,
      limit,
      googlePlacesApiKey: byokPlacesKey || undefined,
    });
    rawResults = searchOut.results;
    providerUsed = searchOut.provider;

    const [tenantRow] = await db
      .select({ ttl: tenants.geoCacheTtlDays })
      .from(tenants)
      .where(eq(tenants.id, input.tenantId));
    const ttlDays = tenantRow?.ttl ?? Number(process.env.GEO_CACHE_TTL_DAYS || 15);
    const expiresAt = new Date(Date.now() + ttlDays * 86_400_000);

    await db
      .insert(geoSearchCache)
      .values({
        gridKey,
        lat: center.lat,
        lng: center.lng,
        radiusKm,
        keyword: input.keyword,
        provider: providerUsed,
        rawResultsJson: rawResults,
        hitCount: 0,
        expiresAt,
      })
      .onConflictDoUpdate({
        target: geoSearchCache.gridKey,
        set: {
          rawResultsJson: rawResults,
          provider: providerUsed,
          expiresAt,
        },
      });

    await recordUsageTelemetry(db, {
      tenantId: input.tenantId,
      metricType: 'MAPS_SEARCH',
      units: 1,
      estimatedCostCents: usedByok || providerUsed === 'sandbox' ? 0 : 18,
      usedByok,
      metadata: { keyword: input.keyword, city: center.city, radiusKm, provider: providerUsed },
    });
  }

  // RF-02 + CA-01: Filtragem por presença web ANTES ou na apresentação mantendo deduplicação
  const filteredPlaces = rawResults.filter((place) => matchesWebsiteFilter(place.websiteCategory, websiteFilter));

  const savedLeadIds: string[] = [];
  const returnedLeads: Array<typeof leads.$inferSelect> = [];
  let newInsertedCount = 0;
  let deduplicatedCount = 0;

  for (const item of filteredPlaces) {
    const dedupAddr = normalizeTextKey(`${item.address} ${item.city}`);

    // RF-05 + CA-03: Deduplicação inteligente comparando Place ID, telefone E.164 e endereço
    const conditions = [eq(leads.placeId, item.placeId), eq(leads.dedupAddressKey, dedupAddr)];
    if (item.phoneE164) {
      conditions.push(eq(leads.phoneE164, item.phoneE164));
    }

    const [existing] = await db
      .select()
      .from(leads)
      .where(and(eq(leads.tenantId, input.tenantId), or(...conditions)));

    if (existing) {
      deduplicatedCount += 1;
      returnedLeads.push(existing);
      continue;
    }

    const [inserted] = await db
      .insert(leads)
      .values({
        tenantId: input.tenantId,
        placeId: item.placeId,
        businessName: item.businessName,
        category: item.category,
        niche: item.niche,
        phoneRaw: item.phoneRaw,
        phoneE164: item.phoneE164,
        phoneType: item.phoneType,
        whatsappValid: null,
        websiteUrl: item.websiteUrl,
        websiteCategory: item.websiteCategory,
        websitePlatformLabel: item.websitePlatformLabel,
        address: item.address,
        neighborhood: item.neighborhood,
        city: item.city,
        state: item.state,
        postalCode: item.postalCode,
        lat: item.lat,
        lng: item.lng,
        rating: item.rating,
        reviewCount: item.reviewCount,
        reviewsJson: item.reviews,
        openingHoursJson: item.openingHours,
        photosJson: item.photos.map((p) => ({
          url: p.url,
          width: p.width,
          height: p.height,
          source: 'places' as const,
        })),
        funnelStage: 'LEAD_CAPTADO',
        optOutToken: createOptOutToken(),
        dedupAddressKey: dedupAddr,
      })
      .returning();

    if (inserted) {
      newInsertedCount += 1;
      savedLeadIds.push(inserted.id);
      returnedLeads.push(inserted);
    }
  }

  // Cobrança de créditos APENAS sobre novos leads inseridos (CA-03: duplicados não consomem créditos)
  const creditsConsumed = usedByok ? 0 : newInsertedCount;
  if (creditsConsumed > 0) {
    await db
      .update(tenants)
      .set({
        creditsBalance: sql`GREATEST(0, ${tenants.creditsBalance} - ${creditsConsumed})`,
        updatedAt: new Date(),
      })
      .where(eq(tenants.id, input.tenantId));
  }

  // Enfileirar validação de WhatsApp em worker assíncrono (RF-04 / RNF-03)
  let enrichmentJobId: string | null = null;
  if (savedLeadIds.length > 0) {
    const job = await queue.enqueue('lead-enrichment', 'validate-whatsapp-batch', {
      tenantId: input.tenantId,
      leadIds: savedLeadIds,
      validateWhatsApp: true,
    });
    enrichmentJobId = job.id;

    if (input.waitForValidation) {
      await queue.waitUntilIdle('lead-enrichment', 10000);
    }
  }

  const finalLeads =
    returnedLeads.length > 0
      ? await db
          .select()
          .from(leads)
          .where(
            and(
              eq(leads.tenantId, input.tenantId),
              inArray(
                leads.id,
                returnedLeads.map((l) => l.id),
              ),
            ),
          )
      : [];

  await recordAuditLog(db, {
    tenantId: input.tenantId,
    userId: input.userId,
    actorRole: input.actorRole,
    action: 'LEAD_SEARCH_EXECUTED',
    resourceType: 'lead_search',
    details: {
      keyword: input.keyword,
      city: center.city,
      websiteFilter,
      cacheHit,
      newInsertedCount,
      deduplicatedCount,
      creditsConsumed,
    },
  });

  return {
    leads: finalLeads,
    stats: {
      totalFound: filteredPlaces.length,
      newInserted: newInsertedCount,
      deduplicated: deduplicatedCount,
      creditsConsumed,
      cacheHit,
      provider: providerUsed,
      enrichmentJobId,
    },
  };
}

export async function runLeadEnrichmentJob(
  db: AppDatabase,
  data: { tenantId: string; leadIds: string[]; validateWhatsApp: boolean },
): Promise<{ validatedCount: number }> {
  if (data.leadIds.length === 0) return { validatedCount: 0 };

  const targetLeads = await db
    .select()
    .from(leads)
    .where(and(eq(leads.tenantId, data.tenantId), inArray(leads.id, data.leadIds)));

  let validatedCount = 0;
  for (const lead of targetLeads) {
    const result = await validateWhatsAppNumber({
      phoneE164: lead.phoneE164,
      phoneType: (lead.phoneType as 'MOBILE' | 'LANDLINE' | 'UNKNOWN') || 'UNKNOWN',
    });

    await db
      .update(leads)
      .set({
        whatsappValid: result.hasWhatsApp,
        whatsappCheckedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(and(eq(leads.id, lead.id), eq(leads.tenantId, data.tenantId)));
    validatedCount += 1;
  }

  return { validatedCount };
}

function matchesWebsiteFilter(category: string, filter: WebsiteFilterMode): boolean {
  if (filter === 'ALL') return true;
  if (filter === 'WITHOUT_OWN_SITE') {
    return category === 'NO_WEBSITE' || category === 'SOCIAL_ONLY';
  }
  return category === (filter as WebsiteCategory);
}
