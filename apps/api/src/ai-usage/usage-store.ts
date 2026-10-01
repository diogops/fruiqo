// Registro do uso de IA no banco (ai_usage, sob RLS do próprio usuário).
import type { Db } from '../db/client.js';
import { withUser } from '../db/client.js';
import { aiUsage } from '../db/schema.js';
import type { AiUsageRow } from './usage.js';

export function dbAiUsageSink(db: Db) {
  return (row: AiUsageRow) => withUser(db, row.userId, (tx) => tx.insert(aiUsage).values(row));
}
