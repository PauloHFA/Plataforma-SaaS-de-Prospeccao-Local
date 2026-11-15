import type { AppDatabase } from '@plataforma/db';
import { auditLogs } from '@plataforma/db';

export async function recordAuditLog(
  db: AppDatabase,
  entry: {
    tenantId: string | null;
    userId: string | null;
    actorRole: string;
    action: string;
    resourceType: string;
    resourceId?: string | null;
    details?: Record<string, unknown>;
  },
): Promise<void> {
  await db.insert(auditLogs).values({
    tenantId: entry.tenantId,
    userId: entry.userId,
    actorRole: entry.actorRole,
    action: entry.action,
    resourceType: entry.resourceType,
    resourceId: entry.resourceId ?? null,
    detailsJson: entry.details ?? {},
  });
}
