// "Como estou" e "Surpreenda-me" no web (RF-31..37), a mesma API do app. O texto do humor nunca é
// guardado (RNF-06); com risco (RNF-07) a resposta é o acolhimento, sem sugestões. A IA só entra
// com o consentimento do Perfil (D-08); sem ele, as regras locais interpretam o pedido.
import { workPages, type DiscoverRequest, type DiscoverResponse, type Suggestion } from '@fruiqo/contracts';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import { api } from '../api/client';
import { ErrorNote } from '../components/shared';
import { Icon, Thumb, WorkLink } from '../components/ui';
import { kindLabel } from '../labels';

type Kind = 'movie' | 'series' | 'music';
const KIND_OPTIONS: [Kind, string][] = [
  ['movie', 'Filme'],
  ['series', 'Série'],
  ['music', 'Música'],
];

export function Discover() {
  const home = useQuery({ queryKey: ['home'], queryFn: api.home });
  const settings = useQuery({ queryKey: ['settings'], queryFn: api.settings });
  const qc = useQueryClient();
  const [text, setText] = useState('');
  const [kinds, setKinds] = useState<Kind[]>([]);
  const [result, setResult] = useState<DiscoverResponse | null>(null);
  const [last, setLast] = useState<DiscoverRequest | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [acting, setActing] = useState<string | null>(null);

  async function run(body: DiscoverRequest) {
    setBusy(true);
    setError(null);
    try {
      setResult(await api.discover(body));
      setLast(body);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  function onMood(e: FormEvent) {
    e.preventDefault();
    const t = text.trim();
    if (!t) return;
    void run({ mode: 'mood', text: t, ...(kinds.length ? { kinds } : {}) });
  }

  async function feedback(s: Suggestion, action: 'accept' | 'skip' | 'another') {
    if (!result) return;
    setActing(`${action}:${s.title.id}`);
    try {
      const res = await api.feedback({ runId: result.runId, titleId: s.title.id, action });
      setResult((r) => {
        if (!r) return r;
        const rest = r.suggestions.filter((x) => x.title.id !== s.title.id);
        // "Vou ver" mantém o item na tela; pular/outra troca pelo próximo, quando houver
        if (action === 'accept') return r;
        return { ...r, suggestions: res.next ? [...rest, res.next] : rest };
      });
      if (action === 'accept') {
        await api.updateTitle(s.title.id, { status: 'watching' });
        await qc.invalidateQueries();
      }
    } catch (err) {
      setError(err);
    } finally {
      setActing(null);
    }
  }

  const presets = (home.data?.presets ?? []).filter((p) => p.available > 0).slice(0, 10);
  const aiOn = settings.data?.aiConsent && settings.data?.aiAvailable;

  return (
    <section className="discover">
      <div className="page-head">
        <div>
          <h1>Como estou</h1>
          <p className="page-sub">Diga como está ou o que quer ver, e eu sugiro da sua lista.</p>
        </div>
      </div>

      <form className="card discover-form" onSubmit={onMood}>
        <label htmlFor="mood-text" className="sr-only">
          Como você está?
        </label>
        <textarea
          id="mood-text"
          data-autofocus
          rows={2}
          maxLength={500}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Ex.: cansado, quero algo leve e curto"
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              onMood(e);
            }
          }}
        />
        <div className="discover-row">
          <div className="chips" role="group" aria-label="Tipo (opcional)">
            {KIND_OPTIONS.map(([k, label]) => {
              const on = kinds.includes(k);
              return (
                <button key={k} type="button" className={on ? 'chip chip-on' : 'chip'} aria-pressed={on} onClick={() => setKinds((ks) => (on ? ks.filter((x) => x !== k) : [...ks, k]))}>
                  {label}
                </button>
              );
            })}
          </div>
          <button type="submit" className="btn btn-primary" disabled={busy || !text.trim()}>
            {busy ? 'Pensando…' : 'Sugerir'}
          </button>
        </div>
        <p className="muted small">
          {aiOn ? (
            <>
              <Icon name="sparkles" size={12} /> Com IA: o texto vai à Anthropic só para interpretar o pedido e não é guardado.
            </>
          ) : (
            <>
              Sem IA: interpretação por regras. <Link to="/perfil">Ligar a IA no Perfil</Link>
            </>
          )}
        </p>
      </form>

      {presets.length > 0 && (
        <div className="discover-presets">
          <span className="muted small">Surpreenda-me:</span>
          {presets.map((p) => (
            <button
              key={p.key}
              type="button"
              className="chip"
              disabled={busy}
              onClick={() => void run({ mode: 'surprise', ...(p.kind === 'subgenre' ? { subgenre: p.key } : { genre: p.key }) })}
            >
              {p.label}
            </button>
          ))}
        </div>
      )}

      <ErrorNote error={error} />

      {result?.risk && (
        <div className="card risk-card" role="alert">
          <h2>{result.risk.title}</h2>
          <p>{result.risk.message}</p>
          <p>
            <a className="btn btn-primary" href={result.risk.cvvUrl} target="_blank" rel="noopener noreferrer">
              CVV · {result.risk.cvvPhone}
            </a>{' '}
            <span className="muted small">Emergência: {result.risk.emergencyPhone}</span>
          </p>
          {last?.mode === 'mood' && (
            <button type="button" className="btn" onClick={() => void run({ ...last, continueAfterRisk: true })}>
              {result.risk.continueLabel}
            </button>
          )}
        </div>
      )}

      {result && !result.risk && (
        <div className="discover-result">
          <p className="discover-message">
            {result.message ?? (result.surprise ? `Surpresa: ${result.surprise.label}` : 'Minhas sugestões')}
            {result.interpreter === 'anthropic' && (
              <span className="badge badge-ai">
                <Icon name="sparkles" size={12} /> interpretado com IA
              </span>
            )}
          </p>
          {result.suggestions.length === 0 && (
            <p className="muted">Nada na sua lista combina agora. Tente outro pedido ou adicione mais títulos.</p>
          )}
          <ul className="suggestions" aria-label="Sugestões">
            {result.suggestions.map((s) => {
              const page = workPages(s.title.resolution);
              const label = `Ver ${s.title.title} no ${page?.label ?? ''}`;
              return (
                <li key={s.title.id} className="card suggestion">
                  <WorkLink href={page?.url} label={label} className="work-link-thumb">
                    <Thumb src={s.title.posterUrl} title={s.title.title} width={64} height={96} />
                  </WorkLink>
                  <div className="grow">
                    <strong>{s.title.title}</strong>
                    <div className="muted small">{[kindLabel(s.title.kind), s.title.year, s.title.rank ? `#${s.title.rank} na fila` : null].filter(Boolean).join(' · ')}</div>
                    <p className="small suggestion-reason">{s.reason}</p>
                    <div className="actions actions-start">
                      <button type="button" className="btn btn-primary" disabled={acting !== null} onClick={() => void feedback(s, 'accept')}>
                        Vou ver
                      </button>
                      <button type="button" className="btn" disabled={acting !== null} onClick={() => void feedback(s, 'another')}>
                        Outra
                      </button>
                      <button type="button" className="btn btn-link" disabled={acting !== null} onClick={() => void feedback(s, 'skip')}>
                        Pular
                      </button>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </section>
  );
}
