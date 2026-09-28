import type { Recommendation, Share } from '@fruiqo/contracts';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Image, ScrollView, Text, View } from 'react-native';

import { deleteShare, getShare } from '../../src/api/client';
import { Button, Link, StatusBadge } from '../../src/ui/components';
import { plural, sourceLabel, sourceTitle } from '../../src/ui/labels';
import { colors, ui } from '../../src/ui/theme';
import { useTheme } from '../../src/ui/ThemeProvider';

const POLL_MS = 3000;
const KIND_LABEL: Record<Recommendation['kind'], string> = {
  movie: 'Filme',
  series: 'Série',
  music_track: 'Música',
  music_album: 'Álbum',
  artist: 'Artista',
  other: 'Outro',
};
const PROVIDER_LABEL = { tmdb: 'TMDB', spotify: 'Spotify' } as const;

function RecommendationCard({ rec }: { rec: Recommendation }) {
  const r = rec.resolution;
  return (
    <View style={ui.card}>
      <Text style={ui.muted}>
        {KIND_LABEL[rec.kind]} · confiança {Math.round(rec.confidence * 100)}% ·{' '}
        {rec.extractor === 'llm' ? 'IA' : 'heurística'}
      </Text>
      <View style={{ flexDirection: 'row', gap: 12 }}>
        {r?.imageUrl?.startsWith('https://') && (
          <Image source={{ uri: r.imageUrl }} style={{ width: 56, height: 84, borderRadius: 6 }} />
        )}
        <View style={{ flex: 1, gap: 4 }}>
          <Text style={ui.h2}>{r?.title ?? rec.title}</Text>
          {(rec.creator || rec.year || r?.year) && (
            <Text style={ui.body}>{[rec.creator, r?.year ?? rec.year].filter(Boolean).join(' · ')}</Text>
          )}
          {r?.watchProvidersBR && r.watchProvidersBR.length > 0 && (
            <Text style={ui.muted}>Disponível no Brasil em: {r.watchProvidersBR.join(', ')}</Text>
          )}
          {/* Link de volta + atribuição do provedor (TOS-REQ-01, TOS-REQ-10) */}
          {r && <Link title={`Abrir no ${PROVIDER_LABEL[r.provider]}`} url={r.url} />}
          {r && <Text style={ui.muted}>Dados: {PROVIDER_LABEL[r.provider]}</Text>}
        </View>
      </View>
    </View>
  );
}

export default function ShareDetail() {
  useTheme(); // re-renderiza na troca de tema
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const [share, setShare] = useState<Share | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  const load = useCallback(async () => {
    try {
      setShare(await getShare(id));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erro ao carregar.');
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  const pending = share?.status === 'queued' || share?.status === 'processing';
  useEffect(() => {
    if (!pending) return;
    const t = setInterval(load, POLL_MS);
    return () => clearInterval(t);
  }, [pending, load]);

  function confirmDelete() {
    Alert.alert('Excluir compartilhamento?', 'O conteúdo e as recomendações serão apagados.', [
      { text: 'Cancelar', style: 'cancel' },
      {
        text: 'Excluir',
        style: 'destructive',
        onPress: async () => {
          setDeleting(true);
          try {
            await deleteShare(id);
            router.back();
          } catch (e) {
            Alert.alert('Erro', e instanceof Error ? e.message : 'Não foi possível excluir.');
          } finally {
            setDeleting(false);
          }
        },
      },
    ]);
  }

  if (!share) {
    return (
      <View style={[ui.screen, ui.pad, { justifyContent: 'center' }]}>
        {error ? <Text style={ui.error}>{error}</Text> : <ActivityIndicator color={colors.primary} />}
      </View>
    );
  }

  const src = share.source;
  const isScreenshot = src.origin === 'screenshot';
  const { pagesIgnored, itemsAlreadyInList } = share.dedup;
  const done = share.status === 'done';
  return (
    <ScrollView style={ui.screen} contentContainerStyle={ui.pad}>
      <Stack.Screen options={{ title: sourceLabel(src) }} />
      <View style={ui.card}>
        <StatusBadge status={share.status} />
        {!isScreenshot && src.thumbnailUrl?.startsWith('https://') && (
          <Image source={{ uri: src.thumbnailUrl }} style={{ width: '100%', aspectRatio: 16 / 9, borderRadius: 8 }} />
        )}
        <Text style={ui.h2}>{sourceTitle(src)}</Text>
        {isScreenshot && src.pageCount !== undefined && (
          <Text style={ui.muted}>{plural(src.pageCount, 'print lido', 'prints lidos')} no seu aparelho</Text>
        )}
        {src.author && <Text style={ui.muted}>{src.author}</Text>}
        {!isScreenshot && <Link title="Abrir original" url={src.url} />}
        {share.error && <Text style={ui.error}>{share.error}</Text>}
      </View>

      {done && pagesIgnored > 0 && (
        <Text style={ui.muted}>
          {pagesIgnored === 1
            ? '1 print já tinha sido enviado antes e foi ignorado.'
            : `${pagesIgnored} prints já tinham sido enviados antes e foram ignorados.`}
        </Text>
      )}
      {done && itemsAlreadyInList > 0 && (
        <Text style={ui.muted}>
          {itemsAlreadyInList === 1
            ? '1 item já estava na sua lista e não foi repetido.'
            : `${itemsAlreadyInList} itens já estavam na sua lista e não foram repetidos.`}
        </Text>
      )}

      <Text style={ui.h2}>Recomendações</Text>
      {share.recommendations.length === 0 ? (
        <Text style={ui.muted}>
          {pending
            ? 'Analisando o conteúdo…'
            : done && (pagesIgnored > 0 || itemsAlreadyInList > 0)
              ? 'Nada novo aqui: tudo o que foi encontrado já estava na sua lista ou vinha de prints já enviados.'
              : 'Nenhum filme, série ou música identificado.'}
        </Text>
      ) : (
        share.recommendations.map((rec) => <RecommendationCard key={rec.id} rec={rec} />)
      )}

      <Button title="Excluir" variant="danger" onPress={confirmDelete} loading={deleting} />
    </ScrollView>
  );
}
