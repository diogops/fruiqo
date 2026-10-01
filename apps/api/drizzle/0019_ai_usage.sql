CREATE TABLE "ai_usage" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"feature" text NOT NULL,
	"model" text NOT NULL,
	"input_tokens" integer DEFAULT 0 NOT NULL,
	"output_tokens" integer DEFAULT 0 NOT NULL,
	"cost_usd" real DEFAULT 0 NOT NULL,
	"ok" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ai_usage" ADD CONSTRAINT "ai_usage_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ai_usage_user_created_idx" ON "ai_usage" USING btree ("user_id","created_at");--> statement-breakpoint
-- Uso de IA por chamada (sem texto): tokens e custo estimado, para o resumo do Perfil.
GRANT SELECT, INSERT ON ai_usage TO fruiqo_app;--> statement-breakpoint
ALTER TABLE ai_usage ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE ai_usage FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY ai_usage_owner ON ai_usage FOR ALL TO fruiqo_app
  USING (user_id = app_current_user()) WITH CHECK (user_id = app_current_user());
