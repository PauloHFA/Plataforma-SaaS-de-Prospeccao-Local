import fs from 'node:fs';
import path from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { drizzle as drizzlePglite, type PgliteDatabase } from 'drizzle-orm/pglite';
import { Pool } from 'pg';
import { drizzle as drizzlePg, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import * as schema from './schema.js';

export type AppDatabase = PgliteDatabase<typeof schema> | NodePgDatabase<typeof schema>;

export interface DbContext {
  db: AppDatabase;
  dialect: 'postgres' | 'pglite';
  hasPostgis: boolean;
  executeRaw: (sql: string, params?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }>;
  close: () => Promise<void>;
}

export async function createDbContext(databaseUrl?: string): Promise<DbContext> {
  const url = (databaseUrl ?? process.env.DATABASE_URL ?? 'pglite://./data/pgdata').trim();

  if (url === 'memory://' || url === 'pglite://memory' || url.startsWith('pglite://')) {
    let client: PGlite;
    if (url === 'memory://' || url === 'pglite://memory') {
      client = new PGlite();
    } else {
      const rawPath = url.replace(/^pglite:\/\//, '');
      const resolvedDir = path.resolve(process.cwd(), rawPath);
      fs.mkdirSync(resolvedDir, { recursive: true });
      client = new PGlite(resolvedDir);
    }
    await client.waitReady;
    const db = drizzlePglite(client, { schema });
    return {
      db,
      dialect: 'pglite',
      hasPostgis: false,
      executeRaw: async (sql: string, params: unknown[] = []) => {
        const res = await client.query<Record<string, unknown>>(sql, params);
        return { rows: res.rows };
      },
      close: async () => {
        await client.close();
      },
    };
  }

  const pool = new Pool({ connectionString: url });
  let hasPostgis = false;
  try {
    await pool.query('CREATE EXTENSION IF NOT EXISTS postgis');
    const res = await pool.query<{ exists: boolean }>(
      "SELECT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'postgis') AS exists",
    );
    hasPostgis = Boolean(res.rows[0]?.exists);
  } catch {
    hasPostgis = false;
  }

  const db = drizzlePg(pool, { schema });
  return {
    db,
    dialect: 'postgres',
    hasPostgis,
    executeRaw: async (sql: string, params: unknown[] = []) => {
      const res = await pool.query<Record<string, unknown>>(sql, params);
      return { rows: res.rows };
    },
    close: async () => {
      await pool.end();
    },
  };
}
