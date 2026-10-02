import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import { ApiError, authProviders } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { GoogleButton } from '../components/GoogleButton';
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

type Mode = 'login' | 'signup';

const MIN_PASSWORD = 12;

/** Força simples e explicável: comprimento + variedade de classes de caractere. */
export function passwordStrength(pw: string): { score: 0 | 1 | 2 | 3; label: string } {
  if (pw.length < MIN_PASSWORD) return { score: 0, label: `Mínimo de ${MIN_PASSWORD} caracteres` };
  const classes = [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z0-9]/].filter((r) => r.test(pw)).length;
  if (pw.length >= 16 && classes >= 3) return { score: 3, label: 'Forte' };
  if (classes >= 2) return { score: 2, label: 'Boa' };
  return { score: 1, label: 'Fraca: misture letras, números e símbolos' };
}

/** Mensagem clara por status, sem revelar quem está liberado para cadastro. */
function describeError(err: unknown, mode: Mode): string {
  if (err instanceof ApiError) {
    if (mode === 'signup' && err.status === 403) return 'Não foi possível criar a conta com este e-mail.';
    if (mode === 'signup' && err.status === 409) return 'Já existe uma conta com este e-mail. Tente entrar.';
    if (err.status === 400) return 'Confira os dados: e-mail válido e senha com pelo menos 12 caracteres.';
    if (err.status === 429) return 'Muitas tentativas. Aguarde um pouco e tente de novo.';
    return err.message;
  }
  if (err instanceof TypeError) return 'Sem conexão com o servidor. Verifique sua internet.';
  return 'Algo deu errado. Tente de novo.';
}

export function Login() {
  const { signIn, signUp, signInWithGoogle } = useAuth();
  // login com Google: só aparece quando o servidor tem o Client ID
  const [googleId, setGoogleId] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    void authProviders().then((p) => alive && setGoogleId(p.google?.clientId ?? null));
    return () => {
      alive = false;
    };
  }, []);

  async function onGoogle(credential: string) {
    setBusy(true);
    setError('');
    try {
      await signInWithGoogle(credential);
    } catch (err) {
      setBusy(false);
      if (err instanceof ApiError && err.status === 403) setError('Este e-mail ainda não tem acesso ao Fruiqo.');
      else if (err instanceof ApiError && err.status === 401) setError('Não foi possível confirmar sua conta Google. Tente de novo.');
      else setError('Não foi possível entrar com o Google agora.');
    }
  }
  const [mode, setMode] = useState<Mode>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const emailRef = useRef<HTMLInputElement>(null);

  // RF-45: foco no primeiro campo ao abrir e ao alternar o modo.
  useEffect(() => {
    emailRef.current?.focus();
  }, [mode]);

  const strength = passwordStrength(password);
  const signup = mode === 'signup';

  function switchMode(next: Mode) {
    setMode(next);
    setError(null);
    setConfirm('');
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (signup) {
      if (password.length < MIN_PASSWORD) return setError(`A senha precisa de pelo menos ${MIN_PASSWORD} caracteres.`);
      if (password !== confirm) return setError('As senhas não conferem.');
    }
    setBusy(true);
    try {
      if (signup) await signUp(email, password);
      else await signIn(email, password);
    } catch (err) {
      setError(describeError(err, mode));
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
          <p>Tudo o que você salvou dos posts vira uma fila de filmes, séries, livros e músicas — priorizada do seu jeito.</p>
        </div>
        <span className="login-foot">
          Dados de filmes e séries: TMDB · Disponibilidade: JustWatch · <Link to="/privacidade">Política de privacidade</Link>
        </span>
      </section>
      <div className="login-panel">
        <form className="card form" onSubmit={onSubmit} noValidate>
          <div className="auth-tabs" role="tablist" aria-label="Acesso">
            <button type="button" role="tab" aria-selected={!signup} className={!signup ? 'active' : ''} onClick={() => switchMode('login')}>
              Entrar
            </button>
            <button type="button" role="tab" aria-selected={signup} className={signup ? 'active' : ''} onClick={() => switchMode('signup')}>
              Criar conta
            </button>
          </div>
          <div>
            <h1>{signup ? 'Criar conta' : 'Entrar'}</h1>
            <p className="page-sub">
              {signup ? 'Crie seu acesso para organizar seu catálogo.' : 'Organize seu catálogo de filmes, séries, livros e músicas.'}
            </p>
          </div>
          <label>
            E-mail
            <input ref={emailRef} type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" required />
          </label>
          <div className="field">
            <label htmlFor="login-password">Senha</label>
            <span className="password-field">
              <input
                id="login-password"
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete={signup ? 'new-password' : 'current-password'}
                minLength={MIN_PASSWORD}
                required
                aria-describedby={signup ? 'pw-strength' : undefined}
              />
              <button
                type="button"
                className="btn btn-ghost password-toggle"
                onClick={() => setShowPassword((v) => !v)}
                aria-pressed={showPassword}
                aria-label={showPassword ? 'Ocultar senha' : 'Mostrar senha'}
              >
                {showPassword ? 'Ocultar' : 'Mostrar'}
              </button>
            </span>
          </div>
          {signup && (
            <>
              <div id="pw-strength" className={`pw-strength pw-${strength.score}`} aria-live="polite">
                <span className="pw-bar" aria-hidden="true">
                  <i />
                  <i />
                  <i />
                </span>
                {password ? strength.label : `Mínimo de ${MIN_PASSWORD} caracteres`}
              </div>
              <label>
                Confirmar senha
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  autoComplete="new-password"
                  required
                />
              </label>
            </>
          )}
          <p className="error" role="alert" aria-live="assertive">
            {error}
          </p>
          <button type="submit" className="btn btn-primary" disabled={busy}>
            {busy ? (signup ? 'Criando…' : 'Entrando…') : signup ? 'Criar conta' : 'Entrar'}
          </button>
          <p className="small muted legal-note">
            Ao continuar, você concorda com a <Link to="/privacidade">política de privacidade</Link>.
          </p>
          {googleId && (
            <>
              <div className="auth-divider" role="separator">
                <span>ou</span>
              </div>
              <GoogleButton clientId={googleId} text={signup ? 'signup_with' : 'continue_with'} onCredential={(c) => void onGoogle(c)} />
            </>
          )}
        </form>
      </div>
    </div>
  );
}
