// Meu gosto (RF-43): favoritos (escolhidos na busca) e um resumo livre. Mostra, de forma
// transparente (RNF-10), o que as regras entenderam: gostos, rejeições, subgêneros e afinidades.
import { MAX_TASTE_SUMMARY_CHARS, type BookSearchResult, type DeclaredTaste, type TitleSearchResult } from '@fruiqo/contracts';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, TextInput, View } from 'react-native';

import { addFavorite, deleteFavorite, getDeclaredTaste, searchTitles, updateTasteSummary } from '../src/api/client';
import { bookFavoriteRequest } from '../src/catalog/logic';
import { Button, Chip, Icon, Poster } from '../src/ui/components';
import { kindLabel } from '../src/ui/labels';
import { colors, ui } from '../src/ui/theme';
import { useTheme } from '../src/ui/ThemeProvider';

function message(e: unknown) {
  return e instanceof Error ? e.message : 'Algo deu errado. Tente de novo.';
}

const SOURCE_LABEL = { favorites: 'favoritos', summary: 'resumo', both: 'favoritos + resumo' } as const;

export default function Profile() {
  useTheme();
  const [taste, setTaste] = useState<DeclaredTaste | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState('');
  const [saving, setSaving] = useState(false);

  const [q, setQ] = useState('');
  const [results, setResults] = useState<TitleSearchResult[]>([]);
  const [bookResults, setBookResults] = useState<BookSearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [adding, setAdding] = useState<string | null>(null);
  const seq = useRef(0);

  useEffect(() => {
    getDeclaredTaste().then(
      (t) => {
        setTaste(t);
        setSummary(t.summary ?? '');
      },
      (e) => setError(message(e)),
    );
  }, []);

  useEffect(() => {
    const term = q.trim();
    if (!term) {
      setResults([]);
      setBookResults([]);
      return;
    }
    const id = ++seq.current;
    const timer = setTimeout(async () => {
      setSearching(true);
      try {
        const r = await searchTitles(term);
        if (id === seq.current) {
          setResults(r.items.slice(0, 6));
          setBookResults((r.books ?? []).slice(0, 4));
        }
      } catch {
        if (id === seq.current) {
          setResults([]);
          setBookResults([]);
        }
      } finally {
        if (id === seq.current) setSearching(false);
      }
    }, 400);
    return () => clearTimeout(timer);
  }, [q]);

  async function saveSummary() {
    setSaving(true);
    try {
      setTaste(await updateTasteSummary(summary.trim()));
    } catch (e) {
      Alert.alert('Não foi possível salvar', message(e));
    } finally {
      setSaving(false);
    }
  }

  async function reload() {
    try {
      setTaste(await getDeclaredTaste());
    } catch {
      // mantém o que já está na tela
    }
  }

  // favorito de livro: a obra da Open Library dá capa e gêneros no servidor (ano antigo fica com ele)
  async function addBook(b: BookSearchResult) {
    setAdding(`ol:${b.olWorkId}`);
    try {
      await addFavorite(bookFavoriteRequest(b));
      setQ('');
      await reload();
    } catch (e) {
      Alert.alert('Não foi possível adicionar', message(e));
    } finally {
      setAdding(null);
    }
  }

  async function add(r: TitleSearchResult) {
    setAdding(`${r.mediaType}:${r.tmdbId}`);
    try {
      await addFavorite({ title: r.title, kind: r.kind, year: r.year, tmdbId: r.tmdbId, mediaType: r.mediaType });
      setQ('');
      await reload();
    } catch (e) {
      Alert.alert('Não foi possível adicionar', message(e));
    } finally {
      setAdding(null);
    }
  }

  async function remove(id: string) {
    try {
      await deleteFavorite(id);
      await reload();
    } catch (e) {
      Alert.alert('Não foi possível remover', message(e));
    }
  }

  if (!taste) {
    return (
      <View style={[ui.screen, ui.pad]}>
        {error ? <Text style={ui.error}>{error}</Text> : <ActivityIndicator color={colors.primary} />}
      </View>
    );
  }

  const it = taste.interpreted;
  const dirty = summary.trim() !== (taste.summary ?? '');
  const favIds = new Set(taste.favorites.map((f) => f.tmdbId).filter(Boolean));

  return (
    <KeyboardAvoidingView style={ui.screen} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={[ui.pad, { gap: 14 }]} keyboardShouldPersistTaps="handled">
        <Text style={ui.body}>Conte o que você gosta. Isso ajuda a sugerir onde cada título entra na fila e o que ver em seguida.</Text>

        <View style={[ui.card, { gap: 8 }]}>
          <Text style={ui.h2}>Resumo do seu gosto</Text>
          <TextInput
            style={[ui.input, { minHeight: 110, textAlignVertical: 'top' }]}
            value={summary}
            onChangeText={setSummary}
            autoFocus
            multiline
            maxLength={MAX_TASTE_SUMMARY_CHARS}
            placeholder='Ex.: "adoro suspense psicológico e ficção científica; não curto terror sangrento"'
            placeholderTextColor={colors.muted}
            accessibilityLabel="Resumo do seu gosto"
          />
          <Text style={[ui.muted, { alignSelf: 'flex-end' }]}>
            {summary.length}/{MAX_TASTE_SUMMARY_CHARS}
          </Text>
          <Button title="Salvar resumo" icon="save-outline" compact disabled={!dirty} loading={saving} onPress={() => void saveSummary()} />
        </View>

        <View style={[ui.card, { gap: 8 }]}>
          <Text style={ui.h2}>O que entendemos</Text>
          <TagRow label="Gosta de" tags={it.likes} />
          <TagRow label="Evita" tags={it.dislikes} />
          <TagRow label="Subgêneros que curte" tags={it.likedSubgenres} />
          <TagRow label="Subgêneros que evita" tags={it.dislikedSubgenres} />
          {it.likes.length + it.dislikes.length + it.likedSubgenres.length + it.dislikedSubgenres.length === 0 && (
            <Text style={ui.muted}>Ainda nada. Escreva um resumo ou adicione favoritos.</Text>
          )}
          {taste.affinities.length > 0 && (
            <>
              <Text style={[ui.body, { fontWeight: '700', marginTop: 4 }]}>Afinidade por gênero</Text>
              {taste.affinities.slice(0, 8).map((a) => (
                <View key={a.key} style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <Text style={[ui.body, { width: 120 }]} numberOfLines={1}>
                    {a.label}
                  </Text>
                  <View style={{ flex: 1, height: 8, borderRadius: 4, backgroundColor: colors.surface2, overflow: 'hidden' }}>
                    <View style={{ width: `${Math.round(Math.abs(a.score) * 100)}%`, height: 8, backgroundColor: a.score >= 0 ? colors.primary : colors.danger }} />
                  </View>
                  <Text style={[ui.muted, { width: 92 }]} numberOfLines={1}>
                    {SOURCE_LABEL[a.source]}
                  </Text>
                </View>
              ))}
            </>
          )}
        </View>

        <View style={[ui.card, { gap: 8 }]}>
          <Text style={ui.h2}>Favoritos ({taste.favorites.length})</Text>
          <TextInput
            style={ui.input}
            value={q}
            onChangeText={setQ}
            placeholder="Buscar um favorito para adicionar"
            placeholderTextColor={colors.muted}
            accessibilityLabel="Buscar favorito"
            returnKeyType="search"
          />
          {searching && <ActivityIndicator color={colors.primary} />}
          {results.map((r) => {
            const already = favIds.has(r.tmdbId);
            return (
              <Pressable
                key={`${r.mediaType}:${r.tmdbId}`}
                disabled={already || adding !== null}
                onPress={() => void add(r)}
                accessibilityRole="button"
                accessibilityLabel={`Adicionar ${r.title} aos favoritos`}
                style={({ pressed }) => [{ flexDirection: 'row', gap: 10, alignItems: 'center', paddingVertical: 6, opacity: already ? 0.5 : pressed ? 0.7 : 1 }]}
              >
                <Poster url={r.posterUrl} title={r.title} size="sm" />
                <View style={{ flex: 1 }}>
                  <Text style={[ui.body, { fontWeight: '700', color: colors.text }]}>{r.title}</Text>
                  <Text style={ui.muted}>{[kindLabel(r.kind), r.year].filter(Boolean).join(' · ')}</Text>
                </View>
                {adding === `${r.mediaType}:${r.tmdbId}` ? <ActivityIndicator color={colors.primary} /> : <Icon name={already ? 'heart' : 'heart-outline'} size={22} color={colors.primary2} />}
              </Pressable>
            );
          })}
          {bookResults.map((b) => (
            <Pressable
              key={`ol:${b.olWorkId}`}
              disabled={adding !== null}
              onPress={() => void addBook(b)}
              accessibilityRole="button"
              accessibilityLabel={`Adicionar o livro ${b.title} aos favoritos`}
              style={({ pressed }) => [{ flexDirection: 'row', gap: 10, alignItems: 'center', paddingVertical: 6, opacity: pressed ? 0.7 : 1 }]}
            >
              <Poster url={b.coverUrl} title={b.title} size="sm" />
              <View style={{ flex: 1 }}>
                <Text style={[ui.body, { fontWeight: '700', color: colors.text }]}>{b.title}</Text>
                <Text style={ui.muted}>{[kindLabel('book'), b.year, b.authors?.[0]].filter(Boolean).join(' · ')}</Text>
              </View>
              {adding === `ol:${b.olWorkId}` ? <ActivityIndicator color={colors.primary} /> : <Icon name="heart-outline" size={22} color={colors.primary2} />}
            </Pressable>
          ))}
          {taste.favorites.map((f) => (
            <View key={f.id} style={{ flexDirection: 'row', gap: 10, alignItems: 'center', paddingVertical: 4 }}>
              <Poster url={f.posterUrl} title={f.title} size="sm" />
              <View style={{ flex: 1 }}>
                <Text style={[ui.body, { fontWeight: '700', color: colors.text }]}>{f.title}</Text>
                <Text style={ui.muted} numberOfLines={1}>
                  {[kindLabel(f.kind), f.year, ...f.genres.slice(0, 2).map((g) => g.label)].filter(Boolean).join(' · ')}
                </Text>
              </View>
              <Pressable accessibilityRole="button" accessibilityLabel={`Remover ${f.title}`} hitSlop={8} onPress={() => void remove(f.id)} style={{ padding: 8 }}>
                <Icon name="trash-outline" size={20} color={colors.muted} />
              </Pressable>
            </View>
          ))}
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function TagRow({ label, tags }: { label: string; tags: { key: string; label: string }[] }) {
  if (tags.length === 0) return null;
  return (
    <View style={{ gap: 6 }}>
      <Text style={ui.muted}>{label}</Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
        {tags.map((t) => (
          <Chip key={t.key} label={t.label} />
        ))}
      </View>
    </View>
  );
}
