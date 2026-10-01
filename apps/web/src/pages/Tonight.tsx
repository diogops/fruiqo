// D-25: "O que assistir hoje?" — disponível em qualquer tela (botão no cabeçalho). Você escolhe o tipo
// (filme/série, livro ou música), um gênero e conta o humor se quiser; a IA sugere 5 pelo seu perfil,
// o servidor confere e tira o que você já assistiu/leu/ouviu e (filme/série) o que não está nos seus
// streamings. "Novas sugestões" não repete; "Já assisti" grava e não volta. Nada de regra aqui.
import {
  MAX_TASTE_SUMMARY_CHARS,
  TMDB_ATTRIBUTION,
  TONIGHT_MOOD_MAX_CHARS,
  tmdbPageUrl,
  type TasteLevel,
  type TonightDefaults,
  type TonightRequest,
  type TonightResponse,
} from '@fruiqo/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState, type FormEvent } from 'react';
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

const GROUP_LABEL = { love: 'Do que você mais gosta', like: 'Também gosta', neutral: 'Outros', avoid: 'Você evita' } as const;
type Group = TonightDefaults['genres'][number]['group'];
type SubPref = 'like' | 'dislike' | null;
/** toque no chip: neutro → gosto → adoro → evito → neutro */
const NEXT_GROUP: Record<Group, Group> = { neutral: 'like', like: 'love', love: 'avoid', avoid: 'neutral' };
const NEXT_SUB: Record<'none' | 'like' | 'dislike', SubPref> = { none: 'like', like: 'dislike', dislike: null };
const CHIP_GROUP_LABEL: Record<Group, string> = { love: 'adoro', like: 'gosto', neutral: 'neutro', avoid: 'evito' };
/** "Salvar no meu perfil": grupo → nível do Perfil (neutro limpa; evito = não curto) */
const GROUP_LEVEL: Record<Exclude<Group, 'neutral'>, TasteLevel> = { love: 'love', like: 'like', avoid: 'dislike' };

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
  // gêneros na ordem do seu gosto e o tipo que você mais vê (o servidor calcula)
  const defaults = useQuery({ queryKey: ['tonight-defaults'], queryFn: api.tonightDefaults, staleTime: 5 * 60_000 });
  const qc = useQueryClient();
  const toast = useToast();
  const [kind, setKind] = useState<KindChoice>('');
  const [genre, setGenre] = useState('');
  const [mood, setMood] = useState('');
  // streamings desta busca (padrão: os do Perfil); nenhum = em qualquer lugar
  const [services, setServices] = useState<Set<string> | null>(null);
  // "Avançado": o perfil só para esta busca, já preenchido com o salvo
  const [adv, setAdv] = useState<{ summary: string; genres: Record<string, Group>; subs: Record<string, SubPref> } | null>(null);
  const [advChanged, setAdvChanged] = useState(false);
  const [advOpen, setAdvOpen] = useState(false);
  // nesta rodada você aceitou alguma sugestão? (sem nenhuma, a lista vazia busca de novo sozinha)
  const [wanted, setWanted] = useState(false);
  const [savingProfile, setSavingProfile] = useState(false);
  // tudo o que já apareceu nesta rodada: "novas sugestões" não repetem
  const [shown, setShown] = useState<string[]>([]);
  const [gone, setGone] = useState<Set<string>>(new Set());
  const [busyKey, setBusyKey] = useState<string | null>(null);
  // abre no tipo que você mais vê, até você escolher outro
  const touched = useRef(false);
  useEffect(() => {
    const d = defaults.data;
    if (!d) return;
    if (!touched.current && d.kind) setKind(d.kind);
    setServices((cur) => cur ?? new Set(d.services.filter((x) => x.selected).map((x) => x.key)));
    setAdv(
      (cur) =>
        cur ?? {
          summary: d.summary ?? '',
          genres: Object.fromEntries(d.genres.map((g) => [g.key, g.group])),
          subs: Object.fromEntries(d.subgenres.map((x) => [x.key, x.pref])),
        },
    );
  }, [defaults.data]);
  const [actionError, setActionError] = useState<unknown>(null);

  const ask = useMutation({
    mutationFn: (exclude: string[]) => {
      const body: TonightRequest = {
        ...(kind ? { kind } : {}),
        ...(genre ? { genre } : {}),
        ...(mood.trim() ? { mood: mood.trim() } : {}),
        ...(exclude.length ? { exclude: exclude.slice(-100) } : {}),
        ...(video && services ? { services: [...services] } : {}),
        ...(advChanged && adv
          ? {
              profile: {
                summary: adv.summary,
                genres: Object.entries(adv.genres).map(([key, group]) => ({ key, group })),
                subgenres: Object.entries(adv.subs).flatMap(([key, pref]) => (pref ? [{ key, pref }] : [])),
              },
            }
          : {}),
      };
      return api.tonight(body);
    },
    onSuccess: (data) => {
      setGone(new Set());
      setWanted(false);
      setShown((s) => [...new Set([...s, ...picksOf(data).map((p) => p.key)])]);
    },
  });
  const data = ask.data;
  const video = kind === '' || kind === 'movie' || kind === 'series';
  const picks = picksOf(data).filter((p) => !gone.has(p.key));
  const ranked = (defaults.data?.genres ?? []).filter((g) => !video || g.forVideo);
  const groups = (['love', 'like', 'neutral', 'avoid'] as const).map((grp) => ({ grp, items: ranked.filter((g) => g.group === grp) })).filter((g) => g.items.length > 0);
  const top = defaults.data?.top ?? [];
  const anyLabel = kind !== 'music' && top.length > 0 ? `Do seu gosto (${top.join(', ')})` : 'Qualquer gênero';

  function changeKind(k: KindChoice) {
    touched.current = true;
    setKind(k);
    setGenre('');
    setShown([]);
    ask.reset();
  }

  function toggleService(key: string | null) {
    setServices((cur) => {
      if (key === null) return new Set();
      const n = new Set(cur ?? []);
      if (n.has(key)) n.delete(key);
      else n.add(key);
      return n;
    });
  }

  function editAdv(patch: (a: NonNullable<typeof adv>) => NonNullable<typeof adv>) {
    setAdv((a) => (a ? patch(a) : a));
    setAdvChanged(true);
  }

  /** Leva o que mudou no "Avançado" para o Perfil (resumo, níveis de gênero e subgêneros). */
  async function saveProfile() {
    const d = defaults.data;
    if (!d || !adv) return;
    setSavingProfile(true);
    setActionError(null);
    try {
      if ((d.summary ?? '') !== adv.summary) await api.updateSummary(adv.summary.trim());
      const changed = d.genres.filter((g) => adv.genres[g.key] !== g.group);
      const levels = changed.flatMap((g) => {
        const grp = adv.genres[g.key]!;
        return grp === 'neutral' ? [] : [{ key: g.key, level: GROUP_LEVEL[grp] }];
      });
      const clear = changed.filter((g) => adv.genres[g.key] === 'neutral').map((g) => g.key);
      const subgenres = d.subgenres.filter((x) => (adv.subs[x.key] ?? null) !== x.pref).map((x) => ({ key: x.key, pref: adv.subs[x.key] ?? null }));
      if (levels.length || clear.length || subgenres.length) {
        await api.updateTaste({ ...(levels.length ? { levels } : {}), ...(clear.length ? { clear } : {}), ...(subgenres.length ? { subgenres } : {}) });
      }
      await qc.invalidateQueries();
      setAdvChanged(false);
      toast.show('Perfil atualizado.');
    } catch (err) {
      setActionError(err);
    } finally {
      setSavingProfile(false);
    }
  }

  function submit(e?: FormEvent) {
    e?.preventDefault();
    ask.mutate([]);
  }

  /** "Hoje não": sai desta busca (e das "novas sugestões" dela), sem gravar nada */
  function skip(p: Pick) {
    setGone((g) => new Set(g).add(p.key));
  }

  // tudo recusado (já assisti / hoje não) sem nenhum "quero": busca de novo sozinha, sem repetir
  const offered = picksOf(data).length;
  useEffect(() => {
    if (offered > 0 && picks.length === 0 && !wanted && !ask.isPending && !data?.risk) ask.mutate(shown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [picks.length]);

  async function act(p: Pick, which: 'want' | 'done') {
    setBusyKey(p.key);
    setActionError(null);
    try {
      await (which === 'want' ? p.want() : p.done());
      if (which === 'want') setWanted(true);
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
    <Modal
      title="O que assistir hoje?"
      onClose={onClose}
      actions={
        <button
          type="button"
          className={advOpen || advChanged ? 'icon-only active' : 'icon-only'}
          aria-label="Avançado: mudar o perfil só nesta busca"
          title="Avançado: mudar o perfil só nesta busca"
          aria-expanded={advOpen}
          aria-controls="tonight-advanced"
          onClick={() => setAdvOpen((o) => !o)}
        >
          <Icon name="filter" size={18} />
        </button>
      }
    >
      <form className="form tonight-form" onSubmit={submit}>
        <div className="row tonight-row">
          <label>
            <span className="sr-only">O que você quer</span>
            <select value={kind} onChange={(e) => changeKind(e.target.value as KindChoice)} aria-label="O que você quer">
              {KINDS.map((k) => (
                <option key={k.value || 'video'} value={k.value}>
                  {k.label}
                </option>
              ))}
            </select>
          </label>
          <label className="grow">
            <span className="sr-only">Gênero</span>
            <select value={genre} onChange={(e) => setGenre(e.target.value)} aria-label="Gênero">
              <option value="">{anyLabel}</option>
              {kind === 'music'
                ? MUSIC_GENRES.map((g) => (
                    <option key={g} value={g}>
                      {g}
                    </option>
                  ))
                : groups.map(({ grp, items }) => (
                    <optgroup key={grp} label={GROUP_LABEL[grp]}>
                      {items.map((g) => (
                        <option key={g.key} value={g.key}>
                          {g.label}
                        </option>
                      ))}
                    </optgroup>
                  ))}
            </select>
          </label>
        </div>
        {video && defaults.data && services && (
          <details className="tonight-where">
            <summary>
              Onde:{' '}
              <strong>
                {services.size === 0
                  ? 'qualquer lugar'
                  : defaults.data.services
                      .filter((x) => services.has(x.key))
                      .map((x) => x.label)
                      .join(', ')}
              </strong>
            </summary>
          <div className="chips tonight-services" role="group" aria-label="Onde procurar">
            <button type="button" className={services.size === 0 ? 'chip chip-on' : 'chip'} aria-pressed={services.size === 0} onClick={() => toggleService(null)}>
              Qualquer lugar
            </button>
            {defaults.data.services.map((x) => (
              <button key={x.key} type="button" className={services.has(x.key) ? 'chip chip-on' : 'chip'} aria-pressed={services.has(x.key)} onClick={() => toggleService(x.key)}>
                {x.label}
              </button>
            ))}
          </div>
          </details>
        )}
        <label>
          {kind === 'book' ? 'O que você quer ler?' : kind === 'music' ? 'O que você quer ouvir?' : 'O que você quer assistir?'} (opcional)
          <input
            value={mood}
            onChange={(e) => setMood(e.target.value)}
            maxLength={TONIGHT_MOOD_MAX_CHARS}
            placeholder={
              kind === 'book'
                ? 'Ex.: algo leve para ler antes de dormir'
                : kind === 'music'
                  ? 'Ex.: algo animado para cozinhar'
                  : 'Ex.: cansado, quero algo leve e curto'
            }
            // o foco começa aqui (o Modal foca o [data-autofocus] antes do primeiro campo)
            data-autofocus
          />
        </label>
        {adv && defaults.data && (
          <section id="tonight-advanced" className="tonight-advanced" hidden={!advOpen} aria-label="Perfil só nesta busca">
            <p className="small tonight-adv-title">
              <strong>Perfil só nesta busca</strong>
              {advChanged ? ' · alterado' : ''}
            </p>
            <label>
              Resumo do gosto
              <textarea
                rows={3}
                maxLength={MAX_TASTE_SUMMARY_CHARS}
                value={adv.summary}
                onChange={(e) => {
                  const summary = e.target.value;
                  editAdv((a) => ({ ...a, summary }));
                }}
              />
            </label>
            <p className="muted small">Gêneros (toque para mudar: neutro → gosto → adoro → evito)</p>
            <div className="chips" role="group" aria-label="Gêneros desta busca">
              {defaults.data.genres
                .filter((g) => !video || g.forVideo)
                .map((g) => {
                  const grp = adv.genres[g.key] ?? 'neutral';
                  return (
                    <button
                      key={g.key}
                      type="button"
                      className={`chip adv-${grp}`}
                      aria-label={`${g.label}: ${CHIP_GROUP_LABEL[grp]}`}
                      onClick={() => editAdv((a) => ({ ...a, genres: { ...a.genres, [g.key]: NEXT_GROUP[grp] } }))}
                    >
                      {grp === 'love' ? '★ ' : grp === 'avoid' ? '✕ ' : ''}
                      {g.label}
                    </button>
                  );
                })}
            </div>
            <p className="muted small">Subgêneros (toque: gosto → não gosto → neutro)</p>
            <div className="chips" role="group" aria-label="Subgêneros desta busca">
              {defaults.data.subgenres.map((x) => {
                const pref = adv.subs[x.key] ?? null;
                return (
                  <button
                    key={x.key}
                    type="button"
                    className={`chip sub-pref sub-${pref ?? 'none'}`}
                    aria-label={`${x.label}: ${pref === 'like' ? 'gosto' : pref === 'dislike' ? 'não gosto' : 'neutro'}`}
                    onClick={() => editAdv((a) => ({ ...a, subs: { ...a.subs, [x.key]: NEXT_SUB[pref ?? 'none'] } }))}
                  >
                    {x.label}
                  </button>
                );
              })}
            </div>
            <div className="row tonight-actions">
              <button type="button" className="btn" disabled={!advChanged || savingProfile} onClick={() => void saveProfile()}>
                {savingProfile ? 'Salvando…' : 'Salvar no meu perfil'}
              </button>
              <span className="muted small">Sem salvar, as mudanças valem só para esta busca.</span>
            </div>
          </section>
        )}
        <div className="actions tonight-submit">
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
              ) : defaults.data?.services.some((x) => x.selected) ? (
                'Em qualquer lugar.'
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
                  <div className="muted small tonight-sub">{p.sub}</div>
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
                    <button type="button" className="btn btn-link muted" disabled={busyKey === p.key} onClick={() => skip(p)} aria-label={`Hoje não: ${p.title}`}>
                      <Icon name="x" size={14} /> Hoje não
                    </button>
                  </div>
                </div>
              </li>
            ))}
          </ul>
          <div className="actions tonight-more">
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
