import { z } from 'zod';
import { GENRE_KEYS } from './genres.js';
import { SUBGENRE_KEYS } from './subgenres.js';

// Taxonomia v1 §3: intenção de humor estruturada. É o que sobra do texto do "Como estou" (RNF-06):
// o texto livre nunca é persistido, só esta estrutura.

export const NEEDS = [
  'uplifting',
  'comfort',
  'catharsis',
  'distraction',
  'laughter',
  'thrill',
  'think',
  'connection',
  'nostalgia',
] as const;
export type Need = (typeof NEEDS)[number];

export const DERIVED_ATTRIBUTES = ['romance_centric', 'heavy', 'long', 'violence', 'sad_ending', 'slow'] as const;
export type DerivedAttribute = (typeof DERIVED_ATTRIBUTES)[number];

/** `avoid` aceita atributo derivado, gênero ou subgênero (chaves próprias). */
export const AVOID_KEYS = [...DERIVED_ATTRIBUTES, ...GENRE_KEYS, ...SUBGENRE_KEYS] as const;
export type AvoidKey = (typeof AVOID_KEYS)[number];

export const TONES = ['light', 'hopeful', 'funny', 'intense', 'dark', 'reflective', 'cozy'] as const;
export type Tone = (typeof TONES)[number];

export const ENERGIES = ['low', 'medium', 'high'] as const;
export type Energy = (typeof ENERGIES)[number];

export const MOOD_KINDS = ['movie', 'series', 'music'] as const;

export const MOOD_MESSAGE_MAX = 200;

/** Schema estrito: enums fechados, sem texto livre além de `message` (RNF-08). */
export const MoodIntentSchema = z
  .object({
    need: z.enum(NEEDS),
    avoid: z.array(z.enum(AVOID_KEYS)).max(10),
    tone: z.array(z.enum(TONES)).max(3),
    energy: z.enum(ENERGIES),
    kinds: z.array(z.enum(MOOD_KINDS)).max(3),
    maxRuntimeMin: z.number().int().min(10).max(600).optional(),
    message: z.string().max(MOOD_MESSAGE_MAX).optional(),
    riskFlag: z.boolean().optional(),
  })
  .strict();
export type MoodIntent = z.infer<typeof MoodIntentSchema>;

type Weighted = Partial<Record<string, number>>;

/** Pesos iniciais do mapeamento intenção → ranking (versionados junto com a taxonomia). */
export const NEED_WEIGHTS: Record<Need, { boost: Weighted; penalize: Weighted }> = {
  uplifting: { boost: { inspirational: 0.6, feelgood: 0.5, hopeful: 0.2 }, penalize: { heavy: 0.6, sad_ending: 0.4 } },
  comfort: { boost: { comfort: 0.6, rewatch_liked: 0.4 }, penalize: { heavy: 0.5, long: 0.2 } },
  catharsis: { boost: { tearjerker: 0.6, drama: 0.3 }, penalize: { slapstick: 0.3 } },
  distraction: { boost: { slapstick: 0.4, action: 0.3, heist: 0.3 }, penalize: { think: 0.3, slow: 0.3 } },
  laughter: { boost: { comedy: 0.6, slapstick: 0.4, romcom: 0.2 }, penalize: { heavy: 0.5 } },
  thrill: { boost: { thriller: 0.5, psych_thriller: 0.4, horror: 0.3 }, penalize: { comfort: 0.2 } },
  think: { boost: { mind_bender: 0.5, documentary: 0.3 }, penalize: { slapstick: 0.4 } },
  // a spec não define pesos para estes dois; valores conservadores até a 2d calibrar
  connection: { boost: { feelgood: 0.3, romcom: 0.2 }, penalize: { heavy: 0.3 } },
  nostalgia: { boost: { comfort: 0.4, family: 0.3, animation: 0.3 }, penalize: { heavy: 0.4 } },
};

/** Taxonomia v1 §4: motivos de feedback. */
export const REASON_TAGS = [
  'too_heavy',
  'too_long',
  'seen_it',
  'not_in_mood',
  'not_available',
  'too_slow',
  'not_my_genre',
  'other',
] as const;
export type ReasonTag = (typeof REASON_TAGS)[number];
