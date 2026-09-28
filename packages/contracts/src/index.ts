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
  // ---- enriquecimento TMDB (2d). Dados do TMDB: TTL de 180 dias (TOS-REQ-02); nunca vão ao LLM (ARB-REQ-02) ----
  tmdbId: z.number().int().optional(),
  mediaType: z.enum(['movie', 'tv']).optional(),
  /** só guardado (link do IMDb ainda não é exibido: pendência do usuário) */
  imdbId: z.string().max(20).optional(),
  overview: z.string().max(4000).optional(),
  runtimeMin: z.number().int().optional(),
  /** IDs de gênero do TMDB, convertidos para a taxonomia própria no servidor */
  genreIds: z.array(z.number().int()).optional(),
  /** disponibilidade BR detalhada (fonte: TMDB, dados da JustWatch) */
  providers: z.array(z.lazy(() => WatchProviderSchema)).optional(),
  /** página pública "onde assistir" do TMDB (sem deep link para os apps de streaming, TOS-REQ-17) */
  watchUrl: z.url().optional(),
});
export type Resolution = z.infer<typeof ResolutionSchema>;

export const WatchProviderTypeSchema = z.enum(['flatrate', 'rent', 'buy']);
export const WatchProviderSchema = z.object({
  name: z.string(),
  /** chave própria quando o serviço está na lista de assinaturas (RF-38) */
  key: z.string().optional(),
  logoUrl: z.url().optional(),
  type: WatchProviderTypeSchema,
});
export type WatchProvider = z.infer<typeof WatchProviderSchema>;

/** Atribuições exigidas onde houver dado do TMDB (TOS-REQ-01) e de disponibilidade (JustWatch via TMDB). */
export const TMDB_ATTRIBUTION = 'This product uses the TMDB API but is not endorsed or certified by TMDB.';
export const JUSTWATCH_ATTRIBUTION = 'Dados de disponibilidade: JustWatch';

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

/**
 * Posição do título na fila de prioridade do usuário: 1 = mais prioritário. Única e contínua
 * (1..N) entre os títulos catalogados; itens da fila de revisão não têm posição (null).
 */
export const TitleRankSchema = z.number().int().min(1);

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
  rank: TitleRankSchema.nullable(),
  rating: z.number().int().min(1).max(5).optional(),
  notes: z.string().optional(),
  genres: z.array(TaxonomyTagSchema),
  /** derivados dos gêneros pela regra R da taxonomia */
  subgenres: z.array(TaxonomyTagSchema),
  runtimeMin: z.number().int().optional(),
  enrichment: EnrichmentSchema,
  /** 2d: dados do TMDB para exibir (derivados de `resolution`) */
  posterUrl: z.url().optional(),
  overview: z.string().optional(),
  watchProvidersBR: z.array(WatchProviderSchema).optional(),
  watchUrl: z.url().optional(),
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

/** POST /library/:id/enrich (2d): resultado do enriquecimento TMDB sob demanda. */
export const EnrichResponseSchema = z.object({
  status: z.enum(['enriched', 'no_match', 'unsupported', 'unavailable']),
  title: TitleSchema,
});
export type EnrichResponse = z.infer<typeof EnrichResponseSchema>;

export const LibrarySortSchema = z.enum(['rank', 'recent', 'title']);

/** Query string de GET /library (valores chegam como string). */
export const LibraryQuerySchema = z.object({
  status: TitleStatusSchema.optional(),
  kind: RecommendationKindSchema.optional(),
  genre: z.string().max(32).optional(),
  listId: z.uuid().optional(),
  /** RF-24 (fonte): títulos que vieram deste share */
  shareId: z.uuid().optional(),
  /** `pending`: itens da fila de revisão (RF-28) em vez do catálogo */
  review: z.enum(['pending']).optional(),
  q: z.string().trim().min(1).max(100).optional(),
  sort: LibrarySortSchema.default('rank'),
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
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
  /** RF-27: correção que colide sugere mesclar (`POST /library/:id/merge`) */
  suggestion: z.literal('merge').optional(),
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
  /** RF-38: ex. "Disponível na Netflix, que você assina" */
  availability: z.string().optional(),
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
  /** quem interpretou o "Como estou" nesta execução (anthropic cai para rules em qualquer falha) */
  interpreter: z.enum(['rules', 'anthropic']).optional(),
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

// ---------- Fase 2c: sistema web (RF-24..RF-30) ----------

/** RF-30: o sistema web se identifica por este cabeçalho (também protege o refresh por cookie contra CSRF). */
export const WEB_CLIENT_HEADER = 'X-Fruiqo-Client';
export const WEB_CLIENT_VALUE = 'web';
/** Cookie httpOnly do refresh token do web (Path=/auth, SameSite=Strict). */
export const WEB_REFRESH_COOKIE = 'fruiqo_rt';

/** Resposta de login/registro/refresh do web: o refresh vai só no cookie, nunca no corpo. */
export const WebSessionResponseSchema = TokenPairSchema.omit({ refreshToken: true });
export type WebSessionResponse = z.infer<typeof WebSessionResponseSchema>;

// RF-24: adicionar título manualmente
export const CreateTitleRequestSchema = z
  .object({
    title: z.string().trim().min(1).max(200),
    kind: RecommendationKindSchema,
    year: z.number().int().min(1870).max(2100).optional(),
    creator: z.string().trim().max(200).optional(),
    genres: z.array(z.string().max(32)).max(6).optional(),
    status: TitleStatusSchema.optional(),
    listId: z.uuid().optional(),
  })
  .strict();
export type CreateTitleRequest = z.infer<typeof CreateTitleRequestSchema>;

// RF-25: edição em massa (transacional) com desfazer
export const BulkOperationSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('add_to_list'), listId: z.uuid() }).strict(),
  z.object({ type: z.literal('remove_from_list'), listId: z.uuid() }).strict(),
  z.object({ type: z.literal('move_to_list'), fromListId: z.uuid(), toListId: z.uuid() }).strict(),
  z.object({ type: z.literal('add_genres'), genres: z.array(z.string().max(32)).min(1).max(6) }).strict(),
  z.object({ type: z.literal('remove_genres'), genres: z.array(z.string().max(32)).min(1).max(6) }).strict(),
  /** leva os selecionados para o topo/fundo da fila, preservando a ordem relativa entre eles */
  z.object({ type: z.literal('move_top') }).strict(),
  z.object({ type: z.literal('move_bottom') }).strict(),
  z.object({ type: z.literal('set_status'), status: TitleStatusSchema }).strict(),
  z.object({ type: z.literal('delete') }).strict(),
]);
export type BulkOperation = z.infer<typeof BulkOperationSchema>;

/** POST /library/:id/move: reordena a fila de prioridade (transacional, sem buracos). */
export const MoveTitleRequestSchema = z.union([
  z.object({ to: z.enum(['top', 'bottom', 'up', 'down']) }).strict(),
  /** 1 = topo; posições além do fim vão para o fim */
  z.object({ position: z.number().int().min(1) }).strict(),
]);
export type MoveTitleRequest = z.infer<typeof MoveTitleRequestSchema>;

export const MoveTitleResponseSchema = z.object({
  id: z.uuid(),
  rank: TitleRankSchema,
  /** total de títulos na fila (para "#N de M") */
  total: z.number().int().min(1),
});
export type MoveTitleResponse = z.infer<typeof MoveTitleResponseSchema>;

export const BulkRequestSchema = z
  .object({ titleIds: z.array(z.uuid()).min(1).max(1000), operation: BulkOperationSchema })
  .strict();
export type BulkRequest = z.infer<typeof BulkRequestSchema>;

export const BulkResponseSchema = z.object({
  affected: z.number().int().min(0),
  /** use em POST /library/bulk/undo antes de `undoExpiresAt` (uso único) */
  undoToken: z.uuid(),
  undoExpiresAt: z.iso.datetime(),
});
export type BulkResponse = z.infer<typeof BulkResponseSchema>;

export const BulkUndoRequestSchema = z.object({ undoToken: z.uuid() }).strict();
export type BulkUndoRequest = z.infer<typeof BulkUndoRequestSchema>;
export const BulkUndoResponseSchema = z.object({ restored: z.number().int().min(0) });
export type BulkUndoResponse = z.infer<typeof BulkUndoResponseSchema>;

// RF-26: listas
export const UpdateListRequestSchema = z
  .object({ name: z.string().trim().min(1).max(80).optional(), pinned: z.boolean().optional() })
  .strict()
  .refine((v) => Object.keys(v).length > 0, { message: 'nada para alterar' });
export type UpdateListRequest = z.infer<typeof UpdateListRequestSchema>;

export const DuplicateListRequestSchema = z.object({ name: z.string().trim().min(1).max(80).optional() }).strict();
export type DuplicateListRequest = z.infer<typeof DuplicateListRequestSchema>;

// RF-27: correção de match / título (grava review_actions)
export const CorrectTitleRequestSchema = z
  .object({
    title: z.string().trim().min(1).max(200).optional(),
    kind: RecommendationKindSchema.optional(),
    year: z.number().int().min(1870).max(2100).nullable().optional(),
    creator: z.string().trim().max(200).nullable().optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, { message: 'nada para corrigir' });
export type CorrectTitleRequest = z.infer<typeof CorrectTitleRequestSchema>;

export const MergeTitleRequestSchema = z.object({ intoId: z.uuid() }).strict();
export type MergeTitleRequest = z.infer<typeof MergeTitleRequestSchema>;

// RF-19/RF-27: activity log
export const ActivityItemSchema = z.object({
  shareId: z.uuid(),
  status: ShareStatusSchema,
  origin: z.enum(['link', 'screenshot']),
  platform: PlatformSchema,
  sourceTitle: z.string().optional(),
  sourceUrl: z.string().optional(),
  pageCount: z.number().int().optional(),
  isFixture: z.boolean(),
  error: z.string().optional(),
  dedup: z.object({ pagesIgnored: z.number().int().min(0), itemsAlreadyInList: z.number().int().min(0) }),
  counts: z.object({
    cataloged: z.number().int().min(0),
    review: z.number().int().min(0),
    discarded: z.number().int().min(0),
  }),
  steps: z.array(z.object({ step: z.string(), durationMs: z.number().int().min(0), error: z.string().optional() })),
  durationMs: z.number().int().min(0),
  costEstimateUsd: z.number().min(0),
  createdAt: z.iso.datetime(),
});
export type ActivityItem = z.infer<typeof ActivityItemSchema>;
export const ActivityResponseSchema = z.object({ items: z.array(ActivityItemSchema), nextCursor: z.string().nullable() });
export type ActivityResponse = z.infer<typeof ActivityResponseSchema>;

// RF-28: fila de revisão
export const ReviewItemSchema = z.object({
  title: TitleSchema,
  candidate: z
    .object({ rawTitle: z.string(), confidenceScore: z.number().min(0).max(1), reason: z.string() })
    .nullable(),
  share: z
    .object({ id: z.uuid(), platform: PlatformSchema, origin: z.enum(['link', 'screenshot']), sourceTitle: z.string().optional() })
    .nullable(),
});
export type ReviewItem = z.infer<typeof ReviewItemSchema>;
export const ReviewListResponseSchema = z.object({ items: z.array(ReviewItemSchema) });
export type ReviewListResponse = z.infer<typeof ReviewListResponseSchema>;
/** rematch = corrigir título/ano/tipo e aprovar */
export const ReviewRematchRequestSchema = CorrectTitleRequestSchema;
export type ReviewRematchRequest = z.infer<typeof ReviewRematchRequestSchema>;

// RF-29 / RNF-10: perfil de gosto transparente e editável
export const TasteEntrySchema = z.object({
  key: z.string(),
  label: z.string(),
  /** -1..1 (0 = neutro) */
  score: z.number(),
  /** de onde vem o valor: sinais do usuário ou override manual */
  source: z.enum(['signals', 'pinned', 'excluded']),
  /** quantos sinais contribuíram */
  signals: z.number().int().min(0),
});
export type TasteEntry = z.infer<typeof TasteEntrySchema>;

export const TasteProfileSchema = z.object({
  genres: z.array(TasteEntrySchema),
  subgenres: z.array(z.object({ key: z.string(), label: z.string(), score: z.number() })),
  overrides: z.object({ pinned: z.array(z.string()), excluded: z.array(z.string()) }),
  totals: z.object({ signals: z.number().int().min(0), watched: z.number().int().min(0), rated: z.number().int().min(0) }),
});
export type TasteProfile = z.infer<typeof TasteProfileSchema>;

export const UpdateTasteRequestSchema = z
  .object({
    /** gêneros que nunca devem ser sugeridos */
    exclude: z.array(z.string().max(32)).max(30).optional(),
    /** gêneros que o usuário afirma gostar (afinidade máxima) */
    pin: z.array(z.string().max(32)).max(30).optional(),
    /** remove o override (volta a valer só o que os sinais dizem) */
    clear: z.array(z.string().max(32)).max(30).optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, { message: 'nada para alterar' });
export type UpdateTasteRequest = z.infer<typeof UpdateTasteRequestSchema>;

// RF-38 (declaração): serviços que o usuário assina; sem integração com as plataformas
export const StreamingProviderSchema = z.object({ key: z.string(), label: z.string(), category: z.enum(['video', 'music']) });
export type StreamingProvider = z.infer<typeof StreamingProviderSchema>;
export const SubscriptionsResponseSchema = z.object({ available: z.array(StreamingProviderSchema), selected: z.array(z.string()) });
export type SubscriptionsResponse = z.infer<typeof SubscriptionsResponseSchema>;
export const UpdateSubscriptionsRequestSchema = z.object({ providers: z.array(z.string().max(32)).max(30) }).strict();
export type UpdateSubscriptionsRequest = z.infer<typeof UpdateSubscriptionsRequestSchema>;

// RNF-06: histórico de humor = só intenções estruturadas (o texto nunca foi guardado)
export const MoodHistoryItemSchema = z.object({
  runId: z.uuid(),
  createdAt: z.iso.datetime(),
  need: z.string().optional(),
  needLabel: z.string().optional(),
  avoid: z.array(z.string()),
  riskShown: z.boolean(),
});
export type MoodHistoryItem = z.infer<typeof MoodHistoryItemSchema>;
export const MoodHistoryResponseSchema = z.object({ items: z.array(MoodHistoryItemSchema) });
export type MoodHistoryResponse = z.infer<typeof MoodHistoryResponseSchema>;

// D-08: preferências de privacidade do usuário (SEC-CTRL-50/51)
export const UserSettingsSchema = z.object({
  /** guarda a intenção estruturada do "Como estou" por até 90 dias (padrão: não guarda) */
  rememberMood: z.boolean(),
  /** consentimento individual para enviar o texto do "Como estou" à IA externa (Anthropic) */
  aiConsent: z.boolean(),
  aiConsentAt: z.iso.datetime().nullable(),
  /**
   * a IA externa está disponível no servidor agora? (false com AI_MODE ≠ anthropic, sem chave
   * ou bloqueada pela D-07 até a resposta do TMDB)
   */
  aiAvailable: z.boolean(),
  /** motivo curto quando aiAvailable = false, para a UI explicar */
  aiUnavailableReason: z.enum(['disabled', 'tmdb_clearance_pending']).nullable(),
  moodRetentionDays: z.number().int().positive(),
});
export type UserSettings = z.infer<typeof UserSettingsSchema>;
export const UpdateUserSettingsRequestSchema = z
  .object({ rememberMood: z.boolean().optional(), aiConsent: z.boolean().optional() })
  .strict()
  .refine((v) => v.rememberMood !== undefined || v.aiConsent !== undefined, { message: 'nada para atualizar' });
export type UpdateUserSettingsRequest = z.infer<typeof UpdateUserSettingsRequestSchema>;

// RF-19/RF-22: sandbox (só com SANDBOX_ENABLED e fora de produção)
export const SandboxFixtureSchema = z.object({
  id: z.string(),
  kind: z.string(),
  description: z.string(),
  shareCount: z.number().int().min(0),
});
export type SandboxFixture = z.infer<typeof SandboxFixtureSchema>;
export const SandboxFixturesResponseSchema = z.object({ items: z.array(SandboxFixtureSchema) });
export type SandboxFixturesResponse = z.infer<typeof SandboxFixturesResponseSchema>;

export const SandboxShareResultSchema = z.object({
  status: ShareStatusSchema,
  items: z.array(z.object({ title: z.string(), kind: z.string(), decision: z.string() })),
  steps: z.array(PipelineStepSchema),
  decisions: z.array(CandidateDecisionSchema),
  diff: z.object({
    tp: z.number().int().min(0),
    fp: z.number().int().min(0),
    fn: z.number().int().min(0),
    missing: z.array(z.string()),
    unexpected: z.array(z.string()),
    failedAssertions: z.array(z.string()),
  }),
});
export type SandboxShareResult = z.infer<typeof SandboxShareResultSchema>;
export const SandboxRunResponseSchema = z.object({
  fixtureId: z.string(),
  mode: z.literal('mock'),
  passed: z.boolean(),
  shares: z.array(SandboxShareResultSchema),
});
export type SandboxRunResponse = z.infer<typeof SandboxRunResponseSchema>;

export const SandboxEvalReportSchema = z.object({
  file: z.string(),
  label: z.string(),
  createdAt: z.string(),
  metrics: z.record(z.string(), z.unknown()),
});
export const SandboxEvalsResponseSchema = z.object({ reports: z.array(SandboxEvalReportSchema) });
export type SandboxEvalsResponse = z.infer<typeof SandboxEvalsResponseSchema>;
