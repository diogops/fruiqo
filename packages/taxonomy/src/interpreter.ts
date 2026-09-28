import { type AvoidKey, type Energy, type MoodIntent, MoodIntentSchema, type Need, type Tone } from './mood.js';
import { normalizeMoodText, termRegex } from './text.js';

// RulesInterpreter (taxonomia v1 §3): texto do "Como estou" → MoodIntent, local e sem rede.
// É o modo padrão (`AI_MODE=rules`) e o fallback do interpretador por LLM (D-06).
// A ordem das regras importa: pedido explícito ("quero rir") vence contexto ("com amigos"),
// que vence estado ("triste").

interface NeedRule {
  need: Need;
  terms: string[];
}

/** Pedido explícito de experiência. */
const EXPLICIT: NeedRule[] = [
  { need: 'thrill', terms: ['adrenalina', 'acao', 'tensao', 'suspense', 'terror', 'medo', 'susto', 'thriller', 'emocionante'] },
  { need: 'laughter', terms: ['rir', 'risada', 'gargalhar', 'engracado', 'comedia', 'besteirol', 'humor', 'dar risada'] },
  { need: 'catharsis', terms: ['chorar', 'chorando', 'desabafar', 'extravasar', 'lavar a alma'] },
  { need: 'think', terms: ['pensar', 'reflexao', 'refletir', 'cabeca funcionando', 'intrigante', 'inteligente', 'mexa com a cabeca'] },
  { need: 'distraction', terms: ['desligar', 'sem cabeca', 'sem pensar', 'distrair', 'esquecer os problemas', 'passar o tempo', 'algo bobo'] },
  { need: 'nostalgia', terms: ['saudade da infancia', 'nostalgia', 'nostalgico', 'infancia', 'anos 90', 'anos 80', 'classico da sessao da tarde'] },
  { need: 'comfort', terms: ['aconchego', 'aconchegante', 'conforto', 'quentinho', 'reassistir', 'rever algo', 'algo conhecido'] },
];

/** Com quem: vira `connection` quando não há pedido explícito. */
const COMPANY = ['com a namorada', 'com o namorado', 'com minha namorada', 'com meu namorado', 'com a esposa', 'com o marido', 'com minha esposa', 'com meu marido', 'a dois', 'com o crush', 'com a familia', 'com os amigos', 'com amigos', 'com as criancas', 'com os filhos'];

/** Estado emocional: sem pedido explícito, tristeza pede algo que levante o astral. */
const SAD = ['triste', 'tristeza', 'sofrendo', 'deprimido', 'deprimida', 'pra baixo', 'chateado', 'chateada', 'magoado', 'magoada', 'down', 'mal', 'desanimado', 'desanimada', 'sozinho', 'sozinha'];
const HEARTBREAK = ['por amor', 'terminei', 'terminou comigo', 'termino', 'fim de namoro', 'pe na bunda', 'coracao partido', 'levei um fora', 'separacao', 'divorcio', 'ex namorado', 'ex namorada', 'meu ex', 'minha ex'];
const STRESS = ['dia pesado', 'dia dificil', 'estressado', 'estressada', 'cansado', 'cansada', 'exausto', 'exausta', 'trabalho pesado'];
const TIRED = ['sem cabeca', 'cansado', 'cansada', 'exausto', 'exausta', 'sono'];
const LIGHT = ['leve', 'levinho', 'tranquilo', 'suave'];
const HIGH_ENERGY = ['adrenalina', 'animado', 'animada', 'agitado', 'sexta', 'festa', 'eletrizante'];

/** "não quero X", "sem X", "nada de X" → avoid. */
const NEGATABLE: { terms: string[]; avoid: AvoidKey }[] = [
  { terms: ['romance', 'romantico', 'romantica', 'amor', 'casal'], avoid: 'romance_centric' },
  { terms: ['terror', 'medo', 'susto'], avoid: 'horror' },
  { terms: ['violencia', 'violento', 'sangue'], avoid: 'violence' },
  { terms: ['drama', 'pesado', 'triste', 'tristeza'], avoid: 'heavy' },
  { terms: ['longo', 'comprido', 'demorado'], avoid: 'long' },
  { terms: ['lento', 'parado'], avoid: 'slow' },
  { terms: ['final', 'morte'], avoid: 'sad_ending' },
  { terms: ['comedia'], avoid: 'comedy' },
];
const NEGATION = /\b(nao quero|nao queria|nada de|sem|chega de|evitar|menos|nem)\s+(?:(?:nada|um|uma|algo|filme|serie|de|com|muito|tanto|mais)\s+){0,3}(\w+)/g;

const DEFAULTS: Record<Need, { tone: Tone[]; energy: Energy; avoid: AvoidKey[] }> = {
  uplifting: { tone: ['hopeful', 'light'], energy: 'low', avoid: ['heavy'] },
  comfort: { tone: ['cozy'], energy: 'low', avoid: ['heavy'] },
  catharsis: { tone: ['reflective'], energy: 'low', avoid: [] },
  distraction: { tone: ['light'], energy: 'low', avoid: ['long', 'slow'] },
  laughter: { tone: ['funny'], energy: 'medium', avoid: ['heavy'] },
  thrill: { tone: ['intense'], energy: 'high', avoid: [] },
  think: { tone: ['reflective'], energy: 'medium', avoid: ['slapstick'] },
  connection: { tone: ['light'], energy: 'medium', avoid: ['heavy'] },
  nostalgia: { tone: ['cozy'], energy: 'low', avoid: ['heavy'] },
};

const MESSAGES: Record<Need, string> = {
  uplifting: 'Separei coisas que levantam o astral, com histórias de recomeço.',
  comfort: 'Separei coisas acolhedoras, daquelas que fazem bem rever.',
  catharsis: 'Separei histórias que deixam a emoção sair.',
  distraction: 'Separei coisas leves para desligar a cabeça.',
  laughter: 'Separei coisas para rir sem compromisso.',
  thrill: 'Separei coisas com adrenalina do começo ao fim.',
  think: 'Separei coisas que dão o que pensar.',
  connection: 'Separei coisas boas para ver junto.',
  nostalgia: 'Separei coisas com cheirinho de infância.',
};

function has(text: string, terms: string[]): boolean {
  return terms.some((t) => termRegex(t).test(text));
}

/** "1h30", "2h", "90 min", "uma hora" → minutos. */
export function extractRuntime(text: string): number | undefined {
  const hm = /\b(\d{1,2})\s?h\s?(\d{1,2})?\b/.exec(text);
  if (hm) return Number(hm[1]) * 60 + (hm[2] ? Number(hm[2]) : 0);
  const min = /\b(\d{2,3})\s?(min|minutos)\b/.exec(text);
  if (min) return Number(min[1]);
  if (/\buma hora e meia\b/.test(text)) return 90;
  if (/\b(uma|1) hora\b/.test(text)) return 60;
  if (/\bduas horas\b/.test(text)) return 120;
  return undefined;
}

function negatedAvoids(text: string): AvoidKey[] {
  const out: AvoidKey[] = [];
  for (const m of text.matchAll(NEGATION)) {
    const target = m[2] ?? '';
    for (const { terms, avoid } of NEGATABLE) {
      if (terms.some((t) => target.startsWith(t))) out.push(avoid);
    }
  }
  return out;
}

export function interpretMood(rawText: string): MoodIntent {
  const text = normalizeMoodText(rawText);
  const negated = negatedAvoids(text);
  // termo negado não conta como pedido ("não quero terror" não é pedido de adrenalina)
  const positive = text.replace(NEGATION, ' ');

  let need: Need | undefined = EXPLICIT.find((r) => has(positive, r.terms))?.need;
  if (!need && has(positive, COMPANY)) need = 'connection';
  if (!need && (has(positive, SAD) || has(positive, HEARTBREAK))) need = 'uplifting';
  if (!need && has(positive, STRESS)) need = 'laughter';
  need ??= 'distraction';

  const base = DEFAULTS[need];
  const avoid = new Set<AvoidKey>([...base.avoid, ...negated]);
  if (has(positive, HEARTBREAK)) {
    avoid.add('romance_centric');
    avoid.add('sad_ending');
  }
  if (need === 'uplifting' && !has(positive, HEARTBREAK)) avoid.add('sad_ending');
  if (need === 'catharsis') avoid.delete('heavy');

  const tone = new Set<Tone>(base.tone);
  if (has(positive, LIGHT)) tone.add('light');

  let energy: Energy = base.energy;
  if (has(positive, HIGH_ENERGY)) energy = 'high';
  else if (need !== 'thrill' && has(positive, TIRED)) energy = 'low';

  const maxRuntimeMin = extractRuntime(text);

  return MoodIntentSchema.parse({
    need,
    avoid: [...avoid].slice(0, 10),
    tone: [...tone].slice(0, 3),
    energy,
    kinds: [],
    ...(maxRuntimeMin && maxRuntimeMin >= 10 && maxRuntimeMin <= 600 ? { maxRuntimeMin } : {}),
    message: MESSAGES[need],
  });
}
