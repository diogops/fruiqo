// Botão oficial "Fazer login com o Google" (Google Identity Services). O script do Google só carrega
// quando o botão aparece; o Google devolve um ID token, que vai direto para a API conferir. O app não
// guarda nada do Google. Regras de marca: o botão é o do próprio Google (docs/phase0/google-signin-tos.md).
import { useEffect, useRef, useState } from 'react';

interface GoogleId {
  initialize(cfg: { client_id: string; callback: (r: { credential?: string }) => void; ux_mode?: 'popup'; auto_select?: boolean; itp_support?: boolean }): void;
  renderButton(el: HTMLElement, opts: Record<string, unknown>): void;
}
declare global {
  interface Window {
    google?: { accounts?: { id?: GoogleId } };
  }
}

let loading: Promise<GoogleId> | null = null;
function loadGis(): Promise<GoogleId> {
  const ready = window.google?.accounts?.id;
  if (ready) return Promise.resolve(ready);
  loading ??= new Promise<GoogleId>((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://accounts.google.com/gsi/client';
    s.async = true;
    s.onload = () => (window.google?.accounts?.id ? resolve(window.google.accounts.id) : reject(new Error('gis')));
    s.onerror = () => {
      loading = null;
      reject(new Error('gis'));
    };
    document.head.appendChild(s);
  });
  return loading;
}

export function GoogleButton({
  clientId,
  onCredential,
  text = 'continue_with',
}: {
  clientId: string;
  onCredential: (credential: string) => void;
  /** texto do botão (padrões do Google): "Continuar com o Google", "Fazer login com o Google"... */
  text?: 'continue_with' | 'signin_with' | 'signup_with';
}) {
  const wrap = useRef<HTMLDivElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const cb = useRef(onCredential);
  cb.current = onCredential;
  const [failed, setFailed] = useState(false);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let alive = true;
    loadGis()
      .then((gis) => {
        if (!alive || !box.current) return;
        gis.initialize({ client_id: clientId, callback: (r) => r.credential && cb.current(r.credential), ux_mode: 'popup', auto_select: false, itp_support: true });
        // o botão oficial fica invisível por cima do nosso (mesmo tamanho) e recebe o clique
        gis.renderButton(box.current, {
          type: 'standard',
          theme: 'outline',
          size: 'large',
          text,
          shape: 'pill',
          logo_alignment: 'left',
          locale: 'pt-BR',
          width: Math.max(220, Math.min(400, wrap.current?.clientWidth || 320)),
        });
        setReady(true);
      })
      .catch(() => alive && setFailed(true));
    return () => {
      alive = false;
    };
  }, [clientId, text]);

  if (failed) return <p className="muted small">Não foi possível carregar o login com Google agora.</p>;
  // Aparência no padrão "Neutro" das regras de marca do Google (fundo #F2F2F2, "G" nas cores originais);
  // o clique vai para o botão oficial do Google, transparente por cima
  return (
    <div ref={wrap} className={ready ? 'google-btn ready' : 'google-btn'}>
      <span className="google-face" aria-hidden="true">
        <GoogleG />
        <span>{LABELS[text]}</span>
      </span>
      <div ref={box} className="google-official" />
    </div>
  );
}

const LABELS = { continue_with: 'Continuar com o Google', signin_with: 'Fazer login com o Google', signup_with: 'Inscrever-se com o Google' } as const;

/** "G" oficial do Google, nas quatro cores (sem alterar). */
function GoogleG() {
  return (
    <svg className="google-g" viewBox="0 0 48 48" width="20" height="20" focusable="false">
      <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
      <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
      <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
      <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
    </svg>
  );
}
