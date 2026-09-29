-- RF-48 (D-21): livros pela Open Library.
-- 1) enriquecimento 'openlibrary' e livro nos favoritos declarados;
-- 2) cache de 30 dias da resposta da Open Library (TOS-REQ-62): a purga limpa resolução e
--    alternativas; gêneros derivados dos assuntos ficam (metadados CC0, sem prazo), só o marcador
--    de enriquecimento volta a 'none' para o backfill poder renovar.
-- Mesmo padrão de retenção da 0001/0011: SECURITY DEFINER com o owner não superusuário; a policy
-- recommendations_definer_retention (0001, FOR ALL) já cobre o UPDATE.
ALTER TABLE "recommendations" DROP CONSTRAINT "recommendations_enrichment_check";
--> statement-breakpoint
ALTER TABLE "recommendations" ADD CONSTRAINT "recommendations_enrichment_check" CHECK ("enrichment" IN ('none', 'tmdb', 'openlibrary', 'demo', 'manual'));
--> statement-breakpoint
ALTER TABLE "taste_favorites" DROP CONSTRAINT "taste_favorites_kind_check";
--> statement-breakpoint
ALTER TABLE "taste_favorites" ADD CONSTRAINT "taste_favorites_kind_check" CHECK ("kind" IN ('movie', 'series', 'music_track', 'music_album', 'artist', 'book', 'other'));
--> statement-breakpoint
CREATE OR REPLACE FUNCTION purge_expired_openlibrary_data()
  RETURNS integer
  LANGUAGE plpgsql SECURITY DEFINER
  SET search_path = public, pg_temp
  AS $$
DECLARE
  n integer;
BEGIN
  UPDATE recommendations
     SET resolution = NULL,
         resolved_at = NULL,
         match_alternatives = NULL,
         enrichment = CASE WHEN enrichment = 'openlibrary' THEN 'none' ELSE enrichment END
   WHERE resolution->>'provider' = 'openlibrary' AND resolved_at < now() - interval '30 days';
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION purge_expired_openlibrary_data() FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION purge_expired_openlibrary_data() TO fruiqo_app;
