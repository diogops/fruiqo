// Imagem para o OCR: validação (tipo, bytes, dimensões), prévia por object URL e recorte num canvas.
// Nada sai do navegador. A imagem original fica intacta para a prévia; o OCR recebe só o recorte,
// ampliado quando é pequeno (letra miúda de print de celular) e nunca reduzido abaixo do legível.
// Sem filtros de cor: o Tesseract binariza sozinho e trata fundo escuro (texto claro) melhor que um
// limiar nosso, que apagava texto colorido.

/** tipos aceitos (o `accept` do input e a checagem do arquivo usam a mesma lista) */
export const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp'] as const;
export const MAX_IMAGE_BYTES = 15 * 1024 * 1024;
/** maior lado aceito e total de pixels (decodificar uma imagem gigante trava o navegador) */
export const MAX_IMAGE_SIDE = 10_000;
export const MAX_IMAGE_PIXELS = 40_000_000;
/** recorte com menos que isso de largura é ampliado (até 2x): prints de celular chegam com ~600px */
const UPSCALE_BELOW_WIDTH = 1200;
const MAX_UPSCALE = 2;
/** teto do que vai ao OCR; acima disso reduz, mas só até esse limite */
const MAX_OCR_PIXELS = 16_000_000;

export type ImageErrorCode = 'type' | 'size' | 'decode' | 'dimensions';

export class ImageInputError extends Error {
  constructor(
    readonly code: ImageErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'ImageInputError';
  }
}

export interface LoadedImage {
  name: string;
  /** object URL da imagem original (prévia); revogar com `releaseImage` */
  url: string;
  width: number;
  height: number;
  bitmap: ImageBitmap;
}

/** Retângulo em pixels da imagem original. */
export interface PixelCrop {
  x: number;
  y: number;
  width: number;
  height: number;
}

export function isImageFile(file: File): boolean {
  return (IMAGE_TYPES as readonly string[]).includes(file.type) || /\.(png|jpe?g|webp)$/i.test(file.name);
}

/** Valida e decodifica. Erros com mensagem pronta para o usuário. */
export async function loadImage(file: File): Promise<LoadedImage> {
  if (!isImageFile(file)) throw new ImageInputError('type', 'Formato não suportado. Use PNG, JPG ou WebP.');
  if (file.size > MAX_IMAGE_BYTES) {
    throw new ImageInputError('size', `Imagem grande demais (máximo ${Math.round(MAX_IMAGE_BYTES / 1024 / 1024)} MB).`);
  }
  if (file.size === 0) throw new ImageInputError('decode', 'O arquivo está vazio.');
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new ImageInputError('decode', 'Não consegui abrir essa imagem. Ela pode estar corrompida.');
  }
  const { width, height } = bitmap;
  if (width > MAX_IMAGE_SIDE || height > MAX_IMAGE_SIDE || width * height > MAX_IMAGE_PIXELS) {
    bitmap.close?.();
    throw new ImageInputError('dimensions', `Imagem grande demais (${width}×${height}). Recorte ou reduza e tente de novo.`);
  }
  return { name: file.name, url: URL.createObjectURL(file), width, height, bitmap };
}

export function releaseImage(img: LoadedImage | null | undefined): void {
  if (!img) return;
  URL.revokeObjectURL(img.url);
  img.bitmap.close?.();
}

/** Recorte válido dentro da imagem; sem recorte (ou recorte degenerado), a imagem inteira. */
export function clampCrop(img: Pick<LoadedImage, 'width' | 'height'>, crop?: PixelCrop | null): PixelCrop {
  if (!crop || crop.width < 8 || crop.height < 8) return { x: 0, y: 0, width: img.width, height: img.height };
  const x = Math.max(0, Math.min(Math.round(crop.x), img.width - 1));
  const y = Math.max(0, Math.min(Math.round(crop.y), img.height - 1));
  return {
    x,
    y,
    width: Math.max(1, Math.min(Math.round(crop.width), img.width - x)),
    height: Math.max(1, Math.min(Math.round(crop.height), img.height - y)),
  };
}

/** Escala do recorte para o OCR: amplia o que é pequeno; só reduz acima do teto de pixels. */
export function ocrScale(width: number, height: number): number {
  let scale = width < UPSCALE_BELOW_WIDTH ? Math.min(MAX_UPSCALE, UPSCALE_BELOW_WIDTH / width) : 1;
  const pixels = width * height * scale * scale;
  if (pixels > MAX_OCR_PIXELS) scale *= Math.sqrt(MAX_OCR_PIXELS / pixels);
  return scale;
}

/** Canvas com o recorte, na escala do OCR. O canvas é temporário: quem chama descarta depois. */
export function renderForOcr(img: LoadedImage, crop?: PixelCrop | null): HTMLCanvasElement {
  const area = clampCrop(img, crop);
  const scale = ocrScale(area.width, area.height);
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(area.width * scale));
  canvas.height = Math.max(1, Math.round(area.height * scale));
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new ImageInputError('decode', 'O navegador não conseguiu preparar a imagem.');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img.bitmap, area.x, area.y, area.width, area.height, 0, 0, canvas.width, canvas.height);
  return canvas;
}

/** Libera a memória do canvas temporário. */
export function disposeCanvas(canvas: HTMLCanvasElement | null | undefined): void {
  if (!canvas) return;
  canvas.width = 0;
  canvas.height = 0;
}
