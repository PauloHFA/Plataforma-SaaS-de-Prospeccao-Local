import type { FastifyInstance } from 'fastify';
import { desc, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import {
  auditLogs,
  leads,
  plans,
  sites,
  siteTemplates,
  tenants,
  usageTelemetry,
  type DbContext,
} from '@plataforma/db';
import { QUEUE_NAMES, type QueueManager, type QueueName } from '@plataforma/queue';
import { requireRole } from '../auth.js';
import { runLifecycleCronTask } from '../services/billing-domain.service.js';

export function registerAdminRoutes(
  app: FastifyInstance,
  dbCtx: DbContext,
  queue: QueueManager,
) {
  const { db } = dbCtx;
  const adminGuard = requireRole('GLOBAL_ADMIN');

  app.get('/api/admin/overview', { preHandler: adminGuard }, async () => {
    const [tenantCount] = await db.select({ count: sql<number>`COUNT(*)::int` }).from(tenants);
    const [leadCount] = await db.select({ count: sql<number>`COUNT(*)::int` }).from(leads);
    const [siteCount] = await db.select({ count: sql<number>`COUNT(*)::int` }).from(sites);
    const [publishedCount] = await db
      .select({ count: sql<number>`COUNT(*)::int` })
      .from(sites)
      .where(eq(sites.status, 'PUBLISHED'));

    const [tokensSum] = await db
      .select({
        tokens: sql<number>`COALESCE(SUM(${usageTelemetry.promptTokens} + ${usageTelemetry.completionTokens}), 0)::int`,
        costCents: sql<number>`COALESCE(SUM(${usageTelemetry.estimatedCostCents}), 0)::int`,
      })
      .from(usageTelemetry);

    const queueMetrics = await queue.getMetrics();

    return {
      metrics: {
        totalTenants: Number(tenantCount?.count ?? 0),
        totalLeads: Number(leadCount?.count ?? 0),
        totalSites: Number(siteCount?.count ?? 0),
        publishedSites: Number(publishedCount?.count ?? 0),
        totalLlmTokens: Number(tokensSum?.tokens ?? 0),
        totalEstimatedCostCents: Number(tokensSum?.costCents ?? 0),
      },
      queues: queueMetrics,
    };
  });

  app.get('/api/admin/plans', { preHandler: adminGuard }, async () => {
    const items = await db.select().from(plans).orderBy(plans.priceCents);
    return { plans: items };
  });

  app.patch('/api/admin/plans/:id', { preHandler: adminGuard }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = z
      .object({
        monthlyCredits: z.number().int().min(0).optional(),
        maxSearchesPerMonth: z.number().int().min(0).optional(),
        maxSitesPerMonth: z.number().int().min(0).optional(),
        maxMessagesPerDay: z.number().int().min(0).optional(),
        maxActivePreviews: z.number().int().min(0).optional(),
        monthlyBudgetCents: z.number().int().min(0).optional(),
        allowByok: z.boolean().optional(),
        isActive: z.boolean().optional(),
      })
      .safeParse(request.body);
    if (!body.success) return reply.status(400).send({ error: 'Dados inválidos.' });

    const [updated] = await db
      .update(plans)
      .set(body.data)
      .where(eq(plans.id, id))
      .returning();
    if (!updated) return reply.status(404).send({ error: 'Plano não encontrado.' });
    return { plan: updated };
  });

  app.get('/api/admin/tenants', { preHandler: adminGuard }, async () => {
    const allTenants = await db.select().from(tenants).orderBy(desc(tenants.createdAt));
    return { tenants: allTenants };
  });

  app.patch('/api/admin/tenants/:id', { preHandler: adminGuard }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = z
      .object({
        planId: z.string().uuid().optional(),
        status: z.enum(['ACTIVE', 'SUSPENDED']).optional(),
        creditsBalance: z.number().int().min(0).optional(),
        previewExpirationDays: z.number().int().min(1).max(90).optional(),
      })
      .safeParse(request.body);
    if (!body.success) return reply.status(400).send({ error: 'Dados inválidos.' });

    const [updated] = await db
      .update(tenants)
      .set({ ...body.data, updatedAt: new Date() })
      .where(eq(tenants.id, id))
      .returning();
    if (!updated) return reply.status(404).send({ error: 'Workspace não encontrado.' });
    return { tenant: updated };
  });

  app.get('/api/admin/templates', { preHandler: adminGuard }, async () => {
    const list = await db.select().from(siteTemplates);
    return { templates: list };
  });

  app.patch('/api/admin/templates/:id', { preHandler: adminGuard }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = z
      .object({
        name: z.string().min(2).max(80).optional(),
        description: z.string().min(5).max(300).optional(),
        isActive: z.boolean().optional(),
      })
      .safeParse(request.body);
    if (!body.success) return reply.status(400).send({ error: 'Dados inválidos.' });

    const [updated] = await db
      .update(siteTemplates)
      .set(body.data)
      .where(eq(siteTemplates.id, id))
      .returning();
    if (!updated) return reply.status(404).send({ error: 'Template não encontrado.' });
    return { template: updated };
  });

  app.get('/api/admin/queues', { preHandler: adminGuard }, async () => {
    return { queues: await queue.getMetrics() };
  });

  app.post('/api/admin/queues/:name/retry-failed', { preHandler: adminGuard }, async (request, reply) => {
    const { name } = request.params as { name: string };
    if (!QUEUE_NAMES.includes(name as QueueName)) {
      return reply.status(400).send({ error: 'Fila desconhecida.' });
    }
    const retried = await queue.retryFailed(name as QueueName);
    return { retried };
  });

  app.get('/api/admin/audit-logs', { preHandler: adminGuard }, async () => {
    const logs = await db
      .select()
      .from(auditLogs)
      .orderBy(desc(auditLogs.createdAt))
      .limit(100);
    return { logs };
  });

  app.post('/api/admin/lifecycle/run', { preHandler: adminGuard }, async (request) => {
    const body = z
      .object({ task: z.enum(['expire-previews', 'suspend-delinquent']) })
      .parse(request.body);
    return runLifecycleCronTask(db, body.task);
  });
}
