import type { FastifyInstance } from 'fastify';
import { and, desc, eq, ilike, or } from 'drizzle-orm';
import { z } from 'zod';
import {
  campaignDispatches,
  leadNotes,
  leads,
  sites,
  type DbContext,
} from '@plataforma/db';
import type { QueueManager } from '@plataforma/queue';
import { FUNNEL_STAGES } from '@plataforma/shared';
import type { AppConfig } from '../config.js';
import { requireTenantOperator } from '../auth.js';
import { searchAndEnrichLeads } from '../services/enrichment.service.js';
import { markLeadOptOut } from '../services/messaging.service.js';
import { QuotaExceededError } from '../services/quota.service.js';

const SearchSchema = z.object({
  keyword: z.string().min(2).max(100),
  city: z.string().max(80).optional(),
  state: z.string().max(10).optional(),
  neighborhood: z.string().max(80).optional(),
  postalCode: z.string().max(16).optional(),
  lat: z.number().optional(),
  lng: z.number().optional(),
  radiusKm: z.number().min(1).max(50).optional(),
  limit: z.number().int().min(1).max(20).optional(),
  websiteFilter: z
    .enum(['ALL', 'WITHOUT_OWN_SITE', 'NO_WEBSITE', 'SOCIAL_ONLY', 'OWN_DOMAIN'])
    .optional(),
  waitForValidation: z.boolean().optional(),
});

const PatchLeadSchema = z.object({
  funnelStage: z.enum(FUNNEL_STAGES).optional(),
  email: z.string().email().optional().or(z.literal('')),
  phoneRaw: z.string().max(30).optional(),
});

export function registerLeadRoutes(
  app: FastifyInstance,
  dbCtx: DbContext,
  queue: QueueManager,
  config: AppConfig,
) {
  const { db } = dbCtx;
  const operatorGuard = requireTenantOperator();

  app.post('/api/leads/search', { preHandler: operatorGuard }, async (request, reply) => {
    const parsed = SearchSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Parâmetros de busca inválidos.', issues: parsed.error.issues });
    }

    try {
      const result = await searchAndEnrichLeads(db, queue, {
        ...parsed.data,
        tenantId: request.user.tenantId!,
        userId: request.user.userId,
        actorRole: request.user.role,
        masterKey: config.encryptionMasterKey,
      });
      return result;
    } catch (err) {
      if (err instanceof QuotaExceededError) {
        return reply.status(402).send({ error: err.message });
      }
      throw err;
    }
  });

  app.get('/api/leads', { preHandler: operatorGuard }, async (request) => {
    const tenantId = request.user.tenantId!;
    const query = request.query as {
      funnelStage?: string;
      websiteCategory?: string;
      whatsappValid?: string;
      niche?: string;
      q?: string;
    };

    const conditions = [eq(leads.tenantId, tenantId)];
    if (query.funnelStage) {
      conditions.push(eq(leads.funnelStage, query.funnelStage));
    }
    if (query.websiteCategory === 'WITHOUT_OWN_SITE') {
      conditions.push(
        or(eq(leads.websiteCategory, 'NO_WEBSITE'), eq(leads.websiteCategory, 'SOCIAL_ONLY'))!,
      );
    } else if (query.websiteCategory) {
      conditions.push(eq(leads.websiteCategory, query.websiteCategory));
    }
    if (query.whatsappValid === 'true') {
      conditions.push(eq(leads.whatsappValid, true));
    } else if (query.whatsappValid === 'false') {
      conditions.push(eq(leads.whatsappValid, false));
    }
    if (query.niche) {
      conditions.push(eq(leads.niche, query.niche));
    }
    if (query.q && query.q.trim()) {
      const pattern = `%${query.q.trim()}%`;
      conditions.push(
        or(
          ilike(leads.businessName, pattern),
          ilike(leads.city, pattern),
          ilike(leads.neighborhood, pattern),
          ilike(leads.category, pattern),
        )!,
      );
    }

    const items = await db
      .select()
      .from(leads)
      .where(and(...conditions))
      .orderBy(desc(leads.createdAt))
      .limit(200);

    const tenantSites = await db
      .select({
        id: sites.id,
        leadId: sites.leadId,
        subdomainSlug: sites.subdomainSlug,
        status: sites.status,
        previewViewsCount: sites.previewViewsCount,
        whatsappClicksCount: sites.whatsappClicksCount,
      })
      .from(sites)
      .where(eq(sites.tenantId, tenantId));

    const siteByLead = new Map<string, (typeof tenantSites)[number]>();
    for (const s of tenantSites) {
      siteByLead.set(s.leadId, s);
    }

    return {
      leads: items.map((l) => ({
        ...l,
        site: siteByLead.get(l.id) ?? null,
      })),
    };
  });

  // CA-12: Isolamento Multi-Tenant rigoroso — retorna 404 caso o lead pertença a outro workspace
  app.get('/api/leads/:id', { preHandler: operatorGuard }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const tenantId = request.user.tenantId!;

    const [lead] = await db
      .select()
      .from(leads)
      .where(and(eq(leads.id, id), eq(leads.tenantId, tenantId)));

    if (!lead) {
      return reply.status(404).send({ error: 'Lead não encontrado neste workspace.' });
    }

    const leadSites = await db
      .select()
      .from(sites)
      .where(and(eq(sites.leadId, lead.id), eq(sites.tenantId, tenantId)))
      .orderBy(desc(sites.createdAt));

    const notes = await db
      .select()
      .from(leadNotes)
      .where(and(eq(leadNotes.leadId, lead.id), eq(leadNotes.tenantId, tenantId)))
      .orderBy(desc(leadNotes.createdAt));

    const dispatches = await db
      .select()
      .from(campaignDispatches)
      .where(and(eq(campaignDispatches.leadId, lead.id), eq(campaignDispatches.tenantId, tenantId)))
      .orderBy(desc(campaignDispatches.createdAt));

    return {
      lead: { ...lead, site: leadSites[0] ?? null },
      sites: leadSites,
      notes,
      dispatches,
    };
  });

  app.patch('/api/leads/:id', { preHandler: operatorGuard }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const parsed = PatchLeadSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Dados inválidos.', issues: parsed.error.issues });
    }

    const [updated] = await db
      .update(leads)
      .set({
        ...(parsed.data.funnelStage ? { funnelStage: parsed.data.funnelStage } : {}),
        ...(parsed.data.email !== undefined ? { email: parsed.data.email || null } : {}),
        ...(parsed.data.phoneRaw !== undefined ? { phoneRaw: parsed.data.phoneRaw } : {}),
        updatedAt: new Date(),
      })
      .where(and(eq(leads.id, id), eq(leads.tenantId, request.user.tenantId!)))
      .returning();

    if (!updated) {
      return reply.status(404).send({ error: 'Lead não encontrado neste workspace.' });
    }
    return { lead: updated };
  });

  app.post('/api/leads/:id/notes', { preHandler: operatorGuard }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = z.object({ content: z.string().min(1).max(2000) }).safeParse(request.body);
    if (!body.success) {
      return reply.status(400).send({ error: 'Conteúdo da anotação é obrigatório.' });
    }

    const [lead] = await db
      .select({ id: leads.id })
      .from(leads)
      .where(and(eq(leads.id, id), eq(leads.tenantId, request.user.tenantId!)));
    if (!lead) {
      return reply.status(404).send({ error: 'Lead não encontrado neste workspace.' });
    }

    const [note] = await db
      .insert(leadNotes)
      .values({
        tenantId: request.user.tenantId!,
        leadId: lead.id,
        userId: request.user.userId,
        content: body.data.content.trim(),
      })
      .returning();

    return reply.status(201).send({ note });
  });

  app.post('/api/leads/:id/validate-whatsapp', { preHandler: operatorGuard }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const [lead] = await db
      .select({ id: leads.id })
      .from(leads)
      .where(and(eq(leads.id, id), eq(leads.tenantId, request.user.tenantId!)));
    if (!lead) {
      return reply.status(404).send({ error: 'Lead não encontrado neste workspace.' });
    }

    await queue.enqueue('lead-enrichment', 'validate-single', {
      tenantId: request.user.tenantId!,
      leadIds: [lead.id],
      validateWhatsApp: true,
    });
    await queue.waitUntilIdle('lead-enrichment', 8000);

    const [updated] = await db
      .select()
      .from(leads)
      .where(and(eq(leads.id, id), eq(leads.tenantId, request.user.tenantId!)));

    return { lead: updated };
  });

  app.post('/api/leads/:id/opt-out', { preHandler: operatorGuard }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = z.object({ reason: z.string().max(300).optional() }).safeParse(request.body || {});
    const reason = (body.success && body.data.reason) || 'Marcado manualmente pelo operador (LGPD).';

    const updated = await markLeadOptOut(db, {
      tenantId: request.user.tenantId!,
      leadId: id,
      reason,
      userId: request.user.userId,
      actorRole: request.user.role,
    });

    if (!updated) {
      return reply.status(404).send({ error: 'Lead não encontrado neste workspace.' });
    }
    return { lead: updated };
  });
}
