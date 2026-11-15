import { eq } from 'drizzle-orm';
import { hashPassword, generateSecureToken } from '@plataforma/shared/crypto';
import type { DbContext } from './client.js';
import {
  plans,
  tenants,
  users,
  siteTemplates,
  messagingConnections,
  messageTemplates,
} from './schema.js';

export interface SeedResult {
  plansCount: number;
  templatesCount: number;
  tenantAlphaId: string;
  tenantBetaId: string;
  adminUserId: string;
}

export async function seedDatabase(ctx: DbContext): Promise<SeedResult> {
  const { db } = ctx;

  // 1. SaaS Plans
  const planDefinitions = [
    {
      slug: 'starter',
      name: 'Starter',
      description: 'Ideal para consultores iniciantes e prospecção local enxuta.',
      priceCents: 19700,
      monthlyCredits: 250,
      maxSearchesPerMonth: 150,
      maxSitesPerMonth: 40,
      maxMessagesPerDay: 50,
      maxActivePreviews: 25,
      monthlyBudgetCents: 15000,
      allowByok: true,
      allowCustomDomain: true,
      isActive: true,
    },
    {
      slug: 'pro',
      name: 'Agência Pro',
      description: 'Para agências com volume recorrente, automação em lote e BYOK.',
      priceCents: 49700,
      monthlyCredits: 1500,
      maxSearchesPerMonth: 800,
      maxSitesPerMonth: 300,
      maxMessagesPerDay: 150,
      maxActivePreviews: 150,
      monthlyBudgetCents: 80000,
      allowByok: true,
      allowCustomDomain: true,
      isActive: true,
    },
    {
      slug: 'agency',
      name: 'Scale Enterprise',
      description: 'Escala comercial ilimitada com prioridade em workers e suporte dedicado.',
      priceCents: 99700,
      monthlyCredits: 10000,
      maxSearchesPerMonth: 5000,
      maxSitesPerMonth: 2000,
      maxMessagesPerDay: 500,
      maxActivePreviews: 1000,
      monthlyBudgetCents: 300000,
      allowByok: true,
      allowCustomDomain: true,
      isActive: true,
    },
  ];

  for (const plan of planDefinitions) {
    await db
      .insert(plans)
      .values(plan)
      .onConflictDoNothing({ target: plans.slug });
  }

  const [proPlan] = await db.select().from(plans).where(eq(plans.slug, 'pro'));
  const [starterPlan] = await db.select().from(plans).where(eq(plans.slug, 'starter'));
  if (!proPlan || !starterPlan) {
    throw new Error('Falha ao semear planos padrão.');
  }

  // 2. Global SPA Template Catalog (RF-07)
  const templateDefs = [
    {
      slug: 'clinical-clean',
      name: 'Clínica Serene',
      niche: 'clinicas',
      description: 'Layout limpo e acolhedor para clínicas médicas, odontológicas e saúde.',
      defaultPaletteJson: {
        primaryColor: '#0F766E',
        secondaryColor: '#115E59',
        accentColor: '#14B8A6',
        backgroundColor: '#F8FAFC',
        surfaceColor: '#FFFFFF',
        textColor: '#0F172A',
      },
      defaultTypography: 'inter-plus-jakarta',
      isActive: true,
    },
    {
      slug: 'automotive-bold',
      name: 'AutoForce Pro',
      niche: 'oficinas',
      description: 'Visual técnico de alto contraste para oficinas mecânicas e auto centers.',
      defaultPaletteJson: {
        primaryColor: '#D97706',
        secondaryColor: '#0F172A',
        accentColor: '#F59E0B',
        backgroundColor: '#F8FAFC',
        surfaceColor: '#FFFFFF',
        textColor: '#1E293B',
      },
      defaultTypography: 'space-grotesk-inter',
      isActive: true,
    },
    {
      slug: 'gastronomy-warm',
      name: 'Sabor Editorial',
      niche: 'restaurantes',
      description: 'Layout convidativo com destaque gastronômico para restaurantes e cafés.',
      defaultPaletteJson: {
        primaryColor: '#B91C1C',
        secondaryColor: '#450A0A',
        accentColor: '#F97316',
        backgroundColor: '#FFFBEB',
        surfaceColor: '#FFFFFF',
        textColor: '#1C1917',
      },
      defaultTypography: 'playfair-inter',
      isActive: true,
    },
    {
      slug: 'corporate-trust',
      name: 'Autoridade Executiva',
      niche: 'escritorios',
      description: 'Design sóbrio de credibilidade para advocacia, contabilidade e consultoria.',
      defaultPaletteJson: {
        primaryColor: '#1E3A8A',
        secondaryColor: '#0F172A',
        accentColor: '#3B82F6',
        backgroundColor: '#F8FAFC',
        surfaceColor: '#FFFFFF',
        textColor: '#0F172A',
      },
      defaultTypography: 'merriweather-source',
      isActive: true,
    },
    {
      slug: 'beauty-editorial',
      name: 'Atelier Lumière',
      niche: 'estetica',
      description: 'Estética sofisticada para clínicas de estética, salões, spas e barbearias.',
      defaultPaletteJson: {
        primaryColor: '#9D174D',
        secondaryColor: '#500724',
        accentColor: '#EC4899',
        backgroundColor: '#FFF1F2',
        surfaceColor: '#FFFFFF',
        textColor: '#1F2937',
      },
      defaultTypography: 'playfair-inter',
      isActive: true,
    },
    {
      slug: 'local-express',
      name: 'Serviço Local Direto',
      niche: 'servicos_locais',
      description: 'Focado em conversão rápida via WhatsApp para prestadores e negócios locais.',
      defaultPaletteJson: {
        primaryColor: '#2563EB',
        secondaryColor: '#1E293B',
        accentColor: '#10B981',
        backgroundColor: '#F8FAFC',
        surfaceColor: '#FFFFFF',
        textColor: '#0F172A',
      },
      defaultTypography: 'poppins-dm-sans',
      isActive: true,
    },
  ];

  for (const tpl of templateDefs) {
    await db
      .insert(siteTemplates)
      .values(tpl)
      .onConflictDoNothing({ target: siteTemplates.slug });
  }

  // 3. Global Admin + Demo Tenants (Tenant A & Tenant B for multi-tenant isolation)
  const adminEmail = 'admin@plataforma.com.br';
  let [adminUser] = await db.select().from(users).where(eq(users.email, adminEmail));
  if (!adminUser) {
    [adminUser] = await db
      .insert(users)
      .values({
        tenantId: null,
        email: adminEmail,
        passwordHash: hashPassword('Admin@123456'),
        name: 'Administrador Global',
        role: 'GLOBAL_ADMIN',
        isActive: true,
      })
      .returning();
  }

  let [tenantAlpha] = await db.select().from(tenants).where(eq(tenants.slug, 'agencia-alfa'));
  if (!tenantAlpha) {
    [tenantAlpha] = await db
      .insert(tenants)
      .values({
        name: 'Agência Alfa Digital',
        slug: 'agencia-alfa',
        planId: proPlan.id,
        status: 'ACTIVE',
        creditsBalance: 1500,
      })
      .returning();
  }

  let [tenantBeta] = await db.select().from(tenants).where(eq(tenants.slug, 'agencia-beta'));
  if (!tenantBeta) {
    [tenantBeta] = await db
      .insert(tenants)
      .values({
        name: 'Agência Beta Growth',
        slug: 'agencia-beta',
        planId: starterPlan.id,
        status: 'ACTIVE',
        creditsBalance: 250,
      })
      .returning();
  }

  if (!tenantAlpha || !tenantBeta || !adminUser) {
    throw new Error('Falha ao inicializar tenants ou administrador global.');
  }

  const operatorSpecs = [
    {
      tenantId: tenantAlpha.id,
      email: 'operador@alfa.com.br',
      password: 'Operador@123',
      name: 'Operador Agência Alfa',
    },
    {
      tenantId: tenantBeta.id,
      email: 'operador@beta.com.br',
      password: 'Operador@123',
      name: 'Operador Agência Beta',
    },
  ];

  for (const op of operatorSpecs) {
    const existing = await db.select().from(users).where(eq(users.email, op.email));
    if (existing.length === 0) {
      await db.insert(users).values({
        tenantId: op.tenantId,
        email: op.email,
        passwordHash: hashPassword(op.password),
        name: op.name,
        role: 'TENANT_OPERATOR',
        isActive: true,
      });
    }
  }

  // 4. Default Messaging Connections & Templates for Tenant Alfa
  const existingConn = await db
    .select()
    .from(messagingConnections)
    .where(eq(messagingConnections.tenantId, tenantAlpha.id));
  if (existingConn.length === 0) {
    await db.insert(messagingConnections).values([
      {
        tenantId: tenantAlpha.id,
        channel: 'WHATSAPP_EVOLUTION',
        label: 'WhatsApp Comercial Principal',
        status: 'CONNECTED',
        identifier: '+5511999990001',
        dailyLimit: 120,
        minDelaySeconds: 1,
        maxDelaySeconds: 2,
      },
      {
        tenantId: tenantAlpha.id,
        channel: 'EMAIL_SMTP',
        label: 'E-mail Comercial Autenticado',
        status: 'CONNECTED',
        identifier: 'contato@agenciaalfa.com.br',
        spfVerified: true,
        dkimVerified: true,
        dailyLimit: 200,
        minDelaySeconds: 1,
        maxDelaySeconds: 2,
      },
    ]);
  }

  const existingTpl = await db
    .select()
    .from(messageTemplates)
    .where(eq(messageTemplates.tenantId, tenantAlpha.id));
  if (existingTpl.length === 0) {
    await db.insert(messageTemplates).values([
      {
        tenantId: tenantAlpha.id,
        name: 'Abordagem Padrão com Preview',
        channel: 'WHATSAPP',
        body: '{Olá|Oi|Bom dia}, equipe da *{{nome_empresa}}*! Vi que vocês são referência em {{categoria}} no bairro {{bairro}} ({{nota_google}}★). {Preparamos|Criamos|Montamos} uma prévia exclusiva de um novo site profissional para vocês: {{link_preview}} — Caso não queira receber novas mensagens, responda SAIR ou acesse {{link_optout}}',
        variablesJson: [
          'nome_empresa',
          'categoria',
          'bairro',
          'nota_google',
          'link_preview',
          'link_optout',
        ],
      },
      {
        tenantId: tenantAlpha.id,
        name: 'E-mail Comercial com Prévia SPA',
        channel: 'EMAIL',
        subject: 'Prévia exclusiva do site da {{nome_empresa}} em {{bairro}}',
        body: 'Olá, equipe da {{nome_empresa}}! Notamos sua excelente reputação em {{categoria}} em {{cidade}} e desenvolvemos uma demonstração pronta para sua empresa: {{link_preview}}. Para descadastro: {{link_optout}}',
        variablesJson: ['nome_empresa', 'categoria', 'bairro', 'cidade', 'link_preview', 'link_optout'],
      },
    ]);
  }

  const allPlans = await db.select().from(plans);
  const allTemplates = await db.select().from(siteTemplates);

  return {
    plansCount: allPlans.length,
    templatesCount: allTemplates.length,
    tenantAlphaId: tenantAlpha.id,
    tenantBetaId: tenantBeta.id,
    adminUserId: adminUser.id,
  };
}

export function createOptOutToken(): string {
  return generateSecureToken(16);
}
