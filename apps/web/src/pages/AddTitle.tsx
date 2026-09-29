// RF-46: incluir título por busca inteligente. Campo único (nome, nome + ano, ator/diretor, gênero/década
// ou descrição) → candidatos com pôster para marcar → revisão (RF-42) ou "aprovar já".
// A aba "Manual" cobre o que a busca não resolve (músicas, livros, títulos fora do TMDB).
import { TMDB_ATTRIBUTION, type RecommendationKind, type TitleSearchResponse } from '@fruiqo/contracts';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState, type FormEvent } from 'react';
import { api } from '../api/client';
import { ErrorNote, Modal } from '../components/shared';
import { useToast } from '../components/Toast';
import { Icon, Thumb } from '../components/ui';
import { kindLabel, KINDS } from '../labels';

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
  inLibrary: { rank: number | null; decision: 'cataloged' | 'review_queue' } | null;
  ref: { tmdbId: number; mediaType: 'movie' | 'tv' } | { olWorkId: string };
}

export function searchPicks(data: TitleSearchResponse | undefined): SearchPick[] {
  if (!data) return [];
  const media: SearchPick[] = data.items.map((r) => ({
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
  }));
  const books: SearchPick[] = (data.books ?? []).map((b) => ({
    key: `ol:${b.olWorkId}`,
    kind: 'book',
    title: b.title,
    year: b.year,
    posterUrl: b.coverUrl,
    people: b.authors,
    inLibrary: b.inLibrary,
    ref: { olWorkId: b.olWorkId },
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
}: {
  mode: 'import' | 'pick';
  onPick?: (r: SearchPick) => void;
  selected?: Set<string>;
  onToggle?: (r: SearchPick) => void;
}) {
  const [text, setText] = useState('');
  const [kind, setKind] = useState<KindFilter>('');
  const q = useDebounced(text.trim());
  const search = useQuery({
    queryKey: ['search-titles', q, kind],
    queryFn: () => api.searchTitles({ q, kind: kind || undefined }),
    enabled: q.length >= 2,
    staleTime: 60_000,
  });
  const data = search.data;
  const interpreted = data?.interpreted;
  const results = searchPicks(data);
  const hasMedia = (data?.items.length ?? 0) > 0;
  const hasBooks = (data?.books?.length ?? 0) > 0;

  return (
    <div className="title-search">
      <div className="row search-row">
        <label className="grow">
          <span className="sr-only">Buscar filme, série ou livro</span>
          <input
            type="search"
            // RF-45: foco no campo ao abrir (o Modal foca o primeiro campo)
            placeholder='Nome, "Duna 2021", "Wagner Moura", "comédia anos 90" ou uma descrição'
            autoFocus
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
      </div>

      {interpreted && (
        <p className="muted small search-interpreted" role="status">
          Buscando {INTERPRETED_LABEL[interpreted.type]}
          {interpreted.person ? `: ${interpreted.person}` : ''}
          {interpreted.year ? ` · ano ${interpreted.year}` : ''}
          {interpreted.decade ? ` · anos ${String(interpreted.decade).slice(2)}` : ''}
          {interpreted.genres.length > 0 ? ` · ${interpreted.genres.map((g) => g.label).join(', ')}` : ''}
          {interpreted.type === 'description' &&
            (interpreted.aiUsed ? (
              <span className="badge badge-ai">
                <Icon name="sparkles" size={12} /> interpretado com IA
              </span>
            ) : (
              <span className="note-inline"> · IA indisponível: usando palavras-chave</span>
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

      <ul className="search-results" aria-label="Resultados da busca">
        {results.map((r) => {
          const key = r.key;
          const taken = r.inLibrary !== null;
          const checked = selected?.has(key) ?? false;
          return (
            <li key={key} className={checked ? 'search-card selected' : 'search-card'}>
              <Thumb src={r.posterUrl} title={r.title} width={54} height={81} />
              <div className="grow">
                <strong>{r.title}</strong>
                <div className="muted small">
                  {[kindLabel(r.kind), r.year].filter(Boolean).join(' · ')}
                  {r.originalTitle && r.originalTitle !== r.title ? ` · ${r.originalTitle}` : ''}
                </div>
                {r.people.length > 0 && (
                  <div className="small">
                    {r.kind === 'book' ? 'de' : 'com'} {r.people.join(', ')}
                  </div>
                )}
                {r.overview && <p className="small clamp-2">{r.overview}</p>}
                {taken && (
                  <span className="badge">
                    {r.inLibrary?.decision === 'review_queue'
                      ? 'já está na revisão'
                      : `já está na sua lista${r.inLibrary?.rank ? ` (#${r.inLibrary.rank})` : ''}`}
                  </span>
                )}
              </div>
              {mode === 'import' ? (
                <label className="check search-check">
                  <input
                    type="checkbox"
                    checked={checked}
                    disabled={taken}
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
      {hasMedia && <p className="attribution small">{TMDB_ATTRIBUTION}</p>}
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

export function AddTitle({ onClose }: { onClose: () => void }) {
  const [tab, setTab] = useState<'search' | 'manual'>('search');
  return (
    <Modal title="Adicionar título" onClose={onClose}>
      <div className="tabs" role="tablist" aria-label="Como adicionar">
        <button type="button" role="tab" aria-selected={tab === 'search'} className={tab === 'search' ? 'tab active' : 'tab'} onClick={() => setTab('search')}>
          <Icon name="search" size={14} /> Buscar
        </button>
        <button type="button" role="tab" aria-selected={tab === 'manual'} className={tab === 'manual' ? 'tab active' : 'tab'} onClick={() => setTab('manual')}>
          <Icon name="plus" size={14} /> Manual
        </button>
      </div>
      {tab === 'search' ? <SearchImport onClose={onClose} /> : <ManualAdd onClose={onClose} />}
    </Modal>
  );
}

function SearchImport({ onClose }: { onClose: () => void }) {
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

  async function send(approveNow: boolean) {
    setBusy(true);
    setError(null);
    try {
      const refs = [...picked.values()].map((r) => r.ref);
      const books = refs.flatMap((r) => ('olWorkId' in r ? [{ olWorkId: r.olWorkId }] : []));
      const res = await api.importTitles({
        items: refs.flatMap((r) => ('tmdbId' in r ? [{ tmdbId: r.tmdbId, mediaType: r.mediaType }] : [])),
        ...(books.length ? { books } : {}),
        approveNow: approveNow || undefined,
        listId: listId || undefined,
      });
      await qc.invalidateQueries();
      const n = res.created.length;
      const skipped = res.skipped.length + (res.skippedBooks?.length ?? 0);
      toast.show(
        approveNow
          ? `${n} título(s) aprovado(s) no encaixe sugerido.${skipped ? ` ${skipped} já estava(m) na lista.` : ''}`
          : `${n} título(s) enviado(s) para a Revisão.${skipped ? ` ${skipped} já estava(m) na lista.` : ''}`,
      );
      onClose();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="form">
      <TitleSearch mode="import" selected={new Set(picked.keys())} onToggle={toggle} />
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
        <button type="button" className="btn" disabled={busy || picked.size === 0} onClick={() => void send(true)}>
          Aprovar já
        </button>
        <button type="button" className="btn btn-primary" disabled={busy || picked.size === 0} onClick={() => void send(false)}>
          Enviar para revisão
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
