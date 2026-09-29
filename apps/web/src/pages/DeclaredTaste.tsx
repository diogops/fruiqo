// RF-43: gosto declarado. O usuário conta do que gosta (favoritos com nota/comentário e um resumo livre)
// e vê exatamente o que as regras entenderam, podendo corrigir (fixar/excluir) cada gênero.
import { MAX_TASTE_SUMMARY_CHARS, type CreateFavoriteRequest, type DeclaredAffinity, type TaxonomyTag } from '@fruiqo/contracts';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState, type FormEvent } from 'react';
import { api } from '../api/client';
import { ErrorNote, Modal } from '../components/shared';
import { useToast } from '../components/Toast';
import { Icon, StarRating, Thumb } from '../components/ui';
import { kindLabel } from '../labels';
import { TitleSearch, type SearchPick } from './AddTitle';

export const DECLARED_KEY = ['profile-declared'] as const;

const AFFINITY_SOURCE: Record<DeclaredAffinity['source'], string> = {
  favorites: 'dos favoritos',
  summary: 'do resumo',
  both: 'favoritos + resumo',
};

export function DeclaredTasteSection() {
  const declared = useQuery({ queryKey: DECLARED_KEY, queryFn: api.declared });
  const qc = useQueryClient();
  const toast = useToast();
  const [summary, setSummary] = useState('');
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    if (declared.data && !dirty) setSummary(declared.data.summary ?? '');
  }, [declared.data, dirty]);

  async function refresh() {
    await Promise.all([qc.invalidateQueries({ queryKey: DECLARED_KEY }), qc.invalidateQueries({ queryKey: ['taste'] })]);
  }

  async function saveSummary(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      qc.setQueryData(DECLARED_KEY, await api.updateSummary(summary.trim()));
      setDirty(false);
      await qc.invalidateQueries({ queryKey: ['taste'] });
      toast.show('Resumo salvo. Veja abaixo o que entendemos.');
    } catch (err) {
      setError(err);
    } finally {
      setSaving(false);
    }
  }

  async function removeFavorite(id: string, title: string) {
    try {
      await api.deleteFavorite(id);
      await refresh();
      toast.show(`"${title}" saiu dos favoritos.`);
    } catch (err) {
      setError(err);
    }
  }

  async function adjust(body: Parameters<typeof api.updateTaste>[0]) {
    try {
      await api.updateTaste(body);
      await refresh();
    } catch (err) {
      setError(err);
    }
  }

  const d = declared.data;
  const interpreted = d?.interpreted;
  const groups: [string, TaxonomyTag[], 'like' | 'dislike'][] = interpreted
    ? [
        ['Gosta de', interpreted.likes, 'like'],
        ['Subgêneros que gosta', interpreted.likedSubgenres, 'like'],
        ['Não gosta de', interpreted.dislikes, 'dislike'],
        ['Subgêneros que evita', interpreted.dislikedSubgenres, 'dislike'],
      ]
    : [];
  const hasInterpretation = groups.some(([, tags]) => tags.length > 0) || (d?.affinities.length ?? 0) > 0;

  return (
    <div className="declared">
      <h2>Do que você gosta</h2>
      <p className="muted small">
        Conte com suas palavras e marque favoritos. Isso ajuda a ordenar a fila e o encaixe de novos títulos desde o primeiro
        dia, mesmo sem histórico.
      </p>
      <ErrorNote error={declared.error ?? error} />

      <div className="declared-grid">
        <form className="card form" onSubmit={saveSummary}>
          <label htmlFor="taste-summary">
            <strong>Resumo do seu gosto</strong>
          </label>
          <textarea
            id="taste-summary"
            rows={6}
            maxLength={MAX_TASTE_SUMMARY_CHARS}
            placeholder="Ex.: adoro suspense psicológico e séries policiais nórdicas; comédias românticas não são comigo."
            value={summary}
            onChange={(e) => {
              setSummary(e.target.value);
              setDirty(true);
            }}
            aria-describedby="taste-summary-count"
          />
          <div className="row between">
            <span id="taste-summary-count" className={summary.length >= MAX_TASTE_SUMMARY_CHARS ? 'small warn' : 'muted small'}>
              {summary.length}/{MAX_TASTE_SUMMARY_CHARS}
            </span>
            <button type="submit" className="btn btn-primary" disabled={saving || !dirty}>
              {saving ? 'Salvando…' : 'Salvar resumo'}
            </button>
          </div>
        </form>

        <div className="card">
          <div className="row between">
            <strong>Favoritos</strong>
            <button type="button" className="btn" onClick={() => setAdding(true)}>
              <Icon name="plus" size={14} /> Adicionar favorito
            </button>
          </div>
          {d && d.favorites.length === 0 && <p className="muted small">Nenhum favorito ainda.</p>}
          <ul className="favorites" aria-label="Favoritos">
            {(d?.favorites ?? []).map((f) => (
              <li key={f.id} className="favorite">
                <Thumb src={f.posterUrl} title={f.title} width={40} height={60} />
                <div className="grow">
                  <strong>{f.title}</strong>
                  <span className="muted small"> {[kindLabel(f.kind), f.year].filter(Boolean).join(' · ')}</span>
                  <div className="small">
                    <StarRating value={f.rating} size={14} />
                    {f.genres.length > 0 && <span className="muted"> {f.genres.map((g) => g.label).join(', ')}</span>}
                  </div>
                  {f.comment && <div className="small favorite-comment">“{f.comment}”</div>}
                </div>
                <button
                  type="button"
                  className="icon-btn"
                  aria-label={`Remover ${f.title} dos favoritos`}
                  onClick={() => void removeFavorite(f.id, f.title)}
                >
                  <Icon name="x" />
                </button>
              </li>
            ))}
          </ul>
        </div>
      </div>

      <section className="card interpreted" aria-label="O que entendemos">
        <strong>O que entendemos</strong>
        {!hasInterpretation && (
          <p className="muted small">Escreva um resumo ou adicione favoritos para ver aqui como o Fruiqo interpretou.</p>
        )}
        {groups
          .filter(([, tags]) => tags.length > 0)
          .map(([label, tags, polarity]) => (
            <div key={label} className="interpreted-group">
              <span className="muted small">{label}:</span>{' '}
              {tags.map((t) => (
                <span key={t.key} className={polarity === 'like' ? 'chip chip-pos' : 'chip chip-neg'}>
                  {t.label}
                  <button
                    type="button"
                    className="chip-x"
                    aria-label={polarity === 'like' ? `Não gosto de ${t.label}` : `Na verdade gosto de ${t.label}`}
                    title={polarity === 'like' ? 'Entendeu errado: excluir' : 'Entendeu errado: fixar como gosto'}
                    onClick={() => void adjust(polarity === 'like' ? { exclude: [t.key] } : { pin: [t.key] })}
                  >
                    {polarity === 'like' ? '×' : '↺'}
                  </button>
                </span>
              ))}
            </div>
          ))}
        {d && d.affinities.length > 0 && (
          <table className="table stack-table affinities">
            <thead>
              <tr>
                <th>Gênero</th>
                <th>Afinidade declarada</th>
                <th>Origem</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {d.affinities.map((a) => (
                <tr key={a.key}>
                  <td className="stack-title">{a.label}</td>
                  <td data-label="Afinidade">
                    <div className="affinity" title={a.score.toFixed(2)}>
                      <span className={a.score >= 0 ? 'pos' : 'neg'} style={{ width: `${Math.min(100, Math.abs(a.score) * 100)}%` }} />
                    </div>
                  </td>
                  <td className="small" data-label="Origem">
                    {AFFINITY_SOURCE[a.source]}
                  </td>
                  <td className="actions stack-actions">
                    <button type="button" className="btn btn-link" aria-label={`Fixar ${a.label}`} onClick={() => void adjust({ pin: [a.key] })}>
                      Fixar
                    </button>
                    <button type="button" className="btn btn-link" aria-label={`Excluir ${a.label}`} onClick={() => void adjust({ exclude: [a.key] })}>
                      Excluir
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {adding && (
        <AddFavorite
          onClose={() => setAdding(false)}
          onAdded={async (title) => {
            setAdding(false);
            await refresh();
            toast.show(`"${title}" adicionado aos favoritos.`);
          }}
        />
      )}
    </div>
  );
}

/** Escolher pela busca (RF-46) ou digitar o título; depois nota e comentário opcionais. */
/**
 * Corpo do favorito escolhido na busca: filme/série leva tmdbId/mediaType, livro leva olWorkId
 * (o servidor busca capa e gêneros na obra). Ano de livro antigo (antes de 1870, fora do contrato)
 * não vai: o servidor usa o da Open Library.
 */
export function favoriteRequest(picked: SearchPick): Omit<CreateFavoriteRequest, 'rating' | 'comment'> {
  const book = 'olWorkId' in picked.ref;
  const year = picked.year !== undefined && (!book || picked.year >= 1870) ? picked.year : undefined;
  return { title: picked.title, kind: picked.kind, ...(year !== undefined ? { year } : {}), ...picked.ref };
}

function AddFavorite({ onClose, onAdded }: { onClose: () => void; onAdded: (title: string) => Promise<void> }) {
  const [picked, setPicked] = useState<SearchPick | null>(null);
  const [manual, setManual] = useState('');
  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const title = picked?.title ?? manual.trim();
    if (!title) return;
    setBusy(true);
    setError(null);
    try {
      await api.addFavorite({
        ...(picked ? favoriteRequest(picked) : { title }),
        rating: rating || undefined,
        comment: comment.trim() || undefined,
      });
      await onAdded(title);
    } catch (err) {
      setError(err);
      setBusy(false);
    }
  }

  return (
    <Modal title="Adicionar favorito" onClose={onClose}>
      {!picked ? (
        <div className="form">
          <TitleSearch mode="pick" onPick={setPicked} />
          <details>
            <summary>Não achou? Digite o título</summary>
            <form className="row inline" onSubmit={submit}>
              <input
                className="grow"
                value={manual}
                onChange={(e) => setManual(e.target.value)}
                maxLength={200}
                placeholder="Título"
                aria-label="Título do favorito"
              />
              <button type="submit" className="btn" disabled={!manual.trim() || busy}>
                Adicionar
              </button>
            </form>
          </details>
          <ErrorNote error={error} />
        </div>
      ) : (
        <form className="form" onSubmit={submit}>
          <div className="row picked">
            <Thumb src={picked.posterUrl} title={picked.title} width={54} height={81} />
            <div className="grow">
              <strong>{picked.title}</strong>
              <div className="muted small">{[kindLabel(picked.kind), picked.year].filter(Boolean).join(' · ')}</div>
              <button type="button" className="btn btn-link" onClick={() => setPicked(null)}>
                Trocar
              </button>
            </div>
          </div>
          <fieldset>
            <legend>Nota (opcional)</legend>
            <StarRating value={rating || null} onChange={(v) => setRating(v ?? 0)} label="Nota" size={26} />
          </fieldset>
          <label>
            Comentário (opcional)
            <textarea rows={3} maxLength={500} value={comment} onChange={(e) => setComment(e.target.value)} placeholder="O que mais te marcou?" />
          </label>
          <ErrorNote error={error} />
          <div className="actions">
            <button type="button" className="btn" onClick={onClose}>
              Cancelar
            </button>
            <button type="submit" className="btn btn-primary" disabled={busy}>
              Adicionar aos favoritos
            </button>
          </div>
        </form>
      )}
    </Modal>
  );
}
