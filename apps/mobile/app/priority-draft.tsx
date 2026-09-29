// Rascunho de priorização (RF-44): o Fruiqo sugere uma nova ordem para a fila, você confere
// (▲/▼), e aplica ou descarta. Se a fila mudou desde o rascunho, avisa antes de aplicar.
import type { PriorityDraft, PriorityDraftItem } from '@fruiqo/contracts';
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, Pressable, Text, View } from 'react-native';

import {
  ApiError,
  applyPriorityDraft,
  createPriorityDraft,
  discardPriorityDraft,
  getPriorityDraft,
  undoBulk,
  updatePriorityDraft,
} from '../src/api/client';
import { deltaLabel } from '../src/catalog/logic';
import { Button, Icon, Poster } from '../src/ui/components';
import { Snackbar, useSnackbar } from '../src/ui/overlays';
import { colors, ui } from '../src/ui/theme';
import { useTheme } from '../src/ui/ThemeProvider';

function message(e: unknown) {
  return e instanceof Error ? e.message : 'Algo deu errado. Tente de novo.';
}

export default function PriorityDraftScreen() {
  useTheme();
  const router = useRouter();
  const snack = useSnackbar();
  const [draft, setDraft] = useState<PriorityDraft | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<'create' | 'apply' | 'discard' | 'move' | null>(null);

  useEffect(() => {
    getPriorityDraft().then(setDraft, (e) => {
      setDraft(null);
      setError(message(e));
    });
  }, []);

  async function create() {
    setBusy('create');
    try {
      setDraft(await createPriorityDraft({ scope: 'to_watch' }));
      setError(null);
    } catch (e) {
      Alert.alert('Não foi possível sugerir', message(e));
    } finally {
      setBusy(null);
    }
  }

  async function move(item: PriorityDraftItem, to: 'up' | 'down') {
    setBusy('move');
    try {
      setDraft(await updatePriorityDraft({ id: item.title.id, move: { to } }));
    } catch (e) {
      Alert.alert('Não foi possível mover', message(e));
    } finally {
      setBusy(null);
    }
  }

  async function apply(reconcile?: 'append_new') {
    setBusy('apply');
    try {
      const res = await applyPriorityDraft(reconcile ? { reconcile } : {});
      setDraft(null);
      snack.show({
        message: `Fila reordenada: ${res.applied} título(s)`,
        actionLabel: 'Desfazer',
        onAction: () => {
          undoBulk(res.undoToken).then(
            () => Alert.alert('Desfeito', 'A fila voltou à ordem anterior.'),
            (e) => Alert.alert('Não deu para desfazer', message(e)),
          );
        },
      });
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) {
        const d = e.staleDetails;
        Alert.alert(
          'A fila mudou',
          `Desde o rascunho${d ? `, ${d.added} título(s) entraram e ${d.removed} saíram` : ''}. Aplicar mesmo assim mantém os novos depois da ordem sugerida.`,
          [
            { text: 'Cancelar', style: 'cancel' },
            { text: 'Gerar de novo', onPress: () => void create() },
            { text: 'Aplicar', onPress: () => void apply('append_new') },
          ],
        );
      } else Alert.alert('Não foi possível aplicar', message(e));
    } finally {
      setBusy(null);
    }
  }

  function discard() {
    Alert.alert('Descartar rascunho?', 'A fila continua como está.', [
      { text: 'Cancelar', style: 'cancel' },
      {
        text: 'Descartar',
        style: 'destructive',
        onPress: async () => {
          setBusy('discard');
          try {
            await discardPriorityDraft();
            setDraft(null);
          } catch (e) {
            Alert.alert('Não foi possível descartar', message(e));
          } finally {
            setBusy(null);
          }
        },
      },
    ]);
  }

  if (draft === undefined) {
    return (
      <View style={[ui.screen, ui.pad]}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  if (draft === null) {
    return (
      <View style={[ui.screen, ui.pad, { gap: 12 }]}>
        <Icon name="swap-vertical-outline" size={40} color={colors.primary2} />
        <Text style={ui.h2}>Priorizar a fila</Text>
        <Text style={ui.body}>
          O Fruiqo sugere uma nova ordem para o que você quer ver, com base no seu gosto e no que está em alta. Nada muda até você aplicar.
        </Text>
        {error && <Text style={ui.error}>{error}</Text>}
        <Button title="Sugerir priorização" icon="sparkles" loading={busy === 'create'} onPress={() => void create()} />
        <Button title="Voltar ao catálogo" variant="secondary" onPress={() => router.back()} />
        <Snackbar state={snack.state} onDismiss={snack.dismiss} />
      </View>
    );
  }

  const changed = draft.items.filter((i) => i.delta !== 0).length;

  return (
    <View style={ui.screen}>
      <FlatList
        data={draft.items}
        keyExtractor={(i) => i.title.id}
        contentContainerStyle={[ui.pad, { paddingBottom: 150 }]}
        ListHeaderComponent={
          <View style={{ gap: 8, marginBottom: 4 }}>
            <Text style={ui.body}>
              {changed} de {draft.items.length} título(s) mudam de posição. Use ▲/▼ para ajustar antes de aplicar.
            </Text>
            {draft.stale && (
              <View style={[ui.card, { borderColor: colors.warn, flexDirection: 'row', gap: 8, alignItems: 'center' }]}>
                <Icon name="warning-outline" size={20} color={colors.warn} />
                <Text style={[ui.body, { flex: 1 }]}>
                  A fila mudou desde este rascunho
                  {draft.staleDetails ? ` (${draft.staleDetails.added} entraram, ${draft.staleDetails.removed} saíram)` : ''}. Você pode gerar de novo ou aplicar mantendo os novos no fim.
                </Text>
              </View>
            )}
          </View>
        }
        renderItem={({ item, index }) => (
          <View style={[ui.card, { flexDirection: 'row', gap: 10, padding: 10, alignItems: 'center' }]}>
            <Poster url={item.title.posterUrl ?? item.title.resolution?.imageUrl} title={item.title.title} size="sm" />
            <View style={{ flex: 1, gap: 3 }}>
              <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
                <View style={ui.pill}>
                  <Text style={ui.pillText}>#{item.proposedRank}</Text>
                </View>
                <Text style={[ui.muted, { color: item.delta > 0 ? colors.ok : item.delta < 0 ? colors.danger : colors.muted, fontWeight: '700' }]}>
                  {deltaLabel(item.delta)}
                </Text>
                <Text style={ui.muted}>{item.currentRank != null ? `era #${item.currentRank}` : 'novo'}</Text>
              </View>
              <Text style={[ui.body, { fontWeight: '700', color: colors.text }]} numberOfLines={2}>
                {item.title.title}
              </Text>
              <Text style={ui.muted} numberOfLines={2}>
                {item.reason}
              </Text>
            </View>
            <View style={{ gap: 4 }}>
              <Pressable accessibilityRole="button" accessibilityLabel="Subir no rascunho" disabled={index === 0 || busy !== null} onPress={() => void move(item, 'up')} hitSlop={6} style={{ padding: 6, opacity: index === 0 ? 0.3 : 1 }}>
                <Icon name="chevron-up" size={22} color={colors.text2} />
              </Pressable>
              <Pressable accessibilityRole="button" accessibilityLabel="Descer no rascunho" disabled={index === draft.items.length - 1 || busy !== null} onPress={() => void move(item, 'down')} hitSlop={6} style={{ padding: 6, opacity: index === draft.items.length - 1 ? 0.3 : 1 }}>
                <Icon name="chevron-down" size={22} color={colors.text2} />
              </Pressable>
            </View>
          </View>
        )}
      />
      <View style={{ position: 'absolute', left: 0, right: 0, bottom: 0, padding: 12, gap: 8, backgroundColor: colors.bg2, borderTopWidth: 1, borderColor: colors.border }}>
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <View style={{ flex: 1.4 }}>
            <Button title="Aplicar na fila" icon="checkmark" loading={busy === 'apply'} disabled={busy !== null && busy !== 'apply'} onPress={() => void apply()} />
          </View>
          <View style={{ flex: 1 }}>
            <Button title="Descartar" variant="secondary" loading={busy === 'discard'} disabled={busy !== null} onPress={discard} />
          </View>
        </View>
      </View>
      <Snackbar state={snack.state} onDismiss={snack.dismiss} bottom={90} />
    </View>
  );
}
