import type { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { plans, tenants, users, messagingConnections, messageTemplates } from '@plataforma/db';
import { slugifyBusinessName } from '@plataforma/shared';
import { hashPassword, verifyPassword } from '@plataforma/shared/crypto';
import type { DbContext } from '@plataforma/db';
import { requireAuth } from '../auth.js';
import { getTenantUsageSummary } from '../services/quota.service.js';
import { recordAuditLog } from '../services/audit.service.js';

const RegisterSchema = z.object({
  workspaceName: z.string().min(2).max(80),
  name: z.string().min(2).max(80),
  email: z.string().email(),
  password: z.string().min(6).max(100),
});

const LoginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export function registerAuthRoutes(app: FastifyInstance, dbCtx: DbContext) {
  const { db } = dbCtx;

  app.post('/api/auth/register', async (request, reply) => {
    const parsed = RegisterSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Dados de cadastro inválidos.', issues: parsed.error.issues });
    }

    const email = parsed.data.email.toLowerCase().trim();
    const [existing] = await db.select().from(users).where(eq(users.email, email));
    if (existing) {
      return reply.status(409).send({ error: 'E-mail já cadastrado na plataforma.' });
    }

    const [starterPlan] = await db.select().from(plans).where(eq(plans.slug, 'starter'));
    const [anyPlan] = starterPlan ? [starterPlan] : await db.select().from(plans);
    if (!anyPlan) {
      return reply.status(500).send({ error: 'Nenhum plano SaaS inicializado.' });
    }

    const baseSlug = slugifyBusinessName(parsed.data.workspaceName);
    const [slugExists] = await db.select().from(tenants).where(eq(tenants.slug, baseSlug));
    const slug = slugExists ? `${baseSlug}-${Date.now().toString(36)}` : baseSlug;

    const [tenant] = await db
      .insert(tenants)
      .values({
        name: parsed.data.workspaceName,
        slug,
        planId: anyPlan.id,
        creditsBalance: anyPlan.monthlyCredits,
      })
      .returning();

    if (!tenant) return reply.status(500).send({ error: 'Falha ao criar workspace.' });

    const [user] = await db
      .insert(users)
      .values({
        tenantId: tenant.id,
        email,
        passwordHash: hashPassword(parsed.data.password),
        name: parsed.data.name,
        role: 'TENANT_OPERATOR',
      })
      .returning();

    if (!user) return reply.status(500).send({ error: 'Falha ao criar usuário.' });

    // Bootstrap default sandbox messaging connection and template
    await db.insert(messagingConnections).values({
      tenantId: tenant.id,
      channel: 'WHATSAPP_EVOLUTION',
      label: 'WhatsApp Principal',
      status: 'DISCONNECTED',
      identifier: '',
    });
    await db.insert(messageTemplates).values({
      tenantId: tenant.id,
      name: 'Abordagem Inicial',
      channel: 'WHATSAPP',
      body: '{Olá|Oi}, equipe da {{nome_empresa}}! Preparamos uma prévia exclusiva de site para vocês em {{bairro}}: {{link_preview}} (Para não receber mais mensagens: {{link_optout}})',
      variablesJson: ['nome_empresa', 'bairro', 'link_preview', 'link_optout'],
    });

    const token = app.jwt.sign({
      userId: user.id,
      tenantId: tenant.id,
      email: user.email,
      name: user.name,
      role: 'TENANT_OPERATOR',
    });

    await recordAuditLog(db, {
      tenantId: tenant.id,
      userId: user.id,
      actorRole: 'TENANT_OPERATOR',
      action: 'TENANT_REGISTERED',
      resourceType: 'tenant',
      resourceId: tenant.id,
    });

    reply.setCookie('auth_token', token, {
      path: '/',
      httpOnly: true,
      sameSite: 'lax',
    });

    return reply.status(201).send({
      token,
      user: {
        id: user.id,
        tenantId: tenant.id,
        email: user.email,
        name: user.name,
        role: user.role,
      },
      tenant,
    });
  });

  app.post('/api/auth/login', async (request, reply) => {
    const parsed = LoginSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Credenciais inválidas.' });
    }

    const email = parsed.data.email.toLowerCase().trim();
    const [user] = await db.select().from(users).where(eq(users.email, email));
    if (!user || !user.isActive || !verifyPassword(parsed.data.password, user.passwordHash)) {
      return reply.status(401).send({ error: 'E-mail ou senha inválidos.' });
    }

    const token = app.jwt.sign({
      userId: user.id,
      tenantId: user.tenantId,
      email: user.email,
      name: user.name,
      role: user.role as any,
    });

    reply.setCookie('auth_token', token, {
      path: '/',
      httpOnly: true,
      sameSite: 'lax',
    });

    return {
      token,
      user: {
        id: user.id,
        tenantId: user.tenantId,
        email: user.email,
        name: user.name,
        role: user.role,
      },
    };
  });

  app.post('/api/auth/logout', async (_request, reply) => {
    reply.clearCookie('auth_token', { path: '/' });
    return { ok: true };
  });

  app.get('/api/auth/me', { preHandler: requireAuth }, async (request) => {
    const claims = request.user;
    let usage = null;
    if (claims.tenantId) {
      usage = await getTenantUsageSummary(db, claims.tenantId);
    }
    return {
      user: {
        id: claims.userId,
        tenantId: claims.tenantId,
        email: claims.email,
        name: claims.name,
        role: claims.role,
      },
      workspace: usage,
    };
  });
}
