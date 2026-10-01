import type { DeclaredTaste } from '@fruiqo/contracts';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import { __setAccessToken } from '../api/client';
import { mockApi, renderWithProviders } from '../test/helpers';
import { DeclaredTasteSection, favoriteRequest } from './DeclaredTaste';

afterEach(() => __setAccessToken(null));

const FAV = '77777777-7777-4777-8777-777777777777';
const NOW = '2026-09-28T10:00:00.000Z';

function declared(over: Partial<DeclaredTaste> = {}): DeclaredTaste {
  return {
    summary: 'Adoro suspense psicológico.',
    favorites: [{ id: FAV, title: 'Zodíaco', kind: 'movie', year: 2007, rating: 5, comment: 'Obra-prima', genres: [{ key: 'thriller', label: 'Suspense' }], createdAt: NOW }],
    interpreted: { likes: [{ key: 'thriller', label: 'Suspense' }], dislikes: [{ key: 'romance', label: 'Romance' }], likedSubgenres: [], dislikedSubgenres: [] },
    affinities: [{ key: 'thriller', label: 'Suspense', score: 0.8, source: 'both' }],
    ...over,
  };
}

describe('perfil declarado (RF-43)', () => {
  it('mostra favoritos, resumo com contador e o que entendemos com a origem', async () => {
    __setAccessToken('tok');
    const { calls } = mockApi({
      'GET /profile/declared': declared(),
      'PUT /profile/summary': (call) => ({ body: declared({ summary: (call.body as { summary: string }).summary }) }),
      'PATCH /profile/taste': { genres: [], subgenres: [], overrides: { pinned: [], excluded: ['thriller'] }, totals: { signals: 0, watched: 0, rated: 0 } },
    });
    const user = userEvent.setup();
    renderWithProviders(<DeclaredTasteSection />);
    const box = await screen.findByLabelText('Resumo do seu gosto');
    await waitFor(() => expect((box as HTMLTextAreaElement).value).toBe('Adoro suspense psicológico.'));
    expect(screen.getByText('27/2000')).toBeTruthy();
    expect(screen.getByText('Zodíaco')).toBeTruthy();
    expect(screen.getByRole('img', { name: 'Nota: 5 de 5' })).toBeTruthy();
    expect(screen.getByText('favoritos + resumo')).toBeTruthy();

    await user.type(box, ' Nada de romance.');
    expect(screen.getByText('44/2000')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Salvar resumo' }));
    await waitFor(() => expect(calls.some((c) => c.method === 'PUT')).toBe(true));
    expect(calls.find((c) => c.method === 'PUT')?.body).toEqual({ summary: 'Adoro suspense psicológico. Nada de romance.' });

    // entendeu errado: "Suspense" não é algo que gosto → exclui pelo mesmo mecanismo do perfil
    const understood = screen.getByRole('region', { name: 'O que entendemos' });
    await user.click(within(understood).getByRole('button', { name: 'Não gosto de Suspense' }));
    await waitFor(() => expect(calls.some((c) => c.method === 'PATCH')).toBe(true));
    expect(calls.find((c) => c.method === 'PATCH')?.body).toEqual({ exclude: ['thriller'] });
  });

  it('adiciona favorito pela busca com nota e comentário, e remove', async () => {
    __setAccessToken('tok');
    const { calls } = mockApi({
      'GET /profile/declared': declared({ favorites: [] }),
      'GET /search/titles': {
        query: 'zod',
        interpreted: { type: 'title', genres: [], aiUsed: false },
        items: [{ tmdbId: 1949, mediaType: 'movie', kind: 'movie', title: 'Zodíaco', year: 2007, cast: [], inLibrary: null, matchedBy: 'title' }],
      },
      'POST /profile/favorites': (call) => ({ body: { id: FAV, genres: [], createdAt: NOW, ...(call.body as object) } }),
    });
    const user = userEvent.setup();
    renderWithProviders(<DeclaredTasteSection />);
    await screen.findByText('Nenhum favorito ainda.');
    await user.click(screen.getByRole('button', { name: /Adicionar favorito/ }));
    const dialog = await screen.findByRole('dialog', { name: 'Adicionar favoritos' });
    const search = within(dialog).getByRole('searchbox');
    expect(document.activeElement).toBe(search);
    await user.type(search, 'zod');
    await user.click(await within(dialog).findByRole('checkbox', { name: 'Selecionar Zodíaco (2007)' }));
    await user.click(within(dialog).getByRole('button', { name: 'Continuar (1)' }));
    // meia estrela pelo teclado: End = 5, três ← = 3,5
    within(dialog).getByRole('slider', { name: 'Nota' }).focus();
    await user.keyboard('{End}{ArrowLeft}{ArrowLeft}{ArrowLeft}');
    expect(within(dialog).getByRole('slider', { name: 'Nota' }).getAttribute('aria-valuenow')).toBe('3.5');
    await user.type(within(dialog).getByLabelText(/Comentário/), 'Tenso do início ao fim');
    await user.click(within(dialog).getByRole('button', { name: 'Adicionar aos favoritos' }));
    await waitFor(() => expect(calls.some((c) => c.path === '/profile/favorites')).toBe(true));
    expect(calls.find((c) => c.path === '/profile/favorites')?.body).toEqual({
      title: 'Zodíaco',
      kind: 'movie',
      year: 2007,
      tmdbId: 1949,
      mediaType: 'movie',
      rating: 3.5,
      comment: 'Tenso do início ao fim',
    });
  });

  it('vários favoritos de uma vez: marca em buscas diferentes, inclui digitado, nota por título', async () => {
    __setAccessToken('tok');
    const hit = (tmdbId: number, title: string, year: number, inLibrary: unknown = null) => ({
      tmdbId,
      mediaType: 'movie',
      kind: 'movie',
      title,
      year,
      cast: [],
      inLibrary,
      matchedBy: 'title',
    });
    const { calls } = mockApi({
      'GET /profile/declared': declared({ favorites: [] }),
      'GET /search/titles': (call) => ({
        body: {
          query: 'q',
          interpreted: { type: 'title', genres: [], aiUsed: false },
          items: call.path.includes('twilight')
            ? [hit(1, 'Além da Imaginação', 2002, { id: FAV, rank: 3, decision: 'cataloged', status: 'to_watch' })]
            : [hit(2, 'Zodíaco', 2007)],
        },
      }),
      'POST /profile/favorites': (call) => ({ body: { id: FAV, kind: 'movie', genres: [], createdAt: NOW, ...(call.body as object) } }),
    });
    const user = userEvent.setup();
    renderWithProviders(<DeclaredTasteSection />);
    await screen.findByText('Nenhum favorito ainda.');
    await user.click(screen.getByRole('button', { name: /Adicionar favorito/ }));
    const dialog = await screen.findByRole('dialog', { name: 'Adicionar favoritos' });
    const search = within(dialog).getByRole('searchbox');
    await user.type(search, 'twilight');
    // já na Minha Área ainda pode ser favorito
    const twilight = await within(dialog).findByRole('checkbox', { name: 'Selecionar Além da Imaginação (2002)' });
    expect(twilight).toHaveProperty('disabled', false);
    await user.click(twilight);
    await user.clear(search);
    await user.type(search, 'zodiaco');
    await user.click(await within(dialog).findByRole('checkbox', { name: 'Selecionar Zodíaco (2007)' }));
    await user.click(within(dialog).getByText('Não achou? Digite o título'));
    await user.type(within(dialog).getByRole('textbox', { name: 'Título do favorito' }), 'Filme Raro');
    await user.click(within(dialog).getByRole('button', { name: 'Incluir na seleção' }));
    expect(within(within(dialog).getByLabelText('Selecionados')).getAllByText(/./).length).toBeGreaterThanOrEqual(3);

    await user.click(within(dialog).getByRole('button', { name: 'Continuar (3)' }));
    within(dialog).getByRole('slider', { name: 'Nota de Zodíaco' }).focus();
    await user.keyboard('{End}');
    await user.click(within(dialog).getByRole('button', { name: 'Adicionar 3 aos favoritos' }));
    await waitFor(() => expect(calls.filter((c) => c.path === '/profile/favorites')).toHaveLength(3));
    expect(calls.filter((c) => c.path === '/profile/favorites').map((c) => c.body)).toEqual([
      { title: 'Além da Imaginação', kind: 'movie', year: 2002, tmdbId: 1, mediaType: 'movie' },
      { title: 'Zodíaco', kind: 'movie', year: 2007, tmdbId: 2, mediaType: 'movie', rating: 5 },
      { title: 'Filme Raro' },
    ]);
    expect(await screen.findByText('3 favoritos adicionados.')).toBeTruthy();
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Adicionar favoritos' })).toBeNull());
  });

  it('resumo semi-automático: sugerir pelo perfil, melhorar com IA e desfazer; só salva quando clicar', async () => {
    __setAccessToken('tok');
    const { calls } = mockApi({
      'GET /profile/declared': declared({ summary: 'adoro suspense' }),
      'GET /profile/summary/suggestion': { summary: 'Adoro suspense/Thriller. Entre meus favoritos estão Zodíaco (2007).', aiUsed: false },
      'POST /profile/summary/improve': (call) => ({ body: { summary: `Melhorado: ${(call.body as { text: string }).text}`, aiUsed: true } }),
    });
    const user = userEvent.setup();
    renderWithProviders(<DeclaredTasteSection />);
    const box = await screen.findByRole('textbox', { name: 'Resumo do seu gosto' });
    await waitFor(() => expect(box).toHaveProperty('value', 'adoro suspense'));

    await user.click(screen.getByRole('button', { name: 'Sugerir pelo meu perfil' }));
    await waitFor(() => expect(box).toHaveProperty('value', 'Adoro suspense/Thriller. Entre meus favoritos estão Zodíaco (2007).'));
    expect(screen.getByText('Sugerido pelas suas escolhas. Revise e salve.')).toBeTruthy();

    await user.click(screen.getByRole('button', { name: /Melhorar com IA/ }));
    await waitFor(() => expect((box as HTMLTextAreaElement).value.startsWith('Melhorado: Adoro suspense')).toBe(true));
    expect(calls.find((c) => c.path === '/profile/summary/improve')?.body).toEqual({ text: 'Adoro suspense/Thriller. Entre meus favoritos estão Zodíaco (2007).' });

    await user.click(screen.getByRole('button', { name: 'Desfazer' }));
    expect(box).toHaveProperty('value', 'Adoro suspense/Thriller. Entre meus favoritos estão Zodíaco (2007).');
    // nada foi salvo sem clicar em "Salvar resumo"
    expect(calls.some((c) => c.method === 'PUT')).toBe(false);
    expect(screen.getByRole('button', { name: 'Salvar resumo' })).toHaveProperty('disabled', false);
  });

  it('remove um favorito', async () => {
    __setAccessToken('tok');
    const { calls } = mockApi({
      'GET /profile/declared': declared(),
      'DELETE /profile/favorites/:id': () => ({ status: 204 }),
    });
    const user = userEvent.setup();
    renderWithProviders(<DeclaredTasteSection />);
    await user.click(await screen.findByRole('button', { name: 'Remover Zodíaco dos favoritos' }));
    await waitFor(() => expect(calls.some((c) => c.method === 'DELETE')).toBe(true));
    expect(calls.find((c) => c.method === 'DELETE')?.path).toBe(`/profile/favorites/${FAV}`);
  });
});

describe('favoriteRequest (RF-48)', () => {
  const base = { key: 'k', people: [], inLibrary: null };
  it('livro leva olWorkId; ano antigo fica para o servidor', () => {
    expect(favoriteRequest({ ...base, kind: 'book', title: 'Dom Casmurro', year: 1899, ref: { olWorkId: 'OL1234W' } })).toEqual({
      title: 'Dom Casmurro',
      kind: 'book',
      year: 1899,
      olWorkId: 'OL1234W',
    });
    expect(favoriteRequest({ ...base, kind: 'book', title: 'Hamlet', year: 1603, ref: { olWorkId: 'OL5W' } })).toEqual({
      title: 'Hamlet',
      kind: 'book',
      olWorkId: 'OL5W',
    });
  });
  it('filme leva tmdbId/mediaType', () => {
    expect(favoriteRequest({ ...base, kind: 'movie', title: 'Zodíaco', year: 2007, ref: { tmdbId: 1949, mediaType: 'movie' } })).toEqual({
      title: 'Zodíaco',
      kind: 'movie',
      year: 2007,
      tmdbId: 1949,
      mediaType: 'movie',
    });
  });
});
