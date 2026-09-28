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
  /** D-06: interpretador do "Como estou". `rules` é local (padrão); `anthropic` ainda cai em `rules` (2d); `off` desliga o modo */
  AI_MODE: z.enum(['off', 'rules', 'anthropic']).default('rules'),

  TMDB_API_KEY: optionalSecret,
  SPOTIFY_CLIENT_ID: optionalSecret,
  SPOTIFY_CLIENT_SECRET: optionalSecret,
  META_OEMBED_ACCESS_TOKEN: optionalSecret,

  /** RF-20: mock = só gravações de fixtures (sem rede); record = APIs reais + grava em fixtures-private/ */
  PIPELINE_MODE: z.enum(['mock', 'live', 'record']).default('live'),
  /** RF-28: abaixo disto o candidato vai para a fila de revisão; abaixo do DISCARD, é descartado */
  REVIEW_THRESHOLD: z.coerce.number().min(0).max(1).default(0.5),
  DISCARD_THRESHOLD: z.coerce.number().min(0).max(1).default(0.15),
  /** RF-18/19: aceita o cabeçalho X-Fruiqo-Fixture (nunca em produção) */
  SANDBOX_ENABLED: bool,
  /** RF-17: origens do navegador aceitas por CORS (lista separada por vírgula; vazio = sem CORS). Sem credenciais: o web usa bearer em memória */
  WEB_ORIGIN: z
    .string()
    .default('')
    .transform((v) =>
      v
        .split(',')
        .map((o) => o.trim().replace(/\/+$/, ''))
        .filter(Boolean),
    )
    .pipe(z.array(z.url({ protocol: /^https?$/ }))),
  /** RNF-09: preço por milhão de tokens do modelo em uso (0 = desconhecido; custo estimado fica 0) */
  LLM_PRICE_IN_PER_MTOK: z.coerce.number().min(0).default(0),
  LLM_PRICE_OUT_PER_MTOK: z.coerce.number().min(0).default(0),
}).superRefine((env, ctx) => {
  // Fail-closed: gravação e respostas simuladas não existem em produção (RF-20).
  if (env.NODE_ENV === 'production' && env.PIPELINE_MODE !== 'live') {
    ctx.addIssue({ code: 'custom', path: ['PIPELINE_MODE'], message: 'só live em produção' });
  }
  if (env.NODE_ENV === 'production' && env.SANDBOX_ENABLED) {
    ctx.addIssue({ code: 'custom', path: ['SANDBOX_ENABLED'], message: 'sandbox desligado em produção' });
  }
  if (env.DISCARD_THRESHOLD > env.REVIEW_THRESHOLD) {
    ctx.addIssue({ code: 'custom', path: ['DISCARD_THRESHOLD'], message: 'deve ser ≤ REVIEW_THRESHOLD' });
  }
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
