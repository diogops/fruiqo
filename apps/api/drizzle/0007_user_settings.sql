CREATE TABLE "user_settings" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"remember_mood" boolean DEFAULT false NOT NULL,
	"ai_consent" boolean DEFAULT false NOT NULL,
	"ai_consent_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "user_settings" ADD CONSTRAINT "user_settings_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
-- RLS FORCE: a app conecta como fruiqo_app e só enxerga a própria linha (SEC-REQ-16)
GRANT SELECT, INSERT, UPDATE, DELETE ON user_settings TO fruiqo_app;
--> statement-breakpoint
ALTER TABLE user_settings ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE user_settings FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY user_settings_owner ON user_settings FOR ALL TO fruiqo_app
  USING (user_id = app_current_user()) WITH CHECK (user_id = app_current_user());
--> statement-breakpoint
ALTER TABLE user_settings ADD CONSTRAINT user_settings_consent_at_check
  CHECK (ai_consent = false OR ai_consent_at IS NOT NULL);
--> statement-breakpoint
-- SEC-CTRL-50 (D-08): retenção de runs do "Como estou".
-- Com "lembrar meu humor" a intenção fica até 90 dias; sem ele, o run guarda só o ranking
-- (necessário para "outra coisa" e para o feedback da sessão) e sai em 1 dia.
CREATE OR REPLACE FUNCTION purge_expired_mood_runs()
  RETURNS integer
  LANGUAGE plpgsql SECURITY DEFINER
  SET search_path = public, pg_temp
  AS $$
DECLARE
  n integer;
BEGIN
  DELETE FROM recommendation_runs
   WHERE mode = 'mood'
     AND (created_at < now() - interval '90 days'
          OR (intent IS NULL AND created_at < now() - interval '1 day'));
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION purge_expired_mood_runs() FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION purge_expired_mood_runs() TO fruiqo_app;
