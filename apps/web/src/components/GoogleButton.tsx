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
  const box = useRef<HTMLDivElement>(null);
  const cb = useRef(onCredential);
  cb.current = onCredential;
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    loadGis()
      .then((gis) => {
        if (!alive || !box.current) return;
        gis.initialize({ client_id: clientId, callback: (r) => r.credential && cb.current(r.credential), ux_mode: 'popup', auto_select: false, itp_support: true });
        const light = document.documentElement.dataset.theme === 'light';
        gis.renderButton(box.current, {
          type: 'standard',
          theme: light ? 'outline' : 'filled_black',
          size: 'large',
          text,
          shape: 'pill',
          logo_alignment: 'left',
          locale: 'pt-BR',
          width: Math.max(220, Math.min(400, box.current.clientWidth || 320)),
        });
      })
      .catch(() => alive && setFailed(true));
    return () => {
      alive = false;
    };
  }, [clientId, text]);

  if (failed) return <p className="muted small">Não foi possível carregar o login com Google agora.</p>;
  return <div ref={box} className="google-btn" />;
}
