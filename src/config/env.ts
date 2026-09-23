import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config();

const csv = (value: string): string[] =>
  value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),
  LOG_LEVEL: z.enum(['error', 'warn', 'info', 'debug']).default('info'),

  DATABASE_URL: z.string().min(1),

  JWT_SECRET: z.string().min(32, 'JWT_SECRET precisa de no mínimo 32 caracteres'),
  JWT_EXPIRES_IN: z.string().default('7d'),

  SESSION_COOKIE_NAME: z.string().default('cursos_auth_token'),
  SESSION_COOKIE_DOMAIN: z.string().optional(),

  WEB_PUBLIC_URL: z.string().url(),
  API_PUBLIC_URL: z.string().url(),
  CORS_ORIGINS: z.string().default(''),

  RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(900_000),
  RATE_LIMIT_MAX_REQUESTS: z.coerce.number().int().positive().default(100),
  REQUEST_LOG_SAMPLE_RATE: z.coerce.number().min(0).max(1).default(0.05),

  RESEND_API_KEY: z.string().optional(),
  RESEND_WEBHOOK_SECRET: z.string().optional(),
  EMAIL_FROM: z.string().email().default('noreply@purplevet.com.br'),
  EMAIL_FROM_NAME: z.string().default('PurpleVet Cursos'),
  ADMIN_EMAIL: z.string().email().optional().or(z.literal('')),

  FINPET_BASE_URL: z.string().optional(),
  FINPET_EVOLUSERVICES_BASE_URL: z.string().optional(),
  EVOLUSERVICES_BASE_URL: z.string().optional(),
  FINPET_MERCHANT_ID: z.string().optional(),
  FINPET_API_KEY: z.string().optional(),
  FINPET_CREDENTIAL: z.string().optional(),
  FINPET_PASSWORD: z.string().optional(),
  EVOLUSERVICES_CREDENTIAL: z.string().optional(),
  EVOLUSERVICES_PASSWORD: z.string().optional(),
  FINPET_PROVIDER_RETURN_BASE_URL: z.string().optional(),
  FINPET_WEBHOOK_SECRET: z.string().optional(),
  FINPET_WEBHOOK_AUTH_TOKEN: z.string().optional(),

  RECAPTCHA_SECRET_KEY: z.string().optional(),
  RECAPTCHA_SITE_KEY: z.string().optional(),

  AWS_REGION: z.string().default('sa-east-1'),
  AWS_ACCESS_KEY_ID: z.string().optional(),
  AWS_SECRET_ACCESS_KEY: z.string().optional(),
  AWS_S3_BUCKET: z.string().default('purple-vet-cursos'),
  AWS_S3_PREFIX: z.string().default(''),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  // Falha rápida no boot: variável faltando não pode virar erro em runtime.
  console.error('Variáveis de ambiente inválidas:', parsed.error.flatten().fieldErrors);
  process.exit(1);
}

const raw = parsed.data;

if (raw.NODE_ENV === 'production' && !raw.RECAPTCHA_SECRET_KEY) {
  console.error('RECAPTCHA_SECRET_KEY é obrigatória em produção');
  process.exit(1);
}

export const env = {
  nodeEnv: raw.NODE_ENV,
  isProduction: raw.NODE_ENV === 'production',
  isTest: raw.NODE_ENV === 'test',
  port: raw.PORT,
  logLevel: raw.LOG_LEVEL,

  database: {
    url: raw.DATABASE_URL,
  },

  jwt: {
    secret: raw.JWT_SECRET,
    expiresIn: raw.JWT_EXPIRES_IN,
  },

  session: {
    cookieName: raw.SESSION_COOKIE_NAME,
    cookieDomain: raw.SESSION_COOKIE_DOMAIN || undefined,
  },

  urls: {
    web: raw.WEB_PUBLIC_URL.replace(/\/$/, ''),
    api: raw.API_PUBLIC_URL.replace(/\/$/, ''),
  },

  cors: {
    origins: csv(raw.CORS_ORIGINS),
  },

  rateLimit: {
    windowMs: raw.RATE_LIMIT_WINDOW_MS,
    maxRequests: raw.RATE_LIMIT_MAX_REQUESTS,
  },

  observability: {
    requestLogSampleRate: raw.REQUEST_LOG_SAMPLE_RATE,
  },

  email: {
    apiKey: raw.RESEND_API_KEY,
    webhookSecret: raw.RESEND_WEBHOOK_SECRET,
    from: raw.EMAIL_FROM,
    fromName: raw.EMAIL_FROM_NAME,
    adminEmail: raw.ADMIN_EMAIL || undefined,
    isConfigured: Boolean(raw.RESEND_API_KEY),
  },

  payments: {
    baseUrl: raw.FINPET_EVOLUSERVICES_BASE_URL || raw.EVOLUSERVICES_BASE_URL || raw.FINPET_BASE_URL,
    merchantId: raw.FINPET_MERCHANT_ID,
    apiKey: raw.FINPET_API_KEY,
    credential: raw.FINPET_CREDENTIAL || raw.EVOLUSERVICES_CREDENTIAL,
    password: raw.FINPET_PASSWORD || raw.EVOLUSERVICES_PASSWORD,
    providerReturnBaseUrl: raw.FINPET_PROVIDER_RETURN_BASE_URL,
    webhookSecret: raw.FINPET_WEBHOOK_SECRET,
    webhookAuthToken: raw.FINPET_WEBHOOK_AUTH_TOKEN,
    isConfigured: Boolean(
      (raw.FINPET_EVOLUSERVICES_BASE_URL || raw.EVOLUSERVICES_BASE_URL || raw.FINPET_BASE_URL) &&
        raw.FINPET_MERCHANT_ID &&
        (raw.FINPET_CREDENTIAL || raw.EVOLUSERVICES_CREDENTIAL || raw.FINPET_API_KEY) &&
        (raw.FINPET_PASSWORD || raw.EVOLUSERVICES_PASSWORD || raw.FINPET_API_KEY)
    ),
  },

  captcha: {
    secretKey: raw.RECAPTCHA_SECRET_KEY || '',
    siteKey: raw.RECAPTCHA_SITE_KEY || '',
    isConfigured: Boolean(raw.RECAPTCHA_SECRET_KEY),
  },

  storage: {
    region: raw.AWS_REGION,
    bucket: raw.AWS_S3_BUCKET,
    prefix: raw.AWS_S3_PREFIX.replace(/^\/+|\/+$/g, ''),
    accessKeyId: raw.AWS_ACCESS_KEY_ID,
    secretAccessKey: raw.AWS_SECRET_ACCESS_KEY,
    isConfigured: Boolean(raw.AWS_ACCESS_KEY_ID && raw.AWS_SECRET_ACCESS_KEY),
  },
} as const;

export type Env = typeof env;
