import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { completeMfa as apiCompleteMfa, deleteAccount as apiDeleteAccount, login as apiLogin, loginWithGoogle as apiLoginGoogle, logout as apiLogout, onSessionLost, refreshSession, register as apiRegister } from '../api/client';

type AuthState = 'checking' | 'signed_out' | 'signed_in';

interface AuthValue {
  state: AuthState;
  email: string | null;
  /** com MFA ligado, devolve o desafio; a sessão abre em `completeMfa` */
  signIn: (email: string, password: string) => Promise<{ mfaToken: string } | null>;
  /** login com Google (ID token do botão oficial); com MFA, devolve o desafio */
  signInWithGoogle: (credential: string) => Promise<{ mfaToken: string } | null>;
  completeMfa: (mfaToken: string, code: string) => Promise<void>;
  signUp: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  /** exclusão definitiva da conta; em caso de sucesso volta para o login */
  deleteAccount: (proof: { password: string } | { googleCredential: string }) => Promise<void>;
}

const AuthContext = createContext<AuthValue | null>(null);

// Só o e-mail (para o cabeçalho) fica no navegador; tokens nunca.
const EMAIL_KEY = 'fruiqo.web.email';

function readEmail(): string | null {
  try {
    return localStorage.getItem(EMAIL_KEY);
  } catch {
    return null;
  }
}

function writeEmail(email: string | null): void {
  try {
    if (email) localStorage.setItem(EMAIL_KEY, email);
    else localStorage.removeItem(EMAIL_KEY);
  } catch {
    // modo privado / armazenamento bloqueado: segue sem lembrar o e-mail
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>('checking');
  const [email, setEmail] = useState<string | null>(readEmail);

  useEffect(() => {
    onSessionLost(() => setState('signed_out'));
    // Restaura a sessão pelo cookie de refresh (se houver).
    void refreshSession().then((ok) => setState(ok ? 'signed_in' : 'signed_out'));
    return () => onSessionLost(null);
  }, []);

  const signIn = useCallback(async (e: string, password: string) => {
    const challenge = await apiLogin(e, password);
    if (challenge) return challenge;
    const normalized = e.trim().toLowerCase();
    writeEmail(normalized);
    setEmail(normalized);
    setState('signed_in');
    return null;
  }, []);

  const signInWithGoogle = useCallback(async (credential: string) => {
    const r = await apiLoginGoogle(credential);
    if (r.mfaToken) return { mfaToken: r.mfaToken };
    writeEmail(r.email);
    setEmail(r.email);
    setState('signed_in');
    return null;
  }, []);

  const completeMfa = useCallback(async (mfaToken: string, code: string) => {
    const e = await apiCompleteMfa(mfaToken, code);
    writeEmail(e);
    setEmail(e);
    setState('signed_in');
  }, []);

  const signUp = useCallback(async (e: string, password: string) => {
    await apiRegister(e, password);
    const normalized = e.trim().toLowerCase();
    writeEmail(normalized);
    setEmail(normalized);
    setState('signed_in');
  }, []);

  const signOut = useCallback(async () => {
    await apiLogout();
    writeEmail(null);
    setEmail(null);
    setState('signed_out');
  }, []);

  const deleteAccount = useCallback(async (proof: { password: string } | { googleCredential: string }) => {
    await apiDeleteAccount(proof);
    writeEmail(null);
    setEmail(null);
    setState('signed_out');
  }, []);

  const value = useMemo(
    () => ({ state, email, signIn, signInWithGoogle, completeMfa, signUp, signOut, deleteAccount }),
    [state, email, signIn, signInWithGoogle, completeMfa, signUp, signOut, deleteAccount],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth fora do AuthProvider');
  return ctx;
}
