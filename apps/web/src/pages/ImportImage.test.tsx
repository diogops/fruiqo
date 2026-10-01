import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { __setAccessToken } from '../api/client';
import { mockApi, renderWithProviders } from '../test/helpers';
import { ImportImage } from './ImportImage';

// O Tesseract (WebAssembly) e o decode de imagem não rodam no jsdom: o motor e a imagem são simulados;
// candidatos, edição, envio e resultado são os reais.
const ocr = vi.hoisted(() => ({
  recognize: vi.fn(),
  cancel: vi.fn(),
  dispose: vi.fn(),
}));
vi.mock('../ocr/engine', async (orig) => {
  const real = await orig<typeof import('../ocr/engine')>();
  class OcrEngine {
    recognize = ocr.recognize;
    cancel = ocr.cancel;
    dispose = ocr.dispose;
  }
  return { ...real, OcrEngine };
});
vi.mock('../ocr/image', async (orig) => {
  const real = await orig<typeof import('../ocr/image')>();
  return {
    ...real,
    loadImage: vi.fn(async (f: File) => {
      if (!real.isImageFile(f)) throw new real.ImageInputError('type', 'Formato não suportado. Use PNG, JPG ou WebP.');
      return { name: f.name, url: 'blob:previa', width: 589, height: 1280, bitmap: { close: vi.fn() } };
    }),
    releaseImage: vi.fn(),
    renderForOcr: vi.fn(() => document.createElement('canvas')),
  };
});

const SHARE = '55555555-5555-4555-8555-555555555555';
const NOW = '2026-09-29T10:00:00.000Z';
const share = (status: 'queued' | 'done') => ({
  id: SHARE,
  status,
  createdAt: NOW,
  updatedAt: NOW,
  source: { platform: 'other', origin: 'text_file' },
  recommendations: [],
  dedup: { pagesIgnored: 0, itemsAlreadyInList: 0 },
});
const decision = (rawTitle: string, kind: string, reason = 'no_catalog_match') => ({
  rawTitle,
  kind,
  confidenceScore: 0.9,
  decision: 'review_queue',
  reason,
});

const OCR_LINES = [
  { text: '12:57', confidence: 90 },
  { text: 'Seguir', confidence: 90 },
  { text: '1. Instinto Materno (2024)', confidence: 91 },
  { text: '»Disponível no Prime Video', confidence: 85 },
  { text: '2. Match Point (2006)', confidence: 92 },
  { text: '3. Mentira Incondicional (2020)', confidence: 90 },
];
const ok = (lines = OCR_LINES) => Promise.resolve({ text: lines.map((l) => l.text).join('\n'), lines });

let uuid = 0;
beforeEach(() => {
  __setAccessToken('tok');
  ocr.recognize.mockReset();
  uuid = 0;
  vi.stubGlobal('crypto', { ...crypto, randomUUID: () => `9999999${++uuid}-9999-4999-8999-999999999999` });
});
afterEach(() => __setAccessToken(null));

const print = () => new File(['x'], 'print.jpeg', { type: 'image/jpeg' });

async function openAndExtract(user: ReturnType<typeof userEvent.setup>) {
  await user.upload(screen.getByLabelText('Imagem do print'), print());
  await user.click(await screen.findByRole('button', { name: 'Extrair texto' }));
  return screen.findByRole('list', { name: 'Títulos encontrados' });
}

describe('importar de imagem', () => {
  it('do print ao cadastro: pré-seleção, correção, categoria, item manual, falha parcial e reenvio só do que falhou', async () => {
    ocr.recognize.mockImplementation(() => ok());
    let steps = [decision('Instinto Materno', 'movie'), decision('Match Point', 'movie', 'already_in_list')];
    const { calls } = mockApi({
      'POST /shares': () => ({ status: 201, body: share('queued') }),
      'GET /shares/:id': share('done'),
      'GET /shares/:id/steps': () => ({ body: { shareId: SHARE, isFixture: false, steps: [], decisions: steps } }),
    });
    const user = userEvent.setup();
    renderWithProviders(<ImportImage onClose={vi.fn()} />);
    const list = await openAndExtract(user);

    // na lista principal, só os itens numerados (já marcados); o resto fica recolhido, sem sumir
    const titles = within(list).getAllByRole('textbox', { name: /^Título/ }).map((i) => (i as HTMLInputElement).value);
    expect(titles).toEqual(['Instinto Materno (2024)', 'Match Point (2006)', 'Mentira Incondicional (2020)']);
    const others = screen.getByRole('list', { name: 'Outras linhas lidas' });
    expect(within(others).getByRole('button', { name: /Disponível no Prime Video/ })).toBeTruthy();

    // sem categoria não envia
    await user.click(screen.getByRole('button', { name: 'Cadastrar 3 título(s)' }));
    expect(screen.getAllByText('Escolha a categoria.').length).toBe(3);
    expect(calls.some((c) => c.path === '/shares')).toBe(false);

    // uma linha recolhida volta para a lista (marcada) e pode ser removida de novo
    await user.click(within(others).getByRole('button', { name: /Disponível no Prime Video/ }));
    // volta na ordem em que foi lida
    expect(within(list).getByRole('textbox', { name: 'Título 2' })).toHaveProperty('value', 'Disponível no Prime Video');
    await user.click(within(list).getByRole('button', { name: 'Remover título 2' }));

    // corrige a grafia, categoria de uma vez para os marcados e um livro acrescentado à mão
    const t3 = within(list).getByRole('textbox', { name: 'Título 3' });
    await user.clear(t3);
    await user.type(t3, 'Mentira Incondicional');
    await user.selectOptions(screen.getByRole('combobox', { name: 'Categoria para todos os marcados' }), 'movie');
    await user.click(screen.getByRole('button', { name: 'Adicionar título' }));
    const manual = within(list).getByRole('textbox', { name: 'Título 4' });
    await user.type(manual, '1984');
    await user.selectOptions(within(list).getByRole('combobox', { name: 'Categoria do título 4' }), 'book');

    // clique duplo: um envio só
    const send = screen.getByRole('button', { name: 'Cadastrar 4 título(s)' });
    await user.dblClick(send);
    const results = await screen.findByRole('list', { name: 'Resultado do cadastro' });
    expect(calls.filter((c) => c.path === '/shares' && c.method === 'POST')).toHaveLength(1);
    expect(calls.find((c) => c.path === '/shares')?.body).toEqual({
      clientShareId: '99999991-9999-4999-8999-999999999999',
      textFile: {
        name: 'Importado de imagem.txt',
        content: ['Filmes:', 'Instinto Materno (2024)', 'Match Point (2006)', 'Mentira Incondicional', '', 'Livros:', '1984'].join('\n'),
      },
    });
    // a imagem nunca vai para a API: só o texto confirmado
    expect(JSON.stringify(calls)).not.toContain('blob:');

    const rows = within(results).getAllByRole('listitem').map((li) => li.textContent);
    expect(rows[0]).toContain('Na Minha Área');
    expect(rows[1]).toContain('Já estava na sua lista');
    expect(rows[2]).toContain('Não foi cadastrado');
    expect(rows[3]).toContain('Não foi cadastrado');

    // reenviar só os dois que falharam
    steps = [decision('Mentira Incondicional', 'movie'), decision('1984', 'book')];
    await user.click(screen.getByRole('button', { name: 'Corrigir e reenviar os que falharam' }));
    const retryList = screen.getByRole('list', { name: 'Títulos encontrados' });
    expect(within(retryList).getAllByRole('textbox').map((i) => (i as HTMLInputElement).value)).toEqual(['Mentira Incondicional', '1984']);
    await user.click(screen.getByRole('button', { name: 'Cadastrar 2 título(s)' }));
    await screen.findByRole('list', { name: 'Resultado do cadastro' });
    const posts = calls.filter((c) => c.path === '/shares' && c.method === 'POST');
    expect(posts).toHaveLength(2);
    expect((posts[1]!.body as { textFile: { content: string } }).textFile.content).toBe(['Filmes:', 'Mentira Incondicional', '', 'Livros:', '1984'].join('\n'));
    expect(screen.getByText('2 na Minha Área.')).toBeTruthy();
  });

  it('cancelar a leitura volta ao recorte; tentar de novo funciona', async () => {
    let rejectRun: (e: Error) => void = () => undefined;
    const { OcrCanceledError } = await import('../ocr/engine');
    ocr.recognize.mockImplementationOnce(() => new Promise((_, reject) => (rejectRun = reject)));
    ocr.cancel.mockImplementation(() => rejectRun(new OcrCanceledError()));
    ocr.recognize.mockImplementationOnce(() => ok([{ text: 'Up', confidence: 90 }]));
    mockApi({});
    const user = userEvent.setup();
    renderWithProviders(<ImportImage onClose={vi.fn()} />);
    await user.upload(screen.getByLabelText('Imagem do print'), print());
    await user.click(await screen.findByRole('button', { name: 'Extrair texto' }));
    expect(await screen.findByText(/Carregando o leitor de texto/)).toBeTruthy();
    expect(screen.getByRole('progressbar', { name: 'Progresso da leitura' })).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Cancelar leitura' }));
    await user.click(await screen.findByRole('button', { name: 'Extrair texto' }));
    const list = await screen.findByRole('list', { name: 'Títulos encontrados' });
    expect((within(list).getByRole('textbox') as HTMLInputElement).value).toBe('Up');
  });

  it('falha ao carregar o modelo mostra o erro e deixa tentar de novo', async () => {
    const { OcrLoadError } = await import('../ocr/engine');
    ocr.recognize.mockImplementationOnce(() => Promise.reject(new OcrLoadError()));
    ocr.recognize.mockImplementationOnce(() => ok([{ text: 'Soul', confidence: 90 }]));
    mockApi({});
    const user = userEvent.setup();
    renderWithProviders(<ImportImage onClose={vi.fn()} />);
    await user.upload(screen.getByLabelText('Imagem do print'), print());
    await user.click(await screen.findByRole('button', { name: 'Extrair texto' }));
    expect(await screen.findByText(/Não foi possível carregar o leitor de texto/)).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Extrair texto' }));
    expect(await screen.findByRole('list', { name: 'Títulos encontrados' })).toBeTruthy();
  });

  it('imagem sem texto avisa; texto completo fica consultável e o trecho vira título', async () => {
    ocr.recognize.mockImplementationOnce(() => Promise.resolve({ text: '', lines: [] }));
    mockApi({});
    const user = userEvent.setup();
    renderWithProviders(<ImportImage onClose={vi.fn()} />);
    await user.upload(screen.getByLabelText('Imagem do print'), print());
    await user.click(await screen.findByRole('button', { name: 'Extrair texto' }));
    expect(await screen.findByText(/Não encontrei texto nessa área/)).toBeTruthy();
  });

  it('arquivo que não é imagem é recusado com mensagem clara', async () => {
    mockApi({});
    const user = userEvent.setup({ applyAccept: false });
    renderWithProviders(<ImportImage onClose={vi.fn()} />);
    await user.upload(screen.getByLabelText('Imagem do print'), new File(['%PDF'], 'lista.pdf', { type: 'application/pdf' }));
    await waitFor(() => expect(screen.getByText(/Formato não suportado\. Use PNG, JPG ou WebP/)).toBeTruthy());
  });
});

describe('D-23: categoria sugerida pelo TMDB', () => {
  it('preenche Filme/Série sozinho; o que o TMDB não acha fica para escolher', async () => {
    ocr.recognize.mockReturnValue(ok());
    const { calls } = mockApi({
      // devolve os textos enviados; "Mentira Incondicional" o TMDB não acha
      'POST /search/classify': (call) => ({
        body: {
          items: (call.body as { titles: string[] }).titles.map((title) =>
            title.startsWith('Mentira') ? { title, kind: null } : { title, kind: 'movie', tmdbTitle: title },
          ),
        },
      }),
    });
    const user = userEvent.setup();
    renderWithProviders(<ImportImage initialFile={null} onClose={vi.fn()} />);
    await openAndExtract(user);
    await waitFor(() => expect((screen.getByLabelText('Categoria do título 1') as HTMLSelectElement).value).toBe('movie'), { timeout: 3000 });
    expect((screen.getByLabelText('Categoria do título 2') as HTMLSelectElement).value).toBe('movie');
    expect((screen.getByLabelText('Categoria do título 3') as HTMLSelectElement).value).toBe('');
    expect(calls.filter((c) => c.path === '/search/classify')).toHaveLength(1);
  });

  it('D-24: com IA, só os títulos do print viram candidatos (sem atores, serviços e rótulos); sem IA, a heurística', async () => {
    const text = [
      '[Fresh, Sorry to Bother You, Arlington Road, Frailty, Inside Man,',
      'Sebastian Stan, Daisy Edgar-Jones, LaKeith Stanfield, Steven',
      'Psychological Thriller, Plot Twist, Thriller, Netflix, Disney+,',
      'HBO, Prime Video]',
    ];
    const lines = text.map((t) => ({ text: t, confidence: 90 }));
    ocr.recognize.mockImplementation(() => ok(lines));
    const { calls } = mockApi({
      'POST /search/ai': {
        aiUsed: true,
        items: [
          { tmdbId: 1, mediaType: 'movie', kind: 'movie', title: 'Fresh', year: 2022, cast: [], inLibrary: null, matchedBy: 'title' },
          { tmdbId: 2, mediaType: 'movie', kind: 'movie', title: 'Desculpe Te Incomodar', year: 2018, cast: [], inLibrary: null, matchedBy: 'title' },
          { tmdbId: 3, mediaType: 'movie', kind: 'movie', title: 'A Mão do Diabo', year: 2001, cast: [], inLibrary: null, matchedBy: 'title' },
        ],
        notFound: [{ title: 'Arlington Road', kind: 'movie' }],
      },
    });
    const user = userEvent.setup();
    renderWithProviders(<ImportImage onClose={vi.fn()} />);
    const list = await openAndExtract(user);
    // só o texto vai para a IA, nunca a imagem
    expect(calls.find((c) => c.path === '/search/ai')?.body).toEqual({ mode: 'ocr', text: text.join('\n') });
    expect(JSON.stringify(calls)).not.toContain('blob:');
    const titles = within(list).getAllByRole('textbox', { name: /^Título/ }).map((i) => (i as HTMLInputElement).value);
    expect(titles).toEqual(['Fresh (2022)', 'Desculpe Te Incomodar (2018)', 'A Mão do Diabo (2001)', 'Arlington Road']);
    // categoria já vem do TMDB; o não confirmado também (o usuário confere)
    expect(within(list).getByRole('combobox', { name: 'Categoria do título 1' })).toHaveProperty('value', 'movie');
    expect(screen.getByText('títulos separados pela IA')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Cadastrar 4 título(s)' })).toBeTruthy();
    // as linhas lidas continuam acessíveis, recolhidas
    expect(within(screen.getByRole('list', { name: 'Outras linhas lidas' })).getAllByRole('button').length).toBeGreaterThan(0);
  });

  it('D-24: IA indisponível (sem consentimento) explica e segue com a heurística', async () => {
    ocr.recognize.mockImplementation(() => ok());
    mockApi({ 'POST /search/ai': { aiUsed: false, unavailable: 'consent', items: [], notFound: [] } });
    const user = userEvent.setup();
    renderWithProviders(<ImportImage onClose={vi.fn()} />);
    const list = await openAndExtract(user);
    expect(within(list).getAllByRole('textbox', { name: /^Título/ }).map((i) => (i as HTMLInputElement).value)).toEqual([
      'Instinto Materno (2024)',
      'Match Point (2006)',
      'Mentira Incondicional (2020)',
    ]);
    expect(screen.getByText(/Sem IA: separei pelas linhas do texto/)).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Perfil' })).toBeTruthy();
  });
});
