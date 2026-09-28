import type { Share } from '@fruiqo/contracts';
import { Stack, useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { FlatList, Pressable, RefreshControl, Text, View } from 'react-native';

import { listShares } from '../src/api/client';
import { ImportPrints } from '../src/share/ImportPrints';
import { StatusBadge } from '../src/ui/components';
import { sourceLabel, sourceTitle } from '../src/ui/labels';
import { colors, ui } from '../src/ui/theme';

const POLL_MS = 4000;

export default function Inbox() {
  const router = useRouter();
  const [items, setItems] = useState<Share[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const page = await listShares();
      setItems(page.items);
      setCursor(page.nextCursor);
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

  // Atualiza enquanto houver itens em processamento.
  const pending = items.some((s) => s.status === 'queued' || s.status === 'processing');
  useEffect(() => {
    if (!pending) return;
    const t = setInterval(load, POLL_MS);
    return () => clearInterval(t);
  }, [pending, load]);

  async function loadMore() {
    if (!cursor) return;
    try {
      const page = await listShares(cursor);
      setItems((prev) => [...prev, ...page.items.filter((i) => !prev.some((p) => p.id === i.id))]);
      setCursor(page.nextCursor);
    } catch {
      // mantém a lista atual; o pull-to-refresh tenta de novo
    }
  }

  return (
    <View style={ui.screen}>
      <Stack.Screen
        options={{
          headerRight: () => (
            <Text style={{ color: colors.primary, fontSize: 16 }} onPress={() => router.push('/settings')}>
              Ajustes
            </Text>
          ),
        }}
      />
      <View style={{ paddingHorizontal: 16, paddingTop: 12 }}>
        <ImportPrints />
      </View>
      <FlatList
        data={items}
        keyExtractor={(s) => s.id}
        contentContainerStyle={[ui.pad, items.length === 0 && { flexGrow: 1 }]}
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
        onEndReached={loadMore}
        ListHeaderComponent={error ? <Text style={ui.error}>{error}</Text> : null}
        ListEmptyComponent={
          <View style={{ flex: 1, justifyContent: 'center', gap: 8 }}>
            <Text style={ui.h2}>Nada por aqui ainda</Text>
            <Text style={ui.body}>
              No Instagram, YouTube ou TikTok, toque em Compartilhar e escolha Fruiqo. Ou use "Importar prints" para escolher prints da galeria, de arquivos ou fotografar uma lista (até 10 de uma vez). As recomendações aparecem aqui.
            </Text>
          </View>
        }
        renderItem={({ item }) => (
          <Pressable
            onPress={() => router.push({ pathname: '/share/[id]', params: { id: item.id } })}
            style={({ pressed }) => [ui.card, pressed && { opacity: 0.7 }]}
          >
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
              <Text style={ui.muted}>
                {sourceLabel(item.source)} · {new Date(item.createdAt).toLocaleString('pt-BR')}
              </Text>
              <StatusBadge status={item.status} />
            </View>
            <Text style={ui.h2} numberOfLines={2}>
              {sourceTitle(item.source)}
            </Text>
            {item.recommendations.length > 0 && (
              <Text style={ui.muted} numberOfLines={1}>
                {item.recommendations.map((r) => r.title).join(' · ')}
              </Text>
            )}
          </Pressable>
        )}
      />
    </View>
  );
}
