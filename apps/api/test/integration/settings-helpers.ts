import type { Db } from '../../src/db/client.js';
import { withUser } from '../../src/db/client.js';
import { userSettings } from '../../src/db/schema.js';

/** Grava as preferências do usuário direto no banco (via RLS), para testes. */
export async function setUserSettings(
  db: Db,
  userId: string,
  patch: { rememberMood?: boolean; aiConsent?: boolean },
): Promise<void> {
  const rememberMood = patch.rememberMood ?? false;
  const aiConsent = patch.aiConsent ?? false;
  const aiConsentAt = aiConsent ? new Date() : null;
  await withUser(db, userId, (tx) =>
    tx
      .insert(userSettings)
      .values({ userId, rememberMood, aiConsent, aiConsentAt })
      .onConflictDoUpdate({ target: userSettings.userId, set: { rememberMood, aiConsent, aiConsentAt } }),
  );
}
