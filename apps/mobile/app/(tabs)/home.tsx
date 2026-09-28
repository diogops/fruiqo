// Home com os 3 modos (RF-31 Continuar, RF-32 Surpreenda-me, RF-33 Como estou).
import type { HomePreset, HomeResponse } from '@fruiqo/contracts';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { Alert, Modal, Pressable, RefreshControl, ScrollView, Text, TextInput, View } from 'react-native';

import { discover, getHome, updateTitle } from '../../src/api/client';
import { MOOD_MAX_CHARS, buildMoodRequest, buildSurpriseRequest, progressOf } from '../../src/discover/logic';
import { useMoodOptIn } from '../../src/discover/moodOptIn';
import { putResult } from '../../src/discover/store';
import { ImportPrints } from '../../src/share/ImportPrints';
import { Button, Chip, Poster, ProgressBar } from '../../src/ui/components';
import { titleMeta } from '../../src/ui/labels';
import { colors, ui } from '../../src/ui/theme';

function errorMessage(e: unknown) {
  return e instanceof Error ? e.message : 'Algo deu errado. Tente de novo.';
}

export default function Home() {
  const router = useRouter();
  const [home, setHome] = useState<HomeResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [moodText, setMoodText] = useState('');
  const [showOptIn, setShowOptIn] = useState(false);
  const optIn = useMoodOptIn();

  const load = useCallback(async () => {
    try {
      setHome(await getHome());
      setError(null);
    } catch (e) {
      setError(errorMessage(e));
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  async function markNext(status: 'watching' | 'watched') {
    const next = home?.continue?.next;
    if (!next) return;
    setBusy(status);
    try {
      await updateTitle(next.id, { status });
      await load();
    } catch (e) {
      Alert.alert('Não foi possível atualizar', errorMessage(e));
    } finally {
      setBusy(null);
    }
  }

  async function surprise(preset: HomePreset) {
    setBusy(`preset:${preset.key}`);
    try {
      const result = await discover(buildSurpriseRequest(preset));
      putResult(result);
      router.push({ pathname: '/discover', params: { runId: result.runId } });
    } catch (e) {
      Alert.alert('Não foi possível sugerir', errorMessage(e));
    } finally {
      setBusy(null);
    }
  }

  async function sendMood(optInJustAccepted = false) {
    const body = buildMoodRequest(moodText);
    if (!body || body.mode !== 'mood') return;
    if (!optIn.accepted && !optInJustAccepted) {
      setShowOptIn(true);
      return;
    }
    setBusy('mood');
    try {
      const result = await discover(body);
      // o texto só fica em memória se houver acolhimento de risco pendente (RNF-06/07)
      putResult(result, body.text);
      setMoodText('');
      router.push({ pathname: '/discover', params: { runId: result.runId } });
    } catch (e) {
      Alert.alert('Não foi possível sugerir', errorMessage(e));
    } finally {
      setBusy(null);
    }
  }

  const cont = home?.continue ?? null;
  const progress = cont ? progressOf(cont.progress.done, cont.progress.total) : null;
  const moodEnabled = home ? home.aiMode !== 'off' : false;

  return (
    <ScrollView
      style={ui.screen}
      contentContainerStyle={[ui.pad, { paddingBottom: 32 }]}
      keyboardShouldPersistTaps="handled"
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={async () => {
            setRefreshing(true);
            await load();
            setRefreshing(false);
          }}
        />
      }
    >
      <Text style={ui.h1}>O que vamos ver hoje?</Text>
      {error && <Text style={ui.error}>{error}</Text>}

      {/* Continuar (RF-31) */}
      <View style={ui.card}>
        <Text style={ui.muted}>CONTINUAR</Text>
        {cont && progress ? (
          <>
            <Pressable
              onPress={() => router.push({ pathname: '/list/[id]', params: { id: cont.list.id } })}
              accessibilityRole="link"
            >
              <Text style={ui.h2}>{cont.list.name}</Text>
            </Pressable>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <View style={{ flex: 1 }}>
                <ProgressBar ratio={progress.ratio} />
              </View>
              <Text style={ui.muted}>{progress.label}</Text>
            </View>
            <Pressable
              onPress={() => router.push({ pathname: '/title/[id]', params: { id: cont.next.id } })}
              style={{ flexDirection: 'row', gap: 12, marginTop: 6 }}
            >
              <Poster url={cont.next.resolution?.imageUrl} title={cont.next.title} />
              <View style={{ flex: 1, gap: 4, justifyContent: 'center' }}>
                <Text style={ui.muted}>Próximo</Text>
                <Text style={ui.h2}>{cont.next.title}</Text>
                <Text style={ui.muted}>{titleMeta(cont.next)}</Text>
              </View>
            </Pressable>
            <View style={{ flexDirection: 'row', gap: 8, marginTop: 6 }}>
              <View style={{ flex: 1 }}>
                <Button
                  title={cont.next.status === 'watching' ? 'Assistindo' : 'Assistir agora'}
                  onPress={() => void markNext('watching')}
                  disabled={cont.next.status === 'watching'}
                  loading={busy === 'watching'}
                />
              </View>
              <View style={{ flex: 1 }}>
                <Button title="Já vi" variant="secondary" onPress={() => void markNext('watched')} loading={busy === 'watched'} />
              </View>
            </View>
          </>
        ) : (
          <>
            <Text style={ui.body}>Nenhuma lista em andamento.</Text>
            <Text style={ui.muted}>
              Importe prints de uma lista (ou compartilhe um post) e ela vira uma lista para você seguir aqui.
            </Text>
          </>
        )}
      </View>

      {/* Surpreenda-me (RF-32) */}
      <View style={{ gap: 8 }}>
        <Text style={ui.h2}>Surpreenda-me</Text>
        <Text style={ui.muted}>Escolha um clima e eu sugiro da sua lista.</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingVertical: 2 }}>
          {(home?.presets ?? []).map((p) => (
            <Chip
              key={p.key}
              label={busy === `preset:${p.key}` ? 'Buscando…' : p.label}
              hint={p.available > 0 ? String(p.available) : undefined}
              onPress={() => void surprise(p)}
              disabled={busy !== null}
            />
          ))}
        </ScrollView>
        {home && home.stats.withoutGenre > 0 && (
          <Text style={ui.muted}>
            {home.stats.withoutGenre} título(s) sem gênero ainda não entram bem na surpresa. Dá para marcar o gênero no detalhe do título.
          </Text>
        )}
      </View>

      {/* Como estou (RF-33) */}
      {moodEnabled && (
        <View style={[ui.card, { gap: 10 }]}>
          <Text style={ui.muted}>COMO ESTOU</Text>
          <Text style={ui.body}>Conte em poucas palavras como você está ou o que procura.</Text>
          <TextInput
            style={[ui.input, { minHeight: 72, textAlignVertical: 'top', backgroundColor: colors.bg }]}
            value={moodText}
            onChangeText={setMoodText}
            placeholder='Ex.: "estou cansado, quero algo leve"'
            placeholderTextColor={colors.muted}
            multiline
            maxLength={MOOD_MAX_CHARS}
            autoCorrect
          />
          <Button title="Sugerir algo" onPress={() => void sendMood()} disabled={!moodText.trim()} loading={busy === 'mood'} />
          <Text style={ui.muted}>O texto não é guardado: só a intenção interpretada.</Text>
        </View>
      )}

      {/* Acessos secundários */}
      <View style={{ gap: 8 }}>
        <ImportPrints />
        <Button title="Ver compartilhamentos recebidos" variant="secondary" onPress={() => router.push('/inbox')} />
      </View>

      <Modal visible={showOptIn} animationType="slide" transparent onRequestClose={() => setShowOptIn(false)}>
        <View style={{ flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.35)' }}>
          <View style={[ui.pad, { backgroundColor: colors.bg, borderTopLeftRadius: 16, borderTopRightRadius: 16, paddingBottom: 32 }]}>
            <Text style={ui.h2}>Antes de usar o "Como estou"</Text>
            <Text style={ui.body}>
              O que você escrever é enviado ao servidor do Fruiqo só para entender o clima que você procura e sugerir algo
              da sua lista.
            </Text>
            <Text style={ui.body}>
              O texto não é guardado: fica registrada apenas a intenção interpretada (por exemplo, "algo leve e de
              superação"). Nesta versão a interpretação é feita por regras no próprio servidor do Fruiqo, sem IA externa.
            </Text>
            <Text style={ui.muted}>
              Se o texto indicar sofrimento intenso, mostramos primeiro contatos de apoio (CVV 188). Você pode desativar
              este recurso em Ajustes.
            </Text>
            <Button
              title="Entendi, quero usar"
              onPress={async () => {
                await optIn.accept();
                setShowOptIn(false);
                void sendMood(true);
              }}
            />
            <Button title="Agora não" variant="secondary" onPress={() => setShowOptIn(false)} />
          </View>
        </View>
      </Modal>
    </ScrollView>
  );
}
