import type { TonightResponse } from '@fruiqo/contracts';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { __setAccessToken } from '../api/client';
import { makeTitle, mockApi, renderWithProviders } from '../test/helpers';
import { TonightPanel } from './Tonight';

afterEach(() => __setAccessToken(null));

const taxonomy = { version: 1, genres: [{ key: 'thriller', label: 'Suspense/Thriller' }], subgenres: [] };
const item = (tmdbId: number, title: string, aiReason: string) => ({
  tmdbId,
  mediaType: 'movie' as const,
  kind: 'movie' as const,
  title,
  year: 2013,
  cast: ['Hugh Jackman'],
  inLibrary: null,
  matchedBy: 'description' as const,
  aiReason,
  availableOn: ['Netflix'],
});

describe('"O que assistir hoje?" (D-25)', () => {
  it('pede com tipo/gênero/humor, mostra motivo e streaming, novas sugestões sem repetir, "já assisti" e "quero assistir"', async () => {
    __setAccessToken('tok');
    let round = 0;
    const responses: TonightResponse[] = [
      { aiUsed: true, request: 'Hoje: filme de Suspense/Thriller', services: ['Netflix'], items: [item(1, 'Prisioneiros', 'suspense pesado'), item(2, 'Zodíaco', 'investigação obsessiva')] },
      { aiUsed: true, services: ['Netflix'], items: [item(3, 'Garota Exemplar', 'reviravolta')] },
    ];
    const { calls } = mockApi({
      'GET /taxonomy/genres': taxonomy,
      'POST /tonight': () => ({ body: responses[round++] }),
      'POST /tonight/watched': makeTitle({ title: 'Prisioneiros', status: 'watched' }),
      'POST /library/import': { created: [makeTitle({ title: 'Zodíaco' })], skipped: [] },
    });
    const user = userEvent.setup();
    renderWithProviders(<TonightPanel onClose={vi.fn()} />);

    await user.click(screen.getByRole('radio', { name: 'Filme' }));
    await user.selectOptions(await screen.findByRole('combobox', { name: 'Gênero' }), 'thriller');
    await user.type(screen.getByLabelText(/Como você está hoje/), 'quero algo tenso');
    await user.click(screen.getByRole('button', { name: /Sugerir/ }));

    const list = await screen.findByRole('list', { name: 'Sugestões para hoje' });
    expect(calls.find((c) => c.path === '/tonight')?.body).toEqual({ kind: 'movie', genre: 'thriller', mood: 'quero algo tenso' });
    expect(within(list).getByText('suspense pesado')).toBeTruthy();
    expect(within(list).getAllByText('Em: Netflix')).toHaveLength(2);
    expect(screen.getByText('Só o que está em: Netflix.')).toBeTruthy();
    expect(screen.getByText('Hoje: filme de Suspense/Thriller')).toBeTruthy();

    // "Já assisti" grava e some da lista
    const first = within(list).getAllByRole('listitem')[0]!;
    await user.click(within(first).getByRole('button', { name: /Já assisti/ }));
    await waitFor(() => expect(calls.find((c) => c.path === '/tonight/watched')?.body).toEqual({ tmdbId: 1, mediaType: 'movie' }));
    await waitFor(() => expect(within(list).queryByText('Prisioneiros')).toBeNull());
    // "Quero assistir" importa para a Minha Área
    await user.click(within(list).getByRole('button', { name: 'Quero assistir' }));
    await waitFor(() => expect(calls.find((c) => c.path === '/library/import')?.body).toEqual({ items: [{ tmdbId: 2, mediaType: 'movie' }] }));

    // novas sugestões: manda o que já apareceu
    await user.click(screen.getByRole('button', { name: /Novas sugestões/ }));
    expect(await screen.findByText('Garota Exemplar')).toBeTruthy();
    expect(calls.filter((c) => c.path === '/tonight')[1]!.body).toMatchObject({ exclude: ['movie:1', 'movie:2'] });
  });

  it('sem IA: explica, e sem streaming cadastrado convida a cadastrar; risco mostra o CVV', async () => {
    __setAccessToken('tok');
    let round = 0;
    const responses: TonightResponse[] = [
      { aiUsed: false, unavailable: 'consent', services: [], items: [] },
      {
        aiUsed: false,
        services: [],
        items: [],
        risk: { title: 'Você não está sozinho', message: 'Fale com alguém agora.', cvvPhone: '188', cvvUrl: 'https://cvv.org.br', emergencyPhone: '192', continueLabel: 'Continuar' },
      },
    ];
    mockApi({ 'GET /taxonomy/genres': taxonomy, 'POST /tonight': () => ({ body: responses[round++] }) });
    const user = userEvent.setup();
    renderWithProviders(<TonightPanel onClose={vi.fn()} />);
    await user.click(screen.getByRole('button', { name: /Sugerir/ }));
    expect(await screen.findByText(/IA não permitida/)).toBeTruthy();
    expect(screen.getByText(/Cadastre seus streamings/)).toBeTruthy();
    expect(screen.getByText('Nada novo desta vez. Mude o gênero ou o humor e busque de novo.')).toBeTruthy();

    await user.click(screen.getByRole('button', { name: /Buscar de novo/ }));
    const alert = await screen.findByRole('alert');
    expect(within(alert).getByRole('link', { name: '188' })).toBeTruthy();
    expect(screen.queryByRole('list', { name: 'Sugestões para hoje' })).toBeNull();
  });
});
