// RF-48 (D-21): resolver de livros da Open Library, com as gravações sintéticas de fixtures/txt-books-list.
import { describe, expect, it } from 'vitest';
import { FIXTURES_DIR, PipelineGateway } from '../../src/pipeline/gateway.js';
import { bookScore, OpenLibraryResolver, STRONG_MATCH } from '../../src/pipeline/resolvers/openlibrary.js';
import { ALLOWED_HOSTS, safeFetchJson } from '../../src/pipeline/safe-fetch.js';

const gateway = new PipelineGateway({ mode: 'mock', recordingDirs: [FIXTURES_DIR] });
const ol = new OpenLibraryResolver('https://example.test/contato', gateway.fetchImpl, false);

describe('OpenLibraryResolver', () => {
  it('só resolve livros', () => {
    expect(ol.supports({ kind: 'book', title: 'x', confidence: 1 })).toBe(true);
    expect(ol.supports({ kind: 'movie', title: 'x', confidence: 1 })).toBe(false);
  });

  it('obra traduzida: título PT-BR vem da edição em português da busca e o match fica forte', async () => {
    const d = await ol.lookupDetailed({ title: 'O Relógio de Areia' });
    expect(d.resolution).toMatchObject({
      provider: 'openlibrary',
      externalId: 'ol:OL9990001W',
      olWorkId: 'OL9990001W',
      title: 'O Relógio de Areia',
      url: 'https://openlibrary.org/works/OL9990001W',
      imageUrl: 'https://covers.openlibrary.org/b/id/9990001-M.jpg',
      authors: ['Ana Fictícia'],
      year: 1961,
      pages: 212,
      overview: 'Sinopse fictícia escrita pelo time Fruiqo.',
    });
    expect(d.score).toBeGreaterThanOrEqual(STRONG_MATCH);
    // duplicata com o mesmo título e 1 edição perde para a obra canônica, e fica como alternativa
    expect(d.alternatives.map((a) => a.olWorkId)).toEqual(['OL9990008W']);
  });

  it('autor na busca; homônimo de outro autor vira alternativa (sem a capa ir além da URL)', async () => {
    const d = await ol.lookupDetailed({ title: 'Vento Sul', author: 'Marta Quintela' });
    expect(d.resolution?.olWorkId).toBe('OL9990002W');
    expect(d.alternatives).toEqual([expect.objectContaining({ provider: 'openlibrary', olWorkId: 'OL9990003W', authors: ['Autor Inventado'] })]);
  });

  it('ano ±1 desempata homônimos; o outro fica como alternativa', async () => {
    const d = await ol.lookupDetailed({ title: 'Cartas do Sertão', year: 1998 });
    expect(d.resolution).toMatchObject({ olWorkId: 'OL9990004W', year: 1998 });
    expect(d.alternatives.map((a) => a.olWorkId)).toEqual(['OL9990005W']);
  });

  it('busca geral vazia: repete só pelo campo título', async () => {
    expect((await ol.lookupDetailed({ title: 'Nove Estrelas' })).resolution?.olWorkId).toBe('OL9990006W');
  });

  it('enriquecimento só aceita correspondência razoável', async () => {
    expect(await ol.lookup({ title: 'Vento Sul', author: 'Marta Quintela' })).not.toBeNull();
    expect(bookScore({ title: 'Vento Sul' }, { olWorkId: 'OL1W', title: 'Outro Livro Qualquer', authors: [], subjects: [], editionCount: 0 })).toBeLessThan(0.6);
  });

  it('busca livre por autor', async () => {
    const hits = await ol.searchBooks('Marta Quintela', 12);
    expect(hits.map((h) => h.olWorkId)).toEqual(['OL9990002W', 'OL9990007W']);
    expect(hits[0]).toMatchObject({ authors: ['Marta Quintela'], coverUrl: 'https://covers.openlibrary.org/b/id/9990002-M.jpg', pages: 180 });
  });

  it('byWorkId valida o id antes de ir à rede', async () => {
    expect(await ol.byWorkId('../../etc')).toBeNull();
    expect(await ol.byWorkId('OL9990002W')).toMatchObject({ title: 'Vento Sul', externalId: 'ol:OL9990002W', authors: ['Marta Quintela'] });
    // a busca por chave não trouxe edição em português: o título PT-BR vem de editions.json
    expect(await ol.byWorkId('OL9990001W')).toMatchObject({ title: 'O Relógio de Areia', authors: ['Ana Fictícia'] });
  });

  it('User-Agent identificado com o contato (TOS-REQ-60)', async () => {
    const seen: string[] = [];
    const fetchImpl = (async (_url: string, init?: RequestInit) => {
      seen.push(new Headers(init?.headers).get('user-agent') ?? '');
      return new Response(JSON.stringify({ docs: [] }), { status: 200, headers: { 'content-type': 'application/json' } });
    }) as typeof fetch;
    await new OpenLibraryResolver('https://example.test/contato', fetchImpl, false).searchBooks('x');
    expect(seen[0]).toBe('Fruiqo/0.1 (https://example.test/contato)');
  });

  it('allowlist: openlibrary.org e covers.openlibrary.org, nada além', async () => {
    expect(ALLOWED_HOSTS.has('openlibrary.org')).toBe(true);
    expect(ALLOWED_HOSTS.has('covers.openlibrary.org')).toBe(true);
    await expect(safeFetchJson('https://evil.openlibrary.org.example.com/x.json')).rejects.toThrow(/allowlist/);
  });
});

describe('OpenLibraryResolver: rede instável', () => {
  const ok = () => new Response(JSON.stringify({ docs: [] }), { status: 200, headers: { 'content-type': 'application/json' } });
  it('tenta de novo em timeout/falha de conexão ou 5xx (até 2 vezes)', async () => {
    for (const fail of [
      () => Promise.reject(Object.assign(new Error('timeout'), { name: 'TimeoutError' })),
      () => Promise.reject(new TypeError('fetch failed')),
      () => Promise.resolve(new Response('x', { status: 503 })),
    ]) {
      let calls = 0;
      const fetchImpl = (async () => (++calls === 1 ? fail() : ok())) as unknown as typeof fetch;
      expect(await new OpenLibraryResolver(undefined, fetchImpl, false).searchBooks('x')).toEqual([]);
      expect(calls).toBe(2);
    }
    let calls = 0;
    const down = (async () => {
      calls++;
      throw new TypeError('fetch failed');
    }) as unknown as typeof fetch;
    await expect(new OpenLibraryResolver(undefined, down, false).searchBooks('x')).rejects.toThrow(/fetch failed/);
    expect(calls).toBe(3);
  });

  it('4xx não repete', async () => {
    let calls = 0;
    const fetchImpl = (async () => {
      calls++;
      return new Response('x', { status: 404 });
    }) as unknown as typeof fetch;
    await expect(new OpenLibraryResolver(undefined, fetchImpl, false).searchBooks('x')).rejects.toThrow(/404/);
    expect(calls).toBe(1);
  });
});
