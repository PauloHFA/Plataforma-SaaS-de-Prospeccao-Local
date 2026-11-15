import { createDbContext } from './client.js';
import { runMigrations } from './migrate.js';

async function main() {
  const ctx = await createDbContext();
  try {
    await runMigrations(ctx);
    console.log(`[db:migrate] Migrações aplicadas com sucesso (${ctx.dialect}, postgis=${ctx.hasPostgis}).`);
  } finally {
    await ctx.close();
  }
}

main().catch((err) => {
  console.error('[db:migrate] Erro:', err);
  process.exit(1);
});
