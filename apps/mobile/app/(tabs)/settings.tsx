import type { Session } from '@fruiqo/contracts';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Alert, ScrollView, Text, View } from 'react-native';

import { API_URL, listSessions, revokeSession } from '../../src/api/client';
import { useMoodOptIn } from '../../src/discover/moodOptIn';
import { useAppState } from '../../src/state/AppState';
import { devToolsEnabled } from '../../src/state/devTools';
import { Button } from '../../src/ui/components';
import { ui } from '../../src/ui/theme';

// Sessões listáveis e revogáveis (SEC-REQ-22).
export default function Settings() {
  const { signOut } = useAppState();
  const router = useRouter();
  const moodOptIn = useMoodOptIn();
  const [sessions, setSessions] = useState<Session[]>([]);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setSessions(await listSessions());
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erro ao carregar sessões.');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  function revoke(s: Session) {
    Alert.alert('Encerrar sessão?', s.deviceName, [
      { text: 'Cancelar', style: 'cancel' },
      {
        text: 'Encerrar',
        style: 'destructive',
        onPress: async () => {
          try {
            if (s.current) {
              await signOut();
              return;
            }
            await revokeSession(s.id);
            await load();
          } catch (e) {
            Alert.alert('Erro', e instanceof Error ? e.message : 'Não foi possível encerrar.');
          }
        },
      },
    ]);
  }

  return (
    <ScrollView style={ui.screen} contentContainerStyle={ui.pad}>
      <Text style={ui.h2}>Sessões ativas</Text>
      {error && <Text style={ui.error}>{error}</Text>}
      {sessions.map((s) => (
        <View key={s.id} style={ui.card}>
          <Text style={ui.body}>
            {s.deviceName}
            {s.current ? ' (este aparelho)' : ''}
          </Text>
          <Text style={ui.muted}>Último uso: {new Date(s.lastUsedAt).toLocaleString('pt-BR')}</Text>
          <Button title="Encerrar" variant="secondary" onPress={() => revoke(s)} />
        </View>
      ))}
      <Text style={ui.h2}>Como estou</Text>
      <Text style={ui.muted}>
        {moodOptIn.accepted
          ? 'Ativado. O texto que você escreve não é guardado, só a intenção interpretada.'
          : 'Desativado. Ao usar pela primeira vez, pedimos sua autorização.'}
      </Text>
      {moodOptIn.accepted && (
        <Button title="Desativar o Como estou" variant="secondary" onPress={() => void moodOptIn.revoke()} />
      )}
      <Button title="Sobre e créditos" variant="secondary" onPress={() => router.push('/about')} />
      {devToolsEnabled ? (
        // Só fora de produção (RF-18); em produção a rota nem existe no bundle.
        <Button title="Simulador de share (dev)" variant="secondary" onPress={() => router.push('/dev/share' as never)} />
      ) : null}
      <Button title="Sair" variant="danger" onPress={() => void signOut()} />
      <Text style={ui.muted}>Servidor: {API_URL}</Text>
    </ScrollView>
  );
}
