import { DELETE_ACCOUNT_CONFIRMATION } from '@fruiqo/contracts';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { ApiError, api, authProviders } from '../api/client';
import { GoogleButton } from '../components/GoogleButton';
import { useAuth } from '../auth/AuthContext';
import { Modal } from '../components/shared';

/** Exclusão definitiva da conta (LGPD art. 18, VI; App Store 5.1.1(v)). */
export function DeleteAccountSection() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <h2>Excluir minha conta</h2>
      <p className="muted small">
        Apaga de vez a sua conta e tudo o que está nela: catálogo, listas, revisões, compartilhamentos, perfil de gosto,
        histórico e sessões em todos os aparelhos. Não dá para desfazer.
      </p>
      <button type="button" className="btn btn-danger" onClick={() => setOpen(true)}>
        Excluir minha conta
      </button>
      {open && <DeleteAccountDialog onClose={() => setOpen(false)} />}
    </>
  );
}

export function DeleteAccountDialog({ onClose }: { onClose: () => void }) {
  const { deleteAccount } = useAuth();
  // conta criada pelo Google não tem senha: confirma pelo Google
  const settings = useQuery({ queryKey: ['settings'], queryFn: api.settings });
  const googleOnly = settings.data?.hasPassword === false;
  const [googleId, setGoogleId] = useState<string | null>(null);
  useEffect(() => {
    if (googleOnly) void authProviders().then((p) => setGoogleId(p.google?.clientId ?? null));
  }, [googleOnly]);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const confirmed = confirm === DELETE_ACCOUNT_CONFIRMATION;
  const ready = password.length > 0 && confirmed && !busy;

  const run = async (proof: { password: string } | { googleCredential: string }) => {
    setBusy(true);
    setError(null);
    try {
      await deleteAccount(proof);
    } catch (err) {
      setBusy(false);
      if (err instanceof ApiError && err.status === 401) setError(googleOnly ? 'Confirme com a mesma conta Google.' : 'Senha incorreta.');
      else if (err instanceof ApiError && err.status === 429) setError('Muitas tentativas. Espere um minuto.');
      else setError('Não foi possível excluir a conta agora. Tente de novo.');
    }
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (ready) await run({ password });
  };

  return (
    <Modal title="Excluir minha conta" onClose={onClose}>
      <form onSubmit={(e) => void submit(e)} className="stack">
        <p>
          Isto apaga <strong>definitivamente</strong> a sua conta e todos os seus dados no Fruiqo. Os aparelhos conectados
          serão desconectados.
        </p>
        {!googleOnly && (
          <label>
            Sua senha atual
            <input
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              data-autofocus
            />
          </label>
        )}
        <label>
          Digite <strong>{DELETE_ACCOUNT_CONFIRMATION}</strong> para confirmar
          <input value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="off" {...(googleOnly ? { 'data-autofocus': true } : {})} />
        </label>
        {googleOnly && confirmed && googleId && !busy && (
          <div>
            <p className="small muted">Sua conta entra pelo Google: confirme com ele para excluir.</p>
            <GoogleButton clientId={googleId} text="continue_with" onCredential={(c) => void run({ googleCredential: c })} />
          </div>
        )}
        {error && (
          <p role="alert" className="error">
            {error}
          </p>
        )}
        <div className="row">
          <button type="button" className="btn" onClick={onClose}>
            Cancelar
          </button>
          <button type="submit" className="btn btn-danger" disabled={!ready} hidden={googleOnly}>
            {busy ? 'Excluindo…' : 'Excluir definitivamente'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
