// Opt-in explícito do "Como estou" (RNF-06). Guarda só a versão do aceite; o texto nunca é salvo.
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useCallback, useEffect, useState } from 'react';

export const MOOD_OPT_IN_VERSION = '2026-09-28';
const KEY = 'fruiqo.moodOptInVersion';

export function useMoodOptIn() {
  const [accepted, setAccepted] = useState<boolean | null>(null);

  useEffect(() => {
    AsyncStorage.getItem(KEY)
      .then((v) => setAccepted(v === MOOD_OPT_IN_VERSION))
      .catch(() => setAccepted(false));
  }, []);

  const accept = useCallback(async () => {
    await AsyncStorage.setItem(KEY, MOOD_OPT_IN_VERSION);
    setAccepted(true);
  }, []);

  const revoke = useCallback(async () => {
    await AsyncStorage.removeItem(KEY);
    setAccepted(false);
  }, []);

  return { accepted, accept, revoke };
}
