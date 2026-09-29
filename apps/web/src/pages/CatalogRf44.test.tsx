import { fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import { __setAccessToken } from '../api/client';
import { makeTitle, mockApi, renderWithProviders } from '../test/helpers';
import { Catalog } from './Catalog';

afterEach(() => __setAccessToken(null));

const NOW = '2026-09-28T10:00:00.000Z';

function base(extra: Parameters<typeof mockApi>[0] = {}) {
  const items = [makeTitle({ title: 'Oppenheimer', rank: 1 }), makeTitle({ title: 'Aftersun', rank: 2 })];
  return {
    items,
    ...mockApi({
      'GET /taxonomy/genres': { version: 1, genres: [], subgenres: [] },
      'GET /lists': [],
      'GET /library': { items, nextCursor: null },
      ...extra,
    }),
  };
}

describe('catálogo: ocultar assistidos', () => {
  it('por padrão esconde os assistidos; desmarcar mostra; status "Assistido" ignora a caixa', async () => {
    __setAccessToken('tok');
    const { calls } = base();
    const user = userEvent.setup();
    renderWithProviders(<Catalog />, { route: '/catalogo' });
    await screen.findByText('Oppenheimer');
    const libraryCalls = () => calls.filter((c) => c.path.startsWith('/library?') || c.path === '/library').map((c) => c.path);
    expect(libraryCalls().at(-1)).toContain('hideWatched=1');

    const box = screen.getByRole('checkbox', { name: 'Ocultar assistidos' }) as HTMLInputElement;
    expect(box.checked).toBe(true);
    await user.click(box);
    await waitFor(() => expect(libraryCalls().at(-1)).not.toContain('hideWatched'));
    expect(box.checked).toBe(false);

    await user.click(box);
    await waitFor(() => expect(libraryCalls().at(-1)).toContain('hideWatched=1'));
    await user.selectOptions(screen.getAllByRole('combobox', { name: 'Status' })[0]!, 'watched');
    await waitFor(() => expect(libraryCalls().at(-1)).toContain('status=watched'));
    expect(libraryCalls().at(-1)).not.toContain('hideWatched');
    expect((screen.getByRole('checkbox', { name: 'Ocultar assistidos' }) as HTMLInputElement).disabled).toBe(true);
  });
});

describe('catálogo: rascunho de priorização e importação (RF-44/RF-47)', () => {
  it('"Sugerir priorização" gera o rascunho e troca a lista pelo modo rascunho', async () => {
    __setAccessToken('tok');
    let created = false;
    const { items, calls } = base({
      'GET /library/priority-draft': () =>
        created
          ? {
              body: {
                createdAt: NOW,
                updatedAt: NOW,
                stale: false,
                items: [
                  { title: items[1], currentRank: 2, proposedRank: 1, delta: 1, reason: 'Drama, que você curte', score: 0.6 },
                  { title: items[0], currentRank: 1, proposedRank: 2, delta: -1, reason: 'Sem sinais', score: 0 },
                ],
              },
            }
          : { status: 404, body: { error: 'not_found', message: 'sem rascunho' } },
      'POST /library/priority-draft': () => {
        created = true;
        return {
          body: {
            createdAt: NOW,
            updatedAt: NOW,
            stale: false,
            items: [
              { title: items[1], currentRank: 2, proposedRank: 1, delta: 1, reason: 'Drama, que você curte', score: 0.6 },
              { title: items[0], currentRank: 1, proposedRank: 2, delta: -1, reason: 'Sem sinais', score: 0 },
            ],
          },
        };
      },
    });
    const user = userEvent.setup();
    renderWithProviders(<Catalog />, { route: '/catalogo' });
    await screen.findByText('Oppenheimer');
    await user.click(screen.getByRole('button', { name: /Sugerir priorização/ }));
    await user.click(screen.getByRole('button', { name: 'Só o que quero ver' }));
    await screen.findByText('Rascunho — nada foi aplicado ainda.');
    expect(calls.find((c) => c.method === 'POST' && c.path === '/library/priority-draft')?.body).toEqual({ scope: 'to_watch' });
    expect(screen.getByText('Drama, que você curte')).toBeTruthy();
    // a lista real some enquanto o rascunho está aberto
    expect(screen.queryByRole('search')).toBeNull();
  });

  it('soltar um .txt no catálogo abre a importação já com a prévia', async () => {
    __setAccessToken('tok');
    base();
    renderWithProviders(<Catalog />, { route: '/catalogo' });
    await screen.findByText('Oppenheimer');
    const zone = screen.getByRole('heading', { name: 'Catálogo' }).closest('section') as HTMLElement;
    const file = new File(['Duna\nMaid'], 'lista.txt', { type: 'text/plain' });
    fireEvent.dragOver(zone, { dataTransfer: { files: [file], types: ['Files'] } });
    fireEvent.drop(zone, { dataTransfer: { files: [file], types: ['Files'] } });
    await screen.findByRole('dialog', { name: 'Importar arquivo (.txt)' });
    await waitFor(() => expect(screen.getByLabelText('Prévia do arquivo').textContent).toContain('Maid'));
  });
});
