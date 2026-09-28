// Cliente HTTP da API do Fruiqo. Valida toda resposta com os schemas de @fruiqo/contracts.
// Access token fica só em memória; refresh token fica no Keychain/Keystore via expo-secure-store (SEC-REQ-08).
import {
  type CreateShareRequest,
  type LoginRequest,
  type RegisterRequest,
  type Session,
  type Share,
  type ShareListResponse,
  type TokenPair,
  ApiErrorSchema,
  SessionSchema,
  ShareListResponseSchema,
  ShareSchema,
  TokenPairSchema,
} from '@fruiqo/contracts';
import * as SecureStore from 'expo-secure-store';
import { z } from 'zod';

export const API_URL = (process.env.EXPO_PUBLIC_API_URL ?? 'http://10.0.2.2:4000').replace(/\/+$/, '');

const REFRESH_KEY = 'fruiqo.refreshToken';
const REQUEST_TIMEOUT_MS = 15_000;

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
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
  await SecureStore.setItemAsync(REFRESH_KEY, pair.refreshToken);
}

export async function clearTokens() {
  accessToken = null;
  await SecureStore.deleteItemAsync(REFRESH_KEY);
}

export async function hasStoredSession() {
  return (await SecureStore.getItemAsync(REFRESH_KEY)) !== null;
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
  const body = ApiErrorSchema.safeParse(await res.json().catch(() => null));
  return body.success
    ? new ApiError(res.status, body.data.error, body.data.message)
    : new ApiError(res.status, 'http_error', `Erro ${res.status} no servidor.`);
}

/** Troca o refresh token por um novo par (rotação). Chamadas concorrentes compartilham a mesma troca. */
export function refreshSession(): Promise<boolean> {
  refreshInFlight ??= (async () => {
    const refreshToken = await SecureStore.getItemAsync(REFRESH_KEY);
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
  const refreshToken = await SecureStore.getItemAsync(REFRESH_KEY);
  try {
    if (refreshToken) {
      await rawFetch('/auth/logout', { method: 'POST', body: JSON.stringify({ refreshToken }), auth: true });
    }
  } finally {
    await clearTokens();
  }
}

// A API pode devolver a lista direto ou embrulhada em { items }.
const SessionListSchema = z
  .union([z.array(SessionSchema), z.object({ items: z.array(SessionSchema) })])
  .transform((v) => (Array.isArray(v) ? v : v.items));

export const listSessions = (): Promise<Session[]> => request('/auth/sessions', SessionListSchema);

export const revokeSession = (id: string) =>
  request(`/auth/sessions/${encodeURIComponent(id)}`, z.unknown(), { method: 'DELETE' });

// ---------- Shares ----------

export const createShare = (body: CreateShareRequest): Promise<Share> =>
  request('/shares', ShareSchema, { method: 'POST', body: JSON.stringify(body) });

export const listShares = (cursor?: string | null): Promise<ShareListResponse> =>
  request(cursor ? `/shares?cursor=${encodeURIComponent(cursor)}` : '/shares', ShareListResponseSchema);

export const getShare = (id: string): Promise<Share> => request(`/shares/${encodeURIComponent(id)}`, ShareSchema);

export const deleteShare = (id: string) =>
  request(`/shares/${encodeURIComponent(id)}`, z.unknown(), { method: 'DELETE' });
