// OCR dos prints no navegador (Tesseract.js, WebAssembly). A imagem fica no computador do usuário:
// só o texto lido vai para a API, em `pages`, o mesmo caminho dos prints do app (TOS-REQ-21).
// Motor, worker e idiomas vêm do próprio site (/tesseract, copiados no build por scripts/copy-tesseract.mjs).
import { MAX_SCREENSHOT_PAGES } from '@fruiqo/contracts';

/** limite por página do contrato (`pages[]`) */
const MAX_PAGE_CHARS = 8000;
/** prints pequenos são ampliados: o Tesseract erra muito abaixo de ~1000px de largura */
const MIN_WIDTH = 1000;
const MAX_WIDTH = 2400;

export const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp'];

export function isImageFile(file: File): boolean {
  return IMAGE_TYPES.includes(file.type) || /\.(png|jpe?g|webp)$/i.test(file.name);
}

export { MAX_SCREENSHOT_PAGES };

type Worker = Awaited<ReturnType<typeof import('tesseract.js').createWorker>>;
let workerPromise: Promise<Worker> | null = null;

/** Um worker só, criado na primeira leitura (o primeiro uso baixa o motor e os idiomas; depois fica em cache). */
function getWorker(onLoading?: (p: number) => void): Promise<Worker> {
  workerPromise ??= import('tesseract.js').then(({ createWorker, OEM }) =>
    createWorker(['por', 'eng'], OEM.LSTM_ONLY, {
      workerPath: '/tesseract/worker.min.js',
      corePath: '/tesseract/core',
      langPath: '/tesseract/lang',
      // sem blob: o worker vem do próprio site (CSP `worker-src 'self'`)
      workerBlobURL: false,
      gzip: true,
      logger: (m: { status: string; progress: number }) => {
        if (m.status.startsWith('loading') && onLoading) onLoading(m.progress);
      },
    }),
  );
  workerPromise.catch(() => {
    workerPromise = null;
  });
  return workerPromise;
}

/**
 * Prepara o print para o OCR: amplia se for pequeno, passa para tons de cinza e inverte quando o
 * fundo é escuro (modo escuro do Instagram): o Tesseract lê bem melhor texto escuro em fundo claro.
 */
async function prepare(file: File): Promise<HTMLCanvasElement> {
  const bitmap = await createImageBitmap(file);
  const scale = bitmap.width < MIN_WIDTH ? Math.min(2, MIN_WIDTH / bitmap.width) : bitmap.width > MAX_WIDTH ? MAX_WIDTH / bitmap.width : 1;
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close?.();
  const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const d = img.data;
  let sum = 0;
  for (let i = 0; i < d.length; i += 4) {
    const y = 0.299 * d[i]! + 0.587 * d[i + 1]! + 0.114 * d[i + 2]!;
    d[i] = d[i + 1] = d[i + 2] = y;
    sum += y;
  }
  if (sum / (d.length / 4) < 110) {
    for (let i = 0; i < d.length; i += 4) d[i] = d[i + 1] = d[i + 2] = 255 - d[i]!;
  }
  ctx.putImageData(img, 0, 0);
  return canvas;
}

export interface OcrProgress {
  /** índice do print sendo lido (0-based) */
  index: number;
  total: number;
  /** 0..1 do print atual */
  progress: number;
  stage: 'loading' | 'reading';
}

/** Lê cada print e devolve um texto por print (vazio quando não há texto legível). */
export async function readScreenshots(files: File[], onProgress?: (p: OcrProgress) => void): Promise<string[]> {
  const total = files.length;
  const worker = await getWorker((progress) => onProgress?.({ index: 0, total, progress, stage: 'loading' }));
  const out: string[] = [];
  for (let index = 0; index < total; index++) {
    onProgress?.({ index, total, progress: 0, stage: 'reading' });
    const canvas = await prepare(files[index]!);
    const { data } = await worker.recognize(canvas);
    out.push(cleanText(data.text));
    onProgress?.({ index, total, progress: 1, stage: 'reading' });
  }
  return out;
}

/** Linhas aparadas, sem vazias repetidas, no limite do contrato. */
export function cleanText(text: string): string {
  return text
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((l) => l.replace(/\s+/g, ' ').trim())
    .filter((l, i, arr) => l.length > 0 || (i > 0 && arr[i - 1]!.length > 0))
    .join('\n')
    .trim()
    .slice(0, MAX_PAGE_CHARS);
}
