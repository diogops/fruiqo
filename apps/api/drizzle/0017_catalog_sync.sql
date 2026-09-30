CREATE TABLE "catalog_sync_state" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"status" text DEFAULT 'idle' NOT NULL,
	"best_page_movie" integer DEFAULT 0 NOT NULL,
	"best_page_tv" integer DEFAULT 0 NOT NULL,
	"older_than_movie" date,
	"older_than_tv" date,
	"last_started_at" timestamp with time zone,
	"last_finished_at" timestamp with time zone,
	"last_added" integer DEFAULT 0 NOT NULL,
	"total_added" integer DEFAULT 0 NOT NULL,
	"last_error" text
);
--> statement-breakpoint
ALTER TABLE "catalog_sync_state" ADD CONSTRAINT "catalog_sync_state_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
-- D-23: sincronização do Catálogo com o TMDB (primeiro os mais bem avaliados, depois do mais novo
-- para o mais velho). Os títulos sincronizados entram como `catalog` e seguem a purga de 180 dias
-- (TOS-REQ-02).
ALTER TABLE "catalog_sync_state" ADD CONSTRAINT "catalog_sync_state_status_check" CHECK ("status" IN ('idle', 'queued', 'running', 'failed'));--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON catalog_sync_state TO fruiqo_app;--> statement-breakpoint
ALTER TABLE catalog_sync_state ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE catalog_sync_state FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY catalog_sync_state_owner ON catalog_sync_state FOR ALL TO fruiqo_app
  USING (user_id = app_current_user()) WITH CHECK (user_id = app_current_user());--> statement-breakpoint
-- o worker percorre todos os usuários (só os ids; os dados de cada um são lidos sob withUser)
CREATE OR REPLACE FUNCTION catalog_sync_users()
  RETURNS SETOF uuid
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = public, pg_temp
  AS $$ SELECT u.id FROM users u $$;--> statement-breakpoint
REVOKE ALL ON FUNCTION catalog_sync_users() FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION catalog_sync_users() TO fruiqo_app;
