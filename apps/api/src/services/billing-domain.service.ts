import { and, eq, lte, sql } from 'drizzle-orm';
import type { AppDatabase } from '@plataforma/db';
import {
  checkoutOffers,
  customDomains,
  leads,
  notifications,
  paymentTransactions,
  processedWebhookEvents,
  sites,
  tenants,
} from '@plataforma/db';
import {
  createGatewayCheckoutSession,
  verifyAndProvisionCustomDomain,
} from '@plataforma/integrations';
import {
  generateSecureToken,
  sha256Hex,
  verifyHmacSignature,
} from '@plataforma/shared/crypto';
import { recordAuditLog } from './audit.service.js';
import { getDecryptedTenantSecret } from './quota.service.js';
import { triggerFrontendCacheRevalidation } from './site-generation.service.js';

export async function createCheckoutOfferForSite(
  db: AppDatabase,
  params: {
    tenantId: string;
    userId: string;
    actorRole: string;
    siteId: string;
    gateway: 'STRIPE' | 'ASAAS' | 'SANDBOX';
    billingModel: 'ONE_TIME' | 'SUBSCRIPTION' | 'HYBRID';
    title?: string;
    description?: string;
    setupAmountCents: number;
    monthlyAmountCents: number;
    appUrl: string;
    masterKey?: string;
  },
) {
  const [site] = await db
    .select()
    .from(sites)
    .where(and(eq(sites.id, params.siteId), eq(sites.tenantId, params.tenantId)));
  if (!site) return null;

  const [lead] = await db
    .select()
    .from(leads)
    .where(and(eq(leads.id, site.leadId), eq(leads.tenantId, params.tenantId)));
  if (!lead) return null;

  const token = generateSecureToken(16);
  const title = params.title || `Site Profissional - ${lead.businessName}`;
  const description =
    params.description ||
    `Publicação definitiva em produção, certificado SSL e suporte contínuo para ${lead.businessName}.`;

  const stripeKey =
    params.gateway === 'STRIPE'
      ? await getDecryptedTenantSecret(db, params.tenantId, 'stripe', params.masterKey)
      : null;
  const asaasKey =
    params.gateway === 'ASAAS'
      ? await getDecryptedTenantSecret(db, params.tenantId, 'asaas', params.masterKey)
      : null;

  const session = await createGatewayCheckoutSession({
    gateway: params.gateway,
    offerToken: token,
    title,
    description,
    billingModel: params.billingModel,
    setupAmountCents: params.setupAmountCents,
    monthlyAmountCents: params.monthlyAmountCents,
    appBaseUrl: params.appUrl,
    customerEmail: lead.email || undefined,
    stripeSecretKey: stripeKey || undefined,
    asaasApiKey: asaasKey || undefined,
  });

  const [offer] = await db
    .insert(checkoutOffers)
    .values({
      tenantId: params.tenantId,
      siteId: site.id,
      leadId: lead.id,
      token,
      gateway: params.gateway,
      billingModel: params.billingModel,
      title,
      description,
      setupAmountCents: params.setupAmountCents,
      monthlyAmountCents: params.monthlyAmountCents,
      status: 'ACTIVE',
      externalUrl: session.checkoutUrl,
    })
    .returning();

  if (!offer) throw new Error('Falha ao criar oferta de checkout.');

  await db.insert(paymentTransactions).values({
    tenantId: params.tenantId,
    offerId: offer.id,
    siteId: site.id,
    leadId: lead.id,
    gateway: params.gateway,
    billingModel: params.billingModel,
    amountCents: params.setupAmountCents + params.monthlyAmountCents,
    status: 'PENDING',
    externalCheckoutId: session.externalCheckoutId,
  });

  if (
    lead.funnelStage !== 'VENDIDO' &&
    lead.funnelStage !== 'DESCARTADO'
  ) {
    await db
      .update(leads)
      .set({ funnelStage: 'EM_NEGOCIACAO', updatedAt: new Date() })
      .where(and(eq(leads.id, lead.id), eq(leads.tenantId, params.tenantId)));
  }

  await recordAuditLog(db, {
    tenantId: params.tenantId,
    userId: params.userId,
    actorRole: params.actorRole,
    action: 'CHECKOUT_LINK_CREATED',
    resourceType: 'checkout_offer',
    resourceId: offer.id,
    details: {
      siteId: site.id,
      gateway: params.gateway,
      billingModel: params.billingModel,
      setupAmountCents: params.setupAmountCents,
      monthlyAmountCents: params.monthlyAmountCents,
    },
  });

  return offer;
}

/**
 * RF-18 + RN-10 + RN-12 + CA-10: Valida assinatura HMAC, garante idempotência via event_id,
 * remove banner de demonstração e publica o site automaticamente.
 */
export async function processPaymentWebhook(
  db: AppDatabase,
  params: {
    gateway: 'stripe' | 'asaas' | 'sandbox';
    rawBody: string;
    signatureHeader?: string;
    asaasTokenHeader?: string;
    secret: string;
    appUrl: string;
  },
): Promise<{ statusCode: number; body: Record<string, unknown> }> {
  // 1. Verificação criptográfica (RN-10)
  if (params.gateway === 'asaas') {
    if (!params.secret || params.asaasTokenHeader !== params.secret) {
      return { statusCode: 401, body: { error: 'Token de webhook Asaas inválido.' } };
    }
  } else {
    const validSig = verifyHmacSignature(params.rawBody, params.signatureHeader, params.secret);
    if (!validSig) {
      return { statusCode: 401, body: { error: 'Assinatura HMAC do webhook inválida.' } };
    }
  }

  let payload: Record<string, any>;
  try {
    payload = JSON.parse(params.rawBody);
  } catch {
    return { statusCode: 400, body: { error: 'Payload JSON inválido.' } };
  }

  const eventId = String(payload.event_id || payload.id || '');
  const eventType = String(payload.type || payload.event || '');
  if (!eventId || !eventType) {
    return { statusCode: 400, body: { error: 'event_id e type são obrigatórios.' } };
  }

  // 2. Idempotência por event_id (RN-10)
  const [alreadyProcessed] = await db
    .select()
    .from(processedWebhookEvents)
    .where(
      and(
        eq(processedWebhookEvents.gateway, params.gateway),
        eq(processedWebhookEvents.eventId, eventId),
      ),
    );

  if (alreadyProcessed) {
    return {
      statusCode: 200,
      body: { received: true, idempotent: true, eventId },
    };
  }

  await db.insert(processedWebhookEvents).values({
    gateway: params.gateway,
    eventId,
    eventType,
    signatureVerified: true,
    payloadHash: sha256Hex(params.rawBody),
  });

  const offerToken =
    payload.data?.offer_token ||
    payload.data?.object?.metadata?.offer_token ||
    payload.payment?.externalReference ||
    '';

  if (!offerToken) {
    return { statusCode: 200, body: { received: true, ignored: 'offer_token ausente' } };
  }

  const [offer] = await db
    .select()
    .from(checkoutOffers)
    .where(eq(checkoutOffers.token, String(offerToken)));

  if (!offer) {
    return { statusCode: 404, body: { error: 'Oferta de checkout não encontrada.' } };
  }

  const now = new Date();

  if (
    eventType === 'payment.succeeded' ||
    eventType === 'checkout.session.completed' ||
    eventType === 'PAYMENT_CONFIRMED' ||
    eventType === 'PAYMENT_RECEIVED' ||
    eventType === 'subscription.reactivated'
  ) {
    await db
      .update(checkoutOffers)
      .set({ status: 'PAID' })
      .where(eq(checkoutOffers.id, offer.id));

    await db
      .update(paymentTransactions)
      .set({
        status: 'PAID',
        paidAt: now,
        graceUntil: null,
        externalSubscriptionId: payload.data?.subscription_id ?? null,
        updatedAt: now,
      })
      .where(eq(paymentTransactions.offerId, offer.id));

    const [site] = await db.select().from(sites).where(eq(sites.id, offer.siteId));
    const portalToken = site?.clientPortalToken || generateSecureToken(20);

    const [publishedSite] = await db
      .update(sites)
      .set({
        status: 'PUBLISHED',
        publishedAt: site?.publishedAt ?? now,
        suspendedAt: null,
        clientPortalToken: portalToken,
        cacheVersion: (site?.cacheVersion ?? 1) + 1,
        updatedAt: now,
      })
      .where(eq(sites.id, offer.siteId))
      .returning();

    await db
      .update(leads)
      .set({ funnelStage: 'VENDIDO', updatedAt: now })
      .where(and(eq(leads.id, offer.leadId), eq(leads.tenantId, offer.tenantId)));

    await db.insert(notifications).values({
      tenantId: offer.tenantId,
      leadId: offer.leadId,
      siteId: offer.siteId,
      type: 'PAYMENT_CONFIRMED',
      title: 'Pagamento confirmado! Site publicado',
      body: `O pagamento da oferta "${offer.title}" foi confirmado e o banner de demonstração foi removido.`,
    });

    await recordAuditLog(db, {
      tenantId: offer.tenantId,
      userId: null,
      actorRole: 'WEBHOOK_GATEWAY',
      action: 'SITE_ACTIVATED_POST_PAYMENT',
      resourceType: 'site',
      resourceId: offer.siteId,
      details: { gateway: params.gateway, eventId, eventType },
    });

    if (publishedSite) {
      await triggerFrontendCacheRevalidation(
        params.appUrl,
        publishedSite.subdomainSlug,
        publishedSite.customDomain,
      );
    }

    return {
      statusCode: 200,
      body: {
        received: true,
        activated: true,
        siteId: offer.siteId,
        siteStatus: 'PUBLISHED',
        clientPortalUrl: `${params.appUrl}/portal/${portalToken}`,
      },
    };
  }

  // RN-12: Inadimplência -> carência e suspensão graciosa sem excluir dados
  if (
    eventType === 'invoice.payment_failed' ||
    eventType === 'PAYMENT_OVERDUE' ||
    eventType === 'subscription.past_due'
  ) {
    const [tenantRow] = await db
      .select({ graceDays: tenants.gracePeriodDays })
      .from(tenants)
      .where(eq(tenants.id, offer.tenantId));
    const graceDays = Number(payload.data?.grace_days ?? tenantRow?.graceDays ?? 5);
    const graceUntil = new Date(now.getTime() + graceDays * 86_400_000);

    await db
      .update(paymentTransactions)
      .set({
        status: 'PAST_DUE',
        graceUntil,
        updatedAt: now,
      })
      .where(eq(paymentTransactions.offerId, offer.id));

    if (graceDays <= 0) {
      await db
        .update(sites)
        .set({ status: 'SUSPENDED', suspendedAt: now, updatedAt: now })
        .where(eq(sites.id, offer.siteId));
    }

    return {
      statusCode: 200,
      body: { received: true, pastDue: true, graceUntil },
    };
  }

  return { statusCode: 200, body: { received: true } };
}

/**
 * RF-19 + CA-11: Configura domínio próprio e verifica apontamento DNS + SSL.
 */
export async function configureCustomDomainForSite(
  db: AppDatabase,
  params: {
    tenantId: string;
    siteId: string;
    domain: string;
    expectedCname: string;
    expectedARecord: string;
  },
) {
  const [site] = await db
    .select()
    .from(sites)
    .where(and(eq(sites.id, params.siteId), eq(sites.tenantId, params.tenantId)));
  if (!site) return null;

  const cleanDomain = params.domain
    .toLowerCase()
    .trim()
    .replace(/^https?:\/\//, '')
    .replace(/\/.*$/, '');

  const [existing] = await db
    .select()
    .from(customDomains)
    .where(eq(customDomains.siteId, site.id));

  if (existing) {
    const [updated] = await db
      .update(customDomains)
      .set({
        domain: cleanDomain,
        expectedCname: params.expectedCname,
        expectedARecord: params.expectedARecord,
        dnsStatus: 'PENDING',
        sslStatus: 'PENDING',
        verificationError: null,
      })
      .where(eq(customDomains.id, existing.id))
      .returning();
    return updated;
  }

  const [created] = await db
    .insert(customDomains)
    .values({
      tenantId: params.tenantId,
      siteId: site.id,
      domain: cleanDomain,
      expectedCname: params.expectedCname,
      expectedARecord: params.expectedARecord,
      dnsStatus: 'PENDING',
      sslStatus: 'PENDING',
    })
    .returning();

  return created;
}

export async function verifyCustomDomainForSite(
  db: AppDatabase,
  params: {
    tenantId: string;
    siteId: string;
    simulateVerified?: boolean;
    appUrl: string;
  },
) {
  const [domainRow] = await db
    .select()
    .from(customDomains)
    .where(
      and(eq(customDomains.siteId, params.siteId), eq(customDomains.tenantId, params.tenantId)),
    );
  if (!domainRow) return null;

  const result = await verifyAndProvisionCustomDomain({
    domain: domainRow.domain,
    expectedCname: domainRow.expectedCname,
    expectedARecord: domainRow.expectedARecord,
    simulateVerified: params.simulateVerified,
  });

  const now = new Date();
  const [updated] = await db
    .update(customDomains)
    .set({
      dnsStatus: result.dnsVerified ? 'VERIFIED' : 'FAILED',
      sslStatus: result.sslStatus,
      verificationError: result.error,
      lastCheckedAt: now,
      verifiedAt: result.dnsVerified ? now : domainRow.verifiedAt,
      sslIssuedAt: result.sslStatus === 'ACTIVE' ? now : domainRow.sslIssuedAt,
    })
    .where(eq(customDomains.id, domainRow.id))
    .returning();

  if (result.dnsVerified && result.sslStatus === 'ACTIVE') {
    const [site] = await db
      .update(sites)
      .set({
        customDomain: domainRow.domain,
        cacheVersion: sql`${sites.cacheVersion} + 1`,
        updatedAt: now,
      })
      .where(and(eq(sites.id, params.siteId), eq(sites.tenantId, params.tenantId)))
      .returning();

    await db.insert(notifications).values({
      tenantId: params.tenantId,
      siteId: params.siteId,
      type: 'DOMAIN_ACTIVE',
      title: `Domínio ${domainRow.domain} ativo com SSL!`,
      body: 'Apontamento DNS validado e certificado HTTPS provisionado automaticamente.',
    });

    if (site) {
      await triggerFrontendCacheRevalidation(
        params.appUrl,
        site.subdomainSlug,
        domainRow.domain,
      );
    }
  }

  return { domain: updated, verification: result };
}

/**
 * RN-11 (Expiração de previews não convertidos) & RN-12 (Suspensão graciosa por inadimplência)
 */
export async function runLifecycleCronTask(
  db: AppDatabase,
  task: 'expire-previews' | 'suspend-delinquent',
): Promise<{ affectedCount: number }> {
  const now = new Date();

  if (task === 'expire-previews') {
    const expiredCandidates = await db
      .select()
      .from(sites)
      .where(
        and(
          eq(sites.status, 'PREVIEW'),
          lte(sites.expiresAt, now),
          eq(sites.previewViewsCount, 0),
        ),
      );

    let count = 0;
    for (const s of expiredCandidates) {
      await db
        .update(sites)
        .set({
          status: 'ARCHIVED',
          archivedAt: now,
          subdomainSlug: `archived-${s.id.slice(0, 8)}-${s.subdomainSlug}`.slice(0, 80),
          updatedAt: now,
        })
        .where(eq(sites.id, s.id));
      count += 1;
    }
    return { affectedCount: count };
  }

  // RN-12: Suspender sites recorrentes inadimplentes após período de carência sem excluir dados
  const overdueRows = await db
    .select()
    .from(paymentTransactions)
    .where(and(eq(paymentTransactions.status, 'PAST_DUE'), lte(paymentTransactions.graceUntil, now)));

  let suspended = 0;
  for (const tx of overdueRows) {
    await db
      .update(paymentTransactions)
      .set({ status: 'SUSPENDED', updatedAt: now })
      .where(eq(paymentTransactions.id, tx.id));
    await db
      .update(sites)
      .set({ status: 'SUSPENDED', suspendedAt: now, updatedAt: now })
      .where(eq(sites.id, tx.siteId));
    suspended += 1;
  }

  return { affectedCount: suspended };
}
