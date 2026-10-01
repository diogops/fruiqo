ALTER TABLE "users" ADD COLUMN "google_sub" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "display_name" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "has_password" boolean DEFAULT true NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "users_google_sub_key" ON "users" USING btree ("google_sub");--> statement-breakpoint
-- Login com Google: busca a conta pelo `sub` do Google (vínculo) ou, na primeira vez, pelo e-mail
-- verificado. Único outro ponto, além do auth_lookup_user, que busca usuário sem `app.user_id`.
CREATE OR REPLACE FUNCTION auth_lookup_google(p_sub text, p_email text)
  RETURNS TABLE (id uuid, google_sub text, by_sub boolean)
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = public, pg_temp
  AS $$
    SELECT u.id, u.google_sub, (u.google_sub = p_sub) AS by_sub
    FROM users u
    WHERE u.google_sub = p_sub OR u.email = p_email
    ORDER BY (u.google_sub = p_sub) DESC NULLS LAST
    LIMIT 1
  $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION auth_lookup_google(text, text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION auth_lookup_google(text, text) TO fruiqo_app;
