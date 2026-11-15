import type { FastifyInstance } from 'fastify';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { z } from 'zod';
import {
  clientRequests,
  customDomains,
  leads,
  sites,
  siteTemplates,
  type DbContext,
} from '@plataforma/db';
import { optimizeAndStoreUploadedImage } from '@plataforma/integrations';
import type { QueueManager } from '@plataforma/queue';
import { FONT_PAIRINGS, TEMPLATE_SLUGS } from '@plataforma/shared';
import type { AppConfig } from '../config.js';
import { requireTenantOperator } from '../auth.js';
import {
  generateSiteForLead,
  updateSiteQuickEditor,
} from '../services/site-generation.service.js';
import { getSiteTelemetrySummary } from '../services/telemetry.service.js';
import {
  configureCustomDomainForSite,
  verifyCustomDomainForSite,
} from '../services/billing-domain.service.js';
import { QuotaExceededError } from '../services/quota.service.js';

const GenerateSiteSchema = z.object({
  leadId: z.string().uuid(),
  templateSlug: z.enum(TEMPLATE_SLUGS).optional(),
  primaryColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  fontPairing: z.enum(FONT_PAIRINGS).optional(),
  async: z.boolean().optional(),
});

const GenerateBatchSchema = z.object({
  leadIds: z.array(z.string().uuid()).min(1).max(20),
  templateSlug: z.enum(TEMPLATE_SLUGS).optional(),
  primaryColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  waitForCompletion: z.boolean().optional(),
});

const QuickEditSchema = z.object({
  templateSlug: z.enum(TEMPLATE_SLUGS).optional(),
  primaryColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  fontPairing: z.enum(FONT_PAIRINGS).optional(),
  contentPatch: z.record(z.unknown()).optional(),
});

const ConfigureDomainSchema = z.object({
  domain: z.string().min(4).max(180),
});

export function registerSiteRoutes(
  app: FastifyInstance,
  dbCtx: DbContext,
  queue: QueueManager,
  config: AppConfig,
) {
  const { db } = dbCtx;
  const operatorGuard = requireTenantOperator();

  app.get('/api/templates', { preHandler: operatorGuard }, async () => {
    const items = await db
      .select()
      .from(siteTemplates)
      .where(eq(siteTemplates.isActive, true));
    return { templates: items };
  });

  app.post('/api/sites/generate', { preHandler: operatorGuard }, async (request, reply) => {
    const parsed = GenerateSiteSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Parâmetros inválidos.', issues: parsed.error.issues });
    }

    const tenantId = request.user.tenantId!;
    if (parsed.data.async) {
      const [lead] = await db
        .select({ id: leads.id })
        .from(leads)
        .where(and(eq(leads.id, parsed.data.leadId), eq(leads.tenantId, tenantId)));
      if (!lead) {
        return reply.status(404).send({ error: 'Lead não encontrado neste workspace.' });
      }
      const job = await queue.enqueue('site-generation', 'generate-site', {
        tenantId,
        leadId: parsed.data.leadId,
        templateSlug: parsed.data.templateSlug,
        primaryColor: parsed.data.primaryColor,
        requestedByUserId: request.user.userId,
      });
      return reply.status(202).send({ queued: true, jobId: job.id });
    }

    try {
      const result = await generateSiteForLead(db, {
        tenantId,
        userId: request.user.userId,
        actorRole: request.user.role,
        leadId: parsed.data.leadId,
        templateSlug: parsed.data.templateSlug,
        primaryColor: parsed.data.primaryColor,
        fontPairing: parsed.data.fontPairing,
        appUrl: config.appUrl,
        previewBaseDomain: config.previewBaseDomain,
        masterKey: config.encryptionMasterKey,
      });

      if (!result) {
        return reply.status(404).send({ error: 'Lead não encontrado neste workspace.' });
      }
      return reply.status(201).send(result);
    } catch (err) {
      if (err instanceof QuotaExceededError) {
        return reply.status(402).send({ error: err.message });
      }
      throw err;
    }
  });

  app.post('/api/sites/generate-batch', { preHandler: operatorGuard }, async (request, reply) => {
    const parsed = GenerateBatchSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Lista de leads inválida.', issues: parsed.error.issues });
    }

    const tenantId = request.user.tenantId!;
    const tenantLeads = await db
      .select({ id: leads.id })
      .from(leads)
      .where(and(eq(leads.tenantId, tenantId), inArray(leads.id, parsed.data.leadIds)));

    const existingSites = await db
      .select({ leadId: sites.leadId })
      .from(sites)
      .where(and(eq(sites.tenantId, tenantId), inArray(sites.leadId, parsed.data.leadIds)));
    const alreadyHasSite = new Set(existingSites.map((s) => s.leadId));

    const queuedLeadIds: string[] = [];
    for (const lead of tenantLeads) {
      if (alreadyHasSite.has(lead.id)) continue;
      await queue.enqueue('site-generation', 'generate-site', {
        tenantId,
        leadId: lead.id,
        templateSlug: parsed.data.templateSlug,
        primaryColor: parsed.data.primaryColor,
        requestedByUserId: request.user.userId,
      });
      queuedLeadIds.push(lead.id);
    }

    if (parsed.data.waitForCompletion && queuedLeadIds.length > 0) {
      await queue.waitUntilIdle('site-generation', 20_000);
    }

    return reply.status(202).send({
      queuedCount: queuedLeadIds.length,
      skippedCount: tenantLeads.length - queuedLeadIds.length,
      queuedLeadIds,
    });
  });

  app.get('/api/sites', { preHandler: operatorGuard }, async (request) => {
    const tenantId = request.user.tenantId!;
    const rows = await db
      .select()
      .from(sites)
      .where(eq(sites.tenantId, tenantId))
      .orderBy(desc(sites.createdAt));

    const domains = await db
      .select()
      .from(customDomains)
      .where(eq(customDomains.tenantId, tenantId));
    const domainBySite = new Map(domains.map((d) => [d.siteId, d]));

    return {
      sites: rows.map((s) => ({
        ...s,
        previewUrl: `${config.appUrl}/preview/${s.subdomainSlug}`,
        subdomainHost: `${s.subdomainSlug}.${config.previewBaseDomain}`,
        domainConfig: domainBySite.get(s.id) ?? null,
      })),
    };
  });

  // CA-12: Isolamento Multi-Tenant estrito
  app.get('/api/sites/:id', { preHandler: operatorGuard }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const tenantId = request.user.tenantId!;

    const [site] = await db
      .select()
      .from(sites)
      .where(and(eq(sites.id, id), eq(sites.tenantId, tenantId)));

    if (!site) {
      return reply.status(404).send({ error: 'Site não encontrado neste workspace.' });
    }

    const [lead] = await db
      .select()
      .from(leads)
      .where(and(eq(leads.id, site.leadId), eq(leads.tenantId, tenantId)));

    const [domainConfig] = await db
      .select()
      .from(customDomains)
      .where(and(eq(customDomains.siteId, site.id), eq(customDomains.tenantId, tenantId)));

    const requests = await db
      .select()
      .from(clientRequests)
      .where(and(eq(clientRequests.siteId, site.id), eq(clientRequests.tenantId, tenantId)))
      .orderBy(desc(clientRequests.createdAt));

    return {
      site: {
        ...site,
        previewUrl: `${config.appUrl}/preview/${site.subdomainSlug}`,
        subdomainHost: `${site.subdomainSlug}.${config.previewBaseDomain}`,
        clientPortalUrl: site.clientPortalToken
          ? `${config.appUrl}/portal/${site.clientPortalToken}`
          : null,
      },
      lead: lead ?? null,
      domainConfig: domainConfig ?? null,
      clientRequests: requests,
    };
  });

  app.patch('/api/sites/:id/requests/:requestId', { preHandler: operatorGuard }, async (request, reply) => {
    const { id, requestId } = request.params as { id: string; requestId: string };
    const body = z.object({ status: z.enum(['OPEN', 'DONE']) }).safeParse(request.body);
    if (!body.success) return reply.status(400).send({ error: 'Status inválido.' });

    const [updated] = await db
      .update(clientRequests)
      .set({ status: body.data.status })
      .where(
        and(
          eq(clientRequests.id, requestId),
          eq(clientRequests.siteId, id),
          eq(clientRequests.tenantId, request.user.tenantId!),
        ),
      )
      .returning();

    if (!updated) return reply.status(404).send({ error: 'Solicitação não encontrada neste workspace.' });
    return { request: updated };
  });

  // RF-11 + CA-06: Editor rápido pré-envio
  app.patch('/api/sites/:id', { preHandler: operatorGuard }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const parsed = QuickEditSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Alterações inválidas.', issues: parsed.error.issues });
    }

    try {
      const updated = await updateSiteQuickEditor(db, {
        tenantId: request.user.tenantId!,
        userId: request.user.userId,
        actorRole: request.user.role,
        siteId: id,
        templateSlug: parsed.data.templateSlug,
        primaryColor: parsed.data.primaryColor,
        fontPairing: parsed.data.fontPairing,
        contentPatch: parsed.data.contentPatch as any,
        appUrl: config.appUrl,
      });

      if (!updated) {
        return reply.status(404).send({ error: 'Site não encontrado neste workspace.' });
      }

      return { site: updated };
    } catch (err: any) {
      return reply.status(400).send({
        error: err?.message || 'Erro de validação de schema do site.',
      });
    }
  });

  app.get('/api/sites/:id/telemetry', { preHandler: operatorGuard }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const summary = await getSiteTelemetrySummary(db, request.user.tenantId!, id);
    if (!summary) {
      return reply.status(404).send({ error: 'Site não encontrado neste workspace.' });
    }
    return summary;
  });

  app.post('/api/sites/:id/media', { preHandler: operatorGuard }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const tenantId = request.user.tenantId!;

    const [site] = await db
      .select({ id: sites.id })
      .from(sites)
      .where(and(eq(sites.id, id), eq(sites.tenantId, tenantId)));
    if (!site) {
      return reply.status(404).send({ error: 'Site não encontrado neste workspace.' });
    }

    const file = await request.file();
    if (!file) {
      return reply.status(400).send({ error: 'Envie um arquivo de imagem.' });
    }
    const buffer = await file.toBuffer();
    const stored = await optimizeAndStoreUploadedImage(buffer, tenantId);
    return reply.status(201).send(stored);
  });

  // RF-19: Domínio customizado + instruções DNS
  app.post('/api/sites/:id/domain', { preHandler: operatorGuard }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const parsed = ConfigureDomainSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Domínio inválido.' });
    }

    const domainRow = await configureCustomDomainForSite(db, {
      tenantId: request.user.tenantId!,
      siteId: id,
      domain: parsed.data.domain,
      expectedCname: config.platformCnameTarget,
      expectedARecord: config.platformPublicIp,
    });

    if (!domainRow) {
      return reply.status(404).send({ error: 'Site não encontrado neste workspace.' });
    }

    return {
      domain: domainRow,
      instructions: {
        cname: { type: 'CNAME', host: 'www (ou subdomínio)', target: domainRow.expectedCname },
        aRecord: { type: 'A', host: '@', target: domainRow.expectedARecord },
      },
    };
  });

  app.post('/api/sites/:id/domain/verify', { preHandler: operatorGuard }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = (request.body as { simulateVerified?: boolean } | undefined) || {};

    const result = await verifyCustomDomainForSite(db, {
      tenantId: request.user.tenantId!,
      siteId: id,
      simulateVerified: Boolean(body.simulateVerified && process.env.NODE_ENV !== 'production'),
      appUrl: config.appUrl,
    });

    if (!result) {
      return reply.status(404).send({ error: 'Configuração de domínio não encontrada para este site.' });
    }

    return result;
  });
}
