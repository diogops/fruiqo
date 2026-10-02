// Verificação em duas etapas (TOTP): QR para o app autenticador, primeiro código para ligar, códigos de
// recuperação mostrados uma vez e desligar com um código. Obrigatória para o administrador.
import type { MfaSetupResponse } from '@fruiqo/contracts';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import QRCode from 'qrcode';
import { useEffect, useState, type FormEvent } from 'react';
import { ApiError, api } from '../api/client';
import { ErrorNote } from '../components/shared';
import { useToast } from '../components/Toast';

export function MfaSection() {
  const settings = useQuery({ queryKey: ['settings'], queryFn: api.settings });
  const qc = useQueryClient();
  const toast = useToast();
  const [setup, setSetup] = useState<MfaSetupResponse | null>(null);
  const [qr, setQr] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [recovery, setRecovery] = useState<string[] | null>(null);
  const [disabling, setDisabling] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const on = settings.data?.mfaEnabled === true;

  useEffect(() => {
    if (!setup) return setQr(null);
    let alive = true;
    void QRCode.toDataURL(setup.otpauthUrl, { margin: 1, width: 192 }).then((url) => alive && setQr(url));
    return () => {
      alive = false;
    };
  }, [setup]);

  async function start() {
    setError(null);
    setBusy(true);
    try {
      setSetup(await api.mfaSetup());
      setCode('');
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  async function confirm(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const r = await api.mfaEnable(code.trim());
      setRecovery(r.recoveryCodes);
      setSetup(null);
      setCode('');
      await qc.invalidateQueries({ queryKey: ['settings'] });
      toast.show('Verificação em duas etapas ligada.');
    } catch (err) {
      setError(err instanceof ApiError && err.status === 401 ? new Error('Código inválido. Confira o horário do celular e tente o código atual.') : err);
    } finally {
      setBusy(false);
    }
  }

  async function disable(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await api.mfaDisable(code.trim());
      setDisabling(false);
      setCode('');
      setRecovery(null);
      await qc.invalidateQueries({ queryKey: ['settings'] });
      toast.show('Verificação em duas etapas desligada.');
    } catch (err) {
      setError(err instanceof ApiError && err.status === 401 ? new Error('Código inválido.') : err);
    } finally {
      setBusy(false);
    }
  }

  if (!settings.data) return null;
  return (
    <section id="mfa" className="mfa" aria-labelledby="mfa-title">
      <h2 id="mfa-title">Verificação em duas etapas</h2>
      <p className="muted small">
        Além da senha (ou do Google), o login pede um código de 6 dígitos de um app autenticador, como Google Authenticator,
        Authy ou 1Password.{settings.data.isAdmin ? ' Obrigatória para a administração.' : ''}
      </p>
      <ErrorNote error={error} />

      {recovery && (
        <div className="card mfa-recovery" role="status">
          <strong>Guarde estes códigos de recuperação</strong>
          <p className="small muted">Cada um vale uma vez, se você perder o celular. Eles não serão mostrados de novo.</p>
          <ul>
            {recovery.map((c) => (
              <li key={c}>
                <code>{c}</code>
              </li>
            ))}
          </ul>
          <div className="row">
            <button type="button" className="btn btn-sm" onClick={() => void navigator.clipboard?.writeText(recovery.join('\n'))}>
              Copiar
            </button>
            <button type="button" className="btn btn-sm btn-primary" onClick={() => setRecovery(null)}>
              Já guardei
            </button>
          </div>
        </div>
      )}

      {on && !disabling && (
        <p>
          <span className="badge badge-ok">Ligada</span>{' '}
          <button type="button" className="btn btn-link btn-sm" onClick={() => setDisabling(true)}>
            Desligar
          </button>
        </p>
      )}
      {on && disabling && (
        <form className="row mfa-form" onSubmit={(e) => void disable(e)}>
          <label>
            Código do app (ou de recuperação) para desligar
            <input value={code} onChange={(e) => setCode(e.target.value)} inputMode="numeric" autoComplete="one-time-code" maxLength={20} autoFocus />
          </label>
          <button type="submit" className="btn btn-danger" disabled={busy || code.trim().length < 6}>
            Desligar
          </button>
          <button type="button" className="btn btn-link" onClick={() => setDisabling(false)}>
            Cancelar
          </button>
        </form>
      )}

      {!on && !setup && (
        <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void start()}>
          Ativar verificação em duas etapas
        </button>
      )}
      {!on && setup && (
        <div className="card mfa-setup">
          <ol className="mfa-steps">
            <li>No app autenticador, adicione uma conta lendo o QR code abaixo.</li>
            <li>Digite o código de 6 dígitos que aparecer no app.</li>
          </ol>
          <div className="mfa-qr">
            {qr ? <img src={qr} alt="QR code para o app autenticador" width={192} height={192} /> : <span className="skeleton mfa-qr-skel" />}
            <p className="small muted">
              Sem câmera? Digite a chave no app: <code className="mfa-secret">{setup.secret.replace(/(.{4})/g, '$1 ').trim()}</code>
            </p>
          </div>
          <form className="row mfa-form" onSubmit={(e) => void confirm(e)}>
            <label>
              Código do app
              <input value={code} onChange={(e) => setCode(e.target.value)} inputMode="numeric" autoComplete="one-time-code" maxLength={6} autoFocus />
            </label>
            <button type="submit" className="btn btn-primary" disabled={busy || code.trim().length !== 6}>
              Ligar
            </button>
            <button type="button" className="btn btn-link" onClick={() => setSetup(null)}>
              Cancelar
            </button>
          </form>
        </div>
      )}
    </section>
  );
}
