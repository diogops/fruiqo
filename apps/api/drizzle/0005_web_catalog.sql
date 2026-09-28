CREATE TABLE "bulk_undo" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"operation" text NOT NULL,
	"snapshot" jsonb NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "review_actions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"recommendation_id" uuid,
	"action" text NOT NULL,
	"before" jsonb NOT NULL,
	"after" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "taste_overrides" (
	"user_id" uuid NOT NULL,
	"genre" text NOT NULL,
	"mode" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "taste_overrides_user_id_genre_pk" PRIMARY KEY("user_id","genre")
);
--> statement-breakpoint
CREATE TABLE "user_subscriptions" (
	"user_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_subscriptions_user_id_provider_pk" PRIMARY KEY("user_id","provider")
);
--> statement-breakpoint
ALTER TABLE "bulk_undo" ADD CONSTRAINT "bulk_undo_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_actions" ADD CONSTRAINT "review_actions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_actions" ADD CONSTRAINT "review_actions_recommendation_id_recommendations_id_fk" FOREIGN KEY ("recommendation_id") REFERENCES "public"."recommendations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "taste_overrides" ADD CONSTRAINT "taste_overrides_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_subscriptions" ADD CONSTRAINT "user_subscriptions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "bulk_undo_user_idx" ON "bulk_undo" USING btree ("user_id","expires_at");--> statement-breakpoint
CREATE INDEX "review_actions_user_idx" ON "review_actions" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "recommendations_user_decision_priority_idx" ON "recommendations" USING btree ("user_id","decision","priority","created_at");--> statement-breakpoint
-- RLS FORCE: a app conecta como fruiqo_app e só enxerga as próprias linhas (SEC-REQ-16)
GRANT SELECT, INSERT, UPDATE, DELETE ON review_actions, taste_overrides, user_subscriptions, bulk_undo TO fruiqo_app;
--> statement-breakpoint
ALTER TABLE review_actions ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE review_actions FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE taste_overrides ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE taste_overrides FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE user_subscriptions ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE user_subscriptions FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE bulk_undo ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE bulk_undo FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY review_actions_owner ON review_actions FOR ALL TO fruiqo_app
  USING (user_id = app_current_user()) WITH CHECK (user_id = app_current_user());
--> statement-breakpoint
CREATE POLICY taste_overrides_owner ON taste_overrides FOR ALL TO fruiqo_app
  USING (user_id = app_current_user()) WITH CHECK (user_id = app_current_user());
--> statement-breakpoint
CREATE POLICY user_subscriptions_owner ON user_subscriptions FOR ALL TO fruiqo_app
  USING (user_id = app_current_user()) WITH CHECK (user_id = app_current_user());
--> statement-breakpoint
CREATE POLICY bulk_undo_owner ON bulk_undo FOR ALL TO fruiqo_app
  USING (user_id = app_current_user()) WITH CHECK (user_id = app_current_user());
--> statement-breakpoint
ALTER TABLE taste_overrides ADD CONSTRAINT taste_overrides_mode_check CHECK (mode IN ('pin', 'exclude'));
--> statement-breakpoint
ALTER TABLE review_actions ADD CONSTRAINT review_actions_action_check CHECK (action IN ('approve', 'reject', 'rematch', 'correct', 'merge'));
