import { beforeEach, describe, expect, it, jest } from '@jest/globals';

const mockClip = {
  hasImageAsync: jest.fn<() => Promise<boolean>>(),
  getImageAsync: jest.fn<() => Promise<{ data: string } | null>>(),
  hasStringAsync: jest.fn<() => Promise<boolean>>(),
  getStringAsync: jest.fn<() => Promise<string>>(),
};
const mockWritten: { name: string; content: string; encoding?: string }[] = [];

// a fábrica roda antes das declarações acima (import é içado): delega na hora da chamada
jest.mock('expo-clipboard', () => ({
  hasImageAsync: () => mockClip.hasImageAsync(),
  getImageAsync: () => mockClip.getImageAsync(),
  hasStringAsync: () => mockClip.hasStringAsync(),
  getStringAsync: () => mockClip.getStringAsync(),
}));
jest.mock('expo-file-system', () => ({
  Paths: { cache: 'file:///cache' },
  File: class {
    uri: string;
    name: string;
    constructor(dir: string, fileName: string) {
      this.name = fileName;
      this.uri = `${dir}/${fileName}`;
    }
    create() {}
    write(content: string, opts?: { encoding?: string }) {
      mockWritten.push({ name: this.name, content, encoding: opts?.encoding });
    }
  },
}));

// depois dos mocks
// eslint-disable-next-line import/first
import { readClipboard, stripDataUri } from '../clipboard';

beforeEach(() => {
  jest.clearAllMocks();
  mockWritten.length = 0;
});

describe('colar da área de transferência', () => {
  it('print copiado vira arquivo no cache (base64 sem o prefixo data:)', async () => {
    mockClip.hasImageAsync.mockResolvedValue(true);
    mockClip.getImageAsync.mockResolvedValue({ data: 'data:image/png;base64,iVBORw0KGgo=' });
    const res = await readClipboard(() => 42);
    expect(res).toEqual({ kind: 'image', uri: 'file:///cache/print-colado-42.png' });
    expect(mockWritten).toEqual([{ name: 'print-colado-42.png', content: 'iVBORw0KGgo=', encoding: 'base64' }]);
    expect(mockClip.getStringAsync).not.toHaveBeenCalled();
  });

  it('sem imagem, usa o texto; vazio quando não há nada', async () => {
    mockClip.hasImageAsync.mockResolvedValue(false);
    mockClip.hasStringAsync.mockResolvedValue(true);
    mockClip.getStringAsync.mockResolvedValue('Filmes:\nDuna (2021)');
    expect(await readClipboard()).toEqual({ kind: 'text', text: 'Filmes:\nDuna (2021)' });
    mockClip.getStringAsync.mockResolvedValue('   ');
    expect(await readClipboard()).toEqual({ kind: 'empty' });
  });

  it('prefixo data: de png e jpeg', () => {
    expect(stripDataUri('data:image/jpeg;base64,AAA')).toEqual({ base64: 'AAA', ext: 'jpg' });
    expect(stripDataUri('BBB')).toEqual({ base64: 'BBB', ext: 'png' });
  });
});
