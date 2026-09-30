// Adicionar título (RF-46): busca por nome, pessoa, gênero ou descrição; os escolhidos vão para a
// Revisão (padrão) ou são aprovados já no encaixe sugerido. Livros vêm da Open Library (RF-48).
import { tmdbPageUrl, type BookSearchResult, type TitleSearchResponse, type TitleSearchResult } from '@fruiqo/contracts';
import { useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, Pressable, Text, TextInput, View } from 'react-native';

import { importTitles, searchTitles } from '../src/api/client';
import { bookKey, movieKey, splitSelection } from '../src/catalog/logic';
import { useReviewCount } from '../src/catalog/reviewCount';
import { Button, Chip, Icon, Poster, TmdbAttribution, WorkLink, WorkLinks } from '../src/ui/components';
import { kindLabel } from '../src/ui/labels';
import { colors, ui } from '../src/ui/theme';
import { useTheme } from '../src/ui/ThemeProvider';

type Kind = 'movie' | 'series' | 'book' | undefined;
type Row = { key: string; movie?: TitleSearchResult; book?: BookSearchResult };

const INTERPRETED: Record<string, string> = {
  title: 'por título',
  person: 'por pessoa',
  genre: 'por gênero',
  description: 'pela descrição',
  browse: 'no TMDB',
};

function message(e: unknown) {
  return e instanceof Error ? e.message : 'Algo deu errado. Tente de novo.';
}

export default function AddTitle() {
  useTheme();
  const router = useRouter();
  const review = useReviewCount();
  const [q, setQ] = useState('');
  const [kind, setKind] = useState<Kind>(undefined);
  const [useAi, setUseAi] = useState(false);
  const [res, setRes] = useState<TitleSearchResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<'review' | 'approve' | null>(null);
  const seq = useRef(0);

  useEffect(() => {
    const term = q.trim();
    if (!term) {
      setRes(null);
      setError(null);
      return;
    }
    const id = ++seq.current;
    const timer = setTimeout(async () => {
      setLoading(true);
      try {
        const r = await searchTitles(term, kind, useAi);
        if (id === seq.current) {
          setRes(r);
          setError(null);
        }
      } catch (e) {
        if (id === seq.current) setError(message(e));
      } finally {
        if (id === seq.current) setLoading(false);
      }
    }, 400);
    return () => clearTimeout(timer);
  }, [q, kind, useAi]);

  const rows: Row[] = [
    ...(res?.items ?? []).map((m) => ({ key: movieKey(m), movie: m })),
    ...(res?.books ?? []).map((b) => ({ key: bookKey(b), book: b })),
  ];

  function toggle(key: string) {
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(key)) n.delete(key);
      else n.add(key);
      return n;
    });
  }

  async function submit(approveNow: boolean) {
    const { items, books } = splitSelection([...selected]);
    setBusy(approveNow ? 'approve' : 'review');
    try {
      const r = await importTitles({ items, ...(books.length ? { books } : {}), approveNow });
      const skipped = r.skipped.length + (r.skippedBooks?.length ?? 0);
      setSelected(new Set());
      void review.refresh();
      const msg = `${r.created.length} título(s) ${approveNow ? 'aprovado(s) na fila' : 'enviado(s) para a Revisão'}${skipped ? `; ${skipped} já estava(m) na sua lista` : ''}.`;
      Alert.alert(approveNow ? 'Adicionado' : 'Enviado para revisão', msg, [
        { text: 'Continuar buscando', style: 'cancel' },
        approveNow
          ? { text: 'Ver catálogo', onPress: () => router.replace('/catalog' as never) }
          : { text: 'Revisar agora', onPress: () => router.replace('/review' as never) },
      ]);
    } catch (e) {
      Alert.alert('Não foi possível adicionar', message(e));
    } finally {
      setBusy(null);
    }
  }

  return (
    <View style={ui.screen}>
      <FlatList
        data={rows}
        keyExtractor={(r) => r.key}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={[ui.pad, { paddingBottom: selected.size ? 140 : 32 }]}
        ListHeaderComponent={
          <View style={{ gap: 10, marginBottom: 4 }}>
            <TextInput
              style={ui.input}
              value={q}
              onChangeText={setQ}
              autoFocus
              placeholder='Título, pessoa ou "comédia leve dos anos 90"'
              placeholderTextColor={colors.muted}
              returnKeyType="search"
              accessibilityLabel="Buscar título"
              clearButtonMode="while-editing"
            />
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
              {([undefined, 'movie', 'series', 'book'] as Kind[]).map((k) => (
                <Chip key={k ?? 'all'} label={k ? kindLabel(k) : 'Tudo'} selected={kind === k} onPress={() => setKind(k)} />
              ))}
              <Chip icon="sparkles-outline" label="Com IA" selected={useAi && kind !== 'book'} disabled={kind === 'book'} onPress={() => setUseAi((v) => !v)} />
            </View>
            {res && (
              <Text style={ui.muted}>
                Busca {INTERPRETED[res.interpreted.type] ?? ''}
                {res.interpreted.person ? `: ${res.interpreted.person}` : ''}
                {res.interpreted.labels?.length ? ` · ${res.interpreted.labels.join(', ')}` : res.interpreted.genres.length ? ` · ${res.interpreted.genres.map((g) => g.label).join(', ')}` : ''}
                {res.interpreted.year ? ` · ${res.interpreted.year}` : ''}
                {res.interpreted.aiUsed ? ' · com IA' : ''}
              </Text>
            )}
            {error && <Text style={ui.error}>{error}</Text>}
            {loading && <ActivityIndicator color={colors.primary} />}
          </View>
        }
        ListEmptyComponent={
          !loading && q.trim() && res ? (
            <Text style={[ui.body, { paddingVertical: 24 }]}>Nada encontrado. Tente outro nome, o ano ou um ator.</Text>
          ) : !q.trim() ? (
            <Text style={[ui.muted, { paddingVertical: 24 }]}>Digite para buscar. Você pode escolher vários e enviar de uma vez.</Text>
          ) : null
        }
        ListFooterComponent={
          res ? (
            <View style={{ marginTop: 12, gap: 8 }}>
              {/* a busca mista espera a Open Library por pouco tempo; se ela demorar, os livros não vêm */}
              {kind === undefined && (res.books?.length ?? 0) === 0 && !loading ? (
                <Button title="Procurando um livro? Buscar só livros" variant="secondary" onPress={() => setKind('book')} />
              ) : null}
              {res.items.length > 0 ? <TmdbAttribution /> : null}
              {(res.books?.length ?? 0) > 0 ? <Text style={ui.muted}>Dados de livros: Open Library.</Text> : null}
            </View>
          ) : null
        }
        renderItem={({ item }) => <ResultCard row={item} selected={selected.has(item.key)} onPress={() => toggle(item.key)} />}
      />
      {selected.size > 0 && (
        <View style={{ position: 'absolute', left: 0, right: 0, bottom: 0, padding: 12, gap: 8, backgroundColor: colors.bg2, borderTopWidth: 1, borderColor: colors.border }}>
          <Text style={[ui.body, { fontWeight: '700' }]}>{selected.size} escolhido(s)</Text>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <View style={{ flex: 1 }}>
              <Button title="Enviar para revisão" icon="checkmark-done-outline" compact loading={busy === 'review'} disabled={busy !== null} onPress={() => void submit(false)} />
            </View>
            <View style={{ flex: 1 }}>
              <Button title="Aprovar já" variant="secondary" compact loading={busy === 'approve'} disabled={busy !== null} onPress={() => void submit(true)} />
            </View>
          </View>
        </View>
      )}
    </View>
  );
}

function ResultCard({ row, selected, onPress }: { row: Row; selected: boolean; onPress: () => void }) {
  const m = row.movie;
  const b = row.book;
  const title = m?.title ?? b?.title ?? '';
  const inLibrary = m?.inLibrary ?? b?.inLibrary ?? null;
  const meta = [kindLabel(m?.kind ?? 'book'), m?.year ?? b?.year, b?.pages ? `${b.pages} págs.` : null].filter(Boolean).join(' · ');
  const people = m ? m.cast.join(', ') : b?.authors.join(', ');
  // conferir a obra antes de incluir: TMDB (filme/série) ou Open Library (livro)
  const page = m ? { url: tmdbPageUrl(m.mediaType, m.tmdbId), label: 'TMDB' } : b ? { url: b.url, label: 'Open Library' } : undefined;
  return (
    <Pressable
      onPress={onPress}
      disabled={Boolean(inLibrary)}
      accessibilityRole="checkbox"
      accessibilityState={{ checked: selected, disabled: Boolean(inLibrary) }}
      style={({ pressed }) => [
        ui.card,
        { flexDirection: 'row', gap: 12, padding: 12, opacity: inLibrary ? 0.6 : pressed ? 0.85 : 1 },
        selected && { borderColor: colors.primary, backgroundColor: colors.primarySoft },
      ]}
    >
      <WorkLink url={page?.url} label={`Ver ${title} no ${page?.label}`}>
        <Poster url={m?.posterUrl ?? b?.coverUrl} title={title} size="sm" />
      </WorkLink>
      <View style={{ flex: 1, gap: 4 }}>
        <Text style={[ui.body, { fontWeight: '700', color: colors.text }]} numberOfLines={2}>
          {title}
        </Text>
        <WorkLinks title={title} page={page} />
        <Text style={ui.muted}>{meta}</Text>
        {people ? (
          <Text style={ui.muted} numberOfLines={1}>
            {people}
          </Text>
        ) : null}
        {m?.overview ? (
          <Text style={ui.muted} numberOfLines={3}>
            {m.overview}
          </Text>
        ) : null}
        {inLibrary ? (
          <View style={ui.pill}>
            <Text style={ui.pillText}>
              {inLibrary.decision === 'review_queue' ? 'já está na Revisão' : `já está na sua lista${inLibrary.rank ? ` (#${inLibrary.rank})` : ''}`}
            </Text>
          </View>
        ) : null}
      </View>
      {!inLibrary ? (
        <Icon name={selected ? 'checkmark-circle' : 'add-circle-outline'} size={26} color={selected ? colors.primary : colors.muted} />
      ) : null}
    </Pressable>
  );
}
