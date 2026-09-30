// Detalhe do título do catálogo (RF-26, RF-34): por padrão capa, dados numa linha, nota, sinopse e onde
// assistir; status, prioridade, gêneros e listas ficam em "Edição avançada".
import type { MoveTitleRequest, TaxonomyTag, Title, TitleStatus, UpdateTitleRequest } from '@fruiqo/contracts';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, ImageBackground, Pressable, ScrollView, Text, View, type ViewStyle } from 'react-native';

import { ApiError, getLibrary, getTaxonomy, getTitle, moveTitle, updateTitle } from '../../src/api/client';
import { collectGenreOptions, toggleGenre } from '../../src/discover/logic';
import { Button, Chip, Icon, Link, Poster, StarRating, WatchProviders } from '../../src/ui/components';
import { providerLabel, rankLabel, TITLE_STATUS_LABEL, titleMeta } from '../../src/ui/labels';
import { colors, gradients, ui } from '../../src/ui/theme';
import { useTheme } from '../../src/ui/ThemeProvider';

const STATUSES: TitleStatus[] = ['catalog', 'to_watch', 'watching', 'watched', 'dropped'];

function errorMessage(e: unknown) {
  if (e instanceof ApiError && e.status === 409) {
    return 'Já existe outro título igual na sua lista. Abra o outro item para editar ou excluir o repetido.';
  }
  return e instanceof Error ? e.message : 'Algo deu errado. Tente de novo.';
}

export default function TitleDetail() {
  useTheme(); // re-renderiza na troca de tema
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const [title, setTitle] = useState<Title | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState<string | null>(null);
  const [genreOptions, setGenreOptions] = useState<TaxonomyTag[]>([]);
  const [editingGenres, setEditingGenres] = useState(false);
  const [draftGenres, setDraftGenres] = useState<string[]>([]);
  const [advanced, setAdvanced] = useState(false);
  const [fullOverview, setFullOverview] = useState(false);

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

  // fila de prioridade: o total vem da resposta do primeiro movimento ("#3 de 42")
  const [queueTotal, setQueueTotal] = useState<number | undefined>(undefined);
  async function move(req: MoveTitleRequest) {
    if (!title) return;
    setSaving('rank');
    try {
      const res = await moveTitle(title.id, req);
      setQueueTotal(res.total);
      setTitle({ ...title, rank: res.rank });
    } catch (e) {
      Alert.alert('Não foi possível mudar a prioridade', errorMessage(e));
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
      <View style={[ui.heroCard, { padding: 0, experimental_backgroundImage: gradients.hero } as ViewStyle]}>
        {(title.posterUrl ?? r?.imageUrl)?.startsWith('https://') ? (
          <ImageBackground
            source={{ uri: (title.posterUrl ?? r?.imageUrl)! }}
            blurRadius={24}
            style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, opacity: 0.45 }}
            accessibilityIgnoresInvertColors
          />
        ) : null}
        <View style={[{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }, { experimental_backgroundImage: gradients.scrim } as ViewStyle]} />
        <View style={{ flexDirection: 'row', gap: 14, padding: 16 }}>
        <Poster url={title.posterUrl ?? r?.imageUrl} title={title.title} size="lg" />
        <View style={{ flex: 1, gap: 6, justifyContent: 'flex-end' }}>
          <Text style={ui.h1}>{title.title}</Text>
          {title.creator ? <Text style={ui.body} numberOfLines={1}>{title.creator}</Text> : null}
          <Text style={ui.muted} numberOfLines={1}>
            {[titleMeta(title) + (title.pages ? ` · ${title.pages} págs.` : ''), title.rank != null ? `#${title.rank} na fila` : null, ...title.genres.map((g) => g.label)]
              .filter(Boolean)
              .join(' · ')}
          </Text>
          <StarRating value={title.rating} disabled={saving !== null} size={26} onChange={(rating) => void patch('rating', { rating })} />
        </View>
        </View>
      </View>
      {title.overview ? (
        <View>
          <Text style={ui.body} numberOfLines={fullOverview ? undefined : 5}>
            {title.overview}
          </Text>
          {title.overview.length > 220 ? (
            <Text style={{ color: colors.primary, fontSize: 14, marginTop: 2 }} onPress={() => setFullOverview((f) => !f)}>
              {fullOverview ? 'menos' : 'mais…'}
            </Text>
          ) : null}
        </View>
      ) : null}
      {title.watchProvidersBR || title.watchUrl ? (
        <>
          <Text style={ui.h2}>Onde assistir no Brasil</Text>
          <WatchProviders title={title} />
        </>
      ) : null}
      {r && (r.provider !== 'tmdb' || !(title.watchProvidersBR || title.watchUrl)) && <Link title={`${r.provider === 'openlibrary' ? 'Ver na' : 'Ver no'} ${providerLabel(r.provider)}`} url={r.url} />}
      {!r && title.kind === 'book' && title.bookUrl ? <Link title="Ver na Open Library" url={title.bookUrl} /> : null}

      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: advanced }}
        onPress={() => setAdvanced((a) => !a)}
        style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 10, marginTop: 8, borderTopWidth: 1, borderTopColor: colors.border }}
      >
        <Icon name={advanced ? 'chevron-down' : 'chevron-forward'} size={18} color={colors.muted} />
        <Text style={{ color: colors.text2, fontSize: 15, fontWeight: '600' }}>Edição avançada</Text>
      </Pressable>
      {advanced ? (
      <>
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
      <Text style={ui.muted}>#1 é o mais prioritário da sua fila.</Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
        <Text style={{ fontSize: 22, fontWeight: '700', color: colors.text, minWidth: 64 }}>{rankLabel(title.rank, queueTotal)}</Text>
        {title.rank != null && (
          <>
            <Chip icon="arrow-up" label="Subir" disabled={saving !== null || title.rank === 1} onPress={() => void move({ to: 'up' })} />
            <Chip icon="arrow-down" label="Descer" disabled={saving !== null} onPress={() => void move({ to: 'down' })} />
            <Chip icon="push-outline" label="Topo" disabled={saving !== null || title.rank === 1} onPress={() => void move({ to: 'top' })} />
          </>
        )}
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
      </>
      ) : null}
    </ScrollView>
  );
}
