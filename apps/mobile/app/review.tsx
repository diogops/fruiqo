// Revisão (RF-42): tudo o que é importado passa por aqui antes de entrar na fila. Mostra o match,
// até 3 alternativas, o encaixe sugerido (#N de M + motivos), a lista proposta e possíveis
// duplicatas. Aprovar / ajustar / rejeitar, um a um ou em lote.
import { openLibraryWorkUrl, tmdbPageUrl, workPages, type ApproveReviewRequest, type ReviewItem } from '@fruiqo/contracts';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, Pressable, RefreshControl, Switch, Text, TextInput, View } from 'react-native';

import { approveReview, batchReview, getReview, rejectReview, swapMusicReview } from '../src/api/client';
import { canSwapMusic, fitLabel, matchPercent, toggleSelected } from '../src/catalog/logic';
import { useReviewCount } from '../src/catalog/reviewCount';
import { Button, Chip, Icon, openExternal, Poster, WorkLink, WorkLinks } from '../src/ui/components';
import { kindLabel, sourceLabel } from '../src/ui/labels';
import { Sheet, Snackbar, useSnackbar } from '../src/ui/overlays';
import { colors, ui } from '../src/ui/theme';
import { useTheme } from '../src/ui/ThemeProvider';

function message(e: unknown) {
  return e instanceof Error ? e.message : 'Algo deu errado. Tente de novo.';
}

type Placement = 'suggested' | 'top' | 'end' | 'position';
type AltChoice = {
  key: string;
  label: string;
  /** página da alternativa para conferir antes de escolher */
  url?: string;
  body: Pick<ApproveReviewRequest, 'alternative' | 'alternativeBook'>;
};

/** Alternativas de match (filmes/séries do TMDB e livros da Open Library) num formato único. */
function alternativesOf(item: ReviewItem): AltChoice[] {
  const movies = (item.alternatives ?? []).map((a) => ({
    key: `tmdb:${a.mediaType}:${a.tmdbId}`,
    label: `${a.title}${a.year ? ` (${a.year})` : ''} · ${matchPercent(a.score)}`,
    url: tmdbPageUrl(a.mediaType, a.tmdbId),
    body: { alternative: { tmdbId: a.tmdbId, mediaType: a.mediaType } },
  }));
  const books = (item.bookAlternatives ?? []).map((b) => ({
    key: `ol:${b.olWorkId}`,
    label: `${b.title}${b.authors?.length ? ` — ${b.authors[0]}` : ''}${b.year ? ` (${b.year})` : ''} · ${matchPercent(b.score)}`,
    url: openLibraryWorkUrl(b.olWorkId),
    body: { alternativeBook: { olWorkId: b.olWorkId } },
  }));
  return [...movies, ...books];
}

export default function Review() {
  useTheme();
  const router = useRouter();
  const count = useReviewCount();
  const snack = useSnackbar();
  const [items, setItems] = useState<ReviewItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [batchBusy, setBatchBusy] = useState(false);
  const [adjusting, setAdjusting] = useState<ReviewItem | null>(null);
  // ordem definida pelo usuário (▲▼): aprovar em lote no topo/fim põe o bloco nessa ordem
  const [order, setOrder] = useState<string[]>([]);

  const load = useCallback(async () => {
    try {
      const res = await getReview();
      setItems(res.items);
      setError(null);
    } catch (e) {
      setError(message(e));
    }
    void count.refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  function drop(ids: string[]) {
    setItems((prev) => prev?.filter((i) => !ids.includes(i.title.id)) ?? prev);
    setSelected((s) => new Set([...s].filter((id) => !ids.includes(id))));
    void count.refresh();
  }

  async function approve(item: ReviewItem, body: ApproveReviewRequest = {}) {
    setBusyId(item.title.id);
    try {
      const t = await approveReview(item.title.id, body);
      drop([item.title.id]);
      snack.show({
        message: `"${t.title}" entrou como #${t.rank ?? '—'}`,
        actionLabel: 'Ver',
        onAction: () => router.push({ pathname: '/title/[id]', params: { id: t.id } }),
      });
    } catch (e) {
      Alert.alert('Não foi possível aprovar', message(e));
    } finally {
      setBusyId(null);
    }
  }

  async function reject(item: ReviewItem) {
    setBusyId(item.title.id);
    try {
      await rejectReview(item.title.id);
      drop([item.title.id]);
      snack.show({ message: `"${item.title.title}" descartado` });
    } catch (e) {
      Alert.alert('Não foi possível rejeitar', message(e));
    } finally {
      setBusyId(null);
    }
  }

  async function swapMusic(item: ReviewItem) {
    setBusyId(item.title.id);
    try {
      const t = await swapMusicReview(item.title.id);
      setItems((prev) => prev?.map((i) => (i.title.id === t.id ? { ...i, title: t } : i)) ?? prev);
      snack.show({ message: `Agora: "${t.title}"${t.creator ? ` — ${t.creator}` : ''}` });
    } catch (e) {
      Alert.alert('Não foi possível trocar', message(e));
    } finally {
      setBusyId(null);
    }
  }

  async function batch(action: 'approve' | 'reject', ids: string[], placement: 'suggested' | 'top' | 'end' = 'suggested') {
    if (ids.length === 0) return;
    setBatchBusy(true);
    try {
      const res = await batchReview({ ids, action, ...(action === 'approve' ? { placement } : {}) });
      const failed = new Set(res.failed.map((f) => f.id));
      drop(ids.filter((id) => !failed.has(id)));
      const done = action === 'approve' ? res.approved.length : res.rejected;
      snack.show({
        message: `${done} ${action === 'approve' ? 'aprovado(s)' : 'descartado(s)'}${failed.size ? ` · ${failed.size} com erro` : ''}`,
      });
    } catch (e) {
      Alert.alert('Ação em lote não concluída', message(e));
    } finally {
      setBatchBusy(false);
    }
  }

  const all = sortByOrder(items ?? [], order);
  // na ordem da tela, não na ordem em que foram selecionados
  const targetIds = all.map((i) => i.title.id).filter((id) => selected.size === 0 || selected.has(id));

  function moveItem(id: string, delta: -1 | 1) {
    const ids = all.map((i) => i.title.id);
    const from = ids.indexOf(id);
    const to = from + delta;
    if (from < 0 || to < 0 || to >= ids.length) return;
    [ids[from], ids[to]] = [ids[to]!, ids[from]!];
    setOrder(ids);
  }
  const scope = selected.size > 0 ? `${selected.size} selecionado(s)` : `todos (${all.length})`;

  return (
    <View style={ui.screen}>
      <FlatList
        data={all}
        keyExtractor={(i) => i.title.id}
        contentContainerStyle={[ui.pad, { paddingBottom: 120 }, all.length === 0 && { flexGrow: 1 }]}
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
          <View style={{ gap: 10, marginBottom: 4 }}>
            <Text style={ui.body}>
              Tudo o que você importa espera aqui. Confira o título encontrado e onde ele entraria na sua fila antes de aprovar.
            </Text>
            {all.length > 1 && (
              <View style={{ gap: 8 }}>
                <Text style={ui.muted}>Ações em lote: {scope}. Segure um item para selecionar; ▲▼ definem a ordem.</Text>
                <View style={{ flexDirection: 'row', gap: 8 }}>
                  <View style={{ flex: 1 }}>
                    <Button
                      title="Aprovar"
                      icon="checkmark-done"
                      compact
                      loading={batchBusy}
                      onPress={() =>
                        Alert.alert('Aprovar em lote', `Onde ${scope} entram na fila?`, [
                          { text: 'No topo, nesta ordem', onPress: () => void batch('approve', targetIds, 'top') },
                          { text: 'No fim, nesta ordem', onPress: () => void batch('approve', targetIds, 'end') },
                          { text: 'Encaixe sugerido', onPress: () => void batch('approve', targetIds, 'suggested') },
                        ], { cancelable: true })
                      }
                    />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Button
                      title="Rejeitar"
                      icon="close"
                      variant="secondary"
                      compact
                      disabled={batchBusy}
                      onPress={() =>
                        Alert.alert('Rejeitar em lote?', `${scope} serão descartados.`, [
                          { text: 'Cancelar', style: 'cancel' },
                          { text: 'Rejeitar', style: 'destructive', onPress: () => void batch('reject', targetIds) },
                        ])
                      }
                    />
                  </View>
                </View>
              </View>
            )}
            {error && <Text style={ui.error}>{error}</Text>}
          </View>
        }
        ListEmptyComponent={
          items === null ? (
            <ActivityIndicator color={colors.primary} style={{ marginTop: 32 }} />
          ) : (
            <View style={{ flex: 1, justifyContent: 'center', gap: 8, paddingVertical: 32 }}>
              <Icon name="checkmark-circle-outline" size={40} color={colors.ok} />
              <Text style={ui.h2}>Nada para revisar</Text>
              <Text style={ui.body}>Quando você importar prints, um .txt ou títulos pela busca, eles aparecem aqui primeiro.</Text>
              <Button title="Adicionar título" icon="add" variant="secondary" onPress={() => router.push('/add' as never)} />
            </View>
          )
        }
        renderItem={({ item, index }) => (
          <ReviewCard
            item={item}
            position={all.length > 1 ? index + 1 : undefined}
            onUp={index > 0 ? () => moveItem(item.title.id, -1) : undefined}
            onDown={index < all.length - 1 ? () => moveItem(item.title.id, 1) : undefined}
            busy={busyId === item.title.id}
            selected={selected.has(item.title.id)}
            onToggle={() => setSelected((s) => toggleSelected(s, item.title.id))}
            onApprove={() => void approve(item)}
            onAdjust={() => setAdjusting(item)}
            onReject={() => void reject(item)}
            onSwapMusic={() => void swapMusic(item)}
          />
        )}
      />
      <AdjustSheet
        item={adjusting}
        onClose={() => setAdjusting(null)}
        onSubmit={(body) => {
          const it = adjusting;
          setAdjusting(null);
          if (it) void approve(it, body);
        }}
      />
      <Snackbar state={snack.state} onDismiss={snack.dismiss} />
    </View>
  );
}

/** Ordem local por cima da do servidor; itens novos vão para o fim. */
function sortByOrder(items: ReviewItem[], order: string[]): ReviewItem[] {
  if (order.length === 0) return items;
  const pos = new Map(order.map((id, i) => [id, i]));
  return items
    .map((it, i) => ({ it, k: pos.get(it.title.id) ?? order.length + i }))
    .sort((a, b) => a.k - b.k)
    .map((x) => x.it);
}

function ReviewCard({
  item,
  position,
  onUp,
  onDown,
  busy,
  selected,
  onToggle,
  onApprove,
  onAdjust,
  onReject,
  onSwapMusic,
}: {
  item: ReviewItem;
  position?: number;
  onUp?: () => void;
  onDown?: () => void;
  busy: boolean;
  selected: boolean;
  onToggle: () => void;
  onApprove: () => void;
  onAdjust: () => void;
  onReject: () => void;
  onSwapMusic: () => void;
}) {
  const t = item.title;
  const fit = fitLabel(item.fit);
  const match = matchPercent(item.candidate?.confidenceScore);
  const alts = alternativesOf(item);
  // conferir a obra que casou: TMDB/Open Library (e IMDb quando houver)
  const page = workPages(t.resolution);
  return (
    <Pressable
      onLongPress={onToggle}
      onPress={selected ? onToggle : undefined}
      delayLongPress={300}
      accessibilityState={{ selected }}
      style={[ui.card, { gap: 10 }, selected && { borderColor: colors.primary, backgroundColor: colors.primarySoft }]}
    >
      <View style={{ flexDirection: 'row', gap: 12 }}>
        <WorkLink url={page?.url} label={`Ver ${t.title} no ${page?.label}`}>
          <Poster url={t.posterUrl ?? t.resolution?.imageUrl} title={t.title} size="sm" />
        </WorkLink>
        <View style={{ flex: 1, gap: 4 }}>
          <Text style={[ui.body, { fontWeight: '700', color: colors.text }]}>{t.title}</Text>
          <WorkLinks title={t.title} page={page} />
          {t.creator ? <Text style={ui.body}>{t.creator}</Text> : null}
          <Text style={ui.muted}>{[kindLabel(t.kind), t.year, match && `match ${match}`].filter(Boolean).join(' · ')}</Text>
          {t.overview ? (
            <Text style={ui.muted} numberOfLines={3}>
              {t.overview}
            </Text>
          ) : null}
          {item.candidate && item.candidate.rawTitle !== t.title ? (
            <Text style={ui.muted} numberOfLines={2}>
              Lido como “{item.candidate.rawTitle}”
            </Text>
          ) : null}
          {item.share ? (
            <Text style={ui.muted} numberOfLines={1}>
              De: {item.share.sourceTitle ?? sourceLabel({ platform: item.share.platform, origin: item.share.origin })}
            </Text>
          ) : null}
        </View>
        <View style={{ alignItems: 'center', gap: 2 }}>
          {selected ? <Icon name="checkbox" size={22} color={colors.primary} /> : null}
          {position != null ? (
            <>
              <Pressable accessibilityRole="button" accessibilityLabel={`Subir ${t.title}`} disabled={!onUp} onPress={onUp} hitSlop={6}>
                <Icon name="chevron-up" size={22} color={onUp ? colors.text2 : colors.border} />
              </Pressable>
              <Text style={ui.muted}>{position}º</Text>
              <Pressable accessibilityRole="button" accessibilityLabel={`Descer ${t.title}`} disabled={!onDown} onPress={onDown} hitSlop={6}>
                <Icon name="chevron-down" size={22} color={onDown ? colors.text2 : colors.border} />
              </Pressable>
            </>
          ) : null}
        </View>
      </View>

      {fit ? (
        <View style={{ gap: 4 }}>
          <View style={[ui.pill, { backgroundColor: colors.primarySoft }]}>
            <Text style={ui.pillText}>{fit}</Text>
          </View>
          {item.fit?.reasons.slice(0, 3).map((r) => (
            <Text key={r} style={ui.muted}>
              • {r}
            </Text>
          ))}
        </View>
      ) : null}

      {item.duplicateOf ? (
        <View style={{ flexDirection: 'row', gap: 6, alignItems: 'center' }}>
          <Icon name="copy-outline" size={16} color={colors.warn} />
          <Text style={[ui.muted, { color: colors.warn, flex: 1 }]}>
            Parece ser o mesmo que “{item.duplicateOf.title}”{item.duplicateOf.rank ? ` (#${item.duplicateOf.rank})` : ''} já no catálogo.
          </Text>
        </View>
      ) : null}

      {item.proposedList ? (
        <Text style={ui.muted}>
          <Icon name="albums-outline" size={14} /> Vai para a lista “{item.proposedList.name}”
          {item.proposedList.listId ? '' : ' (criada ao aprovar)'}
        </Text>
      ) : null}

      {alts.length > 0 ? <Text style={ui.muted}>Outras opções: {alts.length} (em Ajustar)</Text> : null}

      {canSwapMusic(t) ? (
        <Button title="Trocar música/artista" icon="swap-horizontal" variant="secondary" compact disabled={busy} onPress={onSwapMusic} />
      ) : null}

      <View style={{ flexDirection: 'row', gap: 8 }}>
        <View style={{ flex: 1.3 }}>
          <Button title="Aprovar" icon="checkmark" compact loading={busy} onPress={onApprove} />
        </View>
        <View style={{ flex: 1 }}>
          <Button title="Ajustar" variant="secondary" compact disabled={busy} onPress={onAdjust} />
        </View>
        <View style={{ flex: 1 }}>
          <Button title="Rejeitar" variant="secondary" compact disabled={busy} onPress={onReject} />
        </View>
      </View>
    </Pressable>
  );
}

const KIND_CHOICES = ['movie', 'series', 'book', 'other'] as const;

function AdjustSheet({ item, onClose, onSubmit }: { item: ReviewItem | null; onClose: () => void; onSubmit: (b: ApproveReviewRequest) => void }) {
  const [placement, setPlacement] = useState<Placement>('suggested');
  const [position, setPosition] = useState('');
  const [alt, setAlt] = useState<string | null>(null);
  const [useList, setUseList] = useState(true);
  const [correct, setCorrect] = useState(false);
  const [title, setTitle] = useState('');
  const [year, setYear] = useState('');
  const [kind, setKind] = useState<string>('movie');
  const [lastId, setLastId] = useState<string | null>(null);

  // reinicia o formulário a cada item aberto
  if (item && item.title.id !== lastId) {
    setLastId(item.title.id);
    setPlacement('suggested');
    setPosition(item.fit ? String(item.fit.position) : '1');
    setAlt(null);
    setUseList(true);
    setCorrect(false);
    setTitle(item.title.title);
    setYear(item.title.year ? String(item.title.year) : '');
    setKind(item.title.kind);
  }
  if (!item) return <Sheet visible={false} title="" onClose={onClose}>{null}</Sheet>;

  const alts = alternativesOf(item);

  function submit() {
    const body: ApproveReviewRequest = {};
    if (placement === 'position') body.position = Math.max(1, Number(position) || 1);
    else body.placement = placement;
    const chosen = alts.find((a) => a.key === alt);
    if (chosen) Object.assign(body, chosen.body);
    if (item?.proposedList) body.useProposedList = useList;
    if (correct) {
      if (title.trim()) body.title = title.trim();
      const y = Number(year);
      body.year = year && y >= 1870 && y <= 2100 ? y : null;
      body.kind = kind as ApproveReviewRequest['kind'];
    }
    onSubmit(body);
  }

  return (
    <Sheet visible title={`Ajustar “${item.title.title}”`} onClose={onClose} footer={<Button title="Aprovar com ajustes" icon="checkmark" onPress={submit} />}>
      <Text style={ui.h2}>Onde entra na fila</Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        <Chip label={item.fit ? `Sugerido (#${item.fit.position})` : 'Sugerido'} selected={placement === 'suggested'} onPress={() => setPlacement('suggested')} />
        <Chip label="Topo" selected={placement === 'top'} onPress={() => setPlacement('top')} />
        <Chip label="Fim" selected={placement === 'end'} onPress={() => setPlacement('end')} />
        <Chip label="Posição…" selected={placement === 'position'} onPress={() => setPlacement('position')} />
      </View>
      {placement === 'position' && (
        <TextInput
          style={ui.input}
          value={position}
          onChangeText={(v) => setPosition(v.replace(/[^0-9]/g, ''))}
          keyboardType="number-pad"
          autoFocus
          selectTextOnFocus
          accessibilityLabel="Posição na fila"
        />
      )}

      {alts.length > 0 && (
        <>
          <Text style={ui.h2}>É outro título?</Text>
          <Chip label={`Manter: ${item.title.title}`} selected={alt === null} onPress={() => setAlt(null)} />
          {alts.map((a) => (
            <View key={a.key} style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <View style={{ flexShrink: 1 }}>
                <Chip label={a.label} selected={alt === a.key} onPress={() => setAlt(a.key)} />
              </View>
              {a.url ? (
                <Pressable accessibilityRole="link" accessibilityLabel={`Ver ${a.label} na página da obra`} onPress={() => openExternal(a.url)} hitSlop={8}>
                  <Icon name="open-outline" size={22} color={colors.primary} />
                </Pressable>
              ) : null}
            </View>
          ))}
        </>
      )}

      {item.proposedList && (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          <Text style={[ui.body, { flex: 1 }]}>Incluir na lista “{item.proposedList.name}”</Text>
          <Switch value={useList} onValueChange={setUseList} />
        </View>
      )}

      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
        <Text style={[ui.body, { flex: 1 }]}>Corrigir título, ano ou tipo</Text>
        <Switch value={correct} onValueChange={setCorrect} />
      </View>
      {correct && (
        <>
          <TextInput style={ui.input} value={title} onChangeText={setTitle} placeholder="Título" placeholderTextColor={colors.muted} autoFocus accessibilityLabel="Título correto" />
          <TextInput
            style={ui.input}
            value={year}
            onChangeText={(v) => setYear(v.replace(/[^0-9]/g, '').slice(0, 4))}
            placeholder="Ano (opcional)"
            placeholderTextColor={colors.muted}
            keyboardType="number-pad"
            accessibilityLabel="Ano"
          />
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {KIND_CHOICES.map((k) => (
              <Chip key={k} label={kindLabel(k)} selected={kind === k} onPress={() => setKind(k)} />
            ))}
          </View>
        </>
      )}
    </Sheet>
  );
}
