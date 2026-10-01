import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import { __setAccessToken } from '../api/client';
import { mockApi, renderWithProviders } from '../test/helpers';
import { AiUsageSection } from './AiUsage';

afterEach(() => __setAccessToken(null));

describe('Uso de IA no Perfil', () => {
  it('total dos 30 dias, por recurso (com o modelo) e por dia', async () => {
    __setAccessToken('tok');
    mockApi({
      'GET /profile/ai-usage': {
        since: '2026-09-01',
        total: { calls: 12, failures: 1, inputTokens: 18000, outputTokens: 6000, costUsd: 0.4321 },
        features: [
          { feature: 'tonight_titles', calls: 4, failures: 1, inputTokens: 8000, outputTokens: 5000, costUsd: 0.39, models: ['claude-fable-5-1'] },
          { feature: 'tonight_plan', calls: 8, failures: 0, inputTokens: 10000, outputTokens: 1000, costUsd: 0.0421, models: ['claude-haiku-4-5'] },
        ],
        days: [
          { date: '2026-10-01', calls: 10, costUsd: 0.4 },
          { date: '2026-09-30', calls: 2, costUsd: 0.0321 },
        ],
      },
    });
    const user = userEvent.setup();
    renderWithProviders(<AiUsageSection />);
    expect(await screen.findByText('US$ 0,43')).toBeTruthy();
    expect(screen.getByText(/12 chamadas \(1 com falha\) · 24,0 mil tokens/)).toBeTruthy();
    const rows = screen.getAllByRole('row').slice(1);
    expect(within(rows[0]!).getByText('O que assistir hoje: sugerir títulos')).toBeTruthy();
    expect(within(rows[0]!).getByText('claude-fable-5-1')).toBeTruthy();
    expect(within(rows[1]!).getByText('US$ 0,04')).toBeTruthy();
    await user.click(screen.getByText('Por dia'));
    const days = screen.getByRole('list', { name: 'Uso de IA por dia' });
    expect(within(days).getAllByRole('listitem').map((li) => li.textContent)).toEqual(['01/1010 chamadasUS$ 0,40', '30/092 chamadasUS$ 0,03']);
  });

  it('sem uso: avisa', async () => {
    __setAccessToken('tok');
    mockApi({ 'GET /profile/ai-usage': { since: '2026-09-01', total: { calls: 0, failures: 0, inputTokens: 0, outputTokens: 0, costUsd: 0 }, features: [], days: [] } });
    renderWithProviders(<AiUsageSection />);
    expect(await screen.findByText('Nenhuma chamada de IA nos últimos 30 dias.')).toBeTruthy();
  });
});
