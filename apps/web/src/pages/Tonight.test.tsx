import type { TonightDefaults, TonightResponse } from '@fruiqo/contracts';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { __setAccessToken } from '../api/client';
import { makeTitle, mockApi, renderWithProviders } from '../test/helpers';
import { TonightPanel } from './Tonight';

afterEach(() => __setAccessToken(null));

const defaults: TonightDefaults = {
  kind: 'movie',
  genres: [
    { key: 'thriller', label: 'Suspense/Thriller', group: 'love', forVideo: true },
    { key: 'drama', label: 'Drama', group: 'like', forVideo: true },
    { key: 'comedy', label: 'Comédia', group: 'neutral', forVideo: true },
    { key: 'poetry', label: 'Poesia', group: 'neutral', forVideo: false },
    { key: 'horror', label: 'Terror', group: 'avoid', forVideo: true },
  ],
  top: ['Suspense/Thriller', 'Drama'],
  summary: 'Gosto de suspense.',
  subgenres: [
    { key: 'psych_thriller', label: 'Thriller psicológico', pref: 'like' },
    { key: 'slasher', label: 'Slasher', pref: null },
  ],
  services: [
    { key: 'netflix', label: 'Netflix', selected: true },
    { key: 'globoplay', label: 'Globoplay', selected: false },
  ],
};

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
  it('abre com a sua cara: tipo do hábito, gêneros na ordem do gosto, streamings do Perfil', async () => {
    __setAccessToken('tok');
    mockApi({ 'GET /tonight/defaults': defaults });
    renderWithProviders(<TonightPanel onClose={vi.fn()} />);
    const kind = await screen.findByRole('combobox', { name: 'O que você quer' });
    await waitFor(() => expect(kind).toHaveProperty('value', 'movie'));
    // o foco começa no campo de texto
    expect(document.activeElement).toBe(screen.getByLabelText(/O que você quer assistir\?/));
    await userEvent.setup().selectOptions(kind, 'book');
    expect(screen.getByLabelText(/O que você quer ler\?/)).toBeTruthy();
    await userEvent.setup().selectOptions(kind, 'movie');
    const genre = screen.getByRole('combobox', { name: 'Gênero' }) as HTMLSelectElement;
    expect(genre.options[0]!.textContent).toBe('Do seu gosto (Suspense/Thriller, Drama)');
    // na ordem do gosto, em grupos; gênero só de livro fica de fora em filme
    expect([...genre.options].map((o) => o.value)).toEqual(['', 'thriller', 'drama', 'comedy', 'horror']);
    expect([...genre.querySelectorAll('optgroup')].map((g) => g.label)).toEqual(['Do que você mais gosta', 'Também gosta', 'Outros', 'Você evita']);
    // "Onde" fica no painel do ícone de filtro, na primeira linha
    expect(screen.queryByRole('group', { name: 'Onde procurar' })).toBeNull();
    await userEvent.setup().click(screen.getByRole('button', { name: 'Filtros: onde procurar e perfil desta busca' }));
    const where = screen.getByRole('group', { name: 'Onde procurar' });
    expect(within(where).getByRole('button', { name: 'Netflix' }).getAttribute('aria-pressed')).toBe('true');
    expect(within(where).getByRole('button', { name: 'Globoplay' }).getAttribute('aria-pressed')).toBe('false');
  });

  it('pede com tipo/gênero/humor/streamings, mostra motivo, novas sugestões sem repetir, "já assisti" e "quero assistir"', async () => {
    __setAccessToken('tok');
    let round = 0;
    const responses: TonightResponse[] = [
      { aiUsed: true, request: 'Hoje: filme de Suspense/Thriller', services: ['Netflix', 'Globoplay'], items: [item(1, 'Prisioneiros', 'suspense pesado'), item(2, 'Zodíaco', 'investigação obsessiva')] },
      { aiUsed: true, services: [], items: [item(3, 'Garota Exemplar', 'reviravolta')] },
    ];
    const { calls } = mockApi({
      'GET /tonight/defaults': defaults,
      'POST /tonight': () => ({ body: responses[round++] }),
      'POST /tonight/watched': makeTitle({ title: 'Prisioneiros', status: 'watched' }),
      'POST /library/import': { created: [makeTitle({ title: 'Zodíaco' })], skipped: [] },
    });
    const user = userEvent.setup();
    renderWithProviders(<TonightPanel onClose={vi.fn()} />);

    await waitFor(() => expect(screen.getByRole('combobox', { name: 'O que você quer' })).toHaveProperty('value', 'movie'));
    await user.selectOptions(screen.getByRole('combobox', { name: 'Gênero' }), 'thriller');
    await user.click(screen.getByRole('button', { name: 'Filtros: onde procurar e perfil desta busca' }));
    await user.click(screen.getByRole('button', { name: 'Globoplay' }));
    await user.type(screen.getByLabelText(/O que você quer assistir/), 'quero algo tenso');
    await user.click(screen.getByRole('button', { name: /Sugerir/ }));

    const list = await screen.findByRole('list', { name: 'Sugestões para hoje' });
    expect(calls.find((c) => c.path === '/tonight')?.body).toEqual({
      kind: 'movie',
      genre: 'thriller',
      mood: 'quero algo tenso',
      services: ['netflix', 'globoplay'],
      sessionId: expect.stringMatching(/^[0-9a-f-]{36}$/),
    });
    expect(within(list).getByText('suspense pesado')).toBeTruthy();
    expect(screen.getByText('Só o que está em: Netflix, Globoplay.')).toBeTruthy();

    const first = within(list).getAllByRole('listitem')[0]!;
    await user.click(within(first).getByRole('button', { name: /Já assisti/ }));
    await waitFor(() => expect(calls.find((c) => c.path === '/tonight/watched')?.body).toEqual({ tmdbId: 1, mediaType: 'movie' }));
    await waitFor(() => expect(within(list).queryByText('Prisioneiros')).toBeNull());
    await user.click(within(list).getByRole('button', { name: 'Quero assistir' }));
    await waitFor(() => expect(calls.find((c) => c.path === '/library/import')?.body).toEqual({ items: [{ tmdbId: 2, mediaType: 'movie' }] }));

    // "Qualquer lugar" + novas sugestões: manda o que já apareceu e nenhum serviço
    await user.click(screen.getByRole('button', { name: 'Qualquer lugar' }));
    await user.click(screen.getByRole('button', { name: /Novas sugestões/ }));
    expect(await screen.findByText('Garota Exemplar')).toBeTruthy();
    expect(calls.filter((c) => c.path === '/tonight')[1]!.body).toMatchObject({ exclude: ['movie:1', 'movie:2'], services: [] });
  });

  it('Avançado: perfil só desta busca e "salvar no meu perfil" só com o que mudou', async () => {
    __setAccessToken('tok');
    const { calls } = mockApi({
      'GET /tonight/defaults': defaults,
      'POST /tonight': { aiUsed: true, services: ['Netflix'], items: [] },
      'PUT /profile/summary': { summary: 'Hoje quero rir.', favorites: [], interpreted: { likes: [], dislikes: [], likedSubgenres: [], dislikedSubgenres: [] }, affinities: [] },
      'PATCH /profile/taste': { genres: [], subgenres: [], overrides: { pinned: [], excluded: [] }, totals: { signals: 0, watched: 0, rated: 0 } },
    });
    const user = userEvent.setup();
    renderWithProviders(<TonightPanel onClose={vi.fn()} />);
    const advanced = await screen.findByRole('button', { name: 'Filtros: onde procurar e perfil desta busca' });
    expect(advanced.getAttribute('aria-expanded')).toBe('false');
    await user.click(advanced);
    expect(advanced.getAttribute('aria-expanded')).toBe('true');
    const resumo = screen.getByRole('textbox', { name: 'Resumo do gosto' });
    expect(resumo).toHaveProperty('value', 'Gosto de suspense.');
    await user.clear(resumo);
    await user.type(resumo, 'Hoje quero rir.');
    // comédia: neutro → gosto → adoro; terror: evito → neutro; slasher: neutro → gosto
    await user.click(screen.getByRole('button', { name: 'Comédia: neutro' }));
    await user.click(screen.getByRole('button', { name: 'Comédia: gosto' }));
    await user.click(screen.getByRole('button', { name: 'Terror: evito' }));
    await user.click(screen.getByRole('button', { name: 'Slasher: neutro' }));

    await user.click(screen.getByRole('button', { name: /Sugerir/ }));
    await waitFor(() => expect(calls.some((c) => c.path === '/tonight')).toBe(true));
    const sent = calls.find((c) => c.path === '/tonight')!.body as { profile: { summary: string; genres: { key: string; group: string }[]; subgenres: unknown[] } };
    expect(sent.profile.summary).toBe('Hoje quero rir.');
    expect(sent.profile.genres).toEqual(expect.arrayContaining([{ key: 'comedy', group: 'love' }, { key: 'horror', group: 'neutral' }]));
    expect(sent.profile.subgenres).toEqual([{ key: 'psych_thriller', pref: 'like' }, { key: 'slasher', pref: 'like' }]);
    // nada foi salvo no perfil só por buscar
    expect(calls.some((c) => c.path === '/profile/summary' || c.path === '/profile/taste')).toBe(false);

    await user.click(screen.getByRole('button', { name: 'Salvar no meu perfil' }));
    await waitFor(() => expect(calls.find((c) => c.path === '/profile/taste')).toBeTruthy());
    expect(calls.find((c) => c.path === '/profile/summary')?.body).toEqual({ summary: 'Hoje quero rir.' });
    expect(calls.find((c) => c.path === '/profile/taste')?.body).toEqual({
      levels: [{ key: 'comedy', level: 'love' }],
      clear: ['horror'],
      subgenres: [{ key: 'slasher', pref: 'like' }],
    });
  });

  it('"Hoje não" tira só desta busca; recusou todas (já assisti/hoje não) → busca de novo sozinha, sem repetir', async () => {
    __setAccessToken('tok');
    let round = 0;
    const responses: TonightResponse[] = [
      { aiUsed: true, services: ['Netflix'], items: [item(1, 'Prisioneiros', 'a'), item(2, 'Zodíaco', 'b')] },
      { aiUsed: true, services: ['Netflix'], items: [item(3, 'Garota Exemplar', 'c')] },
    ];
    const { calls } = mockApi({
      'GET /tonight/defaults': defaults,
      'POST /tonight': () => ({ body: responses[round++] }),
      'POST /tonight/watched': makeTitle({ title: 'Zodíaco', status: 'watched' }),
    });
    const user = userEvent.setup();
    renderWithProviders(<TonightPanel onClose={vi.fn()} />);
    await user.click(await screen.findByRole('button', { name: /Sugerir/ }));
    const list = await screen.findByRole('list', { name: 'Sugestões para hoje' });

    await user.click(within(list).getByRole('button', { name: 'Hoje não: Prisioneiros' }));
    // "hoje não" não grava nada
    expect(calls.some((c) => c.path === '/tonight/watched')).toBe(false);
    expect(within(list).queryByText('Prisioneiros')).toBeNull();

    await user.click(within(list).getByRole('button', { name: /Já assisti/ }));
    // a lista ficou vazia sem nenhum "quero": nova busca automática, sem repetir as duas
    expect(await screen.findByText('Garota Exemplar')).toBeTruthy();
    const posts = calls.filter((c) => c.path === '/tonight');
    expect(posts).toHaveLength(2);
    expect(posts[1]!.body).toMatchObject({ exclude: ['movie:1', 'movie:2'] });
  });

  it('trocar o gênero com uma busca na tela limpa e busca de novo, já com o gênero novo', async () => {
    __setAccessToken('tok');
    let round = 0;
    const responses: TonightResponse[] = [
      { aiUsed: true, services: ['Netflix'], items: [item(1, 'Prisioneiros', 'a')] },
      { aiUsed: true, services: ['Netflix'], items: [item(4, 'Se Beber, Não Case!', 'b')] },
      { aiUsed: true, services: ['Netflix'], items: [item(5, 'Akira', 'c')] },
    ];
    const { calls } = mockApi({ 'GET /tonight/defaults': defaults, 'POST /tonight': () => ({ body: responses[round++] }) });
    const user = userEvent.setup();
    renderWithProviders(<TonightPanel onClose={vi.fn()} />);
    await waitFor(() => expect(screen.getByRole('combobox', { name: 'O que você quer' })).toHaveProperty('value', 'movie'));
    // sem busca feita, trocar o gênero não busca
    await user.selectOptions(screen.getByRole('combobox', { name: 'Gênero' }), 'drama');
    expect(calls.some((c) => c.path === '/tonight')).toBe(false);
    await user.click(screen.getByRole('button', { name: /Sugerir/ }));
    expect(await screen.findByText('Prisioneiros')).toBeTruthy();

    await user.selectOptions(screen.getByRole('combobox', { name: 'Gênero' }), 'comedy');
    expect(await screen.findByText('Se Beber, Não Case!')).toBeTruthy();
    expect(screen.queryByText('Prisioneiros')).toBeNull();
    const posts = calls.filter((c) => c.path === '/tonight');
    expect(posts).toHaveLength(2);
    expect(posts[1]!.body).toMatchObject({ genre: 'comedy' });
    // o que já apareceu não volta, nem trocando o gênero
    expect(posts[1]!.body).toMatchObject({ exclude: ['movie:1'] });
    expect((posts[1]!.body as { includeAnime?: boolean }).includeAnime).toBeUndefined();

    // "Incluir animes e animações?" vem desmarcado; marcar com busca na tela busca de novo, já com eles
    const anime = screen.getByRole('checkbox', { name: 'Incluir animes e animações?' });
    expect(anime).toHaveProperty('checked', false);
    await user.click(anime);
    await waitFor(() => expect(calls.filter((c) => c.path === '/tonight')).toHaveLength(3));
    expect(calls.filter((c) => c.path === '/tonight')[2]!.body).toMatchObject({ genre: 'comedy', includeAnime: true, exclude: ['movie:1', 'movie:4'] });
  });

  it('mostra o que entendeu, os dois índices e a Minha Área; "Incluir já vistos"; esgotou → procurar em qualquer lugar', async () => {
    __setAccessToken('tok');
    let round = 0;
    const responses: TonightResponse[] = [
      {
        aiUsed: false,
        understood: 'Ação + Ficção científica · faz pensar',
        unmapped: ['noir'],
        services: ['Netflix'],
        items: [{ ...item(16, 'Duna', 'Na sua lista · ação e ficção científica'), fromList: true, fit: 100, profileFit: 92, availableOn: ['Max'] }],
      },
      { aiUsed: false, services: ['Netflix'], items: [], exhausted: true },
      { aiUsed: false, services: [], items: [item(20, 'Só no Cinema', 'x')] },
    ];
    const { calls } = mockApi({ 'GET /tonight/defaults': defaults, 'POST /tonight': () => ({ body: responses[round++] }) });
    const user = userEvent.setup();
    renderWithProviders(<TonightPanel onClose={vi.fn()} />);
    const seen = await screen.findByRole('checkbox', { name: 'Incluir já vistos?' });
    expect(seen).toHaveProperty('checked', false);
    await user.click(screen.getByRole('button', { name: /Sugerir/ }));
    expect(await screen.findByText('Ação + Ficção científica · faz pensar')).toBeTruthy();
    expect(screen.getByText(/não entendi: noir/)).toBeTruthy();
    const card = screen.getAllByRole('listitem')[0]!;
    expect(within(card).getByText('Pedido 100%')).toBeTruthy();
    expect(within(card).getByText('Perfil 92%')).toBeTruthy();
    expect(within(card).getByText('na sua lista')).toBeTruthy();
    expect(within(card).getByRole('button', { name: 'Assistir hoje' })).toBeTruthy();

    // "Incluir já vistos" com busca na tela: busca de novo, já incluindo
    await user.click(seen);
    expect(await screen.findByText('Não encontrei mais títulos inéditos com estes filtros.')).toBeTruthy();
    expect(calls.filter((c) => c.path === '/tonight')[1]!.body).toMatchObject({ includeSeen: true });
    await user.click(screen.getByRole('button', { name: 'Procurar em qualquer lugar' }));
    expect(await screen.findByText('Só no Cinema')).toBeTruthy();
    expect(calls.filter((c) => c.path === '/tonight')[2]!.body).toMatchObject({ services: [] });
    // a mesma sessão em todas as buscas do painel
    const ids = new Set(calls.filter((c) => c.path === '/tonight').map((c) => (c.body as { sessionId: string }).sessionId));
    expect(ids.size).toBe(1);
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
    mockApi({ 'GET /tonight/defaults': { ...defaults, services: defaults.services.map((x) => ({ ...x, selected: false })) }, 'POST /tonight': () => ({ body: responses[round++] }) });
    const user = userEvent.setup();
    renderWithProviders(<TonightPanel onClose={vi.fn()} />);
    await user.click(await screen.findByRole('button', { name: /Sugerir/ }));
    expect(await screen.findByText(/IA não permitida/)).toBeTruthy();
    expect(screen.getByText(/Cadastre seus streamings/)).toBeTruthy();
    expect(screen.getByText('Nada novo desta vez. Mude o gênero ou o pedido e busque de novo.')).toBeTruthy();

    await user.click(screen.getByRole('button', { name: /Buscar de novo/ }));
    const alert = await screen.findByRole('alert');
    expect(within(alert).getByRole('link', { name: '188' })).toBeTruthy();
    expect(screen.queryByRole('list', { name: 'Sugestões para hoje' })).toBeNull();
  });
});
