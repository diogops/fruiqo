import { MAX_SCREENSHOT_PAGES } from '@fruiqo/contracts';
import { describe, expect, it } from '@jest/globals';

import { ingestImages, pickerAssetsToFiles, selectPickedImages, type RecognizeFn } from '../ingestImages';
import { selectImages } from '../screenshotPages';

// OCR simulado: devolve blocos de texto conforme a URI (o mesmo para os dois caminhos).
const OCR: Record<string, string[]> = {
  'file:///data/user/0/com.fruiqo.app/cache/p1.png': ['cinefilo.br', '1. Oppenheimer (2023)', '2. Duna: Parte Dois (2024)'],
  'content://media/external/images/media/42': ['3. Ainda Estou Aqui (2024)', 'Curtido por alguém'],
};
const recognize: RecognizeFn = async (uris) => uris.map((u) => OCR[u] ?? null);

let n = 0;
const newId = () => `3f1c2a4e-8b7d-4c1e-9a2f-0b1c2d3e4f${String(n++).padStart(2, '0')}`;

function withoutId<T extends { clientShareId: string }>(req: T) {
  const { clientShareId: _ignored, ...rest } = req;
  return rest;
}

describe('RF-40: importar prints usa o mesmo caminho do share', () => {
  // Share sheet: expo-share-intent entrega `path` (absoluto ou content://) + mimeType.
  const shareFiles = [
    { path: '/data/user/0/com.fruiqo.app/cache/p1.png', mimeType: 'image/png' },
    { path: 'content://media/external/images/media/42', mimeType: 'image/jpeg' },
  ];
  // Seletor (galeria/arquivos/câmera): `uri` + mimeType (às vezes só `type: 'image'`).
  const pickerAssets = [
    { uri: 'file:///data/user/0/com.fruiqo.app/cache/p1.png', mimeType: 'image/png' },
    { uri: 'content://media/external/images/media/42', type: 'image' },
  ];

  it('seleciona as mesmas URIs, na mesma ordem', () => {
    expect(selectPickedImages(pickerAssets)).toEqual(selectImages(shareFiles));
  });

  it('gera o mesmo payload, exceto o clientShareId', async () => {
    const viaShare = await ingestImages(selectImages(shareFiles)!, { recognize, newId });
    const viaPicker = await ingestImages(selectPickedImages(pickerAssets)!, { recognize, newId });
    expect(viaShare.kind).toBe('ok');
    expect(viaPicker.kind).toBe('ok');
    if (viaShare.kind !== 'ok' || viaPicker.kind !== 'ok') return;
    expect(viaShare.request.clientShareId).not.toBe(viaPicker.request.clientShareId);
    expect(withoutId(viaPicker.request)).toEqual(withoutId(viaShare.request));
    expect(viaPicker.request.pages).toEqual([
      'cinefilo.br\n1. Oppenheimer (2023)\n2. Duna: Parte Dois (2024)',
      '3. Ainda Estou Aqui (2024)\nCurtido por alguém',
    ]);
  });

  it('respeita o limite de prints e avisa o excedente', () => {
    const many = Array.from({ length: MAX_SCREENSHOT_PAGES + 3 }, (_, i) => ({ uri: `file:///tmp/p${i}.png`, type: 'image' }));
    const sel = selectPickedImages(many);
    expect(sel?.uris).toHaveLength(MAX_SCREENSHOT_PAGES);
    expect(sel?.uris[0]).toBe('file:///tmp/p0.png');
    expect(sel?.truncated).toBe(true);
  });

  it('ignora o que não é imagem (vídeo/PDF) e sinaliza', () => {
    const sel = selectPickedImages([
      { uri: 'file:///tmp/a.png', mimeType: 'image/png' },
      { uri: 'file:///tmp/b.mp4', type: 'video' },
      { uri: 'file:///tmp/c.pdf', mimeType: 'application/pdf' },
    ]);
    expect(sel).toEqual({ uris: ['file:///tmp/a.png'], truncated: false, ignoredOtherFiles: true });
  });

  it('sem imagem: nada a ler', () => {
    expect(selectPickedImages([{ uri: 'file:///tmp/c.pdf', mimeType: 'application/pdf' }])).toBeNull();
    expect(selectPickedImages([])).toBeNull();
  });

  it('OCR sem texto em todas as imagens: vazio (nada é enviado)', async () => {
    const r = await ingestImages({ uris: ['file:///tmp/x.png'], truncated: false, ignoredOtherFiles: false }, {
      recognize: async () => [null],
      newId,
    });
    expect(r).toEqual({ kind: 'empty' });
  });

  it('mimeType tem prioridade sobre type', () => {
    expect(pickerAssetsToFiles([{ uri: 'file:///a', mimeType: 'image/heic', type: 'video' }])).toEqual([
      { path: 'file:///a', mimeType: 'image/heic' },
    ]);
  });
});
