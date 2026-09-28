import type { Title } from '@fruiqo/contracts';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render } from '@testing-library/react';
import type { ReactElement } from 'react';
import { MemoryRouter } from 'react-router';
import { vi } from 'vitest';
import { ToastProvider } from '../components/Toast';

export interface Call {
  method: string;
  path: string;
  body: unknown;
  headers: Record<string, string>;
  credentials?: RequestCredentials;
}

type Handler = (call: Call) => { status?: number; body?: unknown } | undefined;

/** Substitui o fetch global: `routes` responde por "MÉTODO /caminho" (sem query string) ou por função. */
export function mockApi(routes: Record<string, Handler | Record<string, unknown> | unknown[]>) {
  const calls: Call[] = [];
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = new URL(String(input));
    const call: Call = {
      method: init.method ?? 'GET',
      path: url.pathname + url.search,
      body: init.body ? JSON.parse(String(init.body)) : undefined,
      headers: (init.headers ?? {}) as Record<string, string>,
      credentials: init.credentials,
    };
    calls.push(call);
    const key = `${call.method} ${url.pathname}`;
    const route = routes[key];
    const res = typeof route === 'function' ? (route as Handler)(call) : route === undefined ? undefined : { body: route };
    if (!res) return new Response(JSON.stringify({ error: 'not_found', message: `sem mock: ${key}` }), { status: 404 });
    const status = res.status ?? 200;
    return new Response(status === 204 ? null : JSON.stringify(res.body ?? {}), {
      status,
      headers: { 'Content-Type': 'application/json' },
    });
  });
  vi.stubGlobal('fetch', fetchMock);
  return { calls, fetchMock };
}

export function renderWithProviders(ui: ReactElement, { route = '/' }: { route?: string } = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ToastProvider>
        <MemoryRouter initialEntries={[route]}>{ui}</MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>,
  );
}

let seq = 0;
export function makeTitle(over: Partial<Title> = {}): Title {
  seq += 1;
  const id = `00000000-0000-4000-8000-${String(seq).padStart(12, '0')}`;
  return {
    id,
    kind: 'movie',
    title: `Filme ${seq}`,
    status: 'to_watch',
    rank: seq,
    genres: [],
    subgenres: [],
    enrichment: 'none',
    decision: 'cataloged',
    confidence: 0.5,
    extractor: 'heuristic',
    shareId: null,
    lists: [],
    createdAt: '2026-09-28T10:00:00.000Z',
    updatedAt: '2026-09-28T10:00:00.000Z',
    ...over,
  };
}

/**
 * Simula a largura da janela para as media queries do app (`matchMedia`).
 * Avalia só `max-width`/`min-width` em px — suficiente para os breakpoints de `MQ`.
 */
export function mockViewport(width: number) {
  const evaluate = (query: string) =>
    query.split(' and ').every((part) => {
      const max = /max-width:\s*(\d+)px/.exec(part);
      const min = /min-width:\s*(\d+)px/.exec(part);
      if (max) return width <= Number(max[1]);
      if (min) return width >= Number(min[1]);
      return false;
    });
  vi.stubGlobal(
    'matchMedia',
    vi.fn((query: string) => ({
      matches: evaluate(query),
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  );
}
