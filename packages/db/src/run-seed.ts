import { createDbContext } from './client.js';
import { runMigrations } from './migrate.js';
import { seedDatabase } from './seed.js';

async function main() {
  const ctx = await createDbContext();
  try {
    await runMigrations(ctx);
    const result = await seedDatabase(ctx);
    console.log('[db:seed] Seed concluído:', result);
  } finally {
    await ctx.close();
  }
}

main().catch((err) => {
  console.error('[db:seed] Erro:', err);
  process.exit(1);
});
