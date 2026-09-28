// Detalhe do título do catálogo: status, prioridade, nota, gêneros e listas (RF-26, RF-34).
import type { TaxonomyTag, Title, TitleStatus, UpdateTitleRequest } from '@fruiqo/contracts';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, Text, View } from 'react-native';

import { ApiError, getLibrary, getTaxonomy, getTitle, updateTitle } from '../../src/api/client';
import { collectGenreOptions, toggleGenre } from '../../src/discover/logic';
import { Button, Chip, Link, Poster } from '../../src/ui/components';
import { PRIORITY_LABEL, TITLE_STATUS_LABEL, titleMeta } from '../../src/ui/labels';
import { colors, ui } from '../../src/ui/theme';

const STATUSES: TitleStatus[] = ['to_watch', 'watching', 'watched', 'dropped'];

function errorMessage(e: unknown) {
  if (e instanceof ApiError && e.status === 409) {
    return 'Já existe outro título igual na sua lista. Abra o outro item para editar ou excluir o repetido.';
  }
  return e instanceof Error ? e.message : 'Algo deu errado. Tente de novo.';
}

export default function TitleDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const [title, setTitle] = useState<Title | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState<string | null>(null);
  const [genreOptions, setGenreOptions] = useState<TaxonomyTag[]>([]);
  const [editingGenres, setEditingGenres] = useState(false);
  const [draftGenres, setDraftGenres] = useState<string[]>([]);

  const load = useCallback(async () => {
    if (!id) return;
    try {
      const t = await getTitle(id);
      setTitle(t);
      setError(null);
    } catch (e) {
      setError(errorMessage(e));
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  async function patch(key: string, body: UpdateTitleRequest) {
    if (!title) return;
    setSaving(key);
    try {
      setTitle(await updateTitle(title.id, body));
    } catch (e) {
      Alert.alert('Não foi possível salvar', errorMessage(e));
    } finally {
      setSaving(null);
    }
  }

  async function openGenreEditor() {
    if (!title) return;
    setDraftGenres(title.genres.map((g) => g.key));
    setEditingGenres(true);
    try {
      // Lista completa da taxonomia (GET /taxonomy/genres), com rótulos pt-BR.
      const taxonomy = await getTaxonomy();
      setGenreOptions(collectGenreOptions([{ genres: taxonomy.genres }], title.genres));
    } catch {
      // Sem a taxonomia (API antiga/offline): usa os gêneros que já aparecem na biblioteca.
      try {
        const lib = await getLibrary({ limit: '100' });
        setGenreOptions(collectGenreOptions(lib.items, title.genres));
      } catch {
        setGenreOptions(collectGenreOptions([], title.genres));
      }
    }
  }

  if (error && !title) {
    return (
      <View style={[ui.screen, ui.pad]}>
        <Text style={ui.error}>{error}</Text>
        <Button title="Tentar de novo" onPress={() => void load()} />
      </View>
    );
  }
  if (!title) {
    return (
      <View style={[ui.screen, { alignItems: 'center', justifyContent: 'center' }]}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  const r = title.resolution;

  return (
    <ScrollView style={ui.screen} contentContainerStyle={[ui.pad, { paddingBottom: 32 }]}>
      <Stack.Screen options={{ title: title.title }} />
      <View style={{ flexDirection: 'row', gap: 12 }}>
        <Poster url={r?.imageUrl} title={title.title} />
        <View style={{ flex: 1, gap: 4 }}>
          <Text style={ui.h1}>{title.title}</Text>
          {title.creator ? <Text style={ui.body}>{title.creator}</Text> : null}
          <Text style={ui.muted}>{titleMeta(title)}</Text>
          {title.subgenres.length > 0 && <Text style={ui.muted}>{title.subgenres.map((s) => s.label).join(' · ')}</Text>}
        </View>
      </View>
      {r?.watchProvidersBR && r.watchProvidersBR.length > 0 && (
        <Text style={ui.muted}>Disponível no Brasil em: {r.watchProvidersBR.join(', ')}</Text>
      )}
      {r && <Link title={`Ver no ${r.provider === 'tmdb' ? 'TMDB' : 'Spotify'}`} url={r.url} />}

      <Text style={ui.h2}>Status</Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        {STATUSES.map((s) => (
          <Chip
            key={s}
            label={TITLE_STATUS_LABEL[s]}
            selected={title.status === s}
            disabled={saving !== null}
            onPress={() => title.status !== s && void patch('status', { status: s })}
          />
        ))}
      </View>

      <Text style={ui.h2}>Prioridade</Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        {PRIORITY_LABEL.map((label, p) => (
          <Chip
            key={label}
            label={label}
            selected={title.priority === p}
            disabled={saving !== null}
            onPress={() => title.priority !== p && void patch('priority', { priority: p })}
          />
        ))}
      </View>

      <Text style={ui.h2}>Sua nota</Text>
      <View style={{ flexDirection: 'row', gap: 6, alignItems: 'center' }}>
        {[1, 2, 3, 4, 5].map((n) => (
          <Pressable
            key={n}
            accessibilityRole="button"
            accessibilityLabel={`${n} estrela${n > 1 ? 's' : ''}`}
            disabled={saving !== null}
            onPress={() => void patch('rating', { rating: title.rating === n ? null : n })}
            hitSlop={6}
          >
            <Text style={{ fontSize: 30, color: title.rating && n <= title.rating ? '#f5a623' : colors.border }}>★</Text>
          </Pressable>
        ))}
        {title.rating ? <Text style={ui.muted}>toque de novo para limpar</Text> : null}
      </View>

      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        <Text style={ui.h2}>Gêneros</Text>
        {!editingGenres && <Text style={{ color: colors.primary, fontSize: 15 }} onPress={() => void openGenreEditor()}>Editar</Text>}
      </View>
      {!editingGenres ? (
        <Text style={ui.body}>
          {title.genres.length > 0 ? title.genres.map((g) => g.label).join(', ') : 'Sem gênero cadastrado.'}
        </Text>
      ) : (
        <View style={{ gap: 8 }}>
          {genreOptions.length === 0 ? (
            <Text style={ui.muted}>Nenhum gênero disponível para escolher ainda.</Text>
          ) : (
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
              {genreOptions.map((g) => (
                <Chip
                  key={g.key}
                  label={g.label}
                  selected={draftGenres.includes(g.key)}
                  onPress={() => setDraftGenres((prev) => toggleGenre(prev, g.key))}
                />
              ))}
            </View>
          )}
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <View style={{ flex: 1 }}>
              <Button
                title="Salvar gêneros"
                loading={saving === 'genres'}
                onPress={async () => {
                  await patch('genres', { genres: draftGenres });
                  setEditingGenres(false);
                }}
              />
            </View>
            <View style={{ flex: 1 }}>
              <Button title="Cancelar" variant="secondary" onPress={() => setEditingGenres(false)} />
            </View>
          </View>
        </View>
      )}

      <Text style={ui.h2}>Listas</Text>
      {title.lists.length === 0 && <Text style={ui.muted}>Não está em nenhuma lista.</Text>}
      {title.lists.map((l) => (
        <Pressable key={l.id} onPress={() => router.push({ pathname: '/list/[id]', params: { id: l.id } })}>
          <Text style={{ color: colors.primary, fontSize: 15 }}>{l.name}</Text>
        </Pressable>
      ))}
      {title.shareId && (
        <Pressable onPress={() => router.push({ pathname: '/share/[id]', params: { id: title.shareId! } })}>
          <Text style={ui.muted}>Ver de onde veio este título</Text>
        </Pressable>
      )}
    </ScrollView>
  );
}
