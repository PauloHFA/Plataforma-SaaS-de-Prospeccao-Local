import { and, eq, gte, sql } from 'drizzle-orm';
import type { AppDatabase } from '@plataforma/db';
import { plans, sites, tenants, tenantSecrets, usageTelemetry } from '@plataforma/db';
import type { SecretProvider } from '@plataforma/shared';
import { decryptSecret, encryptSecret } from '@plataforma/shared/crypto';

export class QuotaExceededError extends Error {
  statusCode = 402;
  constructor(message: string) {
    super(message);
    this.name = 'QuotaExceededError';
  }
}

export type QuotaMetricType =
  | 'MAPS_SEARCH'
  | 'LLM_GENERATION'
  | 'WHATSAPP_DISPATCH'
  | 'EMAIL_DISPATCH';

export async function getDecryptedTenantSecret(
  db: AppDatabase,
  tenantId: string,
  provider: SecretProvider,
  masterKey?: string,
): Promise<string | null> {
  const [row] = await db
    .select()
    .from(tenantSecrets)
    .where(
      and(
        eq(tenantSecrets.tenantId, tenantId),
        eq(tenantSecrets.provider, provider),
        eq(tenantSecrets.isActive, true),
      ),
    );
  if (!row) return null;
  try {
    return decryptSecret(
      { ciphertext: row.ciphertext, iv: row.iv, authTag: row.authTag },
      masterKey,
    );
  } catch {
    return null;
  }
}

export async function upsertEncryptedTenantSecret(
  db: AppDatabase,
  params: {
    tenantId: string;
    provider: SecretProvider;
    secretValue: string;
    masterKey?: string;
  },
): Promise<{ provider: SecretProvider; keyHint: string }> {
  const trimmed = params.secretValue.trim();
  const encrypted = encryptSecret(trimmed, params.masterKey);
  const keyHint =
    trimmed.length <= 8
      ? '••••••••'
      : `${trimmed.slice(0, 4)}••••${trimmed.slice(-4)}`;

  await db
    .insert(tenantSecrets)
    .values({
      tenantId: params.tenantId,
      provider: params.provider,
      ciphertext: encrypted.ciphertext,
      iv: encrypted.iv,
      authTag: encrypted.authTag,
      keyHint,
      isActive: true,
    })
    .onConflictDoUpdate({
      target: [tenantSecrets.tenantId, tenantSecrets.provider],
      set: {
        ciphertext: encrypted.ciphertext,
        iv: encrypted.iv,
        authTag: encrypted.authTag,
        keyHint,
        isActive: true,
        updatedAt: new Date(),
      },
    });

  return { provider: params.provider, keyHint };
}

export async function getTenantUsageSummary(db: AppDatabase, tenantId: string) {
  const [tenant] = await db.select().from(tenants).where(eq(tenants.id, tenantId));
  if (!tenant) {
    throw new Error('Workspace não encontrado.');
  }
  const [plan] = await db.select().from(plans).where(eq(plans.id, tenant.planId));
  if (!plan) {
    throw new Error('Plano do workspace não encontrado.');
  }

  const monthStart = new Date();
  monthStart.setDate(1);
  monthStart.setHours(0, 0, 0, 0);

  const dayStart = new Date();
  dayStart.setHours(0, 0, 0, 0);

  const monthlyRows = await db
    .select({
      metricType: usageTelemetry.metricType,
      units: sql<number>`COALESCE(SUM(${usageTelemetry.units}), 0)::int`,
      promptTokens: sql<number>`COALESCE(SUM(${usageTelemetry.promptTokens}), 0)::int`,
      completionTokens: sql<number>`COALESCE(SUM(${usageTelemetry.completionTokens}), 0)::int`,
      costCents: sql<number>`COALESCE(SUM(${usageTelemetry.estimatedCostCents}), 0)::int`,
    })
    .from(usageTelemetry)
    .where(and(eq(usageTelemetry.tenantId, tenantId), gte(usageTelemetry.createdAt, monthStart)))
    .groupBy(usageTelemetry.metricType);

  const dailyDispatchRows = await db
    .select({
      units: sql<number>`COALESCE(SUM(${usageTelemetry.units}), 0)::int`,
    })
    .from(usageTelemetry)
    .where(
      and(
        eq(usageTelemetry.tenantId, tenantId),
        gte(usageTelemetry.createdAt, dayStart),
        sql`${usageTelemetry.metricType} IN ('WHATSAPP_DISPATCH', 'EMAIL_DISPATCH')`,
      ),
    );

  const [previewCountRow] = await db
    .select({ count: sql<number>`COUNT(*)::int` })
    .from(sites)
    .where(and(eq(sites.tenantId, tenantId), eq(sites.status, 'PREVIEW')));

  const byMetric = Object.fromEntries(monthlyRows.map((r) => [r.metricType, r]));
  const totalCostCents = monthlyRows.reduce((acc, r) => acc + Number(r.costCents || 0), 0);
  const totalPromptTokens = monthlyRows.reduce((acc, r) => acc + Number(r.promptTokens || 0), 0);
  const totalCompletionTokens = monthlyRows.reduce(
    (acc, r) => acc + Number(r.completionTokens || 0),
    0,
  );

  const activeSecrets = await db
    .select({ provider: tenantSecrets.provider })
    .from(tenantSecrets)
    .where(and(eq(tenantSecrets.tenantId, tenantId), eq(tenantSecrets.isActive, true)));

  return {
    tenant,
    plan,
    activeByokProviders: activeSecrets.map((s) => s.provider),
    activePreviews: Number(previewCountRow?.count ?? 0),
    monthly: {
      searches: Number(byMetric.MAPS_SEARCH?.units ?? 0),
      siteGenerations: Number(byMetric.LLM_GENERATION?.units ?? 0),
      whatsappDispatches: Number(byMetric.WHATSAPP_DISPATCH?.units ?? 0),
      emailDispatches: Number(byMetric.EMAIL_DISPATCH?.units ?? 0),
      totalTokens: totalPromptTokens + totalCompletionTokens,
      promptTokens: totalPromptTokens,
      completionTokens: totalCompletionTokens,
      estimatedCostCents: totalCostCents,
    },
    dailyDispatches: Number(dailyDispatchRows[0]?.units ?? 0),
  };
}

export async function checkTenantQuotaAndBudget(
  db: AppDatabase,
  tenantId: string,
  metricType: QuotaMetricType,
  masterKey?: string,
): Promise<{ usedByok: boolean }> {
  const summary = await getTenantUsageSummary(db, tenantId);

  if (summary.tenant.status !== 'ACTIVE') {
    throw new QuotaExceededError('Workspace suspenso. Regularize o plano para continuar.');
  }

  let usedByok = false;
  if (summary.plan.allowByok) {
    if (metricType === 'MAPS_SEARCH') {
      usedByok = Boolean(await getDecryptedTenantSecret(db, tenantId, 'google_places', masterKey));
    } else if (metricType === 'LLM_GENERATION') {
      const hasOpenai = Boolean(await getDecryptedTenantSecret(db, tenantId, 'openai', masterKey));
      const hasAnthropic = Boolean(await getDecryptedTenantSecret(db, tenantId, 'anthropic', masterKey));
      usedByok = hasOpenai || hasAnthropic;
    }
  }

  if (usedByok) {
    return { usedByok: true };
  }

  if (
    summary.plan.monthlyBudgetCents > 0 &&
    summary.monthly.estimatedCostCents >= summary.plan.monthlyBudgetCents
  ) {
    throw new QuotaExceededError(
      'Orçamento mensal de consumo atingido (RNF-07). Faça upgrade do plano ou configure uma chave BYOK.',
    );
  }

  if (metricType === 'MAPS_SEARCH') {
    if (summary.tenant.creditsBalance <= 0) {
      throw new QuotaExceededError('Saldo de créditos esgotado para extração de leads.');
    }
    if (summary.monthly.searches >= summary.plan.maxSearchesPerMonth) {
      throw new QuotaExceededError('Limite mensal de buscas georreferenciadas do plano atingido.');
    }
  }

  if (metricType === 'LLM_GENERATION') {
    if (summary.monthly.siteGenerations >= summary.plan.maxSitesPerMonth) {
      throw new QuotaExceededError('Limite mensal de gerações de sites IA do plano atingido.');
    }
    if (summary.activePreviews >= summary.plan.maxActivePreviews) {
      throw new QuotaExceededError('Limite simultâneo de sites em preview ativo atingido.');
    }
  }

  if (metricType === 'WHATSAPP_DISPATCH' || metricType === 'EMAIL_DISPATCH') {
    if (summary.dailyDispatches >= summary.plan.maxMessagesPerDay) {
      throw new QuotaExceededError('Limite diário de disparos comerciais do plano atingido.');
    }
  }

  return { usedByok: false };
}

export async function recordUsageTelemetry(
  db: AppDatabase,
  params: {
    tenantId: string;
    metricType: QuotaMetricType;
    units?: number;
    promptTokens?: number;
    completionTokens?: number;
    estimatedCostCents?: number;
    usedByok?: boolean;
    metadata?: Record<string, unknown>;
  },
): Promise<void> {
  await db.insert(usageTelemetry).values({
    tenantId: params.tenantId,
    metricType: params.metricType,
    units: params.units ?? 1,
    promptTokens: params.promptTokens ?? 0,
    completionTokens: params.completionTokens ?? 0,
    estimatedCostCents: params.estimatedCostCents ?? 0,
    usedByok: params.usedByok ?? false,
    metadataJson: params.metadata ?? {},
  });
}
