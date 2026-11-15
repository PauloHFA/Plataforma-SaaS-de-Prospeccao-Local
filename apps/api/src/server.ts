import { buildApp } from './app.js';

async function main() {
  const runtime = await buildApp();
  await runtime.app.listen({
    port: runtime.config.port,
    host: runtime.config.host,
  });
  console.log(
    `[API] Servidor iniciado em http://localhost:${runtime.config.port} (db=${runtime.dbCtx.dialect}, queue=${runtime.queue.getDriver()})`,
  );

  const shutdown = async () => {
    await runtime.close();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  console.error('[API] Erro fatal na inicialização:', err);
  process.exit(1);
});
