// Comparativo de IAs para SUGERIR TÍTULOS no "O que assistir hoje?" (modo gerador).
// - Pedidos e perfis SINTÉTICOS (nada do perfil real, nada do TMDB no prompt): os dados enviados a
//   provedores fora da Anthropic não têm decisão de ToS (ARB-REQ-03), então só vai texto inventado.
// - Mesmo prompt para todos; cada um no seu modo JSON nativo.
// - Conferência LOCAL no TMDB: o título existe (título + ano)? atende ao pedido? não está no "não sugerir"?
// Uso: railway run --service api -- node tools/ai-bench/bench-titles.mjs [--only claude-haiku-4-5,...] [--cases 3]
import { mkdirSync, writeFileSync } from 'node:fs';
import Anthropic from '@anthropic-ai/sdk';
import { KEYS } from './keys.mjs';

// ---------------- modelos (preço US$ por 1M tokens: entrada / saída, raciocínio conta como saída) ----------------
const MODELS = [
  { id: 'claude-haiku-4-5', provider: 'anthropic', in: 1, out: 5 },
  { id: 'claude-sonnet-5-5', provider: 'anthropic', in: 2, out: 10 },
  { id: 'claude-opus-5-5', provider: 'anthropic', in: 4, out: 20 },
  { id: 'claude-fable-5-1', provider: 'anthropic', in: 10, out: 50 },
  { id: 'gpt-6-astra', provider: 'openai', in: 10, out: 50 },
  { id: 'gpt-6.1-sol', provider: 'openai', in: 2, out: 10 },
  { id: 'gpt-6-luna', provider: 'openai', in: 0.1, out: 0.5 },
  { id: 'gpt-5.4-mini', provider: 'openai', in: 0.75, out: 4.5 },
  { id: 'gpt-4.1-mini', provider: 'openai', in: 0.4, out: 1.6 },
  { id: 'gemini-3.1-pro-preview', provider: 'gemini', in: 2, out: 12 },
  { id: 'gemini-3.8-flash', provider: 'gemini', in: 0.75, out: 3.75 },
  { id: 'gemini-3.5-flash-lite', provider: 'gemini', in: 0.3, out: 2.5 },
  { id: 'mistral-large-latest', provider: 'mistral', in: 0.5, out: 1.5 },
  { id: 'mistral-medium-latest', provider: 'mistral', in: 1.5, out: 7.5 },
  { id: 'mistral-small-latest', provider: 'mistral', in: 0.15, out: 0.6 },
];

// ---------------- casos (sintéticos) e como conferir cada título ----------------
const CASES = [
  {
    id: 'acao-scifi-inteligente',
    kind: 'movie',
    request: 'Pedido de hoje (prioridade máxima; toda sugestão tem que atender): um bom filme de ação, mas que seja scifi e inteligente',
    avoid: ['Matrix (1999)', 'A Origem (2010)', 'Interestelar (2014)', 'Duna (2021)'],
    check: (d) => has(d, [28, 878]),
  },
  {
    id: 'leve-e-curto',
    kind: 'movie',
    request: 'Pedido de hoje (prioridade máxima; toda sugestão tem que atender): estou cansado, quero algo leve e curto (até 1h45)',
    avoid: ['Forrest Gump (1994)', 'Up: Altas Aventuras (2009)'],
    check: (d) => !hasAny(d, [27, 10752, 53, 80]) && (d.runtime ?? 999) <= 110,
  },
  {
    id: 'suspense-reviravolta-sem-terror',
    kind: 'movie',
    request: 'Pedido de hoje (prioridade máxima; toda sugestão tem que atender): suspense psicológico com reviravolta, nada de terror',
    avoid: ['Ilha do Medo (2010)', 'Garota Exemplar (2014)', 'O Sexto Sentido (1999)', 'Clube da Luta (1999)'],
    check: (d) => hasAny(d, [53, 9648]) && !hasAny(d, [27]),
  },
  {
    id: 'serie-policial-nordica',
    kind: 'series',
    request: 'Pedido de hoje (prioridade máxima; toda sugestão tem que atender): série policial nórdica, sombria',
    avoid: ['The Killing (2007)', 'A Ponte (2011)'],
    check: (d) => has(d, [80]) && (d.origin_country ?? []).some((c) => ['SE', 'NO', 'DK', 'FI', 'IS'].includes(c)),
  },
  {
    id: 'comedia-romantica-90',
    kind: 'movie',
    request: 'Pedido de hoje (prioridade máxima; toda sugestão tem que atender): comédia romântica dos anos 90',
    avoid: ['Uma Linda Mulher (1990)', 'Harry e Sally (1989)'],
    check: (d) => has(d, [35, 10749]) && year(d) >= 1990 && year(d) <= 1999,
  },
  {
    id: 'noir-cyberpunk',
    kind: 'movie',
    request: 'Pedido de hoje (prioridade máxima; toda sugestão tem que atender): algo noir cyberpunk',
    avoid: ['Blade Runner (1982)', 'Blade Runner 2049 (2017)'],
    check: (d) => has(d, [878]),
  },
  {
    id: 'doc-musica-brasileira',
    kind: 'movie',
    request: 'Pedido de hoje (prioridade máxima; toda sugestão tem que atender): documentário sobre música brasileira',
    avoid: [],
    check: (d) => has(d, [99]) && (d.original_language === 'pt' || (d.origin_country ?? []).includes('BR') || (d.production_countries ?? []).some((c) => c.iso_3166_1 === 'BR')),
  },
  {
    id: 'serie-scifi-pensar-curta',
    kind: 'series',
    request: 'Pedido de hoje (prioridade máxima; toda sugestão tem que atender): série de ficção científica que faça pensar, com poucas temporadas',
    avoid: ['Dark (2017)', 'Black Mirror (2011)', 'Ruptura (2022)'],
    check: (d) => hasAny(d, [10765, 878]) && (d.number_of_seasons ?? 99) <= 3,
  },
];
const PROFILE = 'Adora: Suspense/Thriller, Ficção científica\nGosta: Drama, Crime\nEvita: Romance meloso\nReferências do gosto: Zodíaco (2007), Prisioneiros (2013), Ex Machina (2014)';

const genreIds = (d) => (d.genres ?? []).map((g) => g.id);
const has = (d, ids) => ids.every((id) => genreIds(d).includes(id));
const hasAny = (d, ids) => ids.some((id) => genreIds(d).includes(id));
const year = (d) => Number((d.release_date || d.first_air_date || '0').slice(0, 4));

const N = 10;
function system(kind) {
  const w = kind === 'series' ? { en: 'TV series', kinds: 'series', verb: 'watch' } : { en: 'movies', kinds: 'movie', verb: 'watch' };
  return [
    `You recommend ${w.en} for a Brazilian user to ${w.verb} today, from a request built from their taste profile and mood.`,
    'The request inside <request> is the brief; <constraints> lists what is already known or unwanted.',
    'The line "Pedido de hoje" is the top priority: every pick must satisfy everything it asks (all genres it combines, style, tone, quality). Do not pick something that only matches part of it. The taste profile only breaks ties among picks that already satisfy it.',
    `Return up to ${N} real, well-regarded works that best fit, best match first. Vary the picks (not several from the same franchise, author, director or artist).`,
    'Never suggest anything listed under "Não sugerir". Respect what they dislike.',
    `Output JSON {"p":[{"t":..., "y":..., "k":...}]}: t = original title, k = kind (${w.kinds}), y = year of first release. No reasons. Return only JSON.`,
    'Be brief. Never invent works.',
  ].join(' ');
}
const userMsg = (c) => `<request>\n${c.request}\n${PROFILE}\n</request>\n<constraints>\nNão sugerir (já conhece, já tem ou já foi sugerido): ${c.avoid.join('; ') || '—'}\n</constraints>`;
const SCHEMA = {
  type: 'object',
  properties: { p: { type: 'array', items: { type: 'object', properties: { t: { type: 'string' }, y: { type: 'integer' }, k: { type: 'string' } }, required: ['t', 'y', 'k'], additionalProperties: false } } },
  required: ['p'],
  additionalProperties: false,
};

// ---------------- chamadas por provedor ----------------
const anthropic = KEYS.anthropic ? new Anthropic({ apiKey: KEYS.anthropic, maxRetries: 1, timeout: 180_000 }) : null;

async function callModel(m, c) {
  const sys = system(c.kind);
  const user = userMsg(c);
  if (m.provider === 'anthropic') {
    const thinkingModel = !m.id.includes('haiku');
    const res = await anthropic.messages.create({
      model: m.id,
      max_tokens: 8000,
      system: sys,
      messages: [{ role: 'user', content: user }],
      // mesmo ajuste da produção: esforço baixo nos modelos que pensam
      output_config: { format: { type: 'json_schema', schema: SCHEMA }, ...(thinkingModel ? { effort: 'low' } : {}) },
    });
    if (res.stop_reason === 'refusal') throw new Error('recusa');
    const text = res.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
    return { text, inTok: res.usage.input_tokens, outTok: res.usage.output_tokens };
  }
  if (m.provider === 'openai') {
    const body = { model: m.id, messages: [{ role: 'system', content: sys }, { role: 'user', content: user }], response_format: { type: 'json_object' }, max_completion_tokens: 8000, reasoning_effort: 'low' };
    let r = await post('https://api.openai.com/v1/chat/completions', body, { authorization: `Bearer ${KEYS.openai}` });
    // modelo sem esforço de raciocínio configurável
    if (r.status === 400) {
      delete body.reasoning_effort;
      r = await post('https://api.openai.com/v1/chat/completions', body, { authorization: `Bearer ${KEYS.openai}` });
    }
    const j = await json(r);
    return { text: j.choices?.[0]?.message?.content ?? '', inTok: j.usage?.prompt_tokens ?? 0, outTok: j.usage?.completion_tokens ?? 0 };
  }
  if (m.provider === 'gemini') {
    const r = await post(`https://generativelanguage.googleapis.com/v1beta/models/${m.id}:generateContent?key=${KEYS.gemini}`, {
      systemInstruction: { parts: [{ text: sys }] },
      contents: [{ role: 'user', parts: [{ text: user }] }],
      generationConfig: { responseMimeType: 'application/json', maxOutputTokens: 8000, thinkingConfig: { thinkingBudget: 512 } },
    });
    const j = await json(r);
    const u = j.usageMetadata ?? {};
    return { text: (j.candidates?.[0]?.content?.parts ?? []).map((p) => p.text ?? '').join(''), inTok: u.promptTokenCount ?? 0, outTok: (u.candidatesTokenCount ?? 0) + (u.thoughtsTokenCount ?? 0) };
  }
  const r = await post('https://api.mistral.ai/v1/chat/completions', { model: m.id, messages: [{ role: 'system', content: sys }, { role: 'user', content: user }], response_format: { type: 'json_object' }, max_tokens: 8000 }, { authorization: `Bearer ${KEYS.mistral}` });
  const j = await json(r);
  return { text: j.choices?.[0]?.message?.content ?? '', inTok: j.usage?.prompt_tokens ?? 0, outTok: j.usage?.completion_tokens ?? 0 };
}

const post = (url, body, headers = {}) => fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
async function json(r) {
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`HTTP ${r.status}: ${(j.error?.message ?? JSON.stringify(j)).slice(0, 160)}`);
  return j;
}

// ---------------- conferência local no TMDB (com cache) ----------------
const tmdbCache = new Map();
async function tmdb(path) {
  if (tmdbCache.has(path)) return tmdbCache.get(path);
  const isV4 = KEYS.tmdb.length > 40;
  const url = `https://api.themoviedb.org/3${path}${isV4 ? '' : `${path.includes('?') ? '&' : '?'}api_key=${KEYS.tmdb}`}`;
  const p = fetch(url, { headers: isV4 ? { authorization: `Bearer ${KEYS.tmdb}` } : {} }).then((r) => (r.ok ? r.json() : null));
  tmdbCache.set(path, p);
  return p;
}
const norm = (s) => (s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
async function verify(kind, t, y) {
  const media = kind === 'series' ? 'tv' : 'movie';
  const s = await tmdb(`/search/${media}?query=${encodeURIComponent(t)}&language=pt-BR`);
  const want = norm(t);
  const best = (s?.results ?? [])
    .map((r) => ({ r, yy: Number((r.release_date || r.first_air_date || '0').slice(0, 4)), names: [r.title, r.name, r.original_title, r.original_name].map(norm) }))
    .filter((x) => x.names.includes(want) || x.names.some((n) => n && (n.startsWith(want) || want.startsWith(n)) && Math.abs(n.length - want.length) <= 4))
    .filter((x) => !y || Math.abs(x.yy - y) <= 1)
    .sort((a, b) => (b.r.vote_count ?? 0) - (a.r.vote_count ?? 0))[0];
  if (!best) return null;
  return tmdb(`/${media}/${best.r.id}?language=pt-BR`);
}

// ---------------- execução ----------------
const args = process.argv.slice(2);
const only = args.includes('--only') ? args[args.indexOf('--only') + 1].split(',') : null;
const nCases = args.includes('--cases') ? Number(args[args.indexOf('--cases') + 1]) : CASES.length;
const models = MODELS.filter((m) => (!only || only.includes(m.id)) && KEYS[m.provider]);
const cases = CASES.slice(0, nCases);

async function runModel(m) {
  const row = { model: m.id, provider: m.provider, cases: 0, jsonOk: 0, suggested: 0, exist: 0, adherent: 0, good: 0, avoidHit: 0, dup: 0, inTok: 0, outTok: 0, ms: 0, errors: [] };
  for (const c of cases) {
    row.cases++;
    const t0 = Date.now();
    try {
      const r = await callModel(m, c);
      row.ms += Date.now() - t0;
      row.inTok += r.inTok;
      row.outTok += r.outTok;
      let picks;
      try {
        picks = JSON.parse(r.text.replace(/^```json\s*|\s*```$/g, '')).p ?? [];
        row.jsonOk++;
      } catch {
        row.errors.push(`${c.id}: JSON inválido`);
        continue;
      }
      const avoidNames = new Set(c.avoid.map((a) => norm(a.replace(/\s*\(\d{4}\)$/, ''))));
      const seen = new Set();
      for (const p of picks.slice(0, N)) {
        row.suggested++;
        const key = norm(p.t);
        if (seen.has(key)) { row.dup++; continue; }
        seen.add(key);
        const d = await verify(c.kind, String(p.t ?? ''), Number(p.y) || 0);
        if (!d) continue;
        row.exist++;
        const avoided = [d.title, d.name, d.original_title, d.original_name].map(norm).some((n) => avoidNames.has(n));
        if (avoided) { row.avoidHit++; continue; }
        if (c.check(d)) { row.adherent++; row.good++; }
      }
    } catch (e) {
      row.ms += Date.now() - t0;
      row.errors.push(`${c.id}: ${e.message}`);
    }
  }
  row.cost = (row.inTok * m.in + row.outTok * m.out) / 1e6;
  return row;
}

console.log(`modelos: ${models.map((m) => m.id).join(', ')} · casos: ${cases.length}`);
const rows = [];
// por provedor em paralelo; dentro do provedor, um modelo por vez (limite de taxa)
const byProvider = {};
for (const m of models) (byProvider[m.provider] ??= []).push(m);
await Promise.all(
  Object.values(byProvider).map(async (ms) => {
    for (const m of ms) {
      const r = await runModel(m);
      rows.push(r);
      console.log(`${m.id}: bons ${r.good}/${cases.length * N} · existe ${r.exist} · US$ ${r.cost.toFixed(4)} · ${Math.round(r.ms / r.cases)} ms/pedido${r.errors.length ? ` · erros: ${r.errors.length}` : ''}`);
    }
  }),
);

rows.sort((a, b) => b.good - a.good || a.cost - b.cost);
const pct = (a, b) => (b ? `${Math.round((100 * a) / b)}%` : '—');
const lines = [
  `# Comparativo de IAs — sugestão de títulos (${new Date().toISOString().slice(0, 10)})`,
  '',
  `${cases.length} pedidos sintéticos × até ${N} títulos. "Bons" = existe no TMDB (título+ano), atende ao pedido e não está no "não sugerir". Custo pelos preços oficiais (raciocínio conta como saída).`,
  '',
  '| Modelo | Bons | Existe | Atende (dos que existem) | Repetiu proibido | JSON ok | Latência média | Custo total | Custo por pedido | Custo por título bom |',
  '|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|',
  ...rows.map(
    (r) =>
      `| ${r.model} | ${r.good} (${pct(r.good, r.cases * N)}) | ${pct(r.exist, r.suggested)} | ${pct(r.adherent, r.exist - r.avoidHit)} | ${r.avoidHit} | ${r.jsonOk}/${r.cases} | ${(r.ms / r.cases / 1000).toFixed(1)} s | US$ ${r.cost.toFixed(4)} | US$ ${(r.cost / r.cases).toFixed(4)} | ${r.good ? `US$ ${(r.cost / r.good).toFixed(4)}` : '—'} |`,
  ),
  '',
  ...rows.filter((r) => r.errors.length).map((r) => `- ${r.model}: ${r.errors.join('; ')}`),
];
mkdirSync(new URL('../../reports/', import.meta.url), { recursive: true });
const out = new URL(`../../reports/ai-bench-titles-${new Date().toISOString().slice(0, 10)}.md`, import.meta.url);
writeFileSync(out, lines.join('\n'));
writeFileSync(new URL(out.href.replace(/\.md$/, '.json')), JSON.stringify(rows, null, 2));
console.log(lines.join('\n'));
