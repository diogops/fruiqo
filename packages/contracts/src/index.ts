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

/**
 * Exclusão definitiva da conta (LGPD art. 18, VI; App Store 5.1.1(v)).
 * Exige reautenticação com a senha atual e confirmação digitada.
 */
export const DELETE_ACCOUNT_CONFIRMATION = 'EXCLUIR';
export const DeleteAccountRequestSchema = z.object({
  password: z.string().min(1).max(128),
  confirm: z.literal(DELETE_ACCOUNT_CONFIRMATION),
});
export type DeleteAccountRequest = z.infer<typeof DeleteAccountRequestSchema>;

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
/** RF-47: tamanho máximo do conteúdo de um arquivo .txt importado */
export const MAX_TEXT_FILE_CHARS = 60000;

/** Origem do conteúdo de um share */
/** link: URL compartilhada; text: texto colado sem URL; screenshot: prints (OCR no device); text_file: .txt */
export const ShareOriginSchema = z.enum(['link', 'text', 'screenshot', 'text_file']);
export type ShareOrigin = z.infer<typeof ShareOriginSchema>;

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
    /**
     * RF-47: arquivo de texto (.txt) com um título por linha. Lido no device/navegador; só o conteúdo
     * vem para a API. Campo próprio (em vez de `pages`) porque o formato é outro: sem ruído de UI de
     * OCR, cabeçalhos de lista ("Series:") valem como tipo e toda linha curta é um item.
     */
    textFile: z
      .object({ name: z.string().trim().min(1).max(200), content: z.string().min(1).max(MAX_TEXT_FILE_CHARS) })
      .strict()
      .optional(),
  })
  .refine((v) => v.text !== undefined || v.url !== undefined || v.pages !== undefined || v.textFile !== undefined, {
    message: 'text, url, pages ou textFile é obrigatório',
  });
export type CreateShareRequest = z.infer<typeof CreateShareRequestSchema>;

export const RecommendationKindSchema = z.enum([
  'movie',
  'series',
  'music_track',
  'music_album',
  'artist',
  /** RF-48: livros (metadados da Open Library, D-21) */
  'book',
  'other',
]);
export type RecommendationKind = z.infer<typeof RecommendationKindSchema>;

export const ResolutionSchema = z.object({
  provider: z.enum(['tmdb', 'spotify', 'openlibrary']),
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
  /** D-23: nota geral do TMDB (0..10) e votos */
  voteAverage: z.number().min(0).max(10).optional(),
  voteCount: z.number().int().min(0).optional(),
  /** IDs de gênero do TMDB, convertidos para a taxonomia própria no servidor */
  genreIds: z.array(z.number().int()).optional(),
  /** disponibilidade BR detalhada (fonte: TMDB, dados da JustWatch) */
  providers: z.array(z.lazy(() => WatchProviderSchema)).optional(),
  /** página pública "onde assistir" do TMDB */
  watchUrl: z.url().optional(),
  /**
   * D-22: página pública do título em cada serviço (chave de `STREAMING_LINK_KEYS`), montada a partir
   * dos IDs do Wikidata (CC0) por modelos fixos no servidor. Só https do site do serviço.
   */
  titleLinks: z.record(z.string().max(32), z.url()).optional(),
  // ---- livros (RF-48, D-21): Open Library; cache de 30 dias (TOS-REQ-62); capa nunca vai ao LLM (TOS-REQ-66) ----
  /** ID da obra na Open Library (ex.: OL45883W) */
  olWorkId: z.string().max(40).optional(),
  authors: z.array(z.string().max(200)).max(10).optional(),
  pages: z.number().int().positive().optional(),
  /** assuntos (CC0) usados só para mapear gêneros da taxonomia */
  subjects: z.array(z.string().max(120)).max(30).optional(),
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

/**
 * Serviços de streaming pelo nome que o TMDB devolve (D-22). Todo link é página pública do site do
 * serviço (nunca esquema de app): o título direto quando o Wikidata tem o ID (`titleLinks`), senão
 * a busca do serviço com o nome do título, senão a página inicial.
 */
export const STREAMING_LINK_KEYS = ['netflix', 'prime_video', 'disney_plus', 'max', 'globoplay', 'apple_tv', 'mubi', 'crunchyroll'] as const;
export type StreamingLinkKey = (typeof STREAMING_LINK_KEYS)[number];

const SERVICES: { match: RegExp; key?: StreamingLinkKey; home: string; search?: string }[] = [
  { match: /^netflix/i, key: 'netflix', home: 'https://www.netflix.com/br/', search: 'https://www.netflix.com/search?q=' },
  { match: /^(amazon )?(prime )?video/i, key: 'prime_video', home: 'https://www.primevideo.com/', search: 'https://www.primevideo.com/search/?phrase=' },
  { match: /^disney/i, key: 'disney_plus', home: 'https://www.disneyplus.com/pt-br', search: 'https://www.disneyplus.com/pt-br/search?q=' },
  { match: /^(hbo )?max\b/i, key: 'max', home: 'https://www.hbomax.com/br/pt', search: 'https://play.hbomax.com/search?q=' },
  { match: /^globoplay/i, key: 'globoplay', home: 'https://globoplay.globo.com/', search: 'https://globoplay.globo.com/busca/?q=' },
  { match: /^apple tv/i, key: 'apple_tv', home: 'https://tv.apple.com/br', search: 'https://tv.apple.com/br/search?term=' },
  { match: /^mubi/i, key: 'mubi', home: 'https://mubi.com/pt/br', search: 'https://mubi.com/pt/br/search/films?query=' },
  { match: /^crunchyroll/i, key: 'crunchyroll', home: 'https://www.crunchyroll.com/pt-br', search: 'https://www.crunchyroll.com/pt-br/search?q=' },
  { match: /^paramount/i, home: 'https://www.paramountplus.com/br/' },
  { match: /^telecine/i, home: 'https://www.telecine.com.br/' },
  { match: /^claro tv/i, home: 'https://www.clarotvmais.com.br/' },
  { match: /^google play/i, home: 'https://play.google.com/store/movies', search: 'https://play.google.com/store/search?c=movies&q=' },
  { match: /^youtube/i, home: 'https://www.youtube.com/', search: 'https://www.youtube.com/results?search_query=' },
];

function serviceOf(name: string) {
  return SERVICES.find((s) => s.match.test(name.trim()));
}

/** Página inicial pública do serviço. */
export function providerSiteUrl(name: string): string | undefined {
  return serviceOf(name)?.home;
}

/** Chave do link direto (Wikidata) para o nome do provedor do TMDB. */
export function streamingLinkKey(name: string): StreamingLinkKey | undefined {
  return serviceOf(name)?.key;
}

/** Página pública da obra no TMDB (para o usuário conferir se é mesmo o título certo). */
export function tmdbPageUrl(mediaType: 'movie' | 'tv', tmdbId: number): string {
  return `https://www.themoviedb.org/${mediaType}/${Math.trunc(tmdbId)}`;
}

/** Página do título no IMDb, só com ID no formato oficial (tt + dígitos). */
export function imdbPageUrl(imdbId: string | null | undefined): string | undefined {
  return imdbId && /^tt\d{5,10}$/.test(imdbId) ? `https://www.imdb.com/title/${imdbId}/` : undefined;
}

/** Página da obra na Open Library. */
export function openLibraryWorkUrl(olWorkId: string): string | undefined {
  return /^OL\d{1,12}W$/.test(olWorkId) ? `https://openlibrary.org/works/${olWorkId}` : undefined;
}

/**
 * Onde conferir a obra que o título casou: página no TMDB (filme/série) ou na Open Library (livro),
 * mais o IMDb quando o ID já veio no enriquecimento. Só URLs montadas aqui, de hosts fixos.
 */
export function workPages(res: Resolution | null | undefined): { url: string; label: string; imdbUrl?: string } | undefined {
  if (!res) return undefined;
  if (res.provider === 'tmdb' && res.tmdbId && res.mediaType) {
    const imdbUrl = imdbPageUrl(res.imdbId);
    return { url: tmdbPageUrl(res.mediaType, res.tmdbId), label: 'TMDB', ...(imdbUrl ? { imdbUrl } : {}) };
  }
  if (res.provider === 'openlibrary' && res.olWorkId) {
    const url = openLibraryWorkUrl(res.olWorkId);
    return url ? { url, label: 'Open Library' } : undefined;
  }
  return undefined;
}

/**
 * Melhor link para abrir o título no serviço: direto (`title`), busca com o nome (`search`) ou a
 * página inicial (`home`). Serviço desconhecido: undefined (quem chama cai para a página do TMDB).
 */
export function providerTitleLink(
  name: string,
  title: string,
  titleLinks?: Partial<Record<string, string>>,
): { url: string; kind: 'title' | 'search' | 'home' } | undefined {
  const s = serviceOf(name);
  if (!s) return undefined;
  const direct = s.key ? titleLinks?.[s.key] : undefined;
  if (direct) return { url: direct, kind: 'title' };
  if (s.search && title.trim()) return { url: s.search + encodeURIComponent(title.trim()), kind: 'search' };
  return { url: s.home, kind: 'home' };
}

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
  /** RF-42: todo import entra como 'review_queue'; aqui fica o que o pipeline sugeriu */
  suggestedDecision: z.enum(['cataloged', 'review_queue']).optional(),
  /** RF-47: aderência do match do catálogo ao texto importado, 0..1 */
  matchScore: z.number().min(0).max(1).optional(),
});
export type Recommendation = z.infer<typeof RecommendationSchema>;

export const ShareSourceSchema = z.object({
  platform: PlatformSchema,
  /** 'screenshot' quando o conteúdo veio de prints (OCR no device); 'text_file' de um .txt (RF-47) */
  origin: ShareOriginSchema,
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

/**
 * D-23: `catalog` = está no catálogo, sem intenção de ver agora. Minha Área = `to_watch`
 * (Quero assistir), `watching` (Assistindo, com `watchOn`) e `watched` (Assistido).
 */
export const TitleStatusSchema = z.enum(['catalog', 'to_watch', 'watching', 'watched', 'dropped']);
/** status da Minha Área */
export const MY_AREA_STATUSES = ['to_watch', 'watching', 'watched'] as const;
export type TitleStatus = z.infer<typeof TitleStatusSchema>;

/**
 * Posição do título na fila de prioridade do usuário: 1 = mais prioritário. Única e contínua
 * (1..N) entre os títulos catalogados; itens da fila de revisão não têm posição (null).
 */
export const TitleRankSchema = z.number().int().min(1);

export const EnrichmentSchema = z.enum(['none', 'tmdb', 'openlibrary', 'demo', 'manual']);
export type Enrichment = z.infer<typeof EnrichmentSchema>;

export const TaxonomyTagSchema = z.object({ key: z.string(), label: z.string() });
export type TaxonomyTag = z.infer<typeof TaxonomyTagSchema>;

export const TitleListRefSchema = z.object({ id: z.uuid(), name: z.string() });

/** Nota em estrelas: 0,5 a 5, de meia em meia. Alimenta o perfil de gosto e o encaixe na fila. */
export const RatingSchema = z.number().min(0.5).max(5).multipleOf(0.5);

/** Item do catálogo do usuário (é a recomendação catalogada, com o estado de consumo). */
export const TitleSchema = z.object({
  id: z.uuid(),
  kind: RecommendationKindSchema,
  title: z.string(),
  creator: z.string().optional(),
  year: z.number().int().optional(),
  status: TitleStatusSchema,
  rank: TitleRankSchema.nullable(),
  rating: RatingSchema.optional(),
  /** D-23: onde estou assistindo (chave de plataforma ou texto livre) */
  watchOn: z.string().optional(),
  /** D-23: nota geral 0..10 (TMDB) e votos */
  generalRating: z.number().min(0).max(10).optional(),
  generalVotes: z.number().int().min(0).optional(),
  /** D-23: nota automática 0..5, calculada do meu gosto (local, sem LLM) */
  autoRating: z.number().min(0).max(5).optional(),
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
  /** RF-48: livro — página pública da obra na Open Library ("onde encontrar") e número de páginas */
  bookUrl: z.url().optional(),
  pages: z.number().int().positive().optional(),
  decision: z.enum(['cataloged', 'review_queue']),
  /**
   * RF-42: o que o pipeline sugeriria (todo import passa pela revisão; `cataloged` aqui = "confiável,
   * pode aprovar"). Ausente em títulos antigos/manuais.
   */
  suggestedDecision: z.enum(['cataloged', 'review_queue']).optional(),
  /** RF-47: aderência do match do catálogo ao texto importado (título, ano, tipo), 0..1 */
  matchScore: z.number().min(0).max(1).optional(),
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

/**
 * D-23: `score` (padrão) ordena pela minha nota, senão a automática, senão a geral; `mine`,
 * `auto` e `general` ordenam por uma nota só; `rank` é a fila de prioridade.
 */
export const LibrarySortSchema = z.enum(['score', 'mine', 'auto', 'general', 'rank', 'recent', 'title']);

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
  /** `1`: esconde os já assistidos (ignorado quando `status` é informado) */
  hideWatched: z.enum(['1']).optional(),
  /** D-23: `1` = só a Minha Área (Quero assistir, Assistindo, Assistido) */
  area: z.enum(['1']).optional(),
  q: z.string().trim().min(1).max(100).optional(),
  sort: LibrarySortSchema.default('score'),
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
    rating: RatingSchema.nullable().optional(),
    /** onde estou assistindo: plataforma comum ou texto livre (null limpa) */
    watchOn: z.string().trim().min(1).max(60).nullable().optional(),
    notes: z.string().max(500).nullable().optional(),
    /** gêneros manuais (chaves da taxonomia); marca `enrichment = manual` */
    genres: z.array(z.string().max(32)).max(6).optional(),
    /** D-23: "Próximo a assistir": vai para a Minha Área (Quero assistir, se não estiver na fila) em 1º */
    next: z.literal(true).optional(),
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
  /** RF-44: 409 do apply do rascunho quando a fila mudou */
  staleDetails: z.object({ added: z.number().int().min(0), removed: z.number().int().min(0) }).optional(),
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
  origin: ShareOriginSchema,
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
/** RF-47: outra opção de match do catálogo para o mesmo texto importado */
export const MatchAlternativeSchema = z.object({
  tmdbId: z.number().int(),
  mediaType: z.enum(['movie', 'tv']),
  title: z.string(),
  year: z.number().int().optional(),
  posterUrl: z.url().optional(),
  overview: z.string().max(400).optional(),
  /** aderência ao texto importado, 0..1 */
  score: z.number().min(0).max(1),
});
export type MatchAlternative = z.infer<typeof MatchAlternativeSchema>;

/** RF-48: outra opção de match de livro (Open Library) para o mesmo texto importado */
export const BookAlternativeSchema = z.object({
  olWorkId: z.string().max(40),
  title: z.string(),
  authors: z.array(z.string()).max(10).optional(),
  year: z.number().int().optional(),
  coverUrl: z.url().optional(),
  score: z.number().min(0).max(1),
});
export type BookAlternative = z.infer<typeof BookAlternativeSchema>;

/** RF-42/RF-43: onde o título entraria na fila e por quê */
export const FitSuggestionSchema = z.object({
  /** posição sugerida (1 = topo) considerando a fila atual */
  position: z.number().int().min(1),
  /** tamanho da fila depois da aprovação */
  total: z.number().int().min(1),
  /** -1..1 */
  score: z.number(),
  reasons: z.array(z.string()),
  /** título que ficaria logo depois (ajuda a entender o encaixe) */
  before: z.object({ id: z.uuid(), title: z.string(), rank: TitleRankSchema }).optional(),
});
export type FitSuggestion = z.infer<typeof FitSuggestionSchema>;

export const ReviewItemSchema = z.object({
  title: TitleSchema,
  /** RF-42: encaixe sugerido (posição + explicação) */
  fit: FitSuggestionSchema.nullable().optional(),
  /** RF-47: até 3 outras opções de match */
  alternatives: z.array(MatchAlternativeSchema).max(3).optional(),
  /** RF-48: até 3 outras opções quando o título é livro */
  bookAlternatives: z.array(BookAlternativeSchema).max(3).optional(),
  /** lista proposta pelo mesmo import (ex.: a lista do post dos prints); criada na primeira aprovação */
  proposedList: z.object({ name: z.string(), shareId: z.uuid(), listId: z.uuid().nullable() }).nullable().optional(),
  /** título do catálogo que parece ser o mesmo (mesmo match no TMDB): sugere mesclar */
  duplicateOf: z.object({ id: z.uuid(), title: z.string(), rank: TitleRankSchema.nullable() }).nullable().optional(),
  candidate: z
    .object({ rawTitle: z.string(), confidenceScore: z.number().min(0).max(1), reason: z.string() })
    .nullable(),
  share: z
    .object({ id: z.uuid(), platform: PlatformSchema, origin: ShareOriginSchema, sourceTitle: z.string().optional() })
    .nullable(),
});
export type ReviewItem = z.infer<typeof ReviewItemSchema>;
export const ReviewListResponseSchema = z.object({ items: z.array(ReviewItemSchema) });
export type ReviewListResponse = z.infer<typeof ReviewListResponseSchema>;
/** rematch = corrigir título/ano/tipo e aprovar */
export const ReviewRematchRequestSchema = CorrectTitleRequestSchema;
export type ReviewRematchRequest = z.infer<typeof ReviewRematchRequestSchema>;

/** RF-48: id de obra da Open Library (`OL123W`) */
export const OlWorkIdSchema = z.string().regex(/^OL[0-9]{1,12}W$/, 'id de obra da Open Library inválido');

/** RF-42: aprovar aceitando o encaixe sugerido ou ajustando posição, listas, título ou match */
export const ReviewPlacementSchema = z.enum(['suggested', 'end', 'top']);
export const ApproveReviewRequestSchema = z
  .object({
    /** padrão: `suggested` */
    placement: ReviewPlacementSchema.optional(),
    /** posição exata (vence `placement`) */
    position: z.number().int().min(1).optional(),
    /** listas extras onde incluir o título */
    listIds: z.array(z.uuid()).max(20).optional(),
    /** incluir na lista proposta pelo import (padrão: true) */
    useProposedList: z.boolean().optional(),
    /** trocar o match por uma das alternativas */
    alternative: z.object({ tmdbId: z.number().int(), mediaType: z.enum(['movie', 'tv']) }).strict().optional(),
    /** RF-48: trocar o match de livro por uma das alternativas da Open Library */
    alternativeBook: z.object({ olWorkId: OlWorkIdSchema }).strict().optional(),
    /** corrigir antes de aprovar */
    title: z.string().trim().min(1).max(200).optional(),
    kind: RecommendationKindSchema.optional(),
    year: z.number().int().min(1870).max(2100).nullable().optional(),
    creator: z.string().trim().max(200).nullable().optional(),
  })
  .strict()
  .refine((v) => !(v.alternative && v.alternativeBook), { message: 'Escolha uma alternativa só (filme/série ou livro)' });
export type ApproveReviewRequest = z.infer<typeof ApproveReviewRequestSchema>;

export const ReviewBatchRequestSchema = z
  .object({
    ids: z.array(z.uuid()).min(1).max(200),
    action: z.enum(['approve', 'reject']),
    /** só para approve; padrão `suggested`. `top`/`end` mantêm a ordem de `ids` (o 1º fica acima) */
    placement: ReviewPlacementSchema.optional(),
  })
  .strict();
export type ReviewBatchRequest = z.infer<typeof ReviewBatchRequestSchema>;

export const ReviewBatchResponseSchema = z.object({
  approved: z.array(TitleSchema),
  rejected: z.number().int().min(0),
  failed: z.array(z.object({ id: z.uuid(), message: z.string() })),
});
export type ReviewBatchResponse = z.infer<typeof ReviewBatchResponseSchema>;

// RF-29 / RNF-10: perfil de gosto transparente e editável
/** nível que o usuário escolhe para um gênero; `love` = fixado (1) e `hate` = excluído, nunca sugerido (-1) */
export const TasteLevelSchema = z.enum(['hate', 'dislike', 'neutral', 'like', 'love']);
export type TasteLevel = z.infer<typeof TasteLevelSchema>;
export const TASTE_LEVEL_SCORE: Record<TasteLevel, number> = { hate: -1, dislike: -0.5, neutral: 0, like: 0.5, love: 1 };
export const TasteSubgenrePrefSchema = z.enum(['like', 'dislike']);
export type TasteSubgenrePref = z.infer<typeof TasteSubgenrePrefSchema>;

export const TasteEntrySchema = z.object({
  key: z.string(),
  label: z.string(),
  /** -1..1 (0 = neutro) */
  score: z.number(),
  /** de onde vem o valor: sinais do usuário ou override manual (`manual` = nível intermediário) */
  source: z.enum(['signals', 'pinned', 'excluded', 'manual']),
  /** nível escolhido pelo usuário (só quando há override) */
  level: TasteLevelSchema.optional(),
  /** o que os sinais dizem, mesmo com override (para comparar) */
  learnedScore: z.number().optional(),
  /** quantos sinais contribuíram */
  signals: z.number().int().min(0),
  /** RF-43: parte que vem do perfil declarado (favoritos + resumo), -1..1 */
  declaredScore: z.number().optional(),
});
export type TasteEntry = z.infer<typeof TasteEntrySchema>;

export const TasteProfileSchema = z.object({
  genres: z.array(TasteEntrySchema),
  subgenres: z.array(
    z.object({
      key: z.string(),
      label: z.string(),
      score: z.number(),
      /** preferência manual (gosto / não gosto) */
      pref: TasteSubgenrePrefSchema.optional(),
    }),
  ),
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
    /** nível escolhido para cada gênero (inclui gênero que ainda não aparece no perfil) */
    levels: z.array(z.object({ key: z.string().max(32), level: TasteLevelSchema }).strict()).max(40).optional(),
    /** subgênero: gosto / não gosto; null remove a preferência */
    subgenres: z.array(z.object({ key: z.string().max(40), pref: TasteSubgenrePrefSchema.nullable() }).strict()).max(60).optional(),
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
  /**
   * Primeiro acesso: o perfil ainda está vazio (sem resumo, favoritos, níveis de gênero, subgêneros
   * nem assinaturas) e o usuário não concluiu nem dispensou a definição. O web abre o Perfil.
   */
  onboarding: z.boolean().optional(),
});
export type UserSettings = z.infer<typeof UserSettingsSchema>;
export const UpdateUserSettingsRequestSchema = z
  .object({
    rememberMood: z.boolean().optional(),
    aiConsent: z.boolean().optional(),
    /** primeiro acesso concluído ou dispensado (não volta a abrir o Perfil sozinho) */
    onboarded: z.literal(true).optional(),
  })
  .strict()
  .refine((v) => v.rememberMood !== undefined || v.aiConsent !== undefined || v.onboarded !== undefined, { message: 'nada para atualizar' });
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

// ---------- RF-43: perfil de gosto declarado (favoritos + resumo livre) ----------

export const FavoriteSchema = z.object({
  id: z.uuid(),
  title: z.string(),
  kind: RecommendationKindSchema,
  year: z.number().int().optional(),
  rating: RatingSchema.optional(),
  comment: z.string().optional(),
  genres: z.array(TaxonomyTagSchema),
  posterUrl: z.url().optional(),
  tmdbId: z.number().int().optional(),
  mediaType: z.enum(['movie', 'tv']).optional(),
  /** livro escolhido na busca (RF-48) */
  olWorkId: OlWorkIdSchema.optional(),
  createdAt: z.iso.datetime(),
});
export type Favorite = z.infer<typeof FavoriteSchema>;

export const CreateFavoriteRequestSchema = z
  .object({
    title: z.string().trim().min(1).max(200),
    kind: RecommendationKindSchema.optional(),
    year: z.number().int().min(1870).max(2100).optional(),
    rating: RatingSchema.optional(),
    comment: z.string().trim().max(500).optional(),
    /** escolhido na busca (RF-46); sem isto o servidor procura pelo título/ano */
    tmdbId: z.number().int().optional(),
    mediaType: z.enum(['movie', 'tv']).optional(),
    /** livro escolhido na busca (RF-48): capa e gêneros vêm da obra na Open Library */
    olWorkId: OlWorkIdSchema.optional(),
  })
  .strict();
export type CreateFavoriteRequest = z.infer<typeof CreateFavoriteRequestSchema>;

export const MAX_TASTE_SUMMARY_CHARS = 2000;
export const UpdateTasteSummaryRequestSchema = z.object({ summary: z.string().max(MAX_TASTE_SUMMARY_CHARS) }).strict();
export type UpdateTasteSummaryRequest = z.infer<typeof UpdateTasteSummaryRequestSchema>;

/** D-25: resumo sugerido (montado localmente, sem IA) ou melhorado pela IA; só vale depois de salvo */
export const SummaryDraftSchema = z.object({
  summary: z.string().max(MAX_TASTE_SUMMARY_CHARS),
  /** a IA foi usada (só no "melhorar") */
  aiUsed: z.boolean(),
  unavailable: z.enum(['disabled', 'consent', 'quota', 'too_long', 'failed']).optional(),
});
export type SummaryDraft = z.infer<typeof SummaryDraftSchema>;
export const ImproveSummaryRequestSchema = z.object({ text: z.string().trim().min(10).max(MAX_TASTE_SUMMARY_CHARS) }).strict();
export type ImproveSummaryRequest = z.infer<typeof ImproveSummaryRequestSchema>;


export const DeclaredAffinitySchema = z.object({
  key: z.string(),
  label: z.string(),
  /** -1..1 */
  score: z.number(),
  source: z.enum(['favorites', 'summary', 'both']),
});
export type DeclaredAffinity = z.infer<typeof DeclaredAffinitySchema>;

export const DeclaredTasteSchema = z.object({
  summary: z.string().nullable(),
  favorites: z.array(FavoriteSchema),
  /** o que as regras locais entenderam do resumo (transparente e editável, RNF-10) */
  interpreted: z.object({
    likes: z.array(TaxonomyTagSchema),
    dislikes: z.array(TaxonomyTagSchema),
    likedSubgenres: z.array(TaxonomyTagSchema),
    dislikedSubgenres: z.array(TaxonomyTagSchema),
  }),
  /** afinidades declaradas por gênero (favoritos + resumo) */
  affinities: z.array(DeclaredAffinitySchema),
});
export type DeclaredTaste = z.infer<typeof DeclaredTasteSchema>;

// ---------- RF-44: rascunho de priorização automática ----------

export const PriorityDraftItemSchema = z.object({
  title: TitleSchema,
  /** posição atual na fila (null se o título saiu da fila depois do rascunho) */
  currentRank: TitleRankSchema.nullable(),
  /** posição no rascunho */
  proposedRank: TitleRankSchema,
  /** positivo = sobe */
  delta: z.number().int(),
  reason: z.string(),
  score: z.number(),
});
export type PriorityDraftItem = z.infer<typeof PriorityDraftItemSchema>;

export const PriorityDraftSchema = z.object({
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
  items: z.array(PriorityDraftItemSchema),
  /** a fila mudou desde que o rascunho foi gerado (títulos entraram/saíram) */
  stale: z.boolean(),
  staleDetails: z.object({ added: z.number().int().min(0), removed: z.number().int().min(0) }).optional(),
});
export type PriorityDraft = z.infer<typeof PriorityDraftSchema>;

export const CreatePriorityDraftRequestSchema = z
  .object({
    /** `to_watch`: só "quero ver"/"assistindo" são reordenados; os demais vão para o fim, na ordem atual */
    scope: z.enum(['all', 'to_watch']).optional(),
  })
  .strict();
export type CreatePriorityDraftRequest = z.infer<typeof CreatePriorityDraftRequestSchema>;

export const UpdatePriorityDraftRequestSchema = z.union([
  /** ordem completa (ex.: depois de arrastar) */
  z.object({ titleIds: z.array(z.uuid()).min(1).max(5000) }).strict(),
  /** mover um item dentro do rascunho */
  z.object({ id: z.uuid(), move: MoveTitleRequestSchema }).strict(),
]);
export type UpdatePriorityDraftRequest = z.infer<typeof UpdatePriorityDraftRequestSchema>;

export const ApplyPriorityDraftRequestSchema = z
  .object({
    /**
     * fila mudou desde o rascunho: `append_new` aplica a ordem do rascunho e mantém os títulos novos
     * depois dele (na ordem atual); sem isto, responde 409
     */
    reconcile: z.enum(['append_new']).optional(),
  })
  .strict();
export type ApplyPriorityDraftRequest = z.infer<typeof ApplyPriorityDraftRequestSchema>;

export const ApplyPriorityDraftResponseSchema = z.object({
  applied: z.number().int().min(0),
  undoToken: z.uuid(),
  undoExpiresAt: z.iso.datetime(),
});
export type ApplyPriorityDraftResponse = z.infer<typeof ApplyPriorityDraftResponseSchema>;

// ---------- RF-46: incluir título por busca inteligente ----------

/** D-23: sincronização do Catálogo com o TMDB (melhores primeiro, depois do mais novo ao mais velho) */
export const CatalogSyncStatusSchema = z.object({
  status: z.enum(['idle', 'queued', 'running', 'failed']),
  /** há chave do TMDB no servidor */
  available: z.boolean(),
  /** títulos no Catálogo (fora da Minha Área) */
  catalogCount: z.number().int().nonnegative(),
  lastAdded: z.number().int().nonnegative(),
  totalAdded: z.number().int().nonnegative(),
  /** os mais bem avaliados já entraram; agora segue do mais novo para o mais velho */
  bestDone: z.boolean(),
  /** até onde a sincronização já voltou no tempo (AAAA-MM-DD) */
  olderThan: z.string().optional(),
  lastStartedAt: z.iso.datetime().optional(),
  lastFinishedAt: z.iso.datetime().optional(),
  lastError: z.string().optional(),
});
export type CatalogSyncStatus = z.infer<typeof CatalogSyncStatusSchema>;

export const TitleSearchQuerySchema = z.object({
  q: z.string().trim().min(1).max(200),
  kind: z.enum(['movie', 'series', 'book']).optional(),
  /** `1`: interpretar com IA (pedido livre: "filme recente de faroeste"); precisa do consentimento */
  ai: z.enum(['1']).optional(),
  /**
   * D-23: ordem dos resultados. `score` = ordem manual → suas estrelas → automática → geral (padrão,
   * exceto na busca por nome, que fica por `relevance`)
   */
  sort: z.enum(['score', 'auto', 'general', 'relevance']).optional(),
});
export type TitleSearchQuery = z.infer<typeof TitleSearchQuerySchema>;

export const TitleSearchResultSchema = z.object({
  tmdbId: z.number().int(),
  mediaType: z.enum(['movie', 'tv']),
  kind: z.enum(['movie', 'series']),
  title: z.string(),
  originalTitle: z.string().optional(),
  year: z.number().int().optional(),
  posterUrl: z.url().optional(),
  /** sinopse curta */
  overview: z.string().max(400).optional(),
  /** elenco principal (até 3) */
  cast: z.array(z.string()),
  /** o título já está no catálogo/revisão do usuário */
  inLibrary: z
    .object({
      id: z.uuid(),
      rank: TitleRankSchema.nullable(),
      decision: z.enum(['cataloged', 'review_queue']),
      status: TitleStatusSchema.optional(),
      /** sua nota (estrelas) */
      rating: z.number().min(0.5).max(5).nullable().optional(),
    })
    .nullable(),
  matchedBy: z.enum(['title', 'person', 'genre', 'description', 'browse']),
  /** D-23: nota geral no TMDB (0..10) e votos, para comparar na busca */
  generalRating: z.number().min(0).max(10).optional(),
  generalVotes: z.number().int().nonnegative().optional(),
  /** D-23: nota automática (0..5) pelo seu gosto, calculada localmente */
  autoRating: z.number().min(0).max(5).optional(),
  /** anime (animação de origem japonesa) */
  anime: z.boolean().optional(),
  /** gêneros (chaves da taxonomia própria) */
  genres: z.array(z.string()).optional(),
});
export type TitleSearchResult = z.infer<typeof TitleSearchResultSchema>;

export const TitleSearchResponseSchema = z.object({
  query: z.string(),
  interpreted: z.object({
    type: z.enum(['title', 'person', 'genre', 'description', 'browse']),
    /** D-23: como a exploração foi entendida ("mais bem avaliados", "Netflix", "minissérie") */
    labels: z.array(z.string()).optional(),
    /** D-23: ordem aplicada aos resultados */
    sort: z.enum(['score', 'auto', 'general', 'relevance']).optional(),
    /** pediu "Buscar com IA", mas a IA está desligada ou sem consentimento: foi feita a busca normal */
    aiUnavailable: z.boolean().optional(),
    year: z.number().int().optional(),
    person: z.string().optional(),
    genres: z.array(TaxonomyTagSchema),
    decade: z.number().int().optional(),
    /** a descrição passou pelo LLM (só com a IA liberada, D-07/D-17, e consentimento, SEC-CTRL-51) */
    aiUsed: z.boolean(),
  }),
  items: z.array(TitleSearchResultSchema),
  /** RF-48: livros (Open Library); preenchido com `kind=book` ou busca sem tipo */
  books: z.array(z.lazy(() => BookSearchResultSchema)).optional(),
});
export type TitleSearchResponse = z.infer<typeof TitleSearchResponseSchema>;

/** RF-48: resultado de busca de livro (Open Library; atribuição por link à obra) */
export const BookSearchResultSchema = z.object({
  olWorkId: z.string().max(40),
  title: z.string(),
  authors: z.array(z.string()),
  year: z.number().int().optional(),
  coverUrl: z.url().optional(),
  pages: z.number().int().positive().optional(),
  /** página pública da obra */
  url: z.url(),
  inLibrary: z
    .object({
      id: z.uuid(),
      rank: TitleRankSchema.nullable(),
      decision: z.enum(['cataloged', 'review_queue']),
      status: TitleStatusSchema.optional(),
      /** sua nota (estrelas) */
      rating: z.number().min(0.5).max(5).nullable().optional(),
    })
    .nullable(),
  matchedBy: z.enum(['title', 'author']),
});
export type BookSearchResult = z.infer<typeof BookSearchResultSchema>;

/** D-23: categoria sugerida pelo TMDB para títulos lidos de print/texto (Filme ou Série) */
export const ClassifyTitlesRequestSchema = z
  .object({ titles: z.array(z.string().trim().min(1).max(200)).min(1).max(60) })
  .strict();
export type ClassifyTitlesRequest = z.infer<typeof ClassifyTitlesRequestSchema>;
export const ClassifyTitlesResponseSchema = z.object({
  items: z.array(
    z.object({
      title: z.string(),
      /** null: não achou nada parecido no TMDB (talvez livro, ou grafia diferente) */
      kind: z.enum(['movie', 'series']).nullable(),
      tmdbTitle: z.string().optional(),
      year: z.number().int().optional(),
    }),
  ),
});
export type ClassifyTitlesResponse = z.infer<typeof ClassifyTitlesResponseSchema>;

/**
 * D-24: títulos achados pela IA. `describe` = descrição livre digitada pelo usuário ("aquele filme
 * em que..."); `ocr` = texto lido de um print (só o texto, a imagem nunca sai do aparelho). A resposta
 * da IA é só um palpite: cada obra é conferida no TMDB antes de aparecer em `items`.
 */
export const AI_DESCRIBE_MAX_CHARS = 1000;
export const AI_OCR_MAX_CHARS = 4000;
export const AiFindTitlesRequestSchema = z
  .object({
    mode: z.enum(['describe', 'ocr']),
    text: z.string().trim().min(2).max(AI_OCR_MAX_CHARS),
    kind: z.enum(['movie', 'series']).optional(),
  })
  .strict()
  .refine((v) => v.mode === 'ocr' || v.text.length <= AI_DESCRIBE_MAX_CHARS, {
    message: `descrição com no máximo ${AI_DESCRIBE_MAX_CHARS} caracteres`,
    path: ['text'],
  });
export type AiFindTitlesRequest = z.infer<typeof AiFindTitlesRequestSchema>;

export const AiFindTitlesResponseSchema = z.object({
  aiUsed: z.boolean(),
  /**
   * por que a IA não foi usada: desligada no servidor, sem consentimento, texto de print não
   * liberado (D-24), cota do dia, texto grande demais ou falha/recusa do modelo
   */
  unavailable: z.enum(['disabled', 'consent', 'ocr_not_allowed', 'quota', 'too_long', 'failed']).optional(),
  /** conferidos no TMDB; `aiReason` = por que a IA achou que é esse (só no modo `describe`) */
  items: z.array(TitleSearchResultSchema.extend({ aiReason: z.string().max(300).optional() })),
  /** palpites que o TMDB não confirmou (livro, grafia diferente, obra obscura): o usuário decide */
  notFound: z.array(
    z.object({
      title: z.string().max(200),
      kind: z.enum(['movie', 'series', 'book']),
      year: z.number().int().optional(),
    }),
  ),
});
export type AiFindTitlesResponse = z.infer<typeof AiFindTitlesResponseSchema>;

/**
 * D-25: "O que assistir hoje?". A IA sugere pelo seu humor (opcional), resumo, níveis e nomes de
 * favoritos/títulos que você amou; o TMDB confere; ficam só os que estão nos streamings que você
 * assina (se cadastrou algum) e saem os que você já assistiu, abandonou ou já viu nesta rodada.
 * Sem IA, a busca é só local (seus serviços + gêneros que você marcou).
 */
export const TONIGHT_MOOD_MAX_CHARS = 300;
export const TonightRequestSchema = z
  .object({
    /** como você está hoje, nas suas palavras (passa pelo detector de risco antes de tudo) */
    mood: z.string().trim().max(TONIGHT_MOOD_MAX_CHARS).optional(),
    /** sugestões já mostradas nesta rodada ("movie:123", "book:OL1W", "music:nome"), para "novas sugestões" não repetirem */
    exclude: z
      .array(z.string().regex(/^((movie|tv):\d+|book:OL\d+W|music:[a-z0-9-]{1,80})$/))
      .max(100)
      .optional(),
    /** o que você quer hoje; sem tipo = filmes e séries */
    kind: z.enum(['movie', 'series', 'book', 'music']).optional(),
    /** gênero escolhido (taxonomia para filme/série/livro; texto curto para música) */
    genre: z.string().trim().min(1).max(40).optional(),
    /** filme/série: trazer animes e animações (desenhos) também (padrão: não, a não ser que o pedido seja de animação) */
    includeAnime: z.boolean().optional(),
    /** trazer também o que você já assistiu/abandonou (padrão: não) */
    includeSeen: z.boolean().optional(),
    /** sessão do painel (o servidor guarda o que já mostrou, o estoque e as páginas já lidas) */
    sessionId: z.uuid().optional(),
    /** filme/série: incluir a Minha Área (Quero assistir/Assistindo) como 1ª fonte (padrão: sim) */
    includeQueue: z.boolean().optional(),
    /**
     * filme/série: em quais streamings procurar (chaves do Perfil, ex. "netflix"). Ausente = os que
     * você marcou no Perfil; vazio = em qualquer lugar (sem filtro)
     */
    services: z.array(z.string().max(32)).max(20).optional(),
    /**
     * "Avançado": o perfil só para esta busca (não salva). Cada parte presente substitui a do Perfil.
     */
    profile: z
      .object({
        summary: z.string().max(MAX_TASTE_SUMMARY_CHARS).optional(),
        genres: z.array(z.object({ key: z.string().max(32), group: z.enum(['love', 'like', 'neutral', 'avoid']) }).strict()).max(40).optional(),
        subgenres: z.array(z.object({ key: z.string().max(40), pref: z.enum(['like', 'dislike']) }).strict()).max(60).optional(),
      })
      .strict()
      .optional(),
  })
  .strict();
export type TonightRequest = z.infer<typeof TonightRequestSchema>;
export const TonightResponseSchema = z.object({
  aiUsed: z.boolean(),
  /** por que a IA não foi usada (a busca local roda mesmo assim) */
  unavailable: z.enum(['disabled', 'consent', 'quota', 'failed', 'no_profile']).optional(),
  /** RNF-07: o humor indicou risco; sem sugestões, com o apoio do CVV */
  risk: z.lazy(() => RiskSupportSchema).nullable().optional(),
  /** o pedido que foi buscado (transparência) */
  request: z.string().max(2000).optional(),
  /** filme/série: o que foi entendido do pedido ("ação + ficção científica · faz pensar") */
  understood: z.string().max(300).optional(),
  /** trechos do pedido que não viraram filtro (mostrados para o usuário reformular) */
  unmapped: z.array(z.string().max(40)).optional(),
  /** não há mais títulos inéditos com estes filtros */
  exhausted: z.boolean().optional(),
  /** serviços usados no filtro (vazio = você não cadastrou nenhum; nada foi filtrado por serviço) */
  services: z.array(z.string()),
  items: z.array(
    TitleSearchResultSchema.extend({
      aiReason: z.string().max(300).optional(),
      /** onde o título está na assinatura no Brasil (seus serviços; em "qualquer lugar", todos) */
      availableOn: z.array(z.string()),
      /** veio da sua Minha Área (Quero assistir / Assistindo) */
      fromList: z.boolean().optional(),
      /** compatibilidade com o pedido (0..100) */
      fit: z.number().int().min(0).max(100).optional(),
      /** compatibilidade com o seu perfil (0..100) */
      profileFit: z.number().int().min(0).max(100).optional(),
    }),
  ),
  /** pedido de livro: conferidos na Open Library */
  books: z.array(z.lazy(() => BookSearchResultSchema.extend({ aiReason: z.string().max(300).optional() }))).optional(),
  /** pedido de música: sugestões da IA, sem conferência em catálogo */
  music: z
    .array(
      z.object({
        key: z.string(),
        title: z.string().max(200),
        artist: z.string().max(200).optional(),
        kind: z.enum(['music_track', 'music_album', 'artist']),
        year: z.number().int().optional(),
        aiReason: z.string().max(300).optional(),
      }),
    )
    .optional(),
});
export type TonightResponse = z.infer<typeof TonightResponseSchema>;
/**
 * D-25: o widget já abre "com a sua cara": tipo que você mais consome e gêneros na ordem do seu
 * gosto (aprendido + o que você ajustou), agrupados. Calculado no servidor (RF-30).
 */
export const TonightDefaultsSchema = z.object({
  /** o tipo que você mais vê; null = mistura (filmes e séries) */
  kind: z.enum(['movie', 'series']).nullable(),
  /** todos os gêneros, do que você mais gosta para o que evita */
  genres: z.array(
    z.object({
      key: z.string(),
      label: z.string(),
      group: z.enum(['love', 'like', 'neutral', 'avoid']),
      /** vale para filme/série (gêneros só de livro não) */
      forVideo: z.boolean(),
    }),
  ),
  /** os 3 de que você mais gosta (rótulos), para o "Do seu gosto" */
  top: z.array(z.string()),
  /** "Avançado": o perfil salvo, para editar só nesta busca */
  summary: z.string().nullable(),
  subgenres: z.array(z.object({ key: z.string(), label: z.string(), pref: z.enum(['like', 'dislike']).nullable() })),
  /** streamings de vídeo; `selected` = marcados no Perfil (o filtro padrão) */
  services: z.array(z.object({ key: z.string(), label: z.string(), selected: z.boolean() })),
});
export type TonightDefaults = z.infer<typeof TonightDefaultsSchema>;

/**
 * D-25: prateleiras do "O que assistir hoje?" (Lançamentos, Ação, Ficção científica), nos seus
 * streamings, sem o que você já assistiu/abandonou. Montadas no servidor a partir do TMDB (RF-30).
 */
export const TONIGHT_SHELF_KEYS = ['new', 'action', 'scifi'] as const;
export const TonightShelvesResponseSchema = z.object({
  /** streamings usados no filtro (vazio = em qualquer lugar no Brasil) */
  services: z.array(z.string()),
  shelves: z.array(
    z.object({
      key: z.enum(TONIGHT_SHELF_KEYS),
      label: z.string(),
      items: z.array(TitleSearchResultSchema),
    }),
  ),
});
export type TonightShelvesResponse = z.infer<typeof TonightShelvesResponseSchema>;

/** Uso de IA (tokens e custo estimado pelo preço do modelo), últimos 30 dias, para o Perfil. */
export const AiUsageReportSchema = z.object({
  since: z.string(),
  total: z.object({ calls: z.number().int(), failures: z.number().int(), inputTokens: z.number().int(), outputTokens: z.number().int(), costUsd: z.number() }),
  /** por recurso ("tonight_plan", "mood"...), do mais caro para o mais barato */
  features: z.array(
    z.object({ feature: z.string(), calls: z.number().int(), failures: z.number().int(), inputTokens: z.number().int(), outputTokens: z.number().int(), costUsd: z.number(), models: z.array(z.string()) }),
  ),
  /** por dia (AAAA-MM-DD, horário de Brasília), do mais recente para o mais antigo */
  days: z.array(z.object({ date: z.string(), calls: z.number().int(), costUsd: z.number() })),
});
export type AiUsageReport = z.infer<typeof AiUsageReportSchema>;

/** "Já assisti / já li / já ouvi": entra na sua lista como consumido e não volta nas sugestões */
export const TonightWatchedRequestSchema = z.union([
  z.object({ tmdbId: z.number().int().positive(), mediaType: z.enum(['movie', 'tv']) }).strict(),
  z.object({ olWorkId: OlWorkIdSchema }).strict(),
  z
    .object({
      music: z
        .object({ title: z.string().trim().min(1).max(200), artist: z.string().trim().max(200).optional(), kind: z.enum(['music_track', 'music_album', 'artist']) })
        .strict(),
    })
    .strict(),
]);
export type TonightWatchedRequest = z.infer<typeof TonightWatchedRequestSchema>;

export const ImportTitlesRequestSchema = z
  .object({
    items: z.array(z.object({ tmdbId: z.number().int(), mediaType: z.enum(['movie', 'tv']) }).strict()).max(50).default([]),
    /** RF-48: livros escolhidos na busca */
    books: z.array(z.object({ olWorkId: OlWorkIdSchema }).strict()).max(50).optional(),
    /** pula a revisão e aprova já, no encaixe sugerido (RF-46) */
    approveNow: z.boolean().optional(),
    listId: z.uuid().optional(),
  })
  .strict()
  .refine((v) => v.items.length + (v.books?.length ?? 0) > 0, { message: 'escolha ao menos um título' });
export type ImportTitlesRequest = z.infer<typeof ImportTitlesRequestSchema>;

export const ImportTitlesResponseSchema = z.object({
  created: z.array(TitleSchema),
  skipped: z.array(
    z.object({
      tmdbId: z.number().int(),
      mediaType: z.enum(['movie', 'tv']),
      reason: z.enum(['already_in_list', 'not_found']),
      existingId: z.uuid().optional(),
    }),
  ),
  /** RF-48: livros não importados */
  skippedBooks: z
    .array(z.object({ olWorkId: z.string(), reason: z.enum(['already_in_list', 'not_found']), existingId: z.uuid().optional() }))
    .optional(),
});
export type ImportTitlesResponse = z.infer<typeof ImportTitlesResponseSchema>;

// Importar de imagem (web e app): heurísticas de candidatos e cadastro do que o usuário confirmar
export * from './import-candidates';
