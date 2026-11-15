import type { FastifyInstance } from 'fastify';
import { and, desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import {
  checkoutOffers,
  customDomains,
  notifications,
  paymentTransactions,
  tenantSecrets,
  type DbContext,
} from '@plataforma/db';
import { SECRET_PROVIDERS } from '@plataforma/shared';
import type { AppConfig } from '../config.js';
import { requireTenantOperator } from '../auth.js';
import { createCheckoutOfferForSite } from '../services/billing-domain.service.js';
import {
  getTenantUsageSummary,
  upsertEncryptedTenantSecret,
} from '../services/quota.service.js';
import { recordAuditLog } from '../services/audit.service.js';

const CreateOfferSchema = z.object({
  siteId: z.string().uuid(),
  gateway: z.enum(['STRIPE', 'ASAAS', 'SANDBOX']).default('SANDBOX'),
  billingModel: z.enum(['ONE_TIME', 'SUBSCRIPTION', 'HYBRID']).default('HYBRID'),
  title: z.string().min(3).max(120).optional(),
  description: z.string().min(5).max(500).optional(),
  setupAmountCents: z.number().int().min(0).max(50_000_000),
  monthlyAmountCents: z.number().int().min(0).max(5_000_000),
});

export function registerBillingAndSettingsRoutes(
  app: FastifyInstance,
  dbCtx: DbContext,
  config: AppConfig,
) {
  const { db } = dbCtx;
  const operatorGuard = requireTenantOperator();

  // RF-17: Gerar Link de Checkout Integrado
  app.post('/api/checkout/offers', { preHandler: operatorGuard }, async (request, reply) => {
    const parsed = CreateOfferSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Oferta comercial inválida.', issues: parsed.error.issues });
    }

    if (parsed.data.setupAmountCents === 0 && parsed.data.monthlyAmountCents === 0) {
      return reply.status(400).send({ error: 'Informe um valor de implantação ou assinatura mensal.' });
    }

    const offer = await createCheckoutOfferForSite(db, {
      tenantId: request.user.tenantId!,
      userId: request.user.userId,
      actorRole: request.user.role,
      ...parsed.data,
      appUrl: config.appUrl,
      masterKey: config.encryptionMasterKey,
    });

    if (!offer) {
      return reply.status(404).send({ error: 'Site não encontrado neste workspace.' });
    }

    return reply.status(201).send({
      offer,
      checkoutUrl: `${config.appUrl}/checkout/${offer.token}`,
    });
  });

  app.get('/api/checkout/offers', { preHandler: operatorGuard }, async (request) => {
    const tenantId = request.user.tenantId!;
    const offers = await db
      .select()
      .from(checkoutOffers)
      .where(eq(checkoutOffers.tenantId, tenantId))
      .orderBy(desc(checkoutOffers.createdAt));

    const transactions = await db
      .select()
      .from(paymentTransactions)
      .where(eq(paymentTransactions.tenantId, tenantId))
      .orderBy(desc(paymentTransactions.createdAt));

    const domains = await db
      .select()
      .from(customDomains)
      .where(eq(customDomains.tenantId, tenantId))
      .orderBy(desc(customDomains.createdAt));

    return { offers, transactions, domains };
  });

  // RNF-04 + RN-09: Chaves BYOK criptografadas com AES-256-GCM
  app.get('/api/settings/secrets', { preHandler: operatorGuard }, async (request) => {
    const rows = await db
      .select({
        id: tenantSecrets.id,
        provider: tenantSecrets.provider,
        keyHint: tenantSecrets.keyHint,
        isActive: tenantSecrets.isActive,
        updatedAt: tenantSecrets.updatedAt,
      })
      .from(tenantSecrets)
      .where(eq(tenantSecrets.tenantId, request.user.tenantId!));
    return { secrets: rows };
  });

  app.put('/api/settings/secrets/:provider', { preHandler: operatorGuard }, async (request, reply) => {
    const { provider } = request.params as { provider: string };
    if (!SECRET_PROVIDERS.includes(provider as any)) {
      return reply.status(400).send({ error: 'Provedor não suportado.' });
    }
    const body = z.object({ secretValue: z.string().min(6).max(500) }).safeParse(request.body);
    if (!body.success) {
      return reply.status(400).send({ error: 'Valor da chave de API inválido.' });
    }

    const saved = await upsertEncryptedTenantSecret(db, {
      tenantId: request.user.tenantId!,
      provider: provider as any,
      secretValue: body.data.secretValue,
      masterKey: config.encryptionMasterKey,
    });

    await recordAuditLog(db, {
      tenantId: request.user.tenantId!,
      userId: request.user.userId,
      actorRole: request.user.role,
      action: 'BYOK_SECRET_UPDATED',
      resourceType: 'tenant_secret',
      resourceId: provider,
    });

    return { secret: saved };
  });

  app.delete('/api/settings/secrets/:provider', { preHandler: operatorGuard }, async (request) => {
    const { provider } = request.params as { provider: string };
    await db
      .delete(tenantSecrets)
      .where(
        and(
          eq(tenantSecrets.tenantId, request.user.tenantId!),
          eq(tenantSecrets.provider, provider),
        ),
      );
    return { ok: true };
  });

  // RNF-07: Telemetria granular de consumo e orçamento
  app.get('/api/settings/usage', { preHandler: operatorGuard }, async (request) => {
    return getTenantUsageSummary(db, request.user.tenantId!);
  });

  // Notificações em tempo real (RF-12)
  app.get('/api/notifications', { preHandler: operatorGuard }, async (request) => {
    const items = await db
      .select()
      .from(notifications)
      .where(eq(notifications.tenantId, request.user.tenantId!))
      .orderBy(desc(notifications.createdAt))
      .limit(30);
    return { notifications: items };
  });

  app.post('/api/notifications/:id/read', { preHandler: operatorGuard }, async (request) => {
    const { id } = request.params as { id: string };
    await db
      .update(notifications)
      .set({ isRead: true })
      .where(and(eq(notifications.id, id), eq(notifications.tenantId, request.user.tenantId!)));
    return { ok: true };
  });
}
