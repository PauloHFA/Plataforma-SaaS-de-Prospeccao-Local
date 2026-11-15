import type { DbContext } from '@plataforma/db';
import type {
  DomainSslJobData,
  LeadEnrichmentJobData,
  LifecycleCronJobData,
  MessagingDispatchJobData,
  QueueManager,
  SiteGenerationJobData,
} from '@plataforma/queue';
import type { AppConfig } from '../config.js';
import { runLeadEnrichmentJob } from '../services/enrichment.service.js';
import { generateSiteForLead } from '../services/site-generation.service.js';
import { runMessagingDispatchJob } from '../services/messaging.service.js';
import {
  runLifecycleCronTask,
  verifyCustomDomainForSite,
} from '../services/billing-domain.service.js';

export function registerAllWorkers(
  dbCtx: DbContext,
  queue: QueueManager,
  config: AppConfig,
): void {
  const { db } = dbCtx;

  queue.registerWorker<LeadEnrichmentJobData>(
    'lead-enrichment',
    async (job) => {
      return runLeadEnrichmentJob(db, job.data);
    },
    { concurrency: 4 },
  );

  queue.registerWorker<SiteGenerationJobData>(
    'site-generation',
    async (job) => {
      return generateSiteForLead(db, {
        tenantId: job.data.tenantId,
        userId: job.data.requestedByUserId || '',
        actorRole: 'TENANT_OPERATOR',
        leadId: job.data.leadId,
        templateSlug: job.data.templateSlug as any,
        primaryColor: job.data.primaryColor,
        appUrl: config.appUrl,
        previewBaseDomain: config.previewBaseDomain,
        masterKey: config.encryptionMasterKey,
      });
    },
    { concurrency: 3 },
  );

  queue.registerWorker<MessagingDispatchJobData>(
    'messaging-dispatch',
    async (job) => {
      return runMessagingDispatchJob(db, job.data, {
        businessHoursEnforce: config.businessHoursEnforce,
        masterKey: config.encryptionMasterKey,
      });
    },
    { concurrency: 2 },
  );

  queue.registerWorker<DomainSslJobData>(
    'domain-ssl',
    async (job) => {
      return verifyCustomDomainForSite(db, {
        tenantId: job.data.tenantId,
        siteId: job.data.siteId,
        appUrl: config.appUrl,
      });
    },
    { concurrency: 2 },
  );

  queue.registerWorker<LifecycleCronJobData>(
    'lifecycle-cron',
    async (job) => {
      return runLifecycleCronTask(db, job.data.task);
    },
    { concurrency: 1 },
  );
}
