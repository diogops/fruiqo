// RF-45: ao entrar numa rota, o foco vai para o primeiro campo habilitado da página; sem campo, para o
// título (h1, tabIndex -1), para que leitores de tela anunciem a troca de página. Nunca rouba o foco de
// um modal aberto nem de algo que o usuário (ou a própria página) já focou dentro do conteúdo.
import { useEffect, type RefObject } from 'react';

export const FIELD_SELECTOR = [
  '[data-autofocus]',
  'input:not([type=hidden]):not([type=file]):not([type=checkbox]):not([type=radio]):not(:disabled)',
  'select:not(:disabled)',
  'textarea:not(:disabled)',
].join(', ');

/** Tempo máximo esperando o conteúdo da rota carregar (listas, formulários que dependem da API). */
const WAIT_MS = 1500;

function modalOpen(): boolean {
  return document.querySelector('[role="dialog"][aria-modal="true"]') !== null;
}

function usable(el: HTMLElement): boolean {
  return !el.closest('[aria-hidden="true"], [inert], .sr-only');
}

/** Primeiro campo da página ou, na falta dele, o título. Retorna o que foi focado. */
export function focusFirst(root: HTMLElement, preferHeading = false): HTMLElement | null {
  const field = preferHeading ? null : [...root.querySelectorAll<HTMLElement>(FIELD_SELECTOR)].find(usable);
  if (field) {
    field.focus();
    return field;
  }
  const heading = root.querySelector<HTMLElement>('h1');
  if (heading) {
    if (!heading.hasAttribute('tabindex')) heading.setAttribute('tabindex', '-1');
    heading.focus({ preventScroll: true });
    return heading;
  }
  return null;
}

/**
 * Aplica o foco automático a cada troca de rota. No toque (pointer: coarse) foca o título em vez de
 * um campo de texto, para não abrir o teclado virtual sozinho.
 */
export function useRouteAutofocus(rootRef: RefObject<HTMLElement | null>, routeKey: string) {
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const coarse = typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse)').matches;
    let focused: HTMLElement | null = null;
    let done = false;

    const tryFocus = () => {
      if (done || modalOpen()) return;
      const active = document.activeElement;
      const elsewhere = active !== null && active !== document.body && active !== focused;
      // já focamos algo e o foco mudou depois (usuário ou a própria página): respeita
      if (focused && elsewhere) {
        done = true;
        return;
      }
      // a página já pôs o foco dentro do conteúdo antes de nós
      if (!focused && elsewhere && root.contains(active)) {
        done = true;
        return;
      }
      const el = focusFirst(root, coarse);
      if (el && el.tagName !== 'H1') done = true;
      focused = el;
    };

    const raf = requestAnimationFrame(tryFocus);
    // conteúdo que chega da API depois: ainda dá tempo de focar o primeiro campo
    const observer = new MutationObserver(tryFocus);
    observer.observe(root, { childList: true, subtree: true });
    const stop = setTimeout(() => observer.disconnect(), WAIT_MS);
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(stop);
      observer.disconnect();
    };
  }, [rootRef, routeKey]);
}
