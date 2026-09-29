import type { ReviewItem } from '@fruiqo/contracts';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import { __setAccessToken } from '../api/client';
import { makeTitle, mockApi, renderWithProviders } from '../test/helpers';
import { Review } from './Review';

afterEach(() => __setAccessToken(null));

const LIST_ID = '11111111-1111-4111-8111-111111111111';
const SHARE_ID = '22222222-2222-4222-8222-222222222222';

function rich(): ReviewItem {
  const before = makeTitle({ title: 'Anterior' });
  return {
    title: makeTitle({ title: 'Duna', year: 2021, decision: 'review_queue', matchScore: 0.62, rank: null }),
    fit: { position: 3, total: 10, score: 0.4, reasons: ['Ficção científica, que você curte'], before: { id: before.id, title: 'Anterior', rank: 3 } },
    alternatives: [
      { tmdbId: 841, mediaType: 'movie', title: 'Duna', year: 1984, score: 0.55 },
      { tmdbId: 90228, mediaType: 'tv', title: 'Duna: A Profecia', year: 2024, score: 0.4 },
    ],
    proposedList: { name: 'Sci-fi do post', shareId: SHARE_ID, listId: null },
    duplicateOf: null,
    candidate: { rawTitle: 'duna', confidenceScore: 0.6, reason: 'ok' },
    share: { id: SHARE_ID, platform: 'instagram', origin: 'screenshot' },
  };
}

describe('conferir a obra na revisão', () => {
  it('título e capa abrem o TMDB, IMDb quando houver, e cada alternativa tem o próprio link', async () => {
    __setAccessToken('tok');
    const it1 = rich();
    it1.title = {
      ...it1.title,
      resolution: { provider: 'tmdb', externalId: 'movie:438631', title: 'Duna', url: 'https://www.themoviedb.org/movie/438631', tmdbId: 438631, mediaType: 'movie', imdbId: 'tt1160419' },
    };
    mockApi({ 'GET /review': { items: [it1] } });
    const user = userEvent.setup();
    renderWithProviders(<Review />);
    await screen.findByText('Entra em #3 de 10');
    const tmdb = screen.getAllByRole('link', { name: 'Ver Duna no TMDB (abre em nova aba)' });
    expect(tmdb).toHaveLength(2);
    expect(tmdb[0]!.getAttribute('href')).toBe('https://www.themoviedb.org/movie/438631');
    expect(tmdb[0]!.getAttribute('target')).toBe('_blank');
    expect(screen.getByRole('link', { name: 'Ver Duna no IMDb (abre em nova aba)' }).getAttribute('href')).toBe('https://www.imdb.com/title/tt1160419/');

    const alts = screen.getByRole('group', { name: 'Outras opções para Duna' });
    expect(within(alts).getByRole('link', { name: 'Ver Duna: A Profecia (2024) no TMDB (abre em nova aba)' }).getAttribute('href')).toBe(
      'https://www.themoviedb.org/tv/90228',
    );
    // escolhida a alternativa, o título passa a abrir a página dela (e o IMDb do match antigo some)
    await user.click(within(alts).getByRole('button', { name: /1984/ }));
    expect(screen.getAllByRole('link', { name: 'Ver Duna no TMDB (abre em nova aba)' })[0]!.getAttribute('href')).toBe('https://www.themoviedb.org/movie/841');
    expect(screen.queryByRole('link', { name: /IMDb/ })).toBeNull();
  });
});

describe('revisão com encaixe, alternativas e lote (RF-42)', () => {
  it('mostra encaixe sugerido, lista proposta e aprova com a alternativa escolhida e sem a lista', async () => {
    __setAccessToken('tok');
    const it1 = rich();
    let queue = [it1];
    const { calls } = mockApi({
      'GET /review': () => ({ body: { items: queue } }),
      'POST /review/:id/approve': () => {
        queue = [];
        return { body: { ...it1.title, year: 1984, rank: 3 } };
      },
    });
    const user = userEvent.setup();
    renderWithProviders(<Review />);
    await screen.findByText('Entra em #3 de 10');
    expect(screen.getByText(/antes de "Anterior" \(#3\)/)).toBeTruthy();
    expect(screen.getByText('Ficção científica, que você curte')).toBeTruthy();

    // troca o match com um clique e desmarca a lista proposta
    const alts = screen.getByRole('group', { name: 'Outras opções para Duna' });
    await user.click(within(alts).getByRole('button', { name: /1984/ }));
    expect(within(alts).getByRole('button', { name: /1984/ }).getAttribute('aria-pressed')).toBe('true');
    await user.click(screen.getByRole('checkbox', { name: /Incluir na lista "Sci-fi do post"/ }));

    await user.click(screen.getByRole('button', { name: 'Aprovar' }));
    await waitFor(() => expect(calls.some((c) => c.path.endsWith('/approve'))).toBe(true));
    const call = calls.find((c) => c.path.endsWith('/approve'));
    expect(call?.body).toEqual({ alternative: { tmdbId: 841, mediaType: 'movie' }, useProposedList: false });
    await screen.findByText('Nada para revisar. 🎉');
  });

  it('"Ajustar…" aprova no topo com lista extra e correção do ano', async () => {
    __setAccessToken('tok');
    const it1 = rich();
    const { calls } = mockApi({
      'GET /review': { items: [it1] },
      'GET /lists': [{ id: LIST_ID, name: 'Fim de semana', sourceShareId: null, pinned: false, itemCount: 2, doneCount: 0, createdAt: '2026-09-28T10:00:00.000Z', updatedAt: '2026-09-28T10:00:00.000Z' }],
      'POST /review/:id/approve': { ...it1.title, rank: 1 },
    });
    const user = userEvent.setup();
    renderWithProviders(<Review />);
    await screen.findByText('Duna');
    await user.click(screen.getByRole('button', { name: 'Ajustar…' }));
    const dialog = await screen.findByRole('dialog', { name: 'Aprovar "Duna"' });
    await user.click(within(dialog).getByRole('radio', { name: /Topo/ }));
    await user.click(await within(dialog).findByRole('checkbox', { name: 'Fim de semana' }));
    await user.click(within(dialog).getByText('Corrigir título, tipo ou ano'));
    const year = within(dialog).getByLabelText('Ano');
    await user.clear(year);
    await user.type(year, '2020');
    await user.click(within(dialog).getByRole('button', { name: 'Aprovar' }));
    await waitFor(() => expect(calls.some((c) => c.path.endsWith('/approve'))).toBe(true));
    expect(calls.find((c) => c.path.endsWith('/approve'))?.body).toEqual({
      placement: 'top',
      listIds: [LIST_ID],
      useProposedList: true,
      year: 2020,
    });
  });

  it('aprova e rejeita em lote os itens marcados (X marca pelo teclado)', async () => {
    __setAccessToken('tok');
    const a = { ...rich(), title: makeTitle({ title: 'Alfa', decision: 'review_queue' }) };
    const b = { ...rich(), title: makeTitle({ title: 'Beta', decision: 'review_queue' }) };
    const c = { ...rich(), title: makeTitle({ title: 'Gama', decision: 'review_queue' }) };
    const { calls } = mockApi({
      'GET /review': { items: [a, b, c] },
      'POST /review/batch': (call) => {
        const body = call.body as { ids: string[]; action: string };
        return { body: body.action === 'approve' ? { approved: [a.title, b.title], rejected: 0, failed: [] } : { approved: [], rejected: 1, failed: [] } };
      },
    });
    const user = userEvent.setup();
    renderWithProviders(<Review />);
    await screen.findByText('Alfa');
    const approveBtn = screen.getByRole('button', { name: 'Aprovar marcados' });
    expect(approveBtn).toHaveProperty('disabled', true);
    await user.keyboard('x');
    await user.keyboard('j');
    await user.keyboard('x');
    expect(screen.getByText('2 marcado(s)')).toBeTruthy();
    await user.click(approveBtn);
    await waitFor(() => expect(calls.some((q) => q.path === '/review/batch')).toBe(true));
    expect(calls.find((q) => q.path === '/review/batch')?.body).toEqual({ ids: [a.title.id, b.title.id], action: 'approve', placement: 'suggested' });
    await screen.findByText('2 título(s) aprovado(s).');

    await user.click(screen.getByRole('checkbox', { name: 'Marcar Gama' }));
    await user.click(screen.getByRole('button', { name: 'Rejeitar marcados' }));
    await waitFor(() => expect(calls.filter((q) => q.path === '/review/batch')).toHaveLength(2));
    expect(calls.filter((q) => q.path === '/review/batch')[1].body).toEqual({ ids: [c.title.id], action: 'reject' });
  });

  it('avisa de duplicata e mescla; alternativas de livro também aparecem', async () => {
    __setAccessToken('tok');
    const dup = makeTitle({ title: 'Duna (já na lista)', rank: 7 });
    const it1: ReviewItem = {
      ...rich(),
      title: makeTitle({ title: 'O Hobbit', kind: 'book', decision: 'review_queue' }),
      alternatives: [],
      bookAlternatives: [{ olWorkId: 'OL27482W', title: 'The Hobbit', authors: ['J.R.R. Tolkien'], year: 1937, score: 0.7 }],
      duplicateOf: { id: dup.id, title: 'O Hobbit', rank: 7 },
    };
    const { calls } = mockApi({
      'GET /review': { items: [it1] },
      'POST /library/:id/merge': { ...dup },
    });
    const user = userEvent.setup();
    renderWithProviders(<Review />);
    await screen.findByText(/Parece ser o mesmo que "O Hobbit" \(#7\)/);
    expect(screen.getByText(/Livro/)).toBeTruthy();
    expect(screen.getByRole('button', { name: /The Hobbit \(1937\) · J\.R\.R\. Tolkien/ })).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Mesclar' }));
    await waitFor(() => expect(calls.some((c) => c.path.endsWith('/merge'))).toBe(true));
    expect(calls.find((c) => c.path.endsWith('/merge'))?.body).toEqual({ intoId: dup.id });
  });
});
