// Cliente HTTP do sistema web (RF-30): mesma API do app, sem lógica de negócio no front.
// Access token só em memória; o refresh vive no cookie httpOnly `fruiqo_rt` (Path=/auth) que o
// navegador manda sozinho com `credentials: 'include'`. O cabeçalho X-Fruiqo-Client identifica o
// web e protege o refresh por cookie contra CSRF.
import {
  ActivityResponseSchema,
  BulkResponseSchema,
  BulkUndoResponseSchema,
  ListDetailSchema,
  ListSummarySchema,
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
  type BulkRequest,
  type CorrectTitleRequest,
  type CreateTitleRequest,
  type LibraryQuery,
  type UpdateListRequest,
  type UpdateTasteRequest,
  type UpdateTitleRequest,
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

export async function logout(): Promise<void> {
  try {
    if (accessToken) await send('/auth/logout', 'POST', undefined, true);
  } finally {
    accessToken = null;
  }
}

// ---------- catálogo ----------

export type LibraryFilters = Partial<Omit<LibraryQuery, 'cursor'>>;

export const api = {
  taxonomy: () => request(TaxonomyResponseSchema, '/taxonomy/genres'),

  library: (filters: LibraryFilters, cursor?: string) =>
    request(LibraryResponseSchema, `/library${qs({ ...filters, cursor })}`),
  title: (id: string) => request(TitleSchema, `/library/${id}`),
  createTitle: (body: CreateTitleRequest) => request(TitleSchema, '/library', 'POST', body),
  updateTitle: (id: string, body: UpdateTitleRequest) => request(TitleSchema, `/library/${id}`, 'PATCH', body),
  correctTitle: (id: string, body: CorrectTitleRequest) => request(TitleSchema, `/library/${id}/correct`, 'POST', body),
  mergeTitle: (id: string, intoId: string) => request(TitleSchema, `/library/${id}/merge`, 'POST', { intoId }),
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
  approve: (id: string) => request(TitleSchema, `/review/${id}/approve`, 'POST'),
  reject: (id: string) => request(NoContent, `/review/${id}/reject`, 'POST'),
  rematch: (id: string, body: CorrectTitleRequest) => request(TitleSchema, `/review/${id}/rematch`, 'POST', body),

  // ---------- perfil ----------
  taste: () => request(TasteProfileSchema, '/profile/taste'),
  updateTaste: (body: UpdateTasteRequest) => request(TasteProfileSchema, '/profile/taste', 'PATCH', body),
  subscriptions: () => request(SubscriptionsResponseSchema, '/profile/subscriptions'),
  saveSubscriptions: (providers: string[]) =>
    request(SubscriptionsResponseSchema, '/profile/subscriptions', 'PUT', { providers }),
  moodHistory: () => request(MoodHistoryResponseSchema, '/profile/mood-history'),
  deleteMoodHistory: () => request(NoContent, '/profile/mood-history', 'DELETE'),

  // ---------- sandbox (dev) ----------
  sandboxFixtures: () => request(SandboxFixturesResponseSchema, '/sandbox/fixtures'),
  runFixture: (id: string) => request(SandboxRunResponseSchema, `/sandbox/fixtures/${encodeURIComponent(id)}/run`, 'POST'),
  sandboxEvals: () => request(SandboxEvalsResponseSchema, '/sandbox/evals'),
};
