CREATE TABLE "access_requests" (
	"email" text PRIMARY KEY NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"decided_at" timestamp with time zone,
	"decided_by" text
);
--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "mfa_verified" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "mfa_secret" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "mfa_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "mfa_last_step" integer;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "mfa_recovery" jsonb;--> statement-breakpoint
-- Pedidos de acesso: tabela do sistema (sem dono); só cadastro/login e a área de administração (admin + MFA) usam.
ALTER TABLE access_requests ADD CONSTRAINT access_requests_status_check CHECK (status IN ('pending', 'approved', 'denied'));--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON access_requests TO fruiqo_app;
