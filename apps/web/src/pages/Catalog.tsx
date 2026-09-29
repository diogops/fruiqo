import { DndContext, KeyboardSensor, MouseSensor, TouchSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core';
import { SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { type BulkOperation, type MoveTitleRequest, providerTitleLink, type Title, type TitleStatus, type WatchProvider } from '@fruiqo/contracts';
import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState, type ReactElement } from 'react';
import { Link, useSearchParams } from 'react-router';
import { AddTitle } from './AddTitle';
import { ImportTxt, isTextFile } from './ImportTxt';
import { DRAFT_KEY, PriorityDraftView } from './PriorityDraft';
import { api, type LibraryFilters } from '../api/client';
import { CorrectTitleForm, ErrorNote, Modal, useTaxonomy } from '../components/shared';
import { useToast } from '../components/Toast';
import { EmptyState, Icon, Menu, MQ, ratingText, SkeletonRows, StarRating, Thumb, useElementWidth, useMediaQuery } from '../components/ui';
import { kindLabel, KINDS, STATUS_LABEL, STATUSES } from '../labels';
import { shiftRanks, targetPosition } from '../rankQueue';

const FILTER_KEYS = ['q', 'kind', 'status', 'genre', 'listId', 'shareId', 'review', 'sort'] as const;

function filtersFromParams(params: URLSearchParams): LibraryFilters {
  const f: Record<string, string> = {};
  for (const k of FILTER_KEYS) {
    const v = params.get(k);
    if (v) f[k] = v;
  }
  return f as LibraryFilters;
}

export function Catalog() {
  const [params, setParams] = useSearchParams();
  const filters = useMemo(() => filtersFromParams(params), [params]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [openId, setOpenId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  // RF-47: import de .txt (botão ou arquivo solto na página)
  const [importing, setImporting] = useState<{ file: File | null } | null>(null);
  const [dropping, setDropping] = useState(false);
  // RF-44: rascunho de priorização (persistido no servidor)
  const [draftOpen, setDraftOpen] = useState(false);
  const [draftBusy, setDraftBusy] = useState(false);
  // campo de busca controlado: acompanha a URL (ex.: busca global do cabeçalho com o catálogo aberto)
  const [searchText, setSearchText] = useState(filters.q ?? '');
  useEffect(() => {
    setSearchText((cur) => (cur.trim() === (filters.q ?? '') ? cur : (filters.q ?? '')));
  }, [filters.q]);
  const qc = useQueryClient();
  const toast = useToast();
  // ≤768: cards + painel de filtros + ação em massa no rodapé; acima disso, tabela com colunas por largura
  const isMobile = useMediaQuery(MQ.mobile);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [wrapWidth, wrapRef] = useElementWidth();
  // no toque os controles da fila têm alvos maiores: a coluna # cresce junto
  const coarse = useMediaQuery('(pointer: coarse)');
  const rankWidth = coarse ? 212 : 168;
  const cols: CatalogColumns = { genres: wrapWidth >= 760, kind: wrapWidth >= 900, origin: wrapWidth >= 1080 };
  const tableMinWidth = 44 + rankWidth + 220 + 132 + 92 + (cols.kind ? 70 : 0) + (cols.genres ? 182 : 0) + (cols.origin ? 128 : 0);
  const activeFilters =
    (['kind', 'status', 'genre', 'listId', 'review', 'shareId'] as const).filter((k) => Boolean(filters[k])).length +
    (filters.sort && filters.sort !== 'rank' ? 1 : 0);

  const draft = useQuery({ queryKey: DRAFT_KEY, queryFn: api.draft });

  async function suggestPriority(scope: 'all' | 'to_watch') {
    setDraftBusy(true);
    try {
      qc.setQueryData(DRAFT_KEY, await api.createDraft({ scope }));
      setDraftOpen(true);
    } catch (err) {
      toast.show(err instanceof Error ? err.message : 'Não foi possível sugerir a priorização.', { tone: 'error' });
    } finally {
      setDraftBusy(false);
    }
  }

  const taxonomy = useTaxonomy();
  const lists = useQuery({ queryKey: ['lists'], queryFn: api.lists });
  const library = useInfiniteQuery({
    queryKey: ['library', filters],
    queryFn: ({ pageParam }) => api.library({ ...filters, limit: 100 }, pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
  const loaded = useMemo(() => library.data?.pages.flatMap((p) => p.items) ?? [], [library.data]);
  // fila de prioridade: posições otimistas até a API confirmar (rollback em erro)
  const [optimistic, setOptimistic] = useState<Map<string, number> | null>(null);
  const byRank = (filters.sort ?? 'rank') === 'rank';
  const items = useMemo(() => {
    if (!optimistic) return loaded;
    const withRank = loaded.map((t) => (optimistic.has(t.id) ? { ...t, rank: optimistic.get(t.id)! } : t));
    return byRank ? [...withRank].sort((a, b) => (a.rank ?? Infinity) - (b.rank ?? Infinity)) : withRank;
  }, [loaded, optimistic, byRank]);
  const dragEnabled = byRank && filters.review !== 'pending';
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 4 } }),
    // no toque, segurar ~200ms pela alça inicia o arraste; mover antes disso é rolagem
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  /** Destino previsível localmente? Só quando cai dentro dos títulos já carregados. */
  function localTarget(t: Title & { rank: number }, req: MoveTitleRequest): number | null {
    const maxLoaded = Math.max(...loaded.map((x) => x.rank ?? 0));
    if (!library.hasNextPage) return targetPosition(t.rank, maxLoaded, req);
    if ('position' in req) return req.position <= maxLoaded ? req.position : null;
    if (req.to === 'top') return 1;
    if (req.to === 'up') return Math.max(t.rank - 1, 1);
    if (req.to === 'down') return t.rank + 1 <= maxLoaded ? t.rank + 1 : null;
    return null;
  }

  async function move(t: Title, req: MoveTitleRequest) {
    if (t.rank == null) return;
    const to = localTarget({ ...t, rank: t.rank }, req);
    if (to != null && to !== t.rank) setOptimistic(shiftRanks(loaded, t.id, t.rank, to));
    try {
      const res = await api.moveTitle(t.id, req);
      await qc.invalidateQueries({ queryKey: ['library'] });
      toast.show(`"${t.title}" agora é o #${res.rank} de ${res.total}.`);
    } catch (err) {
      toast.show(err instanceof Error ? err.message : 'Não foi possível mover.', { tone: 'error' });
    } finally {
      setOptimistic(null);
    }
  }

  function onDragEnd(e: DragEndEvent) {
    if (!e.over || e.active.id === e.over.id) return;
    const dragged = items.find((t) => t.id === e.active.id);
    const over = items.find((t) => t.id === e.over!.id);
    if (!dragged || over?.rank == null) return;
    void move(dragged, { position: over.rank });
  }

  function setFilter(key: (typeof FILTER_KEYS)[number], value: string) {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    setParams(next, { replace: true });
    setSelected(new Set());
  }

  function toggle(id: string) {
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  }

  const allChecked = items.length > 0 && items.every((t) => selected.has(t.id));

  async function patch(t: Title, body: Parameters<typeof api.updateTitle>[1]) {
    try {
      await api.updateTitle(t.id, body);
      await qc.invalidateQueries({ queryKey: ['library'] });
    } catch (err) {
      toast.show(err instanceof Error ? err.message : 'Não foi possível salvar.', { tone: 'error' });
    }
  }

  async function runBulk(operation: BulkOperation, label: string) {
    const titleIds = [...selected];
    if (titleIds.length === 0) return;
    if (operation.type === 'delete' && !window.confirm(`Remover ${titleIds.length} título(s) do catálogo?`)) return;
    try {
      const res = await api.bulk({ titleIds, operation });
      setSelected(new Set());
      await qc.invalidateQueries();
      toast.show(`${label}: ${res.affected} título(s).`, {
        action: {
          label: 'Desfazer',
          onClick: async () => {
            try {
              const u = await api.undoBulk(res.undoToken);
              await qc.invalidateQueries();
              toast.show(`Desfeito (${u.restored} título(s)).`);
            } catch (err) {
              toast.show(err instanceof Error ? err.message : 'Não foi possível desfazer.', { tone: 'error' });
            }
          },
        },
      });
    } catch (err) {
      toast.show(err instanceof Error ? err.message : 'Falha na ação em massa.', { tone: 'error' });
    }
  }

  const genres = taxonomy.data?.genres ?? [];

  return (
    <section
      className={dropping ? 'drop-target dragging' : 'drop-target'}
      onDragOver={(e) => {
        if (!e.dataTransfer.types.includes('Files')) return;
        e.preventDefault();
        setDropping(true);
      }}
      onDragLeave={(e) => {
        if (e.currentTarget === e.target) setDropping(false);
      }}
      onDrop={(e) => {
        const f = e.dataTransfer.files[0];
        setDropping(false);
        if (!f) return;
        e.preventDefault();
        if (isTextFile(f)) setImporting({ file: f });
        else toast.show('Solte um arquivo .txt para importar títulos.', { tone: 'error' });
      }}
    >
      <div className="page-head">
        <div>
          <h1>Catálogo</h1>
          <p className="page-sub">Sua fila de filmes, séries, livros e músicas — #1 é o próximo da vez.</p>
        </div>
        <div className="head-actions">
          <Menu label="Sugerir priorização" triggerClassName="btn" trigger={<><Icon name="sparkles" /> Sugerir priorização</>}>
            {(close) => (
              <>
                <button type="button" className="menu-item" disabled={draftBusy} onClick={() => { close(); void suggestPriority('to_watch'); }}>
                  Só o que quero ver
                </button>
                <button type="button" className="menu-item" disabled={draftBusy} onClick={() => { close(); void suggestPriority('all'); }}>
                  A fila inteira
                </button>
              </>
            )}
          </Menu>
          <button type="button" className="btn" onClick={() => setImporting({ file: null })}>
            <Icon name="list" /> Importar .txt
          </button>
          <button type="button" className="btn btn-primary" onClick={() => setAdding(true)}>
            <Icon name="plus" /> Adicionar título
          </button>
        </div>
      </div>

      {draft.data && !draftOpen && (
        <div className="draft-pending" role="status">
          <span className="grow">Você tem um rascunho de priorização salvo ({draft.data.items.length} títulos). Nada foi aplicado ainda.</span>
          <button type="button" className="btn" onClick={() => setDraftOpen(true)}>
            Abrir rascunho
          </button>
        </div>
      )}
      {draft.data && draftOpen && <PriorityDraftView draft={draft.data} onExit={() => setDraftOpen(false)} />}

      {/* modo rascunho: só o rascunho aparece, para não confundir com a fila real */}
      {!(draft.data && draftOpen) && (
        <>
          <div className="filters" role="search">
            <input
              type="search"
              aria-label="Buscar por título"
              placeholder="Buscar título…"
              value={searchText}
              onChange={(e) => {
                setSearchText(e.target.value);
                setFilter('q', e.target.value.trim());
              }}
            />
            {isMobile ? (
              <button
                type="button"
                className="btn filters-toggle"
                aria-haspopup="dialog"
                aria-expanded={filtersOpen}
                onClick={() => setFiltersOpen(true)}
              >
                <Icon name="filter" /> Filtros
                {activeFilters > 0 && (
                  <span className="count-badge" aria-label={`${activeFilters} filtro(s) ativo(s)`}>
                    {activeFilters}
                  </span>
                )}
              </button>
            ) : (
              <FilterFields filters={filters} setFilter={setFilter} genres={genres} lists={lists.data ?? []} />
            )}
          </div>
          {isMobile && filtersOpen && (
            <Modal title="Filtros" onClose={() => setFiltersOpen(false)}>
              <div className="form filters-sheet">
                <FilterFields stacked filters={filters} setFilter={setFilter} genres={genres} lists={lists.data ?? []} />
                <div className="actions">
                  <button
                    type="button"
                    className="btn"
                    onClick={() => {
                      const next = new URLSearchParams();
                      if (filters.q) next.set('q', filters.q);
                      setParams(next, { replace: true });
                    }}
                    disabled={activeFilters === 0}
                  >
                    Limpar filtros
                  </button>
                  <button type="button" className="btn btn-primary" onClick={() => setFiltersOpen(false)}>
                    Ver resultados
                  </button>
                </div>
              </div>
            </Modal>
          )}

          {selected.size > 0 && (
            <BulkBar
              compact={isMobile}
              count={selected.size}
              lists={lists.data ?? []}
              genres={genres}
              onRun={runBulk}
              onClear={() => setSelected(new Set())}
            />
          )}

          <ErrorNote error={library.error} />
          {dragEnabled && items.length > 1 && (
            <p className="muted small drag-hint">
              {isMobile
                ? 'Segure a alça ⠿ para arrastar, ou use ▲/▼. #1 é o mais prioritário.'
                : 'Arraste pela alça ou use ▲/▼ para mudar a prioridade. #1 é o mais prioritário.'}
            </p>
          )}
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
            {isMobile ? (
              <div className="catalog-cards-wrap">
                {items.length > 0 && (
                  <label className="check select-all-row">
                    <input
                      type="checkbox"
                      aria-label="Selecionar todos"
                      checked={allChecked}
                      onChange={() => setSelected(allChecked ? new Set() : new Set(items.map((t) => t.id)))}
                    />
                    Selecionar todos ({items.length})
                  </label>
                )}
                <SortableContext items={items.map((t) => t.id)} strategy={verticalListSortingStrategy} disabled={!dragEnabled}>
                  <ul className="catalog-cards" aria-label="Títulos do catálogo">
                    {items.map((t) => (
                      <CatalogCard
                        key={t.id}
                        t={t}
                        draggable={dragEnabled && t.rank != null}
                        selected={selected.has(t.id)}
                        onToggle={() => toggle(t.id)}
                        onOpen={() => setOpenId(t.id)}
                        onPatch={(body) => void patch(t, body)}
                        onMove={(req) => void move(t, req)}
                      />
                    ))}
                  </ul>
                </SortableContext>
                {library.isLoading && <SkeletonRows />}
                {!library.isLoading && items.length === 0 && (
                  <EmptyState title="Nenhum título com esses filtros.">Ajuste os filtros ou importe prints pelo app.</EmptyState>
                )}
              </div>
            ) : (
              <div className="table-wrap catalog-wrap" ref={wrapRef}>
                <table className="table catalog-table" style={{ minWidth: tableMinWidth }}>
                  <colgroup>
                    <col className="col-check" />
                    <col className="col-rank" style={{ width: rankWidth }} />
                    <col className="col-title" />
                    {cols.kind && <col className="col-kind" />}
                    {cols.genres && <col className="col-genres" />}
                    <col className="col-status" />
                    <col className="col-rating" />
                    {cols.origin && <col className="col-origin" />}
                  </colgroup>
                  <thead>
                    <tr>
                      <th>
                        <input
                          type="checkbox"
                          aria-label="Selecionar todos"
                          checked={allChecked}
                          onChange={() => setSelected(allChecked ? new Set() : new Set(items.map((t) => t.id)))}
                        />
                      </th>
                      <th aria-label="Posição na fila">#</th>
                      <th>Título</th>
                      {cols.kind && <th>Tipo</th>}
                      {cols.genres && <th>Gêneros</th>}
                      <th>Status</th>
                      <th>Nota</th>
                      {cols.origin && <th>Origem</th>}
                    </tr>
                  </thead>
                  <SortableContext items={items.map((t) => t.id)} strategy={verticalListSortingStrategy} disabled={!dragEnabled}>
                    <tbody>
                      {items.map((t) => (
                        <CatalogRow
                          key={t.id}
                          t={t}
                          cols={cols}
                          draggable={dragEnabled && t.rank != null}
                          selected={selected.has(t.id)}
                          onToggle={() => toggle(t.id)}
                          onOpen={() => setOpenId(t.id)}
                          onPatch={(body) => void patch(t, body)}
                          onMove={(req) => void move(t, req)}
                        />
                      ))}
                    </tbody>
                  </SortableContext>
                </table>
                {library.isLoading && <SkeletonRows />}
                {!library.isLoading && items.length === 0 && (
                  <EmptyState title="Nenhum título com esses filtros.">Ajuste os filtros ou importe prints pelo app.</EmptyState>
                )}
              </div>
            )}
          </DndContext>
          {library.hasNextPage && (
            <div className="load-more">
              <button type="button" className="btn" onClick={() => void library.fetchNextPage()} disabled={library.isFetchingNextPage}>
                Carregar mais
              </button>
            </div>
          )}
        </>
      )}

      {openId && <TitleDetail id={openId} onClose={() => setOpenId(null)} />}
      {adding && <AddTitle onClose={() => setAdding(false)} />}
      {importing && <ImportTxt initialFile={importing.file} onClose={() => setImporting(null)} />}
    </section>
  );
}

function BulkBar({
  compact = false,
  count,
  lists,
  genres,
  onRun,
  onClear,
}: {
  compact?: boolean;
  count: number;
  lists: { id: string; name: string }[];
  genres: { key: string; label: string }[];
  onRun: (op: BulkOperation, label: string) => void;
  onClear: () => void;
}) {
  const [listId, setListId] = useState('');
  const [fromListId, setFromListId] = useState('');
  const [genre, setGenre] = useState('');
  const [expanded, setExpanded] = useState(false);
  // no celular a barra fica fixa no rodapé; os toasts sobem para não ficarem por baixo dela
  useEffect(() => {
    if (!compact) return;
    document.documentElement.classList.add('has-docked-bulkbar');
    return () => document.documentElement.classList.remove('has-docked-bulkbar');
  }, [compact]);
  const showGroups = !compact || expanded;
  return (
    <div className={compact ? 'bulkbar bulkbar-docked' : 'bulkbar'} role="region" aria-label="Ações em massa">
      <div className="bulkbar-head">
        <strong>{count} selecionado(s)</strong>
        {compact && (
          <>
            <button type="button" className="btn" onClick={() => onRun({ type: 'move_top' }, 'Levados ao topo da fila')}>
              <Icon name="top" /> Topo
            </button>
            <button type="button" className="btn" aria-expanded={expanded} onClick={() => setExpanded((e) => !e)}>
              {expanded ? 'Menos' : 'Mais ações'}
            </button>
            <button type="button" className="icon-btn" aria-label="Limpar seleção" onClick={onClear}>
              <Icon name="x" />
            </button>
          </>
        )}
      </div>
      {showGroups && (
        <>
      <span className="group">
        <select aria-label="Lista de destino" value={listId} onChange={(e) => setListId(e.target.value)}>
          <option value="">Lista…</option>
          {lists.map((l) => (
            <option key={l.id} value={l.id}>
              {l.name}
            </option>
          ))}
        </select>
        <button type="button" className="btn" disabled={!listId} onClick={() => onRun({ type: 'add_to_list', listId }, 'Adicionados à lista')}>
          Adicionar à lista
        </button>
        <select aria-label="Lista de origem" value={fromListId} onChange={(e) => setFromListId(e.target.value)}>
          <option value="">de…</option>
          {lists.map((l) => (
            <option key={l.id} value={l.id}>
              {l.name}
            </option>
          ))}
        </select>
        <button
          type="button"
          className="btn"
          disabled={!listId || !fromListId || listId === fromListId}
          onClick={() => onRun({ type: 'move_to_list', fromListId, toListId: listId }, 'Movidos de lista')}
        >
          Mover
        </button>
      </span>
      <span className="group">
        <select aria-label="Gênero da ação" value={genre} onChange={(e) => setGenre(e.target.value)}>
          <option value="">Gênero…</option>
          {genres.map((g) => (
            <option key={g.key} value={g.key}>
              {g.label}
            </option>
          ))}
        </select>
        <button type="button" className="btn" disabled={!genre} onClick={() => onRun({ type: 'add_genres', genres: [genre] }, 'Gênero adicionado')}>
          + gênero
        </button>
        <button type="button" className="btn" disabled={!genre} onClick={() => onRun({ type: 'remove_genres', genres: [genre] }, 'Gênero removido')}>
          − gênero
        </button>
      </span>
      <span className="group">
        <button type="button" className="btn" onClick={() => onRun({ type: 'move_top' }, 'Levados ao topo da fila')}>
          ⤒ Topo da fila
        </button>
        <button type="button" className="btn" onClick={() => onRun({ type: 'move_bottom' }, 'Levados ao fim da fila')}>
          ⤓ Fim da fila
        </button>
        <select
          aria-label="Definir status"
          value=""
          onChange={(e) => e.target.value && onRun({ type: 'set_status', status: e.target.value as TitleStatus }, 'Status alterado')}
        >
          <option value="">Status…</option>
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {STATUS_LABEL[s]}
            </option>
          ))}
        </select>
      </span>
      <button type="button" className="btn btn-danger" onClick={() => onRun({ type: 'delete' }, 'Removidos')}>
        Remover
      </button>
      {!compact && (
        <button type="button" className="btn btn-link" onClick={onClear}>
          Limpar seleção
        </button>
      )}
        </>
      )}
    </div>
  );
}

type CatalogColumns = { genres: boolean; kind: boolean; origin: boolean };

/** Campos de filtro: em linha na barra (desktop) ou empilhados com rótulo (painel do celular). */
function FilterFields({
  filters,
  setFilter,
  genres,
  lists,
  stacked = false,
}: {
  filters: LibraryFilters;
  setFilter: (key: (typeof FILTER_KEYS)[number], value: string) => void;
  genres: { key: string; label: string }[];
  lists: { id: string; name: string }[];
  stacked?: boolean;
}) {
  const field = (label: string, control: ReactElement) =>
    stacked ? (
      <label key={label}>
        {label}
        {control}
      </label>
    ) : (
      control
    );
  return (
    <>
      {field(
        'Tipo',
        <select key="kind" aria-label="Tipo" value={filters.kind ?? ''} onChange={(e) => setFilter('kind', e.target.value)}>
          <option value="">Todos os tipos</option>
          {KINDS.map((k) => (
            <option key={k} value={k}>
              {kindLabel(k)}
            </option>
          ))}
        </select>,
      )}
      {field(
        'Status',
        <select key="status" aria-label="Status" value={filters.status ?? ''} onChange={(e) => setFilter('status', e.target.value)}>
          <option value="">Todos os status</option>
          {STATUSES.map((st) => (
            <option key={st} value={st}>
              {STATUS_LABEL[st]}
            </option>
          ))}
        </select>,
      )}
      {field(
        'Gênero',
        <select key="genre" aria-label="Gênero" value={filters.genre ?? ''} onChange={(e) => setFilter('genre', e.target.value)}>
          <option value="">Todos os gêneros</option>
          {genres.map((g) => (
            <option key={g.key} value={g.key}>
              {g.label}
            </option>
          ))}
        </select>,
      )}
      {field(
        'Lista',
        <select key="list" aria-label="Lista" value={filters.listId ?? ''} onChange={(e) => setFilter('listId', e.target.value)}>
          <option value="">Todas as listas</option>
          {lists.map((l) => (
            <option key={l.id} value={l.id}>
              {l.name}
            </option>
          ))}
        </select>,
      )}
      {field(
        'Ordenar',
        <select key="sort" aria-label="Ordenar" value={filters.sort ?? 'rank'} onChange={(e) => setFilter('sort', e.target.value)}>
          <option value="rank">Prioridade (fila)</option>
          <option value="recent">Mais recentes</option>
          <option value="title">Título</option>
        </select>,
      )}
      <label className="check">
        <input type="checkbox" checked={filters.review === 'pending'} onChange={(e) => setFilter('review', e.target.checked ? 'pending' : '')} />
        Pendentes de revisão
      </label>
      {filters.shareId && (
        <button type="button" className="chip" onClick={() => setFilter('shareId', '')}>
          Fonte: 1 compartilhamento ×
        </button>
      )}
    </>
  );
}

const ENRICH_MSG: Record<'enriched' | 'no_match' | 'unsupported' | 'unavailable', string> = {
  enriched: 'Dados atualizados.',
  no_match: 'Nada encontrado no TMDB com este título. Corrija o título ou o ano e tente de novo.',
  unsupported: 'Só filmes e séries são buscados no TMDB.',
  unavailable: 'TMDB indisponível agora.',
};

/** 0,5 a 5, de meia em meia */
const RATINGS = [0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5];

const PROVIDER_TYPE: Record<WatchProvider['type'], string> = { flatrate: 'Assinatura', rent: 'Aluguel', buy: 'Compra' };

/** Um logo por serviço e tipo (o TMDB repete variantes como "com anúncios"). Com `fallbackUrl`, cada logo vira link. */
export function ProviderLogos({
  providers,
  link,
}: {
  providers: WatchProvider[];
  /** com `link`, cada logo abre o título no serviço (D-22): direto, busca ou página inicial; senão a página do TMDB */
  link?: { title: string; titleLinks?: Partial<Record<string, string>>; fallbackUrl?: string };
}) {
  const groups = (['flatrate', 'rent', 'buy'] as const)
    .map((type) => {
      const seen = new Set<string>();
      return [type, providers.filter((p) => p.type === type && !seen.has(p.key ?? p.name) && seen.add(p.key ?? p.name))] as const;
    })
    .filter(([, list]) => list.length > 0);
  return (
    <div className="providers">
      {groups.map(([type, list]) => (
        <div key={type} className="provider-row">
          <span className="muted small">{PROVIDER_TYPE[type]}</span>
          {list.map((p) => {
            const content = p.logoUrl ? (
              <img src={p.logoUrl} alt={p.name} title={p.name} width={32} height={32} className="provider-logo" />
            ) : (
              <span className="provider-name">{p.name}</span>
            );
            const target = link ? providerTitleLink(p.name, link.title, link.titleLinks) : undefined;
            const href = link ? (target?.url ?? link.fallbackUrl) : undefined;
            const label = !link
              ? p.name
              : target?.kind === 'title'
                ? `Abrir "${link.title}" no ${p.name}`
                : target?.kind === 'search'
                  ? `Buscar "${link.title}" no ${p.name}`
                  : `Abrir ${p.name}`;
            return href ? (
              <a key={p.name} href={href} target="_blank" rel="noopener noreferrer" className="provider-link" aria-label={label} title={label}>
                {content}
              </a>
            ) : (
              <span key={p.name}>{content}</span>
            );
          })}
        </div>
      ))}
    </div>
  );
}

/** Texto cortado em poucas linhas (a altura da capa) com "mais…" quando não cabe. */
function ClampText({ text }: { text: string }) {
  const ref = useRef<HTMLParagraphElement>(null);
  const [open, setOpen] = useState(false);
  const [overflows, setOverflows] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (el && !open) setOverflows(el.scrollHeight > el.clientHeight + 1);
  }, [text, open]);
  return (
    <div className="clamp-text">
      <p ref={ref} className={open ? 'overview' : 'overview clamped'}>
        {text}
      </p>
      {(overflows || open) && (
        <button type="button" className="btn btn-link small" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
          {open ? 'menos' : 'mais…'}
        </button>
      )}
    </div>
  );
}

function TitleDetail({ id, onClose }: { id: string; onClose: () => void }) {
  const title = useQuery({ queryKey: ['title', id], queryFn: () => api.title(id) });
  const taxonomy = useTaxonomy();
  const qc = useQueryClient();
  const [error, setError] = useState<unknown>(null);
  const t = title.data;

  async function toggleGenre(key: string) {
    if (!t) return;
    const has = t.genres.some((g) => g.key === key);
    const next = has ? t.genres.filter((g) => g.key !== key).map((g) => g.key) : [...t.genres.map((g) => g.key), key];
    try {
      await api.updateTitle(t.id, { genres: next.slice(0, 6) });
      await qc.invalidateQueries();
    } catch (err) {
      setError(err);
    }
  }

  async function saveNotes(notes: string) {
    if (!t || (t.notes ?? '') === notes) return;
    try {
      await api.updateTitle(t.id, { notes: notes || null });
      await qc.invalidateQueries();
    } catch (err) {
      setError(err);
    }
  }

  async function rate(rating: number | null) {
    if (!t) return;
    try {
      await api.updateTitle(t.id, { rating });
      await qc.invalidateQueries();
    } catch (err) {
      setError(err);
    }
  }

  const canEnrich = t != null && (t.kind === 'movie' || t.kind === 'series' || t.kind === 'book');
  const enrichLabel =
    t?.kind === 'book'
      ? t.enrichment === 'openlibrary'
        ? 'Atualizar dados da Open Library'
        : 'Buscar na Open Library'
      : t?.enrichment === 'tmdb'
        ? 'Atualizar dados do TMDB'
        : 'Buscar no TMDB';

  const [enrichMsg, setEnrichMsg] = useState<string | null>(null);
  async function enrich() {
    if (!t) return;
    try {
      const res = await api.enrichTitle(t.id);
      setEnrichMsg(ENRICH_MSG[res.status]);
      await qc.invalidateQueries();
    } catch (err) {
      setError(err);
    }
  }

  return (
    <Modal title={t ? t.title : 'Título'} onClose={onClose}>
      <ErrorNote error={title.error ?? error} />
      {t && (
        <>
          <div className="title-hero">
            {t.posterUrl && <div className="title-hero-bg" style={{ backgroundImage: `url(${t.posterUrl})` }} aria-hidden="true" />}
          <div className="title-head">
            {t.posterUrl && <img className="poster" src={t.posterUrl} alt="" width={120} height={180} />}
            <div className="title-info">
              <p className="title-meta muted small">
                <span className="title-meta-text">
                  {[kindLabel(t.kind), t.year, t.creator, t.pages ? `${t.pages} págs.` : null].filter(Boolean).join(' · ')}
                </span>
                {t.rank != null && <span className="badge badge-status-watching">#{t.rank} na fila</span>}
                {t.genres.map((g) => (
                  <span key={g.key} className="genre-chip">
                    {g.label}
                  </span>
                ))}
                {canEnrich && (
                  <button type="button" className="btn btn-icon enrich-btn" title={enrichLabel} aria-label={enrichLabel} onClick={() => void enrich()}>
                    <Icon name="refresh" size={14} />
                  </button>
                )}
              </p>
              <StarRating value={t.rating} onChange={(v) => void rate(v)} label={`Sua nota para ${t.title}`} />
              {enrichMsg && <p className="muted small">{enrichMsg}</p>}
              {t.overview && <ClampText text={t.overview} />}
            </div>
          </div>
          </div>
          {(t.watchProvidersBR?.length || t.watchUrl) && (
            <>
              <h3 className="watch-head">
                Onde assistir no Brasil
                {/* TOS-REQ-38: crédito à JustWatch em cada exibição de onde assistir */}
                {(t.watchProvidersBR?.length ?? 0) > 0 && <span className="muted small watch-credit">via JustWatch</span>}
              </h3>
              <ProviderLogos providers={t.watchProvidersBR ?? []} link={{ title: t.title, titleLinks: t.resolution?.titleLinks, fallbackUrl: t.watchUrl }} />
              {t.watchUrl && (
                <p className="small">
                  <a href={t.watchUrl} target="_blank" rel="noopener noreferrer">
                    Ver todas as opções no TMDB
                  </a>
                </p>
              )}
            </>
          )}
          {t.kind === 'book' && t.bookUrl && (
            <>
              <h3>Onde encontrar</h3>
              <p>
                <a href={t.bookUrl} target="_blank" rel="noopener noreferrer">
                  Ver na Open Library
                </a>
              </p>
            </>
          )}
          <details className="advanced">
            <summary>Edição avançada</summary>
          <h3>Corrigir</h3>
          <CorrectTitleForm title={t} submit={(body) => api.correctTitle(t.id, body)} onDone={onClose} />
          <h3>Gêneros</h3>
          <div className="chips">
            {(taxonomy.data?.genres ?? []).map((g) => {
              const on = t.genres.some((x) => x.key === g.key);
              return (
                <button key={g.key} type="button" className={on ? 'chip chip-on' : 'chip'} aria-pressed={on} onClick={() => void toggleGenre(g.key)}>
                  {g.label}
                </button>
              );
            })}
          </div>
          <h3>Notas</h3>
          <textarea defaultValue={t.notes ?? ''} maxLength={500} rows={3} onBlur={(e) => void saveNotes(e.target.value.trim())} aria-label="Notas" />
          <p className="muted small">
            Confiança {Math.round(t.confidence * 100)}% · extração {t.extractor === 'llm' ? 'por IA' : 'heurística'} · dados{' '}
            {t.enrichment}
          </p>
          </details>
        </>
      )}
    </Modal>
  );
}

function CatalogRow({
  t,
  cols,
  draggable,
  selected,
  onToggle,
  onOpen,
  onPatch,
  onMove,
}: {
  t: Title;
  cols: CatalogColumns;
  draggable: boolean;
  selected: boolean;
  onToggle: () => void;
  onOpen: () => void;
  onPatch: (body: Parameters<typeof api.updateTitle>[1]) => void;
  onMove: (req: MoveTitleRequest) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: t.id, disabled: !draggable });
  const style = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.6 : undefined };
  return (
    <tr
      ref={setNodeRef}
      style={style}
      className={[selected ? 'row-selected' : '', t.rank === 1 ? 'rank-top' : ''].join(' ').trim() || undefined}
    >
      <td>
        <input type="checkbox" aria-label={`Selecionar ${t.title}`} checked={selected} onChange={onToggle} />
      </td>
      <td className="rank-cell">
        {t.rank == null ? (
          <span className="muted">—</span>
        ) : (
          <span className="rank-controls">
            {draggable && (
              <button type="button" className="drag-handle" aria-label={`Arrastar ${t.title}`} {...attributes} {...listeners}>
                <Icon name="grip" size={16} />
              </button>
            )}
            <strong className="rank-number">#{t.rank}</strong>
            <button type="button" className="btn btn-icon" aria-label={`Subir ${t.title}`} disabled={t.rank === 1} onClick={() => onMove({ to: 'up' })}>
              <Icon name="up" size={15} />
            </button>
            <button type="button" className="btn btn-icon" aria-label={`Descer ${t.title}`} onClick={() => onMove({ to: 'down' })}>
              <Icon name="down" size={15} />
            </button>
            <RankMenu title={t.title} onMove={onMove} />
          </span>
        )}
      </td>
      <td>
        <div className="title-cell">
          <Thumb src={t.posterUrl} title={t.title} />
          <div className="title-text">
            <button type="button" className="btn btn-link title-link" onClick={onOpen} title={t.title}>
              {t.title}
            </button>
            <div className="muted small title-meta" title={[t.year, t.creator].filter(Boolean).join(' · ')}>
              {[t.year, t.creator].filter(Boolean).join(' · ')}
              {t.decision === 'review_queue' && <span className="badge badge-review_queue">revisão</span>}
            </div>
          </div>
        </div>
      </td>
      {cols.kind && <td className="small">{kindLabel(t.kind)}</td>}
      {cols.genres && (
        <td>
          <GenreChips t={t} />
        </td>
      )}
      <td>
        <select className="status-select" data-status={t.status} aria-label={`Status de ${t.title}`} value={t.status} onChange={(e) => onPatch({ status: e.target.value as TitleStatus })}>
          {STATUSES.map((st) => (
            <option key={st} value={st}>
              {STATUS_LABEL[st]}
            </option>
          ))}
        </select>
      </td>
      <td>
        <select
          className="rating-select"
          aria-label={`Nota de ${t.title}`}
          value={t.rating ?? ''}
          onChange={(e) => onPatch({ rating: e.target.value ? Number(e.target.value) : null })}
        >
          <option value="">—</option>
          {RATINGS.map((n) => (
            <option key={n} value={n}>
              {ratingText(n)}
            </option>
          ))}
        </select>
      </td>
      {cols.origin && (
        <td className="small origin-cell">
          <div className="ellipsis" title={t.lists.map((l) => l.name).join(', ') || undefined}>
            {t.lists.map((l) => l.name).join(', ') || <span className="muted">sem lista</span>}
          </div>
          <div className="ellipsis">
            {t.shareId ? (
              <Link to={`/atividade/${t.shareId}`}>compartilhamento</Link>
            ) : (
              <span className="muted">{t.enrichment === 'demo' ? 'demo' : 'manual'}</span>
            )}
          </div>
        </td>
      )}
    </tr>
  );
}

function GenreChips({ t }: { t: Title }) {
  if (!t.genres.length) return <span className="muted">—</span>;
  return (
    <span className="genre-chips">
      {t.genres.slice(0, 2).map((g) => (
        <span key={g.key} className="genre-chip">
          {g.label}
        </span>
      ))}
      {t.genres.length > 2 && (
        <span className="genre-chip genre-chip-more" title={t.genres.slice(2).map((g) => g.label).join(', ')}>
          +{t.genres.length - 2}
        </span>
      )}
    </span>
  );
}

/** Card do catálogo no celular: pôster, #N em destaque, status/nota e controles de fila com alvos de 44px. */
function CatalogCard({
  t,
  draggable,
  selected,
  onToggle,
  onOpen,
  onPatch,
  onMove,
}: {
  t: Title;
  draggable: boolean;
  selected: boolean;
  onToggle: () => void;
  onOpen: () => void;
  onPatch: (body: Parameters<typeof api.updateTitle>[1]) => void;
  onMove: (req: MoveTitleRequest) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: t.id, disabled: !draggable });
  const style = { transform: CSS.Transform.toString(transform), transition };
  const cls = ['catalog-card', selected ? 'is-selected' : '', t.rank === 1 ? 'rank-top' : '', isDragging ? 'dragging' : '']
    .filter(Boolean)
    .join(' ');
  return (
    <li ref={setNodeRef} style={style} className={cls}>
      <div className="cc-top">
        <label className="cc-check">
          <input type="checkbox" aria-label={`Selecionar ${t.title}`} checked={selected} onChange={onToggle} />
        </label>
        <button type="button" className="cc-poster" onClick={onOpen} aria-label={`Abrir ${t.title}`} tabIndex={-1}>
          <Thumb src={t.posterUrl} title={t.title} width={56} height={84} />
        </button>
        <div className="cc-main">
          <div className="cc-rankline">
            {t.rank == null ? <span className="badge badge-review_queue">revisão</span> : <strong className="rank-number">#{t.rank}</strong>}
            <span className="muted small">{[kindLabel(t.kind), t.year].filter(Boolean).join(' · ')}</span>
          </div>
          <button type="button" className="btn btn-link title-link cc-title" onClick={onOpen}>
            {t.title}
          </button>
          {t.creator && <div className="muted small ellipsis">{t.creator}</div>}
          <GenreChips t={t} />
        </div>
      </div>
      <div className="cc-bottom">
        <select className="status-select" data-status={t.status} aria-label={`Status de ${t.title}`} value={t.status} onChange={(e) => onPatch({ status: e.target.value as TitleStatus })}>
          {STATUSES.map((st) => (
            <option key={st} value={st}>
              {STATUS_LABEL[st]}
            </option>
          ))}
        </select>
        <select
          className="rating-select"
          aria-label={`Nota de ${t.title}`}
          value={t.rating ?? ''}
          onChange={(e) => onPatch({ rating: e.target.value ? Number(e.target.value) : null })}
        >
          <option value="">—</option>
          {RATINGS.map((n) => (
            <option key={n} value={n}>
              {ratingText(n)}
            </option>
          ))}
        </select>
        {t.rank != null && (
          <span className="rank-controls cc-rank">
            {draggable && (
              <button type="button" className="drag-handle" aria-label={`Arrastar ${t.title}`} {...attributes} {...listeners}>
                <Icon name="grip" size={18} />
              </button>
            )}
            <button type="button" className="btn btn-icon" aria-label={`Subir ${t.title}`} disabled={t.rank === 1} onClick={() => onMove({ to: 'up' })}>
              <Icon name="up" size={17} />
            </button>
            <button type="button" className="btn btn-icon" aria-label={`Descer ${t.title}`} onClick={() => onMove({ to: 'down' })}>
              <Icon name="down" size={17} />
            </button>
            <RankMenu title={t.title} onMove={onMove} />
          </span>
        )}
      </div>
    </li>
  );
}

/** Menu da fila: topo, fim e "ir para posição…" (dropdown acessível: Esc/clique fora fecham). */
function RankMenu({ title, onMove }: { title: string; onMove: (req: MoveTitleRequest) => void }) {
  const [position, setPosition] = useState('');
  return (
    <Menu label={`Mais opções de prioridade de ${title}`} triggerClassName="btn btn-icon" trigger={<Icon name="more" size={16} />}>
      {(close) => (
        <>
          <div className="menu-head">Prioridade</div>
          <button
            type="button"
            className="menu-item"
            onClick={() => {
              close();
              onMove({ to: 'top' });
            }}
          >
            <Icon name="top" /> Mover para o topo
          </button>
          <button
            type="button"
            className="menu-item"
            onClick={() => {
              close();
              onMove({ to: 'bottom' });
            }}
          >
            <Icon name="bottom" /> Mover para o fim
          </button>
          <div className="menu-sep" />
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const n = Number(position);
              if (Number.isInteger(n) && n >= 1) {
                close();
                onMove({ position: n });
              }
            }}
          >
            <input
              type="number"
              min={1}
              inputMode="numeric"
              aria-label={`Posição para ${title}`}
              placeholder="Ir para posição…"
              value={position}
              onChange={(e) => setPosition(e.target.value)}
            />
            <button type="submit" className="btn">
              Ir
            </button>
          </form>
        </>
      )}
    </Menu>
  );
}
