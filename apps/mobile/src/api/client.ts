// Cliente HTTP da API do Fruiqo. Valida toda resposta com os schemas de @fruiqo/contracts.
// Access token fica só em memória; refresh token fica no Keychain/Keystore via expo-secure-store (SEC-REQ-08).
import {
  DELETE_ACCOUNT_CONFIRMATION,
  type ApplyPriorityDraftRequest,
  ApplyPriorityDraftResponseSchema,
  type ApplyPriorityDraftResponse,
  type ApproveReviewRequest,
  type BulkOperation,
  BulkResponseSchema,
  type BulkResponse,
  BulkUndoResponseSchema,
  type CreateFavoriteRequest,
  type CreatePriorityDraftRequest,
  DeclaredTasteSchema,
  type DeclaredTaste,
  FavoriteSchema,
  type Favorite,
  ImportTitlesResponseSchema,
  type ImportTitlesRequest,
  type ImportTitlesResponse,
  PriorityDraftSchema,
  type PriorityDraft,
  ReviewBatchResponseSchema,
  type ReviewBatchRequest,
  type ReviewBatchResponse,
  ReviewListResponseSchema,
  type ReviewListResponse,
  TitleSearchResponseSchema,
  type TitleSearchResponse,
  type UpdatePriorityDraftRequest,
  type CreateListRequest,
  type CreateShareRequest,
  type DiscoverRequest,
  type DiscoverResponse,
  type FeedbackRequest,
  type FeedbackResponse,
  type HomeResponse,
  type LibraryResponse,
  type ListDetail,
  type ListSummary,
  type MoveTitleRequest,
  type MoveTitleResponse,
  type Title,
  type UpdateTitleRequest,
  type LoginRequest,
  type RegisterRequest,
  type Session,
  type Share,
  type ShareListResponse,
  type TokenPair,
  ApiErrorSchema,
  DiscoverResponseSchema,
  FeedbackResponseSchema,
  HomeResponseSchema,
  LibraryResponseSchema,
  ListDetailSchema,
  ListSummarySchema,
  SessionSchema,
  ShareListResponseSchema,
  ShareStepsResponseSchema,
  type ShareStepsResponse,
  ShareSchema,
  TaxonomyResponseSchema,
  type TaxonomyResponse,
  TitleConflictErrorSchema,
  MoveTitleResponseSchema,
  TitleSchema,
  TokenPairSchema,
  type UpdateUserSettingsRequest,
  type UserSettings,
  UserSettingsSchema,
} from '@fruiqo/contracts';
import { z } from 'zod';

import { deleteToken, getToken, setToken } from './tokenStore';

export const API_URL = (process.env.EXPO_PUBLIC_API_URL ?? 'http://10.0.2.2:4000').replace(/\/+$/, '');

const REFRESH_KEY = 'fruiqo.refreshToken';
const REQUEST_TIMEOUT_MS = 15_000;

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    /** 409 de PATCH /library/:id: id do título com que o novo nome/tipo colide */
    readonly conflictWith?: string,
    /** 409 do rascunho de prioridade (RF-44): a fila mudou desde o rascunho */
    readonly staleDetails?: { added: number; removed: number },
  ) {
    super(message);
  }
}

let accessToken: string | null = null;
let refreshInFlight: Promise<boolean> | null = null;
let onSessionLost: (() => void) | null = null;

/** chamado pelo AuthContext para voltar ao login quando a sessão não pode ser renovada */
export function setSessionLostHandler(handler: (() => void) | null) {
  onSessionLost = handler;
}

async function storeTokens(pair: TokenPair) {
  accessToken = pair.accessToken;
  await setToken(REFRESH_KEY, pair.refreshToken);
}

export async function clearTokens() {
  accessToken = null;
  await deleteToken(REFRESH_KEY);
}

export async function hasStoredSession() {
  return (await getToken(REFRESH_KEY)) !== null;
}

async function rawFetch(path: string, init: RequestInit & { auth?: boolean } = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set('Accept', 'application/json');
  if (init.body !== undefined) headers.set('Content-Type', 'application/json');
  if (init.auth && accessToken) headers.set('Authorization', `Bearer ${accessToken}`);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await fetch(`${API_URL}${path}`, { ...init, headers, signal: controller.signal });
  } catch {
    throw new ApiError(0, 'network', 'Não foi possível falar com o servidor. Verifique a conexão.');
  } finally {
    clearTimeout(timer);
  }
}

async function toApiError(res: Response): Promise<ApiError> {
  const json: unknown = await res.json().catch(() => null);
  const conflict = TitleConflictErrorSchema.safeParse(json);
  if (res.status === 409 && conflict.success) {
    return new ApiError(409, 'conflict', conflict.data.message, conflict.data.conflictWith);
  }
  const body = ApiErrorSchema.safeParse(json);
  return body.success
    ? new ApiError(res.status, body.data.error, body.data.message, undefined, body.data.staleDetails)
    : new ApiError(res.status, 'http_error', `Erro ${res.status} no servidor.`);
}

/** Troca o refresh token por um novo par (rotação). Chamadas concorrentes compartilham a mesma troca. */
export function refreshSession(): Promise<boolean> {
  refreshInFlight ??= (async () => {
    const refreshToken = await getToken(REFRESH_KEY);
    if (!refreshToken) return false;
    const res = await rawFetch('/auth/refresh', { method: 'POST', body: JSON.stringify({ refreshToken }) });
    if (!res.ok) {
      if (res.status === 401 || res.status === 403) await clearTokens();
      return false;
    }
    await storeTokens(TokenPairSchema.parse(await res.json()));
    return true;
  })().finally(() => {
    refreshInFlight = null;
  });
  return refreshInFlight;
}

async function request<T>(path: string, schema: z.ZodType<T>, init: RequestInit = {}): Promise<T> {
  if (!accessToken) await refreshSession();
  let res = await rawFetch(path, { ...init, auth: true });
  if (res.status === 401 && (await refreshSession())) {
    res = await rawFetch(path, { ...init, auth: true });
  }
  if (res.status === 401) {
    await clearTokens();
    onSessionLost?.();
  }
  if (!res.ok) throw await toApiError(res);
  if (res.status === 204) return schema.parse(undefined);
  return schema.parse(await res.json());
}

// ---------- Auth ----------

async function authenticate(path: '/auth/login' | '/auth/register', body: LoginRequest | RegisterRequest) {
  const res = await rawFetch(path, { method: 'POST', body: JSON.stringify(body) });
  if (!res.ok) throw await toApiError(res);
  await storeTokens(TokenPairSchema.parse(await res.json()));
}

export const login = (body: LoginRequest) => authenticate('/auth/login', body);
export const register = (body: RegisterRequest) => authenticate('/auth/register', body);

export async function logout() {
  const refreshToken = await getToken(REFRESH_KEY);
  try {
    if (refreshToken) {
      await rawFetch('/auth/logout', { method: 'POST', body: JSON.stringify({ refreshToken }), auth: true });
    }
  } finally {
    await clearTokens();
  }
}

/**
 * Exclusão definitiva da conta (LGPD; App Store 5.1.1(v)). Chamada única: aqui um 401
 * significa senha errada e não pode derrubar a sessão; no sucesso apaga os tokens.
 */
export async function deleteAccount(password: string): Promise<void> {
  if (!accessToken) await refreshSession();
  const res = await rawFetch('/account', {
    method: 'DELETE',
    body: JSON.stringify({ password, confirm: DELETE_ACCOUNT_CONFIRMATION }),
    auth: true,
  });
  if (!res.ok) throw await toApiError(res);
  await clearTokens();
}

// A API pode devolver a lista direto ou embrulhada em { items }.
const SessionListSchema = z
  .union([z.array(SessionSchema), z.object({ items: z.array(SessionSchema) })])
  .transform((v) => (Array.isArray(v) ? v : v.items));

export const listSessions = (): Promise<Session[]> => request('/auth/sessions', SessionListSchema);

export const revokeSession = (id: string) =>
  request(`/auth/sessions/${encodeURIComponent(id)}`, z.unknown(), { method: 'DELETE' });

// ---------- Shares ----------

/** `fixtureId` (só o simulador de dev) marca o share como fixture; a API só aceita com SANDBOX_ENABLED. */
export const createShare = (body: CreateShareRequest, opts: { fixtureId?: string } = {}): Promise<Share> =>
  request('/shares', ShareSchema, {
    method: 'POST',
    body: JSON.stringify(body),
    headers: opts.fixtureId ? { 'X-Fruiqo-Fixture': opts.fixtureId } : undefined,
  });

export const listShares = (cursor?: string | null): Promise<ShareListResponse> =>
  request(cursor ? `/shares?cursor=${encodeURIComponent(cursor)}` : '/shares', ShareListResponseSchema);

export const getShare = (id: string): Promise<Share> => request(`/shares/${encodeURIComponent(id)}`, ShareSchema);

/** Decisões por candidato do pipeline (resultado item a item do "Importar de imagem"). */
export const getShareSteps = (id: string): Promise<ShareStepsResponse> =>
  request(`/shares/${encodeURIComponent(id)}/steps`, ShareStepsResponseSchema);

export const deleteShare = (id: string) =>
  request(`/shares/${encodeURIComponent(id)}`, z.unknown(), { method: 'DELETE' });

// ---------- Catálogo, listas e home (RF-26, RF-31..RF-37) ----------

const json = (body: unknown): RequestInit => ({ body: JSON.stringify(body) });

export const getHome = (): Promise<HomeResponse> => request('/home', HomeResponseSchema);

/** Gêneros e subgêneros válidos da taxonomia própria, com rótulos pt-BR. */
export const getTaxonomy = (): Promise<TaxonomyResponse> => request('/taxonomy/genres', TaxonomyResponseSchema);

/** O texto do "Como estou" só trafega nesta chamada; o app não o guarda (RNF-06). */
export const discover = (body: DiscoverRequest): Promise<DiscoverResponse> =>
  request('/discover', DiscoverResponseSchema, { method: 'POST', ...json(body) });

/** D-08: lembrar humor (SEC-CTRL-50) e consentimento de IA externa (SEC-CTRL-51). */
export const getSettings = (): Promise<UserSettings> => request('/profile/settings', UserSettingsSchema);

export const updateSettings = (body: UpdateUserSettingsRequest): Promise<UserSettings> =>
  request('/profile/settings', UserSettingsSchema, { method: 'PATCH', ...json(body) });

export const sendFeedback = (body: FeedbackRequest): Promise<FeedbackResponse> =>
  request('/feedback', FeedbackResponseSchema, { method: 'POST', ...json(body) });

export function getLibrary(query: Record<string, string | undefined> = {}): Promise<LibraryResponse> {
  const qs = Object.entries(query)
    .filter((e): e is [string, string] => e[1] !== undefined && e[1] !== '')
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join('&');
  return request(qs ? `/library?${qs}` : '/library', LibraryResponseSchema);
}

export const getTitle = (id: string): Promise<Title> => request(`/library/${encodeURIComponent(id)}`, TitleSchema);

export const updateTitle = (id: string, body: UpdateTitleRequest): Promise<Title> =>
  request(`/library/${encodeURIComponent(id)}`, TitleSchema, { method: 'PATCH', ...json(body) });

/** Reordena a fila de prioridade (1 = topo). */
export const moveTitle = (id: string, body: MoveTitleRequest): Promise<MoveTitleResponse> =>
  request(`/library/${encodeURIComponent(id)}/move`, MoveTitleResponseSchema, { method: 'POST', ...json(body) });

export const listLists = (): Promise<ListSummary[]> => request('/lists', z.array(ListSummarySchema));

export const createList = (body: CreateListRequest): Promise<ListSummary> =>
  request('/lists', ListSummarySchema, { method: 'POST', ...json(body) });

export const getList = (id: string): Promise<ListDetail> => request(`/lists/${encodeURIComponent(id)}`, ListDetailSchema);

export const reorderList = (id: string, titleIds: string[]): Promise<ListDetail> =>
  request(`/lists/${encodeURIComponent(id)}/items`, ListDetailSchema, { method: 'PUT', ...json({ titleIds }) });

export const deleteList = (id: string) =>
  request(`/lists/${encodeURIComponent(id)}`, z.unknown(), { method: 'DELETE' });

// ---------- Catálogo: ações em massa (RF-25) ----------

export const bulkLibrary = (titleIds: string[], operation: BulkOperation): Promise<BulkResponse> =>
  request('/library/bulk', BulkResponseSchema, { method: 'POST', ...json({ titleIds, operation }) });

export const undoBulk = (undoToken: string) =>
  request('/library/bulk/undo', BulkUndoResponseSchema, { method: 'POST', ...json({ undoToken }) });

// ---------- Revisão (RF-42) ----------

export const getReview = (): Promise<ReviewListResponse> => request('/review', ReviewListResponseSchema);

export const approveReview = (id: string, body: ApproveReviewRequest = {}): Promise<Title> =>
  request(`/review/${encodeURIComponent(id)}/approve`, TitleSchema, { method: 'POST', ...json(body) });

export const rejectReview = (id: string) =>
  request(`/review/${encodeURIComponent(id)}/reject`, z.unknown(), { method: 'POST' });

/** Música lida ao contrário: troca título e artista; o item continua na revisão (409 se virar duplicata). */
export const swapMusicReview = (id: string): Promise<Title> =>
  request(`/review/${encodeURIComponent(id)}/swap-music`, TitleSchema, { method: 'POST' });

export const batchReview =(body: ReviewBatchRequest): Promise<ReviewBatchResponse> =>
  request('/review/batch', ReviewBatchResponseSchema, { method: 'POST', ...json(body) });

// ---------- Busca inteligente e inclusão (RF-46) ----------

export function searchTitles(q: string, kind?: 'movie' | 'series' | 'book', ai?: boolean): Promise<TitleSearchResponse> {
  // ai: "Buscar com IA" (pedido livre inteiro para a IA; o servidor exige o consentimento)
  const qs = `q=${encodeURIComponent(q)}${kind ? `&kind=${kind}` : ''}${ai && kind !== 'book' ? '&ai=1' : ''}`;
  return request(`/search/titles?${qs}`, TitleSearchResponseSchema);
}

export const importTitles = (body: ImportTitlesRequest): Promise<ImportTitlesResponse> =>
  request('/library/import', ImportTitlesResponseSchema, { method: 'POST', ...json(body) });

// ---------- Perfil de gosto declarado (RF-43) ----------

export const getDeclaredTaste = (): Promise<DeclaredTaste> => request('/profile/declared', DeclaredTasteSchema);

export const updateTasteSummary = (summary: string): Promise<DeclaredTaste> =>
  request('/profile/summary', DeclaredTasteSchema, { method: 'PUT', ...json({ summary }) });

export const addFavorite = (body: CreateFavoriteRequest): Promise<Favorite> =>
  request('/profile/favorites', FavoriteSchema, { method: 'POST', ...json(body) });

export const deleteFavorite = (id: string) =>
  request(`/profile/favorites/${encodeURIComponent(id)}`, z.unknown(), { method: 'DELETE' });

// ---------- Rascunho de priorização (RF-44) ----------

/** 404 quando não há rascunho ativo: devolve null. */
export async function getPriorityDraft(): Promise<PriorityDraft | null> {
  try {
    return await request('/library/priority-draft', PriorityDraftSchema);
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) return null;
    throw e;
  }
}

export const createPriorityDraft = (body: CreatePriorityDraftRequest = {}): Promise<PriorityDraft> =>
  request('/library/priority-draft', PriorityDraftSchema, { method: 'POST', ...json(body) });

export const updatePriorityDraft = (body: UpdatePriorityDraftRequest): Promise<PriorityDraft> =>
  request('/library/priority-draft', PriorityDraftSchema, { method: 'PATCH', ...json(body) });

export const applyPriorityDraft = (body: ApplyPriorityDraftRequest = {}): Promise<ApplyPriorityDraftResponse> =>
  request('/library/priority-draft/apply', ApplyPriorityDraftResponseSchema, { method: 'POST', ...json(body) });

export const discardPriorityDraft = () => request('/library/priority-draft', z.unknown(), { method: 'DELETE' });
