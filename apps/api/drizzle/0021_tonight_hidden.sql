CREATE TABLE "tonight_hidden" (
	"user_id" uuid NOT NULL,
	"media_type" text NOT NULL,
	"tmdb_id" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tonight_hidden_user_id_media_type_tmdb_id_pk" PRIMARY KEY("user_id","media_type","tmdb_id")
);
--> statement-breakpoint
ALTER TABLE "tonight_hidden" ADD CONSTRAINT "tonight_hidden_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
-- "Não mostrar mais" no "O que assistir hoje?": só o próprio usuário vê e mexe (RLS).
GRANT SELECT, INSERT, DELETE ON tonight_hidden TO fruiqo_app;--> statement-breakpoint
ALTER TABLE tonight_hidden ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE tonight_hidden FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tonight_hidden_owner ON tonight_hidden FOR ALL TO fruiqo_app
  USING (user_id = app_current_user()) WITH CHECK (user_id = app_current_user());
