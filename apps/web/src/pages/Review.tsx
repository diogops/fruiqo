// RF-42: toda importação passa por aqui antes de entrar na fila. Cada item mostra o match (e até 3
// alternativas), o encaixe sugerido na fila com os motivos, a lista proposta e possíveis duplicatas.
// Atalhos: J/K navegam, A aprova, R rejeita, E corrige, X marca para o lote, ? ajuda.
// A ordem da tela pode ser arrastada: aprovar marcados no topo/fim põe o bloco nessa ordem.
import { DndContext, KeyboardSensor, MouseSensor, TouchSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core';
import { SortableContext, arrayMove, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { openLibraryWorkUrl, tmdbPageUrl, workPages, type ApproveReviewRequest, type RecommendationKind, type ReviewBatchRequest, type ReviewItem } from '@fruiqo/contracts';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { api } from '../api/client';
import { CorrectTitleForm, ErrorNote, Modal } from '../components/shared';
import { useToast } from '../components/Toast';
import { EmptyState, Icon, Thumb, WorkLink } from '../components/ui';
import { kindLabel, KINDS, PLATFORM_LABEL, percent } from '../labels';

const SHORTCUTS: [string, string][] = [
  ['J / ↓', 'próximo'],
  ['K / ↑', 'anterior'],
  ['A', 'aprovar (encaixe sugerido)'],
  ['R', 'rejeitar'],
  ['E', 'corrigir e aprovar'],
  ['X', 'marcar para aprovar/rejeitar em lote'],
  ['?', 'mostrar/ocultar atalhos'],
  ['Esc', 'fechar'],
];

type ReviewPlacement = NonNullable<ReviewBatchRequest['placement']>;

const BATCH_PLACEMENTS: [ReviewPlacement, string][] = [
  ['suggested', 'no encaixe sugerido de cada um'],
  ['top', 'no topo, nesta ordem'],
  ['end', 'no fim da fila, nesta ordem'],
];

const MUSIC_KINDS =new Set<string>(['music_track', 'music_album', 'artist']);
const ORIGIN_LABEL: Record<string, string> = { screenshot: 'prints', text_file: 'arquivo .txt', text: 'texto' };

/** "de texto", "de arquivo .txt", "de prints"; link mostra a plataforma ("de YouTube") e, sem ela, "link". */
function originLabel(share: { origin: string; platform: string }): string {
  return ORIGIN_LABEL[share.origin] ?? (share.platform !== 'other' ? PLATFORM_LABEL[share.platform] : undefined) ?? 'link';
}

function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName) || target.isContentEditable;
}

/** alternativa de match normalizada: filmes/séries (TMDB) e livros (Open Library) */
type Alt = {
  key: string;
  title: string;
  year?: number;
  posterUrl?: string;
  subtitle?: string;
  overview?: string;
  score: number;
  /** página da alternativa para conferir (TMDB ou Open Library) */
  page?: { url: string; label: string };
  body: Pick<ApproveReviewRequest, 'alternative' | 'alternativeBook'>;
};

function alternativesOf(it: ReviewItem): Alt[] {
  const media: Alt[] = (it.alternatives ?? []).map((a) => ({
    key: `${a.mediaType}:${a.tmdbId}`,
    title: a.title,
    year: a.year,
    posterUrl: a.posterUrl,
    overview: a.overview,
    score: a.score,
    page: { url: tmdbPageUrl(a.mediaType, a.tmdbId), label: 'TMDB' },
    body: { alternative: { tmdbId: a.tmdbId, mediaType: a.mediaType } },
  }));
  const books: Alt[] = (it.bookAlternatives ?? []).map((a) => ({
    key: `ol:${a.olWorkId}`,
    title: a.title,
    year: a.year,
    posterUrl: a.coverUrl,
    subtitle: a.authors?.join(', '),
    score: a.score,
    ...(openLibraryWorkUrl(a.olWorkId) ? { page: { url: openLibraryWorkUrl(a.olWorkId)!, label: 'Open Library' } } : {}),
    body: { alternativeBook: { olWorkId: a.olWorkId } },
  }));
  return [...media, ...books].slice(0, 3);
}

export function Review() {
  const review = useQuery({ queryKey: ['review'], queryFn: api.review });
  const qc = useQueryClient();
  const toast = useToast();
  const [idx, setIdx] = useState(0);
  const [editing, setEditing] = useState<ReviewItem | null>(null);
  const [adjusting, setAdjusting] = useState<ReviewItem | null>(null);
  const [help, setHelp] = useState(false);
  const [busy, setBusy] = useState(false);
  const [marked, setMarked] = useState<Set<string>>(new Set());
  // escolhas por item antes de aprovar: alternativa de match e se entra na lista proposta
  const [chosenAlt, setChosenAlt] = useState<Record<string, Alt | undefined>>({});
  const [skipList, setSkipList] = useState<Record<string, boolean>>({});
  // ordem arrastada na tela (ids); itens novos entram no fim, na ordem do servidor
  const [order, setOrder] = useState<string[]>([]);
  const [batchPlacement, setBatchPlacement] = useState<ReviewPlacement>('suggested');
  const rowRefs = useRef<(HTMLLIElement | null)[]>([]);
  const items = useMemo(() => {
    const server = review.data?.items ?? [];
    if (order.length === 0) return server;
    const pos = new Map(order.map((id, i) => [id, i]));
    return server
      .map((it, i) => ({ it, k: pos.get(it.title.id) ?? order.length + i }))
      .sort((a, b) => a.k - b.k)
      .map((x) => x.it);
  }, [review.data, order]);
  const current = items[Math.min(idx, items.length - 1)];
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 4 } }),
    // no toque, segurar ~200ms pela alça inicia o arraste; mover antes disso é rolagem
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  function onDragEnd(e: DragEndEvent) {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const ids = items.map((i) => i.title.id);
    const from = ids.indexOf(String(active.id));
    const to = ids.indexOf(String(over.id));
    if (from < 0 || to < 0) return;
    setOrder(arrayMove(ids, from, to));
    setIdx(to);
    // quem arrasta quer essa ordem na fila: o lote passa a entrar no topo, nesta ordem
    setBatchPlacement((p) => (p === 'suggested' ? 'top' : p));
  }

  useEffect(() => {
    if (idx > 0 && idx >= items.length) setIdx(Math.max(0, items.length - 1));
  }, [idx, items.length]);

  useEffect(() => {
    if (!editing && !adjusting) rowRefs.current[idx]?.focus();
  }, [idx, editing, adjusting, items.length]);

  const approveBody = useCallback(
    (item: ReviewItem): ApproveReviewRequest | undefined => {
      const alt = chosenAlt[item.title.id];
      const body: ApproveReviewRequest = {};
      if (alt) Object.assign(body, alt.body);
      if (item.proposedList && skipList[item.title.id]) body.useProposedList = false;
      return Object.keys(body).length ? body : undefined;
    },
    [chosenAlt, skipList],
  );

  const act = useCallback(
    async (kind: 'approve' | 'reject', item: ReviewItem, body?: ApproveReviewRequest) => {
      setBusy(true);
      try {
        if (kind === 'approve') {
          const t = await api.approve(item.title.id, body ?? approveBody(item));
          toast.show(`"${t.title}" aprovado${t.rank ? ` como #${t.rank}` : ''}.`);
        } else {
          await api.reject(item.title.id);
          toast.show(`"${item.title.title}" rejeitado.`);
        }
        setMarked((m) => {
          const n = new Set(m);
          n.delete(item.title.id);
          return n;
        });
        await qc.invalidateQueries();
      } catch (err) {
        toast.show(err instanceof Error ? err.message : 'Falhou.', { tone: 'error' });
      } finally {
        setBusy(false);
      }
    },
    [approveBody, qc, toast],
  );

  async function batch(action: 'approve' | 'reject') {
    // na ordem da tela (a arrastada), não na ordem em que foram marcados
    const ids = items.map((i) => i.title.id).filter((id) => marked.has(id));
    if (ids.length === 0) return;
    setBusy(true);
    try {
      const res = await api.reviewBatch({ ids, action, ...(action === 'approve' ? { placement: batchPlacement } : {}) });
      const ok = action === 'approve' ? res.approved.length : res.rejected;
      toast.show(
        `${ok} título(s) ${action === 'approve' ? 'aprovado(s)' : 'rejeitado(s)'}${res.failed.length ? ` · ${res.failed.length} falhou/falharam` : ''}.`,
        res.failed.length ? { tone: 'error' } : undefined,
      );
      setMarked(new Set());
      await qc.invalidateQueries();
    } catch (err) {
      toast.show(err instanceof Error ? err.message : 'Falhou.', { tone: 'error' });
    } finally {
      setBusy(false);
    }
  }

  async function merge(item: ReviewItem) {
    if (!item.duplicateOf) return;
    setBusy(true);
    try {
      await api.mergeTitle(item.title.id, item.duplicateOf.id);
      toast.show(`Mesclado em "${item.duplicateOf.title}".`);
      await qc.invalidateQueries();
    } catch (err) {
      toast.show(err instanceof Error ? err.message : 'Falhou.', { tone: 'error' });
    } finally {
      setBusy(false);
    }
  }

  async function swapMusic(item: ReviewItem) {
    setBusy(true);
    try {
      const t = await api.swapMusic(item.title.id);
      toast.show(t.creator ? `Agora: "${t.title}" — ${t.creator}.` : `Agora: "${t.title}".`);
      await qc.invalidateQueries();
    } catch (err) {
      toast.show(err instanceof Error ? err.message : 'Falhou.', { tone: 'error' });
    } finally {
      setBusy(false);
    }
  }

  function toggleMark(id: string) {
    setMarked((m) => {
      const n = new Set(m);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  }

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (editing || adjusting || isTyping(e.target) || e.ctrlKey || e.metaKey || e.altKey) return;
      const key = e.key.toLowerCase();
      if (key === '?') {
        setHelp((h) => !h);
      } else if (key === 'escape') {
        setHelp(false);
      } else if (key === 'j' || key === 'arrowdown') {
        setIdx((i) => Math.min(i + 1, Math.max(0, items.length - 1)));
      } else if (key === 'k' || key === 'arrowup') {
        setIdx((i) => Math.max(i - 1, 0));
      } else if (!current || busy) {
        return;
      } else if (key === 'a') {
        void act('approve', current);
      } else if (key === 'r') {
        void act('reject', current);
      } else if (key === 'e') {
        setEditing(current);
      } else if (key === 'x') {
        toggleMark(current.title.id);
      } else {
        return;
      }
      e.preventDefault();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [act, adjusting, busy, current, editing, items.length]);

  const allMarked = items.length > 0 && items.every((i) => marked.has(i.title.id));

  return (
    <section>
      <div className="page-head">
        <div>
          <h1>Revisão</h1>
          <p className="page-sub">Tudo o que você importa passa por aqui antes de entrar na fila.</p>
        </div>
        <button type="button" className="btn shortcuts-toggle" onClick={() => setHelp((h) => !h)} aria-expanded={help}>
          Atalhos (?)
        </button>
      </div>
      {help && (
        <div className="card shortcuts" role="note" aria-label="Atalhos de teclado">
          {SHORTCUTS.map(([k, v]) => (
            <div key={k}>
              <kbd>{k}</kbd> {v}
            </div>
          ))}
        </div>
      )}
      <ErrorNote error={review.error} />

      {items.length > 0 && (
        <div className="review-toolbar">
          <label className="check">
            <input
              type="checkbox"
              checked={allMarked}
              onChange={() => setMarked(allMarked ? new Set() : new Set(items.map((i) => i.title.id)))}
            />{' '}
            Selecionar todos ({items.length})
          </label>
          <span className="grow" />
          {marked.size > 0 && <span className="muted small">{marked.size} marcado(s)</span>}
          <label className="small batch-placement">
            Aprovar{' '}
            <select value={batchPlacement} onChange={(e) => setBatchPlacement(e.target.value as ReviewPlacement)} aria-label="Onde os marcados entram na fila">
              {BATCH_PLACEMENTS.map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </select>
          </label>
          <button type="button" className="btn" disabled={busy || marked.size === 0} onClick={() => void batch('reject')}>
            Rejeitar marcados
          </button>
          <button type="button" className="btn btn-primary" disabled={busy || marked.size === 0} onClick={() => void batch('approve')}>
            Aprovar marcados
          </button>
        </div>
      )}

      {items.length > 1 && (
        <p className="muted small review-hint">
          Arraste pela alça <Icon name="grip" size={13} /> para definir a ordem: ao aprovar os marcados no topo ou no fim, eles entram nessa
          ordem na fila.
        </p>
      )}
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
        <SortableContext items={items.map((i) => i.title.id)} strategy={verticalListSortingStrategy}>
      <ul className="review-list" role="listbox" aria-label="Fila de revisão" aria-multiselectable="false">
        {items.map((it, i) => {
          const t = it.title;
          const alt = chosenAlt[t.id];
          const alts = alternativesOf(it);
          // conferir a obra: a alternativa escolhida ou o match atual
          const matched = workPages(t.resolution);
          const page = alt ? alt.page : matched;
          const imdbUrl = alt ? undefined : matched?.imdbUrl;
          const overview = alt ? alt.overview : t.overview;
          return (
            <SortableCard
              key={t.id}
              id={t.id}
              title={t.title}
              order={i + 1}
              setRef={(el) => {
                rowRefs.current[i] = el;
              }}
              selected={i === idx}
              onSelect={() => setIdx(i)}
            >
              <label className="check review-mark" onClick={(e) => e.stopPropagation()}>
                <input
                  type="checkbox"
                  tabIndex={-1}
                  checked={marked.has(t.id)}
                  onChange={() => toggleMark(t.id)}
                  aria-label={`Marcar ${t.title}`}
                />
              </label>
              <WorkLink href={page?.url} label={`Ver ${alt?.title ?? t.title} no ${page?.label}`} className="work-link-thumb">
                <Thumb src={alt?.posterUrl ?? t.posterUrl} title={alt?.title ?? t.title} width={60} height={90} />
              </WorkLink>
              <div className="grow review-body">
                <div>
                  <WorkLink href={page?.url} label={`Ver ${alt?.title ?? t.title} no ${page?.label}`}>
                    <strong>{alt?.title ?? t.title}</strong>
                    {page && <Icon name="external" size={13} className="work-ext-icon" />}
                  </WorkLink>
                  {!alt && t.creator && <span className="review-creator"> — {t.creator}</span>}
                  <span className="muted small"> {[kindLabel(t.kind), alt?.year ?? t.year].filter(Boolean).join(' · ')}</span>
                  {t.matchScore !== undefined && !alt && <span className="badge"> match {percent(t.matchScore)}</span>}
                  {alt && <span className="badge badge-ai">alternativa escolhida</span>}
                  {imdbUrl && (
                    <a className="work-ext" href={imdbUrl} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()} aria-label={`Ver ${t.title} no IMDb (abre em nova aba)`}>
                      IMDb <Icon name="external" size={12} />
                    </a>
                  )}
                </div>
                {overview && <p className={i === idx ? 'overview review-overview' : 'overview review-overview clamp'}>{overview}</p>}
                {it.candidate && (
                  <div className="muted small">
                    lido como "{it.candidate.rawTitle}" · confiança {percent(it.candidate.confidenceScore)}
                  </div>
                )}
                {it.share && (
                  <div className="muted small">
                    de {originLabel(it.share)}
                    {it.share.sourceTitle ? ` · ${it.share.sourceTitle}` : ''}
                  </div>
                )}

                {it.fit && (
                  <div className="fit">
                    <Icon name="hash" size={14} />{' '}
                    <strong>
                      Entra em #{it.fit.position} de {it.fit.total}
                    </strong>
                    {it.fit.before && <span className="muted small"> · antes de "{it.fit.before.title}" (#{it.fit.before.rank})</span>}
                    {it.fit.reasons.length > 0 && (
                      <ul className="fit-reasons small">
                        {it.fit.reasons.map((r) => (
                          <li key={r}>{r}</li>
                        ))}
                      </ul>
                    )}
                  </div>
                )}

                {alts.length > 0 && (
                  <div className="alts" role="group" aria-label={`Outras opções para ${t.title}`}>
                    <span className="muted small">Não é esse? </span>
                    {alts.map((a) => {
                      const on = alt?.key === a.key;
                      return [
                        <button
                          key={a.key}
                          type="button"
                          tabIndex={-1}
                          className={on ? 'chip chip-on alt-chip' : 'chip alt-chip'}
                          aria-pressed={Boolean(on)}
                          onClick={(e) => {
                            e.stopPropagation();
                            setChosenAlt((c) => ({ ...c, [t.id]: on ? undefined : a }));
                          }}
                        >
                          {a.title}
                          {a.year ? ` (${a.year})` : ''}
                          {a.subtitle ? ` · ${a.subtitle}` : ''} · {percent(a.score)}
                        </button>,
                        a.page && (
                          <a
                            key={`${a.key}-page`}
                            className="alt-link"
                            href={a.page.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            onClick={(e) => e.stopPropagation()}
                            aria-label={`Ver ${a.title}${a.year ? ` (${a.year})` : ''} no ${a.page.label} (abre em nova aba)`}
                            title={`Ver no ${a.page.label} (abre em nova aba)`}
                          >
                            <Icon name="external" size={14} />
                          </a>
                        ),
                      ];
                    })}
                  </div>
                )}

                {it.proposedList && (
                  <label className="check small" onClick={(e) => e.stopPropagation()}>
                    <input
                      type="checkbox"
                      tabIndex={-1}
                      checked={!skipList[t.id]}
                      onChange={(e) => setSkipList((s) => ({ ...s, [t.id]: !e.target.checked }))}
                    />{' '}
                    Incluir na lista "{it.proposedList.name}"
                    {!it.proposedList.listId && <span className="muted"> (criada ao aprovar)</span>}
                  </label>
                )}

                {it.duplicateOf && (
                  <div className="dup-warning small" role="note">
                    Parece ser o mesmo que "{it.duplicateOf.title}"
                    {it.duplicateOf.rank ? ` (#${it.duplicateOf.rank})` : ''} da sua lista.{' '}
                    <button type="button" className="btn btn-link" tabIndex={-1} onClick={(e) => { e.stopPropagation(); void merge(it); }}>
                      Mesclar
                    </button>
                  </div>
                )}
              </div>
              <div className="actions review-actions">
                <button type="button" className="btn btn-primary" tabIndex={-1} disabled={busy} onClick={(e) => { e.stopPropagation(); void act('approve', it); }}>
                  Aprovar
                </button>
                <button type="button" className="btn" tabIndex={-1} disabled={busy} onClick={(e) => { e.stopPropagation(); setAdjusting(it); }}>
                  Ajustar…
                </button>
                <button type="button" className="btn" tabIndex={-1} disabled={busy} onClick={(e) => { e.stopPropagation(); setEditing(it); }}>
                  Corrigir
                </button>
                {MUSIC_KINDS.has(t.kind) && t.creator && (
                  <button
                    type="button"
                    className="btn"
                    tabIndex={-1}
                    disabled={busy}
                    title="Título e artista estão trocados?"
                    onClick={(e) => { e.stopPropagation(); void swapMusic(it); }}
                  >
                    Trocar música/artista
                  </button>
                )}
                <button type="button" className="btn btn-danger" tabIndex={-1} disabled={busy} onClick={(e) => { e.stopPropagation(); void act('reject', it); }}>
                  Rejeitar
                </button>
              </div>
            </SortableCard>
          );
        })}
      </ul>
        </SortableContext>
      </DndContext>
      {!review.isLoading && items.length === 0 && <EmptyState title="Nada para revisar. 🎉">Importe prints, um .txt ou busque um título.</EmptyState>}
      {editing && (
        <Modal title={`Corrigir "${editing.title.title}"`} onClose={() => setEditing(null)}>
          <CorrectTitleForm
            title={editing.title}
            submitLabel="Corrigir e aprovar"
            submit={(body) => api.rematch(editing.title.id, body)}
            onDone={() => setEditing(null)}
            onCancel={() => setEditing(null)}
          />
        </Modal>
      )}
      {adjusting && (
        <AdjustApprove
          item={adjusting}
          baseBody={approveBody(adjusting)}
          onClose={() => setAdjusting(null)}
          onSubmit={async (body) => {
            await act('approve', adjusting, body);
            setAdjusting(null);
          }}
        />
      )}
    </section>
  );
}

/** Card da revisão arrastável pela alça (o resto do card segue clicável/selecionável). */
function SortableCard({
  id,
  title,
  order,
  selected,
  setRef,
  onSelect,
  children,
}: {
  id: string;
  title: string;
  order: number;
  selected: boolean;
  setRef: (el: HTMLLIElement | null) => void;
  onSelect: () => void;
  children: ReactNode;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
  const style = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.6 : undefined };
  return (
    <li
      ref={(el) => {
        setNodeRef(el);
        setRef(el);
      }}
      style={style}
      role="option"
      aria-selected={selected}
      tabIndex={selected ? 0 : -1}
      className={selected ? 'review-item review-card current' : 'review-item review-card'}
      onClick={onSelect}
    >
      <span className="review-order">
        <button type="button" className="drag-handle" aria-label={`Arrastar ${title}`} {...attributes} {...listeners} onClick={(e) => e.stopPropagation()}>
          <Icon name="grip" size={18} />
        </button>
        <span className="muted small">{order}º</span>
      </span>
      {children}
    </li>
  );
}

/** Aprovar ajustando: posição (sugerida/topo/fim/exata), listas extras, lista proposta e correção. */
function AdjustApprove({
  item,
  baseBody,
  onClose,
  onSubmit,
}: {
  item: ReviewItem;
  baseBody?: ApproveReviewRequest;
  onClose: () => void;
  onSubmit: (body: ApproveReviewRequest) => Promise<void>;
}) {
  const lists = useQuery({ queryKey: ['lists'], queryFn: api.lists });
  const t = item.title;
  const [placement, setPlacement] = useState<'suggested' | 'top' | 'end' | 'position'>('suggested');
  const [position, setPosition] = useState(String(item.fit?.position ?? 1));
  const [listIds, setListIds] = useState<Set<string>>(new Set());
  const [useProposed, setUseProposed] = useState(baseBody?.useProposedList !== false);
  const [title, setTitle] = useState(t.title);
  const [kind, setKind] = useState<RecommendationKind>(t.kind);
  const [year, setYear] = useState(t.year ? String(t.year) : '');
  const [error, setError] = useState<unknown>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const body: ApproveReviewRequest = { ...(baseBody ?? {}) };
    if (placement === 'position') body.position = Math.max(1, Number(position) || 1);
    else body.placement = placement;
    if (listIds.size) body.listIds = [...listIds];
    if (item.proposedList) body.useProposedList = useProposed;
    if (title.trim() && title.trim() !== t.title) body.title = title.trim();
    if (kind !== t.kind) body.kind = kind;
    const y = year.trim() ? Number(year) : null;
    if (y !== (t.year ?? null)) body.year = y;
    try {
      await onSubmit(body);
    } catch (err) {
      setError(err);
    }
  }

  return (
    <Modal title={`Aprovar "${t.title}"`} onClose={onClose}>
      <form className="form" onSubmit={submit}>
        <fieldset>
          <legend>Onde entra na fila</legend>
          <label className="check">
            <input type="radio" name="placement" checked={placement === 'suggested'} onChange={() => setPlacement('suggested')} /> Encaixe
            sugerido{item.fit ? ` (#${item.fit.position} de ${item.fit.total})` : ''}
          </label>
          <label className="check">
            <input type="radio" name="placement" checked={placement === 'top'} onChange={() => setPlacement('top')} /> Topo (#1)
          </label>
          <label className="check">
            <input type="radio" name="placement" checked={placement === 'end'} onChange={() => setPlacement('end')} /> Fim da fila
          </label>
          <label className="check">
            <input type="radio" name="placement" checked={placement === 'position'} onChange={() => setPlacement('position')} /> Posição
            exata
            <input
              className="pos-input"
              aria-label="Posição exata"
              inputMode="numeric"
              value={position}
              onFocus={() => setPlacement('position')}
              onChange={(e) => setPosition(e.target.value.replace(/\D/g, '').slice(0, 5))}
            />
          </label>
        </fieldset>
        {item.proposedList && (
          <label className="check">
            <input type="checkbox" checked={useProposed} onChange={(e) => setUseProposed(e.target.checked)} /> Incluir na lista "
            {item.proposedList.name}"
          </label>
        )}
        {(lists.data ?? []).length > 0 && (
          <fieldset>
            <legend>Incluir também em</legend>
            <div className="checks">
              {(lists.data ?? []).map((l) => (
                <label key={l.id} className="check">
                  <input
                    type="checkbox"
                    checked={listIds.has(l.id)}
                    onChange={() =>
                      setListIds((s) => {
                        const n = new Set(s);
                        if (n.has(l.id)) n.delete(l.id);
                        else n.add(l.id);
                        return n;
                      })
                    }
                  />{' '}
                  {l.name}
                </label>
              ))}
            </div>
          </fieldset>
        )}
        <details>
          <summary>Corrigir título, tipo ou ano</summary>
          <label>
            Título
            <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} />
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
        </details>
        <ErrorNote error={error} />
        <div className="actions">
          <button type="button" className="btn" onClick={onClose}>
            Cancelar
          </button>
          <button type="submit" className="btn btn-primary">
            Aprovar
          </button>
        </div>
      </form>
    </Modal>
  );
}
