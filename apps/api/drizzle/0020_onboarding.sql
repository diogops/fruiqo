ALTER TABLE "user_settings" ADD COLUMN "onboarded_at" timestamp with time zone;--> statement-breakpoint
-- Primeiro acesso: quando o usuário concluiu (ou dispensou) a definição do perfil. Nulo = ainda não.
COMMENT ON COLUMN user_settings.onboarded_at IS 'primeiro acesso concluído ou dispensado';
