import { JUSTWATCH_ATTRIBUTION, TMDB_ATTRIBUTION } from '@fruiqo/contracts';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { api } from '../api/client';
import { ErrorNote } from '../components/shared';
import { useToast } from '../components/Toast';
import { formatDateTime } from '../labels';
import { DeclaredTasteSection } from './DeclaredTaste';
import { DeleteAccountSection } from './DeleteAccount';
import { TasteEditor } from './TasteEditor';
import { AiUsageSection } from './AiUsage';
import { MfaSection } from './MfaSection';
import { Icon } from '../components/ui';

export function Profile() {
  const taste = useQuery({ queryKey: ['taste'], queryFn: api.taste });
  const subs = useQuery({ queryKey: ['subscriptions'], queryFn: api.subscriptions });
  const mood = useQuery({ queryKey: ['mood-history'], queryFn: api.moodHistory });
  const settings = useQuery({ queryKey: ['settings'], queryFn: api.settings });
  const qc = useQueryClient();
  const toast = useToast();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [error, setError] = useState<unknown>(null);
  const navigate = useNavigate();
  // as boas-vindas ficam até "Pronto"/"Agora não": o servidor deixa de mandar `onboarding` assim que o
  // perfil ganha o primeiro dado, e sem isso o cartão sumiria no meio do preenchimento
  const [welcome, setWelcome] = useState(false);
  useEffect(() => {
    if (settings.data?.onboarding) setWelcome(true);
  }, [settings.data?.onboarding]);

  /** Primeiro acesso concluído ("começar") ou dispensado ("agora não"): não abre sozinho de novo. */
  async function finishOnboarding(go: boolean) {
    try {
      qc.setQueryData(['settings'], await api.updateSettings({ onboarded: true }));
      setWelcome(false);
      if (go) navigate('/hoje');
    } catch (err) {
      setError(err);
    }
  }

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

  async function saveSettings(patch: Parameters<typeof api.updateSettings>[0]) {
    try {
      qc.setQueryData(['settings'], await api.updateSettings(patch));
      // desligar "lembrar meu humor" apaga as intenções guardadas
      if (patch.rememberMood === false) await qc.invalidateQueries({ queryKey: ['mood-history'] });
      toast.show('Preferência salva.');
    } catch (err) {
      setError(err);
    }
  }

  function toggleAi(next: boolean) {
    if (
      next &&
      !window.confirm(
        'Permitir IA externa? O texto que você escrever no "Como estou" e nas buscas por descrição, e o texto lido dos prints que você importar (nunca a imagem), será enviado à Anthropic (provedora do Claude), com servidores fora do Brasil, só para interpretar o pedido e separar os títulos. No "O que assistir hoje?", o seu pedido, o perfil que você declarou e os nomes dos seus títulos também podem ir à OpenAI (fora do Brasil, guardados por até 30 dias para monitorar abuso) para sugerir títulos. Nada disso é usado para treinar modelos.',
      )
    )
      return;
    void saveSettings({ aiConsent: next });
  }

  const byCategory = (cat: 'video' | 'music') => (subs.data?.available ?? []).filter((p) => p.category === cat);

  return (
    <section>
      <div className="page-head">
        <h1>Perfil de gosto</h1>
      </div>
      <p className="muted">
        Tudo o que o Fruiqo acha dos seus gostos está aqui, com a origem de cada valor. Nada fica escondido: ajuste o nível de
        cada gênero, marque subgêneros e inclua o que ainda não aparece.
      </p>
      <ErrorNote error={taste.error ?? subs.error ?? mood.error ?? error} />

      {welcome && settings.data && (
        <section className="welcome card" aria-labelledby="welcome-title">
          <h2 id="welcome-title">
            <Icon name="sparkles" size={18} /> Boas-vindas ao Fruiqo{settings.data.displayName ? `, ${settings.data.displayName.split(' ')[0]}` : ''}!
          </h2>
          <p>Conte do que você gosta e as sugestões já começam com a sua cara. Leva um minuto, e dá para mudar quando quiser.</p>
          <ol className="welcome-steps">
            <li>
              <a href="#assinaturas">Marque os streamings que você assina</a> <span className="muted small">para sugerir só o que você pode ver</span>
            </li>
            <li>
              <a href="#do-que-voce-gosta">Escreva do que gosta e marque alguns favoritos</a> <span className="muted small">filmes, séries ou livros</span>
            </li>
            <li>
              <a href="#niveis">Ajuste os gêneros</a> <span className="muted small">adoro, gosto, neutro, não curto, detesto</span>
            </li>
          </ol>
          <div className="row welcome-actions">
            <button type="button" className="btn btn-primary" onClick={() => void finishOnboarding(true)}>
              Pronto, quero sugestões
            </button>
            <button type="button" className="btn btn-link" onClick={() => void finishOnboarding(false)}>
              Agora não
            </button>
          </div>
        </section>
      )}

      <DeclaredTasteSection />

      <h2 id="niveis">O que aprendemos com você</h2>

      {taste.data && <TasteEditor taste={taste.data} onChange={updateTaste} />}

      <h2 id="assinaturas">Assinaturas</h2>
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

      <h2>Privacidade</h2>
      <p className="muted small">
        Como usamos os seus dados: <Link to="/privacidade">política de privacidade</Link>.
      </p>
      {settings.data && (
        <div className="privacy">
          <label className="check">
            <input
              type="checkbox"
              checked={settings.data.rememberMood}
              onChange={(e) => void saveSettings({ rememberMood: e.target.checked })}
            />{' '}
            Lembrar meu humor
            <span className="muted small">
              {' '}
              · guarda só a intenção interpretada (nunca o texto) por {settings.data.moodRetentionDays} dias; desligar apaga o
              que estiver guardado
            </span>
          </label>
          <label className="check">
            <input type="checkbox" checked={settings.data.aiConsent} onChange={(e) => toggleAi(e.target.checked)} /> Permitir
            IA externa no "Como estou", na busca por descrição e na leitura de prints
            <span className="muted small">
              {' '}
              ·{' '}
              {settings.data.aiAvailable
                ? 'o texto (nunca a imagem) vai à Anthropic, fora do Brasil, só para interpretar o pedido; no "O que assistir hoje?", o pedido e os nomes dos seus títulos também podem ir à OpenAI para sugerir títulos'
                : settings.data.aiUnavailableReason === 'tmdb_clearance_pending'
                  ? 'IA indisponível no momento: desligada até a confirmação do TMDB (decisão D-07); sua escolha fica salva'
                  : 'IA indisponível no momento; sua escolha fica salva para quando ela for ligada'}
            </span>
          </label>
        </div>
      )}

      <MfaSection />

      <AiUsageSection />

      <h2>Histórico do "Como estou"</h2>
      <p className="muted small">O texto que você digitou nunca foi guardado; só a intenção interpretada, e só com "Lembrar meu humor" ligado.</p>
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

      <DeleteAccountSection />

      {/* TOS-REQ-01: atribuição do TMDB em Sobre/Créditos */}
      <h2>Créditos</h2>
      <p className="muted small credits">
        Dados de filmes e séries: TMDB. {TMDB_ATTRIBUTION}
        <br />
        {JUSTWATCH_ATTRIBUTION}.
        <br />
        Dados de livros: Open Library.
      </p>
    </section>
  );
}
