import type { SandboxRunResponse } from '@fruiqo/contracts';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { api, ApiError } from '../api/client';
import { DecisionsTable, ErrorNote, StepsTable } from '../components/shared';
import { DECISION_LABEL, SHARE_STATUS_LABEL } from '../labels';

export function Sandbox() {
  const fixtures = useQuery({ queryKey: ['sandbox-fixtures'], queryFn: api.sandboxFixtures, retry: false });
  const evals = useQuery({ queryKey: ['sandbox-evals'], queryFn: api.sandboxEvals, retry: false, enabled: fixtures.isSuccess });
  const [running, setRunning] = useState<string | null>(null);
  const [result, setResult] = useState<SandboxRunResponse | null>(null);
  const [error, setError] = useState<unknown>(null);

  const disabled = fixtures.error instanceof ApiError && fixtures.error.status === 404;

  async function run(id: string) {
    setRunning(id);
    setError(null);
    try {
      setResult(await api.runFixture(id));
    } catch (err) {
      setError(err);
    } finally {
      setRunning(null);
    }
  }

  return (
    <section>
      <div className="page-head">
        <h1>Sandbox</h1>
      </div>
      <p className="muted">
        Roda as fixtures sintéticas pelo pipeline em modo <code>mock</code> (sem rede, custo zero) num usuário temporário e
        compara com o resultado esperado.
      </p>
      {disabled ? (
        <p className="card">O sandbox está desligado nesta API (defina <code>SANDBOX_ENABLED=true</code>, fora de produção).</p>
      ) : (
        <ErrorNote error={fixtures.error ?? error} />
      )}

      {fixtures.data && (
        <table className="table">
          <thead>
            <tr>
              <th>Fixture</th>
              <th>Tipo</th>
              <th>Descrição</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {fixtures.data.items.map((f) => (
              <tr key={f.id}>
                <td>
                  <code>{f.id}</code>
                </td>
                <td>{f.kind}</td>
                <td className="small">{f.description}</td>
                <td>
                  <button type="button" className="btn" disabled={running !== null || f.shareCount === 0} onClick={() => void run(f.id)}>
                    {running === f.id ? 'Rodando…' : 'Rodar'}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {result && (
        <div className="card">
          <h2>
            <code>{result.fixtureId}</code>{' '}
            <span className={result.passed ? 'badge badge-cataloged' : 'badge badge-discarded'}>{result.passed ? 'passou' : 'falhou'}</span>
          </h2>
          {result.shares.map((s, i) => (
            <div key={i} className="sandbox-share">
              <h3>
                Compartilhamento {i + 1} · {SHARE_STATUS_LABEL[s.status]}
              </h3>
              <p className="small">
                acertos {s.diff.tp} · falsos positivos {s.diff.fp} · faltando {s.diff.fn}
              </p>
              {s.diff.missing.length > 0 && <p className="error small">Faltando: {s.diff.missing.join(', ')}</p>}
              {s.diff.unexpected.length > 0 && <p className="error small">Inesperados: {s.diff.unexpected.join(', ')}</p>}
              {s.diff.failedAssertions.length > 0 && (
                <ul className="error small">
                  {s.diff.failedAssertions.map((a) => (
                    <li key={a}>{a}</li>
                  ))}
                </ul>
              )}
              {s.items.length > 0 && (
                <p className="small">
                  {s.items.map((it) => `${it.title} (${DECISION_LABEL[it.decision] ?? it.decision})`).join(' · ')}
                </p>
              )}
              <StepsTable steps={s.steps} />
              <DecisionsTable decisions={s.decisions} />
            </div>
          ))}
        </div>
      )}

      {evals.data && evals.data.reports.length > 0 && (
        <>
          <h2>Últimos evals</h2>
          <table className="table">
            <thead>
              <tr>
                <th>Rótulo</th>
                <th>Quando</th>
                <th>Métricas</th>
              </tr>
            </thead>
            <tbody>
              {evals.data.reports.map((r) => (
                <tr key={r.file}>
                  <td>{r.label}</td>
                  <td className="small">{r.createdAt}</td>
                  <td className="small">
                    <code>{JSON.stringify(r.metrics)}</code>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </section>
  );
}
