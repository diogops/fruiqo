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

// ---------- Catálogo, listas e home (RF-24/26/31..37) ----------
// Chaves de gênero/subgênero/intenção vêm de `@fruiqo/taxonomy` (validadas na API). Aqui ficam como
// string para o contrato não depender do pacote de taxonomia (o app só exibe `label`).

export const TitleStatusSchema = z.enum(['to_watch', 'watching', 'watched', 'dropped']);
export type TitleStatus = z.infer<typeof TitleStatusSchema>;

/** 0 baixa · 1 normal · 2 alta · 3 urgente */
export const TitlePrioritySchema = z.number().int().min(0).max(3);

export const EnrichmentSchema = z.enum(['none', 'tmdb', 'demo', 'manual']);
export type Enrichment = z.infer<typeof EnrichmentSchema>;

export const TaxonomyTagSchema = z.object({ key: z.string(), label: z.string() });
export type TaxonomyTag = z.infer<typeof TaxonomyTagSchema>;

export const TitleListRefSchema = z.object({ id: z.uuid(), name: z.string() });

/** Item do catálogo do usuário (é a recomendação catalogada, com o estado de consumo). */
export const TitleSchema = z.object({
  id: z.uuid(),
  kind: RecommendationKindSchema,
  title: z.string(),
  creator: z.string().optional(),
  year: z.number().int().optional(),
  status: TitleStatusSchema,
  priority: TitlePrioritySchema,
  rating: z.number().int().min(1).max(5).optional(),
  notes: z.string().optional(),
  genres: z.array(TaxonomyTagSchema),
  /** derivados dos gêneros pela regra R da taxonomia */
  subgenres: z.array(TaxonomyTagSchema),
  runtimeMin: z.number().int().optional(),
  enrichment: EnrichmentSchema,
  decision: z.enum(['cataloged', 'review_queue']),
  confidence: z.number().min(0).max(1),
  extractor: z.enum(['llm', 'heuristic']),
  resolution: ResolutionSchema.optional(),
  /** share de origem; null em título do seed/adição manual */
  shareId: z.uuid().nullable(),
  lists: z.array(TitleListRefSchema),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export type Title = z.infer<typeof TitleSchema>;

export const LibrarySortSchema = z.enum(['priority', 'recent', 'title']);

/** Query string de GET /library (valores chegam como string). */
export const LibraryQuerySchema = z.object({
  status: TitleStatusSchema.optional(),
  kind: RecommendationKindSchema.optional(),
  genre: z.string().max(32).optional(),
  listId: z.uuid().optional(),
  q: z.string().trim().min(1).max(100).optional(),
  sort: LibrarySortSchema.default('priority'),
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
export type LibraryQuery = z.infer<typeof LibraryQuerySchema>;

export const LibraryResponseSchema = z.object({
  items: z.array(TitleSchema),
  nextCursor: z.string().nullable(),
});
export type LibraryResponse = z.infer<typeof LibraryResponseSchema>;

export const UpdateTitleRequestSchema = z
  .object({
    title: z.string().trim().min(1).max(200).optional(),
    kind: RecommendationKindSchema.optional(),
    year: z.number().int().min(1870).max(2100).nullable().optional(),
    creator: z.string().trim().max(200).nullable().optional(),
    status: TitleStatusSchema.optional(),
    priority: TitlePrioritySchema.optional(),
    rating: z.number().int().min(1).max(5).nullable().optional(),
    notes: z.string().max(500).nullable().optional(),
    /** gêneros manuais (chaves da taxonomia); marca `enrichment = manual` */
    genres: z.array(z.string().max(32)).max(6).optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, { message: 'nada para alterar' });
export type UpdateTitleRequest = z.infer<typeof UpdateTitleRequestSchema>;

/** 409 de PATCH /library/:id quando o novo título/tipo colide com outro item do usuário. */
export const TitleConflictErrorSchema = z.object({
  error: z.literal('conflict'),
  message: z.string(),
  conflictWith: z.uuid(),
});
export type TitleConflictError = z.infer<typeof TitleConflictErrorSchema>;

export const ListSummarySchema = z.object({
  id: z.uuid(),
  name: z.string(),
  /** share de prints que gerou a lista automaticamente */
  sourceShareId: z.uuid().nullable(),
  pinned: z.boolean(),
  itemCount: z.number().int().min(0),
  /** assistidos + abandonados (contam como resolvidos no progresso) */
  doneCount: z.number().int().min(0),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export type ListSummary = z.infer<typeof ListSummarySchema>;

export const ListDetailSchema = ListSummarySchema.extend({ items: z.array(TitleSchema) });
export type ListDetail = z.infer<typeof ListDetailSchema>;

export const CreateListRequestSchema = z
  .object({
    name: z.string().trim().min(1).max(80),
    titleIds: z.array(z.uuid()).max(500).optional(),
  })
  .strict();
export type CreateListRequest = z.infer<typeof CreateListRequestSchema>;

export const ReorderListRequestSchema = z.object({ titleIds: z.array(z.uuid()).max(500) }).strict();
export type ReorderListRequest = z.infer<typeof ReorderListRequestSchema>;

export const HomeContinueSchema = z.object({
  list: ListSummarySchema,
  next: TitleSchema,
  progress: z.object({ done: z.number().int().min(0), total: z.number().int().min(1) }),
});
export type HomeContinue = z.infer<typeof HomeContinueSchema>;

export const HomePresetSchema = z.object({
  key: z.string(),
  label: z.string(),
  kind: z.enum(['subgenre', 'genre']),
  /** quantos títulos "para ver" da biblioteca combinam com o preset */
  available: z.number().int().min(0),
});
export type HomePreset = z.infer<typeof HomePresetSchema>;

export const AiModeSchema = z.enum(['off', 'rules', 'anthropic']);
export type AiMode = z.infer<typeof AiModeSchema>;

export const HomeResponseSchema = z.object({
  continue: HomeContinueSchema.nullable(),
  presets: z.array(HomePresetSchema),
  stats: z.object({
    toWatch: z.number().int().min(0),
    watching: z.number().int().min(0),
    watched: z.number().int().min(0),
    total: z.number().int().min(0),
    withoutGenre: z.number().int().min(0),
  }),
  /** modo do interpretador do "Como estou" (`off` = modo desabilitado) */
  aiMode: AiModeSchema,
});
export type HomeResponse = z.infer<typeof HomeResponseSchema>;

export const DiscoverKindSchema = z.enum(['movie', 'series', 'music']);

export const DiscoverRequestSchema = z.discriminatedUnion('mode', [
  z
    .object({
      mode: z.literal('surprise'),
      /** chave de subgênero OU de gênero da taxonomia */
      subgenre: z.string().max(32).optional(),
      genre: z.string().max(32).optional(),
      kinds: z.array(DiscoverKindSchema).max(3).optional(),
    })
    .strict()
    .refine((v) => Boolean(v.subgenre) !== Boolean(v.genre), { message: 'informe subgenre ou genre' }),
  z
    .object({
      mode: z.literal('mood'),
      /** texto do "Como estou" (RNF-06): nunca é persistido nem logado; só a intenção estruturada */
      text: z.string().trim().min(1).max(500),
      /** o usuário viu o acolhimento de risco (RNF-07) e escolheu continuar */
      continueAfterRisk: z.boolean().optional(),
      kinds: z.array(DiscoverKindSchema).max(3).optional(),
    })
    .strict(),
]);
export type DiscoverRequest = z.infer<typeof DiscoverRequestSchema>;

/** Intenção estruturada (espelho de MoodIntent da taxonomia; sem o texto do usuário). */
export const MoodIntentViewSchema = z.object({
  need: z.string(),
  needLabel: z.string(),
  avoid: z.array(z.string()),
  tone: z.array(z.string()),
  energy: z.string(),
  kinds: z.array(z.string()),
  maxRuntimeMin: z.number().int().optional(),
  message: z.string().optional(),
});
export type MoodIntentView = z.infer<typeof MoodIntentViewSchema>;

export const SuggestionSchema = z.object({
  title: TitleSchema,
  score: z.number(),
  /** "por que isso" (RF-36), gerado localmente a partir dos fatores do ranking */
  reason: z.string(),
  /** RF-35: por enquanto só a biblioteca do usuário; descoberta externa depende da Fase 0 */
  source: z.literal('library'),
});
export type Suggestion = z.infer<typeof SuggestionSchema>;

export const RiskSupportSchema = z.object({
  title: z.string(),
  message: z.string(),
  cvvPhone: z.string(),
  cvvUrl: z.url(),
  emergencyPhone: z.string(),
  continueLabel: z.string(),
});
export type RiskSupport = z.infer<typeof RiskSupportSchema>;

export const DiscoverResponseSchema = z.object({
  runId: z.uuid(),
  mode: z.enum(['surprise', 'mood']),
  aiMode: AiModeSchema,
  intent: MoodIntentViewSchema.nullable(),
  surprise: z.object({ key: z.string(), label: z.string(), kind: z.enum(['subgenre', 'genre']) }).nullable(),
  /** RNF-07: quando presente, `suggestions` vem vazio até o usuário escolher continuar */
  risk: RiskSupportSchema.nullable(),
  suggestions: z.array(SuggestionSchema),
  /** frase curta de abertura do resultado */
  message: z.string().optional(),
});
export type DiscoverResponse = z.infer<typeof DiscoverResponseSchema>;

export const FeedbackActionSchema = z.enum(['accept', 'skip', 'another']);
export type FeedbackAction = z.infer<typeof FeedbackActionSchema>;

export const FeedbackRequestSchema = z
  .object({
    runId: z.uuid(),
    titleId: z.uuid(),
    action: FeedbackActionSchema,
    /** motivo em uma palavra (RF-37); chaves da taxonomia (`too_heavy`, `seen_it`…) */
    reasonTag: z.string().max(32).optional(),
    reasonText: z.string().trim().max(30).optional(),
  })
  .strict();
export type FeedbackRequest = z.infer<typeof FeedbackRequestSchema>;

export const FeedbackResponseSchema = z.object({ next: SuggestionSchema.nullable() });
export type FeedbackResponse = z.infer<typeof FeedbackResponseSchema>;

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

// ---------- Taxonomia (GET /taxonomy/genres) ----------

export const TaxonomyEntrySchema = z.object({
  key: z.string(),
  /** rótulo pt-BR */
  label: z.string(),
});
export type TaxonomyEntry = z.infer<typeof TaxonomyEntrySchema>;

/** Gêneros e subgêneros válidos (versão da taxonomia própria, docs/spec/taxonomy-v1.md). */
export const TaxonomyResponseSchema = z.object({
  version: z.number().int().min(1),
  genres: z.array(TaxonomyEntrySchema),
  subgenres: z.array(TaxonomyEntrySchema),
});
export type TaxonomyResponse = z.infer<typeof TaxonomyResponseSchema>;
