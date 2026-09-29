import { AsyncLocalStorage } from 'node:async_hooks';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { PipelineMode } from '@fruiqo/contracts';
import { z } from 'zod';

/**
 * Porta única para rede no pipeline (RF-20). Todo acesso externo do worker (oEmbed, TMDB, Spotify,
 * Anthropic) passa por aqui:
 * - `live`: chamada real (o safeFetch continua aplicando allowlist, timeout e limite de tamanho);
 * - `mock`: responde com gravações de `fixtures/**` e `fixtures-private/**` e NUNCA acessa a rede;
 * - `record`: chama a API real e grava a resposta em `fixtures-private/` (nunca em `fixtures/`).
 * Credenciais nunca são gravadas nem entram na chave (SEC-REQ-14).
 */

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
export const FIXTURES_DIR = join(REPO_ROOT, 'fixtures');
export const FIXTURES_PRIVATE_DIR = join(REPO_ROOT, 'fixtures-private');

const DAY_MS = 24 * 3600 * 1000;
/** Validade das gravações de dados de terceiros (TOS-REQ-02 TMDB 180 dias; TOS-REQ-05 YouTube 30 dias). */
export const RECORDING_TTL_DAYS: Record<string, number> = {
  'api.themoviedb.org': 180,
  'www.youtube.com': 30,
  // TOS-REQ-62: cache próprio de 30 dias para a Open Library
  'openlibrary.org': 30,
};

const CREDENTIAL_PARAMS = new Set(['api_key', 'access_token', 'key', 'token', 'client_secret']);

export const RecordingSchema = z.object({
  /** true = escrita pelo time (não é dado de terceiro, não vence) */
  synthetic: z.boolean().default(false),
  recorded_at: z.iso.datetime(),
  request: z.object({ method: z.string(), url: z.string(), body: z.string().optional() }),
  response: z.object({ status: z.number().int(), contentType: z.string().default('application/json'), body: z.unknown() }),
});
export type Recording = z.infer<typeof RecordingSchema>;

export class GatewayError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GatewayError';
  }
}

/** URL sem parâmetros de credencial, para chave e gravação. */
export function redactUrl(url: string): string {
  const u = new URL(url);
  for (const k of [...u.searchParams.keys()]) {
    if (CREDENTIAL_PARAMS.has(k.toLowerCase())) u.searchParams.delete(k);
  }
  u.searchParams.sort();
  return u.toString();
}

export function requestKey(method: string, url: string, body?: string): string {
  const target = url.startsWith('llm://') ? url : redactUrl(url);
  return createHash('sha256').update(`${method.toUpperCase()} ${target}\n${body ?? ''}`).digest('hex');
}

/** Ação com efeito externo (playlist, deep link). No MVP nenhuma é executada pelo worker (RF-23). */
export interface ExternalAction {
  kind: 'spotify_add_to_playlist' | 'spotify_play' | 'deep_link_open';
  target: string;
  payload?: Record<string, unknown>;
}

export interface SimulatedAction extends ExternalAction {
  simulated: true;
  mode: PipelineMode;
  at: string;
}

export interface GatewayOptions {
  mode: PipelineMode;
  /** onde procurar gravações no mock (padrão: fixtures/ e fixtures-private/) */
  recordingDirs?: string[];
  /** onde o record grava (padrão: fixtures-private/) */
  recordDir?: string;
  realFetch?: typeof fetch;
  now?: () => Date;
}

interface LlmParams {
  model: string;
  system?: unknown;
  messages: unknown;
}

/** Subconjunto do SDK da Anthropic usado pelo pipeline. */
export interface LlmClient {
  messages: { parse(params: LlmParams & Record<string, unknown>): Promise<unknown> };
}

export class PipelineGateway {
  readonly mode: PipelineMode;
  private readonly index = new Map<string, Recording & { file: string }>();
  private readonly context = new AsyncLocalStorage<{ fixtureId: string | null }>();
  private readonly recordDir: string;
  private readonly realFetch: typeof fetch;
  private readonly now: () => Date;
  readonly simulatedActions: SimulatedAction[] = [];

  constructor(opts: GatewayOptions) {
    this.mode = opts.mode;
    this.recordDir = opts.recordDir ?? FIXTURES_PRIVATE_DIR;
    this.realFetch = opts.realFetch ?? globalThis.fetch.bind(globalThis);
    this.now = opts.now ?? (() => new Date());
    if (this.mode === 'mock') {
      for (const dir of opts.recordingDirs ?? [FIXTURES_DIR, FIXTURES_PRIVATE_DIR]) this.load(dir);
    }
  }

  /** Associa as gravações do `record` a uma fixture (senão vão para `_adhoc/`). */
  runWithFixture<T>(fixtureId: string | null, fn: () => Promise<T>): Promise<T> {
    return this.context.run({ fixtureId }, fn);
  }

  /** Implementação de `fetch` para o safeFetch (que já validou host, https e limites). */
  readonly fetchImpl: typeof fetch = async (input, init) => {
    const url = input instanceof URL ? input.toString() : typeof input === 'string' ? input : input.url;
    const method = init?.method ?? 'GET';
    const body = typeof init?.body === 'string' ? init.body : undefined;

    if (this.mode === 'live') return this.realFetch(input, init);
    if (this.mode === 'mock') return this.replay(method, url, body);

    const res = await this.realFetch(input, init);
    const text = await res.text();
    const contentType = res.headers.get('content-type') ?? 'application/json';
    if (res.ok && contentType.includes('json')) {
      this.save(method, url, body, { status: res.status, contentType, body: JSON.parse(text) as unknown });
    }
    return new Response(text, { status: res.status, headers: { 'content-type': contentType } });
  };

  /** Cliente de LLM conforme o modo. No mock a resposta vem de gravação; a rede nunca é usada. */
  llmClient(real: () => LlmClient): LlmClient {
    if (this.mode === 'live') return real();
    const key = (p: LlmParams) => requestKey('LLM', `llm://anthropic/${p.model}`, JSON.stringify([p.system, p.messages]));
    if (this.mode === 'mock') {
      return {
        messages: {
          parse: async (params) => {
            const hit = this.lookup(key(params), `LLM ${params.model}`);
            return hit.response.body;
          },
        },
      };
    }
    const client = real();
    return {
      messages: {
        parse: async (params) => {
          const out = await client.messages.parse(params);
          this.saveKey(key(params), 'anthropic', { method: 'LLM', url: `llm://anthropic/${params.model}` }, {
            status: 200,
            contentType: 'application/json',
            body: out,
          });
          return out;
        },
      },
    };
  }

  /**
   * RF-23: fora do `live`, ações externas nunca são executadas; ficam registradas como simuladas.
   * No `live` não há ação implementada no MVP (Spotify playlist chega com OAuth, D-05).
   */
  async performAction(action: ExternalAction): Promise<SimulatedAction> {
    if (this.mode === 'live') throw new GatewayError('ações externas ainda não implementadas');
    const simulated: SimulatedAction = { ...action, simulated: true, mode: this.mode, at: this.now().toISOString() };
    this.simulatedActions.push(simulated);
    return simulated;
  }

  get recordingCount(): number {
    return this.index.size;
  }

  private replay(method: string, url: string, body?: string): Response {
    const hit = this.lookup(requestKey(method, url, body), `${method} ${safeLabel(url)}`);
    return new Response(JSON.stringify(hit.response.body), {
      status: hit.response.status,
      headers: { 'content-type': hit.response.contentType },
    });
  }

  private lookup(key: string, label: string): Recording {
    const hit = this.index.get(key);
    if (!hit) throw new GatewayError(`mock: sem gravação para ${label}`);
    if (!hit.synthetic) {
      const host = hit.request.url.startsWith('llm://') ? null : new URL(hit.request.url).hostname;
      const ttl = host ? RECORDING_TTL_DAYS[host] : undefined;
      if (ttl !== undefined && this.now().getTime() - Date.parse(hit.recorded_at) > ttl * DAY_MS) {
        throw new GatewayError(`mock: gravação vencida (${ttl} dias) para ${label}`);
      }
    }
    return hit;
  }

  private load(dir: string) {
    if (!existsSync(dir)) return;
    for (const file of walk(dir)) {
      if (!/[\\/]recordings[\\/][^\\/]+\.json$/.test(file)) continue;
      const parsed = RecordingSchema.safeParse(JSON.parse(readFileSync(file, 'utf8')));
      if (!parsed.success) throw new GatewayError(`gravação inválida: ${file}`);
      const r = parsed.data;
      this.index.set(requestKey(r.request.method, r.request.url, r.request.body), { ...r, file });
    }
  }

  private save(method: string, url: string, body: string | undefined, response: Recording['response']) {
    const service = new URL(url).hostname;
    this.saveKey(requestKey(method, url, body), service, { method, url: redactUrl(url), ...(body ? { body } : {}) }, response);
  }

  private saveKey(key: string, service: string, request: Recording['request'], response: Recording['response']) {
    const fixtureId = this.context.getStore()?.fixtureId ?? '_adhoc';
    const dir = join(this.recordDir, fixtureId, 'recordings');
    mkdirSync(dir, { recursive: true });
    const recording: Recording = { synthetic: false, recorded_at: this.now().toISOString(), request, response };
    writeFileSync(join(dir, `${service}-${key.slice(0, 12)}.json`), `${JSON.stringify(recording, null, 2)}\n`);
  }
}

function safeLabel(url: string): string {
  try {
    const u = new URL(url);
    return `${u.hostname}${u.pathname}`;
  } catch {
    return 'url inválida';
  }
}

function* walk(dir: string): Generator<string> {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) yield* walk(full);
    else yield full;
  }
}
