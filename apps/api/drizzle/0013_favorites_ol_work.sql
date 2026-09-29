-- RF-43/RF-48: favorito de livro escolhido na busca guarda a obra da Open Library.
-- A capa (URL de covers.openlibrary.org) segue o cache de 30 dias da Open Library (TOS-REQ-62):
-- a purga zera poster_url e resolved_at; gêneros derivados dos assuntos ficam (CC0, como na 0012).
-- Com resolved_at nulo, a purga de 180 dias do TMDB (0011) não mexe mais nesses favoritos.
-- A policy taste_favorites_definer_retention (0011, FOR ALL) já cobre o UPDATE da função.
ALTER TABLE "taste_favorites" ADD COLUMN "ol_work_id" text;
--> statement-breakpoint
ALTER TABLE "taste_favorites" ADD CONSTRAINT "taste_favorites_ol_work_id_check" CHECK ("ol_work_id" IS NULL OR "ol_work_id" ~ '^OL[0-9]{1,12}W$');
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

  UPDATE taste_favorites
     SET poster_url = NULL, resolved_at = NULL
   WHERE ol_work_id IS NOT NULL AND resolved_at < now() - interval '30 days';

  RETURN n;
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION purge_expired_openlibrary_data() FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION purge_expired_openlibrary_data() TO fruiqo_app;
