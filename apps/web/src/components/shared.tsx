import type { CandidateDecision, PipelineStep, RecommendationKind, Title } from '@fruiqo/contracts';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { api, ApiError } from '../api/client';
import { DECISION_LABEL, KIND_LABEL, KINDS, STEP_LABEL, formatUsd, percent } from '../labels';
import { useToast } from './Toast';

export function useTaxonomy() {
  return useQuery({ queryKey: ['taxonomy'], queryFn: api.taxonomy, staleTime: Infinity });
}

export function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    // foca o primeiro campo; sem campo, o primeiro botão (o × do cabeçalho vem antes no DOM)
    const root = ref.current;
    (root?.querySelector<HTMLElement>('input, select, textarea') ?? root?.querySelector<HTMLElement>('button'))?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={title} ref={ref}>
        <div className="modal-head">
          <h2>{title}</h2>
          <button type="button" className="btn btn-icon" aria-label="Fechar" onClick={onClose}>
            ×
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function ErrorNote({ error }: { error: unknown }) {
  if (!error) return null;
  const msg = error instanceof ApiError ? error.message : error instanceof Error ? error.message : 'Algo deu errado.';
  return (
    <p className="error" role="alert">
      {msg}
    </p>
  );
}

/**
 * Correção de título/ano/tipo (RF-27/28). Colisão (409) oferece mesclar no item existente.
 * `submit` recebe o corpo e decide o endpoint (correct ou rematch).
 */
export function CorrectTitleForm({
  title,
  submitLabel = 'Salvar correção',
  submit,
  onDone,
  onCancel,
}: {
  title: Pick<Title, 'id' | 'title' | 'kind' | 'year' | 'creator'>;
  submitLabel?: string;
  submit: (body: { title: string; kind: RecommendationKind; year: number | null; creator: string | null }) => Promise<unknown>;
  onDone: () => void;
  onCancel?: () => void;
}) {
  const [name, setName] = useState(title.title);
  const [kind, setKind] = useState<RecommendationKind>(title.kind);
  const [year, setYear] = useState(title.year ? String(title.year) : '');
  const [creator, setCreator] = useState(title.creator ?? '');
  const [error, setError] = useState<unknown>(null);
  const [conflictWith, setConflictWith] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const qc = useQueryClient();
  const toast = useToast();

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setConflictWith(null);
    try {
      await submit({
        title: name.trim(),
        kind,
        year: year.trim() ? Number(year) : null,
        creator: creator.trim() || null,
      });
      await qc.invalidateQueries();
      onDone();
    } catch (err) {
      if (err instanceof ApiError && err.status === 409 && typeof err.body.conflictWith === 'string') {
        setConflictWith(err.body.conflictWith);
      }
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  async function merge() {
    if (!conflictWith) return;
    setBusy(true);
    try {
      await api.mergeTitle(title.id, conflictWith);
      await qc.invalidateQueries();
      toast.show('Títulos mesclados.');
      onDone();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="form" onSubmit={onSubmit}>
      <label>
        Título
        <input value={name} onChange={(e) => setName(e.target.value)} required maxLength={200} />
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
        Criador (artista, diretor…)
        <input value={creator} onChange={(e) => setCreator(e.target.value)} maxLength={200} />
      </label>
      <ErrorNote error={error} />
      {conflictWith && (
        <p className="muted">
          Já existe um título igual na sua lista.{' '}
          <button type="button" className="btn btn-link" onClick={() => void merge()} disabled={busy}>
            Mesclar neste
          </button>
        </p>
      )}
      <div className="actions">
        {onCancel && (
          <button type="button" className="btn" onClick={onCancel}>
            Cancelar
          </button>
        )}
        <button type="submit" className="btn btn-primary" disabled={busy}>
          {submitLabel}
        </button>
      </div>
    </form>
  );
}

function Summary({ value }: { value: Record<string, unknown> }) {
  const entries = Object.entries(value);
  if (entries.length === 0) return <span className="muted">—</span>;
  return (
    <dl className="summary">
      {entries.map(([k, v]) => (
        <div key={k}>
          <dt>{k}</dt>
          <dd>{typeof v === 'object' ? JSON.stringify(v) : String(v)}</dd>
        </div>
      ))}
    </dl>
  );
}

export function StepsTable({ steps }: { steps: PipelineStep[] }) {
  if (steps.length === 0) return <p className="muted">Nenhuma etapa registrada.</p>;
  return (
    <table className="table steps-table">
      <thead>
        <tr>
          <th>#</th>
          <th>Etapa</th>
          <th>Entrada</th>
          <th>Saída</th>
          <th>Duração</th>
          <th>Custo</th>
        </tr>
      </thead>
      <tbody>
        {steps.map((s) => (
          <tr key={s.seq} className={s.error ? 'row-error' : undefined}>
            <td>
              <span className={s.error ? 'step-dot step-dot-error' : 'step-dot'}>{s.seq}</span>
            </td>
            <td>
              <strong>{STEP_LABEL[s.step]}</strong>
              <div className="muted small">{s.mode}</div>
              {s.error && <div className="error small">{s.error}</div>}
            </td>
            <td>
              <Summary value={s.inputSummary} />
            </td>
            <td>
              <Summary value={s.outputSummary} />
            </td>
            <td>{s.durationMs} ms</td>
            <td>
              {formatUsd(s.costEstimateUsd)}
              {s.tokensIn + s.tokensOut > 0 && <div className="muted small">{s.tokensIn + s.tokensOut} tokens</div>}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function DecisionsTable({
  decisions,
  onCorrect,
}: {
  decisions: CandidateDecision[];
  onCorrect?: (d: CandidateDecision) => void;
}) {
  if (decisions.length === 0) return <p className="muted">Nenhum candidato.</p>;
  return (
    <table className="table">
      <thead>
        <tr>
          <th>Candidato</th>
          <th>Tipo</th>
          <th>Confiança</th>
          <th>Decisão</th>
          <th>Motivo</th>
          {onCorrect && <th />}
        </tr>
      </thead>
      <tbody>
        {decisions.map((d, i) => (
          <tr key={`${d.rawTitle}-${i}`}>
            <td>{d.rawTitle}</td>
            <td>{KIND_LABEL[d.kind]}</td>
            <td>{percent(d.confidenceScore)}</td>
            <td>
              <span className={`badge badge-${d.decision}`}>{DECISION_LABEL[d.decision] ?? d.decision}</span>
            </td>
            <td className="muted">{d.reason}</td>
            {onCorrect && (
              <td>
                {d.recommendationId && (
                  <button type="button" className="btn btn-link" onClick={() => onCorrect(d)}>
                    Corrigir
                  </button>
                )}
              </td>
            )}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
