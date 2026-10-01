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
  /**
   * D-06: interpretador do "Como estou". `rules` é local (padrão); `anthropic` usa o LLM só com
   * ANTHROPIC_API_KEY (sem chave, continua nas regras); `off` desliga o modo.
   */
  AI_MODE: z.enum(['off', 'rules', 'anthropic']).default('rules'),
  /** RNF-09: modelo pequeno para interpretar o humor (a extração de conteúdo usa LLM_MODEL) */
  AI_MODEL: z.string().default('claude-haiku-4-5'),
  AI_MAX_INPUT_CHARS: z.coerce.number().int().min(50).max(4000).default(1000),
  AI_DAILY_QUOTA: z.coerce.number().int().min(0).default(100),
  /**
   * D-24: o texto lido de um print (OCR no aparelho/navegador, nunca a imagem) pode ir à IA para
   * separar os títulos de verdade. Só em SC-PERSONAL e com o consentimento do usuário.
   */
  AI_OCR_TEXT_ALLOWED: bool,
  /** preço por milhão de tokens do AI_MODEL (padrão: Haiku 4.5, US$ 1 / US$ 5) */
  AI_PRICE_IN_PER_MTOK: z.coerce.number().min(0).default(1),
  AI_PRICE_OUT_PER_MTOK: z.coerce.number().min(0).default(5),

  TMDB_API_KEY: optionalSecret,
  /** RF-48: contato no User-Agent da Open Library (TOS-REQ-60); contato do projeto, não pessoal */
  OPENLIBRARY_CONTACT: z.string().trim().max(200).optional(),
  /**
   * D-07 / C-15: com o TMDB ativo, qualquer IA fica proibida até o TMDB confirmar por escrito que
   * um app com recursos de IA pode usar a API (ver docs/phase0/tmdb-consulta-C15.md). Só defina
   * `confirmed` depois dessa resposta.
   */
  TMDB_AI_CLEARANCE: z.enum(['pending', 'confirmed']).default('pending'),
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
  /** RF-17/RF-30: origens do navegador aceitas por CORS e pelo fluxo de cookie do sistema web (lista separada por vírgula; vazio = sem CORS e sem login web) */
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
  /**
   * RF-30/D-19: caminho do cookie de refresh do web. Local = /auth (API direta). Em produção o
   * navegador vê a API sob /api do domínio da Vercel (rewrite), então o cookie precisa de /api/auth.
   */
  WEB_COOKIE_PATH: z.string().regex(/^\/[A-Za-z0-9/_-]*$/, 'caminho absoluto').default('/auth'),
  /**
   * Quantos proxies à frente da API são confiáveis para o X-Forwarded-For (0 = nenhum, dev local).
   * Railway = 1 (edge do Railway). Não some a Vercel: a API também é acessível direto pelo domínio do
   * Railway (app mobile), e confiar num 2º salto deixaria o cliente forjar o IP pelo X-Forwarded-For.
   */
  TRUST_PROXY_HOPS: z.coerce.number().int().min(0).max(5).default(0),
  /** RNF-09: preço por milhão de tokens do modelo em uso (0 = desconhecido; custo estimado fica 0) */
  LLM_PRICE_IN_PER_MTOK: z.coerce.number().min(0).default(0),
  LLM_PRICE_OUT_PER_MTOK: z.coerce.number().min(0).default(0),
}).superRefine((env, ctx) => {
  // Fail-closed: gravação e respostas simuladas não existem em produção (RF-20).
  if (env.NODE_ENV === 'production' && env.PIPELINE_MODE !== 'live') {
    ctx.addIssue({ code: 'custom', path: ['PIPELINE_MODE'], message: 'só live em produção' });
  }
  // SEC-CTRL-49: em produção o sistema web só pode vir de origem https (cookie Secure).
  if (env.NODE_ENV === 'production' && env.WEB_ORIGIN.some((o) => !o.startsWith('https://'))) {
    ctx.addIssue({ code: 'custom', path: ['WEB_ORIGIN'], message: 'só origens https em produção' });
  }
  if (env.NODE_ENV === 'production' && env.SANDBOX_ENABLED) {
    ctx.addIssue({ code: 'custom', path: ['SANDBOX_ENABLED'], message: 'sandbox desligado em produção' });
  }
  // D-07 (fail-closed): TMDB ativo + qualquer caminho de LLM ligado só com liberação explícita.
  if (tmdbActive(env) && anyAiEnabled(env) && env.TMDB_AI_CLEARANCE !== 'confirmed') {
    ctx.addIssue({
      code: 'custom',
      path: ['TMDB_AI_CLEARANCE'],
      message:
        'D-07/C-15: TMDB ativo com IA ligada (LLM_ENABLED ou AI_MODE=anthropic). Desligue a IA ou, só após a resposta escrita do TMDB, defina TMDB_AI_CLEARANCE=confirmed (docs/phase0/tmdb-consulta-C15.md)',
    });
  }
  if (env.DISCARD_THRESHOLD > env.REVIEW_THRESHOLD) {
    ctx.addIssue({ code: 'custom', path: ['DISCARD_THRESHOLD'], message: 'deve ser ≤ REVIEW_THRESHOLD' });
  }
});

export type Env = z.infer<typeof EnvSchema>;

type AiFlags = Pick<Env, 'LLM_ENABLED' | 'AI_MODE'>;
type TmdbFlags = Pick<Env, 'TMDB_API_KEY' | 'PIPELINE_MODE'>;

/** TMDB em uso de verdade (fora do mock, que só lê gravações sintéticas). */
export function tmdbActive(env: TmdbFlags): boolean {
  return Boolean(env.TMDB_API_KEY) && env.PIPELINE_MODE !== 'mock';
}

/** Algum caminho de LLM ligado por configuração (extração ou "Como estou"). */
export function anyAiEnabled(env: AiFlags): boolean {
  return env.LLM_ENABLED || env.AI_MODE === 'anthropic';
}

let cached: Env | undefined;

/** Lê e valida o ambiente uma vez; falha na inicialização se algo estiver errado. */
export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  if (cached && source === process.env) return cached;
  const parsed = EnvSchema.safeParse(source);
  if (!parsed.success) {
    // só nomes de campo e mensagens próprias (nunca valores, que podem ser segredos)
    const issues = parsed.error.issues.map((i) =>
      i.code === 'custom' ? `${i.path.join('.')} (${i.message})` : i.path.join('.'),
    );
    throw new Error(`Configuração inválida: ${issues.join(', ')}`);
  }
  if (source === process.env) cached = parsed.data;
  return parsed.data;
}

/** Só para testes: força reler o ambiente. */
export function resetEnvCache() {
  cached = undefined;
}

export const ENV = Symbol('ENV');
