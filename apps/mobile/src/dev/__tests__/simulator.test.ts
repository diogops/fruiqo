import { describe, expect, it } from '@jest/globals';

import type { RecognizeFn } from '../../share/ingestImages';
import { receiveShare } from '../../share/receiveShare';
import { SIM_FIXTURES } from '../fixtureIndex.generated';
import { fixtureRecognizer, fixtureToIncoming, textToIncoming, urlToIncoming } from '../simulator';

let n = 0;
const newId = () => `7a1c2a4e-8b7d-4c1e-9a2f-0b1c2d3e4f${String(n++).padStart(2, '0')}`;

function withoutId(result: Awaited<ReturnType<typeof receiveShare>>) {
  if (result.kind !== 'ok') return result;
  const { clientShareId: _ignored, ...rest } = result.request;
  return { ...result, request: rest };
}

const fixture = (id: string) => {
  const f = SIM_FIXTURES.find((x) => x.id === id);
  if (!f) throw new Error(`fixture ${id} ausente do índice`);
  return f;
};

describe('RF-18: simulador usa o mesmo ponto de entrada do share real', () => {
  it('fixture de prints: simulador e share sheet geram o mesmo payload (exceto clientShareId)', async () => {
    const fx = fixture('list-overlap-two-pages');
    const viaSimulator = await receiveShare(fixtureToIncoming(fx), {
      recognize: fixtureRecognizer(fx),
      ocrSupported: true,
      newId,
    });

    // Share sheet real: expo-share-intent entrega caminhos de arquivo; o OCR do device leu o mesmo texto.
    const shareIntent = {
      text: null,
      webUrl: null,
      files: [
        { path: '/data/user/0/com.fruiqo.app/cache/p1.png', mimeType: 'image/png' },
        { path: 'content://media/external/images/media/77', mimeType: 'image/jpeg' },
      ],
    };
    const deviceOcr: RecognizeFn = async (uris) => uris.map((_, i) => [fx.pages![i]]);
    const viaShareSheet = await receiveShare(shareIntent, { recognize: deviceOcr, ocrSupported: true, newId });

    expect(viaSimulator.kind).toBe('ok');
    expect(withoutId(viaSimulator)).toEqual(withoutId(viaShareSheet));
  });

  it('fixture de URL: igual ao share de um link no Android (link em text e webUrl)', async () => {
    const fx = fixture('url-instagram-stkn');
    const deps = { recognize: fixtureRecognizer(fx), ocrSupported: true, newId };
    const viaSimulator = await receiveShare(fixtureToIncoming(fx), deps);
    const viaShareSheet = await receiveShare({ text: fx.url!, webUrl: fx.url!, files: null }, deps);
    expect(withoutId(viaSimulator)).toEqual(withoutId(viaShareSheet));
    expect(withoutId(viaSimulator)).toEqual(withoutId(await receiveShare(urlToIncoming(fx.url!), deps)));
  });

  it('fixture de texto: igual ao texto colado', async () => {
    const fx = fixture('pasted-text-list');
    const deps = { recognize: fixtureRecognizer(fx), ocrSupported: true, newId };
    const viaSimulator = await receiveShare(fixtureToIncoming(fx), deps);
    expect(viaSimulator.kind).toBe('ok');
    expect(withoutId(viaSimulator)).toEqual(withoutId(await receiveShare(textToIncoming(fx.text!), deps)));
  });

  it('sem OCR disponível (navegador sem fixture): não envia nada', async () => {
    const fx = fixture('list-overlap-two-pages');
    const result = await receiveShare(fixtureToIncoming(fx), { recognize: fixtureRecognizer(fx), ocrSupported: false, newId });
    expect(result).toEqual({ kind: 'ocr_unavailable' });
  });

  it('o índice só contém fixtures que o share sheet pode entregar', () => {
    expect(SIM_FIXTURES.length).toBeGreaterThanOrEqual(10);
    for (const f of SIM_FIXTURES) expect(['text', 'url', 'screenshot']).toContain(f.kind);
  });
});
