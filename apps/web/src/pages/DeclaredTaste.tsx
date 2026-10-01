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
  // D-25: resumo semi-automático (sugerido pelas escolhas ou melhorado pela IA); só vale depois de salvo
  const [drafting, setDrafting] = useState<'suggest' | 'improve' | null>(null);
  const [previous, setPrevious] = useState<string | null>(null);
  const [draftNote, setDraftNote] = useState<string | null>(null);

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

  async function draft(which: 'suggest' | 'improve') {
    setDrafting(which);
    setError(null);
    setDraftNote(null);
    try {
      const res = which === 'suggest' ? await api.summarySuggestion() : await api.improveSummary(summary.trim());
      if (which === 'improve' && !res.aiUsed) {
        setDraftNote(
          res.unavailable === 'consent'
            ? 'Para melhorar com IA, permita o uso da IA abaixo, em Privacidade.'
            : res.unavailable === 'disabled'
              ? 'A IA está desligada no servidor.'
              : 'A IA não conseguiu agora; tente de novo.',
        );
        return;
      }
      if (!res.summary.trim()) {
        setDraftNote('Ainda não há escolhas suficientes: marque favoritos ou níveis de gênero e tente de novo.');
        return;
      }
      setPrevious(summary);
      setSummary(res.summary);
      setDirty(true);
      setDraftNote(which === 'suggest' ? 'Sugerido pelas suas escolhas. Revise e salve.' : 'Melhorado pela IA. Revise e salve.');
    } catch (err) {
      setError(err);
    } finally {
      setDrafting(null);
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
          <div className="summary-tools">
            <button type="button" className="btn" disabled={drafting !== null} onClick={() => void draft('suggest')}>
              {drafting === 'suggest' ? 'Montando…' : 'Sugerir pelo meu perfil'}
            </button>
            <button type="button" className="btn" disabled={drafting !== null || summary.trim().length < 10} onClick={() => void draft('improve')}>
              <Icon name="sparkles" size={14} /> {drafting === 'improve' ? 'Melhorando…' : 'Melhorar com IA'}
            </button>
            {previous !== null && (
              <button
                type="button"
                className="btn btn-link"
                onClick={() => {
                  setSummary(previous);
                  setPrevious(null);
                  setDraftNote(null);
                }}
              >
                Desfazer
              </button>
            )}
          </div>
          {draftNote && (
            <p className="muted small" role="status">
              {draftNote}
            </p>
          )}
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
          onAdded={async (titles) => {
            await refresh();
            toast.show(titles.length === 1 ? `"${titles[0]}" adicionado aos favoritos.` : `${titles.length} favoritos adicionados.`);
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

type FavoritePick = SearchPick | { key: string; title: string; manual: true };

/**
 * Vários favoritos de uma vez: marque na busca (as marcações ficam entre uma busca e outra, e o que
 * a busca não acha entra digitado), depois dê a nota de cada um (opcional) e adicione todos.
 */
function AddFavorite({ onClose, onAdded }: { onClose: () => void; onAdded: (titles: string[]) => Promise<void> }) {
  const [picked, setPicked] = useState<Map<string, FavoritePick>>(new Map());
  const [step, setStep] = useState<'pick' | 'rate'>('pick');
  const [manual, setManual] = useState('');
  const [ratings, setRatings] = useState<Record<string, number>>({});
  const [comment, setComment] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const items = [...picked.values()];

  function toggle(r: FavoritePick) {
    setPicked((m) => {
      const n = new Map(m);
      if (n.has(r.key)) n.delete(r.key);
      else n.set(r.key, r);
      return n;
    });
  }

  function addManual(e: FormEvent) {
    e.preventDefault();
    const title = manual.trim();
    if (!title) return;
    const key = `manual:${title.toLowerCase()}`;
    if (!picked.has(key)) toggle({ key, title, manual: true });
    setManual('');
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (items.length === 0) return;
    setBusy(true);
    setError(null);
    const added: string[] = [];
    // um por vez, na ordem em que foram marcados; o que falhar fica na lista para tentar de novo
    for (const it of items) {
      try {
        await api.addFavorite({
          ...('manual' in it ? { title: it.title } : favoriteRequest(it)),
          rating: ratings[it.key] || undefined,
          comment: items.length === 1 ? comment.trim() || undefined : undefined,
        });
        added.push(it.title);
        setPicked((m) => {
          const n = new Map(m);
          n.delete(it.key);
          return n;
        });
      } catch (err) {
        setError(err);
      }
    }
    setBusy(false);
    if (added.length > 0) await onAdded(added);
    // tudo certo: fecha; se algo falhou, fica aberto só com o que falhou
    if (added.length === items.length) onClose();
  }

  return (
    <Modal title="Adicionar favoritos" onClose={onClose}>
      {step === 'pick' ? (
        <div className="form">
          <TitleSearch mode="import" allowTaken selected={new Set(picked.keys())} onToggle={toggle} />
          <details>
            <summary>Não achou? Digite o título</summary>
            <form className="row inline" onSubmit={addManual}>
              <input
                className="grow"
                value={manual}
                onChange={(e) => setManual(e.target.value)}
                maxLength={200}
                placeholder="Título"
                aria-label="Título do favorito"
              />
              <button type="submit" className="btn" disabled={!manual.trim()}>
                Incluir na seleção
              </button>
            </form>
          </details>
          {items.length > 0 && (
            <div className="chips fav-picked" aria-label="Selecionados">
              {items.map((it) => (
                <span key={it.key} className="chip chip-on">
                  {it.title}
                  <button type="button" className="btn-icon chip-x" aria-label={`Tirar ${it.title} da seleção`} onClick={() => toggle(it)}>
                    <Icon name="x" size={12} />
                  </button>
                </span>
              ))}
            </div>
          )}
          <div className="actions sticky-actions">
            <span className="muted small grow">{items.length} selecionado(s)</span>
            <button type="button" className="btn" onClick={onClose}>
              Cancelar
            </button>
            <button type="button" className="btn btn-primary" disabled={items.length === 0} onClick={() => setStep('rate')}>
              Continuar ({items.length})
            </button>
          </div>
        </div>
      ) : (
        <form className="form" onSubmit={submit}>
          <p className="muted small">Dê uma nota se quiser (opcional). A nota ajuda a entender o quanto você gosta de cada um.</p>
          <ul className="fav-rate-list" aria-label="Favoritos a adicionar">
            {items.map((it) => (
              <li key={it.key} className="row picked">
                {'manual' in it ? (
                  <span className="thumb thumb-fallback" style={{ width: 40, height: 60 }} aria-hidden="true" />
                ) : (
                  <Thumb src={it.posterUrl} title={it.title} width={40} height={60} />
                )}
                <div className="grow">
                  <strong>{it.title}</strong>
                  {!('manual' in it) && <div className="muted small">{[kindLabel(it.kind), it.year].filter(Boolean).join(' · ')}</div>}
                  <StarRating
                    value={ratings[it.key] || null}
                    onChange={(v) => setRatings((r) => ({ ...r, [it.key]: v ?? 0 }))}
                    label={items.length === 1 ? 'Nota' : `Nota de ${it.title}`}
                    size={22}
                  />
                </div>
                <button type="button" className="btn btn-icon" aria-label={`Tirar ${it.title}`} onClick={() => toggle(it)}>
                  <Icon name="x" size={16} />
                </button>
              </li>
            ))}
          </ul>
          {items.length === 1 && (
            <label>
              Comentário (opcional)
              <textarea rows={3} maxLength={500} value={comment} onChange={(e) => setComment(e.target.value)} placeholder="O que mais te marcou?" />
            </label>
          )}
          <ErrorNote error={error} />
          <div className="actions">
            <button type="button" className="btn" onClick={() => setStep('pick')}>
              Voltar à busca
            </button>
            <button type="submit" className="btn btn-primary" disabled={busy || items.length === 0} aria-busy={busy}>
              {busy ? 'Adicionando…' : items.length === 1 ? 'Adicionar aos favoritos' : `Adicionar ${items.length} aos favoritos`}
            </button>
          </div>
        </form>
      )}
    </Modal>
  );
}
