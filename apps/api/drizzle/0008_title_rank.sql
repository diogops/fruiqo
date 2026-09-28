-- Prioridade por posição: cada título catalogado tem uma posição única e contínua (1..N) na fila
-- do usuário; 1 = mais prioritário. Itens da fila de revisão não têm posição.
--
-- Estratégia: rank inteiro com renumeração transacional.
--   * inserção/aprovação: trigger BEFORE coloca o título no fim da fila (max + 1), sob advisory
--     lock por usuário (inserções concorrentes do mesmo usuário não colidem);
--   * remoção ou saída do catálogo (decision → review_queue): trigger AFTER por comando fecha os
--     buracos renumerando só o usuário afetado;
--   * reordenação (POST /library/:id/move, bulk move_top/move_bottom): o serviço desloca o
--     intervalo afetado na mesma transação, sob o mesmo advisory lock.
-- A unicidade (user_id, rank) é DEFERRABLE para os deslocamentos passarem por estados
-- intermediários com posições repetidas dentro da transação.
ALTER TABLE "recommendations" ADD COLUMN "rank" integer;
--> statement-breakpoint
-- backfill: prioridade 0–3 decrescente, depois o mais recente primeiro
UPDATE recommendations r SET rank = s.rn
  FROM (
    SELECT id, row_number() OVER (PARTITION BY user_id ORDER BY priority DESC, created_at DESC, id) AS rn
      FROM recommendations
     WHERE decision = 'cataloged'
  ) s
 WHERE r.id = s.id;
--> statement-breakpoint
ALTER TABLE recommendations ADD CONSTRAINT recommendations_rank_positive CHECK (rank IS NULL OR rank >= 1);
--> statement-breakpoint
ALTER TABLE recommendations ADD CONSTRAINT recommendations_rank_decision
  CHECK ((decision = 'cataloged') = (rank IS NOT NULL));
--> statement-breakpoint
ALTER TABLE recommendations ADD CONSTRAINT recommendations_user_rank_unique
  UNIQUE (user_id, rank) DEFERRABLE INITIALLY DEFERRED;
--> statement-breakpoint
DROP INDEX IF EXISTS "recommendations_user_decision_priority_idx";
--> statement-breakpoint
ALTER TABLE "recommendations" DROP COLUMN "priority";
--> statement-breakpoint
-- Títulos novos (share, prints, manual, seed) e aprovados na revisão entram no fim da fila.
-- SECURITY INVOKER: sob RLS a app só enxerga as linhas do próprio usuário (app.user_id).
CREATE OR REPLACE FUNCTION recommendations_assign_rank()
  RETURNS trigger
  LANGUAGE plpgsql
  AS $$
BEGIN
  IF NEW.decision = 'cataloged' THEN
    IF NEW.rank IS NULL THEN
      PERFORM pg_advisory_xact_lock(hashtextextended('fruiqo_rank:' || NEW.user_id::text, 0));
      SELECT coalesce(max(rank), 0) + 1 INTO NEW.rank FROM recommendations WHERE user_id = NEW.user_id;
    END IF;
  ELSE
    NEW.rank := NULL;
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER recommendations_assign_rank
  BEFORE INSERT OR UPDATE OF decision ON recommendations
  FOR EACH ROW EXECUTE FUNCTION recommendations_assign_rank();
--> statement-breakpoint
-- Fecha buracos na fila dos usuários afetados.
CREATE OR REPLACE FUNCTION recommendations_compact_ranks(affected uuid[])
  RETURNS void
  LANGUAGE plpgsql
  AS $$
BEGIN
  UPDATE recommendations r SET rank = s.rn
    FROM (
      SELECT id, row_number() OVER (PARTITION BY user_id ORDER BY rank, id) AS rn
        FROM recommendations
       WHERE rank IS NOT NULL AND user_id = ANY (affected)
    ) s
   WHERE r.id = s.id AND r.rank IS DISTINCT FROM s.rn;
END $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION recommendations_compact_after_delete()
  RETURNS trigger
  LANGUAGE plpgsql
  AS $$
BEGIN
  PERFORM recommendations_compact_ranks(ARRAY(SELECT DISTINCT user_id FROM old_rows WHERE rank IS NOT NULL));
  RETURN NULL;
END $$;
--> statement-breakpoint
CREATE TRIGGER recommendations_compact_after_delete
  AFTER DELETE ON recommendations
  REFERENCING OLD TABLE AS old_rows
  FOR EACH STATEMENT EXECUTE FUNCTION recommendations_compact_after_delete();
--> statement-breakpoint
-- Só compacta quando algum título saiu da fila (rank → null). Reordenações não passam por aqui.
CREATE OR REPLACE FUNCTION recommendations_compact_after_update()
  RETURNS trigger
  LANGUAGE plpgsql
  AS $$
BEGIN
  IF pg_trigger_depth() > 1 THEN
    RETURN NULL;
  END IF;
  PERFORM recommendations_compact_ranks(ARRAY(
    SELECT DISTINCT o.user_id
      FROM old_rows o JOIN new_rows n ON n.id = o.id
     WHERE o.rank IS NOT NULL AND n.rank IS NULL
  ));
  RETURN NULL;
END $$;
--> statement-breakpoint
CREATE TRIGGER recommendations_compact_after_update
  AFTER UPDATE ON recommendations
  REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows
  FOR EACH STATEMENT EXECUTE FUNCTION recommendations_compact_after_update();
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION recommendations_compact_ranks(uuid[]) TO fruiqo_app;
