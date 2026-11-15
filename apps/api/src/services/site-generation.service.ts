import { and, eq } from 'drizzle-orm';
import type { AppDatabase } from '@plataforma/db';
import { leads, sites, siteTemplates, tenants } from '@plataforma/db';
import {
  generateSiteDocumentWithAI,
  resolveSiteImages,
} from '@plataforma/integrations';
import {
  DEFAULT_TEMPLATE_BY_NICHE,
  sanitizeAndValidateSiteDocument,
  slugifyBusinessName,
  type FontPairing,
  type Niche,
  type SiteDocument,
  type TemplateSlug,
} from '@plataforma/shared';
import { generateSecureToken } from '@plataforma/shared/crypto';
import {
  checkTenantQuotaAndBudget,
  getDecryptedTenantSecret,
  recordUsageTelemetry,
} from './quota.service.js';
import { recordAuditLog } from './audit.service.js';

export interface GenerateSiteInput {
  tenantId: string;
  userId: string;
  actorRole: string;
  leadId: string;
  templateSlug?: TemplateSlug;
  primaryColor?: string;
  fontPairing?: FontPairing;
  appUrl: string;
  previewBaseDomain: string;
  masterKey?: string;
}

export async function generateSiteForLead(db: AppDatabase, input: GenerateSiteInput) {
  const [lead] = await db
    .select()
    .from(leads)
    .where(and(eq(leads.id, input.leadId), eq(leads.tenantId, input.tenantId)));

  if (!lead) {
    return null;
  }

  const { usedByok } = await checkTenantQuotaAndBudget(
    db,
    input.tenantId,
    'LLM_GENERATION',
    input.masterKey,
  );

  const niche = (lead.niche as Niche) || 'servicos_locais';
  const requestedSlug = input.templateSlug || DEFAULT_TEMPLATE_BY_NICHE[niche];

  let [template] = await db
    .select()
    .from(siteTemplates)
    .where(and(eq(siteTemplates.slug, requestedSlug), eq(siteTemplates.isActive, true)));

  if (!template) {
    const [fallbackTpl] = await db
      .select()
      .from(siteTemplates)
      .where(eq(siteTemplates.isActive, true));
    template = fallbackTpl;
  }

  if (!template) {
    throw new Error('Nenhum template SPA ativo encontrado no catálogo.');
  }

  const basePalette = template.defaultPaletteJson;
  const palette = {
    ...basePalette,
    primaryColor: input.primaryColor || basePalette.primaryColor,
  };
  const fontPairing = (input.fontPairing || template.defaultTypography) as FontPairing;

  // RN-05 + CA-05: Resoluções < 800px ou ausentes recebem acervo curado do nicho
  const resolvedMedia = await resolveSiteImages({
    niche,
    businessName: lead.businessName,
    rawPhotos: (lead.photosJson || []).map((p) => ({
      url: p.url,
      width: p.width,
      height: p.height,
    })),
  });

  const openaiKey = await getDecryptedTenantSecret(db, input.tenantId, 'openai', input.masterKey);
  const anthropicKey = await getDecryptedTenantSecret(
    db,
    input.tenantId,
    'anthropic',
    input.masterKey,
  );

  const aiResult = await generateSiteDocumentWithAI({
    lead: {
      businessName: lead.businessName,
      category: lead.category,
      niche,
      phoneRaw: lead.phoneRaw,
      phoneE164: lead.phoneE164,
      whatsappValid: lead.whatsappValid,
      email: lead.email,
      address: lead.address,
      neighborhood: lead.neighborhood,
      city: lead.city,
      state: lead.state,
      lat: lead.lat,
      lng: lead.lng,
      rating: lead.rating,
      reviewCount: lead.reviewCount,
      reviews: lead.reviewsJson || [],
      openingHours: lead.openingHoursJson || [],
    },
    templateSlug: template.slug as TemplateSlug,
    palette,
    fontPairing,
    heroImageUrl: resolvedMedia.heroImageUrl,
    gallery: resolvedMedia.gallery.map((g, idx) => ({
      url: g.url,
      alt: `${lead.businessName} - imagem ${idx + 1}`,
      isStockFallback: g.isStockFallback,
    })),
    openaiApiKey: openaiKey || undefined,
    anthropicApiKey: anthropicKey || undefined,
  });

  // Unique subdomain slug
  const baseSubdomain = slugifyBusinessName(lead.businessName);
  const [existingSlug] = await db
    .select({ id: sites.id })
    .from(sites)
    .where(eq(sites.subdomainSlug, baseSubdomain));
  const subdomainSlug = existingSlug
    ? slugifyBusinessName(lead.businessName, generateSecureToken(3))
    : baseSubdomain;

  const [tenantRow] = await db
    .select({ expDays: tenants.previewExpirationDays })
    .from(tenants)
    .where(eq(tenants.id, input.tenantId));
  const expDays = tenantRow?.expDays ?? Number(process.env.PREVIEW_EXPIRATION_DAYS || 14);
  const expiresAt = new Date(Date.now() + expDays * 86_400_000);

  const [createdSite] = await db
    .insert(sites)
    .values({
      tenantId: input.tenantId,
      leadId: lead.id,
      templateId: template.id,
      templateSlug: template.slug,
      subdomainSlug,
      status: 'PREVIEW',
      schemaVersion: '1.0',
      contentJson: aiResult.document,
      primaryColor: palette.primaryColor,
      fontPairing,
      expiresAt,
      clientPortalToken: generateSecureToken(20),
    })
    .returning();

  if (!createdSite) {
    throw new Error('Falha ao persistir site gerado.');
  }

  // Avançar funil para SITE_GERADO caso ainda esteja em LEAD_CAPTADO
  if (lead.funnelStage === 'LEAD_CAPTADO') {
    await db
      .update(leads)
      .set({ funnelStage: 'SITE_GERADO', updatedAt: new Date() })
      .where(and(eq(leads.id, lead.id), eq(leads.tenantId, input.tenantId)));
  }

  await recordUsageTelemetry(db, {
    tenantId: input.tenantId,
    metricType: 'LLM_GENERATION',
    units: 1,
    promptTokens: aiResult.promptTokens,
    completionTokens: aiResult.completionTokens,
    estimatedCostCents: usedByok ? 0 : aiResult.estimatedCostCents,
    usedByok,
    metadata: {
      siteId: createdSite.id,
      templateSlug: template.slug,
      provider: aiResult.provider,
    },
  });

  await recordAuditLog(db, {
    tenantId: input.tenantId,
    userId: input.userId,
    actorRole: input.actorRole,
    action: 'SITE_GENERATED',
    resourceType: 'site',
    resourceId: createdSite.id,
    details: {
      leadId: lead.id,
      subdomainSlug,
      templateSlug: template.slug,
      provider: aiResult.provider,
    },
  });

  return {
    site: createdSite,
    previewUrl: `${input.appUrl}/preview/${subdomainSlug}`,
    subdomainHost: `${subdomainSlug}.${input.previewBaseDomain}`,
    generationProvider: aiResult.provider,
  };
}

export interface QuickEditSiteInput {
  tenantId: string;
  userId: string;
  actorRole: string;
  siteId: string;
  templateSlug?: TemplateSlug;
  primaryColor?: string;
  fontPairing?: FontPairing;
  contentPatch?: Partial<SiteDocument>;
  appUrl: string;
}

/**
 * RF-11 + CA-06 + RNF-06: Edição rápida pré-envio com validação Zod, sanitização XSS e invalidação de cache.
 */
export async function updateSiteQuickEditor(db: AppDatabase, input: QuickEditSiteInput) {
  const [site] = await db
    .select()
    .from(sites)
    .where(and(eq(sites.id, input.siteId), eq(sites.tenantId, input.tenantId)));

  if (!site) return null;

  let nextTemplateId = site.templateId;
  let nextTemplateSlug = site.templateSlug;

  if (input.templateSlug && input.templateSlug !== site.templateSlug) {
    const [tpl] = await db
      .select()
      .from(siteTemplates)
      .where(eq(siteTemplates.slug, input.templateSlug));
    if (tpl) {
      nextTemplateId = tpl.id;
      nextTemplateSlug = tpl.slug;
    }
  }

  const currentDoc = site.contentJson;
  const patch = input.contentPatch || {};

  const mergedDoc: SiteDocument = {
    ...currentDoc,
    ...patch,
    templateSlug: nextTemplateSlug as TemplateSlug,
    theme: {
      ...currentDoc.theme,
      ...(patch.theme || {}),
      primaryColor: input.primaryColor || patch.theme?.primaryColor || currentDoc.theme.primaryColor,
      fontPairing: input.fontPairing || patch.theme?.fontPairing || currentDoc.theme.fontPairing,
    },
    business: {
      ...currentDoc.business,
      ...(patch.business || {}),
    },
    hero: {
      ...currentDoc.hero,
      ...(patch.hero || {}),
    },
    about: {
      ...currentDoc.about,
      ...(patch.about || {}),
    },
    services: {
      ...currentDoc.services,
      ...(patch.services || {}),
    },
    differentials: {
      ...currentDoc.differentials,
      ...(patch.differentials || {}),
    },
    testimonials: {
      ...currentDoc.testimonials,
      ...(patch.testimonials || {}),
    },
    location: {
      ...currentDoc.location,
      ...(patch.location || {}),
    },
    faq: {
      ...currentDoc.faq,
      ...(patch.faq || {}),
    },
    seo: {
      ...currentDoc.seo,
      ...(patch.seo || {}),
    },
    footer: {
      ...currentDoc.footer,
      ...(patch.footer || {}),
    },
    gallery: patch.gallery || currentDoc.gallery,
  };

  const validatedDoc = sanitizeAndValidateSiteDocument(mergedDoc);

  const [updated] = await db
    .update(sites)
    .set({
      templateId: nextTemplateId,
      templateSlug: nextTemplateSlug,
      primaryColor: validatedDoc.theme.primaryColor,
      fontPairing: validatedDoc.theme.fontPairing,
      contentJson: validatedDoc,
      cacheVersion: site.cacheVersion + 1,
      updatedAt: new Date(),
    })
    .where(and(eq(sites.id, site.id), eq(sites.tenantId, input.tenantId)))
    .returning();

  await triggerFrontendCacheRevalidation(input.appUrl, site.subdomainSlug, site.customDomain);

  await recordAuditLog(db, {
    tenantId: input.tenantId,
    userId: input.userId,
    actorRole: input.actorRole,
    action: 'SITE_QUICK_EDITED',
    resourceType: 'site',
    resourceId: site.id,
    details: { templateSlug: nextTemplateSlug, primaryColor: validatedDoc.theme.primaryColor },
  });

  return updated;
}

export async function triggerFrontendCacheRevalidation(
  appUrl: string,
  subdomainSlug: string,
  customDomain: string | null,
): Promise<void> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 1500);
    await fetch(`${appUrl}/api/revalidate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ subdomainSlug, customDomain }),
      signal: controller.signal,
    });
    clearTimeout(timer);
  } catch {
    // Non-fatal if web server isn't up during unit/API-only test
  }
}
