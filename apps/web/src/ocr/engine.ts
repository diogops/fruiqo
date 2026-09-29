// Motor de OCR no navegador (Tesseract.js 7, WebAssembly num Web Worker). A biblioteca e os modelos
// (português + inglês) são carregados sob demanda, do próprio site (/tesseract, copiados no build por
// scripts/copy-tesseract.mjs): nenhuma imagem sai do navegador e não há CDN nem API de terceiro.
// Um worker por fluxo aberto, reaproveitado entre execuções; `dispose()` libera ao fechar.
// Uma execução por vez: começar outra ou cancelar invalida a anterior (o resultado velho é descartado).

export type OcrPhase = 'loading' | 'recognizing';

export interface OcrProgress {
  phase: OcrPhase;
  /** 0..1, o progresso que o Tesseract informa para a etapa atual */
  progress: number;
}

export type { OcrLine } from '@fruiqo/contracts';
import type { OcrLine } from '@fruiqo/contracts';

export interface OcrResult {
  text: string;
  lines: OcrLine[];
}

export class OcrCanceledError extends Error {
  constructor() {
    super('Leitura cancelada.');
    this.name = 'OcrCanceledError';
  }
}

export class OcrLoadError extends Error {
  constructor() {
    super('Não foi possível carregar o leitor de texto. Confira a conexão e tente de novo.');
    this.name = 'OcrLoadError';
  }
}

type Tesseract = typeof import('tesseract.js');
type Worker = Awaited<ReturnType<Tesseract['createWorker']>>;
type Page = Awaited<ReturnType<Worker['recognize']>>['data'];
export type OcrImage = Parameters<Worker['recognize']>[0];

export const TESSERACT_PATHS = {
  workerPath: '/tesseract/worker.min.js',
  corePath: '/tesseract/core',
  langPath: '/tesseract/lang',
} as const;

interface Run {
  id: number;
  onProgress?: (p: OcrProgress) => void;
  cancel: (err: Error) => void;
}

/** Um worker do Tesseract e de qual execução ele é (para não misturar progresso de execuções). */
interface Slot {
  worker: Promise<Worker>;
  owner: number;
  /** trabalho em andamento: o worker só é encerrado depois dele (encerrar no meio quebra o Tesseract) */
  job: Promise<unknown> | null;
}

export class OcrEngine {
  private slot: Slot | null = null;
  private current: Run | null = null;
  private seq = 0;

  constructor(private readonly load: () => Promise<Tesseract> = () => import('tesseract.js')) {}

  get busy(): boolean {
    return this.current !== null;
  }

  /** Lê o texto. Rejeita com OcrCanceledError se cancelada/substituída, OcrLoadError se o modelo não carregar. */
  recognize(image: OcrImage, onProgress?: (p: OcrProgress) => void): Promise<OcrResult> {
    this.cancel();
    const id = ++this.seq;
    return new Promise<OcrResult>((resolve, reject) => {
      this.current = { id, onProgress, cancel: reject };
      const live = () => this.current?.id === id;
      const slot = this.getSlot(id);
      void (async () => {
        let worker: Worker;
        try {
          worker = await slot.worker;
        } catch {
          if (this.slot === slot) this.slot = null;
          if (live()) {
            this.current = null;
            reject(new OcrLoadError());
          }
          return;
        }
        // cancelada enquanto os modelos carregavam: a promessa já foi rejeitada
        if (!live()) return;
        const job = worker.recognize(image, {}, { text: true, blocks: true });
        slot.job = job;
        try {
          const { data } = await job;
          if (live()) resolve({ text: data.text ?? '', lines: linesOf(data) });
        } catch {
          // worker em estado ruim: sai de uso; a próxima tentativa cria outro (modelos já em cache)
          if (this.slot === slot) this.release(slot);
          if (live()) reject(new Error('Não foi possível ler o texto desta imagem. Tente de novo.'));
        } finally {
          slot.job = null;
          if (live()) this.current = null;
        }
      })();
    });
  }

  /**
   * Cancela a execução atual: rejeita na hora e descarta o resultado. O Tesseract não interrompe um
   * reconhecimento no meio (e encerrar o worker durante um trabalho quebra a biblioteca), então o
   * worker em uso sai de cena e é encerrado assim que termina; uma nova tentativa usa outro worker,
   * com os modelos já em cache.
   */
  cancel(): void {
    const run = this.current;
    if (!run) return;
    this.current = null;
    run.cancel(new OcrCanceledError());
    if (this.slot) this.release(this.slot);
  }

  /** Fecha o fluxo: cancela o que estiver rodando e libera o worker. */
  dispose(): void {
    this.cancel();
    if (this.slot) this.release(this.slot);
  }

  /** Tira o worker de uso e o encerra quando estiver livre (carregado e sem trabalho em andamento). */
  private release(slot: Slot) {
    if (this.slot === slot) this.slot = null;
    const idle = slot.job ? slot.job.then(noop, noop) : Promise.resolve();
    void Promise.all([slot.worker, idle])
      .then(([worker]) => worker.terminate())
      .catch(noop);
  }

  private getSlot(owner: number): Slot {
    if (this.slot) {
      this.slot.owner = owner;
      return this.slot;
    }
    const slot: Slot = { owner, job: null, worker: null as unknown as Promise<Worker> };
    slot.worker = this.load().then(({ createWorker, OEM }) =>
      createWorker(['por', 'eng'], OEM.LSTM_ONLY, {
        ...TESSERACT_PATHS,
        // worker vindo do próprio site (CSP `worker-src 'self'`), sem blob:
        workerBlobURL: false,
        gzip: true,
        logger: (m: { status: string; progress: number }) => {
          // só a execução dona deste worker recebe o progresso
          if (this.current?.id !== slot.owner) return;
          const phase: OcrPhase = m.status === 'recognizing text' ? 'recognizing' : 'loading';
          this.current.onProgress?.({ phase, progress: Math.max(0, Math.min(1, m.progress ?? 0)) });
        },
        errorHandler: noop,
      }),
    );
    this.slot = slot;
    return slot;
  }
}

function noop() {
  return undefined;
}

/** Linhas na ordem de leitura, com a confiança de cada uma. */
export function linesOf(page: Pick<Page, 'blocks'>): OcrLine[] {
  const out: OcrLine[] = [];
  for (const block of page.blocks ?? []) {
    for (const para of block.paragraphs) {
      for (const line of para.lines) out.push({ text: line.text.replace(/\n$/, ''), confidence: line.confidence });
    }
  }
  return out;
}
