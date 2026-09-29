// Contador de títulos pendentes de revisão (RF-42), compartilhado entre a aba Catálogo (badge),
// a tela de Revisão e a home. Atualiza ao voltar ao app e quando alguém chama `refresh`.
import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { AppState } from 'react-native';

import { getReview } from '../api/client';
import { useAppState } from '../state/AppState';

type ReviewCount = { count: number; refresh: () => Promise<void> };

const Ctx = createContext<ReviewCount>({ count: 0, refresh: async () => {} });

export function ReviewCountProvider({ children }: { children: React.ReactNode }) {
  const { authStatus } = useAppState();
  const [count, setCount] = useState(0);

  const refresh = useCallback(async () => {
    if (authStatus !== 'signedIn') return;
    try {
      setCount((await getReview()).items.length);
    } catch {
      // badge é informativo: falha de rede não interrompe a navegação
    }
  }, [authStatus]);

  useEffect(() => {
    void refresh();
    const sub = AppState.addEventListener('change', (s) => s === 'active' && void refresh());
    const timer = setInterval(() => void refresh(), 60_000);
    return () => {
      sub.remove();
      clearInterval(timer);
    };
  }, [refresh]);

  return <Ctx.Provider value={{ count, refresh }}>{children}</Ctx.Provider>;
}

export const useReviewCount = () => useContext(Ctx);
