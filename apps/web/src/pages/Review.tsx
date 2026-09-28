import type { ReviewItem } from '@fruiqo/contracts';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api/client';
import { CorrectTitleForm, ErrorNote, Modal } from '../components/shared';
import { useToast } from '../components/Toast';
import { KIND_LABEL, PLATFORM_LABEL, percent } from '../labels';

const SHORTCUTS: [string, string][] = [
  ['J / ↓', 'próximo'],
  ['K / ↑', 'anterior'],
  ['A', 'aprovar'],
  ['R', 'rejeitar'],
  ['E', 'corrigir e aprovar'],
  ['?', 'mostrar/ocultar atalhos'],
  ['Esc', 'fechar'],
];

function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName) || target.isContentEditable;
}

export function Review() {
  const review = useQuery({ queryKey: ['review'], queryFn: api.review });
  const qc = useQueryClient();
  const toast = useToast();
  const [idx, setIdx] = useState(0);
  const [editing, setEditing] = useState<ReviewItem | null>(null);
  const [help, setHelp] = useState(false);
  const [busy, setBusy] = useState(false);
  const rowRefs = useRef<(HTMLLIElement | null)[]>([]);
  const items = review.data?.items ?? [];
  const current = items[Math.min(idx, items.length - 1)];

  useEffect(() => {
    if (idx > 0 && idx >= items.length) setIdx(Math.max(0, items.length - 1));
  }, [idx, items.length]);

  useEffect(() => {
    if (!editing) rowRefs.current[idx]?.focus();
  }, [idx, editing, items.length]);

  const act = useCallback(
    async (kind: 'approve' | 'reject', item: ReviewItem) => {
      setBusy(true);
      try {
        if (kind === 'approve') await api.approve(item.title.id);
        else await api.reject(item.title.id);
        toast.show(kind === 'approve' ? `"${item.title.title}" aprovado.` : `"${item.title.title}" rejeitado.`);
        await qc.invalidateQueries();
      } catch (err) {
        toast.show(err instanceof Error ? err.message : 'Falhou.', { tone: 'error' });
      } finally {
        setBusy(false);
      }
    },
    [qc, toast],
  );

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (editing || isTyping(e.target) || e.ctrlKey || e.metaKey || e.altKey) return;
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
      } else {
        return;
      }
      e.preventDefault();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [act, busy, current, editing, items.length]);

  return (
    <section>
      <div className="page-head">
        <h1>Revisão</h1>
        <button type="button" className="btn" onClick={() => setHelp((h) => !h)} aria-expanded={help}>
          Atalhos (?)
        </button>
      </div>
      <p className="muted">Títulos detectados com pouca confiança. Aprove, rejeite ou corrija sem tirar a mão do teclado.</p>
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
      <ul className="review-list" role="listbox" aria-label="Fila de revisão">
        {items.map((it, i) => (
          <li
            key={it.title.id}
            ref={(el) => {
              rowRefs.current[i] = el;
            }}
            role="option"
            aria-selected={i === idx}
            tabIndex={i === idx ? 0 : -1}
            className={i === idx ? 'review-item current' : 'review-item'}
            onClick={() => setIdx(i)}
          >
            <div className="grow">
              <strong>{it.title.title}</strong>
              <span className="muted small"> {[KIND_LABEL[it.title.kind], it.title.year].filter(Boolean).join(' · ')}</span>
              {it.candidate && (
                <div className="muted small">
                  lido como "{it.candidate.rawTitle}" · confiança {percent(it.candidate.confidenceScore)} · {it.candidate.reason}
                </div>
              )}
              {it.share && (
                <div className="muted small">
                  de {it.share.origin === 'screenshot' ? 'prints' : PLATFORM_LABEL[it.share.platform]}
                  {it.share.sourceTitle ? ` · ${it.share.sourceTitle}` : ''}
                </div>
              )}
            </div>
            <div className="actions">
              <button type="button" className="btn" tabIndex={-1} onClick={() => void act('approve', it)}>
                Aprovar
              </button>
              <button type="button" className="btn" tabIndex={-1} onClick={() => void act('reject', it)}>
                Rejeitar
              </button>
              <button type="button" className="btn" tabIndex={-1} onClick={() => setEditing(it)}>
                Corrigir
              </button>
            </div>
          </li>
        ))}
      </ul>
      {!review.isLoading && items.length === 0 && <p className="muted empty">Nada para revisar. 🎉</p>}
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
    </section>
  );
}
