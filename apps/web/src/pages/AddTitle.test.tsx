import type { TitleSearchResponse } from '@fruiqo/contracts';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { __setAccessToken } from '../api/client';
import { makeTitle, mockApi, renderWithProviders } from '../test/helpers';
import { AddTitle } from './AddTitle';

afterEach(() => __setAccessToken(null));

const EXISTING = '44444444-4444-4444-8444-444444444444';

function response(over: Partial<TitleSearchResponse['interpreted']> = {}): TitleSearchResponse {
  return {
    query: 'q',
    interpreted: { type: 'title', genres: [], aiUsed: false, ...over },
    items: [
      { tmdbId: 438631, mediaType: 'movie', kind: 'movie', title: 'Duna', year: 2021, cast: ['Timothée Chalamet', 'Zendaya'], overview: 'Paul Atreides…', inLibrary: null, matchedBy: 'title' },
      { tmdbId: 841, mediaType: 'movie', kind: 'movie', title: 'Duna', year: 1984, cast: ['Kyle MacLachlan'], inLibrary: { id: EXISTING, rank: 12, decision: 'cataloged' }, matchedBy: 'title' },
      { tmdbId: 90228, mediaType: 'tv', kind: 'series', title: 'Duna: A Profecia', year: 2024, cast: [], inLibrary: null, matchedBy: 'title' },
    ],
    books: [
      { olWorkId: 'OL893415W', title: 'Duna', authors: ['Frank Herbert'], year: 1965, url: 'https://openlibrary.org/works/OL893415W', inLibrary: null, matchedBy: 'title' },
    ],
  } as TitleSearchResponse;
}

describe('conferir a obra antes de incluir', () => {
  it('capa e título abrem a página da obra (TMDB ou Open Library) em aba nova', async () => {
    __setAccessToken('tok');
    mockApi({ 'GET /search/titles': response(), 'GET /lists': [] });
    const user = userEvent.setup();
    renderWithProviders(<AddTitle onClose={vi.fn()} />);
    await user.type(screen.getByRole('searchbox', { name: 'Buscar filme, série ou livro' }), 'duna');
    await screen.findByText('com Timothée Chalamet, Zendaya');
    const results = screen.getByRole('list', { name: 'Resultados da busca' });
    const serie = within(results).getAllByRole('link', { name: 'Ver Duna: A Profecia no TMDB (abre em nova aba)' });
    expect(serie).toHaveLength(2); // capa e título
    for (const a of serie) {
      expect(a.getAttribute('href')).toBe('https://www.themoviedb.org/tv/90228');
      expect(a.getAttribute('target')).toBe('_blank');
      expect(a.getAttribute('rel')).toContain('noopener');
    }
    const livro = within(results).getAllByRole('link', { name: 'Ver Duna no Open Library (abre em nova aba)' });
    expect(livro[0]!.getAttribute('href')).toBe('https://openlibrary.org/works/OL893415W');
  });
});

describe('adicionar título por busca (RF-46)', () => {
  it('foca o campo, mostra cards com elenco e "já está na sua lista", e envia os marcados para a revisão', async () => {
    __setAccessToken('tok');
    const onClose = vi.fn();
    const { calls } = mockApi({
      'GET /search/titles': response(),
      'GET /lists': [],
      'POST /library/import': { created: [makeTitle({ title: 'Duna' }), makeTitle({ title: 'Duna: A Profecia' })], skipped: [] },
    });
    const user = userEvent.setup();
    renderWithProviders(<AddTitle onClose={onClose} />);
    const input = screen.getByRole('searchbox', { name: 'Buscar filme, série ou livro' });
    expect(document.activeElement).toBe(input);
    await user.type(input, 'duna');

    await screen.findByText('com Timothée Chalamet, Zendaya');
    const results = screen.getByRole('list', { name: 'Resultados da busca' });
    expect(within(results).getByText('já está na sua lista (#12)')).toBeTruthy();
    expect(within(results).getByRole('checkbox', { name: 'Selecionar Duna (1984)' })).toHaveProperty('disabled', true);
    expect(within(results).getByText('de Frank Herbert')).toBeTruthy();
    expect(screen.getByText(/TMDB/)).toBeTruthy();
    expect(calls.find((c) => c.path.startsWith('/search/titles'))?.path).toBe('/search/titles?q=duna');

    await user.click(within(results).getByRole('checkbox', { name: 'Selecionar Duna (2021)' }));
    await user.click(within(results).getByRole('checkbox', { name: 'Selecionar Duna: A Profecia (2024)' }));
    await user.click(within(results).getByRole('checkbox', { name: 'Selecionar Duna (1965)' }));
    expect(screen.getByText('3 selecionado(s)')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Enviar para revisão' }));

    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(calls.find((c) => c.path === '/library/import')?.body).toEqual({
      items: [
        { tmdbId: 438631, mediaType: 'movie' },
        { tmdbId: 90228, mediaType: 'tv' },
      ],
      books: [{ olWorkId: 'OL893415W' }],
    });
  });

  it('"Aprovar já" manda approveNow; busca por descrição indica IA ou o fallback por palavras-chave', async () => {
    __setAccessToken('tok');
    let ai = true;
    const { calls } = mockApi({
      'GET /search/titles': () => ({ body: response({ type: 'description', aiUsed: ai }) }),
      'GET /lists': [],
      'POST /library/import': { created: [makeTitle()], skipped: [] },
    });
    const user = userEvent.setup();
    renderWithProviders(<AddTitle onClose={vi.fn()} />);
    const input = screen.getByRole('searchbox', { name: 'Buscar filme, série ou livro' });
    await user.type(input, 'filme do verme gigante no deserto');
    expect(await screen.findByText('interpretado com IA')).toBeTruthy();

    ai = false;
    await user.type(input, 's');
    expect(await screen.findByText(/IA não usada: busca por palavras-chave/)).toBeTruthy();

    await user.click(screen.getByRole('checkbox', { name: 'Selecionar Duna (2021)' }));
    await user.click(screen.getByRole('button', { name: 'Aprovar já' }));
    await waitFor(() => expect(calls.some((c) => c.path === '/library/import')).toBe(true));
    expect(calls.find((c) => c.path === '/library/import')?.body).toEqual({ items: [{ tmdbId: 438631, mediaType: 'movie' }], approveNow: true });
  });

  it('"Buscar com IA" manda o pedido inteiro para a IA (ai=1); em "Só livros" fica desligado', async () => {
    __setAccessToken('tok');
    const { calls } = mockApi({ 'GET /search/titles': response({ type: 'description', aiUsed: true }), 'GET /lists': [] });
    const user = userEvent.setup();
    renderWithProviders(<AddTitle onClose={vi.fn()} />);
    const ai = screen.getByRole('button', { name: /Buscar com IA/ });
    await user.click(ai);
    expect(ai.getAttribute('aria-pressed')).toBe('true');
    await user.type(screen.getByRole('searchbox', { name: 'Buscar filme, série ou livro' }), 'filme recente de faroeste');
    await waitFor(() => expect(calls.some((c) => c.path.includes('ai=1'))).toBe(true));
    expect(calls.filter((c) => c.path.startsWith('/search/titles')).at(-1)?.path).toContain('q=filme+recente+de+faroeste');
    await user.selectOptions(screen.getByRole('combobox', { name: 'Tipo da busca' }), 'book');
    expect((screen.getByRole('button', { name: /Buscar com IA/ }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('a aba Manual mantém o cadastro direto, com "Livro" entre os tipos', async () => {
    __setAccessToken('tok');
    mockApi({ 'GET /lists': [] });
    const user = userEvent.setup();
    renderWithProviders(<AddTitle onClose={vi.fn()} />);
    await user.click(screen.getByRole('tab', { name: /Manual/ }));
    expect(document.activeElement).toBe(screen.getByLabelText('Título'));
    expect(screen.getByRole('option', { name: 'Livro' })).toBeTruthy();
  });
});
