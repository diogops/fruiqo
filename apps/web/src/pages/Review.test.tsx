import type { ReviewItem } from '@fruiqo/contracts';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import { __setAccessToken } from '../api/client';
import { makeTitle, mockApi, renderWithProviders } from '../test/helpers';
import { Review } from './Review';

afterEach(() => __setAccessToken(null));

function item(title: string): ReviewItem {
  return {
    title: makeTitle({ title, decision: 'review_queue', confidence: 0.3 }),
    candidate: { rawTitle: title.toLowerCase(), confidenceScore: 0.3, reason: 'low_confidence' },
    share: null,
  };
}

describe('fila de revisão (RF-28)', () => {
  it('todo o fluxo funciona só pelo teclado', async () => {
    __setAccessToken('tok');
    let queue = [item('Primeiro'), item('Segundo'), item('Terceiro')];
    const approved: string[] = [];
    const rejected: string[] = [];
    const rematched: { id: string; body: unknown }[] = [];
    const idOf = (path: string) => path.split('/')[2];
    mockApi({
      'GET /review': () => ({ body: { items: queue } }),
    });
    // rotas com id dinâmico: embrulha o fetch já mockado
    const base = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = new URL(String(input)).pathname;
      const id = idOf(path);
      const found = queue.find((q) => q.title.id === id);
      if (init?.method === 'POST' && found) {
        queue = queue.filter((q) => q.title.id !== id);
        if (path.endsWith('/approve')) {
          approved.push(found.title.title);
          return new Response(JSON.stringify(found.title), { status: 200 });
        }
        if (path.endsWith('/reject')) {
          rejected.push(found.title.title);
          return new Response(null, { status: 204 });
        }
        if (path.endsWith('/rematch')) {
          const body = JSON.parse(String(init.body));
          rematched.push({ id, body });
          return new Response(JSON.stringify({ ...found.title, title: body.title }), { status: 200 });
        }
      }
      return base(input, init);
    }) as typeof fetch;

    const user = userEvent.setup();
    renderWithProviders(<Review />);
    await screen.findByText('Primeiro');

    // ? mostra a ajuda
    await user.keyboard('?');
    expect(screen.getByRole('note', { name: 'Atalhos de teclado' })).toBeTruthy();
    await user.keyboard('{Escape}');

    // J vai para o segundo e A aprova
    await user.keyboard('j');
    expect(screen.getByRole('option', { selected: true }).textContent).toContain('Segundo');
    await user.keyboard('a');
    await waitFor(() => expect(approved).toEqual(['Segundo']));
    await waitFor(() => expect(screen.queryByText('Segundo')).toBeNull());

    // K volta ao primeiro e R rejeita
    await user.keyboard('k');
    expect(screen.getByRole('option', { selected: true }).textContent).toContain('Primeiro');
    await user.keyboard('r');
    await waitFor(() => expect(rejected).toEqual(['Primeiro']));
    await waitFor(() => expect(screen.queryByText('Primeiro')).toBeNull());

    // E abre a correção; digita o título certo e Enter envia (rematch)
    await user.keyboard('e');
    const input = await screen.findByLabelText('Título');
    expect(document.activeElement).toBe(input);
    await user.clear(input);
    await user.keyboard('Terceiro Corrigido{Enter}');
    await waitFor(() => expect(rematched).toHaveLength(1));
    expect(rematched[0].body).toMatchObject({ title: 'Terceiro Corrigido', kind: 'movie' });
    await screen.findByText('Nada para revisar. 🎉');
  });
});

describe('revisão de música e origem', () => {
  it('mostra artista, origem "texto" e troca música/artista', async () => {
    __setAccessToken('tok');
    const song: ReviewItem = {
      title: makeTitle({ title: 'Toquinho', creator: 'Aquarela', kind: 'music_track', decision: 'review_queue', confidence: 0.5 }),
      candidate: null,
      share: { id: '99999999-9999-4999-8999-999999999999', platform: 'other', origin: 'text' },
    };
    let queue = [song];
    const { calls } = mockApi({
      'GET /review': () => ({ body: { items: queue } }),
    });
    const base = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = new URL(String(input)).pathname;
      if (init?.method === 'POST' && path.endsWith('/swap-music')) {
        const swapped = { ...song.title, title: 'Aquarela', creator: 'Toquinho' };
        queue = [{ ...song, title: swapped }];
        return new Response(JSON.stringify(swapped), { status: 200 });
      }
      return base(input, init);
    }) as typeof fetch;

    const user = userEvent.setup();
    renderWithProviders(<Review />);
    await screen.findByText('Toquinho');
    expect(document.querySelector('.review-creator')?.textContent).toBe(' — Aquarela');
    expect(screen.getByText('de texto', { exact: false })).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Trocar música/artista' }));
    await waitFor(() => expect(document.querySelector('.review-creator')?.textContent).toBe(' — Toquinho'));
    expect(screen.getByText('Aquarela')).toBeTruthy();
    expect(calls.length).toBeGreaterThan(0);
  });
});
