import type { FastifyInstance } from 'fastify';
import { and, desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import {
  campaignDispatches,
  campaigns,
  leads,
  messageTemplates,
  messagingConnections,
  type DbContext,
} from '@plataforma/db';
import {
  generateWhatsAppQrPairingPayload,
  verifyEmailSenderDns,
} from '@plataforma/integrations';
import type { QueueManager } from '@plataforma/queue';
import {
  extractTemplateVariables,
  renderMessageTemplate,
} from '@plataforma/shared';
import { encryptSecret } from '@plataforma/shared/crypto';
import type { AppConfig } from '../config.js';
import { requireTenantOperator } from '../auth.js';
import {
  createAndEnqueueCampaign,
  evaluateLeadDispatchEligibility,
} from '../services/messaging.service.js';

const CreateConnectionSchema = z.object({
  channel: z.enum(['WHATSAPP_EVOLUTION', 'WHATSAPP_META', 'EMAIL_SMTP']),
  label: z.string().min(2).max(80),
  identifier: z.string().min(3).max(120),
  dailyLimit: z.number().int().min(1).max(1000).optional(),
  minDelaySeconds: z.number().int().min(1).max(300).optional(),
  maxDelaySeconds: z.number().int().min(1).max(600).optional(),
  credentials: z.record(z.unknown()).optional(),
});

const CreateTemplateSchema = z.object({
  name: z.string().min(2).max(80),
  channel: z.enum(['WHATSAPP', 'EMAIL']),
  subject: z.string().max(140).optional(),
  body: z.string().min(5).max(3000),
});

const CreateCampaignSchema = z.object({
  name: z.string().min(2).max(100),
  channel: z.enum(['WHATSAPP', 'EMAIL']),
  connectionId: z.string().uuid(),
  templateId: z.string().uuid().optional(),
  subjectTemplate: z.string().max(140).optional(),
  bodyTemplate: z.string().min(5).max(3000),
  leadIds: z.array(z.string().uuid()).min(1).max(100),
  minDelayMs: z.number().int().min(50).max(120000).optional(),
  maxDelayMs: z.number().int().min(50).max(180000).optional(),
  respectBusinessHours: z.boolean().optional(),
  waitForCompletion: z.boolean().optional(),
});

const SingleSendSchema = z.object({
  leadId: z.string().uuid(),
  channel: z.enum(['WHATSAPP', 'EMAIL']),
  connectionId: z.string().uuid().optional(),
  subjectTemplate: z.string().max(140).optional(),
  bodyTemplate: z.string().min(5).max(3000),
  respectBusinessHours: z.boolean().optional(),
});

export function registerMessagingRoutes(
  app: FastifyInstance,
  dbCtx: DbContext,
  queue: QueueManager,
  config: AppConfig,
) {
  const { db } = dbCtx;
  const operatorGuard = requireTenantOperator();

  // RF-13: Conexões de WhatsApp & E-mail
  app.get('/api/connections', { preHandler: operatorGuard }, async (request) => {
    const items = await db
      .select({
        id: messagingConnections.id,
        tenantId: messagingConnections.tenantId,
        channel: messagingConnections.channel,
        label: messagingConnections.label,
        status: messagingConnections.status,
        identifier: messagingConnections.identifier,
        qrCodeData: messagingConnections.qrCodeData,
        spfVerified: messagingConnections.spfVerified,
        dkimVerified: messagingConnections.dkimVerified,
        dailyLimit: messagingConnections.dailyLimit,
        sentToday: messagingConnections.sentToday,
        minDelaySeconds: messagingConnections.minDelaySeconds,
        maxDelaySeconds: messagingConnections.maxDelaySeconds,
        createdAt: messagingConnections.createdAt,
      })
      .from(messagingConnections)
      .where(eq(messagingConnections.tenantId, request.user.tenantId!))
      .orderBy(desc(messagingConnections.createdAt));

    return { connections: items };
  });

  app.post('/api/connections', { preHandler: operatorGuard }, async (request, reply) => {
    const parsed = CreateConnectionSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Dados da conexão inválidos.', issues: parsed.error.issues });
    }

    const encryptedConfig = parsed.data.credentials
      ? JSON.stringify(
          encryptSecret(JSON.stringify(parsed.data.credentials), config.encryptionMasterKey),
        )
      : null;

    const isMetaOrSmtp = parsed.data.channel !== 'WHATSAPP_EVOLUTION';
    const [created] = await db
      .insert(messagingConnections)
      .values({
        tenantId: request.user.tenantId!,
        channel: parsed.data.channel,
        label: parsed.data.label,
        identifier: parsed.data.identifier,
        status: isMetaOrSmtp ? 'CONNECTED' : 'QR_PENDING',
        qrCodeData:
          parsed.data.channel === 'WHATSAPP_EVOLUTION'
            ? generateWhatsAppQrPairingPayload(parsed.data.label)
            : null,
        encryptedConfigJson: encryptedConfig,
        dailyLimit: parsed.data.dailyLimit ?? 80,
        minDelaySeconds: parsed.data.minDelaySeconds ?? 15,
        maxDelaySeconds: parsed.data.maxDelaySeconds ?? 45,
      })
      .returning();

    return reply.status(201).send({ connection: created });
  });

  app.post('/api/connections/:id/pair', { preHandler: operatorGuard }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = (request.body as { action?: 'generate_qr' | 'confirm_paired'; phone?: string } | undefined) || {};
    const tenantId = request.user.tenantId!;

    const [conn] = await db
      .select()
      .from(messagingConnections)
      .where(and(eq(messagingConnections.id, id), eq(messagingConnections.tenantId, tenantId)));
    if (!conn) return reply.status(404).send({ error: 'Conexão não encontrada.' });

    if (body.action === 'confirm_paired') {
      const [updated] = await db
        .update(messagingConnections)
        .set({
          status: 'CONNECTED',
          identifier: body.phone || conn.identifier || '+5511999990001',
          qrCodeData: null,
          updatedAt: new Date(),
        })
        .where(eq(messagingConnections.id, conn.id))
        .returning();
      return { connection: updated };
    }

    const [updated] = await db
      .update(messagingConnections)
      .set({
        status: 'QR_PENDING',
        qrCodeData: generateWhatsAppQrPairingPayload(conn.label),
        updatedAt: new Date(),
      })
      .where(eq(messagingConnections.id, conn.id))
      .returning();
    return { connection: updated };
  });

  app.post('/api/connections/:id/verify-dns', { preHandler: operatorGuard }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const tenantId = request.user.tenantId!;

    const [conn] = await db
      .select()
      .from(messagingConnections)
      .where(and(eq(messagingConnections.id, id), eq(messagingConnections.tenantId, tenantId)));
    if (!conn) return reply.status(404).send({ error: 'Conexão não encontrada.' });

    const dnsResult = await verifyEmailSenderDns(conn.identifier);
    const [updated] = await db
      .update(messagingConnections)
      .set({
        spfVerified: dnsResult.spfVerified,
        dkimVerified: dnsResult.dkimVerified,
        updatedAt: new Date(),
      })
      .where(eq(messagingConnections.id, conn.id))
      .returning();

    return { connection: updated, dns: dnsResult };
  });

  app.delete('/api/connections/:id', { preHandler: operatorGuard }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const [deleted] = await db
      .delete(messagingConnections)
      .where(
        and(eq(messagingConnections.id, id), eq(messagingConnections.tenantId, request.user.tenantId!)),
      )
      .returning();
    if (!deleted) return reply.status(404).send({ error: 'Conexão não encontrada.' });
    return { ok: true };
  });

  // RF-14: Templates dinâmicos & Spintax
  app.get('/api/message-templates', { preHandler: operatorGuard }, async (request) => {
    const items = await db
      .select()
      .from(messageTemplates)
      .where(eq(messageTemplates.tenantId, request.user.tenantId!))
      .orderBy(desc(messageTemplates.createdAt));
    return { templates: items };
  });

  app.post('/api/message-templates', { preHandler: operatorGuard }, async (request, reply) => {
    const parsed = CreateTemplateSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Template inválido.', issues: parsed.error.issues });
    }

    const variables = extractTemplateVariables(`${parsed.data.subject || ''} ${parsed.data.body}`);
    const [created] = await db
      .insert(messageTemplates)
      .values({
        tenantId: request.user.tenantId!,
        name: parsed.data.name,
        channel: parsed.data.channel,
        subject: parsed.data.subject ?? null,
        body: parsed.data.body,
        variablesJson: variables,
      })
      .returning();
    return reply.status(201).send({ template: created });
  });

  app.post('/api/message-templates/preview', { preHandler: operatorGuard }, async (request, reply) => {
    const body = z
      .object({
        template: z.string().min(1),
        variables: z.record(z.string()).optional(),
      })
      .safeParse(request.body);
    if (!body.success) return reply.status(400).send({ error: 'Payload inválido.' });

    const sampleVars = {
      nome_empresa: 'Clínica Exemplo',
      categoria: 'Clínica Médica',
      bairro: 'Pinheiros',
      cidade: 'São Paulo',
      link_preview: `${config.appUrl}/preview/clinica-exemplo`,
      link_optout: `${config.appUrl}/opt-out/exemplo`,
      nota_google: '4.9',
      telefone: '(11) 99999-0000',
      ...(body.data.variables || {}),
    };

    return renderMessageTemplate(body.data.template, sampleVars);
  });

  // RF-15 + CA-08 + CA-09: Campanhas em lote com cadência e bloqueio de opt-out/quarentena
  app.get('/api/campaigns', { preHandler: operatorGuard }, async (request) => {
    const tenantId = request.user.tenantId!;
    const list = await db
      .select()
      .from(campaigns)
      .where(eq(campaigns.tenantId, tenantId))
      .orderBy(desc(campaigns.createdAt));
    return { campaigns: list };
  });

  app.get('/api/campaigns/:id', { preHandler: operatorGuard }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const tenantId = request.user.tenantId!;

    const [campaign] = await db
      .select()
      .from(campaigns)
      .where(and(eq(campaigns.id, id), eq(campaigns.tenantId, tenantId)));
    if (!campaign) return reply.status(404).send({ error: 'Campanha não encontrada.' });

    const dispatches = await db
      .select()
      .from(campaignDispatches)
      .where(and(eq(campaignDispatches.campaignId, campaign.id), eq(campaignDispatches.tenantId, tenantId)))
      .orderBy(desc(campaignDispatches.createdAt));

    return { campaign, dispatches };
  });

  app.post('/api/campaigns', { preHandler: operatorGuard }, async (request, reply) => {
    const parsed = CreateCampaignSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Dados da campanha inválidos.', issues: parsed.error.issues });
    }

    try {
      const result = await createAndEnqueueCampaign(db, queue, {
        tenantId: request.user.tenantId!,
        userId: request.user.userId,
        actorRole: request.user.role,
        name: parsed.data.name,
        channel: parsed.data.channel,
        connectionId: parsed.data.connectionId,
        templateId: parsed.data.templateId,
        subjectTemplate: parsed.data.subjectTemplate,
        bodyTemplate: parsed.data.bodyTemplate,
        leadIds: parsed.data.leadIds,
        minDelayMs: parsed.data.minDelayMs,
        maxDelayMs: parsed.data.maxDelayMs,
        respectBusinessHours: parsed.data.respectBusinessHours,
        appUrl: config.appUrl,
        masterKey: config.encryptionMasterKey,
      });

      if (parsed.data.waitForCompletion) {
        await queue.waitUntilIdle('messaging-dispatch', 20000);
      }

      return reply.status(201).send(result);
    } catch (err: any) {
      return reply.status(400).send({ error: err?.message || 'Erro ao enfileirar campanha.' });
    }
  });

  // RF-15: Ação rápida de envio individual
  app.post('/api/campaigns/send-single', { preHandler: operatorGuard }, async (request, reply) => {
    const parsed = SingleSendSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Dados de envio inválidos.', issues: parsed.error.issues });
    }

    const tenantId = request.user.tenantId!;
    const [lead] = await db
      .select()
      .from(leads)
      .where(and(eq(leads.id, parsed.data.leadId), eq(leads.tenantId, tenantId)));
    if (!lead) return reply.status(404).send({ error: 'Lead não encontrado.' });

    const eligibility = evaluateLeadDispatchEligibility(lead, parsed.data.channel);
    if (!eligibility.eligible) {
      return reply.status(422).send({
        error: eligibility.reason,
        blockStatus: eligibility.statusOnBlock,
      });
    }

    let connectionId = parsed.data.connectionId;
    if (!connectionId) {
      const conns = await db
        .select()
        .from(messagingConnections)
        .where(eq(messagingConnections.tenantId, tenantId));
      const matched = conns.find((c) =>
        parsed.data.channel === 'WHATSAPP'
          ? c.channel.startsWith('WHATSAPP') && c.status === 'CONNECTED'
          : c.channel === 'EMAIL_SMTP' && c.status === 'CONNECTED',
      );
      if (!matched) {
        return reply.status(400).send({
          error: `Nenhuma conexão ${parsed.data.channel} conectada encontrada no workspace.`,
        });
      }
      connectionId = matched.id;
    }

    const result = await createAndEnqueueCampaign(db, queue, {
      tenantId,
      userId: request.user.userId,
      actorRole: request.user.role,
      name: `Envio Direto - ${lead.businessName}`,
      channel: parsed.data.channel,
      connectionId,
      subjectTemplate: parsed.data.subjectTemplate,
      bodyTemplate: parsed.data.bodyTemplate,
      leadIds: [lead.id],
      minDelayMs: 50,
      maxDelayMs: 60,
      respectBusinessHours: parsed.data.respectBusinessHours ?? false,
      appUrl: config.appUrl,
      masterKey: config.encryptionMasterKey,
    });

    await queue.waitUntilIdle('messaging-dispatch', 8000);
    return reply.status(201).send(result);
  });
}
