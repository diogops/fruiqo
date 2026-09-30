// Cliente HTTP do sistema web (RF-30): mesma API do app, sem lógica de negócio no front.
// Access token só em memória; o refresh vive no cookie httpOnly `fruiqo_rt` (Path=/auth) que o
// navegador manda sozinho com `credentials: 'include'`. O cabeçalho X-Fruiqo-Client identifica o
// web e protege o refresh por cookie contra CSRF.
import {
  DiscoverResponseSchema,
  FeedbackResponseSchema,
  HomeResponseSchema,
  type DiscoverRequest,
  type FeedbackRequest,
  DELETE_ACCOUNT_CONFIRMATION,
  CatalogSyncStatusSchema,
  EnrichResponseSchema,
  ActivityResponseSchema,
  ApplyPriorityDraftResponseSchema,
  DeclaredTasteSchema,
  FavoriteSchema,
  ImportTitlesResponseSchema,
  PriorityDraftSchema,
  ReviewBatchResponseSchema,
  ShareSchema,
  TitleSearchResponseSchema,
  BulkResponseSchema,
  BulkUndoResponseSchema,
  ListDetailSchema,
  ListSummarySchema,
  MoveTitleResponseSchema,
  LibraryResponseSchema,
  MoodHistoryResponseSchema,
  ReviewListResponseSchema,
  SandboxEvalsResponseSchema,
  SandboxFixturesResponseSchema,
  SandboxRunResponseSchema,
  ShareStepsResponseSchema,
  SubscriptionsResponseSchema,
  TasteProfileSchema,
  TaxonomyResponseSchema,
  TitleSchema,
  WEB_CLIENT_HEADER,
  WEB_CLIENT_VALUE,
  WebSessionResponseSchema,
  type ApplyPriorityDraftRequest,
  type ApproveReviewRequest,
  type BulkRequest,
  type CreateFavoriteRequest,
  type CreatePriorityDraftRequest,
  type CreateShareRequest,
  type ImportTitlesRequest,
  type ReviewBatchRequest,
  type TitleSearchQuery,
  type UpdatePriorityDraftRequest,
  type CorrectTitleRequest,
  type CreateTitleRequest,
  type MoveTitleRequest,
  type LibraryQuery,
  type UpdateListRequest,
  type UpdateTasteRequest,
  type UpdateTitleRequest,
  type UpdateUserSettingsRequest,
  UserSettingsSchema,
} from '@fruiqo/contracts';
import { z } from 'zod';

export const API_URL = (import.meta.env.VITE_API_URL ?? 'http://localhost:4000').replace(/\/+$/, '');

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly body: Record<string, unknown> = {},
  ) {
    super(message);
  }
}

let accessToken: string | null = null;
let refreshing: Promise<boolean> | null = null;
let sessionLostHandler: (() => void) | null = null;

export function onSessionLost(handler: (() => void) | null): void {
  sessionLostHandler = handler;
}

export function hasSession(): boolean {
  return accessToken !== null;
}

/** Só para testes. */
export function __setAccessToken(token: string | null): void {
  accessToken = token;
}

type Method = 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';

async function send(path: string, method: Method, body: unknown, withAuth: boolean): Promise<Response> {
  const headers: Record<string, string> = { [WEB_CLIENT_HEADER]: WEB_CLIENT_VALUE };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (withAuth && accessToken) headers.Authorization = `Bearer ${accessToken}`;
  return fetch(`${API_URL}${path}`, {
    method,
    headers,
    credentials: 'include',
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

async function toError(res: Response): Promise<ApiError> {
  let body: Record<string, unknown> = {};
  try {
    body = (await res.json()) as Record<string, unknown>;
  } catch {
    // corpo vazio ou não-JSON
  }
  const message = typeof body.message === 'string' ? body.message : `Erro ${res.status}`;
  const code = typeof body.error === 'string' ? body.error : 'http_error';
  return new ApiError(res.status, code, message, body);
}

/** Renova o access token pelo cookie. Uma renovação por vez (as chamadas concorrentes esperam a mesma). */
export function refreshSession(): Promise<boolean> {
  refreshing ??= (async () => {
    try {
      const res = await send('/auth/refresh', 'POST', undefined, false);
      if (!res.ok) {
        accessToken = null;
        return false;
      }
      accessToken = WebSessionResponseSchema.parse(await res.json()).accessToken;
      return true;
    } catch {
      accessToken = null;
      return false;
    } finally {
      refreshing = null;
    }
  })();
  return refreshing;
}

async function request<S extends z.ZodType>(schema: S, path: string, method: Method = 'GET', body?: unknown): Promise<z.infer<S>> {
  let res = await send(path, method, body, true);
  if (res.status === 401) {
    if (await refreshSession()) {
      res = await send(path, method, body, true);
    } else {
      sessionLostHandler?.();
      throw new ApiError(401, 'unauthorized', 'Sua sessão expirou. Entre de novo.');
    }
  }
  if (!res.ok) throw await toError(res);
  if (res.status === 204) return undefined as z.infer<S>;
  return schema.parse(await res.json());
}

const NoContent = z.undefined();

function qs(params: Record<string, string | number | boolean | undefined | null>): string {
  const s = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== '') s.set(k, String(v));
  const out = s.toString();
  return out ? `?${out}` : '';
}

// ---------- auth ----------

export async function login(email: string, password: string): Promise<void> {
  const res = await send('/auth/login', 'POST', { email, password, deviceName: 'Navegador (web)' }, false);
  if (!res.ok) throw await toError(res);
  accessToken = WebSessionResponseSchema.parse(await res.json()).accessToken;
}

/** Cadastro pelo fluxo web: a API devolve a sessão (refresh em cookie), então já entra. */
export async function register(email: string, password: string): Promise<void> {
  const res = await send('/auth/register', 'POST', { email, password, deviceName: 'Navegador (web)' }, false);
  if (!res.ok) throw await toError(res);
  accessToken = WebSessionResponseSchema.parse(await res.json()).accessToken;
}

export async function logout(): Promise<void> {
  try {
    if (accessToken) await send('/auth/logout', 'POST', undefined, true);
  } finally {
    accessToken = null;
  }
}

/**
 * Exclusão definitiva da conta (LGPD; App Store 5.1.1(v)). Renova a sessão antes e chama
 * uma vez só: aqui um 401 significa senha errada, e não pode derrubar a sessão.
 */
export async function deleteAccount(password: string): Promise<void> {
  await refreshSession();
  const res = await send('/account', 'DELETE', { password, confirm: DELETE_ACCOUNT_CONFIRMATION }, true);
  if (!res.ok) throw await toError(res);
  accessToken = null;
}

// ---------- catálogo ----------

export type LibraryFilters = Partial<Omit<LibraryQuery, 'cursor'>>;

export const api = {
  taxonomy: () => request(TaxonomyResponseSchema, '/taxonomy/genres'),

  // "Como estou" e "Surpreenda-me" (RF-31..37): ranking local; IA só com consentimento (D-08)
  home: () => request(HomeResponseSchema, '/home'),
  discover: (body: DiscoverRequest) => request(DiscoverResponseSchema, '/discover', 'POST', body),
  feedback: (body: FeedbackRequest) => request(FeedbackResponseSchema, '/feedback', 'POST', body),

  library: (filters: LibraryFilters, cursor?: string) =>
    request(LibraryResponseSchema, `/library${qs({ ...filters, cursor })}`),
  title: (id: string) => request(TitleSchema, `/library/${id}`),
  createTitle: (body: CreateTitleRequest) => request(TitleSchema, '/library', 'POST', body),
  updateTitle: (id: string, body: UpdateTitleRequest) => request(TitleSchema, `/library/${id}`, 'PATCH', body),
  correctTitle: (id: string, body: CorrectTitleRequest) => request(TitleSchema, `/library/${id}/correct`, 'POST', body),
  mergeTitle: (id: string, intoId: string) => request(TitleSchema, `/library/${id}/merge`, 'POST', { intoId }),
  /** reordena a fila de prioridade (1 = topo) */
  moveTitle: (id: string, body: MoveTitleRequest) => request(MoveTitleResponseSchema, `/library/${id}/move`, 'POST', body),
  enrichTitle: (id: string) => request(EnrichResponseSchema, `/library/${id}/enrich`, 'POST', {}),
  /** D-23: sincronização do Catálogo com o TMDB */
  syncStatus: () => request(CatalogSyncStatusSchema, '/library/sync'),
  startSync: () => request(CatalogSyncStatusSchema, '/library/sync', 'POST', {}),
  bulk: (body: BulkRequest) => request(BulkResponseSchema, '/library/bulk', 'POST', body),
  undoBulk: (undoToken: string) => request(BulkUndoResponseSchema, '/library/bulk/undo', 'POST', { undoToken }),

  // ---------- listas ----------
  lists: () => request(z.array(ListSummarySchema), '/lists'),
  list: (id: string) => request(ListDetailSchema, `/lists/${id}`),
  createList: (name: string) => request(ListDetailSchema, '/lists', 'POST', { name }),
  updateList: (id: string, body: UpdateListRequest) => request(ListDetailSchema, `/lists/${id}`, 'PATCH', body),
  duplicateList: (id: string, name?: string) =>
    request(ListDetailSchema, `/lists/${id}/duplicate`, 'POST', name ? { name } : {}),
  reorderList: (id: string, titleIds: string[]) => request(ListDetailSchema, `/lists/${id}/items`, 'PUT', { titleIds }),
  deleteList: (id: string) => request(NoContent, `/lists/${id}`, 'DELETE'),

  // ---------- atividade / inspector ----------
  activity: (cursor?: string) => request(ActivityResponseSchema, `/activity${qs({ cursor })}`),
  shareSteps: (shareId: string) => request(ShareStepsResponseSchema, `/shares/${shareId}/steps`),

  // ---------- revisão ----------
  review: () => request(ReviewListResponseSchema, '/review'),
  /** RF-42: sem corpo aceita o encaixe sugerido; com corpo ajusta posição/listas/alternativa/título */
  approve: (id: string, body?: ApproveReviewRequest) => request(TitleSchema, `/review/${id}/approve`, 'POST', body),
  reviewBatch: (body: ReviewBatchRequest) => request(ReviewBatchResponseSchema, '/review/batch', 'POST', body),
  reject: (id: string) => request(NoContent, `/review/${id}/reject`, 'POST'),
  rematch: (id: string, body: CorrectTitleRequest) => request(TitleSchema, `/review/${id}/rematch`, 'POST', body),
  /** música lida ao contrário: troca título e artista, o item continua na revisão */
  swapMusic: (id: string) => request(TitleSchema, `/review/${id}/swap-music`, 'POST'),

  // ---------- perfil ----------
  taste: () => request(TasteProfileSchema, '/profile/taste'),
  updateTaste: (body: UpdateTasteRequest) => request(TasteProfileSchema, '/profile/taste', 'PATCH', body),
  subscriptions: () => request(SubscriptionsResponseSchema, '/profile/subscriptions'),
  saveSubscriptions: (providers: string[]) =>
    request(SubscriptionsResponseSchema, '/profile/subscriptions', 'PUT', { providers }),
  // D-08: lembrar humor (SEC-CTRL-50) e consentimento de IA externa (SEC-CTRL-51)
  settings: () => request(UserSettingsSchema, '/profile/settings'),
  updateSettings: (body: UpdateUserSettingsRequest) => request(UserSettingsSchema, '/profile/settings', 'PATCH', body),
  moodHistory: () => request(MoodHistoryResponseSchema, '/profile/mood-history'),
  deleteMoodHistory: () => request(NoContent, '/profile/mood-history', 'DELETE'),

  // ---------- RF-43: perfil declarado ----------
  declared: () => request(DeclaredTasteSchema, '/profile/declared'),
  updateSummary: (summary: string) => request(DeclaredTasteSchema, '/profile/summary', 'PUT', { summary }),
  addFavorite: (body: CreateFavoriteRequest) => request(FavoriteSchema, '/profile/favorites', 'POST', body),
  deleteFavorite: (id: string) => request(NoContent, `/profile/favorites/${id}`, 'DELETE'),

  // ---------- RF-44: rascunho de priorização ----------
  createDraft: (body: CreatePriorityDraftRequest = {}) => request(PriorityDraftSchema, '/library/priority-draft', 'POST', body),
  /** null quando não há rascunho (a API responde 404) */
  draft: async () => {
    try {
      return await request(PriorityDraftSchema, '/library/priority-draft');
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) return null;
      throw err;
    }
  },
  updateDraft: (body: UpdatePriorityDraftRequest) => request(PriorityDraftSchema, '/library/priority-draft', 'PATCH', body),
  applyDraft: (body: ApplyPriorityDraftRequest = {}) =>
    request(ApplyPriorityDraftResponseSchema, '/library/priority-draft/apply', 'POST', body),
  discardDraft: () => request(NoContent, '/library/priority-draft', 'DELETE'),

  // ---------- RF-46: busca inteligente e importação ----------
  searchTitles: (query: TitleSearchQuery) => request(TitleSearchResponseSchema, `/search/titles${qs(query)}`),
  importTitles: (body: ImportTitlesRequest) => request(ImportTitlesResponseSchema, '/library/import', 'POST', body),

  // ---------- RF-47: importar .txt (entra como share e vai para a revisão) ----------
  createShare: (body: CreateShareRequest) => request(ShareSchema, '/shares', 'POST', body),
  share: (id: string) => request(ShareSchema, `/shares/${id}`),

  // ---------- sandbox (dev) ----------
  sandboxFixtures: () => request(SandboxFixturesResponseSchema, '/sandbox/fixtures'),
  runFixture: (id: string) => request(SandboxRunResponseSchema, `/sandbox/fixtures/${encodeURIComponent(id)}/run`, 'POST'),
  sandboxEvals: () => request(SandboxEvalsResponseSchema, '/sandbox/evals'),
};
