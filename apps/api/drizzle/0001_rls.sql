-- RLS por usuário (SEC-REQ-16, D-01). A aplicação conecta como `fruiqo_app`, que não é dona das
-- tabelas; toda transação de dados do usuário define `app.user_id` com set_config(..., true).
-- A role que roda esta migração (owner) só enxerga linhas pelas funções SECURITY DEFINER abaixo.

CREATE OR REPLACE FUNCTION app_current_user() RETURNS uuid
  LANGUAGE sql STABLE
  AS $$ SELECT nullif(current_setting('app.user_id', true), '')::uuid $$;
--> statement-breakpoint
GRANT USAGE ON SCHEMA public TO fruiqo_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON users, sessions, shares, recommendations TO fruiqo_app;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app_current_user() TO fruiqo_app;
--> statement-breakpoint
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE users FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE sessions ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE sessions FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE shares ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE shares FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE recommendations ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE recommendations FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY users_self ON users FOR ALL TO fruiqo_app
  USING (id = app_current_user()) WITH CHECK (id = app_current_user());
--> statement-breakpoint
CREATE POLICY sessions_owner ON sessions FOR ALL TO fruiqo_app
  USING (user_id = app_current_user()) WITH CHECK (user_id = app_current_user());
--> statement-breakpoint
CREATE POLICY shares_owner ON shares FOR ALL TO fruiqo_app
  USING (user_id = app_current_user()) WITH CHECK (user_id = app_current_user());
--> statement-breakpoint
CREATE POLICY recommendations_owner ON recommendations FOR ALL TO fruiqo_app
  USING (user_id = app_current_user()) WITH CHECK (user_id = app_current_user());
--> statement-breakpoint
-- Policies restritas para a role dona das funções SECURITY DEFINER (vale mesmo sem superusuário).
DO $$
BEGIN
  EXECUTE format('CREATE POLICY users_definer_lookup ON users FOR SELECT TO %I USING (true)', current_user);
  EXECUTE format('CREATE POLICY shares_definer_retention ON shares FOR ALL TO %I USING (true) WITH CHECK (true)', current_user);
  EXECUTE format('CREATE POLICY recommendations_definer_retention ON recommendations FOR ALL TO %I USING (true) WITH CHECK (true)', current_user);
END $$;
--> statement-breakpoint
-- Login: único ponto em que se busca usuário sem `app.user_id`. Devolve só o necessário para
-- verificar a senha; o resto do fluxo roda com o contexto do usuário encontrado.
CREATE OR REPLACE FUNCTION auth_lookup_user(p_email text)
  RETURNS TABLE (id uuid, password_hash text, failed_logins integer, locked_until timestamptz)
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = public, pg_temp
  AS $$ SELECT u.id, u.password_hash, u.failed_logins, u.locked_until FROM users u WHERE u.email = p_email $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION auth_lookup_user(text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION auth_lookup_user(text) TO fruiqo_app;
--> statement-breakpoint
-- Retenção de dados de terceiros (TOS-REQ-02: TMDB 180 dias; TOS-REQ-05: YouTube 30 dias).
CREATE OR REPLACE FUNCTION purge_expired_third_party_data()
  RETURNS TABLE (tmdb_cleared integer, youtube_cleared integer)
  LANGUAGE plpgsql SECURITY DEFINER
  SET search_path = public, pg_temp
  AS $$
DECLARE
  t integer;
  y integer;
BEGIN
  UPDATE recommendations
     SET resolution = NULL, resolved_at = NULL
   WHERE resolution->>'provider' = 'tmdb' AND resolved_at < now() - interval '180 days';
  GET DIAGNOSTICS t = ROW_COUNT;

  UPDATE shares
     SET source_title = NULL, source_author = NULL, source_thumbnail_url = NULL, source_fetched_at = NULL
   WHERE platform = 'youtube' AND source_fetched_at < now() - interval '30 days';
  GET DIAGNOSTICS y = ROW_COUNT;

  RETURN QUERY SELECT t, y;
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION purge_expired_third_party_data() FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION purge_expired_third_party_data() TO fruiqo_app;
