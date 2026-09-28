// Resultado de /discover (RF-36 explicabilidade, RF-37 feedback, RNF-07 risco).
import type { DiscoverResponse, Suggestion } from '@fruiqo/contracts';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Alert, Linking, Modal, Pressable, ScrollView, Text, View } from 'react-native';

import { discover, sendFeedback, updateTitle } from '../src/api/client';
import { applyFeedback, buildFeedback, buildMoodRequest, capitalizeFirst } from '../src/discover/logic';
import { forgetResult, getResult, putResult, takeRiskText } from '../src/discover/store';
import { Button, Chip, Poster, WatchProviders, openExternal } from '../src/ui/components';
import { REASON_OPTIONS, titleMeta } from '../src/ui/labels';
import { colors, ui } from '../src/ui/theme';

function errorMessage(e: unknown) {
  return e instanceof Error ? e.message : 'Algo deu errado. Tente de novo.';
}

export default function DiscoverResult() {
  const { runId } = useLocalSearchParams<{ runId: string }>();
  const router = useRouter();
  const [result, setResult] = useState<DiscoverResponse | undefined>(() => (runId ? getResult(runId) : undefined));
  const [suggestions, setSuggestions] = useState<Suggestion[]>(result?.suggestions ?? []);
  const [busy, setBusy] = useState<string | null>(null);
  const [askReasonFor, setAskReasonFor] = useState<Suggestion | null>(null);

  // Ao sair da tela, esquece o resultado e qualquer texto de humor pendente (RNF-06).
  useEffect(() => {
    const id = result?.runId;
    return () => {
      if (id) forgetResult(id);
    };
  }, [result?.runId]);

  if (!result) {
    return (
      <View style={[ui.screen, ui.pad]}>
        <Text style={ui.body}>Este resultado não está mais disponível.</Text>
        <Button title="Voltar ao início" onPress={() => router.replace('/home')} />
      </View>
    );
  }

  const current = result;

  async function continueAfterRisk() {
    const text = takeRiskText(current.runId);
    const body = text ? buildMoodRequest(text, true) : null;
    if (!body) {
      router.replace('/home');
      return;
    }
    setBusy('risk');
    try {
      const next = await discover(body);
      putResult(next);
      forgetResult(current.runId);
      setResult(next);
      setSuggestions(next.suggestions);
    } catch (e) {
      Alert.alert('Não foi possível sugerir', errorMessage(e));
    } finally {
      setBusy(null);
    }
  }

  async function feedback(s: Suggestion, action: 'accept' | 'skip' | 'another', reasonTag?: string) {
    setBusy(`${action}:${s.title.id}`);
    try {
      const res = await sendFeedback(buildFeedback(current.runId, s.title.id, action, reasonTag));
      if (action === 'accept') {
        await updateTitle(s.title.id, { status: 'watching' });
        router.push({ pathname: '/title/[id]', params: { id: s.title.id } });
        return;
      }
      setSuggestions((prev) => applyFeedback(prev, s.title.id, res.next));
    } catch (e) {
      Alert.alert('Não foi possível registrar', errorMessage(e));
    } finally {
      setBusy(null);
    }
  }

  // ---------- Acolhimento de risco (RNF-07): nunca misturado com sugestões ----------
  if (current.risk) {
    const r = current.risk;
    return (
      <ScrollView style={ui.screen} contentContainerStyle={[ui.pad, { paddingBottom: 32 }]}>
        <Stack.Screen options={{ title: 'Estamos com você' }} />
        <Text style={ui.h1}>{r.title}</Text>
        <Text style={ui.body}>{r.message}</Text>
        <Button title={`Ligar para o CVV (${r.cvvPhone})`} onPress={() => void Linking.openURL(`tel:${r.cvvPhone}`)} />
        <Button title="Conversar pelo site do CVV" variant="secondary" onPress={() => openExternal(r.cvvUrl)} />
        <Text style={ui.muted}>
          Em emergência, ligue {r.emergencyPhone} (SAMU). O CVV atende 24 horas, de graça e em sigilo.
        </Text>
        <View style={{ height: 12 }} />
        <Button title={r.continueLabel} variant="secondary" onPress={() => void continueAfterRisk()} loading={busy === 'risk'} />
      </ScrollView>
    );
  }

  const heading = capitalizeFirst(current.surprise?.label ?? current.intent?.needLabel ?? 'Sugestões');
  const sentence = current.message ?? current.intent?.message;

  return (
    <ScrollView style={ui.screen} contentContainerStyle={[ui.pad, { paddingBottom: 32 }]}>
      <Stack.Screen options={{ title: current.mode === 'mood' ? 'Para o seu momento' : 'Surpresa' }} />
      <Text style={ui.h1}>{heading}</Text>
      {sentence ? <Text style={ui.body}>{sentence}</Text> : null}

      {suggestions.length === 0 ? (
        <View style={[ui.card, { gap: 8 }]}>
          <Text style={ui.body}>Não achei nada na sua lista para esse clima agora.</Text>
          <Text style={ui.muted}>Importe mais prints ou marque gêneros nos seus títulos para eu acertar mais.</Text>
          <Button title="Voltar ao início" variant="secondary" onPress={() => router.replace('/home')} />
        </View>
      ) : (
        suggestions.map((s) => (
          <View key={s.title.id} style={[ui.card, { gap: 10 }]}>
            <Pressable
              onPress={() => router.push({ pathname: '/title/[id]', params: { id: s.title.id } })}
              style={{ flexDirection: 'row', gap: 12 }}
            >
              <Poster url={s.title.posterUrl ?? s.title.resolution?.imageUrl} title={s.title.title} />
              <View style={{ flex: 1, gap: 4 }}>
                <Text style={ui.h2}>{s.title.title}</Text>
                <Text style={ui.muted}>{titleMeta(s.title)}</Text>
                <View style={{ flexDirection: 'row' }}>
                  <Text style={{ fontSize: 12, fontWeight: '600', color: colors.primary }}>da sua lista</Text>
                </View>
                <WatchProviders title={s.title} compact />
              </View>
            </Pressable>
            <Text style={ui.body}>
              <Text style={{ fontWeight: '600' }}>Por que isso: </Text>
              {s.reason}
            </Text>
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <View style={{ flex: 1 }}>
                <Button title="Vou ver" onPress={() => void feedback(s, 'accept')} loading={busy === `accept:${s.title.id}`} />
              </View>
              <View style={{ flex: 1 }}>
                <Button title="Pular" variant="secondary" onPress={() => void feedback(s, 'skip')} loading={busy === `skip:${s.title.id}`} />
              </View>
              <View style={{ flex: 1 }}>
                <Button
                  title="Outra coisa"
                  variant="secondary"
                  onPress={() => setAskReasonFor(s)}
                  loading={busy === `another:${s.title.id}`}
                />
              </View>
            </View>
          </View>
        ))
      )}

      <Modal visible={askReasonFor !== null} transparent animationType="fade" onRequestClose={() => setAskReasonFor(null)}>
        <View style={{ flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.35)' }}>
          <View style={[ui.pad, { backgroundColor: colors.bg, borderTopLeftRadius: 16, borderTopRightRadius: 16, paddingBottom: 32 }]}>
            <Text style={ui.h2}>Por quê? (opcional)</Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
              {REASON_OPTIONS.map((r) => (
                <Chip
                  key={r.key}
                  label={r.label}
                  onPress={() => {
                    const s = askReasonFor;
                    setAskReasonFor(null);
                    if (s) void feedback(s, 'another', r.key);
                  }}
                />
              ))}
            </View>
            <Button
              title="Só quero outra"
              variant="secondary"
              onPress={() => {
                const s = askReasonFor;
                setAskReasonFor(null);
                if (s) void feedback(s, 'another');
              }}
            />
          </View>
        </View>
      </Modal>
    </ScrollView>
  );
}
