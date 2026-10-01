// RF-29/RNF-10: perfil de gosto editável. Cada gênero mostra o que foi aprendido e o nível que você
// escolher vale por cima (adoro = sempre bem-vindo; detesto = nunca sugerido). Subgêneros: gosto / não
// gosto. Gênero ou subgênero que ainda não aparece pode ser incluído. Nada de regra aqui: o servidor
// recalcula o perfil e devolve.
import { TASTE_LEVEL_SCORE, type TasteLevel, type TasteProfile, type UpdateTasteRequest } from '@fruiqo/contracts';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { api } from '../api/client';
import { Icon } from '../components/ui';

export const LEVEL_LABEL: Record<TasteLevel, string> = { love: 'Adoro', like: 'Gosto', neutral: 'Neutro', dislike: 'Não curto', hate: 'Detesto' };
const LEVEL_ORDER: TasteLevel[] = ['love', 'like', 'neutral', 'dislike', 'hate'];

/** Nome do nível mais próximo de uma afinidade (-1..1), só para mostrar o aprendido. */
function nearestLevel(score: number): TasteLevel {
  return LEVEL_ORDER.reduce((best, l) => (Math.abs(TASTE_LEVEL_SCORE[l] - score) < Math.abs(TASTE_LEVEL_SCORE[best] - score) ? l : best));
}

const NEXT_PREF = { none: 'like', like: 'dislike', dislike: null } as const;

export function TasteEditor({ taste, onChange }: { taste: TasteProfile; onChange: (body: UpdateTasteRequest) => Promise<void> }) {
  const taxonomy = useQuery({ queryKey: ['taxonomy'], queryFn: api.taxonomy, staleTime: Infinity });
  const [busy, setBusy] = useState(false);
  const [newGenre, setNewGenre] = useState('');
  const [newLevel, setNewLevel] = useState<TasteLevel>('like');
  const [newSub, setNewSub] = useState('');

  async function change(body: UpdateTasteRequest) {
    setBusy(true);
    try {
      await onChange(body);
    } finally {
      setBusy(false);
    }
  }

  const shownGenres = new Set(taste.genres.map((g) => g.key));
  const missingGenres = (taxonomy.data?.genres ?? []).filter((g) => !shownGenres.has(g.key));
  const shownSubs = new Set(taste.subgenres.map((s) => s.key));
  const missingSubs = (taxonomy.data?.subgenres ?? []).filter((s) => !shownSubs.has(s.key));

  return (
    <>
      <p className="muted small">
        {taste.totals.signals} sinais · {taste.totals.watched} assistidos · {taste.totals.rated} avaliados. Escolha o seu nível onde o aprendido
        não bate com você; "Automático" volta ao que foi aprendido.
      </p>
      <table className="table stack-table taste-table">
        <thead>
          <tr>
            <th>Gênero</th>
            <th>Afinidade</th>
            <th>Origem</th>
            <th>Seu nível</th>
          </tr>
        </thead>
        <tbody>
          {taste.genres.map((g) => (
            <tr key={g.key}>
              <td className="stack-title">{g.label}</td>
              <td data-label="Afinidade">
                <div className="affinity" title={g.score.toFixed(2)}>
                  <span className={g.score >= 0 ? 'pos' : 'neg'} style={{ width: `${Math.min(100, Math.abs(g.score) * 100)}%` }} />
                </div>
              </td>
              <td className="small" data-label="Origem">
                {g.source === 'signals' ? (
                  <>
                    pelo que você assistiu/avaliou{g.signals > 0 && <span className="muted"> ({g.signals})</span>}
                  </>
                ) : (
                  <>
                    ajustado por você{g.source === 'excluded' && ' · nunca sugerido'}
                    {g.learnedScore !== undefined && g.signals > 0 && (
                      <span className="muted"> · aprendido: {LEVEL_LABEL[nearestLevel(g.learnedScore)].toLowerCase()}</span>
                    )}
                  </>
                )}
              </td>
              <td data-label="Seu nível">
                <select
                  value={g.level ?? ''}
                  disabled={busy}
                  aria-label={`Seu nível para ${g.label}`}
                  onChange={(e) => {
                    const level = e.target.value as TasteLevel | '';
                    void change(level ? { levels: [{ key: g.key, level }] } : { clear: [g.key] });
                  }}
                >
                  <option value="">Automático</option>
                  {LEVEL_ORDER.map((l) => (
                    <option key={l} value={l}>
                      {LEVEL_LABEL[l]}
                    </option>
                  ))}
                </select>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {missingGenres.length > 0 && (
        <details className="taste-add">
          <summary>Incluir um gênero que não aparece</summary>
          <div className="row">
            <select value={newGenre} onChange={(e) => setNewGenre(e.target.value)} aria-label="Gênero para incluir">
              <option value="">Escolher gênero…</option>
              {missingGenres.map((g) => (
                <option key={g.key} value={g.key}>
                  {g.label}
                </option>
              ))}
            </select>
            <select value={newLevel} onChange={(e) => setNewLevel(e.target.value as TasteLevel)} aria-label="Nível do gênero incluído">
              {LEVEL_ORDER.map((l) => (
                <option key={l} value={l}>
                  {LEVEL_LABEL[l]}
                </option>
              ))}
            </select>
            <button
              type="button"
              className="btn"
              disabled={!newGenre || busy}
              onClick={() => void change({ levels: [{ key: newGenre, level: newLevel }] }).then(() => setNewGenre(''))}
            >
              Incluir
            </button>
          </div>
        </details>
      )}

      <h2>Subgêneros</h2>
      <p className="muted small">Toque para marcar: gosto → não gosto → automático. Entra no encaixe e na nota automática.</p>
      <div className="chips" role="group" aria-label="Subgêneros">
        {taste.subgenres.map((s) => {
          const pref = s.pref ?? 'none';
          return (
            <button
              key={s.key}
              type="button"
              className={`chip sub-pref sub-${pref}`}
              disabled={busy}
              title={`${s.label}: ${pref === 'like' ? 'você gosta' : pref === 'dislike' ? 'você não gosta' : 'automático'} (afinidade ${s.score.toFixed(2)})`}
              aria-label={`${s.label}: ${pref === 'like' ? 'gosto' : pref === 'dislike' ? 'não gosto' : 'automático'}`}
              onClick={() => void change({ subgenres: [{ key: s.key, pref: NEXT_PREF[pref] }] })}
            >
              {pref === 'like' && <Icon name="check" size={12} />}
              {pref === 'dislike' && <Icon name="x" size={12} />}
              {s.label}
            </button>
          );
        })}
      </div>
      {missingSubs.length > 0 && (
        <details className="taste-add">
          <summary>Incluir um subgênero que não aparece</summary>
          <div className="row">
            <select value={newSub} onChange={(e) => setNewSub(e.target.value)} aria-label="Subgênero para incluir">
              <option value="">Escolher subgênero…</option>
              {missingSubs.map((s) => (
                <option key={s.key} value={s.key}>
                  {s.label}
                </option>
              ))}
            </select>
            <button type="button" className="btn" disabled={!newSub || busy} onClick={() => void change({ subgenres: [{ key: newSub, pref: 'like' }] }).then(() => setNewSub(''))}>
              Gosto
            </button>
            <button type="button" className="btn" disabled={!newSub || busy} onClick={() => void change({ subgenres: [{ key: newSub, pref: 'dislike' }] }).then(() => setNewSub(''))}>
              Não gosto
            </button>
          </div>
        </details>
      )}
    </>
  );
}
