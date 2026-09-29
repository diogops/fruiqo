// RF-44: priorização automática com rascunho. O sistema propõe uma ordem; o usuário reordena à vontade
// e só "Aplicar" muda a fila real (com Desfazer). "Descartar" não altera nada. O rascunho fica salvo
// no servidor até ser aplicado ou descartado.
import { DndContext, KeyboardSensor, MouseSensor, TouchSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core';
import { SortableContext, arrayMove, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { MoveTitleRequest, PriorityDraft, PriorityDraftItem } from '@fruiqo/contracts';
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api, ApiError } from '../api/client';
import { ErrorNote, Modal } from '../components/shared';
import { useToast } from '../components/Toast';
import { Icon, Thumb } from '../components/ui';
import { kindLabel } from '../labels';

export const DRAFT_KEY = ['priority-draft'] as const;

function Delta({ item }: { item: PriorityDraftItem }) {
  if (item.currentRank === null) return <span className="delta delta-new" title="Entrou na fila depois do rascunho">novo</span>;
  const d = item.currentRank - item.proposedRank;
  if (d === 0) return <span className="delta delta-same" aria-label="mesma posição">=</span>;
  return d > 0 ? (
    <span className="delta delta-up" aria-label={`sobe ${d}`}>
      ↑{d}
    </span>
  ) : (
    <span className="delta delta-down" aria-label={`desce ${-d}`}>
      ↓{-d}
    </span>
  );
}

function DraftRow({
  item,
  total,
  busy,
  onMove,
}: {
  item: PriorityDraftItem;
  total: number;
  busy: boolean;
  onMove: (req: MoveTitleRequest) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: item.title.id });
  const t = item.title;
  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={isDragging ? 'draft-row dragging' : 'draft-row'}
    >
      <button type="button" className="icon-btn drag-handle" aria-label={`Arrastar ${t.title}`} {...attributes} {...listeners}>
        <Icon name="grip" />
      </button>
      <span className="rank-badge" aria-label={`posição proposta ${item.proposedRank}`}>
        #{item.proposedRank}
      </span>
      <Delta item={item} />
      <Thumb src={t.posterUrl} title={t.title} />
      <div className="grow draft-main">
        <strong>{t.title}</strong>
        <span className="muted small">
          {' '}
          {[kindLabel(t.kind), t.year].filter(Boolean).join(' · ')}
          {item.currentRank !== null && ` · era #${item.currentRank}`}
        </span>
        <div className="small draft-reason">{item.reason}</div>
      </div>
      <div className="rank-controls">
        <button type="button" className="icon-btn" aria-label={`Subir ${t.title}`} disabled={busy || item.proposedRank === 1} onClick={() => onMove({ to: 'up' })}>
          <Icon name="up" />
        </button>
        <button type="button" className="icon-btn" aria-label={`Descer ${t.title}`} disabled={busy || item.proposedRank === total} onClick={() => onMove({ to: 'down' })}>
          <Icon name="down" />
        </button>
        <button type="button" className="icon-btn" aria-label={`Mover ${t.title} para o topo`} disabled={busy || item.proposedRank === 1} onClick={() => onMove({ to: 'top' })}>
          <Icon name="top" />
        </button>
        <button type="button" className="icon-btn" aria-label={`Mover ${t.title} para o fim`} disabled={busy || item.proposedRank === total} onClick={() => onMove({ to: 'bottom' })}>
          <Icon name="bottom" />
        </button>
      </div>
    </li>
  );
}

export function PriorityDraftView({ draft, onExit }: { draft: PriorityDraft; onExit: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [stale, setStale] = useState<{ added: number; removed: number } | null>(null);
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 4 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const items = draft.items;
  const total = items.length;

  async function update(body: Parameters<typeof api.updateDraft>[0], optimistic?: PriorityDraftItem[]) {
    setBusy(true);
    setError(null);
    if (optimistic) qc.setQueryData(DRAFT_KEY, { ...draft, items: optimistic });
    try {
      qc.setQueryData(DRAFT_KEY, await api.updateDraft(body));
    } catch (err) {
      qc.setQueryData(DRAFT_KEY, draft);
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  function onDragEnd(e: DragEndEvent) {
    if (!e.over || e.active.id === e.over.id) return;
    const from = items.findIndex((i) => i.title.id === e.active.id);
    const to = items.findIndex((i) => i.title.id === e.over?.id);
    if (from < 0 || to < 0) return;
    const next = arrayMove(items, from, to).map((it, i) => ({ ...it, proposedRank: i + 1 }));
    void update({ titleIds: next.map((i) => i.title.id) }, next);
  }

  async function apply(reconcile?: 'append_new') {
    setBusy(true);
    setError(null);
    try {
      const res = await api.applyDraft(reconcile ? { reconcile } : {});
      qc.setQueryData(DRAFT_KEY, null);
      await qc.invalidateQueries({ queryKey: ['library'] });
      setStale(null);
      toast.show(`Priorização aplicada em ${res.applied} título(s).`, {
        action: {
          label: 'Desfazer',
          onClick: async () => {
            await api.undoBulk(res.undoToken);
            await qc.invalidateQueries({ queryKey: ['library'] });
            toast.show('Ordem anterior restaurada.');
          },
        },
      });
      onExit();
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        const d = err.body.staleDetails as { added?: number; removed?: number } | undefined;
        setStale({ added: d?.added ?? 0, removed: d?.removed ?? 0 });
      } else {
        setError(err);
      }
    } finally {
      setBusy(false);
    }
  }

  async function discard() {
    setBusy(true);
    try {
      await api.discardDraft();
      qc.setQueryData(DRAFT_KEY, null);
      toast.show('Rascunho descartado. Nada mudou na fila.');
      onExit();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  async function regenerate() {
    setBusy(true);
    try {
      qc.setQueryData(DRAFT_KEY, await api.createDraft({}));
      setStale(null);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="draft">
      <div className="draft-banner" role="region" aria-label="Rascunho de priorização">
        <div className="grow">
          <strong>Rascunho — nada foi aplicado ainda.</strong>
          <div className="small">
            Ordem sugerida pelo seu perfil, notas e sinais. Arraste ou use ▲▼ para ajustar; só vale ao clicar em Aplicar.
          </div>
          {draft.stale && (
            <div className="small warn">
              A fila mudou desde o rascunho
              {draft.staleDetails ? ` (${draft.staleDetails.added} entrou/entraram, ${draft.staleDetails.removed} saiu/saíram)` : ''}.
            </div>
          )}
        </div>
        <div className="actions">
          <button type="button" className="btn" disabled={busy} onClick={() => void discard()}>
            Descartar
          </button>
          <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void apply()}>
            <Icon name="check" /> Aplicar
          </button>
        </div>
      </div>
      <ErrorNote error={error} />
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
        <SortableContext items={items.map((i) => i.title.id)} strategy={verticalListSortingStrategy}>
          <ol className="draft-list" aria-label="Ordem proposta">
            {items.map((it) => (
              <DraftRow
                key={it.title.id}
                item={it}
                total={total}
                busy={busy}
                onMove={(move) => void update({ id: it.title.id, move })}
              />
            ))}
          </ol>
        </SortableContext>
      </DndContext>

      {stale && (
        <Modal title="A fila mudou" onClose={() => setStale(null)}>
          <p>
            Desde que o rascunho foi gerado, {stale.added} título(s) entrou/entraram e {stale.removed} saiu/saíram da fila.
          </p>
          <p className="muted small">
            Você pode aplicar mesmo assim (os títulos novos ficam depois da ordem do rascunho) ou gerar um rascunho novo.
          </p>
          <div className="actions">
            <button type="button" className="btn" onClick={() => setStale(null)}>
              Cancelar
            </button>
            <button type="button" className="btn" disabled={busy} onClick={() => void regenerate()}>
              Gerar de novo
            </button>
            <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void apply('append_new')}>
              Aplicar mesmo assim
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
