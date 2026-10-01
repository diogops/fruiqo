import type { UserSettings } from '@fruiqo/contracts';
import { anyAiEnabled, type Env, tmdbActive } from '../config/env.js';
import { type Db, type Tx, withUser } from '../db/client.js';
import { tasteFavorites, tasteOverrides, tasteStatements, tasteSubgenrePrefs, userSettings, userSubscriptions } from '../db/schema.js';

/** SEC-CTRL-50: com "lembrar meu humor", a intenção estruturada fica até este prazo. */
export const MOOD_RETENTION_DAYS = 90;

export interface StoredSettings {
  rememberMood: boolean;
  aiConsent: boolean;
  aiConsentAt: Date | null;
  onboardedAt: Date | null;
}

const DEFAULTS: StoredSettings = { rememberMood: false, aiConsent: false, aiConsentAt: null, onboardedAt: null };

/** Lê as preferências dentro de uma transação com `app.user_id` (RLS); sem linha = padrões. */
export async function readSettings(tx: Tx): Promise<StoredSettings> {
  const [row] = await tx.select().from(userSettings).limit(1);
  return row ? { rememberMood: row.rememberMood, aiConsent: row.aiConsent, aiConsentAt: row.aiConsentAt, onboardedAt: row.onboardedAt } : DEFAULTS;
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

/**
 * Primeiro acesso: ainda não concluído/dispensado e perfil vazio (sem resumo, favoritos, níveis,
 * subgêneros nem assinaturas). Quem já tem perfil nunca é levado ao Perfil sozinho.
 */
export async function needsOnboarding(tx: Tx, stored: StoredSettings): Promise<boolean> {
  if (stored.onboardedAt) return false;
  const any = async (table: typeof tasteStatements | typeof tasteFavorites | typeof tasteOverrides | typeof tasteSubgenrePrefs | typeof userSubscriptions) =>
    (await tx.select({ userId: table.userId }).from(table).limit(1)).length > 0;
  for (const t of [tasteStatements, tasteFavorites, tasteOverrides, tasteSubgenrePrefs, userSubscriptions]) if (await any(t)) return false;
  return true;
}

export function toSettingsView(stored: StoredSettings, env: AvailabilityEnv, onboarding = false): UserSettings {
  return {
    onboarding,
    rememberMood: stored.rememberMood,
    aiConsent: stored.aiConsent,
    aiConsentAt: stored.aiConsentAt ? stored.aiConsentAt.toISOString() : null,
    moodRetentionDays: MOOD_RETENTION_DAYS,
    ...aiAvailability(env),
  };
}
