import { DndContext, KeyboardSensor, PointerSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core';
import { SortableContext, arrayMove, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { Title } from '@fruiqo/contracts';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { api } from '../api/client';
import { ErrorNote } from '../components/shared';
import { useToast } from '../components/Toast';
import { EmptyState, Icon, Thumb } from '../components/ui';
import { KIND_LABEL, STATUS_LABEL } from '../labels';

function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  return (words.length > 1 ? words[0]![0]! + words[1]![0]! : name.slice(0, 2)).toUpperCase();
}

export function Lists() {
  const lists = useQuery({ queryKey: ['lists'], queryFn: api.lists });
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const [error, setError] = useState<unknown>(null);

  async function create(e: FormEvent) {
    e.preventDefault();
    try {
      const l = await api.createList(name.trim());
      setName('');
      await qc.invalidateQueries({ queryKey: ['lists'] });
      navigate(`/listas/${l.id}`);
    } catch (err) {
      setError(err);
    }
  }

  return (
    <section>
      <div className="page-head">
        <div>
          <h1>Listas</h1>
          <p className="page-sub">Maratonas, temas e listas criadas a partir dos seus prints.</p>
        </div>
        <form className="inline-form" onSubmit={create}>
          <input aria-label="Nome da nova lista" placeholder="Nova lista…" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} required />
          <button type="submit" className="btn btn-primary">
            <Icon name="plus" /> Criar
          </button>
        </form>
      </div>
      <ErrorNote error={lists.error ?? error} />
      <div className="grid">
        {(lists.data ?? []).map((l) => (
          <Link key={l.id} to={`/listas/${l.id}`} className="card list-card">
            <div className="list-cover" aria-hidden="true">
              <span className="initials">{initials(l.name)}</span>
              {l.pinned && <span className="badge">fixada</span>}
            </div>
            <div className="list-body">
              <div className="list-card-head">
                <strong>{l.name}</strong>
                <span className="muted small num">{l.itemCount} títulos</span>
              </div>
              <div className="progress" aria-label={`Progresso ${l.doneCount} de ${l.itemCount}`}>
                <span style={{ width: `${l.itemCount ? (l.doneCount / l.itemCount) * 100 : 0}%` }} />
              </div>
              <div className="muted small">
                {l.doneCount}/{l.itemCount} resolvidos{l.sourceShareId ? ' · criada a partir de prints' : ''}
              </div>
            </div>
          </Link>
        ))}
      </div>
      {lists.data?.length === 0 && <EmptyState title="Nenhuma lista ainda.">Crie uma acima ou importe prints de um post com lista.</EmptyState>}
    </section>
  );
}

function SortableRow({ t, index }: { t: Title; index: number }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: t.id });
  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={isDragging ? 'sortable dragging' : 'sortable'}
    >
      <button type="button" className="handle" aria-label={`Arrastar ${t.title}`} {...attributes} {...listeners}>
        <Icon name="grip" size={16} />
      </button>
      <span className="pos">{index + 1}</span>
      <Thumb src={t.posterUrl} title={t.title} width={32} height={48} />
      <span className="grow">
        <strong>{t.title}</strong>
        <span className="muted small"> {[KIND_LABEL[t.kind], t.year].filter(Boolean).join(' · ')}</span>
      </span>
      <span className={`badge badge-status-${t.status}`}>{STATUS_LABEL[t.status]}</span>
    </li>
  );
}

export function ListDetail() {
  const { id = '' } = useParams();
  const list = useQuery({ queryKey: ['list', id], queryFn: () => api.list(id) });
  const qc = useQueryClient();
  const toast = useToast();
  const navigate = useNavigate();
  const [order, setOrder] = useState<Title[]>([]);
  const [name, setName] = useState('');
  const [error, setError] = useState<unknown>(null);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  useEffect(() => {
    if (list.data) {
      setOrder(list.data.items);
      setName(list.data.name);
    }
  }, [list.data]);

  async function onDragEnd(e: DragEndEvent) {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const from = order.findIndex((t) => t.id === active.id);
    const to = order.findIndex((t) => t.id === over.id);
    const next = arrayMove(order, from, to);
    setOrder(next);
    try {
      await api.reorderList(id, next.map((t) => t.id));
      await qc.invalidateQueries({ queryKey: ['lists'] });
    } catch (err) {
      setOrder(order);
      setError(err);
    }
  }

  async function rename(e: FormEvent) {
    e.preventDefault();
    if (!list.data || name.trim() === list.data.name) return;
    try {
      await api.updateList(id, { name: name.trim() });
      await qc.invalidateQueries();
      toast.show('Lista renomeada.');
    } catch (err) {
      setError(err);
    }
  }

  async function togglePin() {
    if (!list.data) return;
    try {
      await api.updateList(id, { pinned: !list.data.pinned });
      await qc.invalidateQueries();
    } catch (err) {
      setError(err);
    }
  }

  async function duplicate() {
    try {
      const copy = await api.duplicateList(id);
      await qc.invalidateQueries({ queryKey: ['lists'] });
      toast.show('Lista duplicada.');
      navigate(`/listas/${copy.id}`);
    } catch (err) {
      setError(err);
    }
  }

  async function remove() {
    if (!window.confirm('Excluir esta lista? Os títulos continuam no catálogo.')) return;
    try {
      await api.deleteList(id);
      await qc.invalidateQueries({ queryKey: ['lists'] });
      navigate('/listas');
    } catch (err) {
      setError(err);
    }
  }

  return (
    <section>
      <p>
        <Link to="/listas">← Listas</Link>
      </p>
      <ErrorNote error={list.error ?? error} />
      {list.data && (
        <>
          <div className="page-head">
            <form className="inline-form" onSubmit={rename}>
              <input aria-label="Nome da lista" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} required className="title-input" />
              <button type="submit" className="btn">
                Renomear
              </button>
            </form>
            <div className="actions">
              <button type="button" className="btn" onClick={() => void togglePin()}>
                {list.data.pinned ? 'Desafixar' : 'Fixar no "Continuar"'}
              </button>
              <button type="button" className="btn" onClick={() => void duplicate()}>
                Duplicar
              </button>
              <button type="button" className="btn btn-danger" onClick={() => void remove()}>
                Excluir
              </button>
            </div>
          </div>
          <p className="muted small">Arraste pela alça (ou use espaço + setas) para mudar a prioridade de assistir.</p>
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={(e) => void onDragEnd(e)}>
            <SortableContext items={order.map((t) => t.id)} strategy={verticalListSortingStrategy}>
              <ol className="sortable-list">
                {order.map((t, i) => (
                  <SortableRow key={t.id} t={t} index={i} />
                ))}
              </ol>
            </SortableContext>
          </DndContext>
          {order.length === 0 && <p className="muted empty">Lista vazia. Adicione títulos pelo catálogo.</p>}
        </>
      )}
    </section>
  );
}
