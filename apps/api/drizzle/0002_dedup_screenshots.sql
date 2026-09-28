-- Prints de tela (OCR no device) e deduplicação por usuário.
-- Gerada pelo drizzle-kit e ajustada à mão: dedup_key entra nullable, recebe backfill e só então vira NOT NULL.

CREATE TABLE "seen_pages" (
	"user_id" uuid NOT NULL,
	"page_hash" text NOT NULL,
	"first_share_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "seen_pages_user_id_page_hash_pk" PRIMARY KEY("user_id","page_hash")
);
--> statement-breakpoint
ALTER TABLE "seen_pages" ADD CONSTRAINT "seen_pages_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "seen_pages" ADD CONSTRAINT "seen_pages_first_share_id_shares_id_fk" FOREIGN KEY ("first_share_id") REFERENCES "public"."shares"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shares" ADD COLUMN "input_pages" jsonb;--> statement-breakpoint
ALTER TABLE "shares" ADD COLUMN "origin" text DEFAULT 'link' NOT NULL;--> statement-breakpoint
ALTER TABLE "shares" ADD COLUMN "page_count" integer;--> statement-breakpoint
ALTER TABLE "shares" ADD COLUMN "pages_ignored" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "shares" ADD COLUMN "items_already_in_list" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "recommendations" ADD COLUMN "dedup_key" text;
--> statement-breakpoint
-- Backfill: aproximação em SQL de dedupKey() (src/pipeline/dedup.ts). Pode divergir em casos raros
-- (letras fora da tabela de acentos abaixo); o efeito é só não deduplicar esses itens antigos.
WITH n AS (
  SELECT r.id,
    CASE WHEN r.kind IN ('movie','series') THEN 'screen'
         WHEN r.kind IN ('music_track','music_album','artist') THEN 'music'
         ELSE 'other' END AS grp,
    btrim(regexp_replace(regexp_replace(regexp_replace(regexp_replace(
      translate(lower(normalize(r.title, NFKC)), 'áàâãäåāăąéèêëēėęíìîïīįóòôõöōøúùûüūųçćčñńýÿšžł', 'aaaaaaaaaeeeeeeeiiiiiiooooooouuuuuucccnnyyszl'),
      '^\s*(#\s*[0-9]{1,3}\s*[.)º°ª:–—-]?|[0-9]{1,3}\s*[.)º°ª:–—-])\s*', ''),
      '\((19|20)[0-9]{2}\)', ' ', 'g'),
      '[^[:alnum:] ]', ' ', 'g'),
      '\s+', ' ', 'g')) AS t,
    CASE WHEN r.creator IS NULL THEN '' ELSE
      btrim(regexp_replace(regexp_replace(
        translate(lower(normalize(r.creator, NFKC)), 'áàâãäåāăąéèêëēėęíìîïīįóòôõöōøúùûüūųçćčñńýÿšžł', 'aaaaaaaaaeeeeeeeiiiiiiooooooouuuuuucccnnyyszl'),
        '[^[:alnum:] ]', ' ', 'g'),
        '\s+', ' ', 'g')) END AS c
  FROM recommendations r
)
UPDATE recommendations r
   SET dedup_key = n.grp || ':' || coalesce(nullif(n.t, ''), lower(r.title))
                   || CASE WHEN n.grp = 'music' AND n.c <> '' THEN '|' || n.c ELSE '' END
  FROM n
 WHERE n.id = r.id;
--> statement-breakpoint
-- Colisões antigas (mesmo usuário e chave): fica a recomendação mais antiga.
DELETE FROM recommendations r
 USING recommendations o
 WHERE r.user_id = o.user_id AND r.dedup_key = o.dedup_key
   AND (o.created_at, o.id) < (r.created_at, r.id);
--> statement-breakpoint
ALTER TABLE "recommendations" ALTER COLUMN "dedup_key" SET NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "recommendations_user_dedup_key" ON "recommendations" USING btree ("user_id","dedup_key");
--> statement-breakpoint
-- RLS da tabela nova, igual às demais (SEC-REQ-16). Só o hash é guardado, nunca o texto do print.
GRANT SELECT, INSERT, UPDATE, DELETE ON seen_pages TO fruiqo_app;
--> statement-breakpoint
ALTER TABLE seen_pages ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE seen_pages FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY seen_pages_owner ON seen_pages FOR ALL TO fruiqo_app
  USING (user_id = app_current_user()) WITH CHECK (user_id = app_current_user());
