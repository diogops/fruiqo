import { normalizeMoodText, termRegex } from './text.js';

// Taxonomia v1 §5 / RNF-07. Detector LOCAL e conservador: na dúvida, dispara. Roda antes de
// qualquer interpretação (rules ou LLM). Falso positivo é aceitável; falso negativo não.
// A lista é mínima: ampliar só com revisão humana e com fixture nova em fixtures/risk-*.

export const RISK_GROUPS = ['suicidal_ideation', 'self_harm', 'acute_hopelessness', 'farewell'] as const;
export type RiskGroup = (typeof RISK_GROUPS)[number];

const PATTERNS: Record<RiskGroup, string[]> = {
  suicidal_ideation: [
    'quero morrer',
    'queria morrer',
    'vontade de morrer',
    'vou me matar',
    'me matar',
    'tirar minha vida',
    'tirar a minha vida',
    'tirar minha propria vida',
    'acabar com tudo',
    'acabar com a minha vida',
    'acabar com minha vida',
    'nao quero mais viver',
    'nao quero viver',
    'nao aguento mais viver',
    'melhor sem mim',
    'melhor se eu nao existisse',
    'queria nao existir',
    'queria sumir pra sempre',
    'suicid*',
    'want to die',
    'kill myself',
    'end my life',
  ],
  self_harm: ['me cortar', 'me machucar', 'me ferir', 'autolesao', 'automutila*', 'self harm', 'hurt myself'],
  acute_hopelessness: [
    'nao tem mais saida',
    'nao vejo saida',
    'nao vejo sentido em viver',
    'nao vejo sentido na vida',
    'ninguem sentiria minha falta',
    'sou um peso pra todos',
    'sou um peso para todos',
    'sou um peso pra todo mundo',
  ],
  farewell: ['me despedir de todos', 'carta de despedida', 'ultima vez que falo', 'ultima vez que escrevo'],
};

/** Hipérboles de humor removidas antes da checagem ("morri de rir" não é risco). */
const HYPERBOLE = [
  'morri de rir',
  'morrendo de rir',
  'morrer de rir',
  'morto de cansaco',
  'morta de cansaco',
  'to morto de cansaco',
  'morrendo de fome',
  'morrendo de sono',
  'morrendo de saudade',
  'matar de susto',
  'mata de susto',
  'matar a saudade',
];

/** Referência a obra: não dispara sozinha, mas volta a disparar com 1ª pessoa perto. */
const WORK_REFERENCE = /\b(filme|serie|documentario|livro|musica|novela|episodio)s? (sobre|de|que fala de|com) /;
const FIRST_PERSON = /\b(eu|me|mim|minha|meu|comigo|estou|to|tou)\b/;

const COMPILED = Object.fromEntries(
  Object.entries(PATTERNS).map(([group, terms]) => [group, terms.map(termRegex)]),
) as Record<RiskGroup, RegExp[]>;

export interface RiskAssessment {
  risk: boolean;
  groups: RiskGroup[];
}

export function detectRisk(text: string): RiskAssessment {
  let normalized = normalizeMoodText(text);
  for (const h of HYPERBOLE) normalized = normalized.replace(termRegex(h), ' ');

  const groups: RiskGroup[] = [];
  for (const group of RISK_GROUPS) {
    for (const re of COMPILED[group]) {
      const match = re.exec(normalized);
      if (!match) continue;
      // "série sobre suicídio" sem ninguém falando de si mesmo = pedido de obra, não risco
      const before = normalized.slice(Math.max(0, match.index - 40), match.index + 1);
      const isWorkReference = WORK_REFERENCE.test(before);
      const firstPerson = FIRST_PERSON.test(normalized.replace(WORK_REFERENCE, ' '));
      if (isWorkReference && !firstPerson) continue;
      groups.push(group);
      break;
    }
  }
  return { risk: groups.length > 0, groups };
}

/**
 * Resposta fixa de acolhimento (RNF-07). Nenhum conteúdo é sugerido antes de o usuário escolher
 * continuar, e o texto que disparou não é guardado (só o evento `risk_shown`).
 */
export const RISK_SUPPORT = {
  title: 'Você não está sozinho',
  message:
    'Parece que você está passando por um momento muito difícil. Conversar com alguém pode ajudar agora. ' +
    'O CVV atende 24 horas, de graça e em sigilo, pelo telefone 188 ou pelo chat em cvv.org.br. ' +
    'Em emergência, ligue 192 (SAMU).',
  cvvPhone: '188',
  cvvUrl: 'https://cvv.org.br',
  emergencyPhone: '192',
  continueLabel: 'Quero continuar',
} as const;
