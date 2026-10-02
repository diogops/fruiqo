// PWA: registra o service worker (só no build de produção) e guarda o convite de instalação do
// Android/Chrome ("beforeinstallprompt") para o botão "Instalar app" usar quando a pessoa quiser.
interface InstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

let deferred: InstallPromptEvent | null = null;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());

export function setupPwa(): void {
  if (typeof window === 'undefined') return;
  window.addEventListener('beforeinstallprompt', (e) => {
    // o navegador mostraria o próprio aviso; guardamos para o botão do app
    e.preventDefault();
    deferred = e as InstallPromptEvent;
    notify();
  });
  window.addEventListener('appinstalled', () => {
    deferred = null;
    notify();
  });
  if (import.meta.env.PROD && 'serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('/sw.js').catch(() => {
        // sem service worker o app continua funcionando, só não fica disponível sem conexão
      });
    });
  }
}

/** O navegador permite instalar agora (Android/Chrome/Edge)? */
export const canInstall = () => deferred !== null;

export function onInstallChange(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Abre o convite de instalação do navegador. Devolve true se a pessoa instalou. */
export async function promptInstall(): Promise<boolean> {
  const e = deferred;
  if (!e) return false;
  await e.prompt();
  const { outcome } = await e.userChoice;
  deferred = null;
  notify();
  return outcome === 'accepted';
}
