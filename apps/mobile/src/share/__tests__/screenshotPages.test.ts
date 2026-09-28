import { describe, expect, it } from '@jest/globals';
import {
  MAX_PAGE_CHARS,
  buildPage,
  buildPages,
  buildScreenshotRequest,
  selectImages,
  toOcrUri,
} from '../screenshotPages';

const ID = '3f1c2a4e-8b7d-4c1e-9a2f-0b1c2d3e4f5a';

describe('toOcrUri', () => {
  it('prefixa file:// em caminho absoluto', () => {
    expect(toOcrUri('/data/user/0/app/cache/x.png')).toBe('file:///data/user/0/app/cache/x.png');
  });
  it('mantém file:// e content://', () => {
    expect(toOcrUri('file:///a.png')).toBe('file:///a.png');
    expect(toOcrUri('content://media/external/images/media/1')).toBe('content://media/external/images/media/1');
  });
});

describe('selectImages', () => {
  it('sem arquivos ou sem imagem → null', () => {
    expect(selectImages(null)).toBeNull();
    expect(selectImages([{ path: '/a.pdf', mimeType: 'application/pdf' }])).toBeNull();
  });

  it('mantém a ordem, marca PDF ignorado', () => {
    const r = selectImages([
      { path: '/1.png', mimeType: 'image/png' },
      { path: '/x.pdf', mimeType: 'application/pdf' },
      { path: '/2.jpg', mimeType: 'image/jpeg' },
    ]);
    expect(r).toEqual({ uris: ['file:///1.png', 'file:///2.jpg'], truncated: false, ignoredOtherFiles: true });
  });

  it('limita a 10 imagens e sinaliza o corte', () => {
    const files = Array.from({ length: 12 }, (_, i) => ({ path: `/${i}.png`, mimeType: 'image/png' }));
    const r = selectImages(files);
    expect(r?.uris).toHaveLength(10);
    expect(r?.uris[9]).toBe('file:///9.png');
    expect(r?.truncated).toBe(true);
  });

  it('ignora imagem sem path', () => {
    expect(selectImages([{ path: '', mimeType: 'image/png' }])).toBeNull();
  });
});

describe('buildPage / buildPages', () => {
  it('junta blocos, apara linhas e remove vazias', () => {
    expect(buildPage(['  1. Oppenheimer (2023)  \n\n', 'Duna:   Parte 2 ', '   '])).toBe(
      '1. Oppenheimer (2023)\nDuna: Parte 2',
    );
  });

  it('OCR vazio ou falho → null e página descartada', () => {
    expect(buildPage([])).toBeNull();
    expect(buildPage(['  ', '\n'])).toBeNull();
    expect(buildPages([['a'], null, [], ['b']])).toEqual(['a', 'b']);
  });

  it('corta no limite do contrato', () => {
    const p = buildPage(['x'.repeat(MAX_PAGE_CHARS + 500)]);
    expect(p).toHaveLength(MAX_PAGE_CHARS);
  });
});

describe('buildScreenshotRequest', () => {
  it('monta request só com pages (valida pelo contrato)', () => {
    expect(buildScreenshotRequest(['a', 'b'], ID)).toEqual({
      kind: 'ok',
      request: { clientShareId: ID, pages: ['a', 'b'] },
    });
  });
  it('sem páginas → empty', () => {
    expect(buildScreenshotRequest([], ID)).toEqual({ kind: 'empty' });
  });
});
