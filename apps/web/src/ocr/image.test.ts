import { afterEach, describe, expect, it, vi } from 'vitest';
import { clampCrop, ImageInputError, loadImage, MAX_IMAGE_BYTES, ocrScale } from './image';

afterEach(() => vi.unstubAllGlobals());

const png = (bytes = 10, name = 'print.png', type = 'image/png') => new File([new Uint8Array(bytes)], name, { type });

describe('imagem para o OCR', () => {
  it('recusa formato, tamanho e dimensões fora do limite, e imagem corrompida', async () => {
    await expect(loadImage(png(10, 'lista.pdf', 'application/pdf'))).rejects.toMatchObject({ code: 'type' });
    const big = png(1);
    Object.defineProperty(big, 'size', { value: MAX_IMAGE_BYTES + 1 });
    await expect(loadImage(big)).rejects.toMatchObject({ code: 'size' });
    vi.stubGlobal('createImageBitmap', vi.fn(async () => Promise.reject(new Error('bad'))));
    await expect(loadImage(png())).rejects.toMatchObject({ code: 'decode' });
    const close = vi.fn();
    vi.stubGlobal('createImageBitmap', vi.fn(async () => ({ width: 20_000, height: 100, close })));
    const err = await loadImage(png()).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ImageInputError);
    expect((err as ImageInputError).code).toBe('dimensions');
    expect(close).toHaveBeenCalled();
  });

  it('imagem válida ganha object URL para a prévia', async () => {
    vi.stubGlobal('createImageBitmap', vi.fn(async () => ({ width: 589, height: 1280, close: vi.fn() })));
    const createObjectURL = vi.fn(() => 'blob:prévia');
    vi.stubGlobal('URL', Object.assign(URL, { createObjectURL, revokeObjectURL: vi.fn() }));
    const img = await loadImage(png());
    expect(img).toMatchObject({ width: 589, height: 1280, url: 'blob:prévia' });
  });

  it('recorte: sem recorte (ou minúsculo) usa a imagem inteira; recorte fora da borda é ajustado', () => {
    const img = { width: 600, height: 1200 };
    expect(clampCrop(img, null)).toEqual({ x: 0, y: 0, width: 600, height: 1200 });
    expect(clampCrop(img, { x: 10, y: 10, width: 3, height: 3 })).toEqual({ x: 0, y: 0, width: 600, height: 1200 });
    expect(clampCrop(img, { x: 500, y: 1000, width: 400, height: 900 })).toEqual({ x: 500, y: 1000, width: 100, height: 200 });
  });

  it('escala: amplia print pequeno (até 2x), não mexe no que já é legível e só reduz acima do teto', () => {
    expect(ocrScale(589, 1280)).toBe(2);
    expect(ocrScale(800, 1600)).toBeCloseTo(1.5);
    expect(ocrScale(300, 400)).toBe(2);
    expect(ocrScale(1500, 3000)).toBe(1);
    const s = ocrScale(8000, 6000);
    expect(8000 * 6000 * s * s).toBeLessThanOrEqual(16_000_001);
  });
});
