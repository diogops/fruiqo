import pg from 'pg';
import { describe, expect, it } from 'vitest';
import { APP_URL, OWNER_URL } from '../helpers.js';

// Owner e app nunca podem ser superusuários nem ter BYPASSRLS: se forem, o RLS deixa de valer
// em silêncio (T-56) e bugs como a purga sem policy de retenção (0009/0010) ficam escondidos.
describe('roles do banco (T-56, SEC-CTRL-66)', () => {
  for (const [nome, url] of [
    ['fruiqo_owner', OWNER_URL],
    ['fruiqo_app', APP_URL],
  ] as const) {
    it(`${nome} não é superuser nem bypassrls`, async () => {
      const c = new pg.Client({ connectionString: url });
      await c.connect();
      try {
        const { rows } = await c.query<{ rolname: string; rolsuper: boolean; rolbypassrls: boolean }>(
          'SELECT rolname, rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user',
        );
        expect(rows).toEqual([{ rolname: nome, rolsuper: false, rolbypassrls: false }]);
      } finally {
        await c.end();
      }
    });
  }
});
