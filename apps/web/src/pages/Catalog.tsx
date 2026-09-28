import { type BulkOperation, JUSTWATCH_ATTRIBUTION, type RecommendationKind, TMDB_ATTRIBUTION, type Title, type TitleStatus, type WatchProvider } from '@fruiqo/contracts';
import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router';
import { api, type LibraryFilters } from '../api/client';
import { CorrectTitleForm, ErrorNote, Modal, useTaxonomy } from '../components/shared';
import { useToast } from '../components/Toast';
import { KIND_LABEL, KINDS, PRIORITY_LABEL, STATUS_LABEL, STATUSES } from '../labels';

const FILTER_KEYS = ['q', 'kind', 'status', 'genre', 'priority', 'listId', 'shareId', 'review', 'sort'] as const;

function filtersFromParams(params: URLSearchParams): LibraryFilters {
  const f: Record<string, string> = {};
  for (const k of FILTER_KEYS) {
    const v = params.get(k);
    if (v) f[k] = v;
  }
  return {
    ...f,
    priority: f.priority !== undefined ? Number(f.priority) : undefined,
  } as LibraryFilters;
}

export function Catalog() {
  const [params, setParams] = useSearchParams();
  const filters = useMemo(() => filtersFromParams(params), [params]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [openId, setOpenId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const qc = useQueryClient();
  const toast = useToast();

  const taxonomy = useTaxonomy();
  const lists = useQuery({ queryKey: ['lists'], queryFn: api.lists });
  const library = useInfiniteQuery({
    queryKey: ['library', filters],
    queryFn: ({ pageParam }) => api.library({ ...filters, limit: 100 }, pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
  const items = useMemo(() => library.data?.pages.flatMap((p) => p.items) ?? [], [library.data]);

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
    <section>
      <div className="page-head">
        <h1>Catálogo</h1>
        <button type="button" className="btn btn-primary" onClick={() => setAdding(true)}>
          Adicionar título
        </button>
      </div>

      <div className="filters" role="search">
        <input
          aria-label="Buscar por título"
          placeholder="Buscar título…"
          defaultValue={filters.q ?? ''}
          onChange={(e) => setFilter('q', e.target.value.trim())}
        />
        <select aria-label="Tipo" value={filters.kind ?? ''} onChange={(e) => setFilter('kind', e.target.value)}>
          <option value="">Todos os tipos</option>
          {KINDS.map((k) => (
            <option key={k} value={k}>
              {KIND_LABEL[k]}
            </option>
          ))}
        </select>
        <select aria-label="Status" value={filters.status ?? ''} onChange={(e) => setFilter('status', e.target.value)}>
          <option value="">Todos os status</option>
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {STATUS_LABEL[s]}
            </option>
          ))}
        </select>
        <select aria-label="Gênero" value={filters.genre ?? ''} onChange={(e) => setFilter('genre', e.target.value)}>
          <option value="">Todos os gêneros</option>
          {genres.map((g) => (
            <option key={g.key} value={g.key}>
              {g.label}
            </option>
          ))}
        </select>
        <select
          aria-label="Prioridade"
          value={filters.priority === undefined ? '' : String(filters.priority)}
          onChange={(e) => setFilter('priority', e.target.value)}
        >
          <option value="">Toda prioridade</option>
          {PRIORITY_LABEL.map((p, i) => (
            <option key={p} value={i}>
              {p}
            </option>
          ))}
        </select>
        <select aria-label="Lista" value={filters.listId ?? ''} onChange={(e) => setFilter('listId', e.target.value)}>
          <option value="">Todas as listas</option>
          {(lists.data ?? []).map((l) => (
            <option key={l.id} value={l.id}>
              {l.name}
            </option>
          ))}
        </select>
        <select aria-label="Ordenar" value={filters.sort ?? 'priority'} onChange={(e) => setFilter('sort', e.target.value)}>
          <option value="priority">Prioridade</option>
          <option value="recent">Mais recentes</option>
          <option value="title">Título</option>
        </select>
        <label className="check">
          <input
            type="checkbox"
            checked={filters.review === 'pending'}
            onChange={(e) => setFilter('review', e.target.checked ? 'pending' : '')}
          />
          Pendentes de revisão
        </label>
        {filters.shareId && (
          <button type="button" className="chip" onClick={() => setFilter('shareId', '')}>
            Fonte: 1 compartilhamento ×
          </button>
        )}
      </div>

      {selected.size > 0 && (
        <BulkBar
          count={selected.size}
          lists={lists.data ?? []}
          genres={genres}
          onRun={runBulk}
          onClear={() => setSelected(new Set())}
        />
      )}

      <ErrorNote error={library.error} />
      <table className="table">
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
            <th>Título</th>
            <th>Tipo</th>
            <th>Gêneros</th>
            <th>Status</th>
            <th>Prioridade</th>
            <th>Nota</th>
            <th>Listas</th>
            <th>Fonte</th>
          </tr>
        </thead>
        <tbody>
          {items.map((t) => (
            <tr key={t.id} className={selected.has(t.id) ? 'row-selected' : undefined}>
              <td>
                <input type="checkbox" aria-label={`Selecionar ${t.title}`} checked={selected.has(t.id)} onChange={() => toggle(t.id)} />
              </td>
              <td>
                <button type="button" className="btn btn-link title-link" onClick={() => setOpenId(t.id)}>
                  {t.title}
                </button>
                <div className="muted small">
                  {[t.year, t.creator].filter(Boolean).join(' · ')}
                  {t.decision === 'review_queue' && <span className="badge badge-review_queue">revisão</span>}
                </div>
              </td>
              <td>{KIND_LABEL[t.kind]}</td>
              <td className="small">{t.genres.map((g) => g.label).join(', ') || <span className="muted">—</span>}</td>
              <td>
                <select
                  aria-label={`Status de ${t.title}`}
                  value={t.status}
                  onChange={(e) => void patch(t, { status: e.target.value as TitleStatus })}
                >
                  {STATUSES.map((s) => (
                    <option key={s} value={s}>
                      {STATUS_LABEL[s]}
                    </option>
                  ))}
                </select>
              </td>
              <td>
                <select
                  aria-label={`Prioridade de ${t.title}`}
                  value={t.priority}
                  onChange={(e) => void patch(t, { priority: Number(e.target.value) })}
                >
                  {PRIORITY_LABEL.map((p, i) => (
                    <option key={p} value={i}>
                      {p}
                    </option>
                  ))}
                </select>
              </td>
              <td>
                <select
                  aria-label={`Nota de ${t.title}`}
                  value={t.rating ?? ''}
                  onChange={(e) => void patch(t, { rating: e.target.value ? Number(e.target.value) : null })}
                >
                  <option value="">—</option>
                  {[1, 2, 3, 4, 5].map((n) => (
                    <option key={n} value={n}>
                      {'★'.repeat(n)}
                    </option>
                  ))}
                </select>
              </td>
              <td className="small">{t.lists.map((l) => l.name).join(', ') || <span className="muted">—</span>}</td>
              <td className="small">
                {t.shareId ? (
                  <Link to={`/atividade/${t.shareId}`}>compartilhamento</Link>
                ) : (
                  <span className="muted">{t.enrichment === 'demo' ? 'demo' : 'manual'}</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {!library.isLoading && items.length === 0 && <p className="muted empty">Nenhum título com esses filtros.</p>}
      {library.hasNextPage && (
        <button type="button" className="btn" onClick={() => void library.fetchNextPage()} disabled={library.isFetchingNextPage}>
          Carregar mais
        </button>
      )}

      {openId && <TitleDetail id={openId} onClose={() => setOpenId(null)} />}
      {adding && <AddTitle onClose={() => setAdding(false)} />}
    </section>
  );
}

function BulkBar({
  count,
  lists,
  genres,
  onRun,
  onClear,
}: {
  count: number;
  lists: { id: string; name: string }[];
  genres: { key: string; label: string }[];
  onRun: (op: BulkOperation, label: string) => void;
  onClear: () => void;
}) {
  const [listId, setListId] = useState('');
  const [fromListId, setFromListId] = useState('');
  const [genre, setGenre] = useState('');
  return (
    <div className="bulkbar" role="region" aria-label="Ações em massa">
      <strong>{count} selecionado(s)</strong>
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
        <select
          aria-label="Definir prioridade"
          value=""
          onChange={(e) => e.target.value && onRun({ type: 'set_priority', priority: Number(e.target.value) }, 'Prioridade alterada')}
        >
          <option value="">Prioridade…</option>
          {PRIORITY_LABEL.map((p, i) => (
            <option key={p} value={i}>
              {p}
            </option>
          ))}
        </select>
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
      <button type="button" className="btn btn-link" onClick={onClear}>
        Limpar seleção
      </button>
    </div>
  );
}

const ENRICH_MSG: Record<'enriched' | 'no_match' | 'unsupported' | 'unavailable', string> = {
  enriched: 'Dados atualizados.',
  no_match: 'Nada encontrado no TMDB com este título. Corrija o título ou o ano e tente de novo.',
  unsupported: 'Só filmes e séries são buscados no TMDB.',
  unavailable: 'TMDB indisponível agora.',
};

const PROVIDER_TYPE: Record<WatchProvider['type'], string> = { flatrate: 'Assinatura', rent: 'Aluguel', buy: 'Compra' };

/** Um logo por serviço e tipo (o TMDB repete variantes como "com anúncios"). */
export function ProviderLogos({ providers }: { providers: WatchProvider[] }) {
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
          {list.map((p) =>
            p.logoUrl ? (
              <img key={p.name} src={p.logoUrl} alt={p.name} title={p.name} width={32} height={32} className="provider-logo" />
            ) : (
              <span key={p.name} className="provider-name">
                {p.name}
              </span>
            ),
          )}
        </div>
      ))}
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
          <div className="title-head">
            {t.posterUrl && <img className="poster" src={t.posterUrl} alt="" width={92} height={138} />}
            <div>
              {t.overview && <p className="overview">{t.overview}</p>}
              {(t.kind === 'movie' || t.kind === 'series') && (
                <p className="small">
                  <button type="button" className="btn" onClick={() => void enrich()}>
                    {t.enrichment === 'tmdb' ? 'Atualizar dados do TMDB' : 'Buscar no TMDB'}
                  </button>{' '}
                  {enrichMsg && <span className="muted">{enrichMsg}</span>}
                </p>
              )}
            </div>
          </div>
          {(t.watchProvidersBR?.length || t.watchUrl) && (
            <>
              <h3>Onde assistir no Brasil</h3>
              <ProviderLogos providers={t.watchProvidersBR ?? []} />
              {t.watchUrl && (
                <p>
                  <a href={t.watchUrl} target="_blank" rel="noopener noreferrer">
                    Onde assistir (TMDB)
                  </a>
                </p>
              )}
              <p className="muted small">{JUSTWATCH_ATTRIBUTION}</p>
            </>
          )}
          {t.resolution?.provider === 'tmdb' && <p className="muted small">Dados de filmes e séries: TMDB. {TMDB_ATTRIBUTION}</p>}
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
        </>
      )}
    </Modal>
  );
}

function AddTitle({ onClose }: { onClose: () => void }) {
  const lists = useQuery({ queryKey: ['lists'], queryFn: api.lists });
  const qc = useQueryClient();
  const [title, setTitle] = useState('');
  const [kind, setKind] = useState<RecommendationKind>('movie');
  const [year, setYear] = useState('');
  const [listId, setListId] = useState('');
  const [error, setError] = useState<unknown>(null);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    try {
      await api.createTitle({
        title: title.trim(),
        kind,
        year: year ? Number(year) : undefined,
        listId: listId || undefined,
      });
      await qc.invalidateQueries();
      onClose();
    } catch (err) {
      setError(err);
    }
  }

  return (
    <Modal title="Adicionar título" onClose={onClose}>
      <form className="form" onSubmit={onSubmit}>
        <label>
          Título
          <input value={title} onChange={(e) => setTitle(e.target.value)} required maxLength={200} />
        </label>
        <div className="row">
          <label>
            Tipo
            <select value={kind} onChange={(e) => setKind(e.target.value as RecommendationKind)}>
              {KINDS.map((k) => (
                <option key={k} value={k}>
                  {KIND_LABEL[k]}
                </option>
              ))}
            </select>
          </label>
          <label>
            Ano
            <input value={year} onChange={(e) => setYear(e.target.value.replace(/\D/g, '').slice(0, 4))} inputMode="numeric" />
          </label>
        </div>
        <label>
          Lista (opcional)
          <select value={listId} onChange={(e) => setListId(e.target.value)}>
            <option value="">Nenhuma</option>
            {(lists.data ?? []).map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </select>
        </label>
        <ErrorNote error={error} />
        <div className="actions">
          <button type="button" className="btn" onClick={onClose}>
            Cancelar
          </button>
          <button type="submit" className="btn btn-primary">
            Adicionar
          </button>
        </div>
      </form>
    </Modal>
  );
}
