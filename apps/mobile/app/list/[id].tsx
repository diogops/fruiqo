// Detalhe da lista: itens em ordem, reordenação simples (subir/descer) e exclusão (RF-26 parte app).
import type { ListDetail } from '@fruiqo/contracts';
import { Stack, useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, Text, View } from 'react-native';

import { deleteList, getList, reorderList } from '../../src/api/client';
import { moveItem, progressOf } from '../../src/discover/logic';
import { Button, Poster, ProgressBar } from '../../src/ui/components';
import { TITLE_STATUS_LABEL, titleMeta } from '../../src/ui/labels';
import { colors, ui } from '../../src/ui/theme';

export default function ListScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const [list, setList] = useState<ListDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    if (!id) return;
    try {
      setList(await getList(id));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erro ao carregar.');
    }
  }, [id]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  async function move(index: number, direction: -1 | 1) {
    if (!list || saving) return;
    const items = moveItem(list.items, index, direction);
    setList({ ...list, items }); // otimista; a resposta da API confirma a ordem
    setSaving(true);
    try {
      setList(await reorderList(list.id, items.map((t) => t.id)));
    } catch (e) {
      Alert.alert('Não foi possível reordenar', e instanceof Error ? e.message : 'Tente de novo.');
      await load();
    } finally {
      setSaving(false);
    }
  }

  function confirmDelete() {
    if (!list) return;
    Alert.alert('Excluir lista?', 'Os títulos continuam na sua biblioteca; só a lista é apagada.', [
      { text: 'Cancelar', style: 'cancel' },
      {
        text: 'Excluir',
        style: 'destructive',
        onPress: async () => {
          try {
            await deleteList(list.id);
            router.back();
          } catch (e) {
            Alert.alert('Não foi possível excluir', e instanceof Error ? e.message : 'Tente de novo.');
          }
        },
      },
    ]);
  }

  if (!list) {
    return (
      <View style={[ui.screen, ui.pad, { justifyContent: 'center' }]}>
        {error ? <Text style={ui.error}>{error}</Text> : <ActivityIndicator color={colors.primary} />}
      </View>
    );
  }

  const p = progressOf(list.doneCount, list.itemCount);

  return (
    <ScrollView style={ui.screen} contentContainerStyle={[ui.pad, { paddingBottom: 32 }]}>
      <Stack.Screen options={{ title: list.name }} />
      <Text style={ui.h1}>{list.name}</Text>
      {list.itemCount > 0 && (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <View style={{ flex: 1 }}>
            <ProgressBar ratio={p.ratio} />
          </View>
          <Text style={ui.muted}>{p.label} vistos</Text>
        </View>
      )}
      {list.items.length === 0 && <Text style={ui.body}>Lista vazia.</Text>}
      {list.items.map((t, index) => {
        const done = t.status === 'watched' || t.status === 'dropped';
        return (
          <View key={t.id} style={[ui.card, { flexDirection: 'row', alignItems: 'center', gap: 10 }, done && { opacity: 0.6 }]}>
            <Text style={[ui.muted, { width: 22, textAlign: 'right' }]}>{index + 1}</Text>
            <Pressable
              style={{ flex: 1, flexDirection: 'row', gap: 10, alignItems: 'center' }}
              onPress={() => router.push({ pathname: '/title/[id]', params: { id: t.id } })}
            >
              <Poster url={t.resolution?.imageUrl} title={t.title} size="sm" />
              <View style={{ flex: 1, gap: 2 }}>
                <Text style={ui.h2} numberOfLines={2}>
                  {t.title}
                </Text>
                <Text style={ui.muted} numberOfLines={1}>
                  {TITLE_STATUS_LABEL[t.status]} · {titleMeta(t)}
                </Text>
              </View>
            </Pressable>
            <View style={{ gap: 4 }}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Subir"
                disabled={index === 0 || saving}
                onPress={() => void move(index, -1)}
                hitSlop={6}
              >
                <Text style={{ fontSize: 20, color: index === 0 ? colors.border : colors.primary }}>▲</Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Descer"
                disabled={index === list.items.length - 1 || saving}
                onPress={() => void move(index, 1)}
                hitSlop={6}
              >
                <Text style={{ fontSize: 20, color: index === list.items.length - 1 ? colors.border : colors.primary }}>▼</Text>
              </Pressable>
            </View>
          </View>
        );
      })}
      <View style={{ height: 8 }} />
      <Button title="Excluir lista" variant="danger" onPress={confirmDelete} />
    </ScrollView>
  );
}
