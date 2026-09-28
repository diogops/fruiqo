CREATE TABLE "list_items" (
	"list_id" uuid NOT NULL,
	"recommendation_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"added_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "list_items_list_id_recommendation_id_pk" PRIMARY KEY("list_id","recommendation_id")
);
--> statement-breakpoint
CREATE TABLE "lists" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"source_share_id" uuid,
	"pinned" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "recommendation_feedback" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"run_id" uuid NOT NULL,
	"recommendation_id" uuid NOT NULL,
	"action" text NOT NULL,
	"reason_tag" text,
	"reason_text" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "recommendation_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"mode" text NOT NULL,
	"ai_mode" text NOT NULL,
	"intent" jsonb,
	"risk_shown" boolean DEFAULT false NOT NULL,
	"candidate_count" integer DEFAULT 0 NOT NULL,
	"ranked" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "taste_signals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"recommendation_id" uuid,
	"signal" text NOT NULL,
	"value" real DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "recommendations" ALTER COLUMN "share_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "recommendations" ADD COLUMN "status" text DEFAULT 'to_watch' NOT NULL;--> statement-breakpoint
ALTER TABLE "recommendations" ADD COLUMN "priority" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "recommendations" ADD COLUMN "rating" integer;--> statement-breakpoint
ALTER TABLE "recommendations" ADD COLUMN "notes" text;--> statement-breakpoint
ALTER TABLE "recommendations" ADD COLUMN "genres" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "recommendations" ADD COLUMN "attributes" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "recommendations" ADD COLUMN "runtime_min" integer;--> statement-breakpoint
ALTER TABLE "recommendations" ADD COLUMN "enrichment" text DEFAULT 'none' NOT NULL;--> statement-breakpoint
ALTER TABLE "recommendations" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "list_items" ADD CONSTRAINT "list_items_list_id_lists_id_fk" FOREIGN KEY ("list_id") REFERENCES "public"."lists"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "list_items" ADD CONSTRAINT "list_items_recommendation_id_recommendations_id_fk" FOREIGN KEY ("recommendation_id") REFERENCES "public"."recommendations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "list_items" ADD CONSTRAINT "list_items_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lists" ADD CONSTRAINT "lists_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lists" ADD CONSTRAINT "lists_source_share_id_shares_id_fk" FOREIGN KEY ("source_share_id") REFERENCES "public"."shares"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recommendation_feedback" ADD CONSTRAINT "recommendation_feedback_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recommendation_feedback" ADD CONSTRAINT "recommendation_feedback_run_id_recommendation_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."recommendation_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recommendation_feedback" ADD CONSTRAINT "recommendation_feedback_recommendation_id_recommendations_id_fk" FOREIGN KEY ("recommendation_id") REFERENCES "public"."recommendations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recommendation_runs" ADD CONSTRAINT "recommendation_runs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "taste_signals" ADD CONSTRAINT "taste_signals_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "taste_signals" ADD CONSTRAINT "taste_signals_recommendation_id_recommendations_id_fk" FOREIGN KEY ("recommendation_id") REFERENCES "public"."recommendations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "list_items_rec_idx" ON "list_items" USING btree ("recommendation_id");--> statement-breakpoint
CREATE INDEX "lists_user_idx" ON "lists" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "recommendation_feedback_user_idx" ON "recommendation_feedback" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "recommendation_runs_user_idx" ON "recommendation_runs" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "taste_signals_user_idx" ON "taste_signals" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "recommendations_user_status_idx" ON "recommendations" USING btree ("user_id","status");--> statement-breakpoint
ALTER TABLE "recommendations" ADD CONSTRAINT "recommendations_status_check" CHECK ("status" IN ('to_watch', 'watching', 'watched', 'dropped'));
--> statement-breakpoint
ALTER TABLE "recommendations" ADD CONSTRAINT "recommendations_priority_check" CHECK ("priority" BETWEEN 0 AND 3);
--> statement-breakpoint
ALTER TABLE "recommendations" ADD CONSTRAINT "recommendations_rating_check" CHECK ("rating" IS NULL OR "rating" BETWEEN 1 AND 5);
--> statement-breakpoint
ALTER TABLE "recommendations" ADD CONSTRAINT "recommendations_enrichment_check" CHECK ("enrichment" IN ('none', 'tmdb', 'demo', 'manual'));
--> statement-breakpoint
ALTER TABLE "taste_signals" ADD CONSTRAINT "taste_signals_signal_check" CHECK ("signal" IN ('watched', 'rated', 'dropped', 'added_to_list', 'accepted', 'skipped'));
--> statement-breakpoint
ALTER TABLE "recommendation_runs" ADD CONSTRAINT "recommendation_runs_mode_check" CHECK ("mode" IN ('surprise', 'mood'));
--> statement-breakpoint
ALTER TABLE "recommendation_runs" ADD CONSTRAINT "recommendation_runs_ai_mode_check" CHECK ("ai_mode" IN ('off', 'rules', 'anthropic'));
--> statement-breakpoint
ALTER TABLE "recommendation_feedback" ADD CONSTRAINT "recommendation_feedback_action_check" CHECK ("action" IN ('accept', 'skip', 'another'));
--> statement-breakpoint
ALTER TABLE "recommendation_feedback" ADD CONSTRAINT "recommendation_feedback_reason_text_check" CHECK ("reason_text" IS NULL OR length("reason_text") <= 30);
--> statement-breakpoint
-- RLS por usuário (SEC-REQ-16), mesmo padrão da 0001/0003.
GRANT SELECT, INSERT, UPDATE, DELETE ON lists, list_items, taste_signals, recommendation_runs, recommendation_feedback TO fruiqo_app;
--> statement-breakpoint
ALTER TABLE lists ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE lists FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE list_items ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE list_items FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE taste_signals ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE taste_signals FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE recommendation_runs ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE recommendation_runs FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE recommendation_feedback ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE recommendation_feedback FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY lists_owner ON lists FOR ALL TO fruiqo_app
  USING (user_id = app_current_user()) WITH CHECK (user_id = app_current_user());
--> statement-breakpoint
CREATE POLICY list_items_owner ON list_items FOR ALL TO fruiqo_app
  USING (user_id = app_current_user()) WITH CHECK (user_id = app_current_user());
--> statement-breakpoint
CREATE POLICY taste_signals_owner ON taste_signals FOR ALL TO fruiqo_app
  USING (user_id = app_current_user()) WITH CHECK (user_id = app_current_user());
--> statement-breakpoint
CREATE POLICY recommendation_runs_owner ON recommendation_runs FOR ALL TO fruiqo_app
  USING (user_id = app_current_user()) WITH CHECK (user_id = app_current_user());
--> statement-breakpoint
CREATE POLICY recommendation_feedback_owner ON recommendation_feedback FOR ALL TO fruiqo_app
  USING (user_id = app_current_user()) WITH CHECK (user_id = app_current_user());
