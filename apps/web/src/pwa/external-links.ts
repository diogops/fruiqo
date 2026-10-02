// App da tela inicial do iPhone: link para outro site (TMDB, streaming, Open Library) abre dentro da
// própria janela do app, sem botão de voltar. Lá, o link externo vai para o Safari de verdade
// (`x-safari-https://`, iOS 17+); se o iOS não trocar de app, abre do jeito normal.

/** Rodando como app da tela inicial no iPhone/iPad? */
export function isIosStandalone(nav: Navigator = navigator): boolean {
  return (nav as Navigator & { standalone?: boolean }).standalone === true;
}

/** Endereço que o iOS abre no Safari (só http/https; o resto não muda). */
export function safariUrl(href: string): string | null {
  return /^https?:\/\//i.test(href) ? `x-safari-${href}` : null;
}

export function setupExternalLinks(win: Window = window): void {
  if (!isIosStandalone(win.navigator)) return;
  win.document.addEventListener(
    'click',
    (e) => {
      if (e.button !== 0) return;
      const a = (e.target as Element | null)?.closest?.('a[href]');
      if (!(a instanceof HTMLAnchorElement)) return;
      const url = new URL(a.href, win.location.href);
      if (url.origin === win.location.origin) return;
      const safari = safariUrl(url.href);
      if (!safari) return;
      e.preventDefault();
      win.location.href = safari;
      // iOS antigo não conhece o esquema: continua aqui, então abre como antes
      win.setTimeout(() => {
        if (!win.document.hidden) win.open(url.href, '_blank', 'noopener');
      }, 700);
    },
    // na captura: os links param a propagação no onClick do React (para não abrir o cartão)
    { capture: true },
  );
}
