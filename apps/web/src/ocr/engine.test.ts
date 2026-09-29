import { describe, expect, it, vi } from 'vitest';
import { linesOf, OcrCanceledError, OcrEngine, OcrLoadError, type OcrProgress } from './engine';

type Logger = (m: { status: string; progress: number }) => void;

/** Tesseract falso: cada recognize espera `release()`; o logger recebe o progresso. */
function fakeTesseract(opts: { failLoad?: number } = {}) {
  let loads = 0;
  const workers: { terminate: ReturnType<typeof vi.fn>; recognize: ReturnType<typeof vi.fn> }[] = [];
  const pending: { resolve: (text: string) => void }[] = [];
  let logger: Logger = () => undefined;
  const lib = {
    OEM: { LSTM_ONLY: 1 },
    createWorker: vi.fn(async (_langs: string[], _oem: number, o: { logger: Logger }) => {
      loads++;
      if (opts.failLoad && loads <= opts.failLoad) throw new Error('falha ao baixar por.traineddata');
      logger = o.logger;
      logger({ status: 'loading language traineddata', progress: 0.5 });
      const w = {
        terminate: vi.fn(async () => undefined),
        recognize: vi.fn(
          () =>
            new Promise((resolve) => {
              logger({ status: 'recognizing text', progress: 0.3 });
              pending.push({
                resolve: (text) =>
                  resolve({ data: { text, blocks: [{ paragraphs: [{ lines: text.split('\n').map((t) => ({ text: `${t}\n`, confidence: 88 })) }] }] } }),
              });
            }),
        ),
      };
      workers.push(w);
      return w;
    }),
  };
  return { lib, workers, pending, loads: () => loads };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

describe('motor de OCR (worker do Tesseract)', () => {
  it('carrega sob demanda, informa o progresso real e reaproveita o worker', async () => {
    const t = fakeTesseract();
    const load = vi.fn(async () => t.lib as never);
    const engine = new OcrEngine(load);
    expect(load).not.toHaveBeenCalled();
    const progress: OcrProgress[] = [];
    const p1 = engine.recognize('img' as never, (p) => progress.push(p));
    await flush();
    t.pending[0]!.resolve('1. Duna (2021)\nMaid');
    const r1 = await p1;
    expect(r1.lines).toEqual([
      { text: '1. Duna (2021)', confidence: 88 },
      { text: 'Maid', confidence: 88 },
    ]);
    expect(progress).toContainEqual({ phase: 'loading', progress: 0.5 });
    expect(progress).toContainEqual({ phase: 'recognizing', progress: 0.3 });
    const p2 = engine.recognize('img' as never);
    await flush();
    t.pending[1]!.resolve('Up');
    await p2;
    expect(t.lib.createWorker).toHaveBeenCalledTimes(1);
    engine.dispose();
    await flush();
    expect(t.workers[0]!.terminate).toHaveBeenCalled();
  });

  it('cancelar rejeita com OcrCanceledError, encerra o worker e a nova tentativa funciona', async () => {
    const t = fakeTesseract();
    const engine = new OcrEngine(async () => t.lib as never);
    const p = engine.recognize('img' as never);
    await flush();
    engine.cancel();
    await expect(p).rejects.toBeInstanceOf(OcrCanceledError);
    await flush();
    // encerrar no meio de um trabalho quebra o Tesseract: espera o trabalho acabar
    expect(t.workers[0]!.terminate).not.toHaveBeenCalled();
    // a nova tentativa não espera: usa outro worker
    const again = engine.recognize('img' as never);
    await flush();
    expect(t.lib.createWorker).toHaveBeenCalledTimes(2);
    // o resultado do trabalho cancelado chega depois e é ignorado; aí o worker velho é encerrado
    t.pending[0]!.resolve('velho');
    await flush();
    expect(t.workers[0]!.terminate).toHaveBeenCalled();
    t.pending[1]!.resolve('Novo');
    expect((await again).text).toBe('Novo');
  });

  it('uma execução nova invalida a anterior (sem resultado velho sobrescrevendo)', async () => {
    const t = fakeTesseract();
    const engine = new OcrEngine(async () => t.lib as never);
    const first = engine.recognize('a' as never);
    await flush();
    const second = engine.recognize('b' as never);
    await expect(first).rejects.toBeInstanceOf(OcrCanceledError);
    await flush();
    t.pending[0]!.resolve('A');
    t.pending[1]!.resolve('B');
    expect((await second).text).toBe('B');
  });

  it('falha no download do modelo vira OcrLoadError e a próxima tentativa recarrega', async () => {
    const t = fakeTesseract({ failLoad: 1 });
    const engine = new OcrEngine(async () => t.lib as never);
    await expect(engine.recognize('img' as never)).rejects.toBeInstanceOf(OcrLoadError);
    const retry = engine.recognize('img' as never);
    await flush();
    t.pending[0]!.resolve('Soul');
    expect((await retry).text).toBe('Soul');
    expect(t.loads()).toBe(2);
  });

  it('falha no reconhecimento descarta o worker; a nova tentativa usa outro', async () => {
    const t = fakeTesseract();
    const engine = new OcrEngine(async () => t.lib as never);
    const first = engine.recognize('img' as never);
    await flush();
    t.workers[0]!.recognize.mockImplementationOnce(() => Promise.reject(new TypeError("Cannot read properties of null (reading 'postMessage')")));
    t.pending[0]!.resolve('ok');
    await first;
    const broken = engine.recognize('img' as never);
    await expect(broken).rejects.toThrow('Não foi possível ler o texto desta imagem');
    expect(t.workers[0]!.terminate).toHaveBeenCalled();
    const retry = engine.recognize('img' as never);
    await flush();
    t.pending[1]!.resolve('Soul');
    expect((await retry).text).toBe('Soul');
    expect(t.lib.createWorker).toHaveBeenCalledTimes(2);
  });

  it('linesOf percorre blocos → parágrafos → linhas; sem blocos, vazio', () => {
    expect(linesOf({ blocks: null })).toEqual([]);
  });
});
