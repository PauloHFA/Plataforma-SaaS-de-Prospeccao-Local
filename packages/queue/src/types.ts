export const QUEUE_NAMES = [
  'lead-enrichment',
  'site-generation',
  'messaging-dispatch',
  'domain-ssl',
  'lifecycle-cron',
] as const;

export type QueueName = (typeof QUEUE_NAMES)[number];

export interface LeadEnrichmentJobData {
  tenantId: string;
  leadIds: string[];
  validateWhatsApp: boolean;
}

export interface SiteGenerationJobData {
  tenantId: string;
  leadId: string;
  templateSlug?: string;
  primaryColor?: string;
  requestedByUserId?: string;
}

export interface MessagingDispatchJobData {
  tenantId: string;
  dispatchId: string;
  campaignId?: string;
}

export interface DomainSslJobData {
  tenantId: string;
  siteId: string;
  customDomainId: string;
}

export interface LifecycleCronJobData {
  task: 'expire-previews' | 'suspend-delinquent';
}

export interface JobOptions {
  delayMs?: number;
  attempts?: number;
  backoffMs?: number;
  jobId?: string;
}

export interface QueueMetricsSnapshot {
  name: QueueName;
  driver: 'bullmq' | 'memory';
  waiting: number;
  active: number;
  delayed: number;
  completed: number;
  failed: number;
  dlqCount: number;
  failedJobs: Array<{
    id: string;
    name: string;
    error: string;
    attemptsMade: number;
    failedAt: string;
  }>;
}
