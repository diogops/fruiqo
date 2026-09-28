import { z } from 'zod';

const bool = z
  .enum(['true', 'false'])
  .default('false')
  .transform((v) => v === 'true');

const optionalSecret = z
  .string()
  .optional()
  .transform((v) => (v && v.trim() !== '' ? v.trim() : undefined));

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  HOST: z.string().default('0.0.0.0'),
  PORT: z.coerce.number().int().positive().default(4000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),

  DATABASE_URL: z.string().startsWith('postgres'),
  REDIS_URL: z.string().startsWith('redis'),

  JWT_SECRET: z.string().min(32),
  ACCESS_TOKEN_TTL_SECONDS: z.coerce.number().int().min(60).max(3600).default(900),
  /** requisições/minuto por IP nas rotas públicas de auth (lido direto pelo throttler) */
  AUTH_RATE_LIMIT_PER_MIN: z.coerce.number().int().min(1).default(10),

  REGISTRATION_ENABLED: bool,
  ALLOWED_EMAILS: z
    .string()
    .default('')
    .transform((v) =>
      v
        .split(',')
        .map((e) => e.trim().toLowerCase())
        .filter(Boolean),
    ),

  LLM_ENABLED: bool,
  LLM_REAL_CONTENT_ALLOWED: bool,
  LLM_MODEL: z.string().default('claude-opus-5'),
  LLM_DAILY_QUOTA: z.coerce.number().int().min(0).default(50),
  LLM_MAX_INPUT_CHARS: z.coerce.number().int().min(200).max(20_000).default(4000),
  ANTHROPIC_API_KEY: optionalSecret,

  TMDB_API_KEY: optionalSecret,
  SPOTIFY_CLIENT_ID: optionalSecret,
  SPOTIFY_CLIENT_SECRET: optionalSecret,
  META_OEMBED_ACCESS_TOKEN: optionalSecret,
});

export type Env = z.infer<typeof EnvSchema>;

let cached: Env | undefined;

/** Lê e valida o ambiente uma vez; falha na inicialização se algo estiver errado. */
export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  if (cached && source === process.env) return cached;
  const parsed = EnvSchema.safeParse(source);
  if (!parsed.success) {
    const fields = parsed.error.issues.map((i) => i.path.join('.')).join(', ');
    throw new Error(`Configuração inválida: ${fields}`);
  }
  if (source === process.env) cached = parsed.data;
  return parsed.data;
}

/** Só para testes: força reler o ambiente. */
export function resetEnvCache() {
  cached = undefined;
}

export const ENV = Symbol('ENV');
