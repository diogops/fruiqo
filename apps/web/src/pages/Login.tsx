import { useState, type FormEvent } from 'react';
import { useAuth } from '../auth/AuthContext';
import { ErrorNote } from '../components/shared';
import { BrandMark } from '../components/ui';

// mural decorativo: "cartazes" em degradês grafite/azul (sem imagens de terceiros)
const WALL = [
  'linear-gradient(160deg,#1e3a8a,#0f172a)',
  'linear-gradient(160deg,#334155,#0b1220)',
  'linear-gradient(160deg,#2563eb,#1e293b)',
  'linear-gradient(160deg,#0e7490,#0f172a)',
  'linear-gradient(160deg,#475569,#1e293b)',
  'linear-gradient(160deg,#1d4ed8,#0b1220)',
  'linear-gradient(160deg,#1e293b,#334155)',
  'linear-gradient(160deg,#3b82f6,#1e3a8a)',
  'linear-gradient(160deg,#0f172a,#1e40af)',
  'linear-gradient(160deg,#155e75,#1e293b)',
  'linear-gradient(160deg,#1e3a8a,#334155)',
  'linear-gradient(160deg,#0b1220,#2563eb)',
];

export function Login() {
  const { signIn } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await signIn(email, password);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login">
      <section className="login-hero" aria-hidden="true">
        <div className="poster-wall">
          {WALL.map((bg, i) => (
            <span key={i} style={{ background: bg }} />
          ))}
        </div>
        <div className="brand">
          <BrandMark />
          <span className="brand-name">Fruiqo</span>
        </div>
        <div>
          <h2>Seu cinema, organizado.</h2>
          <p>Tudo o que você salvou dos posts vira uma fila de filmes, séries e músicas — priorizada do seu jeito.</p>
        </div>
        <span className="login-foot">Dados de filmes e séries: TMDB · Disponibilidade: JustWatch</span>
      </section>
      <div className="login-panel">
        <form className="card form" onSubmit={onSubmit}>
          <div>
            <h1>Entrar</h1>
            <p className="page-sub">Organize seu catálogo de filmes, séries e músicas.</p>
          </div>
          <label>
            E-mail
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" required />
          </label>
          <label>
            Senha
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              minLength={12}
              required
            />
          </label>
          <ErrorNote error={error} />
          <button type="submit" className="btn btn-primary" disabled={busy}>
            {busy ? 'Entrando…' : 'Entrar'}
          </button>
        </form>
      </div>
    </div>
  );
}
