// D-25: "O que assistir hoje?" — página própria (/hoje), aberta pelo botão do cabeçalho. Você escolhe o
// tipo (filme/série, livro ou música), um gênero e conta o que quer; o servidor busca (Minha Área
// primeiro, depois seus streamings) e tira o que você já assistiu/leu/ouviu. Embaixo, prateleiras de
// lançamentos, ação e ficção científica nos seus streamings. "Novas sugestões" não repete; "Já assisti"
// grava e não volta. Nada de regra aqui: busca, ordem e prateleiras vêm do servidor.
import {
  MAX_TASTE_SUMMARY_CHARS,
  TONIGHT_MOOD_MAX_CHARS,
  tmdbPageUrl,
  type TasteLevel,
  type TitleSearchResult,
  type TonightDefaults,
  type TonightRequest,
  type TonightResponse,
  type TonightShelvesResponse,
} from '@fruiqo/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import { api } from '../api/client';
import { ErrorNote } from '../components/shared';
import { useToast } from '../components/Toast';
import { Icon, WorkLink } from '../components/ui';
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
  disabled: 'IA desligada: o pedido foi entendido sem IA.',
  consent: 'IA não permitida: o pedido foi entendido sem IA.',
  quota: 'A cota de IA de hoje acabou: o pedido foi entendido sem IA.',
  failed: 'A IA não respondeu agora: o pedido foi entendido sem IA.',
  no_profile: 'Conte seu gosto no Perfil (resumo, favoritos ou níveis) para a IA acertar mais.',
};

/** Sugestão normalizada (filme/série, livro ou música) para a mesma lista. */
interface Pick {
  key: string;
  title: string;
  sub: string;
  /** linha do título: ano (livro: ano · autor; música: artista · ano) */
  meta?: string;
  posterUrl?: string;
  page?: { url: string; label: string };
  reason?: string;
  availableOn: string[];
  /** compatibilidade com o pedido e com o perfil (0..100) */
  fit?: number;
  profileFit?: number;
  fromList?: boolean;
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
    ...(it.year ? { meta: String(it.year) } : {}),
    posterUrl: it.posterUrl,
    page: { url: tmdbPageUrl(it.mediaType, it.tmdbId), label: 'TMDB' },
    reason: it.aiReason,
    availableOn: it.availableOn,
    ...(it.fit != null ? { fit: it.fit } : {}),
    ...(it.profileFit != null ? { profileFit: it.profileFit } : {}),
    ...(it.fromList ? { fromList: true } : {}),
    wantLabel: it.fromList ? 'Assistir hoje' : 'Quero assistir',
    doneLabel: 'Já assisti',
    want: () => api.importTitles({ items: [{ tmdbId: it.tmdbId, mediaType: it.mediaType }] }),
    done: () => api.tonightWatched({ tmdbId: it.tmdbId, mediaType: it.mediaType }),
  }));
  const books: Pick[] = (data.books ?? []).map((b) => ({
    key: `book:${b.olWorkId}`,
    title: b.title,
    sub: ['Livro', b.year, b.authors.slice(0, 2).join(', ')].filter(Boolean).join(' · '),
    meta: [b.year, b.authors[0]].filter(Boolean).join(' · '),
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
    meta: [m.artist, m.year].filter(Boolean).join(' · '),
    reason: m.aiReason,
    availableOn: [],
    wantLabel: 'Quero ouvir',
    doneLabel: 'Já ouvi',
    want: () => api.createTitle({ title: m.title, kind: m.kind, ...(m.artist ? { creator: m.artist } : {}) }),
    done: () => api.tonightWatched({ music: { title: m.title, kind: m.kind, ...(m.artist ? { artist: m.artist } : {}) } }),
  }));
  return [...media, ...books, ...music];
}

export function TonightPage() {
  // o foco começa no campo de digitar o pedido
  const askRef = useRef<HTMLInputElement>(null);
  useEffect(() => askRef.current?.focus(), []);
  // gêneros na ordem do seu gosto e o tipo que você mais vê (o servidor calcula)
  const defaults = useQuery({ queryKey: ['tonight-defaults'], queryFn: api.tonightDefaults, staleTime: 5 * 60_000 });
  // a IA vai mesmo ser usada? (ligada no servidor e permitida por você)
  const settings = useQuery({ queryKey: ['settings'], queryFn: api.settings });
  const aiOn = Boolean(settings.data?.aiAvailable && settings.data?.aiConsent);
  const qc = useQueryClient();
  const toast = useToast();
  const [kind, setKind] = useState<KindChoice>('');
  const [genre, setGenre] = useState('');
  const [mood, setMood] = useState('');
  // filme/série: anime só quando pedido
  const [includeAnime, setIncludeAnime] = useState(false);
  // "Incluir já vistos" (padrão: não) e a Minha Área como 1ª fonte (padrão: sim)
  const [includeSeen, setIncludeSeen] = useState(false);
  const [includeQueue, setIncludeQueue] = useState(true);
  // uma sessão por abertura do painel: o servidor guarda o que já mostrou e o estoque
  const sessionId = useRef(crypto.randomUUID());
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
        ...(video && includeAnime ? { includeAnime: true } : {}),
        ...(includeSeen ? { includeSeen: true } : {}),
        ...(video && !includeQueue ? { includeQueue: false } : {}),
        sessionId: sessionId.current,
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

  // trocou tipo ou gênero com uma busca na tela: limpa e busca de novo (já com a escolha nova)
  const [restart, setRestart] = useState(0);
  useEffect(() => {
    if (restart > 0) ask.mutate(shownRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [restart]);

  function changeKind(k: KindChoice) {
    touched.current = true;
    const searched = Boolean(ask.data);
    setKind(k);
    setGenre('');
    setShown([]);
    ask.reset();
    if (searched) setRestart((n) => n + 1);
  }

  function changeSeen(on: boolean) {
    setIncludeSeen(on);
    if (ask.data) {
      ask.reset();
      setRestart((n) => n + 1);
    }
  }

  function changeQueue(on: boolean) {
    setIncludeQueue(on);
    if (ask.data) {
      ask.reset();
      setRestart((n) => n + 1);
    }
  }

  /** esgotou: procurar em qualquer lugar (sem filtro de streaming) */
  function searchAnywhere() {
    setServices(new Set());
    ask.reset();
    setRestart((n) => n + 1);
  }

  function changeAnime(on: boolean) {
    setIncludeAnime(on);
    if (ask.data) {
      ask.reset();
      setRestart((n) => n + 1);
    }
  }

  function changeGenre(g: string) {
    setGenre(g);
    if (ask.data) {
      ask.reset();
      setRestart((n) => n + 1);
    }
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

  // nada que já apareceu neste painel volta (nem em "Buscar de novo"); só zera ao trocar o tipo
  const shownRef = useRef(shown);
  shownRef.current = shown;

  function submit(e?: FormEvent) {
    e?.preventDefault();
    ask.mutate(shown);
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

  const placeholder =
    kind === 'book' ? 'Ex.: algo leve para ler' : kind === 'music' ? 'Ex.: algo animado para cozinhar' : 'Ex.: suspense nórdico, história real…';

  return (
    <div className="tonight-page">
      <section className="tonight-hero" aria-labelledby="tonight-title">
        <div className="tonight-hero-head">
          <h1 id="tonight-title">O que assistir hoje?</h1>
          <p className="tonight-hero-sub">Conte o que você quer. Procuro primeiro na sua lista e depois nos seus streamings.</p>
        </div>
        <form className="tonight-form" onSubmit={submit}>
          <div className="tonight-ask">
            <Icon name="sparkles" size={18} />
            <label className="sr-only" htmlFor="tonight-ask">
              {kind === 'book' ? 'O que você quer ler?' : kind === 'music' ? 'O que você quer ouvir?' : 'O que você quer assistir?'} (opcional)
            </label>
            <input
              id="tonight-ask"
              ref={askRef}
              value={mood}
              onChange={(e) => setMood(e.target.value)}
              maxLength={TONIGHT_MOOD_MAX_CHARS}
              placeholder={placeholder}
              autoComplete="off"
            />
            <button type="submit" className="btn btn-primary tonight-go" disabled={ask.isPending} aria-busy={ask.isPending}>
              {ask.isPending ? 'Procurando…' : data ? 'Buscar de novo' : 'Sugerir'}
            </button>
          </div>
          <div className="tonight-options">
            <label className="pill-select">
              <span className="sr-only">O que você quer</span>
              <select value={kind} onChange={(e) => changeKind(e.target.value as KindChoice)} aria-label="O que você quer">
                {KINDS.map((k) => (
                  <option key={k.value || 'video'} value={k.value}>
                    {k.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="pill-select grow">
              <span className="sr-only">Gênero</span>
              <select value={genre} onChange={(e) => changeGenre(e.target.value)} aria-label="Gênero">
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
            {video && (
              <label className="pill-check" title="Incluir animes e animações?">
                <input type="checkbox" aria-label="Incluir animes e animações?" checked={includeAnime} onChange={(e) => changeAnime(e.target.checked)} />
                <span aria-hidden="true">Animes</span>
              </label>
            )}
            <label className="pill-check" title="Incluir já vistos?">
              <input type="checkbox" aria-label="Incluir já vistos?" checked={includeSeen} onChange={(e) => changeSeen(e.target.checked)} />
              <span aria-hidden="true">Já vistos</span>
            </label>
            <button
              type="button"
              className={advOpen || advChanged ? 'pill-btn active' : 'pill-btn'}
              aria-label="Filtros: onde procurar e perfil desta busca"
              title="Filtros: onde procurar e perfil desta busca"
              aria-expanded={advOpen}
              aria-controls="tonight-advanced"
              onClick={() => setAdvOpen((o) => !o)}
            >
              <Icon name="filter" size={15} /> <span className="pill-btn-label">Filtros</span>
            </button>
          </div>
          {adv && defaults.data && (
            <section id="tonight-advanced" className="tonight-advanced" hidden={!advOpen} aria-label="Filtros desta busca">
              {video && (
                <label className="check small">
                  <input type="checkbox" checked={includeQueue} onChange={(e) => changeQueue(e.target.checked)} /> Começar pela minha lista (Quero assistir)
                </label>
              )}
              <p className="small tonight-adv-title">
                <strong>Filtros desta busca</strong>
                {advChanged ? ' · perfil alterado' : ''}
              </p>
              {video && services && (
                <div className="chips tonight-services" role="group" aria-label="Onde procurar">
                  <span className="muted small">Onde:</span>
                  <button type="button" className={services.size === 0 ? 'chip chip-on' : 'chip'} aria-pressed={services.size === 0} onClick={() => toggleService(null)}>
                    Qualquer lugar
                  </button>
                  {defaults.data.services.map((x) => (
                    <button key={x.key} type="button" className={services.has(x.key) ? 'chip chip-on' : 'chip'} aria-pressed={services.has(x.key)} onClick={() => toggleService(x.key)}>
                      {x.label}
                    </button>
                  ))}
                </div>
              )}
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
              <div className="row tonight-adv-actions">
                <button type="button" className="btn" disabled={!advChanged || savingProfile} onClick={() => void saveProfile()}>
                  {savingProfile ? 'Salvando…' : 'Salvar no meu perfil'}
                </button>
                <span className="muted small">Sem salvar, as mudanças valem só para esta busca.</span>
              </div>
            </section>
          )}
        </form>
      </section>

      <ErrorNote error={ask.error ?? actionError} />
      {ask.isPending && (
        <div className="tonight-loading" role="status" aria-live="polite">
          <div className="tonight-loading-card">
            <Icon name={aiOn ? 'sparkles' : 'search'} size={22} />
            <span>{aiOn ? 'Procurando pelo seu pedido e pelo seu perfil; pode levar alguns segundos.' : 'Procurando…'}</span>
          </div>
        </div>
      )}

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
        <section className="tonight-section" aria-labelledby="tonight-picks-title">
          <div className="tonight-section-head">
            <h2 id="tonight-picks-title">Para hoje</h2>
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
              {video &&
                (data.services.length > 0 ? null : defaults.data?.services.some((x) => x.selected) ? (
                  'Em qualquer lugar.'
                ) : (
                  <>
                    Cadastre seus streamings no <Link to="/perfil">Perfil</Link> para ver só o que você assiste.
                  </>
                ))}
              {kind === 'music' && data.aiUsed && ' Sugestões da IA, sem conferência em catálogo.'}
            </p>
          </div>
          {picks.length === 0 &&
            (data.exhausted ? (
              <div className="tonight-empty">
                <p className="muted">Não encontrei mais títulos inéditos com estes filtros.</p>
                {video && services && services.size > 0 && (
                  <button type="button" className="btn" onClick={searchAnywhere}>
                    Procurar em qualquer lugar
                  </button>
                )}
              </div>
            ) : (
              <p className="muted">Nada novo desta vez. Mude o gênero ou o pedido e busque de novo.</p>
            ))}
          <ul className="tonight-results" aria-label="Sugestões para hoje">
            {picks.map((p) => (
              <li key={p.key} className="tonight-card">
                <WorkLink href={p.page?.url} label={`Ver ${p.title}${p.page ? ` no ${p.page.label}` : ''}`} className="tonight-poster">
                  <Poster src={p.posterUrl} title={p.title} />
                  {p.fromList && <span className="poster-badge">Na sua lista</span>}
                </WorkLink>
                <div className="tonight-card-body">
                  <div className="tc-line">
                    <WorkLink href={p.page?.url} label={`Ver ${p.title}${p.page ? ` no ${p.page.label}` : ''}`}>
                      <strong className="tc-title">{p.title}</strong>
                    </WorkLink>
                    {p.meta && <span className="muted small"> · {p.meta}</span>}
                  </div>
                  {p.availableOn.length > 0 && <div className="tc-where small">Em: {p.availableOn.join(', ')}</div>}
                  {p.reason && (
                    <div className="tc-reason small muted" title={p.reason}>
                      {p.reason}
                    </div>
                  )}
                  <div className="tonight-actions">
                    <button type="button" className="btn btn-sm btn-primary" disabled={busyKey === p.key} onClick={() => void act(p, 'want')}>
                      {p.wantLabel}
                    </button>
                    <button type="button" className="btn btn-link btn-sm" disabled={busyKey === p.key} onClick={() => void act(p, 'done')}>
                      <Icon name="check" size={13} /> {p.doneLabel}
                    </button>
                    <button type="button" className="btn btn-link btn-sm muted" disabled={busyKey === p.key} onClick={() => skip(p)} aria-label={`Hoje não: ${p.title}`}>
                      <Icon name="x" size={13} /> Hoje não
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
        </section>
      )}

      {video && <Shelves />}
    </div>
  );
}

/** Capa grande (2:3); sem capa ou com erro, a inicial do título. */
function Poster({ src, title }: { src?: string | null; title: string }) {
  const [failed, setFailed] = useState<string | null>(null);
  const [loaded, setLoaded] = useState<string | null>(null);
  if (src && failed !== src)
    return (
      <img
        className={loaded === src ? 'poster loaded' : 'poster'}
        src={src}
        alt=""
        loading="lazy"
        onLoad={() => setLoaded(src)}
        onError={() => setFailed(src)}
      />
    );
  return (
    <span className="poster poster-fallback" aria-hidden="true">
      {title.trim().charAt(0).toUpperCase() || '?'}
    </span>
  );
}

/** Prateleiras do servidor: lançamentos, ação e ficção científica nos seus streamings. */
function Shelves() {
  const q = useQuery({ queryKey: ['tonight-shelves'], queryFn: api.tonightShelves, staleTime: 10 * 60_000 });
  if (q.isPending) {
    return (
      <div className="shelves" aria-hidden="true">
        {[0, 1].map((i) => (
          <div key={i} className="shelf">
            <div className="shelf-head">
              <span className="skeleton skeleton-title" />
            </div>
            <div className="shelf-rail">
              {[0, 1, 2, 3, 4, 5].map((j) => (
                <span key={j} className="shelf-card skeleton skeleton-poster" />
              ))}
            </div>
          </div>
        ))}
      </div>
    );
  }
  if (!q.data?.shelves.length) return null;
  return (
    <div className="shelves">
      {q.data.shelves.map((s) => (
        <Shelf key={s.key} shelf={s} />
      ))}
    </div>
  );
}

function Shelf({ shelf }: { shelf: TonightShelvesResponse['shelves'][number] }) {
  const rail = useRef<HTMLUListElement>(null);
  const qc = useQueryClient();
  const toast = useToast();
  const [added, setAdded] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<string | null>(null);
  const scroll = (dir: 1 | -1) => rail.current?.scrollBy({ left: dir * rail.current.clientWidth * 0.85, behavior: 'smooth' });

  async function want(it: TitleSearchResult) {
    const key = `${it.mediaType}:${it.tmdbId}`;
    setBusy(key);
    try {
      await api.importTitles({ items: [{ tmdbId: it.tmdbId, mediaType: it.mediaType }] });
      setAdded((a) => new Set(a).add(key));
      toast.show(`"${it.title}" na Minha Área.`);
      await qc.invalidateQueries({ predicate: (q) => q.queryKey[0] !== 'tonight-shelves' });
    } catch {
      toast.show(`Não deu para incluir "${it.title}" agora.`);
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="shelf" aria-labelledby={`shelf-${shelf.key}`}>
      <div className="shelf-head">
        <h2 id={`shelf-${shelf.key}`}>{shelf.label}</h2>
        <div className="shelf-nav">
          <button type="button" className="icon-btn" aria-label={`Voltar em ${shelf.label}`} onClick={() => scroll(-1)}>
            <Icon name="left" size={16} />
          </button>
          <button type="button" className="icon-btn" aria-label={`Avançar em ${shelf.label}`} onClick={() => scroll(1)}>
            <Icon name="right" size={16} />
          </button>
        </div>
      </div>
      <ul className="shelf-rail" ref={rail} aria-label={shelf.label}>
        {shelf.items.map((it) => {
          const key = `${it.mediaType}:${it.tmdbId}`;
          const mine = added.has(key) || (it.inLibrary && (it.inLibrary.status === 'to_watch' || it.inLibrary.status === 'watching'));
          return (
            <li key={key} className="shelf-card">
              <div className="shelf-cover">
                <WorkLink href={tmdbPageUrl(it.mediaType, it.tmdbId)} label={`Ver ${it.title} no TMDB`} className="shelf-poster">
                  <Poster src={it.posterUrl} title={it.title} />
                  {it.generalRating != null && (it.generalVotes ?? 0) >= 50 && (
                    <span className="poster-rating">
                      <Icon name="star" size={11} /> {it.generalRating.toFixed(1).replace('.', ',')}
                    </span>
                  )}
                  {mine && <span className="poster-badge">Na sua lista</span>}
                </WorkLink>
                {!mine && (
                  <button
                    type="button"
                    className="shelf-add"
                    aria-label={`Quero assistir: ${it.title}`}
                    title="Quero assistir"
                    disabled={busy === key}
                    onClick={() => void want(it)}
                  >
                    <Icon name="plus" size={16} />
                  </button>
                )}
              </div>
              <div className="shelf-info">
                <span className="shelf-title" title={it.title}>
                  {it.title}
                </span>
                <span className="muted small">{[kindLabel(it.kind), it.year].filter(Boolean).join(' · ')}</span>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
