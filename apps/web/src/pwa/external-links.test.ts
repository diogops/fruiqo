import { describe, expect, it, vi } from 'vitest';
import { isIosStandalone, safariUrl, setupExternalLinks } from './external-links';

describe('links externos no app da tela inicial do iPhone', () => {
  it('só http/https vão ao Safari', () => {
    expect(safariUrl('https://www.themoviedb.org/movie/1')).toBe('x-safari-https://www.themoviedb.org/movie/1');
    expect(safariUrl('mailto:a@b.c')).toBeNull();
  });

  it('fora do app instalado, nada muda', () => {
    expect(isIosStandalone({} as Navigator)).toBe(false);
    expect(isIosStandalone({ standalone: true } as unknown as Navigator)).toBe(true);
  });

  it('no app instalado, o TMDB abre no Safari; link do próprio site, não', () => {
    const assigned: string[] = [];
    const win = {
      navigator: { standalone: true },
      document,
      location: { origin: 'https://fruiqo-web.vercel.app' },
      setTimeout: vi.fn(),
      open: vi.fn(),
    } as unknown as Window;
    Object.defineProperty(win.location, 'href', {
      get: () => 'https://fruiqo-web.vercel.app/hoje',
      set: (v: string) => assigned.push(v),
    });
    setupExternalLinks(win);
    const ext = document.createElement('a');
    ext.href = 'https://www.themoviedb.org/movie/863873';
    ext.target = '_blank';
    const own = document.createElement('a');
    own.href = 'https://fruiqo-web.vercel.app/perfil';
    document.body.append(ext, own);
    // o onClick do cartão para a propagação; a captura no document vem antes
    ext.addEventListener('click', (e) => e.stopPropagation());
    const click = (el: Element) => {
      const ev = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 });
      el.dispatchEvent(ev);
      return ev.defaultPrevented;
    };
    expect(click(ext)).toBe(true);
    expect(assigned).toEqual(['x-safari-https://www.themoviedb.org/movie/863873']);
    expect(click(own)).toBe(false);
    expect(assigned).toHaveLength(1);
  });
});
