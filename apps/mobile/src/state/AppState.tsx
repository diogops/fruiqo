// Estado global do app: consentimento de uso de IA, sessão e share pendente.
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { CreateShareRequest } from '@fruiqo/contracts';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

import * as api from '../api/client';

// Versão do texto de consentimento; mudar o texto exige novo aceite (TOS-REQ-30, SEC-REQ-23).
export const CONSENT_VERSION = '2026-09-28';
const CONSENT_KEY = 'fruiqo.consentVersion';

type AuthStatus = 'loading' | 'signedOut' | 'signedIn';

type AppState = {
  ready: boolean;
  consented: boolean;
  authStatus: AuthStatus;
  pendingShare: CreateShareRequest | null;
  acceptConsent: () => Promise<void>;
  signIn: (mode: 'login' | 'register', email: string, password: string, deviceName: string) => Promise<void>;
  signOut: () => Promise<void>;
  setPendingShare: (share: CreateShareRequest | null) => void;
};

const Ctx = createContext<AppState | null>(null);

export function AppStateProvider({ children }: { children: ReactNode }) {
  const [consented, setConsented] = useState<boolean | null>(null);
  const [authStatus, setAuthStatus] = useState<AuthStatus>('loading');
  const [pendingShare, setPendingShare] = useState<CreateShareRequest | null>(null);

  useEffect(() => {
    AsyncStorage.getItem(CONSENT_KEY)
      .then((v) => setConsented(v === CONSENT_VERSION))
      .catch(() => setConsented(false));

    api
      .refreshSession()
      .then((ok) => setAuthStatus(ok ? 'signedIn' : 'signedOut'))
      .catch(async () => {
        // Sem rede: se existe sessão guardada, segue logado e tenta renovar na próxima chamada.
        setAuthStatus((await api.hasStoredSession()) ? 'signedIn' : 'signedOut');
      });

    api.setSessionLostHandler(() => setAuthStatus('signedOut'));
    return () => api.setSessionLostHandler(null);
  }, []);

  const acceptConsent = useCallback(async () => {
    await AsyncStorage.setItem(CONSENT_KEY, CONSENT_VERSION);
    setConsented(true);
  }, []);

  const signIn = useCallback<AppState['signIn']>(async (mode, email, password, deviceName) => {
    const body = { email, password, deviceName };
    await (mode === 'login' ? api.login(body) : api.register(body));
    setAuthStatus('signedIn');
  }, []);

  const signOut = useCallback(async () => {
    await api.logout();
    setAuthStatus('signedOut');
  }, []);

  const value = useMemo<AppState>(
    () => ({
      ready: consented !== null && authStatus !== 'loading',
      consented: consented === true,
      authStatus,
      pendingShare,
      acceptConsent,
      signIn,
      signOut,
      setPendingShare,
    }),
    [consented, authStatus, pendingShare, acceptConsent, signIn, signOut],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAppState() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useAppState fora do AppStateProvider');
  return ctx;
}
