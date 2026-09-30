-- D-23: atualização agendada do catálogo (12h e 21h, America/Sao_Paulo) com o TMDB (nota geral,
-- onde assistir via JustWatch/TMDB, links). O worker conecta como fruiqo_app e só vê linhas de um
-- usuário por vez (withUser); esta função devolve só os ids de quem tem filme/série catalogado.
CREATE OR REPLACE FUNCTION catalog_refresh_users()
  RETURNS SETOF uuid
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = public, pg_temp
  AS $$ SELECT DISTINCT r.user_id FROM recommendations r WHERE r.decision = 'cataloged' AND r.kind IN ('movie', 'series') $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION catalog_refresh_users() FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION catalog_refresh_users() TO fruiqo_app;
