import { createDbContext, runMigrations } from '@plataforma/db';
import { QueueManager } from '@plataforma/queue';
import { loadConfig, registerAllWorkers } from '@plataforma/api';

async function main() {
  const config = loadConfig();
  const dbCtx = await createDbContext();
  await runMigrations(dbCtx);

  const queue = new QueueManager();
  registerAllWorkers(dbCtx, queue, config);

  console.log(
    `[Worker] Workers registrados e ativos (db=${dbCtx.dialect}, queue=${queue.getDriver()}).`,
  );

  // RN-11 (Expiração de previews não convertidos) & RN-12 (Suspensão graciosa por inadimplência)
  const lifecycleInterval = setInterval(() => {
    void queue.enqueue('lifecycle-cron', 'expire-previews-sweep', {
      task: 'expire-previews',
    });
    void queue.enqueue('lifecycle-cron', 'suspend-delinquent-sweep', {
      task: 'suspend-delinquent',
    });
  }, 60 * 60 * 1000);

  const shutdown = async () => {
    clearInterval(lifecycleInterval);
    await queue.close();
    await dbCtx.close();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  console.error('[Worker] Erro fatal:', err);
  process.exit(1);
});
