import { describe, expect, it } from '@jest/globals';
import { buildShareRequest } from '../buildShareRequest';

const ID = '3f1c2a4e-8b7d-4c1e-9a2f-0b1c2d3e4f5a';

describe('buildShareRequest', () => {
  it('YouTube: text e webUrl iguais (payload real do §4.1)', () => {
    const url = 'https://youtube.com/shorts/RVv7aPxxN_M?is=gXxH5qBEe7-1wBZ9';
    const r = buildShareRequest({ text: url, webUrl: url, files: null }, ID);
    expect(r).toEqual({ kind: 'ok', request: { clientShareId: ID, text: url, url } });
  });

  it('texto com URL embutida mantém o texto e a URL extraída', () => {
    const r = buildShareRequest(
      { text: 'Olha esse post https://www.instagram.com/p/ABC/', webUrl: 'https://www.instagram.com/p/ABC/' },
      ID,
    );
    expect(r.kind).toBe('ok');
    if (r.kind === 'ok') expect(r.request.url).toBe('https://www.instagram.com/p/ABC/');
  });

  it('descarta URL que não seja https', () => {
    const r = buildShareRequest({ text: 'veja http://exemplo.com', webUrl: 'http://exemplo.com' }, ID);
    expect(r).toEqual({ kind: 'ok', request: { clientShareId: ID, text: 'veja http://exemplo.com' } });
  });

  it('só imagem/arquivo: não suportado nesta versão', () => {
    expect(buildShareRequest({ text: null, webUrl: null, files: [{ path: 'x' }] }, ID)).toEqual({
      kind: 'unsupported',
      reason: 'files',
    });
  });

  it('vazio: não suportado', () => {
    expect(buildShareRequest({ text: '   ' }, ID)).toEqual({ kind: 'unsupported', reason: 'empty' });
  });

  it('corta texto acima do limite do contrato', () => {
    const r = buildShareRequest({ text: 'a'.repeat(6000) }, ID);
    expect(r.kind === 'ok' && r.request.text?.length).toBe(5000);
  });
});
