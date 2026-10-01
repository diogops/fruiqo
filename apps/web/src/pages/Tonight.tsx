// D-25: "O que assistir hoje?" — disponível em qualquer tela (botão no cabeçalho). Você escolhe o tipo
// (filme/série, livro ou música), um gênero e conta o humor se quiser; a IA sugere 5 pelo seu perfil,
// o servidor confere e tira o que você já assistiu/leu/ouviu e (filme/série) o que não está nos seus
// streamings. "Novas sugestões" não repete; "Já assisti" grava e não volta. Nada de regra aqui.
import { TMDB_ATTRIBUTION, TONIGHT_MOOD_MAX_CHARS, tmdbPageUrl, type TonightRequest, type TonightResponse } from '@fruiqo/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import { api } from '../api/client';
import { ErrorNote, Modal } from '../components/shared';
import { useToast } from '../components/Toast';
import { Icon, Thumb, WorkLink } from '../components/ui';
import { kindLabel } from '../labels';

type KindChoice = '' | 'movie' | 'series' | 'book' | 'music';
const KINDS: { value: KindChoice; label: string }[] = [
  { value: '', label: 'Filme ou série' },
  { value: 'movie', label: 'Filme' },
  { value: 'series', label: 'Série' },
  { value: 'book', label: 'Livro' },
  { value: 'music', label: 'Música' },
];
const MUSIC_GENRES = ['MPB', 'Samba', 'Bossa nova', 'Rock', 'Pop', 'Indie', 'Jazz', 'Blues', 'Eletrônica', 'Hip hop', 'Sertanejo', 'Forró', 'Clássica', 'Trilha sonora'];

const UNAVAILABLE: Record<NonNullable<TonightResponse['unavailable']>, string> = {
  disabled: 'IA desligada no servidor: sugestões pela busca local nos seus streamings.',
  consent: 'IA não permitida: sugestões pela busca local nos seus streamings.',
  quota: 'A cota de IA de hoje acabou: sugestões pela busca local.',
  failed: 'A IA não respondeu agora: sugestões pela busca local.',
  no_profile: 'Conte seu gosto no Perfil (resumo, favoritos ou níveis) para a IA acertar mais.',
};

/** Sugestão normalizada (filme/série, livro ou música) para a mesma lista. */
interface Pick {
  key: string;
  title: string;
  sub: string;
  posterUrl?: string;
  page?: { url: string; label: string };
  reason?: string;
  availableOn: string[];
  wantLabel: string;
  doneLabel: string;
  want: () => Promise<unknown>;
  done: () => Promise<unknown>;
}

function picksOf(data: TonightResponse | undefined): Pick[] {
  if (!data) return [];
  const media: Pick[] = data.items.map((it) => ({
    key: `${it.mediaType}:${it.tmdbId}`,
    title: it.title,
    sub: [kindLabel(it.kind), it.year, it.cast.slice(0, 2).join(', ')].filter(Boolean).join(' · '),
    posterUrl: it.posterUrl,
    page: { url: tmdbPageUrl(it.mediaType, it.tmdbId), label: 'TMDB' },
    reason: it.aiReason,
    availableOn: it.availableOn,
    wantLabel: 'Quero assistir',
    doneLabel: 'Já assisti',
    want: () => api.importTitles({ items: [{ tmdbId: it.tmdbId, mediaType: it.mediaType }] }),
    done: () => api.tonightWatched({ tmdbId: it.tmdbId, mediaType: it.mediaType }),
  }));
  const books: Pick[] = (data.books ?? []).map((b) => ({
    key: `book:${b.olWorkId}`,
    title: b.title,
    sub: ['Livro', b.year, b.authors.slice(0, 2).join(', ')].filter(Boolean).join(' · '),
    posterUrl: b.coverUrl,
    page: { url: b.url, label: 'Open Library' },
    reason: b.aiReason,
    availableOn: [],
    wantLabel: 'Quero ler',
    doneLabel: 'Já li',
    want: () => api.importTitles({ items: [], books: [{ olWorkId: b.olWorkId }] }),
    done: () => api.tonightWatched({ olWorkId: b.olWorkId }),
  }));
  const music: Pick[] = (data.music ?? []).map((m) => ({
    key: m.key,
    title: m.title,
    sub: [kindLabel(m.kind), m.year, m.artist].filter(Boolean).join(' · '),
    reason: m.aiReason,
    availableOn: [],
    wantLabel: 'Quero ouvir',
    doneLabel: 'Já ouvi',
    want: () => api.createTitle({ title: m.title, kind: m.kind, ...(m.artist ? { creator: m.artist } : {}) }),
    done: () => api.tonightWatched({ music: { title: m.title, kind: m.kind, ...(m.artist ? { artist: m.artist } : {}) } }),
  }));
  return [...media, ...books, ...music];
}

export function TonightPanel({ onClose }: { onClose: () => void }) {
  const taxonomy = useQuery({ queryKey: ['taxonomy'], queryFn: api.taxonomy, staleTime: Infinity });
  const qc = useQueryClient();
  const toast = useToast();
  const [kind, setKind] = useState<KindChoice>('');
  const [genre, setGenre] = useState('');
  const [mood, setMood] = useState('');
  // tudo o que já apareceu nesta rodada: "novas sugestões" não repetem
  const [shown, setShown] = useState<string[]>([]);
  const [gone, setGone] = useState<Set<string>>(new Set());
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [actionError, setActionError] = useState<unknown>(null);

  const ask = useMutation({
    mutationFn: (exclude: string[]) => {
      const body: TonightRequest = {
        ...(kind ? { kind } : {}),
        ...(genre ? { genre } : {}),
        ...(mood.trim() ? { mood: mood.trim() } : {}),
        ...(exclude.length ? { exclude: exclude.slice(-100) } : {}),
      };
      return api.tonight(body);
    },
    onSuccess: (data) => {
      setGone(new Set());
      setShown((s) => [...new Set([...s, ...picksOf(data).map((p) => p.key)])]);
    },
  });
  const data = ask.data;
  const picks = picksOf(data).filter((p) => !gone.has(p.key));
  const genres = kind === 'music' ? MUSIC_GENRES.map((g) => ({ key: g, label: g })) : (taxonomy.data?.genres ?? []);

  function changeKind(k: KindChoice) {
    setKind(k);
    setGenre('');
    setShown([]);
    ask.reset();
  }

  function submit(e?: FormEvent) {
    e?.preventDefault();
    ask.mutate([]);
  }

  async function act(p: Pick, which: 'want' | 'done') {
    setBusyKey(p.key);
    setActionError(null);
    try {
      await (which === 'want' ? p.want() : p.done());
      setGone((g) => new Set(g).add(p.key));
      await qc.invalidateQueries();
      toast.show(which === 'want' ? `"${p.title}" na Minha Área.` : `"${p.title}" marcado; não será sugerido de novo.`);
    } catch (err) {
      setActionError(err);
    } finally {
      setBusyKey(null);
    }
  }

  return (
    <Modal title="O que assistir hoje?" onClose={onClose}>
      <form className="form tonight-form" onSubmit={submit}>
        <div className="chips" role="radiogroup" aria-label="O que você quer">
          {KINDS.map((k) => (
            <button key={k.value || 'video'} type="button" role="radio" aria-checked={kind === k.value} className={kind === k.value ? 'chip chip-on' : 'chip'} onClick={() => changeKind(k.value)}>
              {k.label}
            </button>
          ))}
        </div>
        <div className="row tonight-row">
          <label className="grow">
            <span className="sr-only">Gênero</span>
            <select value={genre} onChange={(e) => setGenre(e.target.value)} aria-label="Gênero">
              <option value="">Qualquer gênero</option>
              {genres.map((g) => (
                <option key={g.key} value={g.key}>
                  {g.label}
                </option>
              ))}
            </select>
          </label>
        </div>
        <label>
          Como você está hoje? (opcional)
          <input
            value={mood}
            onChange={(e) => setMood(e.target.value)}
            maxLength={TONIGHT_MOOD_MAX_CHARS}
            placeholder="Ex.: cansado, quero algo leve e curto"
            autoFocus
          />
        </label>
        <div className="actions">
          <button type="submit" className="btn btn-primary" disabled={ask.isPending} aria-busy={ask.isPending}>
            <Icon name="sparkles" size={14} /> {ask.isPending ? 'Procurando…' : data ? 'Buscar de novo' : 'Sugerir'}
          </button>
        </div>
      </form>

      <ErrorNote error={ask.error ?? actionError} />
      {ask.isPending && <p className="muted small" role="status">A IA está escolhendo pelo seu perfil; pode levar alguns segundos.</p>}

      {data?.risk && (
        <div className="card risk-card" role="alert">
          <strong>{data.risk.title}</strong>
          <p>{data.risk.message}</p>
          <p>
            CVV: <a href={`tel:${data.risk.cvvPhone}`}>{data.risk.cvvPhone}</a> ·{' '}
            <a href={data.risk.cvvUrl} target="_blank" rel="noreferrer">
              cvv.org.br
            </a>{' '}
            · Emergência: <a href={`tel:${data.risk.emergencyPhone}`}>{data.risk.emergencyPhone}</a>
          </p>
        </div>
      )}

      {data && !data.risk && (
        <>
          <p className="muted small tonight-note" role="status">
            {data.aiUsed && (
              <span className="badge badge-ai">
                <Icon name="sparkles" size={12} /> escolhido pela IA
              </span>
            )}{' '}
            {data.unavailable && UNAVAILABLE[data.unavailable]}
            {data.unavailable === 'consent' && (
              <>
                {' '}
                Permita em <Link to="/perfil">Perfil</Link>.
              </>
            )}{' '}
            {(kind === '' || kind === 'movie' || kind === 'series') &&
              (data.services.length > 0 ? (
                `Só o que está em: ${data.services.join(', ')}.`
              ) : (
                <>
                  Cadastre seus streamings no <Link to="/perfil">Perfil</Link> para ver só o que você assiste.
                </>
              ))}
            {kind === 'music' && data.aiUsed && ' Sugestões da IA, sem conferência em catálogo.'}
          </p>
          {picks.length === 0 && <p className="muted">Nada novo desta vez. Mude o gênero ou o humor e busque de novo.</p>}
          <ul className="search-results tonight-results" aria-label="Sugestões para hoje">
            {picks.map((p) => (
              <li key={p.key} className="search-card">
                <WorkLink href={p.page?.url} label={`Ver ${p.title}${p.page ? ` no ${p.page.label}` : ''}`} className="work-link-thumb">
                  <Thumb src={p.posterUrl} title={p.title} width={54} height={81} />
                </WorkLink>
                <div className="grow">
                  <WorkLink href={p.page?.url} label={`Ver ${p.title}${p.page ? ` no ${p.page.label}` : ''}`}>
                    <strong>{p.title}</strong>
                    {p.page && <Icon name="external" size={13} className="work-ext-icon" />}
                  </WorkLink>
                  <div className="muted small">{p.sub}</div>
                  {p.availableOn.length > 0 && <div className="small">Em: {p.availableOn.join(', ')}</div>}
                  {p.reason && (
                    <p className="small ai-reason">
                      <Icon name="sparkles" size={12} /> {p.reason}
                    </p>
                  )}
                  <div className="row tonight-actions">
                    <button type="button" className="btn" disabled={busyKey === p.key} onClick={() => void act(p, 'want')}>
                      {p.wantLabel}
                    </button>
                    <button type="button" className="btn btn-link" disabled={busyKey === p.key} onClick={() => void act(p, 'done')}>
                      <Icon name="check" size={14} /> {p.doneLabel}
                    </button>
                  </div>
                </div>
              </li>
            ))}
          </ul>
          <div className="actions">
            <button type="button" className="btn" disabled={ask.isPending} onClick={() => ask.mutate(shown)}>
              <Icon name="refresh" size={14} /> Novas sugestões
            </button>
          </div>
          {data.request && (
            <details className="small tonight-request">
              <summary>Ver o pedido enviado à IA</summary>
              <pre>{data.request}</pre>
            </details>
          )}
          {data.items.length > 0 && <p className="attribution small">{TMDB_ATTRIBUTION}</p>}
        </>
      )}
    </Modal>
  );
}
