// Seed de demonstração (RF-17): `pnpm --filter @fruiqo/api seed:demo -- --email <email> [--password <senha>]`.
// Usa o usuário existente; se não existir, cria com a senha informada. Nunca roda em produção.
import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { hashPassword } from '../src/auth/password.js';
import { createDb, withUser } from '../src/db/client.js';
import { users } from '../src/db/schema.js';
import { seedDemo } from '../src/library/demo-seed.js';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  if (process.env.NODE_ENV === 'production') throw new Error('seed:demo não roda em produção');
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL não definido');
  const email = arg('email')?.trim().toLowerCase();
  if (!email) throw new Error('uso: seed:demo -- --email <email> [--password <senha>]');

  const { db, pool } = createDb(url);
  try {
    const found = await db.execute<{ id: string }>(sql`select id from auth_lookup_user(${email})`);
    let userId = found.rows[0]?.id;
    if (!userId) {
      const password = arg('password');
      if (!password || password.length < 12) throw new Error('usuário não existe: informe --password (≥ 12 caracteres) para criá-lo');
      userId = randomUUID();
      const passwordHash = await hashPassword(password);
      await withUser(db, userId, (tx) => tx.insert(users).values({ id: userId!, email, passwordHash }));
      console.log('usuário criado');
    }
    const res = await seedDemo(db, userId);
    console.log(`seed ok: ${res.created} títulos novos (de ${res.titles}), ${res.lists} listas novas`);
  } finally {
    await pool.end();
  }
}

main().catch((err: Error) => {
  console.error('falha no seed:', err.message);
  process.exit(1);
});
