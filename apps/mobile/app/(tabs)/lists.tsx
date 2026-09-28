// Listas do usuário (RF-26 parte app): nome, progresso, criar.
import type { ListSummary } from '@fruiqo/contracts';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { Alert, FlatList, Pressable, RefreshControl, Text, TextInput, View } from 'react-native';

import { createList, listLists } from '../../src/api/client';
import { progressOf } from '../../src/discover/logic';
import { Button, ProgressBar } from '../../src/ui/components';
import { colors, ui } from '../../src/ui/theme';

export default function Lists() {
  const router = useRouter();
  const [lists, setLists] = useState<ListSummary[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [name, setName] = useState('');
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    try {
      setLists(await listLists());
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erro ao carregar.');
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  async function create() {
    const trimmed = name.trim();
    if (!trimmed) return;
    setCreating(true);
    try {
      const list = await createList({ name: trimmed });
      setName('');
      await load();
      router.push({ pathname: '/list/[id]', params: { id: list.id } });
    } catch (e) {
      Alert.alert('Não foi possível criar', e instanceof Error ? e.message : 'Tente de novo.');
    } finally {
      setCreating(false);
    }
  }

  return (
    <FlatList
      style={ui.screen}
      data={lists}
      keyExtractor={(l) => l.id}
      contentContainerStyle={[ui.pad, lists.length === 0 && { flexGrow: 1 }]}
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
      ListHeaderComponent={
        <View style={{ gap: 8, marginBottom: 4 }}>
          {error && <Text style={ui.error}>{error}</Text>}
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <TextInput
              style={[ui.input, { flex: 1 }]}
              value={name}
              onChangeText={setName}
              placeholder="Nova lista (ex.: Filmes com a família)"
              placeholderTextColor={colors.muted}
              maxLength={80}
              onSubmitEditing={() => void create()}
              returnKeyType="done"
            />
            <Button title="Criar" onPress={() => void create()} disabled={!name.trim()} loading={creating} />
          </View>
        </View>
      }
      ListEmptyComponent={
        <View style={{ flex: 1, justifyContent: 'center', gap: 8 }}>
          <Text style={ui.h2}>Nenhuma lista ainda</Text>
          <Text style={ui.body}>
            Cada compartilhamento de prints com vários títulos vira uma lista automaticamente. Você também pode criar
            uma aqui.
          </Text>
        </View>
      }
      renderItem={({ item }) => {
        const p = progressOf(item.doneCount, item.itemCount);
        return (
          <Pressable
            onPress={() => router.push({ pathname: '/list/[id]', params: { id: item.id } })}
            style={({ pressed }) => [ui.card, pressed && { opacity: 0.7 }]}
          >
            <Text style={ui.h2} numberOfLines={2}>
              {item.pinned ? '📌 ' : ''}
              {item.name}
            </Text>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <View style={{ flex: 1 }}>
                <ProgressBar ratio={item.itemCount > 0 ? p.ratio : 0} />
              </View>
              <Text style={ui.muted}>{item.itemCount > 0 ? p.label : 'vazia'}</Text>
            </View>
            {item.sourceShareId && <Text style={ui.muted}>Criada a partir de prints</Text>}
          </Pressable>
        );
      }}
    />
  );
}
