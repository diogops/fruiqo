-- Roda uma única vez, como o superusuário de bootstrap `postgres`, quando o volume é criado.
-- Mesmo desenho da produção (Railway):
--   postgres      superusuário, só bootstrap/emergência; nunca usado pela app
--   fruiqo_owner  gestão e migrações; dono do banco/schema/tabelas; SEM superuser/bypassrls
--   fruiqo_app    API e worker; não é dono de nada, então o RLS sempre se aplica (SEC-REQ-16)
-- Local, o owner também tem CREATEDB e pg_signal_backend porque os testes e o eval
-- criam/derrubam bancos temporários (em produção esses dois não são concedidos).

CREATE ROLE fruiqo_owner LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEROLE CREATEDB PASSWORD 'dev_owner_password';
GRANT pg_signal_backend TO fruiqo_owner;

CREATE ROLE fruiqo_app LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEROLE NOCREATEDB PASSWORD 'dev_app_password';

ALTER DATABASE fruiqo OWNER TO fruiqo_owner;
\connect fruiqo
ALTER SCHEMA public OWNER TO fruiqo_owner;
GRANT CONNECT ON DATABASE fruiqo TO fruiqo_app;
