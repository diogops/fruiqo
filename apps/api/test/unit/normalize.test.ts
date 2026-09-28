import { describe, expect, it } from 'vitest';
import { extractUrl, normalizeSource } from '../../src/pipeline/normalize.js';

describe('normalizeSource', () => {
  it('remove o parâmetro de rastreamento do YouTube Short (device-tests-log A-03)', () => {
    expect(normalizeSource({ text: 'https://youtube.com/shorts/RVv7aPxxN_M?is=gXxH5qBEe7-1wBZ9' })).toEqual({
      platform: 'youtube',
      url: 'https://youtube.com/shorts/RVv7aPxxN_M',
    });
  });

  it('remove o stkn do Reel do Instagram (device-tests-log A-09 / F-03)', () => {
    expect(
      normalizeSource({ text: 'https://www.instagram.com/reel/DbGQZTzBj6W/?stkn=cGFmc3ozMXFxdXVw' }),
    ).toEqual({ platform: 'instagram', url: 'https://www.instagram.com/reel/DbGQZTzBj6W/' });
  });

  it('preserva parâmetros de conteúdo e remove os de rastreamento', () => {
    const r = normalizeSource({ url: 'https://www.youtube.com/watch?v=abc&si=xyz&t=42&utm_source=share&feature=shared' });
    expect(r).toEqual({ platform: 'youtube', url: 'https://www.youtube.com/watch?v=abc&t=42' });
  });

  it('classifica Instagram e TikTok e limpa igsh/_r/_t', () => {
    expect(normalizeSource({ url: 'https://www.instagram.com/reel/C1/?igsh=abc' })).toEqual({
      platform: 'instagram',
      url: 'https://www.instagram.com/reel/C1/',
    });
    expect(normalizeSource({ url: 'https://vm.tiktok.com/ZM123/?_r=1&_t=8x' })).toEqual({
      platform: 'tiktok',
      url: 'https://vm.tiktok.com/ZM123/',
    });
  });

  it('pega a URL de dentro do texto e ignora pontuação final', () => {
    expect(extractUrl('olha isso: https://youtu.be/abc123).')).toBe('https://youtu.be/abc123');
  });

  it('music.youtube.com e domínios desconhecidos viram "other" (P-YTM bloqueado, ARB-REQ-01)', () => {
    expect(normalizeSource({ url: 'https://music.youtube.com/watch?v=x' }).platform).toBe('other');
    expect(normalizeSource({ url: 'https://evil.example.com/a' }).platform).toBe('other');
  });

  it('não aceita look-alike de domínio', () => {
    expect(normalizeSource({ url: 'https://youtube.com.evil.example/watch?v=x' }).platform).toBe('other');
    expect(normalizeSource({ url: 'https://notyoutube.com/watch?v=x' }).platform).toBe('other');
  });

  it('rejeita http, credenciais embutidas e porta explícita', () => {
    expect(normalizeSource({ url: 'http://youtube.com/watch?v=x' }).url).toBeNull();
    expect(normalizeSource({ url: 'https://user:pass@youtube.com/watch?v=x' }).url).toBeNull();
    expect(normalizeSource({ url: 'https://youtube.com:8443/watch?v=x' }).url).toBeNull();
  });

  it('sem URL retorna platform other e url null', () => {
    expect(normalizeSource({ text: 'só texto, sem link' })).toEqual({ platform: 'other', url: null });
  });
});
