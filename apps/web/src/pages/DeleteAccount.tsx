import { DELETE_ACCOUNT_CONFIRMATION } from '@fruiqo/contracts';
import { useState } from 'react';
import { ApiError } from '../api/client';
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
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ready = password.length > 0 && confirm === DELETE_ACCOUNT_CONFIRMATION && !busy;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!ready) return;
    setBusy(true);
    setError(null);
    try {
      await deleteAccount(password);
    } catch (err) {
      setBusy(false);
      if (err instanceof ApiError && err.status === 401) setError('Senha incorreta.');
      else if (err instanceof ApiError && err.status === 429) setError('Muitas tentativas. Espere um minuto.');
      else setError('Não foi possível excluir a conta agora. Tente de novo.');
    }
  };

  return (
    <Modal title="Excluir minha conta" onClose={onClose}>
      <form onSubmit={(e) => void submit(e)} className="stack">
        <p>
          Isto apaga <strong>definitivamente</strong> a sua conta e todos os seus dados no Fruiqo. Os aparelhos conectados
          serão desconectados.
        </p>
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
        <label>
          Digite <strong>{DELETE_ACCOUNT_CONFIRMATION}</strong> para confirmar
          <input value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="off" />
        </label>
        {error && (
          <p role="alert" className="error">
            {error}
          </p>
        )}
        <div className="row">
          <button type="button" className="btn" onClick={onClose}>
            Cancelar
          </button>
          <button type="submit" className="btn btn-danger" disabled={!ready}>
            {busy ? 'Excluindo…' : 'Excluir definitivamente'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
