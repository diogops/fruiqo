import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { api } from '../api/client';
import { ErrorNote } from '../components/shared';
import { useToast } from '../components/Toast';
import { formatDateTime } from '../labels';

const SOURCE_LABEL = { signals: 'pelo que você assistiu/avaliou', pinned: 'fixado por você', excluded: 'excluído por você' } as const;

export function Profile() {
  const taste = useQuery({ queryKey: ['taste'], queryFn: api.taste });
  const subs = useQuery({ queryKey: ['subscriptions'], queryFn: api.subscriptions });
  const mood = useQuery({ queryKey: ['mood-history'], queryFn: api.moodHistory });
  const qc = useQueryClient();
  const toast = useToast();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    if (subs.data) setSelected(new Set(subs.data.selected));
  }, [subs.data]);

  async function updateTaste(body: Parameters<typeof api.updateTaste>[0]) {
    try {
      await api.updateTaste(body);
      await qc.invalidateQueries({ queryKey: ['taste'] });
    } catch (err) {
      setError(err);
    }
  }

  async function saveSubs() {
    try {
      await api.saveSubscriptions([...selected]);
      await qc.invalidateQueries({ queryKey: ['subscriptions'] });
      toast.show('Assinaturas salvas.');
    } catch (err) {
      setError(err);
    }
  }

  async function clearMood() {
    if (!window.confirm('Apagar todo o histórico do "Como estou"?')) return;
    try {
      await api.deleteMoodHistory();
      await qc.invalidateQueries({ queryKey: ['mood-history'] });
      toast.show('Histórico de humor apagado.');
    } catch (err) {
      setError(err);
    }
  }

  const byCategory = (cat: 'video' | 'music') => (subs.data?.available ?? []).filter((p) => p.category === cat);

  return (
    <section>
      <div className="page-head">
        <h1>Perfil de gosto</h1>
      </div>
      <p className="muted">
        Tudo o que o Fruiqo acha dos seus gostos está aqui, com a origem de cada valor. Nada fica escondido: fixe o que você
        gosta ou exclua o que nunca quer ver sugerido.
      </p>
      <ErrorNote error={taste.error ?? subs.error ?? mood.error ?? error} />

      {taste.data && (
        <>
          <p className="muted small">
            {taste.data.totals.signals} sinais · {taste.data.totals.watched} assistidos · {taste.data.totals.rated} avaliados
          </p>
          <table className="table">
            <thead>
              <tr>
                <th>Gênero</th>
                <th>Afinidade</th>
                <th>Origem</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {taste.data.genres.map((g) => (
                <tr key={g.key}>
                  <td>{g.label}</td>
                  <td>
                    <div className="affinity" title={g.score.toFixed(2)}>
                      <span
                        className={g.score >= 0 ? 'pos' : 'neg'}
                        style={{ width: `${Math.min(100, Math.abs(g.score) * 100)}%` }}
                      />
                    </div>
                  </td>
                  <td className="small">
                    {SOURCE_LABEL[g.source]}
                    {g.source === 'signals' && g.signals > 0 && <span className="muted"> ({g.signals})</span>}
                  </td>
                  <td className="actions">
                    {g.source !== 'pinned' && (
                      <button type="button" className="btn btn-link" onClick={() => void updateTaste({ pin: [g.key] })}>
                        Fixar
                      </button>
                    )}
                    {g.source !== 'excluded' && (
                      <button type="button" className="btn btn-link" onClick={() => void updateTaste({ exclude: [g.key] })}>
                        Excluir
                      </button>
                    )}
                    {g.source !== 'signals' && (
                      <button type="button" className="btn btn-link" onClick={() => void updateTaste({ clear: [g.key] })}>
                        Limpar
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {taste.data.subgenres.length > 0 && (
            <>
              <h2>Subgêneros</h2>
              <div className="chips">
                {taste.data.subgenres.map((s) => (
                  <span key={s.key} className="chip" title={s.score.toFixed(2)}>
                    {s.label}
                  </span>
                ))}
              </div>
            </>
          )}
        </>
      )}

      <h2>Assinaturas</h2>
      <p className="muted small">
        Os serviços que você assina ajudam a priorizar o que está disponível pra você. Não há conexão com as plataformas.
      </p>
      {subs.data && (
        <div className="subs">
          {(['video', 'music'] as const).map((cat) => (
            <fieldset key={cat}>
              <legend>{cat === 'video' ? 'Vídeo' : 'Música'}</legend>
              {byCategory(cat).map((p) => (
                <label key={p.key} className="check">
                  <input
                    type="checkbox"
                    checked={selected.has(p.key)}
                    onChange={() =>
                      setSelected((s) => {
                        const n = new Set(s);
                        if (n.has(p.key)) n.delete(p.key);
                        else n.add(p.key);
                        return n;
                      })
                    }
                  />
                  {p.label}
                </label>
              ))}
            </fieldset>
          ))}
          <button type="button" className="btn btn-primary" onClick={() => void saveSubs()}>
            Salvar assinaturas
          </button>
        </div>
      )}

      <h2>Histórico do "Como estou"</h2>
      <p className="muted small">O texto que você digitou nunca foi guardado; só a intenção interpretada.</p>
      {mood.data && mood.data.items.length === 0 && <p className="muted">Sem histórico.</p>}
      {mood.data && mood.data.items.length > 0 && (
        <>
          <ul className="plain">
            {mood.data.items.map((m) => (
              <li key={m.runId}>
                <span className="muted small">{formatDateTime(m.createdAt)}</span> ·{' '}
                {m.riskShown ? 'mensagem de apoio exibida' : (m.needLabel ?? m.need ?? 'intenção')}
                {m.avoid.length > 0 && <span className="muted small"> · evitando {m.avoid.join(', ')}</span>}
              </li>
            ))}
          </ul>
          <button type="button" className="btn btn-danger" onClick={() => void clearMood()}>
            Apagar histórico
          </button>
        </>
      )}
    </section>
  );
}
