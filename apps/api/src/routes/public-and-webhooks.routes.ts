import fs from 'node:fs/promises';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { and, desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import {
  campaignDispatches,
  checkoutOffers,
  clientRequests,
  customDomains,
  leads,
  notifications,
  paymentTransactions,
  sites,
  type DbContext,
} from '@plataforma/db';
import {
  buildSignedSandboxWebhook,
  optimizeAndStoreUploadedImage,
} from '@plataforma/integrations';
import type { QueueManager } from '@plataforma/queue';
import {
  sanitizeAndValidateSiteDocument,
  sanitizePlainText,
} from '@plataforma/shared';
import { generateSecureToken } from '@plataforma/shared/crypto';
import type { AppConfig } from '../config.js';
import { recordSiteTelemetryEvent } from '../services/telemetry.service.js';
import { processPaymentWebhook } from '../services/billing-domain.service.js';
import { triggerFrontendCacheRevalidation } from '../services/site-generation.service.js';
import {
  isOptOutMessageContent,
  markLeadOptOut,
} from '../services/messaging.service.js';

export function registerPublicAndWebhookRoutes(
  app: FastifyInstance,
  dbCtx: DbContext,
  queue: QueueManager,
  config: AppConfig,
) {
  const { db } = dbCtx;

  app.get('/health', async () => {
    await dbCtx.executeRaw('SELECT 1 AS ok');
    return {
      status: 'ok',
      dialect: dbCtx.dialect,
      hasPostgis: dbCtx.hasPostgis,
      queueDriver: queue.getDriver(),
      timestamp: new Date().toISOString(),
    };
  });

  // Caddy On-Demand TLS Ask Endpoint (RF-19)
  app.get('/internal/caddy/ask', async (request, reply) => {
    const { domain } = request.query as { domain?: string };
    if (!domain) return reply.status(400).send({ allowed: false });

    const clean = domain.toLowerCase().trim().split(':')[0] || '';
    const previewSuffix = `.${config.previewBaseDomain.toLowerCase()}`;

    if (clean.endsWith(previewSuffix)) {
      const slug = clean.slice(0, -previewSuffix.length);
      const [site] = await db
        .select({ id: sites.id, status: sites.status })
        .from(sites)
        .where(eq(sites.subdomainSlug, slug));
      if (site && (site.status === 'PREVIEW' || site.status === 'PUBLISHED')) {
        return reply.status(200).send({ allowed: true });
      }
      return reply.status(404).send({ allowed: false });
    }

    const [custom] = await db
      .select({ id: customDomains.id })
      .from(customDomains)
      .where(and(eq(customDomains.domain, clean), eq(customDomains.dnsStatus, 'VERIFIED')));
    if (custom) {
      return reply.status(200).send({ allowed: true });
    }

    return reply.status(404).send({ allowed: false });
  });

  // Static media serving for local Object Storage driver
  app.get('/api/media/*', async (request, reply) => {
    const rel = (request.params as { '*': string })['*'] || '';
    const baseDir = path.resolve(process.cwd(), config.localStorageDir);
    const resolved = path.resolve(baseDir, rel);
    if (!resolved.startsWith(baseDir + path.sep)) {
      return reply.status(403).send({ error: 'Caminho inválido.' });
    }
    try {
      const buf = await fs.readFile(resolved);
      reply.header('Content-Type', 'image/webp');
      reply.header('Cache-Control', 'public, max-age=31536000, immutable');
      return reply.send(buf);
    } catch {
      return reply.status(404).send({ error: 'Arquivo não encontrado.' });
    }
  });

  // Resolver site público por slug de preview (RF-10)
  app.get('/api/public/sites/by-slug/:slug', async (request, reply) => {
    const { slug } = request.params as { slug: string };
    const [site] = await db
      .select()
      .from(sites)
      .where(eq(sites.subdomainSlug, slug.toLowerCase().trim()));
    if (!site) return reply.status(404).send({ error: 'Site não encontrado.' });

    const [offer] = await db
      .select({ token: checkoutOffers.token, status: checkoutOffers.status })
      .from(checkoutOffers)
      .where(and(eq(checkoutOffers.siteId, site.id), eq(checkoutOffers.status, 'ACTIVE')))
      .orderBy(desc(checkoutOffers.createdAt))
      .limit(1);

    reply.header(
      'Cache-Control',
      site.status === 'PUBLISHED' ? 'public, s-maxage=60, stale-while-revalidate=300' : 'no-store',
    );

    return {
      site: {
        id: site.id,
        subdomainSlug: site.subdomainSlug,
        customDomain: site.customDomain,
        status: site.status,
        templateSlug: site.templateSlug,
        contentJson: site.contentJson,
        cacheVersion: site.cacheVersion,
      },
      checkoutUrl: offer ? `${config.appUrl}/checkout/${offer.token}` : null,
    };
  });

  // Resolver site público por Hostname (subdomínio wildcard ou domínio customizado CA-11)
  app.get('/api/public/sites/by-host', async (request, reply) => {
    const { host } = request.query as { host?: string };
    if (!host) return reply.status(400).send({ error: 'Parâmetro host obrigatório.' });

    const cleanHost = host.toLowerCase().trim().split(':')[0] || '';
    const previewSuffix = `.${config.previewBaseDomain.toLowerCase()}`;

    let site: typeof sites.$inferSelect | undefined;
    if (cleanHost.endsWith(previewSuffix)) {
      const slug = cleanHost.slice(0, -previewSuffix.length);
      [site] = await db.select().from(sites).where(eq(sites.subdomainSlug, slug));
    } else {
      [site] = await db.select().from(sites).where(eq(sites.customDomain, cleanHost));
    }

    if (!site) return reply.status(404).send({ error: 'Site não encontrado para este domínio.' });

    const [offer] = await db
      .select({ token: checkoutOffers.token })
      .from(checkoutOffers)
      .where(and(eq(checkoutOffers.siteId, site.id), eq(checkoutOffers.status, 'ACTIVE')))
      .orderBy(desc(checkoutOffers.createdAt))
      .limit(1);

    reply.header(
      'Cache-Control',
      site.status === 'PUBLISHED' ? 'public, s-maxage=60, stale-while-revalidate=300' : 'no-store',
    );

    return {
      site: {
        id: site.id,
        subdomainSlug: site.subdomainSlug,
        customDomain: site.customDomain,
        status: site.status,
        templateSlug: site.templateSlug,
        contentJson: site.contentJson,
        cacheVersion: site.cacheVersion,
      },
      checkoutUrl: offer ? `${config.appUrl}/checkout/${offer.token}` : null,
    };
  });

  // RF-12 + CA-07: Telemetria pública de acesso e cliques no preview
  app.post('/api/public/telemetry', async (request, reply) => {
    const body = z
      .object({
        siteId: z.string().uuid(),
        eventType: z.enum(['PAGE_VIEW', 'WHATSAPP_CLICK', 'CTA_CLICK', 'PHONE_CLICK']),
        referrer: z.string().optional(),
      })
      .safeParse(request.body);

    if (!body.success) {
      return reply.status(400).send({ error: 'Evento de telemetria inválido.' });
    }

    const updated = await recordSiteTelemetryEvent(db, {
      siteId: body.data.siteId,
      eventType: body.data.eventType,
      userAgent: String(request.headers['user-agent'] || 'unknown'),
      ip: request.ip || '127.0.0.1',
      referrer: body.data.referrer,
    });

    if (!updated) return reply.status(404).send({ error: 'Site não encontrado.' });

    return {
      ok: true,
      previewViewsCount: updated.previewViewsCount,
      whatsappClicksCount: updated.whatsappClicksCount,
    };
  });

  // RF-17: Checkout público
  app.get('/api/public/checkout/:token', async (request, reply) => {
    const { token } = request.params as { token: string };
    const [offer] = await db
      .select()
      .from(checkoutOffers)
      .where(eq(checkoutOffers.token, token));
    if (!offer) return reply.status(404).send({ error: 'Link de checkout não encontrado.' });

    const [site] = await db.select().from(sites).where(eq(sites.id, offer.siteId));
    const [lead] = await db.select().from(leads).where(eq(leads.id, offer.leadId));

    return {
      offer,
      businessName: lead?.businessName || site?.contentJson.business.name || 'Cliente',
      siteStatus: site?.status || 'PREVIEW',
      subdomainSlug: site?.subdomainSlug || '',
      previewUrl: site ? `${config.appUrl}/preview/${site.subdomainSlug}` : null,
      clientPortalUrl:
        site?.status === 'PUBLISHED' && site.clientPortalToken
          ? `${config.appUrl}/portal/${site.clientPortalToken}`
          : null,
    };
  });

  app.post('/api/public/checkout/:token/pay', async (request, reply) => {
    const { token } = request.params as { token: string };
    const [offer] = await db
      .select()
      .from(checkoutOffers)
      .where(eq(checkoutOffers.token, token));
    if (!offer) return reply.status(404).send({ error: 'Oferta não encontrada.' });

    const eventId = `evt_sbx_${generateSecureToken(10)}`;
    const { rawBody, signatureHeader } = buildSignedSandboxWebhook({
      eventId,
      eventType: 'payment.succeeded',
      offerToken: offer.token,
      amountCents: offer.setupAmountCents + offer.monthlyAmountCents,
      secret: config.sandboxWebhookSecret,
    });

    const outcome = await processPaymentWebhook(db, {
      gateway: 'sandbox',
      rawBody,
      signatureHeader,
      secret: config.sandboxWebhookSecret,
      appUrl: config.appUrl,
    });

    return reply.status(outcome.statusCode).send(outcome.body);
  });

  // RF-18 + RN-10 + CA-10: Webhooks de gateway de pagamento (HMAC + Idempotência)
  app.post('/api/webhooks/payments/:gateway', async (request, reply) => {
    const { gateway } = request.params as { gateway: string };
    const gw = gateway.toLowerCase();
    if (gw !== 'stripe' && gw !== 'asaas' && gw !== 'sandbox') {
      return reply.status(400).send({ error: 'Gateway não suportado.' });
    }

    const rawBody: string = (request as any).rawBody || JSON.stringify(request.body || {});
    const secret =
      gw === 'stripe'
        ? config.stripeWebhookSecret || config.sandboxWebhookSecret
        : gw === 'asaas'
          ? config.asaasWebhookToken || config.sandboxWebhookSecret
          : config.sandboxWebhookSecret;

    const signatureHeader =
      (request.headers['stripe-signature'] as string | undefined) ||
      (request.headers['x-webhook-signature'] as string | undefined);
    const asaasTokenHeader = request.headers['asaas-access-token'] as string | undefined;

    const result = await processPaymentWebhook(db, {
      gateway: gw,
      rawBody,
      signatureHeader,
      asaasTokenHeader,
      secret,
      appUrl: config.appUrl,
    });

    return reply.status(result.statusCode).send(result.body);
  });

  // RF-16 + RN-08: Webhook de status de mensageria e detecção automática de Opt-Out
  app.post('/api/webhooks/messaging/:provider', async (request, reply) => {
    const body = z
      .object({
        externalMessageId: z.string().optional(),
        status: z.enum(['DELIVERED', 'READ', 'REPLIED', 'FAILED']).optional(),
        fromPhoneE164: z.string().optional(),
        tenantId: z.string().uuid().optional(),
        inboundText: z.string().optional(),
      })
      .safeParse(request.body);

    if (!body.success) return reply.status(400).send({ error: 'Payload inválido.' });

    const now = new Date();
    if (body.data.externalMessageId && body.data.status) {
      const patch: Partial<typeof campaignDispatches.$inferInsert> = {
        status: body.data.status,
        updatedAt: now,
      };
      if (body.data.status === 'DELIVERED') patch.deliveredAt = now;
      if (body.data.status === 'READ') patch.readAt = now;

      await db
        .update(campaignDispatches)
        .set(patch)
        .where(eq(campaignDispatches.externalMessageId, body.data.externalMessageId));
    }

    // RN-08: Se resposta contém pedido de descadastro, bloqueia imediatamente no tenant
    if (body.data.inboundText && isOptOutMessageContent(body.data.inboundText)) {
      if (body.data.fromPhoneE164) {
        const matchedLeads = await db
          .select()
          .from(leads)
          .where(
            body.data.tenantId
              ? and(
                  eq(leads.phoneE164, body.data.fromPhoneE164),
                  eq(leads.tenantId, body.data.tenantId),
                )
              : eq(leads.phoneE164, body.data.fromPhoneE164),
          );

        for (const lead of matchedLeads) {
          await markLeadOptOut(db, {
            tenantId: lead.tenantId,
            leadId: lead.id,
            reason: `Opt-out automático via resposta WhatsApp: "${sanitizePlainText(body.data.inboundText).slice(0, 80)}"`,
            actorRole: 'END_CLIENT',
          });
        }
      }
    }

    return { received: true };
  });

  // RNF-05 + RN-08: Página/API pública de descadastro LGPD
  app.get('/api/public/opt-out/:token', async (request, reply) => {
    const { token } = request.params as { token: string };
    const [lead] = await db
      .select({
        businessName: leads.businessName,
        optedOut: leads.optedOut,
        optedOutAt: leads.optedOutAt,
      })
      .from(leads)
      .where(eq(leads.optOutToken, token));
    if (!lead) return reply.status(404).send({ error: 'Link de descadastro inválido.' });
    return lead;
  });

  app.post('/api/public/opt-out/:token', async (request, reply) => {
    const { token } = request.params as { token: string };
    const [lead] = await db.select().from(leads).where(eq(leads.optOutToken, token));
    if (!lead) return reply.status(404).send({ error: 'Link de descadastro inválido.' });

    const updated = await markLeadOptOut(db, {
      tenantId: lead.tenantId,
      leadId: lead.id,
      reason: 'Descadastro voluntário via link público LGPD.',
      actorRole: 'END_CLIENT',
    });

    return { ok: true, optedOut: updated?.optedOut ?? true };
  });

  // RF-20: Portal Simplificado do Cliente Final via Link Mágico
  app.get('/api/portal/:token', async (request, reply) => {
    const { token } = request.params as { token: string };
    const [site] = await db
      .select()
      .from(sites)
      .where(eq(sites.clientPortalToken, token));
    if (!site) return reply.status(404).send({ error: 'Link mágico de acesso inválido ou expirado.' });

    const [domain] = await db
      .select()
      .from(customDomains)
      .where(eq(customDomains.siteId, site.id));

    const requests = await db
      .select()
      .from(clientRequests)
      .where(eq(clientRequests.siteId, site.id))
      .orderBy(desc(clientRequests.createdAt));

    const transactions = await db
      .select()
      .from(paymentTransactions)
      .where(eq(paymentTransactions.siteId, site.id))
      .orderBy(desc(paymentTransactions.createdAt));

    return {
      site: {
        id: site.id,
        status: site.status,
        subdomainSlug: site.subdomainSlug,
        customDomain: site.customDomain,
        contentJson: site.contentJson,
      },
      domain: domain ?? null,
      requests,
      transactions,
      dnsInstructions: {
        cnameTarget: config.platformCnameTarget,
        aRecord: config.platformPublicIp,
      },
    };
  });

  app.patch('/api/portal/:token/site', async (request, reply) => {
    const { token } = request.params as { token: string };
    const [site] = await db
      .select()
      .from(sites)
      .where(eq(sites.clientPortalToken, token));
    if (!site) return reply.status(404).send({ error: 'Link mágico inválido.' });

    const body = z
      .object({
        phoneDisplay: z.string().min(6).max(30).optional(),
        whatsappNumber: z.string().max(24).optional(),
        openingHours: z
          .array(z.object({ day: z.string().min(1).max(24), hours: z.string().min(1).max(48) }))
          .max(7)
          .optional(),
        heroImageUrl: z.string().min(1).max(500).optional(),
      })
      .safeParse(request.body);

    if (!body.success) {
      return reply.status(400).send({ error: 'Dados inválidos.', issues: body.error.issues });
    }

    const updatedDoc = sanitizeAndValidateSiteDocument({
      ...site.contentJson,
      business: {
        ...site.contentJson.business,
        phoneDisplay: body.data.phoneDisplay ?? site.contentJson.business.phoneDisplay,
        whatsappNumber:
          body.data.whatsappNumber !== undefined
            ? body.data.whatsappNumber
            : site.contentJson.business.whatsappNumber,
        openingHours: body.data.openingHours ?? site.contentJson.business.openingHours,
      },
      hero: {
        ...site.contentJson.hero,
        heroImageUrl: body.data.heroImageUrl ?? site.contentJson.hero.heroImageUrl,
      },
    });

    const [saved] = await db
      .update(sites)
      .set({
        contentJson: updatedDoc,
        cacheVersion: site.cacheVersion + 1,
        updatedAt: new Date(),
      })
      .where(eq(sites.id, site.id))
      .returning();

    if (!saved) return reply.status(404).send({ error: 'Site não encontrado.' });

    await triggerFrontendCacheRevalidation(
      config.appUrl,
      saved.subdomainSlug,
      saved.customDomain,
    );

    return { site: saved };
  });

  app.post('/api/portal/:token/media', async (request, reply) => {
    const { token } = request.params as { token: string };
    const [site] = await db
      .select()
      .from(sites)
      .where(eq(sites.clientPortalToken, token));
    if (!site) return reply.status(404).send({ error: 'Link mágico inválido.' });

    const data = await request.file();
    if (!data) return reply.status(400).send({ error: 'Arquivo de imagem obrigatório.' });
    if (data.mimetype && !/^image\/(jpeg|jpg|png|webp|gif|avif)$/i.test(data.mimetype)) {
      return reply.status(400).send({ error: 'Formato de imagem inválido. Use PNG, JPG ou WebP.' });
    }

    const buffer = await data.toBuffer();
    let stored: { url: string; width: number; height: number };
    try {
      stored = await optimizeAndStoreUploadedImage(buffer, site.tenantId);
    } catch {
      return reply.status(400).send({ error: 'Não foi possível processar a imagem enviada.' });
    }

    const updatedDoc = sanitizeAndValidateSiteDocument({
      ...site.contentJson,
      hero: {
        ...site.contentJson.hero,
        heroImageUrl: stored.url,
      },
      gallery: [
        {
          url: stored.url,
          alt: `${site.contentJson.business.name} - foto enviada pelo cliente`,
          isStockFallback: false,
        },
        ...site.contentJson.gallery.slice(0, 5),
      ],
    });

    const [saved] = await db
      .update(sites)
      .set({
        contentJson: updatedDoc,
        cacheVersion: site.cacheVersion + 1,
        updatedAt: new Date(),
      })
      .where(eq(sites.id, site.id))
      .returning();

    if (!saved) return reply.status(404).send({ error: 'Site não encontrado.' });

    await triggerFrontendCacheRevalidation(
      config.appUrl,
      saved.subdomainSlug,
      saved.customDomain,
    );

    return reply.status(201).send({ url: stored.url, site: saved });
  });

  app.post('/api/portal/:token/requests', async (request, reply) => {
    const { token } = request.params as { token: string };
    const [site] = await db
      .select()
      .from(sites)
      .where(eq(sites.clientPortalToken, token));
    if (!site) return reply.status(404).send({ error: 'Link mágico inválido.' });

    const body = z
      .object({
        requestType: z
          .enum(['CONTENT_ADJUSTMENT', 'INFO_UPDATE', 'DOMAIN_HELP', 'SUBSCRIPTION'])
          .default('CONTENT_ADJUSTMENT'),
        message: z.string().min(5).max(1500),
      })
      .safeParse(request.body);
    if (!body.success) return reply.status(400).send({ error: 'Mensagem de solicitação inválida.' });

    const sanitizedMessage = sanitizePlainText(body.data.message);
    const [created] = await db
      .insert(clientRequests)
      .values({
        tenantId: site.tenantId,
        siteId: site.id,
        requestType: body.data.requestType,
        message: sanitizedMessage,
      })
      .returning();

    await db.insert(notifications).values({
      tenantId: site.tenantId,
      leadId: site.leadId,
      siteId: site.id,
      type: 'NEW_CLIENT_REQUEST',
      title: 'Nova solicitação no Portal do Cliente',
      body: `${body.data.requestType}: ${sanitizedMessage.slice(0, 140)}`,
    });

    return reply.status(201).send({ request: created });
  });

  app.post('/api/portal/:token/subscription', async (request, reply) => {
    const { token } = request.params as { token: string };
    const [site] = await db
      .select()
      .from(sites)
      .where(eq(sites.clientPortalToken, token));
    if (!site) return reply.status(404).send({ error: 'Link mágico inválido.' });

    const body = z
      .object({ action: z.enum(['CANCEL', 'REACTIVATE']) })
      .safeParse(request.body);
    if (!body.success) return reply.status(400).send({ error: 'Ação inválida.' });

    const now = new Date();
    if (body.data.action === 'CANCEL') {
      await db
        .update(paymentTransactions)
        .set({ status: 'CANCELED', updatedAt: now })
        .where(eq(paymentTransactions.siteId, site.id));
      await db
        .update(sites)
        .set({
          status: 'SUSPENDED',
          suspendedAt: now,
          cacheVersion: site.cacheVersion + 1,
          updatedAt: now,
        })
        .where(eq(sites.id, site.id));
      await triggerFrontendCacheRevalidation(
        config.appUrl,
        site.subdomainSlug,
        site.customDomain,
      );
      return { status: 'SUSPENDED' };
    }

    await db
      .update(paymentTransactions)
      .set({ status: 'PAID', paidAt: now, updatedAt: now })
      .where(eq(paymentTransactions.siteId, site.id));
    await db
      .update(sites)
      .set({
        status: 'PUBLISHED',
        suspendedAt: null,
        cacheVersion: site.cacheVersion + 1,
        updatedAt: now,
      })
      .where(eq(sites.id, site.id));
    await triggerFrontendCacheRevalidation(
      config.appUrl,
      site.subdomainSlug,
      site.customDomain,
    );
    return { status: 'PUBLISHED' };
  });
}
