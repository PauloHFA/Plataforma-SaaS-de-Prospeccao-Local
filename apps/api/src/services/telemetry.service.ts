import { and, desc, eq, sql } from 'drizzle-orm';
import type { AppDatabase } from '@plataforma/db';
import {
  leads,
  notifications,
  sites,
  siteTelemetryEvents,
} from '@plataforma/db';
import { sha256Hex } from '@plataforma/shared/crypto';

export type TelemetryEventType =
  | 'PAGE_VIEW'
  | 'WHATSAPP_CLICK'
  | 'CTA_CLICK'
  | 'PHONE_CLICK';

export function detectDeviceType(userAgent: string): 'mobile' | 'tablet' | 'desktop' {
  const ua = userAgent.toLowerCase();
  if (/ipad|tablet|playbook|silk/.test(ua)) return 'tablet';
  if (/mobile|iphone|ipod|android.*mobile|windows phone|blackberry/.test(ua)) return 'mobile';
  return 'desktop';
}

/**
 * RF-12 + CA-07: Registra visualizações e cliques no botão de contato,
 * move o card do funil para "Preview Visualizado" e notifica o operador.
 */
export async function recordSiteTelemetryEvent(
  db: AppDatabase,
  params: {
    siteId: string;
    eventType: TelemetryEventType;
    userAgent: string;
    ip: string;
    referrer?: string;
  },
) {
  const [site] = await db.select().from(sites).where(eq(sites.id, params.siteId));
  if (!site) return null;

  const deviceType = detectDeviceType(params.userAgent);
  const ipHash = sha256Hex(params.ip || '0.0.0.0').slice(0, 16);

  await db.insert(siteTelemetryEvents).values({
    tenantId: site.tenantId,
    siteId: site.id,
    eventType: params.eventType,
    deviceType,
    userAgent: params.userAgent.slice(0, 300),
    ipHash,
    referrer: params.referrer?.slice(0, 500) ?? null,
  });

  const now = new Date();
  const isFirstView = !site.firstViewedAt && params.eventType === 'PAGE_VIEW';

  if (params.eventType === 'PAGE_VIEW') {
    await db
      .update(sites)
      .set({
        previewViewsCount: sql`${sites.previewViewsCount} + 1`,
        firstViewedAt: site.firstViewedAt ?? now,
        lastViewedAt: now,
        updatedAt: now,
      })
      .where(eq(sites.id, site.id));
  } else if (params.eventType === 'WHATSAPP_CLICK') {
    await db
      .update(sites)
      .set({
        whatsappClicksCount: sql`${sites.whatsappClicksCount} + 1`,
        lastViewedAt: now,
        updatedAt: now,
      })
      .where(eq(sites.id, site.id));
  } else if (params.eventType === 'CTA_CLICK' || params.eventType === 'PHONE_CLICK') {
    await db
      .update(sites)
      .set({
        ctaClicksCount: sql`${sites.ctaClicksCount} + 1`,
        lastViewedAt: now,
        updatedAt: now,
      })
      .where(eq(sites.id, site.id));
  }

  const [lead] = await db
    .select()
    .from(leads)
    .where(and(eq(leads.id, site.leadId), eq(leads.tenantId, site.tenantId)));

  if (lead) {
    // Move stage automatically to PREVIEW_VISUALIZADO from earlier stages
    if (
      lead.funnelStage === 'LEAD_CAPTADO' ||
      lead.funnelStage === 'SITE_GERADO' ||
      lead.funnelStage === 'MENSAGEM_ENVIADA'
    ) {
      await db
        .update(leads)
        .set({ funnelStage: 'PREVIEW_VISUALIZADO', updatedAt: now })
        .where(and(eq(leads.id, lead.id), eq(leads.tenantId, site.tenantId)));
    }

    if (params.eventType === 'PAGE_VIEW' || params.eventType === 'WHATSAPP_CLICK') {
      const title =
        params.eventType === 'WHATSAPP_CLICK'
          ? `${lead.businessName} clicou no WhatsApp!`
          : isFirstView
            ? `${lead.businessName} abriu a prévia do site!`
            : `Nova visita no preview de ${lead.businessName}`;

      const body =
        params.eventType === 'WHATSAPP_CLICK'
          ? `Prospect interagiu com o botão de contato via ${deviceType}.`
          : `Acesso registrado via ${deviceType}. Estágio atualizado para Preview Visualizado.`;

      await db.insert(notifications).values({
        tenantId: site.tenantId,
        leadId: lead.id,
        siteId: site.id,
        type: params.eventType === 'WHATSAPP_CLICK' ? 'WHATSAPP_CLICK' : 'PREVIEW_OPENED',
        title,
        body,
      });
    }
  }

  const [updatedSite] = await db.select().from(sites).where(eq(sites.id, site.id));
  return updatedSite;
}

export async function getSiteTelemetrySummary(
  db: AppDatabase,
  tenantId: string,
  siteId: string,
) {
  const [site] = await db
    .select()
    .from(sites)
    .where(and(eq(sites.id, siteId), eq(sites.tenantId, tenantId)));
  if (!site) return null;

  const events = await db
    .select()
    .from(siteTelemetryEvents)
    .where(and(eq(siteTelemetryEvents.tenantId, tenantId), eq(siteTelemetryEvents.siteId, siteId)))
    .orderBy(desc(siteTelemetryEvents.createdAt))
    .limit(50);

  const byDevice = events.reduce<Record<string, number>>((acc, e) => {
    acc[e.deviceType] = (acc[e.deviceType] ?? 0) + 1;
    return acc;
  }, {});

  return {
    siteId: site.id,
    previewViewsCount: site.previewViewsCount,
    whatsappClicksCount: site.whatsappClicksCount,
    ctaClicksCount: site.ctaClicksCount,
    firstViewedAt: site.firstViewedAt,
    lastViewedAt: site.lastViewedAt,
    byDevice,
    recentEvents: events,
  };
}
