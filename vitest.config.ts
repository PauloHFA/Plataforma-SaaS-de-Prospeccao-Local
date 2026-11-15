import path from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@plataforma/shared/crypto': path.resolve(__dirname, 'packages/shared/src/crypto.ts'),
      '@plataforma/shared': path.resolve(__dirname, 'packages/shared/src/index.ts'),
      '@plataforma/db': path.resolve(__dirname, 'packages/db/src/index.ts'),
      '@plataforma/queue': path.resolve(__dirname, 'packages/queue/src/index.ts'),
      '@plataforma/integrations': path.resolve(__dirname, 'packages/integrations/src/index.ts'),
    },
  },
  test: {
    environment: 'node',
    include: ['tests/unit/**/*.test.ts', 'tests/integration/**/*.test.ts'],
    testTimeout: 30000,
    hookTimeout: 30000,
    pool: 'forks',
    maxWorkers: 1,
    minWorkers: 1,
  },
});
