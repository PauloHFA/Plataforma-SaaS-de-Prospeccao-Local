export interface AppConfig {
  port: number;
  host: string;
  appUrl: string;
  apiUrl: string;
  previewBaseDomain: string;
  platformCnameTarget: string;
  platformPublicIp: string;
  jwtSecret: string;
  encryptionMasterKey: string;
  sandboxWebhookSecret: string;
  stripeWebhookSecret: string;
  asaasWebhookToken: string;
  embedWorkers: boolean;
  businessHoursEnforce: boolean;
  localStorageDir: string;
}

export function loadConfig(): AppConfig {
  const jwtSecret =
    process.env.JWT_SECRET || 'dev-super-secret-jwt-key-change-in-production-32chars';
  const encryptionMasterKey =
    process.env.ENCRYPTION_MASTER_KEY ||
    '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

  if (process.env.NODE_ENV === 'production' && process.env.ALLOW_DEV_SECRETS !== 'true') {
    if (jwtSecret.includes('dev-super-secret') || jwtSecret.length < 24) {
      throw new Error('JWT_SECRET inseguro ou padrão detectado em ambiente de produção.');
    }
    if (
      encryptionMasterKey ===
      '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'
    ) {
      throw new Error('ENCRYPTION_MASTER_KEY padrão detectada em ambiente de produção.');
    }
  }

  return {
    port: Number(process.env.PORT || 4000),
    host: process.env.HOST || '0.0.0.0',
    appUrl: (process.env.APP_URL || 'http://localhost:3000').replace(/\/$/, ''),
    apiUrl: (process.env.API_URL || 'http://localhost:4000').replace(/\/$/, ''),
    previewBaseDomain: process.env.PREVIEW_BASE_DOMAIN || 'preview.localhost',
    platformCnameTarget: process.env.PLATFORM_CNAME_TARGET || 'sites.plataforma.com.br',
    platformPublicIp: process.env.PLATFORM_PUBLIC_IP || '203.0.113.10',
    jwtSecret,
    encryptionMasterKey,
    sandboxWebhookSecret:
      process.env.SANDBOX_WEBHOOK_SECRET || 'sandbox-hmac-secret-dev-key',
    stripeWebhookSecret: process.env.STRIPE_WEBHOOK_SECRET || '',
    asaasWebhookToken: process.env.ASAAS_WEBHOOK_TOKEN || '',
    embedWorkers: process.env.EMBED_WORKERS !== 'false',
    businessHoursEnforce: process.env.BUSINESS_HOURS_ENFORCE !== 'false',
    localStorageDir: process.env.LOCAL_STORAGE_DIR || './data/uploads',
  };
}
