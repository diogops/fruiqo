// Prepara o Postgres gerenciado (Railway) para o modelo de RLS do Fruiqo e aplica as migrações.
// Idempotente: pode rodar a cada deploy.
//
// - DATABASE_URL_ADMIN: URL do superusuário do plugin (só usada aqui; o entrypoint a remove antes de subir a API)
// - FRUIQO_OWNER_PASSWORD / FRUIQO_APP_PASSWORD: senhas das roles, definidas só nas variáveis do Railway
//
// Roles (mesmo modelo de infra/postgres/init.sql + migrações):
// - fruiqo_owner: LOGIN, NÃO superusuário, dona do schema e das tabelas (roda as migrações)
// - fruiqo_app: LOGIN, sem ownership; as policies de RLS se aplicam a ela (SEC-REQ-16)
import pg from 'pg';
import { runMigrations } from '../dist/db/migrations.js';

function need(name) {
  const v = process.env[name];
  if (!v) {
    console.error(`[bootstrap-db] variável obrigatória ausente: ${name}`);
    process.exit(1);
  }
  return v;
}

const adminUrl = need('DATABASE_URL_ADMIN');
const ownerPassword = need('FRUIQO_OWNER_PASSWORD');
const appPassword = need('FRUIQO_APP_PASSWORD');

// O banco pode estar subindo (deploy simultâneo, troca de região): tenta por até ~2 min.
// A mensagem de erro é só o código/host, nunca a connection string.
async function connectWithRetry(url, attempts = 24) {
  for (let i = 1; ; i++) {
    const c = new pg.Client({ connectionString: url });
    try {
      await c.connect();
      return c;
    } catch (err) {
      await c.end().catch(() => {});
      if (i >= attempts) throw err;
      console.log(`[bootstrap-db] banco indisponível (${err.code ?? 'erro'}), tentativa ${i}/${attempts}`);
      await new Promise((r) => setTimeout(r, 5000));
    }
  }
}

const admin = await connectWithRetry(adminUrl);
try {
  const db = (await admin.query('SELECT current_database() AS db')).rows[0].db;
  const ident = (s) => '"' + s.replace(/"/g, '""') + '"';
  const lit = (s) => "'" + s.replace(/'/g, "''") + "'";

  for (const [role, password] of [
    ['fruiqo_owner', ownerPassword],
    ['fruiqo_app', appPassword],
  ]) {
    const exists = (await admin.query('SELECT 1 FROM pg_roles WHERE rolname = $1', [role])).rowCount > 0;
    const verb = exists ? 'ALTER' : 'CREATE';
    // senha nunca vai para log: o comando não é ecoado
    await admin.query(
      `${verb} ROLE ${ident(role)} WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD ${lit(password)}`,
    );
  }

  // o owner cria o schema de controle do drizzle e as tabelas; a app só conecta
  await admin.query(`GRANT CONNECT, CREATE ON DATABASE ${ident(db)} TO fruiqo_owner`);
  await admin.query(`GRANT CONNECT ON DATABASE ${ident(db)} TO fruiqo_app`);
  await admin.query('GRANT USAGE, CREATE ON SCHEMA public TO fruiqo_owner');
  // gestão sem superusuário: o owner é dono do database e do schema public
  await admin.query(`ALTER DATABASE ${ident(db)} OWNER TO fruiqo_owner`);
  await admin.query('ALTER SCHEMA public OWNER TO fruiqo_owner');
  await transferOwnership(admin, ident);
  console.log(`[bootstrap-db] roles prontas no banco ${db}`);
} finally {
  await admin.end();
}

const u = new URL(adminUrl);
u.username = 'fruiqo_owner';
u.password = ownerPassword;
await runMigrations(u.toString());

// objetos criados antes por outra role (ex.: primeiro deploy manual) também passam para o owner
const again = await connectWithRetry(adminUrl);
try {
  await transferOwnership(again, (s) => '"' + s.replace(/"/g, '""') + '"');
} finally {
  await again.end();
}
console.log('[bootstrap-db] migrações aplicadas');

// Tabelas, sequências, views e funções do schema public que não sejam do fruiqo_owner passam a ser.
async function transferOwnership(client, ident) {
  const objs = await client.query(`
    SELECT 'TABLE' AS kind, format('public.%I', c.relname) AS name
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND c.relkind IN ('r','p') AND pg_get_userbyid(c.relowner) <> 'fruiqo_owner'
    UNION ALL
    SELECT 'SEQUENCE', format('public.%I', c.relname)
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND c.relkind = 'S' AND pg_get_userbyid(c.relowner) <> 'fruiqo_owner'
       AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.objid = c.oid AND d.deptype = 'a')
    UNION ALL
    SELECT 'VIEW', format('public.%I', c.relname)
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND c.relkind IN ('v','m') AND pg_get_userbyid(c.relowner) <> 'fruiqo_owner'
    UNION ALL
    SELECT 'FUNCTION', p.oid::regprocedure::text
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND pg_get_userbyid(p.proowner) <> 'fruiqo_owner'`);
  for (const { kind, name } of objs.rows) {
    await client.query(`ALTER ${kind} ${name} OWNER TO fruiqo_owner`);
  }
  void ident;
}
