/**
 * Cliente HTTP de saída (SEC-REQ-01, ARB-REQ-01). Só fala com hosts fixos de APIs oficiais,
 * só https, não segue redirect, timeout curto, limite de bytes e só aceita JSON.
 * Nunca é usado com URL vinda do usuário como destino: a URL do usuário vai só como parâmetro.
 */
export const ALLOWED_HOSTS = new Set([
  'www.youtube.com',
  'www.tiktok.com',
  'graph.facebook.com',
  'api.themoviedb.org',
  'api.spotify.com',
  'accounts.spotify.com',
  // RF-48 (D-21): livros
  'openlibrary.org',
  'covers.openlibrary.org',
  // D-22: IDs dos serviços de streaming por título (Wikidata, CC0)
  'query.wikidata.org',
]);

export class SafeFetchError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = 'SafeFetchError';
  }
}

export interface SafeFetchOptions {
  method?: 'GET' | 'POST';
  headers?: Record<string, string>;
  body?: string;
  timeoutMs?: number;
  maxBytes?: number;
  /** injeção para testes */
  fetchImpl?: typeof fetch;
}

export async function safeFetchJson<T = unknown>(url: string, opts: SafeFetchOptions = {}): Promise<T> {
  let target: URL;
  try {
    target = new URL(url);
  } catch {
    throw new SafeFetchError('URL inválida');
  }
  if (target.protocol !== 'https:') throw new SafeFetchError('só https é permitido');
  if (target.username || target.password || target.port) throw new SafeFetchError('URL não permitida');
  if (!ALLOWED_HOSTS.has(target.hostname.toLowerCase())) {
    throw new SafeFetchError(`host fora da allowlist: ${target.hostname}`);
  }

  const maxBytes = opts.maxBytes ?? 256 * 1024;
  const doFetch = opts.fetchImpl ?? fetch;
  const res = await doFetch(target, {
    method: opts.method ?? 'GET',
    headers: { accept: 'application/json', 'user-agent': 'Fruiqo/0.1', ...opts.headers },
    body: opts.body,
    redirect: 'manual',
    signal: AbortSignal.timeout(opts.timeoutMs ?? 5_000),
  });

  if (res.status >= 300 && res.status < 400) {
    await res.body?.cancel();
    throw new SafeFetchError('redirect não permitido', res.status);
  }
  if (!res.ok) {
    await res.body?.cancel();
    throw new SafeFetchError(`HTTP ${res.status}`, res.status);
  }
  const type = res.headers.get('content-type') ?? '';
  if (!type.includes('json')) {
    await res.body?.cancel();
    throw new SafeFetchError('resposta não é JSON');
  }
  const declared = Number(res.headers.get('content-length') ?? '0');
  if (declared > maxBytes) {
    await res.body?.cancel();
    throw new SafeFetchError('resposta grande demais');
  }

  const text = await readCapped(res, maxBytes);
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new SafeFetchError('JSON inválido');
  }
}

async function readCapped(res: Response, maxBytes: number): Promise<string> {
  if (!res.body) return '';
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new SafeFetchError('resposta grande demais');
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString('utf8');
}
