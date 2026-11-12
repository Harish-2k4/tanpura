// Environment configuration, validated once at startup. Secrets live in backend/.env.
import { randomBytes } from 'node:crypto';
import { z } from 'zod';

// Tests set their own environment and must never pick up real keys from .env.
if (process.env.NODE_ENV !== 'test') {
  try {
    process.loadEnvFile('.env');
  } catch {
    // No .env file: defaults below, PayPal and AI in mock mode.
  }
}

// Treat blank values in .env (KEY=) as unset.
const optional = <T extends z.ZodType>(schema: T) => z.preprocess((v) => (v === '' ? undefined : v), schema.optional());

const env = z
  .object({
    NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
    PORT: z.coerce.number().int().min(1).max(65535).default(3001),
    DATA_DIR: z.string().min(1).default('data'),
    APP_EMAIL: optional(z.email()),
    APP_PASSWORD: optional(z.string().min(8)),
    SESSION_SECRET: optional(z.string().min(32)),
    DEMO_MODE: optional(z.enum(['true', 'false'])),
    DEMO_BUYER_EMAIL: optional(z.email()),
    PAYPAL_CLIENT_ID: optional(z.string()),
    PAYPAL_SECRET: optional(z.string()),
    PAYPAL_WEBHOOK_ID: optional(z.string()),
    AG_STUDIO_LICENSE: optional(z.string()),
    GEMINI_API_KEY: optional(z.string()),
    GEMINI_MODEL: optional(z.string()),
  })
  .parse(process.env);

const production = env.NODE_ENV === 'production';

function required(name: 'APP_EMAIL' | 'APP_PASSWORD' | 'SESSION_SECRET', devDefault: string): string {
  const value = env[name];
  if (value) return value;
  if (production) throw new Error(`${name} must be set in production`);
  if (env.NODE_ENV === 'development') console.warn(`[config] ${name} not set; using a development default`);
  return devDefault;
}

export const config = {
  env: env.NODE_ENV,
  production,
  port: env.PORT,
  dataDir: env.DATA_DIR,
  auth: {
    email: required('APP_EMAIL', 'teacher@tanpura.app').toLowerCase(),
    password: required('APP_PASSWORD', 'tanpura-demo'),
    // Without a fixed secret, sessions end when the server restarts.
    secret: required('SESSION_SECRET', randomBytes(32).toString('hex')),
  },
  // Demo mode shows the login on the sign-in page and allows resetting the demo data.
  demoMode: env.DEMO_MODE ? env.DEMO_MODE === 'true' : !production,
  // On the public demo (demo mode in production), each sign-in gets a private copy of the data.
  visitorCopies: production && env.DEMO_MODE === 'true',
  fxEnabled: env.NODE_ENV !== 'test', // tests stay offline
  demoBuyerEmail: env.DEMO_BUYER_EMAIL,
  paypal: env.PAYPAL_CLIENT_ID && env.PAYPAL_SECRET ? { clientId: env.PAYPAL_CLIENT_ID, secret: env.PAYPAL_SECRET } : undefined,
  paypalWebhookId: env.PAYPAL_WEBHOOK_ID,
  agStudioLicense: env.AG_STUDIO_LICENSE,
  gemini: env.GEMINI_API_KEY ? { apiKey: env.GEMINI_API_KEY, model: env.GEMINI_MODEL ?? 'gemini-3.8-flash' } : undefined,
};
