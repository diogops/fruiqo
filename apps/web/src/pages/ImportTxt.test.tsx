import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { __setAccessToken } from '../api/client';
import { makeTitle, mockApi, renderWithProviders } from '../test/helpers';
import { cleanText } from '../ocr/screenshots';
import { ImportTxt, readTextFile } from './ImportTxt';

// o OCR (Tesseract/WebAssembly) não roda no jsdom: simula a leitura, o resto do fluxo é o real
const readScreenshots = vi.hoisted(() => vi.fn());
vi.mock('../ocr/screenshots', async (orig) => ({ ...(await orig<typeof import('../ocr/screenshots')>()), readScreenshots }));

afterEach(() => __setAccessToken(null));

const SHARE = '55555555-5555-4555-8555-555555555555';
const NOW = '2026-09-28T10:00:00.000Z';

function share(status: 'queued' | 'done', recs = 0) {
  return {
    id: SHARE,
    status,
    createdAt: NOW,
    updatedAt: NOW,
    source: { platform: 'other', origin: 'text_file' },
    recommendations: Array.from({ length: recs }, (_, i) => ({
      id: makeTitle().id,
      kind: 'movie',
      title: `Título ${i}`,
      confidence: 0.9,
      extractor: 'heuristic',
      decision: 'review_queue',
    })),
    dedup: { pagesIgnored: 0, itemsAlreadyInList: 1 },
  };
}

describe('importar .txt (RF-47)', () => {
  it('lê UTF-8 e cai para Windows-1252 quando o arquivo não é UTF-8', async () => {
    const utf8 = new Blob(['﻿Séries:\r\nAçúcar (2021)\r\n']);
    expect(await readTextFile(utf8)).toBe('Séries:\nAçúcar (2021)\n');
    // "Ação" em Latin-1: A=0x41 ç=0xE7 ã=0xE3 o=0x6F
    const latin1 = new Blob([new Uint8Array([0x41, 0xe7, 0xe3, 0x6f])]);
    expect(await readTextFile(latin1)).toBe('Ação');
  });

  it('mostra a prévia, envia em textFile e leva para a Revisão', async () => {
    __setAccessToken('tok');
    vi.stubGlobal('crypto', { ...crypto, randomUUID: () => '66666666-6666-4666-8666-666666666666' });
    const onClose = vi.fn();
    const { calls } = mockApi({
      'POST /shares': share('queued'),
      'GET /shares/:id': share('done', 2),
    });
    const user = userEvent.setup();
    renderWithProviders(
      <Routes>
        <Route path="/catalogo" element={<ImportTxt onClose={onClose} />} />
        <Route path="/revisao" element={<p>página da revisão</p>} />
      </Routes>,
      { route: '/catalogo' },
    );
    const file = new File(['Filmes:\nDuna (2021)\n\nMaid\n'], 'minha-lista.txt', { type: 'text/plain' });
    await user.upload(screen.getByLabelText('Prints ou arquivo de texto'), file);

    const preview = await screen.findByLabelText('Prévia do arquivo');
    expect(within(preview).getByText('minha-lista.txt')).toBeTruthy();
    expect(within(preview).getAllByRole('listitem').map((li) => li.textContent)).toEqual(['Filmes:', 'Duna (2021)', 'Maid']);

    await user.click(screen.getByRole('button', { name: 'Importar para a Revisão' }));
    await screen.findByText('página da revisão');
    expect(onClose).toHaveBeenCalled();
    expect(calls.find((c) => c.path === '/shares')?.body).toEqual({
      clientShareId: '66666666-6666-4666-8666-666666666666',
      textFile: { name: 'minha-lista.txt', content: 'Filmes:\nDuna (2021)\n\nMaid\n' },
    });
    expect(screen.getByText('2 título(s) para revisar · 1 já estava(m) na sua lista.')).toBeTruthy();
  });

  it('arquivo solto no catálogo já abre carregado; recusa o que não é .txt', async () => {
    __setAccessToken('tok');
    mockApi({});
    const user = userEvent.setup({ applyAccept: false });
    const file = new File(['Duna'], 'x.txt', { type: 'text/plain' });
    renderWithProviders(<ImportTxt initialFiles={[file]} onClose={vi.fn()} />);
    expect(await screen.findByLabelText('Prévia do arquivo')).toBeTruthy();
    await user.upload(screen.getByLabelText('Prints ou arquivo de texto'), new File(['%PDF'], 'lista.pdf', { type: 'application/pdf' }));
    await waitFor(() => expect(screen.getByText('Escolha prints (PNG/JPG) ou um arquivo .txt (um título por linha).')).toBeTruthy());
  });
});

const OCR_TEXT = ['cinefilo.br', 'Filmes para ver chorando', 'Aftersun (2022)', 'Maid'].join('\n');

describe('importar prints no web', () => {
  it('lê os prints no navegador e envia só o texto em pages', async () => {
    __setAccessToken('tok');
    vi.stubGlobal('crypto', { ...crypto, randomUUID: () => '77777777-7777-4777-8777-777777777777' });
    readScreenshots.mockResolvedValue([OCR_TEXT, '']);
    const { calls } = mockApi({
      'POST /shares': share('queued'),
      'GET /shares/:id': share('done', 2),
    });
    const user = userEvent.setup();
    renderWithProviders(
      <Routes>
        <Route path="/catalogo" element={<ImportTxt onClose={vi.fn()} />} />
        <Route path="/revisao" element={<p>página da revisão</p>} />
      </Routes>,
      { route: '/catalogo' },
    );
    const prints = [new File(['a'], 'print1.png', { type: 'image/png' }), new File(['b'], 'print2.jpg', { type: 'image/jpeg' })];
    await user.upload(screen.getByLabelText('Prints ou arquivo de texto'), prints);

    const preview = await screen.findByLabelText('Texto lido dos prints');
    expect(within(preview).getByText('2 print(s)')).toBeTruthy();
    expect(within(preview).getAllByRole('listitem').map((li) => li.textContent)).toContain('Aftersun (2022)');
    expect(readScreenshots.mock.calls[0]![0]).toHaveLength(2);

    await user.click(screen.getByRole('button', { name: 'Importar para a Revisão' }));
    await screen.findByText('página da revisão');
    // print sem texto não vai; nenhuma imagem vai para a API
    expect(calls.find((c) => c.path === '/shares')?.body).toEqual({
      clientShareId: '77777777-7777-4777-8777-777777777777',
      pages: [OCR_TEXT],
    });
  });

  it('prints sem texto legível avisam e não enviam nada', async () => {
    __setAccessToken('tok');
    readScreenshots.mockResolvedValue(['  ', '']);
    const { calls } = mockApi({});
    const user = userEvent.setup();
    renderWithProviders(<ImportTxt onClose={vi.fn()} />);
    await user.upload(screen.getByLabelText('Prints ou arquivo de texto'), new File(['a'], 'p.png', { type: 'image/png' }));
    expect(await screen.findByText(/Não encontrei texto nesses prints/)).toBeTruthy();
    expect(calls.some((c) => c.path === '/shares')).toBe(false);
  });

  it('limpa o texto do OCR: espaços, linhas vazias repetidas e limite do contrato', () => {
    expect(cleanText(['  Duna   (2021) ', '', '', '', 'Maid  ', ''].join('\r\n'))).toBe(['Duna (2021)', '', 'Maid'].join('\n'));
    expect(cleanText('x'.repeat(9000))).toHaveLength(8000);
  });
});
