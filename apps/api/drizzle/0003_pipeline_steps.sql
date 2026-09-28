CREATE TABLE "candidate_decisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"share_id" uuid NOT NULL,
	"recommendation_id" uuid,
	"raw_title" text NOT NULL,
	"kind" text NOT NULL,
	"confidence_score" real NOT NULL,
	"decision" text NOT NULL,
	"reason" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pipeline_step_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"share_id" uuid NOT NULL,
	"seq" integer NOT NULL,
	"step" text NOT NULL,
	"mode" text NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"duration_ms" integer NOT NULL,
	"input_summary" jsonb NOT NULL,
	"output_summary" jsonb NOT NULL,
	"tokens_in" integer DEFAULT 0 NOT NULL,
	"tokens_out" integer DEFAULT 0 NOT NULL,
	"cost_estimate_usd" real DEFAULT 0 NOT NULL,
	"error" text
);
--> statement-breakpoint
ALTER TABLE "recommendations" ADD COLUMN "decision" text DEFAULT 'cataloged' NOT NULL;--> statement-breakpoint
ALTER TABLE "recommendations" ADD COLUMN "decision_reason" text;--> statement-breakpoint
ALTER TABLE "shares" ADD COLUMN "is_fixture" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "shares" ADD COLUMN "fixture_id" text;--> statement-breakpoint
ALTER TABLE "candidate_decisions" ADD CONSTRAINT "candidate_decisions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "candidate_decisions" ADD CONSTRAINT "candidate_decisions_share_id_shares_id_fk" FOREIGN KEY ("share_id") REFERENCES "public"."shares"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "candidate_decisions" ADD CONSTRAINT "candidate_decisions_recommendation_id_recommendations_id_fk" FOREIGN KEY ("recommendation_id") REFERENCES "public"."recommendations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pipeline_step_logs" ADD CONSTRAINT "pipeline_step_logs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pipeline_step_logs" ADD CONSTRAINT "pipeline_step_logs_share_id_shares_id_fk" FOREIGN KEY ("share_id") REFERENCES "public"."shares"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "candidate_decisions_share_idx" ON "candidate_decisions" USING btree ("share_id");--> statement-breakpoint
CREATE UNIQUE INDEX "pipeline_step_logs_share_seq" ON "pipeline_step_logs" USING btree ("share_id","seq");--> statement-breakpoint
ALTER TABLE "recommendations" ADD CONSTRAINT "recommendations_decision_check" CHECK ("decision" IN ('cataloged', 'review_queue'));
--> statement-breakpoint
ALTER TABLE "candidate_decisions" ADD CONSTRAINT "candidate_decisions_decision_check" CHECK ("decision" IN ('cataloged', 'review_queue', 'discarded'));
--> statement-breakpoint
ALTER TABLE "pipeline_step_logs" ADD CONSTRAINT "pipeline_step_logs_mode_check" CHECK ("mode" IN ('mock', 'live', 'record'));
--> statement-breakpoint
-- RLS por usuário (SEC-REQ-16), mesmo padrão da 0001.
GRANT SELECT, INSERT, UPDATE, DELETE ON pipeline_step_logs, candidate_decisions TO fruiqo_app;
--> statement-breakpoint
ALTER TABLE pipeline_step_logs ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE pipeline_step_logs FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE candidate_decisions ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE candidate_decisions FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY pipeline_step_logs_owner ON pipeline_step_logs FOR ALL TO fruiqo_app
  USING (user_id = app_current_user()) WITH CHECK (user_id = app_current_user());
--> statement-breakpoint
CREATE POLICY candidate_decisions_owner ON candidate_decisions FOR ALL TO fruiqo_app
  USING (user_id = app_current_user()) WITH CHECK (user_id = app_current_user());
