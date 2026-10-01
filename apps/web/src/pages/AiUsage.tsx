// Uso de IA (últimos 30 dias): custo estimado pelo preço oficial de cada modelo e tokens, por recurso e
// por dia. Os números vêm do servidor (cada chamada é registrada, sem texto).
import { useQuery } from '@tanstack/react-query';
import { api } from '../api/client';
import { ErrorNote } from '../components/shared';

const FEATURE_LABEL: Record<string, string> = {
  tonight_plan: 'O que assistir hoje: entender o pedido',
  tonight_titles: 'O que assistir hoje: sugerir títulos',
  summary_improve: 'Melhorar resumo do gosto',
  mood: 'Como estou',
  title_search: 'Buscar com IA',
  describe: 'Descrever com IA',
  image_titles: 'Importar de imagem',
  share_extract: 'Ler compartilhamentos',
};

const usd = (v: number) => `US$ ${v < 0.01 && v > 0 ? v.toFixed(4) : v.toFixed(2)}`.replace('.', ',');
const tokens = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(n >= 100_000 ? 0 : 1).replace('.', ',')} mil` : String(n));
const day = (d: string) => d.split('-').reverse().slice(0, 2).join('/');

export function AiUsageSection() {
  const usage = useQuery({ queryKey: ['ai-usage'], queryFn: api.aiUsage });
  const d = usage.data;
  return (
    <section className="ai-usage">
      <h2>Uso de IA</h2>
      <ErrorNote error={usage.error} />
      {d && d.total.calls === 0 && <p className="muted small">Nenhuma chamada de IA nos últimos 30 dias.</p>}
      {d && d.total.calls > 0 && (
        <>
          <p className="ai-usage-total">
            <strong>{usd(d.total.costUsd)}</strong> <span className="muted small">nos últimos 30 dias · {d.total.calls} chamadas{d.total.failures ? ` (${d.total.failures} com falha)` : ''} · {tokens(d.total.inputTokens + d.total.outputTokens)} tokens</span>
          </p>
          <table className="table stack-table ai-usage-table">
            <thead>
              <tr>
                <th>Recurso</th>
                <th>Chamadas</th>
                <th>Tokens (entrada / saída)</th>
                <th>Custo</th>
              </tr>
            </thead>
            <tbody>
              {d.features.map((f) => (
                <tr key={f.feature}>
                  <td className="stack-title">
                    {FEATURE_LABEL[f.feature] ?? f.feature}
                    <div className="muted small">{f.models.join(', ')}</div>
                  </td>
                  <td data-label="Chamadas">{f.calls}</td>
                  <td data-label="Tokens">
                    {tokens(f.inputTokens)} / {tokens(f.outputTokens)}
                  </td>
                  <td data-label="Custo">{usd(f.costUsd)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <details className="ai-usage-days">
            <summary className="small">Por dia</summary>
            <ul className="ai-usage-day-list" aria-label="Uso de IA por dia">
              {d.days.map((x) => (
                <li key={x.date} className="small">
                  <span>{day(x.date)}</span>
                  <span className="muted">{x.calls} chamadas</span>
                  <strong>{usd(x.costUsd)}</strong>
                </li>
              ))}
            </ul>
          </details>
          <p className="muted small">Custo estimado pelos preços oficiais de cada modelo (o raciocínio do modelo conta como saída). O valor faturado está no console da Anthropic.</p>
        </>
      )}
    </section>
  );
}
