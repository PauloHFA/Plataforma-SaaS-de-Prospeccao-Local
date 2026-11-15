import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import type { AppDatabase } from '@plataforma/db';
import {
  campaignDispatches,
  campaigns,
  leads,
  messagingConnections,
  sites,
  tenants,
} from '@plataforma/db';
import {
  checkOperationalWindow,
  sendEmailMessage,
  sendWhatsAppMessage,
} from '@plataforma/integrations';
import type { QueueManager } from '@plataforma/queue';
import { OPT_OUT_KEYWORDS, renderMessageTemplate } from '@plataforma/shared';
import { decryptSecret } from '@plataforma/shared/crypto';
import { recordAuditLog } from './audit.service.js';
import { checkTenantQuotaAndBudget, recordUsageTelemetry } from './quota.service.js';

export interface LeadEligibilityResult {
  eligible: boolean;
  statusOnBlock?:
    | 'BLOCKED_OPT_OUT'
    | 'BLOCKED_QUARANTINE'
    | 'BLOCKED_NO_WHATSAPP';
  reason?: string;
}

/**
 * RN-08 + RF-04 + CA-02 + CA-09: Avalia bloqueios de opt-out, quarentena de 30 dias
 * e verificação prévia de conta WhatsApp.
 */
export function evaluateLeadDispatchEligibility(
  lead: typeof leads.$inferSelect,
  channel: 'WHATSAPP' | 'EMAIL',
  quarantineDays = 30,
  now = new Date(),
): LeadEligibilityResult {
  if (lead.optedOut) {
    return {
      eligible: false,
      statusOnBlock: 'BLOCKED_OPT_OUT',
      reason: 'Lead solicitou descadastro (opt-out permanente ativo no workspace).',
    };
  }

  if (lead.lastContactedAt) {
    const diffMs = now.getTime() - new Date(lead.lastContactedAt).getTime();
    const diffDays = diffMs / 86_400_000;
    if (diffDays < quarantineDays) {
      const remaining = Math.max(1, Math.ceil(quarantineDays - diffDays));
      return {
        eligible: false,
        statusOnBlock: 'BLOCKED_QUARANTINE',
        reason: `Lead em quarentena (RN-08): última abordagem há menos de ${quarantineDays} dias (restam ${remaining}d).`,
      };
    }
  }

  if (channel === 'WHATSAPP') {
    if (!lead.phoneE164 || lead.whatsappValid !== true) {
      return {
        eligible: false,
        statusOnBlock: 'BLOCKED_NO_WHATSAPP',
        reason:
          lead.phoneType === 'LANDLINE'
            ? 'Telefone fixo sem suporte a WhatsApp (abordar por ligação ou e-mail).'
            : 'Número sem conta ativa verificada no WhatsApp.',
      };
    }
  } else if (channel === 'EMAIL' && !lead.email) {
    return {
      eligible: false,
      statusOnBlock: 'BLOCKED_NO_WHATSAPP',
      reason: 'Lead não possui endereço de e-mail cadastrado.',
    };
  }

  return { eligible: true };
}

export async function createAndEnqueueCampaign(
  db: AppDatabase,
  queue: QueueManager,
  input: {
    tenantId: string;
    userId: string;
    actorRole: string;
    name: string;
    channel: 'WHATSAPP' | 'EMAIL';
    connectionId: string;
    templateId?: string;
    subjectTemplate?: string;
    bodyTemplate: string;
    leadIds: string[];
    minDelayMs?: number;
    maxDelayMs?: number;
    respectBusinessHours?: boolean;
    appUrl: string;
    masterKey?: string;
  },
) {
  const [connection] = await db
    .select()
    .from(messagingConnections)
    .where(
      and(
        eq(messagingConnections.id, input.connectionId),
        eq(messagingConnections.tenantId, input.tenantId),
      ),
    );
  if (!connection) {
    throw new Error('Conexão de envio não encontrada neste workspace.');
  }

  const [tenantRow] = await db
    .select({ quarantineDays: tenants.quarantineDays })
    .from(tenants)
    .where(eq(tenants.id, input.tenantId));
  const quarantineDays = tenantRow?.quarantineDays ?? 30;

  const targetLeads = await db
    .select()
    .from(leads)
    .where(and(eq(leads.tenantId, input.tenantId), inArray(leads.id, input.leadIds)));

  const minDelayMs = Math.max(50, input.minDelayMs ?? connection.minDelaySeconds * 1000);
  const maxDelayMs = Math.max(minDelayMs, input.maxDelayMs ?? Math.max(minDelayMs + 50, connection.maxDelaySeconds * 1000));
  const respectBusinessHours = input.respectBusinessHours ?? true;

  const [campaign] = await db
    .insert(campaigns)
    .values({
      tenantId: input.tenantId,
      name: input.name,
      channel: input.channel,
      connectionId: connection.id,
      templateId: input.templateId ?? null,
      status: 'RUNNING',
      minDelayMs,
      maxDelayMs,
      respectBusinessHours,
      totalTargets: targetLeads.length,
    })
    .returning();

  if (!campaign) {
    throw new Error('Falha ao criar campanha.');
  }

  const dispatchesOut: Array<typeof campaignDispatches.$inferSelect> = [];
  let eligibleIndex = 0;
  let blockedCount = 0;
  let cumulativeDelayMs = 0;

  for (const lead of targetLeads) {
    const eligibility = evaluateLeadDispatchEligibility(lead, input.channel, quarantineDays);

    // Buscar site mais recente do lead para compor {{link_preview}}
    const [latestSite] = await db
      .select()
      .from(sites)
      .where(and(eq(sites.tenantId, input.tenantId), eq(sites.leadId, lead.id)))
      .orderBy(desc(sites.createdAt))
      .limit(1);

    const previewLink = latestSite
      ? `${input.appUrl}/preview/${latestSite.subdomainSlug}`
      : input.appUrl;
    const optOutLink = `${input.appUrl}/opt-out/${lead.optOutToken}`;

    const vars = {
      nome_empresa: lead.businessName,
      categoria: lead.category,
      bairro: lead.neighborhood || 'Centro',
      cidade: lead.city,
      link_preview: previewLink,
      link_optout: optOutLink,
      nota_google: lead.rating ? lead.rating.toFixed(1) : '5.0',
      telefone: lead.phoneRaw || lead.phoneE164 || '',
    };

    const { rendered: renderedBody, unresolved: unresolvedBody } = renderMessageTemplate(
      input.bodyTemplate,
      vars,
    );
    const subjectOut = input.subjectTemplate
      ? renderMessageTemplate(input.subjectTemplate, vars)
      : { rendered: '', unresolved: [] };

    if (unresolvedBody.length > 0 || subjectOut.unresolved.length > 0) {
      throw new Error(
        `Template contém variáveis não resolvidas: ${[...unresolvedBody, ...subjectOut.unresolved].join(', ')}`,
      );
    }

    const recipient =
      input.channel === 'WHATSAPP'
        ? lead.phoneE164 || lead.phoneRaw || ''
        : lead.email || '';

    if (!eligibility.eligible) {
      blockedCount += 1;
      const [blockedRow] = await db
        .insert(campaignDispatches)
        .values({
          tenantId: input.tenantId,
          campaignId: campaign.id,
          leadId: lead.id,
          siteId: latestSite?.id ?? null,
          connectionId: connection.id,
          channel: input.channel,
          recipient,
          renderedSubject: subjectOut.rendered || null,
          renderedBody,
          status: eligibility.statusOnBlock!,
          blockReason: eligibility.reason!,
        })
        .returning();
      if (blockedRow) dispatchesOut.push(blockedRow);
      continue;
    }

    // Cadência + jitter configurável (RN-07 / CA-08)
    let jobDelayMs = 0;
    if (eligibleIndex > 0) {
      const jitter = Math.floor(Math.random() * Math.max(1, maxDelayMs - minDelayMs));
      cumulativeDelayMs += minDelayMs + jitter;
      jobDelayMs = cumulativeDelayMs;
    }
    eligibleIndex += 1;

    const scheduledFor = new Date(Date.now() + jobDelayMs);
    const [dispatchRow] = await db
      .insert(campaignDispatches)
      .values({
        tenantId: input.tenantId,
        campaignId: campaign.id,
        leadId: lead.id,
        siteId: latestSite?.id ?? null,
        connectionId: connection.id,
        channel: input.channel,
        recipient,
        renderedSubject: subjectOut.rendered || null,
        renderedBody,
        status: 'QUEUED',
        scheduledFor,
      })
      .returning();

    if (dispatchRow) {
      dispatchesOut.push(dispatchRow);
      await queue.enqueue(
        'messaging-dispatch',
        'send-prospect-message',
        {
          tenantId: input.tenantId,
          dispatchId: dispatchRow.id,
          campaignId: campaign.id,
        },
        { delayMs: jobDelayMs, attempts: 3, backoffMs: 500 },
      );
    }
  }

  await db
    .update(campaigns)
    .set({
      blockedCount,
      status: eligibleIndex === 0 ? 'COMPLETED' : 'RUNNING',
    })
    .where(eq(campaigns.id, campaign.id));

  await recordAuditLog(db, {
    tenantId: input.tenantId,
    userId: input.userId,
    actorRole: input.actorRole,
    action: 'CAMPAIGN_ENQUEUED',
    resourceType: 'campaign',
    resourceId: campaign.id,
    details: {
      channel: input.channel,
      totalTargets: targetLeads.length,
      eligibleQueued: eligibleIndex,
      blockedCount,
    },
  });

  return {
    campaign: { ...campaign, blockedCount },
    dispatches: dispatchesOut,
    summary: {
      totalTargets: targetLeads.length,
      queued: eligibleIndex,
      blocked: blockedCount,
    },
  };
}

export async function runMessagingDispatchJob(
  db: AppDatabase,
  data: { tenantId: string; dispatchId: string; campaignId?: string },
  options?: { businessHoursEnforce?: boolean; masterKey?: string },
) {
  const [dispatch] = await db
    .select()
    .from(campaignDispatches)
    .where(
      and(
        eq(campaignDispatches.id, data.dispatchId),
        eq(campaignDispatches.tenantId, data.tenantId),
      ),
    );

  if (!dispatch || dispatch.status !== 'QUEUED') {
    return { skipped: true };
  }

  const [lead] = await db
    .select()
    .from(leads)
    .where(and(eq(leads.id, dispatch.leadId), eq(leads.tenantId, data.tenantId)));
  const [connection] = await db
    .select()
    .from(messagingConnections)
    .where(
      and(
        eq(messagingConnections.id, dispatch.connectionId),
        eq(messagingConnections.tenantId, data.tenantId),
      ),
    );

  if (!lead || !connection) {
    await db
      .update(campaignDispatches)
      .set({ status: 'FAILED', errorMessage: 'Lead ou conexão inexistente.', updatedAt: new Date() })
      .where(eq(campaignDispatches.id, dispatch.id));
    return { failed: true };
  }

  // Reavaliar opt-out/quarentena na hora do envio (RN-08)
  const [tenantRow] = await db
    .select({ quarantineDays: tenants.quarantineDays })
    .from(tenants)
    .where(eq(tenants.id, data.tenantId));
  const check = evaluateLeadDispatchEligibility(
    lead,
    dispatch.channel as 'WHATSAPP' | 'EMAIL',
    tenantRow?.quarantineDays ?? 30,
  );
  if (!check.eligible) {
    await db
      .update(campaignDispatches)
      .set({
        status: check.statusOnBlock!,
        blockReason: check.reason!,
        updatedAt: new Date(),
      })
      .where(eq(campaignDispatches.id, dispatch.id));
    return { blocked: true, reason: check.reason };
  }

  // Verificar cota diária e orçamento (RNF-07)
  await checkTenantQuotaAndBudget(
    db,
    data.tenantId,
    dispatch.channel === 'WHATSAPP' ? 'WHATSAPP_DISPATCH' : 'EMAIL_DISPATCH',
    options?.masterKey,
  );

  // Resetar contador diário da conexão se mudou o dia
  const todayStr = new Date().toISOString().slice(0, 10);
  let sentToday = connection.lastResetDate === todayStr ? connection.sentToday : 0;
  if (sentToday >= connection.dailyLimit) {
    await db
      .update(campaignDispatches)
      .set({
        status: 'BLOCKED_WINDOW',
        blockReason: `Limite diário da conexão atingido (${connection.dailyLimit}/dia).`,
        updatedAt: new Date(),
      })
      .where(eq(campaignDispatches.id, dispatch.id));
    return { blocked: true, reason: 'Limite diário da conexão atingido.' };
  }

  // Verificar janela operacional comercial (RN-07: Seg-Sex, 08:30-18:00)
  let respectWindow = options?.businessHoursEnforce ?? process.env.BUSINESS_HOURS_ENFORCE !== 'false';
  if (dispatch.campaignId) {
    const [camp] = await db
      .select({ respectBusinessHours: campaigns.respectBusinessHours })
      .from(campaigns)
      .where(eq(campaigns.id, dispatch.campaignId));
    if (camp && camp.respectBusinessHours === false) {
      respectWindow = false;
    }
  }

  if (dispatch.channel === 'WHATSAPP' && respectWindow) {
    const win = checkOperationalWindow(new Date(), connection.windowTimezone || 'America/Sao_Paulo');
    if (!win.allowed) {
      await db
        .update(campaignDispatches)
        .set({
          status: 'SCHEDULED',
          blockReason: win.reason,
          scheduledFor: win.nextWindowDate,
          updatedAt: new Date(),
        })
        .where(eq(campaignDispatches.id, dispatch.id));
      return { rescheduled: true, scheduledFor: win.nextWindowDate };
    }
  }

  // Decrypt connection credentials if present
  let parsedConfig: Record<string, any> = {};
  if (connection.encryptedConfigJson) {
    try {
      const payload = JSON.parse(connection.encryptedConfigJson);
      parsedConfig = JSON.parse(decryptSecret(payload, options?.masterKey));
    } catch {
      parsedConfig = {};
    }
  }

  let externalMessageId = '';
  if (dispatch.channel === 'WHATSAPP') {
    const res = await sendWhatsAppMessage({
      toE164: dispatch.recipient,
      body: dispatch.renderedBody,
      channel: connection.channel,
      config: parsedConfig,
    });
    externalMessageId = res.externalMessageId;
  } else {
    const res = await sendEmailMessage({
      to: dispatch.recipient,
      from: connection.identifier,
      subject: dispatch.renderedSubject || `Prévia do site - ${lead.businessName}`,
      text: dispatch.renderedBody,
      smtpConfig: parsedConfig.host ? (parsedConfig as any) : undefined,
    });
    externalMessageId = res.externalMessageId;
  }

  const now = new Date();
  await db
    .update(campaignDispatches)
    .set({
      status: 'SENT',
      externalMessageId,
      sentAt: now,
      updatedAt: now,
    })
    .where(eq(campaignDispatches.id, dispatch.id));

  await db
    .update(messagingConnections)
    .set({
      sentToday: sentToday + 1,
      lastResetDate: todayStr,
      updatedAt: now,
    })
    .where(eq(messagingConnections.id, connection.id));

  await db
    .update(leads)
    .set({
      lastContactedAt: now,
      funnelStage:
        lead.funnelStage === 'LEAD_CAPTADO' || lead.funnelStage === 'SITE_GERADO'
          ? 'MENSAGEM_ENVIADA'
          : lead.funnelStage,
      updatedAt: now,
    })
    .where(and(eq(leads.id, lead.id), eq(leads.tenantId, data.tenantId)));

  if (dispatch.campaignId) {
    await db
      .update(campaigns)
      .set({ sentCount: sql`${campaigns.sentCount} + 1` })
      .where(eq(campaigns.id, dispatch.campaignId));

    const pendingRows = await db
      .select({ count: sql<number>`COUNT(*)::int` })
      .from(campaignDispatches)
      .where(
        and(
          eq(campaignDispatches.campaignId, dispatch.campaignId),
          eq(campaignDispatches.status, 'QUEUED'),
        ),
      );
    if (Number(pendingRows[0]?.count ?? 0) === 0) {
      await db
        .update(campaigns)
        .set({ status: 'COMPLETED' })
        .where(eq(campaigns.id, dispatch.campaignId));
    }
  }

  await recordUsageTelemetry(db, {
    tenantId: data.tenantId,
    metricType: dispatch.channel === 'WHATSAPP' ? 'WHATSAPP_DISPATCH' : 'EMAIL_DISPATCH',
    units: 1,
    estimatedCostCents: dispatch.channel === 'WHATSAPP' ? 5 : 1,
    metadata: { dispatchId: dispatch.id, externalMessageId },
  });

  return { sent: true, externalMessageId };
}

export async function markLeadOptOut(
  db: AppDatabase,
  params: {
    tenantId: string;
    leadId: string;
    reason: string;
    userId?: string | null;
    actorRole?: string;
  },
) {
  const now = new Date();
  const [updated] = await db
    .update(leads)
    .set({
      optedOut: true,
      optedOutAt: now,
      optOutReason: params.reason,
      funnelStage: 'DESCARTADO',
      updatedAt: now,
    })
    .where(and(eq(leads.id, params.leadId), eq(leads.tenantId, params.tenantId)))
    .returning();

  if (updated) {
    await recordAuditLog(db, {
      tenantId: params.tenantId,
      userId: params.userId ?? null,
      actorRole: params.actorRole || 'END_CLIENT',
      action: 'LEAD_OPT_OUT_RECORDED',
      resourceType: 'lead',
      resourceId: updated.id,
      details: { reason: params.reason },
    });
  }
  return updated ?? null;
}

export function isOptOutMessageContent(text: string): boolean {
  const norm = text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
  return OPT_OUT_KEYWORDS.some((kw) => norm === kw || norm.includes(kw));
}
