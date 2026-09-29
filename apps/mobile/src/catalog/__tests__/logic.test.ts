import { describe, expect, it } from '@jest/globals';
import { MAX_TEXT_FILE_CHARS } from '@fruiqo/contracts';

import {
  activeFilterCount,
  bookKey,
  movieKey,
  splitSelection,
  buildLibraryQuery,
  bookFavoriteRequest,
  buildTextFileRequest,
  canSwapMusic,
  deltaLabel,
  fitLabel,
  genreChips,
  isImageFile,
  isTextFile,
  matchPercent,
  moveLocal,
  toggleSelected,
} from '../logic';
import { kindLabel, titleMeta } from '../../ui/labels';

const q = (ids: string[]) => ids.map((id, i) => ({ id, rank: i + 1 }));

describe('filtros do catálogo', () => {
  it('monta a query ordenada pela fila e ignora vazios', () => {
    expect(buildLibraryQuery({ q: '  ', status: 'to_watch' })).toMatchObject({ q: undefined, status: 'to_watch', sort: 'rank' });
    expect(buildLibraryQuery({}, 'abc').cursor).toBe('abc');
  });
  it('conta filtros ativos sem a busca por texto', () => {
    expect(activeFilterCount({ q: 'x', kind: 'movie', genre: 'drama' })).toBe(2);
  });
  it('mostra 2 gêneros + N', () => {
    const g = ['a', 'b', 'c', 'd'].map((k) => ({ key: k, label: k }));
    expect(genreChips(g)).toEqual({ shown: g.slice(0, 2), extra: 2 });
  });
});

describe('fila por posição (otimista)', () => {
  it('sobe, desce, topo e fim renumerando', () => {
    expect(moveLocal(q(['a', 'b', 'c']), 'c', { to: 'up' }).map((t) => `${t.id}${t.rank}`)).toEqual(['a1', 'c2', 'b3']);
    expect(moveLocal(q(['a', 'b', 'c']), 'a', { to: 'down' }).map((t) => t.id)).toEqual(['b', 'a', 'c']);
    expect(moveLocal(q(['a', 'b', 'c']), 'c', { to: 'top' }).map((t) => t.id)).toEqual(['c', 'a', 'b']);
    expect(moveLocal(q(['a', 'b', 'c']), 'a', { to: 'bottom' }).map((t) => t.id)).toEqual(['b', 'c', 'a']);
  });
  it('posição é limitada ao que está carregado e mantém a base da página', () => {
    const page = [
      { id: 'x', rank: 51 },
      { id: 'y', rank: 52 },
    ];
    expect(moveLocal(page, 'x', { position: 99 }).map((t) => `${t.id}${t.rank}`)).toEqual(['y51', 'x52']);
  });
  it('sem mudança devolve a mesma lista', () => {
    const list = q(['a', 'b']);
    expect(moveLocal(list, 'a', { to: 'up' })).toBe(list);
    expect(moveLocal(list, 'zz', { to: 'top' })).toBe(list);
  });
  it('rótulo da variação no rascunho', () => {
    expect([deltaLabel(3), deltaLabel(-2), deltaLabel(0)]).toEqual(['▲ 3', '▼ 2', '=']);
  });
  it('seleção múltipla alterna', () => {
    const s = toggleSelected(new Set(['a']), 'b');
    expect([...toggleSelected(s, 'a')]).toEqual(['b']);
  });
});

describe('import de .txt (RF-47)', () => {
  const id = () => '00000000-0000-4000-8000-000000000000';
  it('reconhece .txt por mime ou extensão e imagens por mime', () => {
    expect(isTextFile({ uri: 'f', mimeType: 'text/plain; charset=utf-8' })).toBe(true);
    expect(isTextFile({ uri: 'f', name: 'lista series BFR.TXT', mimeType: 'application/octet-stream' })).toBe(true);
    expect(isTextFile({ uri: 'f', mimeType: 'image/png' })).toBe(false);
    expect(isImageFile({ uri: 'f', mimeType: 'image/jpeg' })).toBe(true);
  });
  it('normaliza CRLF e BOM e usa textFile', () => {
    const r = buildTextFileRequest('lista.txt', '﻿Series:\r\nMaid(2021)\r\n', id);
    expect(r).toEqual({
      kind: 'ok',
      truncated: false,
      request: { clientShareId: id(), textFile: { name: 'lista.txt', content: 'Series:\nMaid(2021)' } },
    });
  });
  it('arquivo vazio não gera envio; grande é cortado no limite', () => {
    expect(buildTextFileRequest('a.txt', ' \r\n ', id)).toEqual({ kind: 'empty' });
    const big = buildTextFileRequest('a.txt', 'x'.repeat(MAX_TEXT_FILE_CHARS + 10), id);
    expect(big.kind === 'ok' && big.truncated && big.request.textFile?.content.length).toBe(MAX_TEXT_FILE_CHARS);
  });
});

describe('revisão e rótulos', () => {
  it('encaixe e aderência', () => {
    expect(fitLabel({ position: 4, total: 46 })).toBe('Entra como #4 de 46');
    expect(fitLabel(null)).toBeNull();
    expect(matchPercent(0.914)).toBe('91%');
    expect(matchPercent(undefined)).toBeNull();
  });
  it('tipo desconhecido (ex.: livro) tem rótulo', () => {
    expect(kindLabel('book')).toBe('Livro');
    expect(kindLabel('podcast_episode')).toBe('Podcast episode');
    expect(titleMeta({ kind: 'book', year: 1899, genres: [] })).toBe('Livro · 1899');
  });
});

describe('adicionar título (RF-46)', () => {
  it('separa filmes/séries e livros escolhidos', () => {
    const keys = [movieKey({ tmdbId: 603, mediaType: 'movie' }), bookKey({ olWorkId: 'OL45883W' }), movieKey({ tmdbId: 1396, mediaType: 'tv' }), 'lixo'];
    expect(splitSelection(keys)).toEqual({
      items: [
        { tmdbId: 603, mediaType: 'movie' },
        { tmdbId: 1396, mediaType: 'tv' },
      ],
      books: [{ olWorkId: 'OL45883W' }],
    });
  });
});

describe('canSwapMusic', () => {
  it('só em música com artista', () => {
    expect(canSwapMusic({ kind: 'music_track', creator: 'Toquinho' })).toBe(true);
    expect(canSwapMusic({ kind: 'music_track' })).toBe(false);
    expect(canSwapMusic({ kind: 'book', creator: 'Machado de Assis' })).toBe(false);
  });
});

describe('bookFavoriteRequest', () => {
  it('leva olWorkId e omite ano fora do contrato', () => {
    expect(bookFavoriteRequest({ title: 'Dom Casmurro', year: 1899, olWorkId: 'OL1W' })).toEqual({ title: 'Dom Casmurro', kind: 'book', year: 1899, olWorkId: 'OL1W' });
    expect(bookFavoriteRequest({ title: 'Hamlet', year: 1603, olWorkId: 'OL5W' })).toEqual({ title: 'Hamlet', kind: 'book', olWorkId: 'OL5W' });
  });
});
