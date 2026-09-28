import type { CandidateDecision } from '@fruiqo/contracts';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router';
import { api } from '../api/client';
import { CorrectTitleForm, DecisionsTable, ErrorNote, Modal, StepsTable } from '../components/shared';
import { PLATFORM_LABEL, SHARE_STATUS_LABEL, formatDateTime, formatUsd } from '../labels';

export function Activity() {
  const activity = useInfiniteQuery({
    queryKey: ['activity'],
    queryFn: ({ pageParam }) => api.activity(pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
  const items = useMemo(() => activity.data?.pages.flatMap((p) => p.items) ?? [], [activity.data]);

  return (
    <section>
      <div className="page-head">
        <h1>Atividade</h1>
      </div>
      <ErrorNote error={activity.error} />
      <table className="table">
        <thead>
          <tr>
            <th>Quando</th>
            <th>Origem</th>
            <th>Status</th>
            <th>Catalogados</th>
            <th>Revisão</th>
            <th>Descartados</th>
            <th>Deduplicação</th>
            <th>Duração</th>
            <th>Custo</th>
          </tr>
        </thead>
        <tbody>
          {items.map((a) => (
            <tr key={a.shareId}>
              <td>
                <Link to={`/atividade/${a.shareId}`}>{formatDateTime(a.createdAt)}</Link>
                {a.isFixture && <span className="badge">fixture</span>}
              </td>
              <td>
                {a.origin === 'screenshot' ? `Prints (${a.pageCount ?? '?'})` : PLATFORM_LABEL[a.platform]}
                {a.sourceTitle && <div className="muted small truncate">{a.sourceTitle}</div>}
              </td>
              <td>
                <span className={`badge badge-share-${a.status}`}>{SHARE_STATUS_LABEL[a.status]}</span>
                {a.error && <div className="error small">{a.error}</div>}
              </td>
              <td>{a.counts.cataloged}</td>
              <td>{a.counts.review}</td>
              <td>{a.counts.discarded}</td>
              <td className="small">
                {a.dedup.pagesIgnored > 0 && <div>{a.dedup.pagesIgnored} print(s) repetido(s)</div>}
                {a.dedup.itemsAlreadyInList > 0 && <div>{a.dedup.itemsAlreadyInList} já na lista</div>}
                {a.dedup.pagesIgnored + a.dedup.itemsAlreadyInList === 0 && <span className="muted">—</span>}
              </td>
              <td>{a.durationMs} ms</td>
              <td>{formatUsd(a.costEstimateUsd)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {!activity.isLoading && items.length === 0 && <p className="muted empty">Nenhum compartilhamento ainda.</p>}
      {activity.hasNextPage && (
        <button type="button" className="btn" onClick={() => void activity.fetchNextPage()}>
          Carregar mais
        </button>
      )}
    </section>
  );
}

export function ActivityDetail() {
  const { shareId = '' } = useParams();
  const steps = useQuery({ queryKey: ['steps', shareId], queryFn: () => api.shareSteps(shareId) });
  const [correcting, setCorrecting] = useState<CandidateDecision | null>(null);

  return (
    <section>
      <p>
        <Link to="/atividade">← Atividade</Link>
      </p>
      <div className="page-head">
        <h1>Inspetor do pipeline</h1>
        <Link className="btn" to={`/catalogo?shareId=${shareId}`}>
          Ver títulos no catálogo
        </Link>
      </div>
      <ErrorNote error={steps.error} />
      {steps.data && (
        <>
          {steps.data.isFixture && <p className="muted">Compartilhamento de fixture: os trechos de texto ficam visíveis.</p>}
          <h2>Etapas</h2>
          <StepsTable steps={steps.data.steps} />
          <h2>Decisões por candidato</h2>
          <DecisionsTable decisions={steps.data.decisions} onCorrect={setCorrecting} />
        </>
      )}
      {correcting?.recommendationId && (
        <CorrectModal id={correcting.recommendationId} onClose={() => setCorrecting(null)} />
      )}
    </section>
  );
}

function CorrectModal({ id, onClose }: { id: string; onClose: () => void }) {
  const title = useQuery({ queryKey: ['title', id], queryFn: () => api.title(id) });
  return (
    <Modal title="Corrigir match" onClose={onClose}>
      <ErrorNote error={title.error} />
      {title.data && (
        <CorrectTitleForm title={title.data} submit={(body) => api.correctTitle(id, body)} onDone={onClose} onCancel={onClose} />
      )}
    </Modal>
  );
}
