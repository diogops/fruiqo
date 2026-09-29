CREATE TABLE "priority_drafts" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"order" jsonb NOT NULL,
	"base" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "taste_favorites" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"title" text NOT NULL,
	"kind" text NOT NULL,
	"year" integer,
	"rating" integer,
	"comment" text,
	"genres" text[] DEFAULT '{}'::text[] NOT NULL,
	"tmdb_id" integer,
	"media_type" text,
	"poster_url" text,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "taste_statements" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"summary" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "recommendations" ADD COLUMN "suggested_decision" text;--> statement-breakpoint
ALTER TABLE "recommendations" ADD COLUMN "match_score" real;--> statement-breakpoint
ALTER TABLE "recommendations" ADD COLUMN "match_alternatives" jsonb;--> statement-breakpoint
ALTER TABLE "recommendations" ADD COLUMN "source_position" integer;--> statement-breakpoint
ALTER TABLE "shares" ADD COLUMN "proposed_list" jsonb;--> statement-breakpoint
ALTER TABLE "priority_drafts" ADD CONSTRAINT "priority_drafts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "taste_favorites" ADD CONSTRAINT "taste_favorites_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "taste_statements" ADD CONSTRAINT "taste_statements_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "taste_favorites_user_idx" ON "taste_favorites" USING btree ("user_id","created_at");--> statement-breakpoint
ALTER TABLE "recommendations" ADD CONSTRAINT "recommendations_suggested_decision_check" CHECK ("suggested_decision" IS NULL OR "suggested_decision" IN ('cataloged', 'review_queue'));
--> statement-breakpoint
ALTER TABLE "recommendations" ADD CONSTRAINT "recommendations_match_score_check" CHECK ("match_score" IS NULL OR ("match_score" >= 0 AND "match_score" <= 1));
--> statement-breakpoint
ALTER TABLE "taste_favorites" ADD CONSTRAINT "taste_favorites_kind_check" CHECK ("kind" IN ('movie', 'series', 'music_track', 'music_album', 'artist', 'other'));
--> statement-breakpoint
ALTER TABLE "taste_favorites" ADD CONSTRAINT "taste_favorites_rating_check" CHECK ("rating" IS NULL OR "rating" BETWEEN 1 AND 5);
--> statement-breakpoint
ALTER TABLE "taste_favorites" ADD CONSTRAINT "taste_favorites_media_type_check" CHECK ("media_type" IS NULL OR "media_type" IN ('movie', 'tv'));
--> statement-breakpoint
ALTER TABLE "taste_statements" ADD CONSTRAINT "taste_statements_summary_len" CHECK (char_length("summary") <= 2000);
--> statement-breakpoint
-- RLS FORCE: a app conecta como fruiqo_app e só enxerga as próprias linhas (SEC-REQ-16)
GRANT SELECT, INSERT, UPDATE, DELETE ON taste_favorites, taste_statements, priority_drafts TO fruiqo_app;
--> statement-breakpoint
ALTER TABLE taste_favorites ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE taste_favorites FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE taste_statements ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE taste_statements FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE priority_drafts ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE priority_drafts FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY taste_favorites_owner ON taste_favorites FOR ALL TO fruiqo_app
  USING (user_id = app_current_user()) WITH CHECK (user_id = app_current_user());
--> statement-breakpoint
CREATE POLICY taste_statements_owner ON taste_statements FOR ALL TO fruiqo_app
  USING (user_id = app_current_user()) WITH CHECK (user_id = app_current_user());
--> statement-breakpoint
CREATE POLICY priority_drafts_owner ON priority_drafts FOR ALL TO fruiqo_app
  USING (user_id = app_current_user()) WITH CHECK (user_id = app_current_user());
--> statement-breakpoint
-- A purga (SECURITY DEFINER, owner não superusuário) também limpa os dados do TMDB dos favoritos:
-- policy de retenção restrita à role dona da função (mesmo padrão da 0001/0009/0010).
DO $$
BEGIN
  EXECUTE format('CREATE POLICY taste_favorites_definer_retention ON taste_favorites FOR ALL TO %I USING (true) WITH CHECK (true)', current_user);
END $$;
--> statement-breakpoint
-- TOS-REQ-02: alternativas de match e dados de favoritos vindos do TMDB também vencem em 180 dias.
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
         match_alternatives = NULL,
         genres = CASE WHEN enrichment = 'tmdb' THEN '{}'::text[] ELSE genres END,
         runtime_min = CASE WHEN enrichment = 'tmdb' THEN NULL ELSE runtime_min END,
         enrichment = CASE WHEN enrichment = 'tmdb' THEN 'none' ELSE enrichment END
   WHERE resolution->>'provider' = 'tmdb' AND resolved_at < now() - interval '180 days';
  GET DIAGNOSTICS t = ROW_COUNT;

  UPDATE taste_favorites
     SET genres = '{}'::text[], poster_url = NULL, resolved_at = NULL
   WHERE resolved_at < now() - interval '180 days';

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
