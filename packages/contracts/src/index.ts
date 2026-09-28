// Contrato HTTP entre o app (apps/mobile) e a API (apps/api).
// Fonte única dos formatos de request/response; os dois lados validam com estes schemas.
import { z } from 'zod';

// ---------- Auth ----------

export const EmailSchema = z.email().max(254).transform((v) => v.trim().toLowerCase());
export const PasswordSchema = z.string().min(12).max(128);

export const RegisterRequestSchema = z.object({
  email: EmailSchema,
  password: PasswordSchema,
  deviceName: z.string().trim().min(1).max(64),
});
export type RegisterRequest = z.infer<typeof RegisterRequestSchema>;

export const LoginRequestSchema = RegisterRequestSchema;
export type LoginRequest = z.infer<typeof LoginRequestSchema>;

export const RefreshRequestSchema = z.object({
  refreshToken: z.string().min(32).max(256),
});
export type RefreshRequest = z.infer<typeof RefreshRequestSchema>;

export const TokenPairSchema = z.object({
  accessToken: z.string(),
  refreshToken: z.string(),
  /** segundos até o access token expirar */
  expiresIn: z.number().int().positive(),
});
export type TokenPair = z.infer<typeof TokenPairSchema>;

export const SessionSchema = z.object({
  id: z.uuid(),
  deviceName: z.string(),
  createdAt: z.iso.datetime(),
  lastUsedAt: z.iso.datetime(),
  current: z.boolean(),
});
export type Session = z.infer<typeof SessionSchema>;

// ---------- Shares ----------

export const PlatformSchema = z.enum(['youtube', 'instagram', 'tiktok', 'other']);
export type Platform = z.infer<typeof PlatformSchema>;

export const ShareStatusSchema = z.enum(['queued', 'processing', 'done', 'failed', 'rejected']);
export type ShareStatus = z.infer<typeof ShareStatusSchema>;

export const MAX_SCREENSHOT_PAGES = 10;

/**
 * O que o app recebeu do share sheet. Pelo teste §4.1 (device-tests-log.md),
 * YouTube entrega só a URL em `text`; o app manda o texto bruto e a URL extraída, se houver.
 * Prints de tela passam por OCR no device (TOS-REQ-21): só o texto de cada print vem em `pages`,
 * na ordem em que foram compartilhados; a imagem nunca sai do aparelho.
 */
export const CreateShareRequestSchema = z
  .object({
    /** gerado no device; torna o POST idempotente em retries */
    clientShareId: z.uuid(),
    text: z.string().max(5000).optional(),
    url: z.url({ protocol: /^https$/ }).max(2048).optional(),
    pages: z.array(z.string().trim().min(1).max(8000)).min(1).max(MAX_SCREENSHOT_PAGES).optional(),
  })
  .refine((v) => v.text !== undefined || v.url !== undefined || v.pages !== undefined, {
    message: 'text, url ou pages é obrigatório',
  });
export type CreateShareRequest = z.infer<typeof CreateShareRequestSchema>;

export const RecommendationKindSchema = z.enum([
  'movie',
  'series',
  'music_track',
  'music_album',
  'artist',
  'other',
]);
export type RecommendationKind = z.infer<typeof RecommendationKindSchema>;

export const ResolutionSchema = z.object({
  provider: z.enum(['tmdb', 'spotify']),
  externalId: z.string(),
  title: z.string(),
  /** link público de volta ao provedor (TOS-REQ-10) */
  url: z.url(),
  imageUrl: z.url().optional(),
  year: z.number().int().optional(),
  /** nomes dos provedores de streaming no Brasil (TMDB watch providers, RF-06) */
  watchProvidersBR: z.array(z.string()).optional(),
});
export type Resolution = z.infer<typeof ResolutionSchema>;

export const RecommendationSchema = z.object({
  id: z.uuid(),
  kind: RecommendationKindSchema,
  title: z.string(),
  creator: z.string().optional(),
  year: z.number().int().optional(),
  confidence: z.number().min(0).max(1),
  /** de onde veio: 'llm' ou 'heuristic' */
  extractor: z.enum(['llm', 'heuristic']),
  resolution: ResolutionSchema.optional(),
  /**
   * RF-19/RF-28: 'cataloged' entra no catálogo; 'review_queue' espera revisão (confiança baixa ou
   * sem correspondência). Candidatos 'discarded' não viram recomendação (ver GET /shares/:id/steps).
   */
  decision: z.enum(['cataloged', 'review_queue']).optional(),
});
export type Recommendation = z.infer<typeof RecommendationSchema>;

export const ShareSourceSchema = z.object({
  platform: PlatformSchema,
  /** 'screenshot' quando o conteúdo veio de prints (OCR no device) */
  origin: z.enum(['link', 'screenshot']),
  /** quantidade de prints recebidos, quando origin = screenshot */
  pageCount: z.number().int().min(1).optional(),
  url: z.url().optional(),
  title: z.string().optional(),
  author: z.string().optional(),
  thumbnailUrl: z.url().optional(),
});
export type ShareSource = z.infer<typeof ShareSourceSchema>;

export const ShareSchema = z.object({
  id: z.uuid(),
  status: ShareStatusSchema,
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
  source: ShareSourceSchema,
  /** mensagem curta e segura para o usuário quando status = failed/rejected */
  error: z.string().optional(),
  recommendations: z.array(RecommendationSchema),
  /**
   * Deduplicação (preenchida quando status = done):
   * - pagesIgnored: prints idênticos a um print já enviado antes por este usuário
   * - itemsAlreadyInList: recomendações que já existiam em outro share do usuário e não foram repetidas
   * Repetições entre prints do mesmo share (sobreposição de rolagem) são mescladas e não contam aqui.
   */
  dedup: z.object({
    pagesIgnored: z.number().int().min(0),
    itemsAlreadyInList: z.number().int().min(0),
  }),
});
export type Share = z.infer<typeof ShareSchema>;

export const ShareListResponseSchema = z.object({
  items: z.array(ShareSchema),
  nextCursor: z.string().nullable(),
});
export type ShareListResponse = z.infer<typeof ShareListResponseSchema>;

// ---------- Pipeline inspector (RF-19) ----------

export const PipelineModeSchema = z.enum(['mock', 'live', 'record']);
export type PipelineMode = z.infer<typeof PipelineModeSchema>;

export const PipelineStepNameSchema = z.enum([
  'normalize',
  'metadata',
  'ocr_input',
  'merge_pages',
  'noise_filter',
  'extract',
  'dedup',
  'resolve',
  'decide',
]);
export type PipelineStepName = z.infer<typeof PipelineStepNameSchema>;

/**
 * Resumos são JSON pequenos. Trechos de texto de terceiros ficam em campos `preview` (≤ 200
 * caracteres) e só são guardados em shares de fixture; nos shares reais saem antes de gravar.
 */
export const PipelineStepSchema = z.object({
  seq: z.number().int().min(0),
  step: PipelineStepNameSchema,
  mode: PipelineModeSchema,
  startedAt: z.iso.datetime(),
  durationMs: z.number().int().min(0),
  inputSummary: z.record(z.string(), z.unknown()),
  outputSummary: z.record(z.string(), z.unknown()),
  tokensIn: z.number().int().min(0),
  tokensOut: z.number().int().min(0),
  costEstimateUsd: z.number().min(0),
  error: z.string().optional(),
});
export type PipelineStep = z.infer<typeof PipelineStepSchema>;

export const CandidateDecisionValueSchema = z.enum(['cataloged', 'review_queue', 'discarded']);
export type CandidateDecisionValue = z.infer<typeof CandidateDecisionValueSchema>;

export const CandidateDecisionSchema = z.object({
  rawTitle: z.string(),
  kind: RecommendationKindSchema,
  confidenceScore: z.number().min(0).max(1),
  decision: CandidateDecisionValueSchema,
  reason: z.string(),
  /** recomendação criada (null quando descartado ou quando o item já estava na lista) */
  recommendationId: z.uuid().optional(),
});
export type CandidateDecision = z.infer<typeof CandidateDecisionSchema>;

export const ShareStepsResponseSchema = z.object({
  shareId: z.uuid(),
  isFixture: z.boolean(),
  steps: z.array(PipelineStepSchema),
  decisions: z.array(CandidateDecisionSchema),
});
export type ShareStepsResponse = z.infer<typeof ShareStepsResponseSchema>;

// ---------- Saída do LLM (validada no worker, fail-closed: SEC-REQ-05) ----------

export const LlmExtractionSchema = z
  .object({
    items: z
      .array(
        z
          .object({
            kind: RecommendationKindSchema,
            title: z.string().min(1).max(200),
            creator: z.string().max(200).optional(),
            year: z.number().int().min(1870).max(2100).optional(),
            confidence: z.number().min(0).max(1),
          })
          .strict(),
      )
      .max(20),
  })
  .strict();
export type LlmExtraction = z.infer<typeof LlmExtractionSchema>;

// ---------- Erros ----------

export const ApiErrorSchema = z.object({
  error: z.string(),
  message: z.string(),
});
export type ApiError = z.infer<typeof ApiErrorSchema>;
