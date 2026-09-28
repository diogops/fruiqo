import AsyncStorage from '@react-native-async-storage/async-storage';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useColorScheme } from 'react-native';

import { applyTheme, resolveTheme, type ThemeName, type ThemePreference } from './theme';

export { resolveTheme, type ThemePreference };

const STORAGE_KEY = 'fruiqo-theme';

interface ThemeContextValue {
  /** tema efetivo em uso */
  name: ThemeName;
  preference: ThemePreference;
  setPreference: (p: ThemePreference) => void;
}

const ThemeContext = createContext<ThemeContextValue>({ name: 'dark', preference: 'system', setPreference: () => {} });

/** Segue o sistema por padrão; a escolha manual (Ajustes) fica salva só no aparelho. */
export function ThemeProvider({ children }: { children: ReactNode }) {
  const system = useColorScheme();
  const [preference, setPref] = useState<ThemePreference>('system');

  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY)
      .then((v) => {
        if (v === 'system' || v === 'dark' || v === 'light') setPref(v);
      })
      .catch(() => {});
  }, []);

  const setPreference = useCallback((p: ThemePreference) => {
    setPref(p);
    AsyncStorage.setItem(STORAGE_KEY, p).catch(() => {});
  }, []);

  const name = resolveTheme(preference, system);
  // aplica antes de renderizar os filhos, para que leiam os tokens novos nesta mesma passada
  applyTheme(name);

  const value = useMemo(() => ({ name, preference, setPreference }), [name, preference, setPreference]);
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

/** Chame nas telas/componentes que usam `colors`/`ui`/`gradients`: re-renderiza quando o tema muda. */
export function useTheme(): ThemeContextValue {
  return useContext(ThemeContext);
}
