import type { Session, UserSettings } from '@fruiqo/contracts';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Alert, ScrollView, Switch, Text, View } from 'react-native';

import { API_URL, getSettings, listSessions, revokeSession, updateSettings } from '../../src/api/client';
import { useMoodOptIn } from '../../src/discover/moodOptIn';
import { useAppState } from '../../src/state/AppState';
import { devToolsEnabled } from '../../src/state/devTools';
import { Button, Chip } from '../../src/ui/components';
import { colors, ui } from '../../src/ui/theme';
import { type ThemePreference, useTheme } from '../../src/ui/ThemeProvider';

const THEME_OPTIONS: { value: ThemePreference; label: string; icon: 'phone-portrait-outline' | 'moon' | 'sunny' }[] = [
  { value: 'system', label: 'Sistema', icon: 'phone-portrait-outline' },
  { value: 'dark', label: 'Escuro', icon: 'moon' },
  { value: 'light', label: 'Claro', icon: 'sunny' },
];

// Sessões listáveis e revogáveis (SEC-REQ-22).
export default function Settings() {
  const theme = useTheme(); // re-renderiza na troca de tema
  const { signOut } = useAppState();
  const router = useRouter();
  const moodOptIn = useMoodOptIn();
  const [sessions, setSessions] = useState<Session[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [privacy, setPrivacy] = useState<UserSettings | null>(null);

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
    getSettings().then(setPrivacy, () => setPrivacy(null));
  }, [load]);

  // D-08: lembrar humor (SEC-CTRL-50) e IA externa (SEC-CTRL-51); o servidor é a fonte da verdade
  async function toggle(patch: { rememberMood?: boolean; aiConsent?: boolean }) {
    try {
      setPrivacy(await updateSettings(patch));
    } catch (e) {
      Alert.alert('Erro', e instanceof Error ? e.message : 'Não foi possível salvar.');
    }
  }

  function toggleAi(next: boolean) {
    if (!next) return void toggle({ aiConsent: false });
    Alert.alert(
      'Permitir IA externa?',
      'O texto que você escrever no "Como estou" será enviado à Anthropic (provedora do Claude), com servidores fora do Brasil, só para interpretar o que você procura. Ele não é guardado nem usado para treinar modelos.',
      [
        { text: 'Cancelar', style: 'cancel' },
        { text: 'Permitir', onPress: () => void toggle({ aiConsent: true }) },
      ],
    );
  }

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
      <Text style={ui.h2}>Meu gosto</Text>
      <Text style={ui.muted}>Favoritos e um resumo do que você curte ajudam a sugerir onde cada título entra na fila.</Text>
      <Button title="Editar meu gosto" icon="heart-outline" variant="secondary" onPress={() => router.push('/profile' as never)} />
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
      <Text style={ui.h2}>Aparência</Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        {THEME_OPTIONS.map((o) => (
          <Chip
            key={o.value}
            icon={o.icon}
            label={o.label}
            selected={theme.preference === o.value}
            onPress={() => theme.setPreference(o.value)}
          />
        ))}
      </View>
      <Text style={ui.muted}>
        {theme.preference === 'system'
          ? `Seguindo o sistema (agora: ${theme.name === 'dark' ? 'escuro' : 'claro'}).`
          : 'Escolha salva só neste aparelho.'}
      </Text>
      <Text style={ui.h2}>Como estou</Text>
      <Text style={ui.muted}>
        {moodOptIn.accepted
          ? 'Ativado. O texto que você escreve não é guardado, só a intenção interpretada.'
          : 'Desativado. Ao usar pela primeira vez, pedimos sua autorização.'}
      </Text>
      {moodOptIn.accepted && (
        <Button title="Desativar o Como estou" variant="secondary" onPress={() => void moodOptIn.revoke()} />
      )}
      <Text style={ui.h2}>Privacidade</Text>
      {privacy ? (
        <>
          <View style={[ui.card, { flexDirection: 'row', alignItems: 'center', gap: 12 }]}>
            <View style={{ flex: 1, gap: 4 }}>
              <Text style={ui.body}>Lembrar meu humor</Text>
              <Text style={ui.muted}>
                Guarda só a intenção interpretada (nunca o texto) por {privacy.moodRetentionDays} dias. Desligar apaga o que
                estiver guardado.
              </Text>
            </View>
            <Switch
              value={privacy.rememberMood}
              onValueChange={(v) => void toggle({ rememberMood: v })}
              trackColor={{ true: colors.primary }}
              accessibilityLabel="Lembrar meu humor"
            />
          </View>
          <View style={[ui.card, { flexDirection: 'row', alignItems: 'center', gap: 12 }]}>
            <View style={{ flex: 1, gap: 4 }}>
              <Text style={ui.body}>Permitir IA externa no "Como estou"</Text>
              <Text style={ui.muted}>
                {privacy.aiAvailable
                  ? 'O texto vai à Anthropic, fora do Brasil, só para interpretar o pedido.'
                  : privacy.aiUnavailableReason === 'tmdb_clearance_pending'
                    ? 'IA indisponível no momento: desligada até a confirmação do TMDB (decisão D-07). Sua escolha fica salva.'
                    : 'IA indisponível no momento. Sua escolha fica salva para quando ela for ligada.'}
              </Text>
            </View>
            <Switch
              value={privacy.aiConsent}
              onValueChange={toggleAi}
              trackColor={{ true: colors.primary }}
              accessibilityLabel="Permitir IA externa"
            />
          </View>
        </>
      ) : (
        <Text style={ui.muted}>Não foi possível carregar as preferências.</Text>
      )}
      <Button title="Sobre e créditos" icon="information-circle-outline" variant="secondary" onPress={() => router.push('/about')} />
      {devToolsEnabled ? (
        // Só fora de produção (RF-18); em produção a rota nem existe no bundle.
        <Button title="Simulador de share (dev)" variant="secondary" onPress={() => router.push('/dev/share' as never)} />
      ) : null}
      <Button title="Sair" icon="log-out-outline" variant="danger" onPress={() => void signOut()} />
      <Text style={ui.muted}>Servidor: {API_URL}</Text>
    </ScrollView>
  );
}
