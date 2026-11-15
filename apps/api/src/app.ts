import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import jwt from '@fastify/jwt';
import multipart from '@fastify/multipart';
import { createDbContext, runMigrations, seedDatabase, type DbContext } from '@plataforma/db';
import { QueueManager } from '@plataforma/queue';
import { loadConfig, type AppConfig } from './config.js';
import { createRateLimitHook } from './rate-limit.js';
import { registerAllWorkers } from './workers/register-workers.js';
import { registerAuthRoutes } from './routes/auth.routes.js';
import { registerLeadRoutes } from './routes/leads.routes.js';
import { registerSiteRoutes } from './routes/sites.routes.js';
import { registerMessagingRoutes } from './routes/messaging.routes.js';
import { registerBillingAndSettingsRoutes } from './routes/billing.routes.js';
import { registerPublicAndWebhookRoutes } from './routes/public-and-webhooks.routes.js';
import { registerAdminRoutes } from './routes/admin.routes.js';

export interface BuildAppOptions {
  databaseUrl?: string;
  queueDriver?: 'auto' | 'bullmq' | 'memory';
  redisUrl?: string;
  embedWorkers?: boolean;
  seed?: boolean;
  rateLimitMaxAuth?: number;
  configOverrides?: Partial<AppConfig>;
}

export interface AppRuntime {
  app: ReturnType<typeof Fastify>;
  dbCtx: DbContext;
  queue: QueueManager;
  config: AppConfig;
  close: () => Promise<void>;
}

export async function buildApp(options: BuildAppOptions = {}): Promise<AppRuntime> {
  const config: AppConfig = {
    ...loadConfig(),
    ...(options.configOverrides || {}),
  };

  const dbCtx = await createDbContext(options.databaseUrl);
  await runMigrations(dbCtx);
  if (options.seed !== false) {
    await seedDatabase(dbCtx);
  }

  const queue = new QueueManager({
    redisUrl: options.redisUrl,
    driver: options.queueDriver,
  });

  const shouldEmbedWorkers = options.embedWorkers ?? config.embedWorkers;
  if (shouldEmbedWorkers) {
    registerAllWorkers(dbCtx, queue, config);
  }

  const app = Fastify({
    logger: process.env.NODE_ENV === 'test' ? false : { level: 'info' },
  });

  // Preserve rawBody for HMAC webhook signature verification (RN-10)
  app.addContentTypeParser('application/json', { parseAs: 'buffer' }, (req, body, done) => {
    (req as any).rawBody = body.toString('utf8');
    if (!body || body.length === 0) {
      return done(null, {});
    }
    try {
      done(null, JSON.parse(body.toString('utf8')));
    } catch (err) {
      done(err as Error, undefined);
    }
  });

  await app.register(helmet, {
    crossOriginResourcePolicy: { policy: 'cross-origin' },
    contentSecurityPolicy: false,
  });

  await app.register(cors, {
    origin: true,
    credentials: true,
    methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: [
      'Content-Type',
      'Authorization',
      'X-Webhook-Signature',
      'Stripe-Signature',
      'Asaas-Access-Token',
    ],
  });

  await app.register(cookie);

  await app.register(jwt, {
    secret: config.jwtSecret,
    cookie: {
      cookieName: 'auth_token',
      signed: false,
    },
  });

  await app.register(multipart, {
    limits: { fileSize: 8 * 1024 * 1024 },
  });

  const authLimit = options.rateLimitMaxAuth ?? 40;
  app.addHook(
    'onRequest',
    createRateLimitHook([
      {
        id: 'auth',
        match: (p, m) => m === 'POST' && (p === '/api/auth/login' || p === '/api/auth/register'),
        maxRequests: authLimit,
        windowMs: 60_000,
      },
      {
        id: 'public-checkout',
        match: (p, m) => m === 'POST' && p.startsWith('/api/public/checkout/'),
        maxRequests: 25,
        windowMs: 60_000,
      },
      {
        id: 'public-telemetry',
        match: (p, m) => m === 'POST' && p === '/api/public/telemetry',
        maxRequests: 120,
        windowMs: 60_000,
      },
    ]),
  );

  registerAuthRoutes(app, dbCtx);
  registerLeadRoutes(app, dbCtx, queue, config);
  registerSiteRoutes(app, dbCtx, queue, config);
  registerMessagingRoutes(app, dbCtx, queue, config);
  registerBillingAndSettingsRoutes(app, dbCtx, config);
  registerPublicAndWebhookRoutes(app, dbCtx, queue, config);
  registerAdminRoutes(app, dbCtx, queue);

  app.setErrorHandler((err: any, _request, reply) => {
    const status = typeof err?.statusCode === 'number' ? err.statusCode : 500;
    if (status >= 500) {
      app.log.error(err);
    }
    return reply.status(status).send({
      error: err?.message || 'Erro interno no servidor.',
    });
  });

  return {
    app,
    dbCtx,
    queue,
    config,
    close: async () => {
      await app.close();
      await queue.close();
      await dbCtx.close();
    },
  };
}
