// Página pública do link "Esqueci minha senha" (/redefinir-senha?token=...): senha nova e confirmação.
// Ao trocar, todas as sessões são encerradas; a pessoa entra de novo com a senha nova.
import { useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router';
import { ApiError, resetPassword } from '../api/client';
import { BrandMark } from '../components/ui';

const MIN_PASSWORD = 12;

export function ResetPassword() {
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (password.length < MIN_PASSWORD) return setError(`A senha precisa de pelo menos ${MIN_PASSWORD} caracteres.`);
    if (password !== confirm) return setError('As senhas não conferem.');
    setBusy(true);
    try {
      await resetPassword(token, password);
      setDone(true);
    } catch (err) {
      setError(err instanceof ApiError && err.status === 401 ? 'Este link é inválido ou já expirou. Peça outro em "Esqueci minha senha".' : 'Não foi possível trocar a senha agora. Tente de novo.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="legal reset-page">
      <header className="legal-head">
        <Link to="/" className="brand" aria-label="Fruiqo, ir para o início">
          <BrandMark />
          <span className="brand-name">Fruiqo</span>
        </Link>
      </header>
      <div className="card form reset-card">
        <h1>Criar senha nova</h1>
        {done ? (
          <>
            <p className="page-sub">Pronto! Sua senha foi trocada e as sessões abertas foram encerradas.</p>
            <Link className="btn btn-primary" to="/">
              Entrar
            </Link>
          </>
        ) : !token ? (
          <>
            <p className="page-sub">Este link está incompleto. Peça outro em "Esqueci minha senha", na tela de entrada.</p>
            <Link className="btn" to="/">
              Ir para a entrada
            </Link>
          </>
        ) : (
          <form className="form" onSubmit={(e) => void submit(e)} noValidate>
            <label>
              Senha nova
              <input
                type={show ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="new-password"
                minLength={MIN_PASSWORD}
                required
                autoFocus
              />
            </label>
            <label>
              Confirmar senha nova
              <input type={show ? 'text' : 'password'} value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" required />
            </label>
            <label className="check">
              <input type="checkbox" checked={show} onChange={(e) => setShow(e.target.checked)} /> Mostrar senha
            </label>
            <p className="error" role="alert" aria-live="assertive">
              {error}
            </p>
            <button type="submit" className="btn btn-primary" disabled={busy}>
              {busy ? 'Trocando…' : 'Trocar senha'}
            </button>
          </form>
        )}
      </div>
    </main>
  );
}
