import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import { __setAccessToken } from '../api/client';
import { makeTitle, mockApi, renderWithProviders } from '../test/helpers';
import { Discover } from './Discover';

afterEach(() => __setAccessToken(null));

const RUN = '33333333-3333-4333-8333-333333333333';
const home = {
  continue: null,
  presets: [
    { key: 'romcom', label: 'Comédia romântica', kind: 'subgenre', available: 3 },
    { key: 'horror', label: 'Terror', kind: 'genre', available: 0 },
  ],
  stats: { toWatch: 5, watching: 0, watched: 1, total: 6, withoutGenre: 0 },
  aiMode: 'anthropic',
};
const settings = (aiConsent: boolean) => ({ rememberMood: false, aiConsent, aiConsentAt: null, aiAvailable: true, aiUnavailableReason: null, moodRetentionDays: 90 });
const suggestion = (title: string) => ({ title: makeTitle({ title }), score: 0.8, reason: 'Leve e curto, como você pediu', source: 'library' });
const result = (over: object = {}) => ({
  runId: RUN,
  mode: 'mood',
  aiMode: 'anthropic',
  intent: null,
  surprise: null,
  risk: null,
  suggestions: [suggestion('Paddington'), suggestion('Amélie')],
  message: 'Separei algo leve para hoje.',
  interpreter: 'anthropic',
  ...over,
});

describe('"Como estou" no web', () => {
  it('manda o pedido com o tipo escolhido, mostra "interpretado com IA" e "Outra" troca a sugestão', async () => {
    __setAccessToken('tok');
    const { calls } = mockApi({
      'GET /home': home,
      'GET /profile/settings': settings(true),
      'POST /discover': result(),
      'POST /feedback': { next: suggestion('Soul') },
    });
    const user = userEvent.setup();
    renderWithProviders(<Discover />);
    expect(await screen.findByText(/Com IA/)).toBeTruthy();
    await user.type(screen.getByLabelText('Como você está?'), 'cansado, quero algo leve');
    await user.click(screen.getByRole('button', { name: 'Filme' }));
    await user.click(screen.getByRole('button', { name: 'Sugerir' }));
    expect(await screen.findByText('Separei algo leve para hoje.')).toBeTruthy();
    expect(screen.getByText(/interpretado com IA/)).toBeTruthy();
    expect(calls.find((c) => c.path === '/discover')?.body).toEqual({ mode: 'mood', text: 'cansado, quero algo leve', kinds: ['movie'] });

    const list = screen.getByRole('list', { name: 'Sugestões' });
    const first = within(list).getAllByRole('listitem')[0]!;
    await user.click(within(first).getByRole('button', { name: 'Outra' }));
    await waitFor(() => expect(within(list).getByText('Soul')).toBeTruthy());
    expect(within(list).queryByText('Paddington')).toBeNull();
    expect(calls.find((c) => c.path === '/feedback')?.body).toMatchObject({ runId: RUN, action: 'another' });
  });

  it('risco: acolhimento com CVV e sem sugestões; continuar reenvia com continueAfterRisk', async () => {
    __setAccessToken('tok');
    let n = 0;
    const { calls } = mockApi({
      'GET /home': home,
      'GET /profile/settings': settings(false),
      'POST /discover': () => {
        n++;
        return {
          body:
            n === 1
              ? result({
                  suggestions: [],
                  risk: { title: 'Você não está só', message: 'Se quiser conversar…', cvvPhone: '188', cvvUrl: 'https://cvv.org.br', emergencyPhone: '192', continueLabel: 'Quero ver sugestões mesmo assim' },
                })
              : result({ interpreter: 'rules' }),
        };
      },
    });
    const user = userEvent.setup();
    renderWithProviders(<Discover />);
    expect(await screen.findByText(/Sem IA/)).toBeTruthy();
    await user.type(screen.getByLabelText('Como você está?'), 'estou muito mal');
    await user.click(screen.getByRole('button', { name: 'Sugerir' }));
    const alert = await screen.findByRole('alert');
    expect(within(alert).getByText(/CVV · 188/)).toBeTruthy();
    expect(screen.queryByRole('list', { name: 'Sugestões' })).toBeNull();
    await user.click(within(alert).getByRole('button', { name: 'Quero ver sugestões mesmo assim' }));
    await screen.findByRole('list', { name: 'Sugestões' });
    expect(calls.filter((c) => c.path === '/discover')[1]!.body).toEqual({ mode: 'mood', text: 'estou muito mal', continueAfterRisk: true });
    expect(screen.queryByText(/interpretado com IA/)).toBeNull();
  });

  it('Surpreenda-me: só presets com títulos disponíveis, num toque', async () => {
    __setAccessToken('tok');
    const { calls } = mockApi({
      'GET /home': home,
      'GET /profile/settings': settings(false),
      'POST /discover': result({ mode: 'surprise', surprise: { key: 'romcom', label: 'Comédia romântica', kind: 'subgenre' }, message: undefined, interpreter: undefined }),
    });
    const user = userEvent.setup();
    renderWithProviders(<Discover />);
    await user.click(await screen.findByRole('button', { name: 'Comédia romântica' }));
    expect(screen.queryByRole('button', { name: 'Terror' })).toBeNull();
    expect(await screen.findByText('Surpresa: Comédia romântica')).toBeTruthy();
    expect(calls.find((c) => c.path === '/discover')?.body).toEqual({ mode: 'surprise', subgenre: 'romcom' });
  });
});
