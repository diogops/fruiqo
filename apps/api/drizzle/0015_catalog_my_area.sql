-- D-23: Catálogo × Minha Área. Status novo `catalog` (título que o usuário tem, sem intenção de ver
-- agora); Minha Área = to_watch / watching (com `watch_on`) / watched. Sem fila de revisão: o que o
-- usuário escolhe no import entra direto como to_watch. Três notas: manual (rating), automática
-- (auto_rating, calculada localmente) e geral (resolution.voteAverage, TMDB 0..10).
ALTER TABLE "recommendations" ADD COLUMN "watch_on" text;--> statement-breakpoint
ALTER TABLE "recommendations" ADD COLUMN "auto_rating" real;--> statement-breakpoint
ALTER TABLE "recommendations" DROP CONSTRAINT "recommendations_status_check";--> statement-breakpoint
ALTER TABLE "recommendations" ADD CONSTRAINT "recommendations_status_check" CHECK ("status" IN ('catalog', 'to_watch', 'watching', 'watched', 'dropped'));--> statement-breakpoint
ALTER TABLE "recommendations" ADD CONSTRAINT "recommendations_watch_on_check" CHECK ("watch_on" IS NULL OR char_length("watch_on") BETWEEN 1 AND 60);--> statement-breakpoint
ALTER TABLE "recommendations" ADD CONSTRAINT "recommendations_auto_rating_check" CHECK ("auto_rating" IS NULL OR "auto_rating" BETWEEN 0 AND 5);--> statement-breakpoint
-- Migração dos dados (D-23, pedido do dono do produto): a Minha Área começa sem "Quero assistir":
-- tudo o que existe vai para o catálogo (inclusive o que esperava revisão); assistindo e assistido
-- ficam (são marcações do usuário).
-- O dono roda a migração com a policy recommendations_definer_retention (0001, FOR ALL).
UPDATE recommendations SET status = 'catalog', updated_at = now() WHERE decision = 'cataloged' AND status IN ('to_watch', 'dropped');--> statement-breakpoint
-- um a um: o trigger de posição (0008) calcula max(rank)+1 por linha, e num UPDATE único várias
-- linhas do mesmo usuário ganhariam a mesma posição
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN SELECT id FROM recommendations WHERE decision = 'review_queue' ORDER BY user_id, created_at, id LOOP
    UPDATE recommendations SET decision = 'cataloged', decision_reason = 'd23_no_review', status = 'catalog', updated_at = now() WHERE id = r.id;
  END LOOP;
END $$;--> statement-breakpoint
-- Fila de prioridade (a ordem manual do usuário) só para quem está na Minha Área para ver:
-- Quero assistir e Assistindo. Catálogo e assistidos ficam fora da fila (rank nulo); ao entrar na
-- Minha Área, o título vai para o fim; ao sair, a fila é compactada (trigger da 0008).
-- a posição agora existe só para Quero assistir/Assistindo (não para todo catalogado)
ALTER TABLE recommendations DROP CONSTRAINT recommendations_rank_decision;--> statement-breakpoint
CREATE OR REPLACE FUNCTION recommendations_assign_rank()
  RETURNS trigger
  LANGUAGE plpgsql
  AS $$
BEGIN
  IF NEW.decision = 'cataloged' AND NEW.status IN ('to_watch', 'watching') THEN
    IF NEW.rank IS NULL THEN
      PERFORM pg_advisory_xact_lock(hashtextextended('fruiqo_rank:' || NEW.user_id::text, 0));
      SELECT coalesce(max(rank), 0) + 1 INTO NEW.rank FROM recommendations WHERE user_id = NEW.user_id;
    END IF;
  ELSE
    NEW.rank := NULL;
  END IF;
  RETURN NEW;
END $$;--> statement-breakpoint
DROP TRIGGER recommendations_assign_rank ON recommendations;--> statement-breakpoint
CREATE TRIGGER recommendations_assign_rank
  BEFORE INSERT OR UPDATE OF decision, status ON recommendations
  FOR EACH ROW EXECUTE FUNCTION recommendations_assign_rank();--> statement-breakpoint
UPDATE recommendations SET rank = NULL WHERE rank IS NOT NULL AND status NOT IN ('to_watch', 'watching');--> statement-breakpoint
ALTER TABLE recommendations ADD CONSTRAINT recommendations_rank_decision
  CHECK (rank IS NULL OR (decision = 'cataloged' AND status IN ('to_watch', 'watching')));--> statement-breakpoint
-- A nota geral (TMDB vote_average) fica dentro de `resolution` e some com ela na purga de 180 dias.
CREATE OR REPLACE FUNCTION purge_expired_third_party_data()
  RETURNS TABLE (tmdb_cleared integer, youtube_cleared integer)
  LANGUAGE plpgsql SECURITY DEFINER
  SET search_path = public, pg_temp
  AS $$
DECLARE
  t integer;
  y integer;
BEGIN
  UPDATE recommendations
     SET resolution = NULL,
         resolved_at = NULL,
         match_alternatives = NULL,
         genres = CASE WHEN enrichment = 'tmdb' THEN '{}'::text[] ELSE genres END,
         runtime_min = CASE WHEN enrichment = 'tmdb' THEN NULL ELSE runtime_min END,
         enrichment = CASE WHEN enrichment = 'tmdb' THEN 'none' ELSE enrichment END
   WHERE resolution->>'provider' = 'tmdb' AND resolved_at < now() - interval '180 days';
  GET DIAGNOSTICS t = ROW_COUNT;

  UPDATE taste_favorites
     SET genres = '{}'::text[], poster_url = NULL, resolved_at = NULL
   WHERE resolved_at < now() - interval '180 days';

  UPDATE shares
     SET source_title = NULL, source_author = NULL, source_thumbnail_url = NULL, source_fetched_at = NULL
   WHERE platform = 'youtube' AND source_fetched_at < now() - interval '30 days';
  GET DIAGNOSTICS y = ROW_COUNT;

  RETURN QUERY SELECT t, y;
END $$;--> statement-breakpoint
REVOKE ALL ON FUNCTION purge_expired_third_party_data() FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION purge_expired_third_party_data() TO fruiqo_app;
