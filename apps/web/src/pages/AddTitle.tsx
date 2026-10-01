// RF-46: incluir título por busca inteligente. Campo único (nome, nome + ano, ator/diretor, gênero/década
// ou descrição) → candidatos com pôster para marcar → Minha Área como Quero assistir (D-23, sem revisão).
// A aba "Descrever com IA" (D-24) acha o filme/série pelo que você lembra dele; a aba "Manual" cobre o
// que a busca não resolve (músicas, livros, títulos fora do TMDB).
import {
  AI_DESCRIBE_MAX_CHARS,
  tmdbPageUrl,
  type RecommendationKind,
  type TitleSearchResponse,
  type TitleSearchResult,
  type TitleStatus,
} from '@fruiqo/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { Link } from 'react-router';
import { api } from '../api/client';
import { ErrorNote, Modal } from '../components/shared';
import { useToast } from '../components/Toast';
import { Icon, Thumb, WorkLink } from '../components/ui';
import { AI_UNAVAILABLE, kindLabel, KINDS, scoreText, SEARCH_SORT_LABEL, type SearchSort } from '../labels';

const SEARCH_DEBOUNCE_MS = 400;

/** Atraso simples para não disparar uma busca por tecla. */
export function useDebounced<T>(value: T, ms = SEARCH_DEBOUNCE_MS): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

const INTERPRETED_LABEL = {
  title: 'por título',
  person: 'por pessoa',
  genre: 'por gênero/década',
  description: 'por descrição',
  browse: 'no TMDB',
} as const;

type KindFilter = '' | 'movie' | 'series' | 'book';

/** Resultado normalizado: filmes/séries (TMDB) e livros (Open Library, RF-48) na mesma lista. */
export interface SearchPick {
  key: string;
  kind: RecommendationKind;
  title: string;
  originalTitle?: string;
  year?: number;
  posterUrl?: string;
  /** elenco ou autores */
  people: string[];
  overview?: string;
  inLibrary: { rank: number | null; decision: 'cataloged' | 'review_queue'; status?: TitleStatus; rating?: number | null } | null;
  ref: { tmdbId: number; mediaType: 'movie' | 'tv' } | { olWorkId: string };
  /** página da obra para conferir antes de incluir (TMDB ou Open Library), em aba nova */
  page?: { url: string; label: string };
  /** D-23: nota geral no TMDB (0..10) e automática (0..5, pelo seu gosto) */
  generalRating?: number;
  autoRating?: number;
  /** D-24: por que a IA achou que é esse */
  aiReason?: string;
}

export function mediaPick(r: TitleSearchResult & { aiReason?: string }): SearchPick {
  return {
    key: `${r.mediaType}:${r.tmdbId}`,
    kind: r.kind,
    title: r.title,
    originalTitle: r.originalTitle,
    year: r.year,
    posterUrl: r.posterUrl,
    people: r.cast,
    overview: r.overview,
    inLibrary: r.inLibrary,
    ref: { tmdbId: r.tmdbId, mediaType: r.mediaType },
    page: { url: tmdbPageUrl(r.mediaType, r.tmdbId), label: 'TMDB' },
    generalRating: r.generalRating,
    autoRating: r.autoRating,
    ...(r.aiReason ? { aiReason: r.aiReason } : {}),
  };
}

export function searchPicks(data: TitleSearchResponse | undefined): SearchPick[] {
  if (!data) return [];
  const media = data.items.map(mediaPick);
  const books: SearchPick[] = (data.books ?? []).map((b) => ({
    key: `ol:${b.olWorkId}`,
    kind: 'book',
    title: b.title,
    year: b.year,
    posterUrl: b.coverUrl,
    people: b.authors,
    inLibrary: b.inLibrary,
    ref: { olWorkId: b.olWorkId },
    page: { url: b.url, label: 'Open Library' },
  }));
  return [...media, ...books];
}

/**
 * Busca de títulos no catálogo (TMDB). `mode="import"` permite marcar vários e importar;
 * `mode="pick"` devolve um único resultado (usado para adicionar favoritos no perfil).
 */
export function TitleSearch({
  mode,
  onPick,
  selected,
  onToggle,
  autoFocus = true,
  allowTaken = false,
}: {
  mode: 'import' | 'pick';
  onPick?: (r: SearchPick) => void;
  selected?: Set<string>;
  onToggle?: (r: SearchPick) => void;
  autoFocus?: boolean;
  /** marcar mesmo o que já está na Minha Área (ex.: favoritos) */
  allowTaken?: boolean;
}) {
  const [text, setText] = useState('');
  const [kind, setKind] = useState<KindFilter>('');
  // "Buscar com IA": o pedido vai inteiro para a IA ("filme recente de faroeste"); livros seguem sem IA
  const [useAi, setUseAi] = useState(false);
  const aiParam = useAi && kind !== 'book' ? ('1' as const) : undefined;
  const q = useDebounced(text.trim());
  // D-23: vazio = padrão do servidor (sua ordem; na busca por nome, relevância)
  const [sort, setSort] = useState<SearchSort | ''>('');
  const search = useQuery({
    queryKey: ['search-titles', q, kind, aiParam, sort],
    queryFn: () => api.searchTitles({ q, kind: kind || undefined, ...(aiParam ? { ai: aiParam } : {}), ...(sort ? { sort } : {}) }),
    enabled: q.length >= 2,
    staleTime: 60_000,
  });
  const data = search.data;
  const interpreted = data?.interpreted;
  const results = searchPicks(data);
  const hasBooks = (data?.books?.length ?? 0) > 0;

  return (
    <div className="title-search">
      <div className="row search-row">
        <label className="grow">
          <span className="sr-only">Buscar filme, série ou livro</span>
          <input
            type="search"
            className="search-input"
            // RF-45: foco no campo ao abrir (o Modal foca o primeiro campo)
            placeholder='Nome, "Wagner Moura", "melhor série da Netflix", uma descrição ou o link do TMDB'
            autoFocus={autoFocus}
            value={text}
            onChange={(e) => setText(e.target.value)}
            maxLength={200}
            aria-label="Buscar filme, série ou livro"
          />
        </label>
        <label>
          <span className="sr-only">Tipo</span>
          <select value={kind} onChange={(e) => setKind(e.target.value as KindFilter)} aria-label="Tipo da busca">
            <option value="">Tudo (filmes, séries e livros)</option>
            <option value="movie">Só filmes</option>
            <option value="series">Só séries</option>
            <option value="book">Só livros</option>
          </select>
        </label>
        <label>
          <span className="sr-only">Ordenar resultados</span>
          <select value={sort || interpreted?.sort || ''} onChange={(e) => setSort(e.target.value as SearchSort)} aria-label="Ordenar resultados">
            {!interpreted?.sort && <option value="">Ordem padrão</option>}
            {(Object.keys(SEARCH_SORT_LABEL) as SearchSort[]).map((k) => (
              <option key={k} value={k}>
                {SEARCH_SORT_LABEL[k]}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          className={useAi ? 'chip chip-on search-ai' : 'chip search-ai'}
          aria-pressed={useAi}
          disabled={kind === 'book'}
          title="Pedido livre, interpretado pela IA (ex.: filme recente de faroeste)"
          onClick={() => setUseAi((v) => !v)}
        >
          <Icon name="sparkles" size={14} /> Buscar com IA
        </button>
      </div>

      {interpreted && (
        <p className="muted small search-interpreted" role="status">
          Buscando {INTERPRETED_LABEL[interpreted.type]}
          {interpreted.person ? `: ${interpreted.person}` : ''}
          {interpreted.year ? ` · ano ${interpreted.year}` : ''}
          {interpreted.decade ? ` · anos ${String(interpreted.decade).slice(2)}` : ''}
          {interpreted.labels?.length
            ? ` · ${interpreted.labels.join(', ')}`
            : interpreted.genres.length > 0
              ? ` · ${interpreted.genres.map((g) => g.label).join(', ')}`
              : ''}
          {interpreted.aiUnavailable && (
            <span className="note-inline">
              {' '}
              · IA desligada: fiz a busca normal (ligue a IA em <Link to="/perfil">Perfil</Link>)
            </span>
          )}
          {interpreted.type === 'description' &&
            (interpreted.aiUsed ? (
              <span className="badge badge-ai">
                <Icon name="sparkles" size={12} /> interpretado com IA
              </span>
            ) : (
              <span className="note-inline">
                {' '}
                · IA não usada: busca por palavras-chave{useAi ? <> (ligue a IA em <Link to="/perfil">Perfil</Link>)</> : null}
              </span>
            ))}
        </p>
      )}
      <ErrorNote error={search.error} />
      {search.isFetching && <p className="muted small">Buscando…</p>}
      {q.length >= 2 && data && results.length === 0 && !search.isFetching && (
        <p className="muted">Nada encontrado. Tente outro nome, o ano ou use a aba "Manual".</p>
      )}
      {/* a busca mista espera a Open Library por pouco tempo; se ela demorar, os livros não vêm */}
      {kind === '' && q.length >= 2 && data && !hasBooks && !search.isFetching && (
        <p className="muted small">
          Procurando um livro?{' '}
          <button type="button" className="btn-link" onClick={() => setKind('book')}>
            Buscar só livros
          </button>
        </p>
      )}

      <PickResults results={results} mode={mode} selected={selected} onToggle={onToggle} onPick={onPick} allowTaken={allowTaken} />
      {hasBooks && (
        <p className="attribution small">
          Dados de livros:{' '}
          <a href="https://openlibrary.org" target="_blank" rel="noreferrer">
            Open Library
          </a>
          .
        </p>
      )}
    </div>
  );
}

/** Lista de resultados com pôster: marcar vários (`import`) ou escolher um (`pick`). */
function PickResults({
  results,
  mode,
  selected,
  onToggle,
  onPick,
  allowTaken = false,
}: {
  results: SearchPick[];
  mode: 'import' | 'pick';
  selected?: Set<string>;
  onToggle?: (r: SearchPick) => void;
  onPick?: (r: SearchPick) => void;
  allowTaken?: boolean;
}) {
  return (
    <ul className="search-results" aria-label="Resultados da busca">
      {results.map((r) => {
        const key = r.key;
        // D-23: já no Catálogo (ou abandonado) ainda pode ir para a Minha Área
        const taken = r.inLibrary !== null && r.inLibrary.status !== 'catalog' && r.inLibrary.status !== 'dropped';
        const checked = selected?.has(key) ?? false;
        return (
          <li key={key} className={checked ? 'search-card selected' : 'search-card'}>
            <WorkLink href={r.page?.url} label={`Ver ${r.title} no ${r.page?.label}`} className="work-link-thumb">
              <Thumb src={r.posterUrl} title={r.title} width={54} height={81} />
            </WorkLink>
            <div className="grow">
              <WorkLink href={r.page?.url} label={`Ver ${r.title} no ${r.page?.label}`}>
                <strong>{r.title}</strong>
                {r.page && <Icon name="external" size={13} className="work-ext-icon" />}
              </WorkLink>
              <div className="muted small">
                {[
                  kindLabel(r.kind),
                  r.year,
                  r.inLibrary?.rating != null ? `você ${scoreText(r.inLibrary.rating)}★` : null,
                  r.autoRating != null ? `auto ${scoreText(r.autoRating)}` : null,
                  r.generalRating != null ? `TMDB ${scoreText(r.generalRating)}` : null,
                ]
                  .filter(Boolean)
                  .join(' · ')}
                {r.originalTitle && r.originalTitle !== r.title ? ` · ${r.originalTitle}` : ''}
              </div>
              {r.people.length > 0 && (
                <div className="small">
                  {r.kind === 'book' ? 'de' : 'com'} {r.people.join(', ')}
                </div>
              )}
              {r.aiReason && (
                <p className="small ai-reason">
                  <Icon name="sparkles" size={12} /> {r.aiReason}
                </p>
              )}
              {r.overview && <p className="small clamp-2">{r.overview}</p>}
              {r.inLibrary && (
                <span className="badge">
                  {taken
                    ? `já está na Minha Área${r.inLibrary.rank ? ` (#${r.inLibrary.rank})` : ''}`
                    : 'no seu catálogo'}
                </span>
              )}
            </div>
            {mode === 'import' ? (
              <label className="check search-check">
                <input
                  type="checkbox"
                  checked={checked}
                  disabled={taken && !allowTaken}
                  onChange={() => onToggle?.(r)}
                  aria-label={`Selecionar ${r.title}${r.year ? ` (${r.year})` : ''}`}
                />
              </label>
            ) : (
              <button type="button" className="btn" onClick={() => onPick?.(r)}>
                Escolher
              </button>
            )}
          </li>
        );
      })}
    </ul>
  );
}

export function AddTitle({ onClose }: { onClose: () => void }) {
  const [tab, setTab] = useState<'search' | 'describe' | 'manual'>('search');
  return (
    <Modal title="Adicionar título" onClose={onClose}>
      <div className="tabs" role="tablist" aria-label="Como adicionar">
        <button type="button" role="tab" aria-selected={tab === 'search'} className={tab === 'search' ? 'tab active' : 'tab'} onClick={() => setTab('search')}>
          <Icon name="search" size={14} /> Buscar
        </button>
        <button type="button" role="tab" aria-selected={tab === 'describe'} className={tab === 'describe' ? 'tab active' : 'tab'} onClick={() => setTab('describe')}>
          <Icon name="sparkles" size={14} /> Descrever com IA
        </button>
        <button type="button" role="tab" aria-selected={tab === 'manual'} className={tab === 'manual' ? 'tab active' : 'tab'} onClick={() => setTab('manual')}>
          <Icon name="plus" size={14} /> Manual
        </button>
      </div>
      {tab === 'search' ? <SearchImport onClose={onClose} /> : tab === 'describe' ? <DescribeImport onClose={onClose} /> : <ManualAdd onClose={onClose} />}
    </Modal>
  );
}

/** Busca + "Quero assistir"/"Próximo a assistir". `inline`: embutida no Catálogo (sem fechar). */
export function SearchImport({ onClose, inline = false }: { onClose?: () => void; inline?: boolean }) {
  return (
    <PickImport onClose={onClose} inline={inline}>
      {(selected, toggle) => <TitleSearch mode="import" selected={selected} onToggle={toggle} autoFocus={!inline} />}
    </PickImport>
  );
}

/** D-24: descreva o filme/série com suas palavras; a IA sugere, o TMDB confirma e você marca. */
function DescribeImport({ onClose }: { onClose: () => void }) {
  return <PickImport onClose={onClose}>{(selected, toggle) => <DescribeSearch selected={selected} onToggle={toggle} />}</PickImport>;
}

export function DescribeSearch({ selected, onToggle }: { selected: Set<string>; onToggle: (r: SearchPick) => void }) {
  const settings = useQuery({ queryKey: ['settings'], queryFn: api.settings });
  const [text, setText] = useState('');
  const [kind, setKind] = useState<'' | 'movie' | 'series'>('');
  const ask = useMutation({ mutationFn: () => api.aiFindTitles({ mode: 'describe', text: text.trim(), ...(kind ? { kind } : {}) }) });
  const aiOn = Boolean(settings.data?.aiConsent && settings.data?.aiAvailable);
  const data = ask.data;
  const results = (data?.items ?? []).map(mediaPick);
  const canAsk = aiOn && text.trim().length >= 2 && !ask.isPending;

  function submit(e?: FormEvent) {
    e?.preventDefault();
    if (canAsk) ask.mutate();
  }

  return (
    <div className="title-search">
      <form className="describe-form" onSubmit={submit}>
        <label>
          O que você lembra ou ouviu falar
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) submit();
            }}
            maxLength={AI_DESCRIBE_MAX_CHARS}
            rows={4}
            autoFocus
            placeholder="Ex.: um suspense em que um cara recebe ligações de alguém que está vigiando ele de longe; ouvi que tem um final surpreendente"
          />
        </label>
        <div className="row describe-actions">
          <label>
            <span className="sr-only">Tipo</span>
            <select value={kind} onChange={(e) => setKind(e.target.value as '' | 'movie' | 'series')} aria-label="Tipo">
              <option value="">Filmes e séries</option>
              <option value="movie">Só filmes</option>
              <option value="series">Só séries</option>
            </select>
          </label>
          <span className="muted small grow">
            {text.length}/{AI_DESCRIBE_MAX_CHARS}
          </span>
          <button type="submit" className="btn btn-primary" disabled={!canAsk} aria-busy={ask.isPending}>
            <Icon name="sparkles" size={14} /> {ask.isPending ? 'Perguntando…' : 'Perguntar à IA'}
          </button>
        </div>
      </form>
      {settings.data && !aiOn && (
        <p className="muted small" role="note">
          {settings.data.aiAvailable ? (
            <>
              Para descrever com IA, permita o uso da IA em <Link to="/perfil">Perfil</Link>. Só o texto que você digitar vai para a IA.
            </>
          ) : (
            'A IA está desligada no servidor; use a aba Buscar.'
          )}
        </p>
      )}
      <ErrorNote error={ask.error} />
      {data && !data.aiUsed && data.unavailable && <p className="muted small">{AI_UNAVAILABLE[data.unavailable]}</p>}
      {data?.aiUsed && results.length === 0 && data.notFound.length === 0 && (
        <p className="muted">A IA não reconheceu nenhum título. Tente dar mais detalhes (ator, época, cena marcante).</p>
      )}
      {data?.aiUsed && results.length > 0 && (
        <p className="muted small" role="status">
          <span className="badge badge-ai">
            <Icon name="sparkles" size={12} /> sugerido pela IA
          </span>{' '}
          confira e marque o certo
        </p>
      )}
      <PickResults results={results} mode="import" selected={selected} onToggle={onToggle} />
      {data && data.notFound.length > 0 && (
        <p className="muted small">
          A IA também citou, mas não encontrei no TMDB: {data.notFound.map((n) => (n.year ? `${n.title} (${n.year})` : n.title)).join(', ')}. Use a aba Manual se for um deles.
        </p>
      )}
    </div>
  );
}

/** Marcar títulos e mandar para a Minha Área ("Quero assistir"/"Próximo a assistir"), com lista opcional. */
function PickImport({
  onClose,
  inline = false,
  children,
}: {
  onClose?: () => void;
  inline?: boolean;
  children: (selected: Set<string>, toggle: (r: SearchPick) => void) => ReactNode;
}) {
  const lists = useQuery({ queryKey: ['lists'], queryFn: api.lists });
  const qc = useQueryClient();
  const toast = useToast();
  const [picked, setPicked] = useState<Map<string, SearchPick>>(new Map());
  const [listId, setListId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  function toggle(r: SearchPick) {
    const key = r.key;
    setPicked((m) => {
      const n = new Map(m);
      if (n.has(key)) n.delete(key);
      else n.set(key, r);
      return n;
    });
  }

  /** `next`: "Próximo a assistir" (vão para o topo da Minha Área, na ordem em que foram marcados) */
  async function send(next: boolean) {
    setBusy(true);
    setError(null);
    try {
      const refs = [...picked.values()].map((r) => r.ref);
      const books = refs.flatMap((r) => ('olWorkId' in r ? [{ olWorkId: r.olWorkId }] : []));
      const res = await api.importTitles({
        items: refs.flatMap((r) => ('tmdbId' in r ? [{ tmdbId: r.tmdbId, mediaType: r.mediaType }] : [])),
        ...(books.length ? { books } : {}),
        listId: listId || undefined,
      });
      // de trás para a frente: o primeiro marcado termina em 1º
      if (next) for (const t of [...res.created].reverse()) await api.updateTitle(t.id, { next: true });
      await qc.invalidateQueries();
      const n = res.created.length;
      const skipped = res.skipped.length + (res.skippedBooks?.length ?? 0);
      toast.show(
        `${n} título(s) na Minha Área${next ? ', no topo da fila' : ', como Quero assistir'}.${skipped ? ` ${skipped} já estava(m) lá.` : ''}`,
      );
      setPicked(new Map());
      if (!inline) onClose?.();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="form">
      {children(new Set(picked.keys()), toggle)}
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
      <div className="actions sticky-actions">
        <span className="muted small grow">{picked.size} selecionado(s)</span>
        <button type="button" className="btn" disabled={busy || picked.size === 0} onClick={() => void send(false)}>
          Quero assistir
        </button>
        <button type="button" className="btn btn-primary" disabled={busy || picked.size === 0} onClick={() => void send(true)}>
          Próximo a assistir
        </button>
      </div>
    </div>
  );
}

function ManualAdd({ onClose }: { onClose: () => void }) {
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
    <form className="form" onSubmit={onSubmit}>
      <p className="muted small">Para músicas, livros ou títulos que a busca não encontra. Entra direto na fila.</p>
      <label>
        Título
        <input value={title} onChange={(e) => setTitle(e.target.value)} required maxLength={200} autoFocus />
      </label>
      <div className="row">
        <label>
          Tipo
          <select value={kind} onChange={(e) => setKind(e.target.value as RecommendationKind)}>
            {KINDS.map((k) => (
              <option key={k} value={k}>
                {kindLabel(k)}
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
  );
}
