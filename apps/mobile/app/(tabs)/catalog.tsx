// Catálogo no app (mesmos ajustes do web, RF-24/25/26): fila por posição (#1 = mais prioritário),
// ▲/▼, topo/fim/posição, filtros em painel com contador, seleção múltipla com ações em massa e
// Desfazer. Filtragem e ordenação são da API (RF-30). Arrastar fica para quando houver lib de
// gestos no build nativo (sem módulo nativo novo nesta versão).
import type { BulkOperation, ListSummary, MoveTitleRequest, TaxonomyTag, Title, TitleStatus } from '@fruiqo/contracts';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, Pressable, RefreshControl, Text, TextInput, View } from 'react-native';

import {
  bulkLibrary,
  getLibrary,
  getTaxonomy,
  listLists,
  moveTitle,
  undoBulk,
  updateTitle,
} from '../../src/api/client';
import {
  activeFilterCount,
  buildLibraryQuery,
  type CatalogFilters,
  genreChips,
  moveLocal,
  toggleSelected,
} from '../../src/catalog/logic';
import { useReviewCount } from '../../src/catalog/reviewCount';
import { ImportPrints } from '../../src/share/ImportPrints';
import { Button, Chip, Icon, IconButton, Poster, ratingText } from '../../src/ui/components';
import { kindLabel, TITLE_STATUS_LABEL } from '../../src/ui/labels';
import { Sheet, Snackbar, useSnackbar } from '../../src/ui/overlays';
import { colors, ui } from '../../src/ui/theme';
import { useTheme } from '../../src/ui/ThemeProvider';

const STATUSES: TitleStatus[] = ['catalog', 'to_watch', 'watching', 'watched', 'dropped'];
const KINDS = ['movie', 'series', 'book', 'music_track', 'music_album', 'artist', 'other'];

function message(e: unknown) {
  return e instanceof Error ? e.message : 'Algo deu errado. Tente de novo.';
}

export default function Catalog() {
  useTheme(); // re-renderiza na troca de tema
  const router = useRouter();
  const review = useReviewCount();
  const snack = useSnackbar();

  const [items, setItems] = useState<Title[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [filters, setFilters] = useState<CatalogFilters>({});
  const [search, setSearch] = useState('');
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [genres, setGenres] = useState<TaxonomyTag[]>([]);
  const [lists, setLists] = useState<ListSummary[]>([]);

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const selecting = selected.size > 0;
  const [busy, setBusy] = useState(false);

  // menus de uma linha / da barra de massa
  const [rowMenu, setRowMenu] = useState<Title | null>(null);
  const [positionFor, setPositionFor] = useState<Title | null>(null);
  const [positionText, setPositionText] = useState('');
  const [statusFor, setStatusFor] = useState<'bulk' | Title | null>(null);
  const [listPickerOpen, setListPickerOpen] = useState(false);

  const effective = useMemo(() => ({ ...filters, q: search }), [filters, search]);
  const reqSeq = useRef(0);

  const load = useCallback(
    async (mode: 'reset' | 'more' = 'reset') => {
      const seq = ++reqSeq.current;
      if (mode === 'more') setLoadingMore(true);
      try {
        const res = await getLibrary(buildLibraryQuery(effective, mode === 'more' ? cursor : null));
        if (seq !== reqSeq.current) return; // resposta atrasada de filtro antigo
        setItems((prev) => (mode === 'more' ? [...prev, ...res.items] : res.items));
        setCursor(res.nextCursor);
        setError(null);
      } catch (e) {
        if (seq === reqSeq.current) setError(message(e));
      } finally {
        if (seq === reqSeq.current) {
          setLoading(false);
          setLoadingMore(false);
        }
      }
    },
    [effective, cursor],
  );

  // recarrega ao voltar para a aba e quando filtros/busca mudam (busca com pequena espera)
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);
  useFocusEffect(
    useCallback(() => {
      if (debounce.current) clearTimeout(debounce.current);
      debounce.current = setTimeout(() => void load('reset'), 250);
      void review.refresh();
      return () => {
        if (debounce.current) clearTimeout(debounce.current);
      };
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [effective]),
  );

  async function openFilters() {
    setFiltersOpen(true);
    if (genres.length === 0) getTaxonomy().then((t) => setGenres(t.genres), () => {});
    listLists().then(setLists, () => {});
  }

  // ---------- fila (▲/▼/topo/fim/posição), otimista ----------
  async function move(t: Title, req: MoveTitleRequest) {
    if (t.rank == null) return;
    const before = items;
    setItems(moveLocal(items, t.id, req));
    try {
      const res = await moveTitle(t.id, req);
      snack.show({ message: `"${t.title}" agora é o #${res.rank} de ${res.total}` });
      // com filtros ativos a numeração local é aproximada: confirma com o servidor
      void load('reset');
    } catch (e) {
      setItems(before);
      Alert.alert('Não foi possível mover', message(e));
    }
  }

  async function setStatus(t: Title, status: TitleStatus) {
    try {
      const updated = await updateTitle(t.id, { status });
      setItems((prev) => prev.map((x) => (x.id === t.id ? updated : x)));
    } catch (e) {
      Alert.alert('Não foi possível salvar', message(e));
    }
  }

  // ---------- ações em massa (RF-25) com Desfazer ----------
  async function bulk(operation: BulkOperation, label: string) {
    const ids = [...selected];
    if (ids.length === 0) return;
    setBusy(true);
    try {
      const res = await bulkLibrary(ids, operation);
      setSelected(new Set());
      await load('reset');
      snack.show({
        message: `${label}: ${res.affected} título${res.affected === 1 ? '' : 's'}`,
        actionLabel: 'Desfazer',
        onAction: () => {
          undoBulk(res.undoToken).then(
            () => void load('reset'),
            (e) => Alert.alert('Não deu para desfazer', message(e)),
          );
        },
      });
    } catch (e) {
      Alert.alert('Ação não concluída', message(e));
    } finally {
      setBusy(false);
    }
  }

  function confirmDelete() {
    Alert.alert('Remover do catálogo?', `${selected.size} título(s). Dá para desfazer logo depois.`, [
      { text: 'Cancelar', style: 'cancel' },
      { text: 'Remover', style: 'destructive', onPress: () => void bulk({ type: 'delete' }, 'Removidos') },
    ]);
  }

  const filterCount = activeFilterCount(filters);

  return (
    <View style={ui.screen}>
      <FlatList
        data={items}
        keyExtractor={(t) => t.id}
        contentContainerStyle={[ui.pad, { padding: 10, gap: 6, paddingBottom: selecting ? 150 : 88 }, items.length === 0 && { flexGrow: 1 }]}
        keyboardShouldPersistTaps="handled"
        onEndReachedThreshold={0.4}
        onEndReached={() => {
          if (cursor && !loadingMore) void load('more');
        }}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={async () => {
              setRefreshing(true);
              await Promise.all([load('reset'), review.refresh()]);
              setRefreshing(false);
            }}
          />
        }
        ListHeaderComponent={
          <View style={{ gap: 8, marginBottom: 2 }}>
            <View style={{ flexDirection: 'row', gap: 6, alignItems: 'center' }}>
              <TextInput
                style={[ui.input, { flex: 1, paddingVertical: 8, fontSize: 15 }]}
                value={search}
                onChangeText={setSearch}
                placeholder="Buscar"
                placeholderTextColor={colors.muted}
                returnKeyType="search"
                accessibilityLabel="Buscar no catálogo"
                clearButtonMode="while-editing"
              />
              <IconButton icon="options-outline" label="Filtros" badge={filterCount ? String(filterCount) : undefined} onPress={() => void openFilters()} />
              <ImportPrints iconOnly />
              <IconButton icon="add" label="Adicionar título" primary onPress={() => router.push('/add' as never)} />
            </View>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
              <Chip
                compact
                icon="checkmark-done-outline"
                label="Revisão"
                hint={review.count > 0 ? String(review.count) : undefined}
                selected={review.count > 0}
                onPress={() => router.push('/review' as never)}
              />
              <Chip compact icon="swap-vertical-outline" label="Priorizar" onPress={() => router.push('/priority-draft' as never)} />
              <Chip
                compact
                icon={filters.showWatched ? 'eye-outline' : 'eye-off-outline'}
                label={filters.showWatched ? 'Com assistidos' : 'Sem assistidos'}
                disabled={Boolean(filters.status)}
                onPress={() => setFilters((f) => ({ ...f, showWatched: !f.showWatched }))}
              />
            </View>
            {selecting ? <Text style={ui.muted}>{selected.size} selecionado(s)</Text> : null}
            {error && <Text style={ui.error}>{error}</Text>}
          </View>
        }
        ListEmptyComponent={
          loading ? (
            <ActivityIndicator color={colors.primary} style={{ marginTop: 32 }} />
          ) : (
            <View style={{ flex: 1, justifyContent: 'center', gap: 8, paddingVertical: 32 }}>
              <Icon name="film-outline" size={40} color={colors.muted} />
              <Text style={ui.h2}>{filterCount || search ? 'Nada encontrado' : 'Seu catálogo está vazio'}</Text>
              <Text style={ui.body}>
                {filterCount || search
                  ? 'Tente outros filtros ou limpe a busca.'
                  : 'Adicione um título pela busca, importe prints ou uma lista em .txt, ou compartilhe um post com o Fruiqo.'}
              </Text>
            </View>
          )
        }
        ListFooterComponent={loadingMore ? <ActivityIndicator color={colors.primary} /> : null}
        renderItem={({ item }) => (
          <CatalogCard
            t={item}
            selected={selected.has(item.id)}
            selecting={selecting}
            onPress={() =>
              selecting
                ? setSelected((s) => toggleSelected(s, item.id))
                : router.push({ pathname: '/title/[id]', params: { id: item.id } })
            }
            onLongPress={() => setSelected((s) => toggleSelected(s, item.id))}
            onUp={() => void move(item, { to: 'up' })}
            onDown={() => void move(item, { to: 'down' })}
            onMenu={() => setRowMenu(item)}
            onStatus={() => setStatusFor(item)}
          />
        )}
      />

      {selecting && (
        <View
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            bottom: 0,
            padding: 12,
            gap: 8,
            backgroundColor: colors.bg2,
            borderTopWidth: 1,
            borderColor: colors.border,
          }}
        >
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <Text style={[ui.body, { flex: 1, fontWeight: '700' }]}>{selected.size} selecionado(s)</Text>
            <Chip icon="close" label="Limpar" onPress={() => setSelected(new Set())} />
          </View>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            <Chip icon="arrow-up-circle-outline" label="Topo" disabled={busy} onPress={() => void bulk({ type: 'move_top' }, 'Para o topo')} />
            <Chip icon="arrow-down-circle-outline" label="Fim" disabled={busy} onPress={() => void bulk({ type: 'move_bottom' }, 'Para o fim')} />
            <Chip icon="eye-outline" label="Status" disabled={busy} onPress={() => setStatusFor('bulk')} />
            <Chip
              icon="albums-outline"
              label="Lista"
              disabled={busy}
              onPress={() => {
                setListPickerOpen(true);
                listLists().then(setLists, () => {});
              }}
            />
            <Chip icon="trash-outline" label="Remover" disabled={busy} onPress={confirmDelete} />
          </View>
        </View>
      )}

      {/* menu ⋯ da linha */}
      <Sheet visible={rowMenu !== null} title={rowMenu ? `#${rowMenu.rank ?? '—'} · ${rowMenu.title}` : ''} onClose={() => setRowMenu(null)}>
        {rowMenu && (
          <>
            <Button title="Mover para o topo" icon="arrow-up-circle-outline" variant="secondary" disabled={rowMenu.rank === 1} onPress={() => { const t = rowMenu; setRowMenu(null); void move(t, { to: 'top' }); }} />
            <Button title="Mover para o fim" icon="arrow-down-circle-outline" variant="secondary" onPress={() => { const t = rowMenu; setRowMenu(null); void move(t, { to: 'bottom' }); }} />
            <Button title="Ir para posição…" icon="locate-outline" variant="secondary" onPress={() => { setPositionText(String(rowMenu.rank ?? 1)); setPositionFor(rowMenu); setRowMenu(null); }} />
            <Button title="Abrir detalhes" icon="open-outline" variant="secondary" onPress={() => { const t = rowMenu; setRowMenu(null); router.push({ pathname: '/title/[id]', params: { id: t.id } }); }} />
          </>
        )}
      </Sheet>

      {/* ir para posição */}
      <Sheet visible={positionFor !== null} title="Ir para posição" onClose={() => setPositionFor(null)}>
        <Text style={ui.muted}>1 = topo da fila. Posições além do fim levam para o fim.</Text>
        <TextInput
          style={ui.input}
          value={positionText}
          onChangeText={(v) => setPositionText(v.replace(/[^0-9]/g, ''))}
          keyboardType="number-pad"
          autoFocus
          selectTextOnFocus
          accessibilityLabel="Nova posição"
        />
        <Button
          title="Mover"
          disabled={!positionText || Number(positionText) < 1}
          onPress={() => {
            const t = positionFor;
            const position = Number(positionText);
            setPositionFor(null);
            if (t && position >= 1) void move(t, { position });
          }}
        />
      </Sheet>

      {/* status (linha ou massa) */}
      <Sheet visible={statusFor !== null} title="Mudar status" onClose={() => setStatusFor(null)}>
        {STATUSES.map((s) => (
          <Button
            key={s}
            title={TITLE_STATUS_LABEL[s]}
            variant={statusFor !== 'bulk' && statusFor?.status === s ? 'primary' : 'secondary'}
            onPress={() => {
              const target = statusFor;
              setStatusFor(null);
              if (target === 'bulk') void bulk({ type: 'set_status', status: s }, TITLE_STATUS_LABEL[s]);
              else if (target) void setStatus(target, s);
            }}
          />
        ))}
      </Sheet>

      {/* adicionar selecionados a uma lista */}
      <Sheet visible={listPickerOpen} title="Adicionar à lista" onClose={() => setListPickerOpen(false)}>
        {lists.length === 0 && <Text style={ui.muted}>Nenhuma lista ainda. Crie uma na aba Listas.</Text>}
        {lists.map((l) => (
          <Button
            key={l.id}
            title={l.name}
            icon="albums-outline"
            variant="secondary"
            onPress={() => {
              setListPickerOpen(false);
              void bulk({ type: 'add_to_list', listId: l.id }, `Em "${l.name}"`);
            }}
          />
        ))}
      </Sheet>

      {/* filtros (RF-24) */}
      <Sheet
        visible={filtersOpen}
        title="Filtros"
        onClose={() => setFiltersOpen(false)}
        footer={
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <View style={{ flex: 1 }}>
              <Button title="Limpar filtros" variant="secondary" onPress={() => setFilters({})} />
            </View>
            <View style={{ flex: 1 }}>
              <Button title="Ver resultados" onPress={() => setFiltersOpen(false)} />
            </View>
          </View>
        }
      >
        <Text style={ui.h2}>Tipo</Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          {KINDS.map((k) => (
            <Chip key={k} label={kindLabel(k)} selected={filters.kind === k} onPress={() => setFilters((f) => ({ ...f, kind: f.kind === k ? undefined : k }))} />
          ))}
        </View>
        <Text style={ui.h2}>Status</Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          {STATUSES.map((s) => (
            <Chip key={s} label={TITLE_STATUS_LABEL[s]} selected={filters.status === s} onPress={() => setFilters((f) => ({ ...f, status: f.status === s ? undefined : s }))} />
          ))}
        </View>
        <Text style={ui.h2}>Gênero</Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          {genres.length === 0 && <Text style={ui.muted}>Carregando gêneros…</Text>}
          {genres.map((g) => (
            <Chip key={g.key} label={g.label} selected={filters.genre === g.key} onPress={() => setFilters((f) => ({ ...f, genre: f.genre === g.key ? undefined : g.key }))} />
          ))}
        </View>
        <Text style={ui.h2}>Lista</Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          {lists.length === 0 && <Text style={ui.muted}>Nenhuma lista.</Text>}
          {lists.map((l) => (
            <Chip key={l.id} label={l.name} selected={filters.listId === l.id} onPress={() => setFilters((f) => ({ ...f, listId: f.listId === l.id ? undefined : l.id }))} />
          ))}
        </View>
      </Sheet>

      <Snackbar state={snack.state} onDismiss={snack.dismiss} bottom={selecting ? 140 : 16} />
    </View>
  );
}

function CatalogCard({
  t,
  selected,
  selecting,
  onPress,
  onLongPress,
  onUp,
  onDown,
  onMenu,
  onStatus,
}: {
  t: Title;
  selected: boolean;
  selecting: boolean;
  onPress: () => void;
  onLongPress: () => void;
  onUp: () => void;
  onDown: () => void;
  onMenu: () => void;
  onStatus: () => void;
}) {
  const { shown } = genreChips(t.genres);
  const isTop = t.rank === 1;
  // card da altura da capa: posição · status · nota no topo, título, uma linha de dados; ▲ ⋯ ▼ à direita
  const meta = [kindLabel(t.kind), t.year, ...shown.map((g) => g.label)].filter(Boolean).join(' · ');
  return (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      delayLongPress={300}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      accessibilityLabel={`${t.rank != null ? `Posição ${t.rank}. ` : ''}${t.title}`}
      style={({ pressed }) => [
        ui.card,
        { flexDirection: 'row', gap: 10, paddingVertical: 6, paddingHorizontal: 8, borderRadius: 12, alignItems: 'center' },
        selected && { borderColor: colors.primary, backgroundColor: colors.primarySoft },
        pressed && { opacity: 0.85 },
      ]}
    >
      {selecting ? <Icon name={selected ? 'checkbox' : 'square-outline'} size={22} color={selected ? colors.primary : colors.muted} /> : null}
      <Poster url={t.posterUrl ?? t.resolution?.imageUrl} title={t.title} size="sm" />
      <View style={{ flex: 1, height: 66, justifyContent: 'space-between' }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          {t.rank != null ? <Text style={{ fontSize: 13, fontWeight: '800', color: isTop ? colors.primary : colors.primary2 }}>#{t.rank}</Text> : null}
          <Pressable accessibilityRole="button" accessibilityLabel={`Status: ${TITLE_STATUS_LABEL[t.status]}. Mudar`} onPress={onStatus} hitSlop={8}>
            <Text style={{ fontSize: 12, fontWeight: '600', color: colors.text2 }}>{TITLE_STATUS_LABEL[t.status]}</Text>
          </Pressable>
          {t.rating ? (
            <Text style={{ color: colors.star, fontSize: 12 }} accessibilityLabel={`Nota ${t.rating}`}>
              {ratingText(t.rating)}
            </Text>
          ) : null}
        </View>
        <Text numberOfLines={1} style={{ fontSize: 15, fontWeight: '700', color: colors.text }}>
          {t.title}
        </Text>
        <Text style={{ fontSize: 12, color: colors.muted }} numberOfLines={1}>
          {meta || ' '}
        </Text>
      </View>
      {!selecting && t.rank != null ? (
        <View style={{ alignItems: 'center' }}>
          <Pressable accessibilityRole="button" accessibilityLabel="Subir" disabled={isTop} onPress={onUp} hitSlop={6} style={{ width: 32, height: 22, alignItems: 'center', justifyContent: 'center', opacity: isTop ? 0.3 : 1 }}>
            <Icon name="chevron-up" size={18} color={colors.text2} />
          </Pressable>
          <Pressable accessibilityRole="button" accessibilityLabel="Mais opções" onPress={onMenu} hitSlop={6} style={{ width: 32, height: 20, alignItems: 'center', justifyContent: 'center' }}>
            <Icon name="ellipsis-horizontal" size={16} color={colors.muted} />
          </Pressable>
          <Pressable accessibilityRole="button" accessibilityLabel="Descer" onPress={onDown} hitSlop={6} style={{ width: 32, height: 22, alignItems: 'center', justifyContent: 'center' }}>
            <Icon name="chevron-down" size={18} color={colors.text2} />
          </Pressable>
        </View>
      ) : null}
    </Pressable>
  );
}
