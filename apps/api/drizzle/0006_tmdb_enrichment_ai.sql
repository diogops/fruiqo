ALTER TABLE "recommendation_runs" ADD COLUMN "interpreter" text;--> statement-breakpoint
ALTER TABLE "recommendation_runs" ADD COLUMN "input_tokens" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "recommendation_runs" ADD COLUMN "output_tokens" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "recommendation_runs" ADD COLUMN "cost_usd" real DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "recommendation_runs" ADD CONSTRAINT "recommendation_runs_interpreter_check" CHECK ("interpreter" IS NULL OR "interpreter" IN ('rules', 'anthropic'));
--> statement-breakpoint
-- 2d: a purga de 180 dias do TMDB (TOS-REQ-02) passa a zerar também o que foi derivado dele
-- (gêneros, duração, enriquecimento). Gêneros marcados à mão (`manual`) são do usuário e ficam.
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
     SET resolution = NULL,
         resolved_at = NULL,
         genres = CASE WHEN enrichment = 'tmdb' THEN '{}'::text[] ELSE genres END,
         runtime_min = CASE WHEN enrichment = 'tmdb' THEN NULL ELSE runtime_min END,
         enrichment = CASE WHEN enrichment = 'tmdb' THEN 'none' ELSE enrichment END
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
