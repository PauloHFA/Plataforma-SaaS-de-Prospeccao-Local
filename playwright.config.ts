import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 90_000,
  expect: {
    timeout: 15_000,
  },
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:3000',
    channel: 'chrome',
    headless: true,
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  webServer: [
    {
      command: 'pnpm --filter @plataforma/api start',
      url: 'http://localhost:4000/health',
      reuseExistingServer: false,
      timeout: 30_000,
      env: {
        NODE_ENV: 'test',
        PORT: '4000',
        DATABASE_URL: 'memory://',
        QUEUE_DRIVER: 'memory',
        EMBED_WORKERS: 'true',
        APP_URL: 'http://localhost:3000',
        NEXT_PUBLIC_API_URL: 'http://localhost:4000',
        JWT_SECRET: 'e2e-test-jwt-secret-key-min-32-chars-0123456',
      },
    },
    {
      command: 'pnpm --filter @plataforma/web start',
      url: 'http://localhost:3000/login',
      reuseExistingServer: false,
      timeout: 60_000,
      env: {
        NODE_ENV: 'production',
        PORT: '3000',
        API_URL: 'http://localhost:4000',
        NEXT_PUBLIC_API_URL: 'http://localhost:4000',
      },
    },
  ],
});
