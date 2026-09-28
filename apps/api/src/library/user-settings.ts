import type { UserSettings } from '@fruiqo/contracts';
import { anyAiEnabled, type Env, tmdbActive } from '../config/env.js';
import { type Db, type Tx, withUser } from '../db/client.js';
import { userSettings } from '../db/schema.js';

/** SEC-CTRL-50: com "lembrar meu humor", a intenção estruturada fica até este prazo. */
export const MOOD_RETENTION_DAYS = 90;

export interface StoredSettings {
  rememberMood: boolean;
  aiConsent: boolean;
  aiConsentAt: Date | null;
}

const DEFAULTS: StoredSettings = { rememberMood: false, aiConsent: false, aiConsentAt: null };

/** Lê as preferências dentro de uma transação com `app.user_id` (RLS); sem linha = padrões. */
export async function readSettings(tx: Tx): Promise<StoredSettings> {
  const [row] = await tx.select().from(userSettings).limit(1);
  return row ? { rememberMood: row.rememberMood, aiConsent: row.aiConsent, aiConsentAt: row.aiConsentAt } : DEFAULTS;
}

/** SEC-CTRL-51: o usuário aceitou enviar o próprio texto à IA externa? */
export async function userAllowsAi(db: Db, userId: string): Promise<boolean> {
  return withUser(db, userId, async (tx) => (await readSettings(tx)).aiConsent);
}

type AvailabilityEnv = Pick<Env, 'AI_MODE' | 'ANTHROPIC_API_KEY' | 'LLM_ENABLED' | 'TMDB_API_KEY' | 'PIPELINE_MODE' | 'TMDB_AI_CLEARANCE'>;

/**
 * A IA externa do "Como estou" está disponível no servidor? Com o TMDB ativo sem liberação, a
 * própria validação de env impede ligar a IA (D-07); aqui só explicamos o motivo para a UI.
 */
export function aiAvailability(env: AvailabilityEnv): Pick<UserSettings, 'aiAvailable' | 'aiUnavailableReason'> {
  const available = env.AI_MODE === 'anthropic' && Boolean(env.ANTHROPIC_API_KEY);
  if (available) return { aiAvailable: true, aiUnavailableReason: null };
  const blockedByTmdb = tmdbActive(env) && env.TMDB_AI_CLEARANCE !== 'confirmed' && !anyAiEnabled(env);
  return { aiAvailable: false, aiUnavailableReason: blockedByTmdb ? 'tmdb_clearance_pending' : 'disabled' };
}

export function toSettingsView(stored: StoredSettings, env: AvailabilityEnv): UserSettings {
  return {
    rememberMood: stored.rememberMood,
    aiConsent: stored.aiConsent,
    aiConsentAt: stored.aiConsentAt ? stored.aiConsentAt.toISOString() : null,
    moodRetentionDays: MOOD_RETENTION_DAYS,
    ...aiAvailability(env),
  };
}
