CREATE TABLE "taste_subgenre_prefs" (
	"user_id" uuid NOT NULL,
	"subgenre" text NOT NULL,
	"pref" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "taste_subgenre_prefs_user_id_subgenre_pk" PRIMARY KEY("user_id","subgenre")
);
--> statement-breakpoint
ALTER TABLE "taste_overrides" ADD COLUMN "score" real;--> statement-breakpoint
ALTER TABLE "taste_subgenre_prefs" ADD CONSTRAINT "taste_subgenre_prefs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
-- Perfil de gosto editável: nível intermediário por gênero (`level` + `score`) e gosto/não gosto por subgênero.
ALTER TABLE taste_overrides DROP CONSTRAINT taste_overrides_mode_check;--> statement-breakpoint
ALTER TABLE taste_overrides ADD CONSTRAINT taste_overrides_mode_check CHECK (
  (mode IN ('pin', 'exclude') AND score IS NULL) OR (mode = 'level' AND score IS NOT NULL AND score BETWEEN -1 AND 1)
);--> statement-breakpoint
ALTER TABLE taste_subgenre_prefs ADD CONSTRAINT taste_subgenre_prefs_pref_check CHECK (pref IN ('like', 'dislike'));--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON taste_subgenre_prefs TO fruiqo_app;--> statement-breakpoint
ALTER TABLE taste_subgenre_prefs ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE taste_subgenre_prefs FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY taste_subgenre_prefs_owner ON taste_subgenre_prefs FOR ALL TO fruiqo_app
  USING (user_id = app_current_user()) WITH CHECK (user_id = app_current_user());
