import type { PriorityDraft } from '@fruiqo/contracts';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { __setAccessToken } from '../api/client';
import { makeTitle, mockApi, renderWithProviders } from '../test/helpers';
import { PriorityDraftView } from './PriorityDraft';

afterEach(() => __setAccessToken(null));

const UNDO = '33333333-3333-4333-8333-333333333333';
const NOW = '2026-09-28T10:00:00.000Z';

function draft(): PriorityDraft {
  const a = makeTitle({ title: 'Alfa', rank: 1 });
  const b = makeTitle({ title: 'Beta', rank: 2 });
  const c = makeTitle({ title: 'Gama', rank: 3 });
  return {
    createdAt: NOW,
    updatedAt: NOW,
    stale: false,
    items: [
      { title: c, currentRank: 3, proposedRank: 1, delta: 2, reason: 'Suspense, que você curte', score: 0.8 },
      { title: a, currentRank: 1, proposedRank: 2, delta: -1, reason: 'Sem sinais fortes', score: 0.2 },
      { title: b, currentRank: 2, proposedRank: 3, delta: -1, reason: 'Você deu nota baixa a parecidos', score: -0.3 },
    ],
  };
}

describe('rascunho de priorização (RF-44)', () => {
  it('mostra a faixa de rascunho, variação ↑/↓ e motivo; mover chama PATCH no rascunho', async () => {
    __setAccessToken('tok');
    const d = draft();
    const { calls } = mockApi({ 'PATCH /library/priority-draft': d });
    const user = userEvent.setup();
    renderWithProviders(<PriorityDraftView draft={d} onExit={vi.fn()} />);
    const banner = screen.getByRole('region', { name: 'Rascunho de priorização' });
    expect(within(banner).getByText('Rascunho — nada foi aplicado ainda.')).toBeTruthy();
    expect(screen.getByLabelText('sobe 2')).toBeTruthy();
    expect(screen.getAllByLabelText('desce 1')).toHaveLength(2);
    expect(screen.getByText('Suspense, que você curte')).toBeTruthy();

    await user.click(screen.getByRole('button', { name: 'Mover Beta para o topo' }));
    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0]).toMatchObject({ method: 'PATCH', body: { id: d.items[2].title.id, move: { to: 'top' } } });
  });

  it('Aplicar mostra Desfazer; Desfazer restaura a ordem anterior', async () => {
    __setAccessToken('tok');
    const onExit = vi.fn();
    const { calls } = mockApi({
      'POST /library/priority-draft/apply': { applied: 3, undoToken: UNDO, undoExpiresAt: NOW },
      'POST /library/bulk/undo': { restored: 3 },
    });
    const user = userEvent.setup();
    renderWithProviders(<PriorityDraftView draft={draft()} onExit={onExit} />);
    await user.click(screen.getByRole('button', { name: 'Aplicar' }));
    await screen.findByText('Priorização aplicada em 3 título(s).');
    expect(onExit).toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Desfazer' }));
    await waitFor(() => expect(calls.some((c) => c.path === '/library/bulk/undo')).toBe(true));
    expect(calls.find((c) => c.path === '/library/bulk/undo')?.body).toEqual({ undoToken: UNDO });
  });

  it('409 (fila mudou) abre o diálogo com o resumo e permite aplicar reconciliando', async () => {
    __setAccessToken('tok');
    let attempts = 0;
    const { calls } = mockApi({
      'POST /library/priority-draft/apply': (call) => {
        attempts += 1;
        if (!(call.body as { reconcile?: string }).reconcile) {
          return { status: 409, body: { error: 'draft_stale', message: 'A fila mudou.', staleDetails: { added: 2, removed: 1 } } };
        }
        return { body: { applied: 5, undoToken: UNDO, undoExpiresAt: NOW } };
      },
    });
    const user = userEvent.setup();
    renderWithProviders(<PriorityDraftView draft={draft()} onExit={vi.fn()} />);
    await user.click(screen.getByRole('button', { name: 'Aplicar' }));
    const dialog = await screen.findByRole('dialog', { name: 'A fila mudou' });
    expect(within(dialog).getByText(/2 título\(s\) entrou\/entraram e 1 saiu\/saíram/)).toBeTruthy();
    await user.click(within(dialog).getByRole('button', { name: 'Aplicar mesmo assim' }));
    await screen.findByText('Priorização aplicada em 5 título(s).');
    expect(attempts).toBe(2);
    expect(calls[1].body).toEqual({ reconcile: 'append_new' });
  });

  it('Descartar apaga o rascunho sem mexer na fila', async () => {
    __setAccessToken('tok');
    const onExit = vi.fn();
    const { calls } = mockApi({ 'DELETE /library/priority-draft': () => ({ status: 204 }) });
    const user = userEvent.setup();
    renderWithProviders(<PriorityDraftView draft={draft()} onExit={onExit} />);
    await user.click(screen.getByRole('button', { name: 'Descartar' }));
    await screen.findByText('Rascunho descartado. Nada mudou na fila.');
    expect(calls.map((c) => c.method)).toEqual(['DELETE']);
    expect(onExit).toHaveBeenCalled();
  });
});
